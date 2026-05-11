/**
 * AHIVECORE 内置工具定义
 *
 * 遵循 OpenClaw 的 AgentTool 接口
 */

import { z } from 'zod';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { AgentTool, ToolResult, ToolParameters } from './tool-system.js';
import { normalizeToolResult, errorResult } from './tool-system.js';
import { logger } from '../utils/index.js';
import {
  readOptimizedFile,
  TokenLimitExceededError,
  FileTooLargeError,
} from './file-reader-optimized.js';
import { getFileStateTracker } from './file-state-tracker.js';
import { webSearchTool } from './web-search.js';
// ASTA 已移除

// ============ 截断配置（参考 CODEX）============

/** 命令输出最大字节数：1 MB */
const EXEC_OUTPUT_MAX_BYTES = 1024 * 1024;

/** 默认输出 token 限制：10K */
const DEFAULT_MAX_OUTPUT_TOKENS = 10000;

// ============ Shell 执行工具 ============

const ExecParamsSchema = z.object({
  command: z.string().describe('要执行的 Shell 命令'),
  workdir: z.string().optional().describe('工作目录'),
  timeout: z.number().optional().default(60000).describe('超时时间 (ms)'),
  shell: z.enum(['cmd', 'powershell', 'bash']).optional().describe('Shell 类型 (Windows: cmd/powershell, Unix: bash)'),
});

export const execTool: AgentTool<z.infer<typeof ExecParamsSchema>> = {
  name: 'exec',
  label: 'exec',
  description: `Runs a shell command and returns its output.

Parameters:
- command: The shell command to execute
- workdir: The working directory to execute the command in
- timeout: Timeout in milliseconds (default: 60000)
- shell: Shell type - 'cmd', 'powershell' (Windows), 'bash' (Unix). Default: powershell on Windows, bash on Unix.

Notes:
- Always set the workdir param when using the exec function. Do not use 'cd' unless absolutely necessary.
- Output is truncated if exceeds 1MB (preserves head and tail).
- For long-running processes (like dev servers), use the process tool instead.

Windows CMD examples (shell='cmd'):
- List files: "dir"
- Find by name: "dir /s *.py"
- Grep: "findstr /s TODO *.py"

Windows PowerShell examples (shell='powershell' - default):
- List files: "Get-ChildItem -Force" or "ls -Force"
- Find by name: "Get-ChildItem -Recurse -Filter *.py"
- Grep: "Get-ChildItem -Recurse | Select-String -Pattern 'TODO'"

Unix examples:
- List files: "ls -la"
- Find by name: "find . -name '*.py'"
- Grep: "grep -r 'TODO' ."`,
  parameters: ExecParamsSchema,

  async execute(toolCallId, params, signal) {
    const { command, workdir, timeout = 60000, shell } = params;
    const startTime = Date.now();

    try {
      const result = await runShellCommand(command, {
        cwd: workdir,
        timeout,
        signal,
        shellType: shell,
      });

      // 使用新的截断策略（参考 CODEX）
      let stdout = result.stdout || '';
      let stderr = result.stderr || '';
      let truncated = false;

      if (stdout.length > EXEC_OUTPUT_MAX_BYTES) {
        stdout = truncateOutput(stdout, EXEC_OUTPUT_MAX_BYTES);
        truncated = true;
      }
      if (stderr.length > EXEC_OUTPUT_MAX_BYTES) {
        stderr = truncateOutput(stderr, EXEC_OUTPUT_MAX_BYTES);
        truncated = true;
      }

      return {
        success: result.exitCode === 0,
        content: [{
          type: 'text' as const,
          text: stdout || stderr || '(no output)',
        }],
        details: {
          exitCode: result.exitCode,
          duration: Date.now() - startTime,
          truncated,
        },
      };
    } catch (error) {
      return errorResult('exec', error);
    }
  },
};

/**
 * 截断输出
 * 保留头尾，中间用省略标记替换
 */
function truncateOutput(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) {
    return text;
  }

  const totalLines = text.split('\n').length;
  const halfBytes = Math.floor(maxBytes / 2);
  const prefix = text.slice(0, halfBytes);
  const suffix = text.slice(-halfBytes);
  const removedBytes = text.length - maxBytes;
  const removedTokens = Math.ceil(removedBytes / 4);

  return `Total output lines: ${totalLines}\n\n${prefix}\n\n…${removedTokens} tokens truncated (${removedBytes} bytes)…\n\n${suffix}`;
}

async function runShellCommand(
  command: string,
  options: { cwd?: string; timeout: number; signal?: AbortSignal; shellType?: 'cmd' | 'powershell' | 'bash' }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';

    // 根据参数或平台选择 Shell
    let shell: string;
    let shellArgs: string[];

    if (options.shellType) {
      // 用户指定了 shell 类型
      if (options.shellType === 'powershell') {
        shell = 'powershell.exe';
        shellArgs = ['-Command', command];
      } else if (options.shellType === 'cmd') {
        shell = 'cmd.exe';
        shellArgs = ['/c', command];
      } else {
        shell = '/bin/bash';
        shellArgs = ['-c', command];
      }
    } else {
      // 默认：Windows 用 PowerShell，Unix 用 bash
      if (isWindows) {
        shell = 'powershell.exe';
        shellArgs = ['-Command', command];
      } else {
        shell = '/bin/bash';
        shellArgs = ['-c', command];
      }
    }

    const proc = spawn(shell, shellArgs, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let exited = false;

    const safeKill = () => {
      if (isWindows) {
        const tk = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
        tk.on('error', () => {
          // taskkill 失败（可能不在 PATH 中）时做保守降级
          proc.kill('SIGKILL');
        });
      } else {
        proc.kill('SIGKILL');
      }
    };

    // 超时处理
    if (options.timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!exited) {
          exited = true;
          safeKill();

          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim() + '\n⏱️ Command timed out after ' + (options.timeout / 1000) + 's',
            exitCode: -1,
          });
        }
      }, options.timeout);
    }

    // 中断信号处理
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (!exited) {
          exited = true;
          safeKill();

          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim() + '\nCommand aborted',
            exitCode: -1,
          });
        }
      });
    }

    proc.stdout.on('data', (data) => {
      // 内存保护：限制硬截断长度的两倍，防止 cargo 等工具产生的无限输出把 Node 撑爆(OOM)
      if (stdout.length < EXEC_OUTPUT_MAX_BYTES * 2) {
        stdout += data.toString();
      }
    });

    proc.stderr.on('data', (data) => {
      if (stderr.length < EXEC_OUTPUT_MAX_BYTES * 2) {
        stderr += data.toString();
      }
    });

    proc.on('close', (code) => {
      if (exited) return;  // 已经被超时/中断处理了
      exited = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? -1,
      });
    });

    proc.on('error', (err) => {
      if (exited) return;
      exited = true;
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });
  });
}

// ============ 文件读取工具（优化版）============

const ReadFileParamsSchema = z.object({
  path: z.string().describe('文件路径'),
  encoding: z.enum(['utf-8', 'binary', 'base64']).optional().default('utf-8').describe('编码方式'),
  offset: z.number().optional().describe('起始行号（1-indexed）'),
  limit: z.number().optional().describe('最大读取行数'),
});

