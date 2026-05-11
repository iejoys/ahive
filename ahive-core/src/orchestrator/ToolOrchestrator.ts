/**
 * AHIVECORE - 工具编排器
 * 
 * 参考 Codex 的 orchestrator 设计，用 TypeScript 重写
 * 
 * 核心流程：
 * 1. 审批 → 2. 选择沙箱 → 3. 执行 → 4. 失败重试
 * 
 * 职责：
 * - 统一的工具执行流程
 * - 审批和沙箱协调
 * - 错误处理和重试
 */

import { EventEmitter } from 'events';
import { SandboxExecutor, ApprovalDecision, SandboxType } from '../sandbox/SandboxExecutor.js';
import type { CommandSpec, ExecResult } from '../sandbox/SandboxExecutor.js';

// ==================== 类型定义 ====================

/** 工具类型 */
export enum ToolKind {
  /** 函数调用 */
  Function = 'function',
  /** Shell 命令 */
  Shell = 'shell',
  /** 文件操作 */
  FileSystem = 'filesystem',
  /** 网络请求 */
  Network = 'network',
  /** 代码执行 */
  CodeExec = 'code-exec',
}

/** 工具定义 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  
  /** 工具描述 */
  description: string;
  
  /** 参数 Schema */
  parameters: Record<string, unknown>;
  
  /** 工具类型 */
  kind: ToolKind;
  
  /** 是否需要审批 */
  needsApproval?: boolean;
  
  /** 是否可并行 */
  parallelizable?: boolean;
  
  /** 超时时间 */
  timeout?: number;
  
  /** 危险等级 */
  dangerLevel?: 'low' | 'medium' | 'high';
}

/** 工具调用请求 */
export interface ToolCallRequest {
  /** 调用 ID */
  callId: string;
  
  /** 工具名称 */
  name: string;
  
  /** 参数 */
  arguments: Record<string, unknown>;
  
  /** 上下文 */
  context?: {
    agentId?: string;
    workingDir?: string;
    networkAccess?: boolean;
  };
}

/** 工具调用结果 */
export interface ToolCallResult {
  /** 调用 ID */
  callId: string;
  
  /** 是否成功 */
  success: boolean;
  
  /** 输出内容 */
  content: string;
  
  /** 错误信息 */
  error?: string;
  
  /** 执行时间 */
  duration: number;
  
  /** 是否被沙箱拒绝 */
  sandboxDenied?: boolean;
  
  /** 是否需要重试 */
  retryable?: boolean;
}

/** 工具处理器 */
export type ToolHandler = (
  request: ToolCallRequest,
  context: ToolExecutionContext
) => Promise<ToolCallResult>;

/** 工具执行上下文 */
export interface ToolExecutionContext {
  /** 沙箱执行器 */
  sandboxExecutor: SandboxExecutor;
  
  /** 工作目录 */
  workingDir: string;
  
  /** 网络访问权限 */
  networkAccess: boolean;
  
  /** 审批策略 */
  approvalPolicy: string;
  
  /** 日志记录器 */
  logger: (level: string, message: string, data?: unknown) => void;
}

/** 并行执行选项 */
export interface ParallelOptions {
  /** 最大并发数 */
  maxConcurrency?: number;
  
  /** 失败时是否继续 */
  continueOnFailure?: boolean;
  
  /** 超时时间 */
  timeout?: number;
}

// ==================== 工具注册表 ====================

/**
 * 工具注册表
 */
class ToolRegistry {
  private tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }> = new Map();

  /**
   * 注册工具
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * 获取工具
   */
  get(name: string): { definition: ToolDefinition; handler: ToolHandler } | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具定义
   */
  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 移除工具
   */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }
}

// ==================== 工具编排器 ====================

/**
 * 工具编排器
 * 
 * 统一管理工具的审批、沙箱执行和重试
 */
export class ToolOrchestrator extends EventEmitter {
  private registry: ToolRegistry;
  private sandboxExecutor: SandboxExecutor;
  private defaultApprovalPolicy: string = 'on-request';
  private defaultWorkingDir: string = process.cwd();

  constructor() {
    super();
    this.registry = new ToolRegistry();
    this.sandboxExecutor = new SandboxExecutor();
    
    // 转发沙箱事件
    this.sandboxExecutor.on('approval:request', (request) => {
      this.emit('approval:request', request);
    });
    this.sandboxExecutor.on('sandbox:escalation', (data) => {
      this.emit('sandbox:escalation', data);
    });
  }

  // ==================== 工具注册 ====================

  /**
   * 注册工具
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.registry.register(definition, handler);
    this.emit('tool:registered', { name: definition.name, kind: definition.kind });
  }

  /**
   * 获取所有工具定义
   */
  getToolDefinitions(): ToolDefinition[] {
    return this.registry.getAllDefinitions();
  }

  // ==================== 单个工具执行 ====================

