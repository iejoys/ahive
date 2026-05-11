/**
 * AHIVECORE 工具系统
 * 
 * 工具调用机制：
 * - AgentTool 接口 definition 工具
 * - 工具调用提取 (从 LLM 响应提取 tool_calls)
 * - 工具执行和结果标准化
 * 
 * 支持两种模式：
 * 1. 原生 Function Calling (API Providers: OpenAI, DeepSeek, etc.)
 * 2. Prompt-Based Tool Calling (本地 GGUF 模型)
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from '../utils/index.js';

// ============ 核心类型定义 ============

/**
 * 工具参数 Schema 类型
 */
export type ToolParameters = z.ZodType<any>;

/**
 * 工具更新回调
 */
export type ToolUpdateCallback<T = unknown> = (update: T) => void;

/**
 * 工具调用请求
 */
export interface ToolCallRequest {
  /** 工具调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean;
  /** 结果内容 */
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
    source?: { type: string; media_type: string; data: string };
  }>;
  /** 详细信息 */
  details?: unknown;
  /** 错误信息 */
  error?: string;
}

/**
 * 工具定义
 * 
 * 参考 OpenClaw 的 AgentTool 接口
 */
export interface AgentTool<T = unknown, D = unknown> {
  /** 工具名称 */
  name: string;
  /** 显示标签 */
  label?: string;
  /** 工具描述 */
  description: string;
  /** 参数 Schema (Zod 或 JSON Schema) */
  parameters: ToolParameters;
  /** 执行函数 */
  execute: (
    toolCallId: string,
    params: T,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback<D>
  ) => Promise<ToolResult | D>;
}

/**
 * 工具定义 (OpenAI 格式)
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

/**
 * LLM 响应中的工具调用块
 */
export interface ToolCallBlock {
  type: 'toolCall' | 'toolUse' | 'functionCall';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * LLM 消息
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'toolResult';
  content: string | Array<ToolCallBlock | { type: 'text'; text: string }>;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
}

// ============ 工具结果标准化 ============

/**
 * 将任意结果标准化为 ToolResult
 */
export function normalizeToolResult(
  toolName: string,
  result: unknown
): ToolResult {
  // 已经是标准格式
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      return result as ToolResult;
    }
  }

  // 字符串结果
  if (typeof result === 'string') {
    return {
      success: true,
      content: [{ type: 'text', text: result }],
    };
  }

  // 对象结果，转为 JSON
  const text = stringifyPayload(result);
  return {
    success: true,
    content: [{ type: 'text', text }],
    details: result,
  };
}

/**
 * 创建错误结果
 */
export function errorResult(toolName: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);

  // 🔧 改进：更详细的错误信息，帮助 LLM 理解问题
  let errorText = `❌ 工具执行失败: ${toolName}\n\n`;
  errorText += `**错误信息**: ${message}\n\n`;

  // 根据工具类型和错误类型给出建议
  if (message.includes('ENOENT') || message.includes('no such file')) {
    errorText += `**建议**: 文件或目录不存在，请检查路径是否正确，或使用 Glob/list_dir 探索正确的位置。`;
  } else if (message.includes('EACCES') || message.includes('permission')) {
    errorText += `**建议**: 权限不足，请尝试其他操作或检查文件权限。`;
  } else if (message.includes('ripgrep')) {
    errorText += `**建议**: 搜索工具出错，请检查搜索模式和路径是否正确。`;
  } else {
    errorText += `**建议**: 请检查参数是否正确，或尝试其他方法完成任务。`;
  }

  return {
    success: false,
    content: [{ type: 'text', text: errorText }],
    error: message,
  };
}

/**
 * 将载荷转为字符串
 */
function stringifyPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    const encoded = JSON.stringify(payload, null, 2);
    return typeof encoded === 'string' ? encoded : String(payload);
  } catch {
    return String(payload);
  }
}

// ============ 工具调用提取 ============

const TOOL_CALL_TYPES = new Set(['toolCall', 'toolUse', 'functionCall']);

/**
 * 从 LLM 助手消息中提取工具调用
 * 
 * 参考 OpenClaw 的 extractToolCallsFromAssistant
 */