export const readFileTool: AgentTool<z.infer<typeof ReadFileParamsSchema>> = {
  name: 'read_file',
  label: 'read file',
  description: `Reads a local file with 1-indexed line numbers, supporting slice and indentation-aware block modes.

Parameters:
- path: Absolute path to the file
- encoding: Optional encoding (utf-8, binary, base64). Defaults to utf-8.
- offset: The line number to start reading from. Must be 1 or greater.
- limit: The maximum number of lines to return.

Notes:
- Maximum output: 25000 tokens, 256KB
- Smart caching: re-reading same file/range returns unchanged marker
- Large files (>10MB) use streaming to avoid memory issues
- For very large files, use offset/limit to read in segments`,
  parameters: ReadFileParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      // 检查取消信号
      if (signal?.aborted) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: '⚠️ 操作已取消' }],
        };
      }

      // 使用优化版读取器
      const result = await readOptimizedFile(params.path, {
        startLine: params.offset,
        lineLimit: params.limit,
        maxTokens: 25000,
        maxBytes: 256 * 1024,
        addLineNumbers: true,
        enableDedup: params.encoding === 'utf-8', // 只有 utf-8 模式启用去重
        encoding: params.encoding,
        signal,
      });

      // 处理缓存命中 - 返回实际内容而不是标记
      // 注：缓存命中只意味着内容相同，LLM 仍然需要知道实际内容
      if (result.cacheHit) {
        logger.debug(`[read_file] 缓存命中：${params.path}`);
        // 继续返回实际内容，让 LLM 了解文件内容
      }

      // 处理错误
      if (!result.success) {
        // 🔧 改进：更明确的错误信息，帮助 LLM 理解问题并调整策略
        let errorMessage = `❌ 文件读取失败\n\n`;
        errorMessage += `**路径**: \`${params.path}\`\n`;
        errorMessage += `**错误**: ${result.error}\n\n`;

        // 根据错误类型给出具体建议
        if (result.error?.includes('ENOENT') || result.error?.includes('no such file')) {
          errorMessage += `**建议**: 文件不存在，请：\n`;
          errorMessage += `1. 检查路径是否正确\n`;
          errorMessage += `2. 使用 Glob 工具搜索类似文件名\n`;
          errorMessage += `3. 使用 list_dir 查看目录结构\n`;
        } else if (result.error?.includes('EACCES') || result.error?.includes('permission')) {
          errorMessage += `**建议**: 没有访问权限，请尝试其他文件或目录`;
        } else if (result.error?.includes('EISDIR')) {
          errorMessage += `**建议**: 这是一个目录，不是文件。请使用 list_dir 查看目录内容`;
        }

        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: errorMessage,
          }],
        };
      }

      // 构建输出
      let text = result.content;

      // 添加截断提示（仅文本模式）
      if (result.truncated && !result.isBinary) {
        text += `\n\n... (文件共 ${result.totalLines} 行，已读取第 ${params.offset ?? 1}-${(params.offset ?? 1) + result.linesRead - 1} 行)`;
      }

      // 二进制模式提示
      if (result.isBinary) {
        const encodingHint = params.encoding === 'base64'
          ? 'Base64 encoded'
          : 'Hex encoded';
        text = `[${encodingHint} binary data, ${result.totalBytes} bytes]\n\n${text}`;
      }

      // 记录读取状态（用于 write_file 的安全检查）
      const fileTracker = getFileStateTracker();
      fileTracker.recordRead(result.absolutePath, result.totalBytes > 0 ? Date.now() : 0, result.totalBytes);

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text,
        }],
        details: {
          path: result.absolutePath,
          linesRead: result.linesRead,
          totalLines: result.totalLines,
          bytesRead: result.bytesRead,
          totalBytes: result.totalBytes,
          estimatedTokens: result.estimatedTokens,
          truncated: result.truncated,
          encoding: params.encoding,
          isBinary: result.isBinary,
        },
      };

    } catch (error) {
      // 处理 Token 超限
      if (error instanceof TokenLimitExceededError) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `⚠️ 文件内容过大 (${error.actualTokens} tokens)，超过 ${error.maxTokens} tokens 限制。\n\n建议：使用 offset/limit 参数分段读取。`,
          }],
        };
      }

      // 处理文件过大
      if (error instanceof FileTooLargeError) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `⚠️ 文件过大 (${(error.actualBytes / 1024 / 1024).toFixed(2)}MB)，超过限制。\n\n建议：使用 offset/limit 参数分段读取。`,
          }],
        };
      }

      // 处理取消
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: '⚠️ 操作已取消' }],
        };
      }

      return errorResult('read_file', error);
    }
  },
};

// ============ 文件写入工具（优化版，参考 CC）============

const WriteFileParamsSchema = z.object({
  path: z.string().describe('文件路径'),
  content: z.string().describe('文件内容'),
  mode: z.enum(['write', 'append']).optional().default('write').describe('写入模式: write=覆盖, append=追加'),
  mkdir: z.boolean().optional().default(true).describe('是否自动创建目录'),
  encoding: z.enum(['utf-8', 'binary', 'base64']).optional().default('utf-8').describe('编码方式'),
});

export const writeFileTool: AgentTool<z.infer<typeof WriteFileParamsSchema>> = {
  name: 'write_file',
  label: 'write file',
  description: `Write content to a file. Use this tool to CREATE new files or COMPLETELY REWRITE existing files.

**When to use write_file vs apply_patch:**
- Use write_file to CREATE a new file that does not yet exist
- Use write_file to COMPLETELY REWRITE a file (rare — prefer apply_patch for partial edits)
- Use apply_patch for MODIFYING existing files — it sends only the diff, which is safer and more efficient
- Do NOT use write_file to make small edits to existing files — use apply_patch instead

**Safety:**
- For existing files, you MUST read the file first with read_file. This tool will error if you attempt to overwrite without reading.
- After writing, the system tracks the file state — no need to re-read the file to confirm the write.

**Parameters:**
- path: Absolute path to the file
- content: The complete content to write
- mode: "write" (default) overwrites the file; "append" adds content to the end of the file
- mkdir: Whether to automatically create parent directories (default: true)
- encoding: Encoding mode — "utf-8" (default), "binary", or "base64"

**Append mode:**
- Only send the NEW content to append, not the existing file content
- Example: to add a line to a log file, use mode="append" with content="new log line"

**Important:**
- This tool sends the ENTIRE file content. For editing existing files, apply_patch is preferred because it sends only the changed portion, reducing token usage and the risk of accidentally overwriting unrelated content.
- Never use write_file to make a small change to a large file — the token cost is proportional to the entire file size.`,
  parameters: WriteFileParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      const resolvedPath = path.resolve(params.path);
      const fileTracker = getFileStateTracker();

      // 检查文件是否存在
      let fileExists = false;
      try {
        const existingStats = await fs.stat(resolvedPath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      // 安全检查：现有文件必须先读取
      if (fileExists && !fileTracker.hasReadFile(resolvedPath)) {
        // 检查是否是 append 模式（append 模式不需要先读）
        if (params.mode !== 'append') {
          return {
            success: false,
            content: [{
              type: 'text' as const,
              text: `⚠️ 文件已存在但未先读取。请先使用 read_file 读取 "${resolvedPath}"，然后再写入。\n\n这可以防止意外覆盖文件内容。`,
            }],
            details: {
              path: resolvedPath,
              error: 'MUST_READ_FIRST',
              fileExists: true,
            },
          };
        }
      }

      // 创建目录
      if (params.mkdir) {
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });
      }

      // 写入文件（根据模式选择写入方式）
      if (params.mode === 'append' && fileExists) {
        // Append 模式：追加到文件末尾
        await fs.appendFile(resolvedPath, params.content, params.encoding || 'utf-8');
      } else {
        // Write 模式：覆盖文件
        await fs.writeFile(resolvedPath, params.content, params.encoding || 'utf-8');
      }

      // 获取写入后的文件信息
      const stats = await fs.stat(resolvedPath);

      // 记录写入状态
      fileTracker.recordWrite(resolvedPath, stats.mtimeMs, stats.size);

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `[工具结果] 文件已写入: ${resolvedPath} (${stats.size} 字节)`,
        }],
        details: {
          path: resolvedPath,
          size: stats.size,
          mtime: stats.mtime,
          mode: params.mode,
          isNewFile: !fileExists,
        },
      };
    } catch (error) {
      return errorResult('write_file', error);
    }
  },
};

// ============ 目录列表工具 ============

const ListDirParamsSchema = z.object({
  path: z.string().describe('目录路径'),
  recursive: z.boolean().optional().default(false).describe('是否递归列出子目录'),
});

export const listDirTool: AgentTool<z.infer<typeof ListDirParamsSchema>> = {
  name: 'list_dir',
  label: 'list directory',
  description: `Lists entries in a local directory with 1-indexed entry numbers and simple type labels.

Parameters:
- path: Absolute path to the directory to list
- recursive: Whether to recursively list subdirectories (default: false)

Returns a list of entries with type labels (file/directory) and sizes.`,
  parameters: ListDirParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      const resolvedPath = path.resolve(params.path);
      const entries = await listDirectory(resolvedPath, params.recursive || false);

      const text = entries
        .map(e => `${e.type === 'directory' ? '📁' : '📄'} ${e.name} (${formatSize(e.size)})`)
        .join('\n');

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: text || '(empty directory)',
        }],
        details: {
          path: resolvedPath,
          entries,
          count: entries.length,
        },
      };
    } catch (error) {
      return errorResult('list_dir', error);
    }
  },
};

async function listDirectory(
  dirPath: string,
  recursive: boolean
): Promise<Array<{ name: string; type: 'file' | 'directory'; size: number }>> {
  const entries: Array<{ name: string; type: 'file' | 'directory'; size: number }> = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const stats = await fs.stat(fullPath);

    entries.push({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      size: stats.size,
    });

    if (recursive && item.isDirectory()) {
      const subEntries = await listDirectory(fullPath, true);
      for (const sub of subEntries) {
        entries.push({
          name: path.join(item.name, sub.name),
          type: sub.type,
          size: sub.size,
        });
      }
    }
  }

  return entries;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ============ 文件删除工具 ============

