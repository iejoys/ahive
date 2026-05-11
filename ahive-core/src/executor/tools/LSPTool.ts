/**
 * LSPTool - 代码智能工具
 *
 * 提供语义级代码理解能力：
 * - 定义跳转
 * - 引用查找
 * - 悬停信息
 * - 文档符号
 * - 工作区符号
 * - 实现查找
 * - 类型定义
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { AgentTool, ToolResult } from '../tool-system.js';
import type { LSPOperation, LSPResult } from '../../lsp/types.js';

/**
 * LSP 参数 Schema
 */
const LSPParamsSchema = z.object({
  operation: z.enum([
    'definition',
    'references',
    'hover',
    'documentSymbol',
    'workspaceSymbol',
    'implementation',
    'typeDefinition',
  ]).describe('The LSP operation to perform'),
  filePath: z.string().describe('The absolute path to the file'),
  line: z.number().int().positive().optional().describe('Line number (1-based). Required for most operations except documentSymbol and workspaceSymbol'),
  character: z.number().int().positive().optional().describe('Character offset (1-based). Required for most operations except documentSymbol and workspaceSymbol'),
});

type LSPParams = z.infer<typeof LSPParamsSchema>;

/**
 * 判断操作是否需要位置参数
 */
function needsPosition(operation: LSPOperation): boolean {
  return operation !== 'documentSymbol' && operation !== 'workspaceSymbol';
}

/**
 * 通过 IPC 调用主进程
 */
async function callThroughIPC(params: LSPParams, signal?: AbortSignal): Promise<LSPResult> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();

    const timeout = setTimeout(() => {
      process.off('message', handler);
      reject(new Error('LSP request timeout'));
    }, 30000);

    const handler = (msg: any) => {
      if (msg.type === 'lsp_response' && msg.id === requestId) {
        clearTimeout(timeout);
        process.off('message', handler);

        resolve({
          success: msg.success,
          data: msg.data,
          error: msg.error,
          durationMs: msg.durationMs || 0,
        });
      }
    };

    process.on('message', handler);

    process.send!({
      type: 'lsp_request',
      id: requestId,
      operation: params.operation,
      filePath: params.filePath,
      line: params.line,
      character: params.character,
    });

    // 支持取消
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        process.off('message', handler);
        reject(new Error('Request aborted'));
      });
    }
  });
}

/**
 * 符号类型转字符串
 */
function symbolKindToString(kind: number): string {
  const kinds: Record<number, string> = {
    1: 'file',
    2: 'module',
    3: 'namespace',
    4: 'package',
    5: 'class',
    6: 'method',
    7: 'property',
    8: 'field',
    9: 'constructor',
    10: 'enum',
    11: 'interface',
    12: 'function',
    13: 'variable',
    14: 'constant',
    15: 'string',
    16: 'number',
    17: 'boolean',
    18: 'array',
    19: 'object',
    20: 'key',
    21: 'null',
    22: 'enum_member',
    23: 'struct',
    24: 'event',
    25: 'operator',
    26: 'type_parameter',
  };
  return kinds[kind] || `kind_${kind}`;
}

/**
 * 格式化文档符号
 */
function formatDocumentSymbols(symbols: any, indent: string = ''): string {
  const lines: string[] = [];

  const formatSymbol = (symbol: any, indent: string): void => {
    const kind = symbolKindToString(symbol.kind);
    const line = symbol.range?.start?.line ?? 0;
    lines.push(`${indent}${symbol.name} (${kind}) :${line + 1}`);

    if (symbol.children && symbol.children.length > 0) {
      for (const child of symbol.children) {
        formatSymbol(child, indent + '  ');
      }
    }
  };

  if (Array.isArray(symbols)) {
    for (const symbol of symbols) {
      formatSymbol(symbol, indent);
    }
  } else {
    formatSymbol(symbols, indent);
  }

  return lines.join('\n');
}

/**
 * 格式化结果
 */