export function extractToolCallsFromAssistant(
  message: LLMMessage
): ToolCallRequest[] {
  const { content } = message;

  // 直接有 toolCalls 字段
  if (message.toolCalls && message.toolCalls.length > 0) {
    return message.toolCalls;
  }

  // 内容是数组，提取工具调用块
  if (Array.isArray(content)) {
    const toolCalls: ToolCallRequest[] = [];

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;

      const rec = block as { type?: string; id?: string; name?: string; input?: unknown };

      if (typeof rec.id === 'string' && rec.id &&
        typeof rec.type === 'string' && TOOL_CALL_TYPES.has(rec.type)) {
        toolCalls.push({
          id: rec.id,
          name: typeof rec.name === 'string' ? rec.name : 'unknown',
          arguments: typeof rec.input === 'object' && rec.input !== null
            ? rec.input as Record<string, unknown>
            : {},
        });
      }
    }

    return toolCalls;
  }

  return [];
}

/**
 * 从文本响应中提取 JSON 格式的工具调用
 * 
 * 用于不支持原生 Function Calling 的模型
 */
export function extractToolCallsFromText(response: string): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];

  logger.debug(`[ToolSystem] extractToolCallsFromText 输入长度: ${response.length}`);

  // 模式 1: [TOOL]{...}[/TOOL] 格式 - 使用手动解析处理嵌套JSON
  const startMarker = '[TOOL]';
  const endMarker = '[/TOOL]';
  let searchPos = 0;

  while (true) {
    const startPos = response.indexOf(startMarker, searchPos);
    if (startPos === -1) break;

    const jsonStart = startPos + startMarker.length;
    const jsonEnd = findMatchingBrace(response, jsonStart);

    if (jsonEnd !== -1) {
      const jsonStr = response.slice(jsonStart, jsonEnd + 1).trim();
      if (jsonStr && jsonStr !== '{}') {
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.name && typeof parsed.name === 'string') {
            toolCalls.push({
              id: `tc_${randomUUID().slice(0, 8)}`,
              name: parsed.name,
              arguments: parsed.arguments || parsed.params || {},
            });
          }
        } catch (e) {
          logger.warn(`[ToolSystem] 工具调用 JSON 解析失败: ${jsonStr.substring(0, 100)}`);
        }
      }
    }

    // 移动到 endMarker 之后继续搜索
    const endPos = response.indexOf(endMarker, jsonStart);
    searchPos = endPos !== -1 ? endPos + endMarker.length : jsonStart + 1;
  }

  // 模式 2: ```tool ... ``` 代码块格式 - 使用手动解析
  const codeBlockStart = '```tool\n';
  const codeBlockEnd = '\n```';
  searchPos = 0;

  while (true) {
    const startPos = response.indexOf(codeBlockStart, searchPos);
    if (startPos === -1) break;

    const jsonStart = startPos + codeBlockStart.length;
    const jsonEnd = findMatchingBrace(response, jsonStart);

    if (jsonEnd !== -1) {
      const jsonStr = response.slice(jsonStart, jsonEnd + 1).trim();
      if (jsonStr && jsonStr !== '{}' && jsonStr.startsWith('{')) {
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.name && typeof parsed.name === 'string') {
            toolCalls.push({
              id: `tc_${randomUUID().slice(0, 8)}`,
              name: parsed.name,
              arguments: parsed.arguments || parsed.params || {},
            });
          }
        } catch (e) {
          logger.warn(`[ToolSystem] 工具调用代码块解析失败: ${jsonStr.substring(0, 100)}`);
        }
      }
    }

    // 移动到代码块结束标记之后继续搜索
    const endPos = response.indexOf(codeBlockEnd, jsonStart);
    searchPos = endPos !== -1 ? endPos + codeBlockEnd.length : jsonStart + 1;
  }

  // 模式 2.5: ```python 代码块中提取工具调用
  const pythonBlockPattern = /```python\s*\n([\s\S]*?)```/gi;
  let pyBlockMatch;
  while ((pyBlockMatch = pythonBlockPattern.exec(response)) !== null) {
    const blockContent = pyBlockMatch[1];
    // 从 Python 代码块中提取函数调用
    const pyFuncPattern = /([a-z_]+)\s*\(([^)]*)\)/gi;
    let funcMatch;
    while ((funcMatch = pyFuncPattern.exec(blockContent)) !== null) {
      const funcName = funcMatch[1].toLowerCase();
      const argsStr = funcMatch[2];

      // 跳过已知非工具函数
      const skipNames = ['print', 'len', 'str', 'int', 'float', 'list', 'dict', 'range', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'open', 'close', 'read', 'write'];
      if (skipNames.includes(funcName)) continue;

      // 解析参数
      const args: Record<string, unknown> = {};
      const argPattern = /([a-z_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,)]+)/gi;
      let argMatch;
      while ((argMatch = argPattern.exec(argsStr)) !== null) {
        const key = argMatch[1];
        let value = argMatch[2].trim();

        // 移除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
          // 处理转义字符
          value = value.replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\');
        }

        args[key] = value;
      }

      // 只添加有有效参数的调用
      if (Object.keys(args).length > 0 && !toolCalls.some(tc => tc.name === funcName)) {
        logger.info(`[ToolSystem] 从 Python 代码块提取工具调用: ${funcName}`);
        toolCalls.push({
          id: `tc_${randomUUID().slice(0, 8)}`,
          name: funcName,
          arguments: args,
        });
      }
    }
  }

  // 模式 3: Python 风格函数调用 - write_file(path="...", content="...")
  const pythonFuncPattern = /([a-z_]+)\s*\(([^)]*)\)/gi;
  let pyMatch;
  while ((pyMatch = pythonFuncPattern.exec(response)) !== null) {
    const funcName = pyMatch[1].toLowerCase();
    const argsStr = pyMatch[2];

    logger.debug(`[ToolSystem] 检测到 Python 风格调用: ${funcName}(${argsStr.substring(0, 50)}...)`);

    // 跳过已知非工具函数
    const skipNames = ['print', 'len', 'str', 'int', 'float', 'list', 'dict', 'range', 'if', 'for', 'while', 'def', 'class', 'return', 'import', 'from', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr'];
    if (skipNames.includes(funcName)) continue;

    // 解析参数
    const args: Record<string, unknown> = {};
    const argPattern = /([a-z_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,)]+)/gi;
    let argMatch;
    while ((argMatch = argPattern.exec(argsStr)) !== null) {
      const key = argMatch[1];
      let value = argMatch[2].trim();

      // 移除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
        // 处理转义字符
        value = value.replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\');
      }

      args[key] = value;
    }

    // 只添加有有效参数的调用
    if (Object.keys(args).length > 0 && !toolCalls.some(tc => tc.name === funcName)) {
      logger.info(`[ToolSystem] 提取 Python 风格工具调用: ${funcName} args=${JSON.stringify(args).substring(0, 100)}`);
      toolCalls.push({
        id: `tc_${randomUUID().slice(0, 8)}`,
        name: funcName,
        arguments: args,
      });
    }
  }

  logger.info(`[ToolSystem] extractToolCallsFromText 返回 ${toolCalls.length} 个工具调用`);
  return toolCalls;
}

