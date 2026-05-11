/**
 * AHIVECORE 执行器 - 工具定义
 * 
 * 提供本地操作能力：
 * - Shell 命令执行
 * - 文件操作
 * - 进程管理
 * - 网络请求
 */

import { z } from 'zod';

// ============ 工具参数 Schema ============

/** Shell 执行参数 */
export const ExecParamsSchema = z.object({
  command: z.string().describe('要执行的命令'),
  workdir: z.string().optional().describe('工作目录'),
  timeout: z.number().optional().default(60000).describe('超时时间(ms)'),
  env: z.record(z.string()).optional().describe('环境变量'),
});

/** 文件读取参数 */
export const ReadFileParamsSchema = z.object({
  path: z.string().describe('文件路径'),
  encoding: z.enum(['utf-8', 'binary', 'base64']).optional().default('utf-8'),
});

/** 文件写入参数 */
export const WriteFileParamsSchema = z.object({
  path: z.string().describe('文件路径'),
  content: z.string().describe('文件内容'),
  encoding: z.enum(['utf-8', 'binary', 'base64']).optional().default('utf-8'),
  mkdir: z.boolean().optional().default(true).describe('自动创建目录'),
});

/** 目录列表参数 */
export const ListDirParamsSchema = z.object({
  path: z.string().describe('目录路径'),
  recursive: z.boolean().optional().default(false),
});

/** 文件删除参数 */
export const DeleteParamsSchema = z.object({
  path: z.string().describe('文件/目录路径'),
  recursive: z.boolean().optional().default(false),
});

/** HTTP 请求参数 */
export const HttpParamsSchema = z.object({
  url: z.string().describe('请求URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional().default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeout: z.number().optional().default(30000),
});

/** 进程管理参数 */
export const ProcessParamsSchema = z.object({
  action: z.enum(['start', 'stop', 'poll', 'list']).describe('操作类型'),
  sessionId: z.string().optional().describe('进程会话ID'),
  command: z.string().optional().describe('启动命令'),
});

// ============ 工具结果类型 ============

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface FileResult {
  success: boolean;
  path: string;
  content?: string;
  size?: number;
  mtime?: Date;
}

export interface ListResult {
  success: boolean;
  path: string;
  entries: Array<{
    name: string;
    type: 'file' | 'directory';
    size: number;
    mtime: Date;
  }>;
}

export interface HttpResult {
  success: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ProcessResult {
  success: boolean;
  sessionId?: string;
  status?: 'running' | 'exited' | 'killed';
  output?: string;
  exitCode?: number;
}

// ============ 工具定义接口 ============

export interface ToolDefinition<T = any, R = any> {
  name: string;
  description: string;
  parameters: z.ZodType<T>;
  execute(params: T, signal?: AbortSignal): Promise<R>;
}

// ============ 安全策略 ============

export interface SecurityPolicy {
  /** 允许执行的命令白名单 (正则) */
  allowedCommands?: RegExp[];
  /** 禁止执行的命令黑名单 (正则) */
  blockedCommands?: RegExp[];
  /** 允许访问的路径 */
  allowedPaths?: string[];
  /** 禁止访问的路径 */
  blockedPaths?: string[];
  /** 允许请求的域名 */
  allowedDomains?: string[];
  /** 命令执行超时上限 */
  maxTimeout?: number;
  /** 文件大小上限 (bytes) */
  maxFileSize?: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  allowedCommands: [
    /^ls$/, /^dir$/, /^cat$/, /^type$/, /^echo$/, /^pwd$/, /^cd$/,
    /^git\s+/, /^npm\s+/, /^node\s+/, /^python\d*\s+/,
    /^mkdir\s+/, /^rm\s+/, /^cp\s+/, /^mv\s+/, /^touch\s*/,
    /^grep/, /^find/, /^awk/, /^sed/,
    /^curl/, /^wget/,
  ],
  blockedCommands: [
    /^rm\s+-rf\s+\//, /^rm\s+-rf\s+~/, /^mkfs/, /^dd\s+/,
    /^sudo\s+/, /^su\s+/, /^chmod\s+777/,
    />\s*\/dev\/sd/, /^format/,
  ],
  blockedPaths: [
    '/etc/passwd', '/etc/shadow', '~/.ssh',
    process.env.USERPROFILE || '', // Windows 用户目录
  ],
  maxTimeout: 300000, // 5分钟
  maxFileSize: 10 * 1024 * 1024, // 10MB
};