function formatResult(operation: string, data: any): string {
  if (!data) {
    return 'No results found';
  }

  // 处理 null 或 undefined
  if (data === null) {
    return 'No results found';
  }

  // 定义/引用/实现结果（位置数组）
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return 'No results found';
    }

    return data.map(item => {
      if (item.uri) {
        const file = item.uri.replace('file://', '');
        const line = item.range?.start?.line ?? 0;
        const char = item.range?.start?.character ?? 0;
        return `${file}:${line + 1}:${char + 1}`;
      }
      if (item.targetUri) {
        const file = item.targetUri.replace('file://', '');
        const line = item.targetSelectionRange?.start?.line ?? 0;
        return `${file}:${line + 1}`;
      }
      return JSON.stringify(item);
    }).join('\n');
  }

  // 单个位置结果
  if (data.uri) {
    const file = data.uri.replace('file://', '');
    const line = data.range?.start?.line ?? 0;
    return `${file}:${line + 1}`;
  }

  // 悬停结果
  if (data.contents) {
    if (typeof data.contents === 'string') {
      return data.contents;
    }
    if (data.contents.kind && data.contents.value) {
      return `(${data.contents.kind})\n${data.contents.value}`;
    }
    if (Array.isArray(data.contents)) {
      return data.contents.map(c => {
        if (typeof c === 'string') return c;
        if (c.language && c.value) {
          return `\`\`\`${c.language}\n${c.value}\n\`\`\``;
        }
        return c.value || String(c);
      }).join('\n');
    }
  }

  // 文档符号
  if (data.name && data.kind !== undefined) {
    return formatDocumentSymbols(data);
  }

  // 工作区符号数组
  if (Array.isArray(data) && data[0]?.name && data[0]?.location) {
    return data.map(s => {
      const file = s.location.uri.replace('file://', '');
      const line = s.location.range?.start?.line ?? 0;
      return `${s.name} (${symbolKindToString(s.kind)}) - ${file}:${line + 1}`;
    }).join('\n');
  }

  // 其他情况：JSON 格式
  return JSON.stringify(data, null, 2);
}

/**
 * LSPTool 定义
 */
export const LSPTool: AgentTool<LSPParams> = {
  name: 'LSP',
  label: 'code intelligence',
  description: `Interact with Language Server Protocol (LSP) servers for semantic code intelligence.

**Supported Operations:**
- definition: Jump to the definition of a symbol at position
- references: Find all references to a symbol at position
- hover: Get type information and documentation at position
- documentSymbol: List all symbols in a document (no position needed)
- workspaceSymbol: Search symbols across the workspace (no position needed)
- implementation: Find implementations of an interface at position
- typeDefinition: Go to the type definition at position

**Required Parameters:**
All operations require:
- filePath: The absolute path to the file
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: documentSymbol and workspaceSymbol do not require line/character parameters.

**Advantages over Grep:**
- Semantic understanding (accurate matches, not just text)
- Cross-file navigation
- Type-aware analysis
- Symbol-based search

**Important Notes:**
- LSP servers must be configured for the file type
- If no server is available, an error will be returned
- Use this for precise code navigation, not for searching text patterns

**Examples:**
- Jump to definition: { "operation": "definition", "filePath": "src/app.ts", "line": 10, "character": 5 }
- Find all references: { "operation": "references", "filePath": "src/utils.ts", "line": 15, "character": 8 }
- List document symbols: { "operation": "documentSymbol", "filePath": "src/index.ts" }
- Search workspace symbols: { "operation": "workspaceSymbol", "filePath": "src/index.ts", "line": 1, "character": 1 }`,

  parameters: LSPParamsSchema,

  /**
   * 执行 LSP 操作
   */
  async execute(toolCallId, params, signal): Promise<ToolResult> {
    const start = Date.now();

    try {
      // 验证参数
      if (!needsPosition(params.operation)) {
        // documentSymbol 和 workspaceSymbol 不需要位置
        params = { ...params, line: 1, character: 1 };
      }

      if (!params.line || !params.character) {
        return {
          success: false,
          content: [{ type: 'text', text: `Error: line and character are required for ${params.operation}` }],
          error: 'Missing position parameters',
        };
      }

      // 判断是否在子进程
      const isSubprocess = process.send !== undefined;

      let result: LSPResult;

      if (isSubprocess) {
        // 子进程：通过 IPC 调用
        result = await callThroughIPC(params, signal);
      } else {
        // 主进程：直接调用
        const { getLSPClientManager } = await import('../../lsp/index.js');
        const lspManager = getLSPClientManager();
        result = await lspManager.handleRequest({
          operation: params.operation,
          filePath: params.filePath,
          line: params.line,
          character: params.character,
        });
      }

      if (!result.success) {
        return {
          success: false,
          content: [{ type: 'text', text: `LSP Error: ${result.error}` }],
          error: result.error,
        };
      }

      const formattedResult = formatResult(params.operation, result.data);

      return {
        success: true,
        content: [{ type: 'text', text: formattedResult }],
        details: {
          operation: params.operation,
          filePath: params.filePath,
          durationMs: result.durationMs,
        },
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{ type: 'text', text: `LSP Error: ${message}` }],
        error: message,
      };
    }
  },
};

export type { LSPParams };