const DeleteParamsSchema = z.object({
  path: z.string().describe('文件或目录路径'),
  recursive: z.boolean().optional().default(false).describe('是否递归删除目录'),
});

export const deleteTool: AgentTool<z.infer<typeof DeleteParamsSchema>> = {
  name: 'delete',
  label: 'delete',
  description: '删除文件或目录。删除目录时需要设置 recursive=true。',
  parameters: DeleteParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      const resolvedPath = path.resolve(params.path);
      const stats = await fs.stat(resolvedPath);

      if (stats.isDirectory()) {
        await fs.rm(resolvedPath, { recursive: params.recursive, force: true });
      } else {
        await fs.unlink(resolvedPath);
      }

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `Deleted: ${resolvedPath}`,
        }],
        details: {
          path: resolvedPath,
          wasDirectory: stats.isDirectory(),
        },
      };
    } catch (error) {
      return errorResult('delete', error);
    }
  },
};

// ============ 时间工具 ============

export const getTimeTool: AgentTool<Record<string, never>> = {
  name: 'get_time',
  label: 'get current time',
  description: '获取当前日期和时间。',
  parameters: z.object({}),

  async execute(toolCallId, params, signal) {
    const now = new Date();

    return {
      success: true,
      content: [{
        type: 'text' as const,
        text: `当前时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\nISO: ${now.toISOString()}`,
      }],
      details: {
        iso: now.toISOString(),
        local: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        timestamp: now.getTime(),
      },
    };
  },
};

// ============ 系统信息工具 ============

export const getSystemInfoTool: AgentTool<Record<string, never>> = {
  name: 'get_system_info',
  label: 'get system info',
  description: '获取系统信息，包括平台、架构、内存使用等。',
  parameters: z.object({}),

  async execute(toolCallId, params, signal) {
    const mem = process.memoryUsage();

    return {
      success: true,
      content: [{
        type: 'text' as const,
        text: `平台: ${process.platform}\n架构: ${process.arch}\nNode.js: ${process.version}\n内存: ${formatSize(mem.heapUsed)} / ${formatSize(mem.heapTotal)}`,
      }],
      details: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        uptime: process.uptime(),
        memory: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          rss: mem.rss,
        },
      },
    };
  },
};

// ============ 文件编辑工具 ============

const EditFileParamsSchema = z.object({
  path: z.string().describe('文件路径'),
  oldContent: z.string().describe('要替换的内容'),
  newContent: z.string().describe('替换后的内容'),
});

export const editFileTool: AgentTool<z.infer<typeof EditFileParamsSchema>> = {
  name: 'edit_file',
  label: 'edit file',
  description: `Find and replace text in a file. This is a simpler alternative to apply_patch for single replacements.

**Prerequisites:**
- You MUST read the file with read_file before editing to see the exact current content.

**Parameters:**
- path: Absolute path to the file
- oldContent: The exact text to find (must match file content exactly, including indentation)
- newContent: The text to replace it with

**Behavior:**
- Replaces the FIRST occurrence of oldContent with newContent
- Fails if oldContent is not found in the file
- Fails if oldContent appears multiple times (ambiguous — use apply_patch with replace_all instead)

**When to use edit_file vs apply_patch:**
- Use edit_file for simple, single replacements where the old content is clearly unique
- Use apply_patch for complex edits, multiple replacements, or when you need replace_all

**Important:**
- Preserve exact indentation from the file — do not add or remove leading spaces/tabs
- The oldContent must be unique in the file — if it appears multiple times, the replacement is ambiguous`,
  parameters: EditFileParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      const resolvedPath = path.resolve(params.path);
      let content = await fs.readFile(resolvedPath, 'utf-8');

      // 检查是否存在要替换的内容
      if (!content.includes(params.oldContent)) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `未找到要替换的内容`,
          }],
          error: 'Old content not found',
        };
      }

      // 替换内容
      const newContent = content.replace(params.oldContent, params.newContent);
      await fs.writeFile(resolvedPath, newContent, 'utf-8');

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `文件已更新: ${resolvedPath}`,
        }],
        details: {
          path: resolvedPath,
          replaced: true,
        },
      };
    } catch (error) {
      return errorResult('edit_file', error);
    }
  },
};

// ============ 目录创建工具 ============

const MkdirParamsSchema = z.object({
  path: z.string().describe('目录路径'),
});

export const mkdirTool: AgentTool<z.infer<typeof MkdirParamsSchema>> = {
  name: 'mkdir',
  label: 'make directory',
  description: '创建目录。会自动创建所有不存在的父目录。',
  parameters: MkdirParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      const resolvedPath = path.resolve(params.path);
      await fs.mkdir(resolvedPath, { recursive: true });

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `目录已创建: ${resolvedPath}`,
        }],
        details: {
          path: resolvedPath,
        },
      };
    } catch (error) {
      return errorResult('mkdir', error);
    }
  },
};

// ============ 多智能体工具 ============

/**
 * 智能体控制器接口
 * 由外部注入，提供多智能体管理能力
 */
let agentController: {
  spawnAgent(parentId: string, options: {
    message?: string;
    role?: string;
    model?: Partial<{ name: string; provider: string }>;
    forkHistory?: boolean;
  }): Promise<string>;
  waitAgent(agentId: string, timeout?: number): Promise<{ status: string; content?: string; error?: string }>;
  terminateAgent(agentId: string): void;
  getMainAgentId(): string | null;
  getActiveAgent(): string | null;
  getAllStatus(): Promise<Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>>;
  sendTo(fromId: string, toId: string, content: string, type?: string, metadata?: Record<string, unknown>): void;
  sendAndWait(fromId: string, toId: string, content: string, type?: string, timeout?: number, metadata?: Record<string, unknown>): Promise<{ success: boolean; content?: string; error?: string; metadata?: Record<string, unknown> }>;
  getConcurrencyStatus(): { active: number; max: number; available: number };
  getConcurrencyStatusAsync(): Promise<{ active: number; max: number; available: number }>;
  createMainAgent(type?: 'ahive-worker' | 'ahive-coder'): string;
} | null = null;

/**
 * 设置智能体控制器
 */
export function setAgentController(controller: typeof agentController): void {
  agentController = controller;
}

// spawn_agent 参数 Schema
const SpawnAgentParamsSchema = z.object({
  message: z.string().optional().describe('Initial plain-text task for the new agent. Use either message or provide a clear task description.'),
  role: z.string().optional().describe('Optional agent type/role (e.g., worker, analyzer, coder). This determines the agent\'s behavior and capabilities.'),
  model: z.string().optional().describe('Optional model name override for the new agent. Replaces the inherited model. Only use models available in your current provider. If omitted, the child agent inherits the parent agent\'s model. Do NOT guess model names - only use models you know are available.'),
  fork_history: z.boolean().optional().default(false).describe('When true, fork the current thread history into the new agent before sending the initial prompt. This must be used when you want the new agent to have exactly the same context as you.'),
});

/**
 * spawn_agent 工具
 * 
 * 完整参考 CODEX 官方实现 (codex-rs/core/src/tools/spec.rs:1089-1137)
 */