  /**
   * 执行工具调用
   */
  async executeTool(request: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = Date.now();
    const tool = this.registry.get(request.name);

    if (!tool) {
      return {
        callId: request.callId,
        success: false,
        content: '',
        error: `Tool "${request.name}" not found`,
        duration: Date.now() - startTime,
      };
    }

    const { definition, handler } = tool;
    const context: ToolExecutionContext = {
      sandboxExecutor: this.sandboxExecutor,
      workingDir: request.context?.workingDir || this.defaultWorkingDir,
      networkAccess: request.context?.networkAccess || false,
      approvalPolicy: this.defaultApprovalPolicy,
      logger: (level, message, data) => this.emit('log', { level, message, data }),
    };

    this.emit('tool:started', {
      callId: request.callId,
      name: request.name,
      arguments: request.arguments,
    });

    try {
      // 执行工具
      const result = await handler(request, context);
      result.duration = Date.now() - startTime;

      this.emit('tool:completed', {
        callId: request.callId,
        name: request.name,
        success: result.success,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      const result: ToolCallResult = {
        callId: request.callId,
        success: false,
        content: '',
        error: String(error),
        duration: Date.now() - startTime,
        retryable: true,
      };

      this.emit('tool:error', {
        callId: request.callId,
        name: request.name,
        error: String(error),
      });

      return result;
    }
  }

  // ==================== 批量执行 ====================

  /**
   * 并行执行多个工具
   */
  async executeParallel(
    requests: ToolCallRequest[],
    options: ParallelOptions = {}
  ): Promise<ToolCallResult[]> {
    const { maxConcurrency = 5, continueOnFailure = true, timeout } = options;

    // 分组执行
    const results: ToolCallResult[] = [];
    const batches: ToolCallRequest[][] = [];
    
    for (let i = 0; i < requests.length; i += maxConcurrency) {
      batches.push(requests.slice(i, i + maxConcurrency));
    }

    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(req => {
          if (timeout) {
            return this.executeWithTimeout(req, timeout);
          }
          return this.executeTool(req);
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (!result.value.success && !continueOnFailure) {
            return results;
          }
        } else {
          results.push({
            callId: '',
            success: false,
            content: '',
            error: result.reason,
            duration: 0,
          });
          if (!continueOnFailure) {
            return results;
          }
        }
      }
    }

    return results;
  }

  /**
   * 带超时执行
   */
  private async executeWithTimeout(
    request: ToolCallRequest,
    timeout: number
  ): Promise<ToolCallResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          callId: request.callId,
          success: false,
          content: '',
          error: `Tool execution timeout after ${timeout}ms`,
          duration: timeout,
        });
      }, timeout);

      this.executeTool(request).then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  // ==================== 配置 ====================

  /**
   * 设置审批策略
   */
  setApprovalPolicy(policy: string): void {
    this.defaultApprovalPolicy = policy;
    this.sandboxExecutor.setApprovalPolicy(policy);
  }

  /**
   * 设置沙箱模式
   */
  setSandboxMode(mode: string): void {
    this.sandboxExecutor.setSandboxMode(mode);
  }

  /**
   * 设置默认工作目录
   */
  setDefaultWorkingDir(dir: string): void {
    this.defaultWorkingDir = dir;
  }

  // ==================== 审批响应 ====================

  /**
   * 响应审批请求
   */
  respondToApproval(requestId: string, decision: ApprovalDecision): void {
    this.sandboxExecutor.respondToApproval(requestId, decision);
  }

  // ==================== 工具方法 ====================

  /**
   * 清除审批缓存
   */
  clearApprovalCache(): void {
    this.sandboxExecutor.clearApprovalCache();
  }
}

// ==================== 内置工具 ====================

/**
 * 注册内置工具
 */
export function registerBuiltinTools(orchestrator: ToolOrchestrator): void {
  // Shell 命令执行
  orchestrator.registerTool(
    {
      name: 'shell',
      description: 'Execute shell commands',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['command'],
      },
      kind: ToolKind.Shell,
      needsApproval: true,
      dangerLevel: 'medium',
    },
    async (request, context) => {
      const command = request.arguments.command as string;
      const cwd = (request.arguments.cwd as string) || context.workingDir;

      const result = await context.sandboxExecutor.execute({
        command: command.split(' '),
        cwd,
        networkAccess: context.networkAccess,
      });

      return {
        callId: request.callId,
        success: result.exitCode === 0,
        content: result.stdout || result.stderr,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        duration: result.duration,
        sandboxDenied: result.sandboxDenied,
      };
    }
  );

  // 文件读取
  orchestrator.registerTool(
    {
      name: 'read_file',
      description: 'Read file content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
      kind: ToolKind.FileSystem,
      needsApproval: false,
      dangerLevel: 'low',
    },
    async (request, context) => {
      const fs = await import('fs/promises');
      const filePath = request.arguments.path as string;

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          callId: request.callId,
          success: true,
          content,
          duration: 0,
        };
      } catch (error) {
        return {
          callId: request.callId,
          success: false,
          content: '',
          error: String(error),
          duration: 0,
        };
      }
    }
  );

  // 文件写入
  orchestrator.registerTool(
    {
      name: 'write_file',
      description: 'Write content to file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
      kind: ToolKind.FileSystem,
      needsApproval: true,
      dangerLevel: 'medium',
    },
    async (request, context) => {
      const fs = await import('fs/promises');
      const filePath = request.arguments.path as string;
      const content = request.arguments.content as string;

      try {
        await fs.writeFile(filePath, content, 'utf-8');
        return {
          callId: request.callId,
          success: true,
          content: `File written: ${filePath}`,
          duration: 0,
        };
      } catch (error) {
        return {
          callId: request.callId,
          success: false,
          content: '',
          error: String(error),
          duration: 0,
        };
      }
    }
  );
}

// 导出单例
export const toolOrchestrator = new ToolOrchestrator();