/**
 * 查找匹配的闭合大括号
 * 正确处理嵌套JSON对象
 */
function findMatchingBrace(str: string, start: number): number {
  if (str[start] !== '{') return -1;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }

  return -1;
}

/**
 * 执行工具调用循环
 * 参考 CODEX 的 run_turn 循环：
 * 1. 模型输出工具调用
 * 2. 执行工具
 * 3. 将工具结果反馈给模型
 * 4. 模型继续生成（可能还有更多工具调用）
 * 5. 重复直到模型不再输出工具调用
 */
export async function executeToolLoop(
  llmService: {
    chat: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, config?: any) => Promise<{
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      finishReason?: string;
    }>;
  },
  registry: ToolRegistry,
  options: {
    systemPrompt: string;
    userMessage: string;
    sessionMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    modelConfig?: any;
    maxIterations?: number;
    onToolStart?: (name: string, args: Record<string, unknown>) => void;
    onToolEnd?: (name: string, result: string, success: boolean) => void;
  }
): Promise<{
  content: string;
  iterations: number;
  toolCallsExecuted: number;
}> {
  const maxIterations = options.maxIterations ?? 10;
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: options.systemPrompt },
    ...(options.sessionMessages || []),
    { role: 'user', content: options.userMessage },
  ];

  let iterations = 0;
  let totalToolCalls = 0;
  let lastContent = '';

  while (iterations < maxIterations) {
    iterations++;
    logger.info(`[ToolLoop] 迭代 ${iterations}/${maxIterations}`);

    // 调用 LLM
    const response = await llmService.chat(messages, options.modelConfig);
    lastContent = response.content;

    // 收集工具调用
    const toolCalls: ToolCallRequest[] = [];

    // 1. 原生 tool_calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        toolCalls.push({
          id: tc.id || `tc_${randomUUID().slice(0, 8)}`,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    }

    // 2. 从文本中提取工具调用
    const textToolCalls = extractToolCallsFromText(response.content);
    toolCalls.push(...textToolCalls);

    // 3. 支持 shell: command 格式
    const shellPattern = /^(shell|exec):\s*(.+?)(?:\n|$)/gm;
    let match;
    while ((match = shellPattern.exec(response.content)) !== null) {
      const cmd = match[2].trim();
      if (cmd) {
        toolCalls.push({
          id: `tc_${randomUUID().slice(0, 8)}`,
          name: 'exec',
          arguments: { command: cmd },
        });
      }
    }

    // 没有工具调用，返回结果
    if (toolCalls.length === 0) {
      logger.info(`[ToolLoop] 无工具调用，完成执行`);
      break;
    }

    logger.info(`[ToolLoop] 检测到 ${toolCalls.length} 个工具调用`);
    totalToolCalls += toolCalls.length;

    // 将助手消息添加到历史
    messages.push({ role: 'assistant', content: response.content });

    // 执行工具调用
    for (const call of toolCalls) {
      const tool = registry.get(call.name);

      if (!tool) {
        logger.warn(`[ToolLoop] 工具不存在: ${call.name}`);
        const errorMsg = `工具 ${call.name} 不存在`;
        messages.push({
          role: 'user',
          content: `[工具结果] ${call.name}: 错误 - ${errorMsg}`,
        });
        continue;
      }

      try {
        options.onToolStart?.(call.name, call.arguments);
        logger.info(`[ToolLoop] 执行工具: ${call.name}`);

        const result = await tool.execute(call.id, call.arguments);

        // 标准化结果
        let resultText: string;
        let resultImages: Array<{ data: string; mimeType: string }> | undefined;
        if (result && typeof result === 'object' && 'content' in result) {
          const content = (result as any).content;
          if (Array.isArray(content)) {
            const textParts: string[] = [];
            const images: Array<{ data: string; mimeType: string }> = [];
            for (const c of content) {
              if (c.type === 'image' && c.data && c.mimeType) {
                images.push({ data: c.data, mimeType: c.mimeType });
                textParts.push(`[图片: ${c.mimeType}, ${Math.round(c.data.length * 0.75 / 1024)}KB]`);
              } else if (c.text) {
                textParts.push(c.text);
              }
            }
            resultText = textParts.join('\n') || '(空结果)';
            resultImages = images.length > 0 ? images : undefined;
          } else {
            resultText = String(content);
          }
        } else {
          resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        }

        const success = result && typeof result === 'object' ? (result as any).success !== false : true;
        options.onToolEnd?.(call.name, resultText, success);

        // 将工具结果添加到消息历史
        const textContent = `[工具结果] ${call.name}:\n${resultText}`;
        if (resultImages && resultImages.length > 0) {
          const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
            { type: 'text', text: textContent },
          ];
          for (const img of resultImages) {
            parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
          }
          messages.push({ role: 'user', content: parts as any });
        } else {
          messages.push({ role: 'user', content: textContent });
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[ToolLoop] 工具执行失败: ${call.name}`, error);
        options.onToolEnd?.(call.name, errorMsg, false);

        messages.push({
          role: 'user',
          content: `[工具结果] ${call.name}: 错误 - ${errorMsg}`,
        });
      }
    }
  }

  return {
    content: lastContent,
    iterations,
    toolCallsExecuted: totalToolCalls,
  };
}

// ============ 工具注册中心 ============

/**
 * 工具注册中心
 */
export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  /**
   * 注册工具
   */
  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
    logger.debug(`[ToolRegistry] 注册工具: ${tool.name}`);
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取工具
   */
  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具名称列表
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 执行工具
   */
  async execute(
    toolCall: ToolCallRequest,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);

    if (!tool) {
      return errorResult(toolCall.name, `Tool not found: ${toolCall.name}`);
    }

    try {
      // 验证参数
      const params = toolCall.arguments;

      // 执行工具
      const result = await tool.execute(toolCall.id, params, signal);

      // 标准化结果
      return normalizeToolResult(toolCall.name, result);
    } catch (error) {
      logger.error(`[ToolRegistry] 工具执行失败: ${toolCall.name}`, error);
      return errorResult(toolCall.name, error);
    }
  }

  /**
   * 批量执行工具
   */
  async executeAll(
    toolCalls: ToolCallRequest[],
    signal?: AbortSignal
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();

    for (const call of toolCalls) {
      const result = await this.execute(call, signal);
      results.set(call.id, result);
    }

    return results;
  }

  /**
   * 转换为 OpenAI 工具定义格式
   */
  toOpenAITools(): ToolDefinition[] {
    return this.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJSONSchema(tool.parameters),
      },
    }));
  }
}

// ============ Zod → JSON Schema 转换 ============

/**
 * 将 Zod Schema 转换为 JSON Schema
 */
export function zodToJSONSchema(schema: z.ZodType): ToolDefinition['function']['parameters'] {
  const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {};
  const required: string[] = [];

  // 处理 ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodTypeToJSONSchema(value as z.ZodType);

      // 检查是否可选
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

function zodTypeToJSONSchema(schema: z.ZodType): { type: string; description?: string; enum?: string[] } {
  // ZodOptional
  if (schema instanceof z.ZodOptional) {
    return zodTypeToJSONSchema(schema.unwrap());
  }

  // ZodDefault
  if (schema instanceof z.ZodDefault) {
    return zodTypeToJSONSchema(schema.removeDefault());
  }

  // ZodString
  if (schema instanceof z.ZodString) {
    return { type: 'string', description: schema.description };
  }

  // ZodNumber
  if (schema instanceof z.ZodNumber) {
    return { type: 'number', description: schema.description };
  }

  // ZodBoolean
  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', description: schema.description };
  }

  // ZodEnum
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options, description: schema.description };
  }

  // ZodArray
  if (schema instanceof z.ZodArray) {
    return { type: 'array', description: schema.description };
  }

  // ZodObject
  if (schema instanceof z.ZodObject) {
    return { type: 'object', description: schema.description };
  }

  // 默认
  return { type: 'string' };
}

// ============ 全局实例 ============

let globalRegistry: ToolRegistry | null = null;

/**
 * 获取全局工具注册中心
 */
export function getGlobalToolRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry();
  }
  return globalRegistry;
}

/**
 * 初始化全局工具注册中心
 */
export function initToolRegistry(tools: AgentTool[]): ToolRegistry {
  globalRegistry = new ToolRegistry();
  globalRegistry.registerAll(tools);
  return globalRegistry;
}

// ============ 工具调用循环 ============

/**
 * 工具调用循环配置
 */
export interface ToolLoopConfig {
  /** 最大工具调用轮次 */
  maxRounds: number;
  /** 是否在工具执行后继续对话 */
  continueAfterTool: boolean;
  /** 工具执行超时 (ms) */
  toolTimeout: number;
}

const DEFAULT_TOOL_LOOP_CONFIG: ToolLoopConfig = {
  maxRounds: 5,
  continueAfterTool: true,
  toolTimeout: 60000,
};

/**
 * 工具调用循环执行器
 */
export class ToolLoopExecutor {
  private registry: ToolRegistry;
  private config: ToolLoopConfig;

  constructor(registry: ToolRegistry, config?: Partial<ToolLoopConfig>) {
    this.registry = registry;
    this.config = { ...DEFAULT_TOOL_LOOP_CONFIG, ...config };
  }

  /**
   * 执行工具调用循环
   * 
   * @param initialResponse 初始 LLM 响应
   * @param llmCaller LLM 调用函数 (用于工具执行后继续对话)
   * @param onToolStart 工具开始回调
   * @param onToolEnd 工具结束回调
   */
  async execute(
    initialResponse: string | LLMMessage,
    llmCaller: (messages: LLMMessage[]) => Promise<string | LLMMessage>,
    onToolStart?: (toolCall: ToolCallRequest) => void,
    onToolEnd?: (toolCall: ToolCallRequest, result: ToolResult) => void
  ): Promise<{ finalResponse: string; toolCallsExecuted: number }> {
    let currentResponse = initialResponse;
    let rounds = 0;
    let totalToolCalls = 0;

    while (rounds < this.config.maxRounds) {
      // 提取工具调用
      const toolCalls = typeof currentResponse === 'string'
        ? extractToolCallsFromText(currentResponse)
        : extractToolCallsFromAssistant(currentResponse);

      // 没有工具调用，结束循环
      if (toolCalls.length === 0) {
        break;
      }

      rounds++;
      totalToolCalls += toolCalls.length;

      // 执行所有工具
      const toolResults: Array<{ call: ToolCallRequest; result: ToolResult }> = [];

      for (const call of toolCalls) {
        onToolStart?.(call);

        const result = await this.registry.execute(call);
        toolResults.push({ call, result });

        onToolEnd?.(call, result);
      }

      // 如果不需要继续对话，返回工具结果
      if (!this.config.continueAfterTool) {
        const resultText = toolResults.map(({ call, result }) => {
          const text = result.content.map(c => {
            if (c.type === 'image' && c.data && c.mimeType) return `[图片: ${c.mimeType}, ${Math.round(c.data.length * 0.75 / 1024)}KB]`;
            return c.text || '';
          }).join('\n');
          return `[${result.success ? '✅' : '❌'} ${call.name}]\n${text}`;
        }).join('\n\n');

        return { finalResponse: resultText, toolCallsExecuted: totalToolCalls };
      }

      // 构建工具结果消息，继续调用 LLM
      const toolResultMessages: LLMMessage[] = toolResults.map(({ call, result }) => {
        const hasImages = result.content.some(c => c.type === 'image' && c.data && c.mimeType);
        if (hasImages) {
          const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
          for (const c of result.content) {
            if (c.type === 'image' && c.data && c.mimeType) {
              parts.push({ type: 'image_url', image_url: { url: `data:${c.mimeType};base64,${c.data}` } });
            } else if (c.text) {
              parts.push({ type: 'text', text: c.text });
            }
          }
          return { role: 'toolResult' as const, content: parts as any, toolCallId: call.id };
        }
        return { role: 'toolResult' as const, content: result.content.map(c => c.text || '').join('\n'), toolCallId: call.id };
      });

      // 调用 LLM 继续对话
      currentResponse = await llmCaller(toolResultMessages);
    }

    // 返回最终响应
    const finalText = typeof currentResponse === 'string'
      ? currentResponse
      : typeof currentResponse.content === 'string'
        ? currentResponse.content
        : currentResponse.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n');

    return { finalResponse: finalText, toolCallsExecuted: totalToolCalls };
  }
}

// ============ Prompt-Based Tool Calling 支持 ============

/**
 * 生成工具调用提示词
 *
 * 用于不支持原生 Function Calling 的模型
 */
export function generateToolCallingPrompt(tools: AgentTool[]): string {
  const toolDescriptions = tools.map(tool => {
    const params = zodToJSONSchema(tool.parameters);
    const paramList = Object.entries(params.properties || {})
      .map(([name, schema]) => {
        const req = params.required?.includes(name) ? '(必填)' : '(可选)';
        return `  - ${name}: ${schema.type} ${req} - ${schema.description || ''}`;
      })
      .join('\n');

    return `### ${tool.name}
${tool.description}
参数:
${paramList || '  无'}`;
  }).join('\n\n');

  return `## 可用工具

你可以使用以下工具来执行操作。当你需要调用工具时，请使用以下格式：

\`\`\`tool
{
  "name": "工具名称",
  "arguments": {
    "参数名": "参数值"
  }
}
\`\`\`

${toolDescriptions}

## 工具使用规则

1. 只有需要执行操作时才调用工具，普通对话不需要
2. 一次可以调用多个工具，每个工具调用单独一个代码块
3. 调用工具后，我会告诉你执行结果，你可以继续对话
4. 确保参数类型正确，字符串用引号，数字不加引号

## 搜索工具最佳实践

**⚠️ 重要：禁止使用 exec/shell 命令进行搜索**

- 找文件名 → 使用 **Glob** 工具（不要用 \`find\`、\`dir\`、\`ls -R\`）
- 找文件内容 → 使用 **Grep** 工具（不要用 \`grep\`、\`rg\`、\`Select-String\`）
- Glob 和 Grep 使用 ripgrep 引擎，速度快 10-100 倍
- 它们自动尊重 .gitignore，避免搜索 node_modules 等

**工具选择决策树：**

\`\`\`
需要搜索？
├─ 按文件名找 → Glob (pattern: "*.ts")
├─ 按内容找 → Grep (pattern: "keyword")
│   ├─ 需要匹配行内容 → output_mode: "content"
│   ├─ 只需要文件列表 → output_mode: "files_with_matches"
│   └─ 需要统计次数 → output_mode: "count"
└─ 复杂多轮搜索 → spawn_agent
\`\`\`
`;
}

/**
 * 从响应中移除工具调用标记
 */
export function removeToolCallMarkers(response: string): string {
  return response
    .replace(/\[TOOL\]\{[\s\S]*?\}\[\/TOOL\]/g, '')
    .replace(/```tool\n[\s\S]*?\n```/g, '')
    .trim();
}

// ============ MCP 工具集成 ============

/**
 * 将 JSON Schema 转换为 Zod Schema (简易版)
 */
export function convertSchemaToZod(jsonSchema: any): z.ZodType<any> {
  if (!jsonSchema) return z.any();

  if (jsonSchema.type === 'object') {
    const shape: any = {};
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];

    for (const [key, prop] of Object.entries(properties)) {
      let zType: any;
      const p = prop as any;

      switch (p.type) {
        case 'string':
          zType = z.string();
          break;
        case 'number':
        case 'integer':
          zType = z.number();
          if (p.type === 'integer') zType = zType.int();
          break;
        case 'boolean':
          zType = z.boolean();
          break;
        case 'array':
          zType = z.array(z.any());
          break;
        default:
          zType = z.any();
      }

      if (p.description) {
        zType = zType.describe(p.description);
      }

      if (!required.includes(key)) {
        zType = zType.optional();
      }

      shape[key] = zType;
    }

    return z.object(shape);
  }

  return z.any();
}

/**
 * 将 MCP 工具注册到指定注册表
 */
export function registerMCPTools(
  serverId: string,
  tools: any[],
  registry: ToolRegistry,
  mcpManager: any
): void {
  for (const tool of tools) {
    // 强制使用 mcp_ 前缀避免冲突
    const toolName = tool.name.startsWith('mcp_') ? tool.name : `mcp_${tool.name}`;

    registry.register({
      name: toolName,
      description: `[MCP] ${tool.description}`,
      parameters: convertSchemaToZod(tool.inputSchema),
      execute: async (id, params) => {
        logger.info(`[ToolSystem] 执行 MCP 工具: ${serverId}/${tool.name}`);
        try {
          const result = await mcpManager.callTool(serverId, tool.name, params);
          return normalizeToolResult(toolName, result);
        } catch (error) {
          logger.error(`[ToolSystem] MCP 工具执行失败: ${error}`);
          return errorResult(toolName, error);
        }
      }
    });
  }

  logger.info(`[ToolSystem] 已注册来自 ${serverId} 的 ${tools.length} 个 MCP 工具`);
}