export const spawnAgentTool: AgentTool<z.infer<typeof SpawnAgentParamsSchema>> = {
  name: 'spawn_agent',
  label: 'spawn agent',
  description: `Only use \`spawn_agent\` if and only if the user explicitly asks for sub-agents, delegation, or parallel agent work.
Requests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn.
Agent-role guidance below only helps choose which agent to use after spawning is already authorized; it never authorizes spawning by itself.

Spawn a sub-agent for a well-scoped task. Returns the agent id (and user-facing nickname when available) to use to communicate with this agent. This spawn_agent tool provides you access to smaller but more efficient sub-agents. A mini model can solve many tasks faster than the main model. You should follow the rules and guidelines below to use this tool.

### When to delegate vs. do the subtask yourself
- First, quickly analyze the overall user task and form a succinct high-level plan. Identify which tasks are immediate blockers on the critical path, and which tasks are sidecar tasks that are needed but can run in parallel without blocking the next local step. As part of that plan, explicitly decide what immediate task you should do locally right now. Do this planning step before delegating to agents so you do not hand off the immediate blocking task to a submodel and then waste time waiting on it.
- Use the smaller subagent when a subtask is easy enough for it to handle and can run in parallel with your local work. Prefer delegating concrete, bounded sidecar tasks that materially advance the main task without blocking your immediate next local step.
- Do not delegate urgent blocking work when your immediate next step depends on that result. If the very next action is blocked on that task, the main rollout should usually do it locally to keep the critical path moving.
- Keep work local when the subtask is too difficult to delegate well and when it is tightly coupled, urgent, or likely to block your immediate next step.

### Designing delegated subtasks
- Subtasks must be concrete, well-defined, and self-contained.
- Delegated subtasks must materially advance the main task.
- Do not duplicate work between the main rollout and delegated subtasks.
- Avoid issuing multiple delegate calls on the same unresolved thread unless the new delegated task is genuinely different and necessary.
- Narrow the delegated ask to the concrete output you need next.
- For coding tasks, prefer delegating concrete code-change worker subtasks over read-only explorer analysis when the subagent can make a bounded patch in a clear write scope.
- When delegating coding work, instruct the submodel to edit files directly in its forked workspace and list the file paths it changed in the final answer.
- For code-edit subtasks, decompose work so each delegated task has a disjoint write set.

### After you delegate
- Call wait_agent very sparingly. Only call wait_agent when you need the result immediately for the next critical-path step and you are blocked until it returns.
- Do not redo delegated subagent tasks yourself; focus on integrating results or tackling non-overlapping work.
- While the subagent is running in the background, do meaningful non-overlapping work immediately.
- Do not repeatedly wait by reflex.
- When a delegated coding task returns, quickly review the uploaded changes, then integrate or refine them.

### Parallel delegation patterns
- Run multiple independent information-seeking subtasks in parallel when you have distinct questions that can be answered independently.
- Split implementation into disjoint codebase slices and spawn multiple agents for them in parallel when the write scopes do not overlap.
- Delegate verification only when it can run in parallel with ongoing implementation and is likely to catch a concrete risk before final integration.
- The key is to find opportunities to spawn multiple independent subtasks in parallel within the same round, while ensuring each subtask is well-defined, self-contained, and materially advances the main task.

### Limits
- Maximum 6 child agents per parent agent.
- Maximum 3 concurrent spawns to avoid API rate limits.
- Child agents auto-terminate after completion.`,
  parameters: SpawnAgentParamsSchema,

  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    const mainAgentId = agentController.getMainAgentId();
    if (!mainAgentId) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'No main agent exists' }],
      };
    }

    // 🔧 修复：使用异步方法获取真实的并发状态
    const concurrency = await agentController.getConcurrencyStatusAsync();
    if (concurrency.available <= 0) {
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `⚠️ 分身数量已达上限 (${concurrency.active}/${concurrency.max})\n请等待现有分身完成任务后再试。`,
        }],
      };
    }

    try {
      const childId = await agentController.spawnAgent(mainAgentId, {
        message: params.message,
        role: params.role,
        model: params.model ? { name: params.model } : undefined,
        forkHistory: params.fork_history,
      });

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 分身已创建
ID: ${childId}
角色: ${params.role || 'worker'}
模型: ${params.model || '继承父级'}
继承历史: ${params.fork_history ? '是' : '否'}
任务: ${params.message.substring(0, 100)}...

并发状态: ${concurrency.active + 1}/${concurrency.max}

使用 wait_agent("${childId}") 等待结果。`,
        }],
        details: {
          agentId: childId,
          role: params.role || 'worker',
          model: params.model,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{ type: 'text' as const, text: `❌ 创建分身失败: ${message}` }],
      };
    }
  },
};

// wait_agent 参数 Schema
const WaitAgentParamsSchema = z.object({
  id: z.string().optional().describe('单个智能体 ID'),
  ids: z.array(z.string()).optional().describe('多个智能体 ID 列表'),
  timeout_ms: z.number().optional().default(120000).describe('超时时间（毫秒），默认 120 秒'),
  auto_terminate: z.boolean().optional().default(true).describe('完成后是否自动终止分身'),
});

/**
 * wait_agent 工具
 * 等待子智能体完成任务
 */
export const waitAgentTool: AgentTool<z.infer<typeof WaitAgentParamsSchema>> = {
  name: 'wait_agent',
  label: 'wait agent',
  description: `Wait for agents to reach a final status. Completed statuses may include the agent's final message. Returns empty status when timed out. Once the agent reaches a final status, a notification message will be received containing the same completed status.

Parameters:
- id: Single agent ID to wait for
- ids: List of agent IDs to wait for
- auto_terminate: Whether to auto-terminate agents after completion (default: true)

Important:
- Call wait_agent very sparingly. Only call wait_agent when you need the result immediately for the next critical-path step and you are blocked until it returns.
- Do not redo delegated subagent tasks yourself; focus on integrating results or tackling non-overlapping work.
- While the subagent is running in the background, do meaningful non-overlapping work immediately.
- Do not repeatedly wait by reflex.`,
  parameters: WaitAgentParamsSchema,

  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    // 整合 ID 列表
    const agentIds: string[] = [];
    if (params.id) agentIds.push(params.id);
    if (params.ids) agentIds.push(...params.ids);

    if (agentIds.length === 0) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: '请提供 id 或 ids 参数' }],
      };
    }

    const results: Array<{ id: string; status: string; content?: string }> = [];

    for (const agentId of agentIds) {
      try {
        const result = await agentController.waitAgent(agentId, params.timeout_ms);
        results.push({
          id: agentId,
          status: result.status,
          content: result.content || result.error,
        });

        // 自动终止
        if (params.auto_terminate !== false && result.status === 'completed') {
          agentController.terminateAgent(agentId);
        }
      } catch (error) {
        results.push({
          id: agentId,
          status: 'error',
          content: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const text = results.map(r => {
      const statusIcon = r.status === 'completed' ? '✅' : r.status === 'error' ? '❌' : '⏳';
      // 使用新的截断策略（参考 CODEX：保留头尾）
      const truncatedContent = r.content
        ? (r.content.length > EXEC_OUTPUT_MAX_BYTES
          ? truncateOutput(r.content, EXEC_OUTPUT_MAX_BYTES)
          : r.content)
        : '';
      return `${statusIcon} ${r.id}\n状态: ${r.status}\n${truncatedContent ? `结果: ${truncatedContent}` : ''}`;
    }).join('\n\n');

    const allCompleted = results.every(r => r.status === 'completed');
    const concurrency = agentController.getConcurrencyStatus();

    return {
      success: allCompleted,
      content: [{
        type: 'text' as const,
        text: `${text}\n\n📊 并发状态: ${concurrency.active}/${concurrency.max}`,
      }],
      details: { results, concurrency },
    };
  },
};

// ============ 智能体列表工具 ============

const ListAgentsParamsSchema = z.object({
  search: z.string().optional().describe('搜索关键词（能力、专长）'),
});

export const listAgentsTool: AgentTool<z.infer<typeof ListAgentsParamsSchema>> = {
  name: 'list_agents',
  label: 'list available agents',
  description: `列出系统中所有可通讯的智能体，或搜索特定能力的智能体。

返回每个智能体的：
- ID 和昵称
- 类型（ahive-worker / ahive-coder）
- 状态（idle / busy）
- 能力和专长

示例：
- 列出所有: list_agents()
- 搜索前端: list_agents({ search: "前端" })
- 搜索美术: list_agents({ search: "美术" })`,
  parameters: ListAgentsParamsSchema,

  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    try {
      const allStatus = await agentController.getAllStatus();
      const currentAgentId = agentController.getActiveAgent();

      // 导入 CORE 和 WEBOT 固定 ID
      const { CORE_AGENT_ID } = await import('../core/ahivecore.js');
      const WEBOT_AGENT_ID = 'ahive-webot';

      const agents = [];

      // 首先添加 CORE 智能体（系统指挥官），始终在第一位
      const coreExists = allStatus.has(CORE_AGENT_ID);
      if (!coreExists) {
        // CORE 不在进程列表中，手动添加
        agents.push({
          id: CORE_AGENT_ID,
          nickname: 'AHIVECORE',
          type: 'core',
          status: 'idle',
          role: 'system-core',
          roleName: '系统指挥官',
          roleDescription: '系统核心智能体，负责工作流编排和智能体协调',
          isSelf: currentAgentId === CORE_AGENT_ID,
          isCore: true,
        });
      }

      // 🆕 添加 WEBOT 智能体（企业微信智能体），始终在第二位
      const webotExists = allStatus.has(WEBOT_AGENT_ID);
      if (!webotExists) {
        // WEBOT 不在进程列表中，手动添加
        agents.push({
          id: WEBOT_AGENT_ID,
          nickname: '企业微信智能体',
          type: 'webot',
          status: 'idle',
          role: 'webot',
          roleName: '企业微信智能体',
          roleDescription: '企业微信消息转发智能体，负责将消息推送到企业微信用户',
          isSelf: currentAgentId === WEBOT_AGENT_ID,
          isCore: false,
        });
      }

      // 添加其他智能体
      for (const [id, status] of allStatus) {
        // 跳过 CORE（已经添加）
        if (id === CORE_AGENT_ID) {
          agents.unshift({
            id,
            nickname: status.nickname || 'AHIVECORE',
            type: status.type,
            status: status.status,
            role: status.role || 'worker',
            roleName: status.role === 'system-core' ? '系统指挥官' : (status.role === 'main' ? '主智能体' : '工作智能体'),
            roleDescription: status.role === 'system-core' ? '系统核心智能体，负责工作流编排和智能体协调' : undefined,
            isSelf: id === currentAgentId,
            isCore: id === CORE_AGENT_ID,
          });
          continue;
        }

        const agentInfo = {
          id,
          nickname: status.nickname || id.slice(0, 8),
          type: status.type,
          status: status.status,
          role: status.role || 'worker',
          roleName: status.role === 'main' ? '主智能体' : '工作智能体',
          roleDescription: undefined,
          isSelf: id === currentAgentId,
          isCore: false,
        };

        // 如果有搜索关键词，过滤
        if (params.search) {
          const keyword = params.search.toLowerCase();
          const matchNickname = agentInfo.nickname.toLowerCase().includes(keyword);
          const matchType = agentInfo.type.toLowerCase().includes(keyword);
          const matchRole = agentInfo.role.toLowerCase().includes(keyword);

          if (!matchNickname && !matchType && !matchRole) {
            continue;
          }
        }

        agents.push(agentInfo);
      }

      if (agents.length === 0) {
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: params.search
              ? `没有找到匹配 "${params.search}" 的智能体`
              : '当前没有智能体',
          }],
        };
      }

      const text = agents.map(a => {
        const selfMarker = a.isSelf ? ' 👈 [自己]' : '';
        const coreMarker = a.isCore ? ' ⭐' : '';
        const roleTag = a.roleName ? ` [${a.roleName}]` : '';

        // 状态文字
        let statusText = '空闲';
        if (a.status === 'busy') statusText = '忙碌';
        else if (a.status === 'error') statusText = '错误';
        else if (a.status === 'offline') statusText = '离线';

        let line = `${coreMarker} ${a.nickname} (${a.type}) [${statusText}]${roleTag}${selfMarker}\n   ID: ${a.id}`;

        // 如果有角色描述，添加到输出
        if (a.roleDescription) {
          line += `\n   📋 ${a.roleDescription}`;
        }

        return line;
      }).join('\n');

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `📋 系统中有 ${agents.length} 个智能体${params.search ? ` (搜索: ${params.search})` : ''}：\n\n${text}\n\n💡 使用 send_message(nickname, message) 发送消息`,
        }],
        details: { agents, search: params.search },
      };
    } catch (error) {
      return errorResult('list_agents', error);
    }
  },
};

// ============ 智能体通讯工具 ============

const SendMessageParamsSchema = z.object({
  to_agent: z.string().describe('目标智能体 ID 或昵称'),
  message: z.string().describe('消息内容'),
  type: z.enum(['task', 'query', 'response']).optional().default('task').describe('消息类型'),
  wait_reply: z.boolean().optional().default(true).describe('是否等待回复（默认 true）'),
  timeout_ms: z.number().optional().default(60000).describe('等待回复超时时间（毫秒），默认 60 秒'),
});

export const sendMessageTool: AgentTool<z.infer<typeof SendMessageParamsSchema>> = {
  name: 'send_message',
  label: 'send message to agent',
  description: `Send a message to another agent. Use for:
- Cross-agent collaboration
- Requesting help from other agents
- Replying to messages

Parameters:
- to_agent: Target agent ID or nickname
- message: Message content
- type: Message type (task/query/response)
- wait_reply: Whether to wait for reply (default true)
- timeout_ms: Wait timeout in ms (default 60000)

### Agent Types

| Type | Role | Capabilities |
|------|------|-------------|
| codex-frontend | Frontend Dev | React, Vue, CSS, UI/UX |
| codex-backend | Backend Dev | Node.js, Python, API |
| codex-fullstack | Fullstack Dev | Frontend + Backend |
| openclaw-artist | Art Design | Image, UI, Visual |
| openclaw-audio | Audio | Music, SFX, Voiceover |

### Examples

User: "让前端开发帮我写个登录页面"
Response:
1. Call list_agents(search="前端") to find frontend agent
2. Call send_message(to_agent="codex-frontend", message="请实现登录页面", type="task")

User: "查看所有智能体状态"
Response: Call list_agents()

### Enterprise WeChat Integration

When you need to push messages to Enterprise WeChat users, send a message to the ahive-webot agent.

**Usage**:
\`\`\`
send_message({
  to_agent: "ahive-webot",
  message: "Message content to push",
  type: "task"
})
\`\`\`

**Reply Routing**: The message will automatically include a \`[FROM_AGENT: your_agent_id]\` tag. When the user replies, the response will be automatically routed back to your agent.

**Example**:
\`\`\`
send_message({
  to_agent: "ahive-webot",
  message: "文件修改已完成，请查看 src/app.ts"
})
\`\`\`

When user replies, you will receive:
\`\`\`
[REQID: xxx]
回复时请在开头保留: [REQID: xxx]

用户消息：
好的，谢谢！
\`\`\`

### Dispatch Principles

1. **Match by task type**: Choose the right agent for the task
2. **Parallel execution**: Independent tasks can be assigned to multiple agents in parallel
3. **Result integration**: Collect results from all agents and integrate before replying to user
4. **Resource management**: Terminate unneeded agents promptly

IMPORTANT - Loop Prevention Rules:
- This is agent-to-agent dialogue. Reply ONLY if necessary.
- If message is informational/notification, do NOT reply.
- If task is complete, send 'response' type and end conversation.
- Detect duplicate/similar content in recent messages → STOP conversation (loop prevention).
- Keep responses concise. No unnecessary content.`,
  parameters: SendMessageParamsSchema,

  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    try {
      // 查找目标智能体
      let targetId: string | null = null;
      const allStatus = await agentController.getAllStatus();

      // 查找优先级：1. 精确ID匹配  2. 昵称匹配  3. 类型匹配（选择第一个匹配的类型）
      for (const [id, status] of allStatus) {
        // 1. 精确 ID 匹配
        if (id === params.to_agent) {
          targetId = id;
          break;
        }
        // 2. 昵称匹配
        if (status.nickname === params.to_agent) {
          targetId = id;
          break;
        }
        // 3. 类型匹配（记录第一个匹配的）
        if (status.type === params.to_agent && !targetId) {
          targetId = id;
        }
      }

      // 如果还是找不到，使用原始值（可能会失败，但会给出明确的错误信息）
      if (!targetId) {
        targetId = params.to_agent;
      }

      const currentAgentId = agentController.getActiveAgent();
      if (!currentAgentId) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: 'No active agent' }],
        };
      }

      // 禁止自己给自己发消息
      if (targetId === currentAgentId) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 不能给自己发消息。当前智能体 ID: ${currentAgentId}`,
          }],
        };
      }

      // 检查是否支持等待回复
      const supportsWaitReply = typeof agentController.sendAndWait === 'function';

      // 🆕 从消息内容中提取 metadata（用于企业微信会话追踪）
      // 格式: [METADATA: {"chatId":"xxx","fromUser":"xxx",...}]
      let metadata: Record<string, unknown> | undefined = undefined;
      let cleanMessage = params.message;

      const metadataMatch = params.message.match(/\[METADATA:\s*(\{[\s\S]*?\})\s*\]/);
      if (metadataMatch) {
        try {
          metadata = JSON.parse(metadataMatch[1]);
          // 移除 metadata 标记，只保留实际消息内容
          cleanMessage = params.message.replace(/\[METADATA:\s*\{[\s\S]*?\}\s*\]\s*\n?/, '').trim();
          logger.info(`[send_message] 提取到 metadata: ${JSON.stringify(metadata)}`);
        } catch (e) {
          logger.warn(`[send_message] metadata 解析失败: ${e}`);
        }
      }

      // 添加回复指导提示词
      const replyGuidance = `[AGENT COMMUNICATION PROTOCOL]
• This is agent-to-agent dialogue. Reply ONLY if necessary.
• If message is informational/notification, do NOT reply.
• If task is complete, send 'response' type and end conversation.
• Detect duplicate/similar content → STOP conversation (loop prevention).
• Keep responses concise. No unnecessary content.
[END PROTOCOL]

`;
      const enhancedMessage = replyGuidance + cleanMessage;

      if (params.wait_reply !== false && supportsWaitReply) {
        // 等待回复模式
        const result = await agentController.sendAndWait(
          currentAgentId,
          targetId,
          enhancedMessage,
          params.type,
          params.timeout_ms,
          metadata  // 🆕 传递 metadata
        );

        if (result.success && result.content) {
          return {
            success: true,
            content: [{
              type: 'text' as const,
              text: `📨 收到 ${params.to_agent} 的回复：\n\n${result.content}`,
            }],
            details: { targetId, reply: result.content },
          };
        } else if (!result.success && result.error?.includes('超时')) {
          return {
            success: false,
            content: [{
              type: 'text' as const,
              text: `⏱️ 等待 ${params.to_agent} 回复超时 (${params.timeout_ms}ms)`,
            }],
          };
        } else {
          return {
            success: false,
            content: [{
              type: 'text' as const,
              text: `❌ 发送消息失败: ${result.error || '未知错误'}`,
            }],
          };
        }
      } else {
        // 不等待回复模式（或旧版本兼容）
        agentController.sendTo(currentAgentId, targetId, params.message, params.type, metadata);

        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `✅ 消息已发送给 ${params.to_agent}\n类型: ${params.type}\n内容: ${params.message.substring(0, 100)}...`,
          }],
        };
      }
    } catch (error) {
      return errorResult('send_message', error);
    }
  },
};

// ============ 后台进程工具 ============

import { getProcessManager } from './process-manager.js';

const ProcessParamsSchema = z.object({
  action: z.enum(['start', 'stop', 'poll', 'list']).describe('操作类型'),
  command: z.string().optional().describe('要执行的命令（start 时必填）'),
  sessionId: z.string().optional().describe('进程会话 ID（stop/poll 时必填）'),
  workdir: z.string().optional().describe('工作目录'),
});

export const processTool: AgentTool<z.infer<typeof ProcessParamsSchema>> = {
  name: 'process',
  label: 'manage background process',
  description: `管理后台进程。用于启动长时间运行的程序（如服务器）。

操作类型：
- start: 启动后台进程，返回 sessionId
- poll: 查询进程状态和输出
- stop: 停止进程
- list: 列出所有进程

示例：
- 启动服务器: { "action": "start", "command": "npm start", "workdir": "F:/project" }
- 查看输出: { "action": "poll", "sessionId": "xxx" }
- 停止进程: { "action": "stop", "sessionId": "xxx" }`,
  parameters: ProcessParamsSchema,

  async execute(toolCallId, params, signal) {
    const manager = getProcessManager();

    try {
      switch (params.action) {
        case 'start': {
          if (!params.command) {
            return {
              success: false,
              content: [{ type: 'text' as const, text: '错误: start 操作需要提供 command 参数' }],
            };
          }
          const result = await manager.start(params.command, { workdir: params.workdir });
          return {
            success: result.success,
            content: [{
              type: 'text' as const,
              text: result.success
                ? `✅ 后台进程已启动\nSession ID: ${result.sessionId}\n命令: ${params.command}`
                : `❌ 启动失败: ${result.output}`,
            }],
            details: result,
          };
        }

        case 'poll': {
          if (!params.sessionId) {
            return {
              success: false,
              content: [{ type: 'text' as const, text: '错误: poll 操作需要提供 sessionId 参数' }],
            };
          }
          const result = await manager.poll(params.sessionId);
          return {
            success: result.success,
            content: [{
              type: 'text' as const,
              text: `进程状态: ${result.status}\n${result.output || ''}`,
            }],
            details: result,
          };
        }

        case 'stop': {
          if (!params.sessionId) {
            return {
              success: false,
              content: [{ type: 'text' as const, text: '错误: stop 操作需要提供 sessionId 参数' }],
            };
          }
          const result = await manager.stop(params.sessionId);
          return {
            success: result.success,
            content: [{
              type: 'text' as const,
              text: result.success ? `✅ 进程已停止: ${params.sessionId}` : `❌ 停止失败: ${result.output}`,
            }],
            details: result,
          };
        }

        case 'list': {
          const list = await manager.list();
          const text = list.length === 0
            ? '当前没有运行中的后台进程'
            : list.map(p => `Session ID: ${p.sessionId}\n命令: ${p.output || ''}\n状态: ${p.status}${p.exitCode !== undefined ? `\n退出码: ${p.exitCode}` : ''}`).join('\n\n');
          return {
            success: true,
            content: [{ type: 'text' as const, text }],
            details: { processes: list },
          };
        }

        default:
          return {
            success: false,
            content: [{ type: 'text' as const, text: `未知操作: ${params.action}` }],
          };
      }
    } catch (error) {
      return errorResult('process', error);
    }
  },
};

// ============ 文件内容搜索工具 ============

const GrepFilesParamsSchema = z.object({
  pattern: z.string().describe('搜索的正则表达式模式'),
  path: z.string().optional().describe('搜索路径，默认当前目录'),
  include: z.string().optional().describe('文件名模式，如 *.ts'),
  max_results: z.number().optional().default(50).describe('最大结果数'),
});

export const grepFilesTool: AgentTool<z.infer<typeof GrepFilesParamsSchema>> = {
  name: 'grep_files',
  label: 'search file contents',
  description: `Finds files whose contents match the pattern and lists them by modification time.

Parameters:
- pattern: Regular expression pattern to search for
- path: Directory or file path to search. Defaults to the current working directory
- include: Optional glob that limits which files are searched (e.g., "*.ts" or "*.{ts,tsx}")
- max_results: Maximum number of results to return (default: 50)

Note: This is a content search tool. For finding files by name, use list_dir instead.`,
  parameters: GrepFilesParamsSchema,

  async execute(toolCallId, params, signal) {
    const startTime = Date.now();
    const TIMEOUT_MS = 30_000;
    const MAX_FILES = 500;

    try {
      const searchPath = params.path ? path.resolve(params.path) : process.cwd();

      let pattern: RegExp;
      try {
        pattern = new RegExp(params.pattern, 'i');
      } catch (e) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: `正则表达式错误: ${params.pattern}\n错误: ${e}` }],
        };
      }

      const results: Array<{ file: string; line: number; content: string }> = [];

      // 递归收集文件（不依赖 glob 包，避免版本兼容问题）
      const ignoreDirs = ['node_modules', '.git', 'dist', '.next', 'build', '.cache', 'coverage'];
      const files: string[] = [];

      async function collectFiles(dir: string, baseDir: string, depth: number): Promise<void> {
        if (depth > 10 || files.length >= MAX_FILES) return;

        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (files.length >= MAX_FILES) break;

            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);

            if (entry.isDirectory()) {
              if (!ignoreDirs.includes(entry.name)) {
                await collectFiles(fullPath, baseDir, depth + 1);
              }
            } else if (entry.isFile()) {
              // 根据 include 参数过滤文件
              if (params.include) {
                const includePattern = params.include.replace(/\*/g, '.*').replace(/\?/g, '.');
                const regex = new RegExp(includePattern, 'i');
                if (!regex.test(entry.name)) continue;
              }
              files.push(relativePath);
            }
          }
        } catch (e) {
          // 跳过无法访问的目录
        }
      }

      try {
        await collectFiles(searchPath, searchPath, 0);
      } catch (e) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: `文件搜索错误: ${e}` }],
        };
      }

      for (const file of files) {
        if (results.length >= params.max_results) break;
        if (Date.now() - startTime > TIMEOUT_MS) {
          results.push({
            file: '---',
            line: 0,
            content: `⏱️ 搜索超时，已搜索 ${results.length} 个结果`
          });
          break;
        }

        try {
          const fullPath = path.join(searchPath, file);
          const stat = await fs.stat(fullPath);
          if (stat.size > 1024 * 1024) continue;

          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length && results.length < params.max_results; i++) {
            if (pattern.test(lines[i])) {
              results.push({
                file,
                line: i + 1,
                content: lines[i].trim().slice(0, 200)
              });
            }
          }
        } catch (e) {
          // 跳过无法读取的文件
        }
      }

      const text = results.length === 0
        ? `未找到匹配 "${params.pattern}" 的内容 (搜索了 ${files.length} 个文件)`
        : results.map(r => r.file === '---' ? r.content : `${r.file}:${r.line}: ${r.content}`).join('\n');

      const duration = Date.now() - startTime;
      logger.info(`[grep_files] 完成: ${results.length} 个结果, ${files.length} 个文件, ${duration}ms`);

      return {
        success: true,
        content: [{ type: 'text' as const, text }],
        details: { count: results.length, pattern: params.pattern, filesSearched: files.length, duration },
      };
    } catch (error) {
      return errorResult('grep_files', error);
    }
  },
};

// ============ 精确补丁工具 ============

const ApplyPatchParamsSchema = z.object({
  path: z.string().describe('文件路径'),
  patch: z.string().describe('补丁内容（unified diff 格式或简单替换）'),
  expected_rejects: z.number().optional().default(0).describe('预期拒绝数'),
  replace_all: z.boolean().optional().default(false).describe('替换所有匹配项（默认只替换第一个）'),
});

/**
 * 规范化空白字符用于模糊匹配
 * 将多个空格/Tab压缩为单个空格，统一行尾
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')  // 统一行尾
    .replace(/\t/g, ' ')     // Tab转空格
    .replace(/[ \t]+/g, ' ') // 多空格压缩
    .trim();
}

/**
 * 查找匹配位置（支持模糊匹配）
 */
function findMatchPosition(original: string, search: string, fuzzy: boolean = true): { start: number; end: number; exact: boolean } | null {
  // 优先精确匹配
  const exactIndex = original.indexOf(search);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + search.length, exact: true };
  }

  // 模糊匹配（忽略空白差异）
  if (fuzzy) {
    const normalizedOriginal = normalizeWhitespace(original);
    const normalizedSearch = normalizeWhitespace(search);
    const fuzzyIndex = normalizedOriginal.indexOf(normalizedSearch);

    if (fuzzyIndex !== -1) {
      // 尝试定位原始字符串中的位置
      // 遍历原始字符串，找到空白字符相近的位置
      let origPos = 0;
      let normPos = 0;

      while (origPos < original.length && normPos < fuzzyIndex) {
        const char = original[origPos];
        if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
          // 空白字符，在规范化版本中可能被压缩
          origPos++;
          normPos++;
        } else {
          origPos++;
          normPos++;
        }
      }

      // 找到搜索内容在原始文本中的近似位置
      const start = origPos;
      // 计算结束位置（需要考虑原始长度）
      let end = start;
      let searchPos = 0;
      while (end < original.length && searchPos < search.length) {
        const origChar = original[end];
        const searchChar = search[searchPos];
        if (origChar === searchChar) {
          end++;
          searchPos++;
        } else if ((origChar === ' ' || origChar === '\t' || origChar === '\r') &&
          (searchChar === ' ' || searchChar === '\n')) {
          // 空白差异，继续
          end++;
          searchPos++;
        } else if (origChar === '\n' && searchChar !== '\n') {
          // 行尾差异
          end++;
        } else {
          break;
        }
      }

      return { start, end, exact: false };
    }
  }

  return null;
}

export const applyPatchTool: AgentTool<z.infer<typeof ApplyPatchParamsSchema>> = {
  name: 'apply_patch',
  label: 'apply patch to file',
  description: `Apply exact string replacements or patches to files. This is the PREFERRED tool for editing existing files — it sends only the diff, not the entire file.

**Prerequisites:**
- You MUST use read_file on the file before editing. This tool will error if you attempt an edit without reading the file first.
- When editing text from Read tool output, preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in old_string or new_string.

**When to use apply_patch vs write_file:**
- Use apply_patch for MODIFYING existing files (sends only the changed portion)
- Use write_file only for CREATING new files or COMPLETELY REWRITING a file
- ALWAYS prefer apply_patch over write_file for edits — it is safer, cheaper, and less error-prone

**Patch Format (SEARCH/REPLACE blocks):**
Use explicit search/replace blocks for maximum clarity and reliability:

\`\`\`
<<<<<<< SEARCH
exact content to find
=======
replacement content
>>>>>>> REPLACE
\`\`\`

Rules:
- The SEARCH block must match the file content EXACTLY (including indentation)
- The REPLACE block contains the new content
- Multiple SEARCH/REPLACE blocks can be combined in a single patch
- The edit will FAIL if the SEARCH content is not unique in the file

**Alternative Formats:**
1. Simple string replacement: patch = the old string to find (first match replaced)
2. Unified diff format: standard diff with @@ line numbers

**Context Strategy:**
- Include enough context to make the SEARCH block unique — usually 2-4 adjacent lines is sufficient
- Do NOT include 10+ lines of context when less uniquely identifies the target
- If 3 lines of context is insufficient to uniquely identify the code, include the enclosing function/class signature as an additional context line
- For repeated code blocks, use @@ to indicate the class or function:
  \`\`\`
  @@ class BaseClass
  @@   def method():
  <<<<<<< SEARCH
  -old_code
  +new_code
  >>>>>>> REPLACE
  \`\`\`

**Parameters:**
- path: Absolute path to the file
- patch: The patch content (SEARCH/REPLACE format, simple string, or unified diff)
- replace_all: Replace ALL occurrences instead of just the first (use for renaming variables)
- expected_rejects: Expected number of rejected hunks (default: 0)

**Examples:**

Example 1 — Simple edit with SEARCH/REPLACE:
\`\`\`
apply_patch({
  path: "src/app.ts",
  patch: \`<<<<<<< SEARCH
const oldName = 1
=======
const newName = 1
>>>>>>> REPLACE\`
})
\`\`\`

Example 2 — Rename a variable across the entire file:
\`\`\`
apply_patch({
  path: "src/utils.ts",
  patch: "oldVarName",
  replace_all: true
})
\`\`\`

Example 3 — Multiple edits in one patch:
\`\`\`
apply_patch({
  path: "src/app.ts",
  patch: \`<<<<<<< SEARCH
import { oldApi } from './api'
=======
import { newApi } from './api'
>>>>>>> REPLACE

<<<<<<< SEARCH
  return oldApi(data)
=======
  return newApi(data)
>>>>>>> REPLACE\`
})
\`\`\`

**Failure Recovery:**
If the patch fails to apply:
1. Re-read the file with read_file to see the current content
2. Check for whitespace differences (spaces vs tabs, CRLF vs LF)
3. Ensure the SEARCH block matches the file content EXACTLY
4. Use a smaller, more targeted SEARCH block that is unique in the file`,
  parameters: ApplyPatchParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      const resolvedPath = path.resolve(params.path);

      if (!await fs.stat(resolvedPath).then(() => true).catch(() => false)) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: `文件不存在: ${resolvedPath}` }],
        };
      }

      const original = await fs.readFile(resolvedPath, 'utf-8');

      // 统一补丁内容的行尾格式（支持 \r\n 和 \n）
      const normalizedPatch = params.patch.replace(/\r\n/g, '\n');

      // 解析简单替换格式（支持多种行尾）
      const simplePatchMatch = normalizedPatch.match(/<<<<<<< SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>> REPLACE/);

      let result: string;
      let applied = false;
      let matchCount = 0;
      let fuzzyMatch = false;

      if (simplePatchMatch) {
        const search = simplePatchMatch[1];
        const replace = simplePatchMatch[2];

        // 尝试匹配
        const match = findMatchPosition(original, search, true);

        if (match) {
          fuzzyMatch = !match.exact;
          if (params.replace_all) {
            // 替换所有匹配项
            let currentResult = original;
            let matchResult = findMatchPosition(currentResult, search, true);
            while (matchResult) {
              currentResult = currentResult.slice(0, matchResult.start) + replace + currentResult.slice(matchResult.end);
              matchCount++;
              matchResult = findMatchPosition(currentResult.slice(matchResult.start + replace.length), search, true);
              if (matchResult) {
                matchResult.start += matchResult.start + replace.length;
                matchResult.end += matchResult.end + replace.length;
              }
            }
            result = currentResult;
            applied = matchCount > 0;
          } else {
            // 只替换第一个
            result = original.slice(0, match.start) + replace + original.slice(match.end);
            applied = true;
            matchCount = 1;
          }
        } else {
          // 生成详细的错误信息
          const searchPreview = search.slice(0, 200);
          const originalPreview = original.slice(0, 500);
          return {
            success: false,
            content: [{
              type: 'text' as const,
              text: `❌ 未找到匹配内容

**搜索内容** (前200字符):
\`\`\`
${searchPreview}
\`\`\`

**文件内容** (前500字符):
\`\`\`
${originalPreview}
\`\`\`

**建议**:
1. 检查文件路径是否正确
2. 确认搜索内容与文件中的实际内容一致
3. 注意空白字符差异（空格 vs Tab）
4. 使用 read_file 先查看文件内容`
            }],
          };
        }
      } else {
        // 尝试作为简单查找替换
        const lines = normalizedPatch.split('\n');
        if (lines.length >= 2) {
          const searchLine = lines[0];
          const replaceLine = lines.slice(1).join('\n');

          const match = findMatchPosition(original, searchLine, true);
          if (match) {
            fuzzyMatch = !match.exact;
            if (params.replace_all) {
              result = original.split(searchLine).join(replaceLine);
              matchCount = original.split(searchLine).length - 1;
            } else {
              result = original.slice(0, match.start) + replaceLine + original.slice(match.end);
              matchCount = 1;
            }
            applied = true;
          } else {
            result = original;
          }
        } else {
          result = original;
        }
      }

      if (applied) {
        await fs.writeFile(resolvedPath, result, 'utf-8');
        const matchInfo = fuzzyMatch ? '（模糊匹配，忽略空白差异）' : '';
        const countInfo = matchCount > 1 ? `，共替换 ${matchCount} 处` : '';
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `✅ 补丁已应用到 ${resolvedPath}${matchInfo}${countInfo}`
          }],
        };
      } else {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 补丁未能应用，文件内容可能已更改

**建议**:
1. 使用 read_file 先读取文件当前内容
2. 确认补丁中的 SEARCH 内容与文件实际内容一致
3. 注意行尾差异 (Windows \\r\\n vs Unix \\n)
4. 注意缩进差异 (空格 vs Tab)`
          }],
        };
      }
    } catch (error) {
      return errorResult('apply_patch', error);
    }
  },
};

// ============ 请求用户输入工具 ============

const RequestUserInputParamsSchema = z.object({
  message: z.string().describe('提示用户的消息'),
  default_value: z.string().optional().describe('默认值'),
});

export const requestUserInputTool: AgentTool<z.infer<typeof RequestUserInputParamsSchema>> = {
  name: 'request_user_input',
  label: 'request user input',
  description: `请求用户输入。用于需要用户确认或提供信息的场景。

参数：
- message: 提示消息
- default_value: 默认值（可选）

返回用户输入或默认值。`,
  parameters: RequestUserInputParamsSchema,

  async execute(toolCallId, params, signal) {
    // 在流式对话中，直接返回默认值或提示
    return {
      success: true,
      content: [{
        type: 'text' as const,
        text: params.default_value
          ? `用户输入: ${params.default_value}（默认值）`
          : `请提供: ${params.message}`,
      }],
      requiresUserInput: true,
      userInputPrompt: params.message,
      defaultValue: params.default_value,
    };
  },
};

// ============ 图片查看工具 ============

const ViewImageParamsSchema = z.object({
  path: z.string().describe('图片文件路径'),
});

export const viewImageTool: AgentTool<z.infer<typeof ViewImageParamsSchema>> = {
  name: 'view_image',
  label: 'view image file',
  description: `查看图片文件。返回图片的 base64 编码和基本信息。

支持格式：png, jpg, jpeg, gif, webp, bmp`,
  parameters: ViewImageParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      const resolvedPath = path.resolve(params.path);
      const stats = await fs.stat(resolvedPath);

      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
      };

      const mimeType = mimeTypes[ext];
      if (!mimeType) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: `不支持的图片格式: ${ext}` }],
        };
      }

      const buffer = await fs.readFile(resolvedPath);
      const base64 = buffer.toString('base64');

      // 限制大小
      if (buffer.length > 5 * 1024 * 1024) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: `图片过大 (${(buffer.length / 1024 / 1024).toFixed(2)}MB)，超过 5MB 限制` }],
        };
      }

      return {
        success: true,
        content: [{
          type: 'image' as const,
          data: base64,
          mimeType,
        }],
        details: {
          path: resolvedPath,
          size: stats.size,
          mimeType,
        },
      };
    } catch (error) {
      return errorResult('view_image', error);
    }
  },
};

// ============ 网页抓取工具 ============

const WebFetchParamsSchema = z.object({
  url: z.string().describe('要抓取的网页 URL'),
  extract_mode: z.enum(['text', 'markdown']).optional().default('markdown').describe('提取模式'),
  max_chars: z.number().optional().describe('最大字符数（默认使用系统限制）'),
});

export const webFetchTool: AgentTool<z.infer<typeof WebFetchParamsSchema>> = {
  name: 'web_fetch',
  label: 'fetch web content',
  description: `抓取网页内容并提取正文。

参数：
- url: 网页 URL
- extract_mode: 提取模式（text/markdown，默认 markdown）
- max_chars: 最大字符数（可选）

返回网页标题和正文内容。`,
  parameters: WebFetchParamsSchema,

  async execute(toolCallId, params, signal) {
    try {
      // 使用系统默认限制（1MB），或用户指定的值
      const { url, extract_mode = 'markdown', max_chars = EXEC_OUTPUT_MAX_BYTES } = params;

      // 动态导入 web-fetch 模块
      const webFetchModule = await import('./web-fetch.js');
      const result = await webFetchModule.default.execute({
        url,
        extractMode: extract_mode,
        maxChars: max_chars,
      }, signal);

      if (result.error) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: `❌ 抓取失败: ${result.error}` }],
        };
      }

      let text = result.content || '';
      if (text.length > max_chars) {
        text = truncateOutput(text, max_chars);
      }

      const header = result.title ? `# ${result.title}\n\n` : '';

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: header + text,
        }],
        details: {
          url,
          title: result.title,
          length: text.length,
        },
      };
    } catch (error) {
      return errorResult('web_fetch', error);
    }
  },
};

// ============ 指挥官专用工具导入 ============

import { pageControlTools } from '../capabilities/page-control/tools.js';
import { workflowTools } from '../capabilities/workflow/tools.js';
import { workflowControlTools } from '../capabilities/workflow-control/tools.js';
import { configTools } from '../capabilities/config/tools.js';
import { agentOrchestratorTools } from '../capabilities/agent-orchestrator/tools.js';

// ============ Ripgrep 高性能搜索工具 ============

import { GlobTool } from './tools/GlobTool.js';
import { GrepTool } from './tools/GrepTool.js';

// ============ LSP 代码智能工具 ============

import { LSPTool } from './tools/LSPTool.js';

// ============ 任务计划工具 ============

import { updatePlanTool } from './tools/update-plan.js';

// ============ 任务完成工具 ============

const TaskCompleteParamsSchema = z.object({
  summary: z.string().describe('任务完成的简要总结，包括做了什么、结果如何'),
  status: z.enum(['completed', 'needs_review']).describe('completed=任务已全部完成; needs_review=需要用户审核确认'),
});

export const taskCompleteTool: AgentTool<z.infer<typeof TaskCompleteParamsSchema>> = {
  name: 'task_complete',
  label: 'complete task',
  description: '当且仅当你确认当前任务已全部完成时调用此工具。调用后系统将向用户展示你的总结并结束任务。如果任务需要用户审核确认后才能算完成，设置 status=needs_review。',
  parameters: TaskCompleteParamsSchema,

  async execute(toolCallId, params, signal) {
    const { summary, status } = params;
    const statusText = status === 'needs_review' ? '等待审核' : '已完成';
    return {
      success: true,
      content: [{
        type: 'text' as const,
        text: `任务状态: ${statusText}\n总结: ${summary}`,
      }],
      details: {
        completed: status === 'completed',
        needsReview: status === 'needs_review',
        summary,
      },
    };
  },
};

// ============ 所有内置工具（通用工具）============

export const BUILTIN_TOOLS: AgentTool[] = [
  execTool,
  readFileTool,
  writeFileTool,
  listDirTool,
  deleteTool,
  getTimeTool,
  getSystemInfoTool,
  editFileTool,
  mkdirTool,
  spawnAgentTool,
  waitAgentTool,
  processTool,
  sendMessageTool,
  listAgentsTool,
  // 高性能搜索工具（ripgrep）
  GlobTool,
  GrepTool,
  // grepFilesTool,  // 已被 GrepTool 替代，保留注释作为参考
  // LSP 代码智能工具
  LSPTool,
  applyPatchTool,
  requestUserInputTool,
  viewImageTool,
  webFetchTool,
  // 网络搜索工具
  webSearchTool,
  // 任务计划工具
  updatePlanTool,
  // 任务完成工具
  taskCompleteTool,
];

// ============ 指挥官专用工具（AHIVECORE）============

/**
 * AHIVECORE 指挥官专用工具
 * 包含页面控制、工作流编排、配置管理、智能体统筹等能力
 */
export const AHIVECORE_TOOLS: AgentTool[] = [
  ...BUILTIN_TOOLS,
  // 页面控制工具
  ...pageControlTools,
  // 工作流编排工具
  ...workflowTools,
  // 工作流控制工具（启动、暂停、恢复、停止）
  ...workflowControlTools,
  // 配置管理工具
  ...configTools,
  // 智能体统筹工具
  ...agentOrchestratorTools,
];

/**
 * 创建内置工具列表（所有智能体通用）
 */
export function createBuiltinTools(): AgentTool[] {
  return BUILTIN_TOOLS;
}

/**
 * 创建 AHIVE-CODER 专用工具列表
 */
export async function createAhiveCoderTools(): Promise<AgentTool[]> {
  return [...BUILTIN_TOOLS];
}

/**
 * 创建 AHIVECORE 指挥官专用工具列表
 */
export function createAhivecoreTools(): AgentTool[] {
  return AHIVECORE_TOOLS;
}