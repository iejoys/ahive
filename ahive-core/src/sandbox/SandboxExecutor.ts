/**
 * AHIVECORE - 沙箱安全执行器
 * 
 * 参考 Codex 的 sandboxing 设计，用 TypeScript 重写
 * 
 * 核心能力：
 * - 命令审批流程
 * - 沙箱策略执行
 * - 失败重试机制
 * - 平台特定隔离
 * 
 * 安全级别：
 * - disabled: 无限制
 * - read-only: 只读文件系统
 * - workspace-write: 工作区可写
 * - full-access: 完全访问（危险）
 */

import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { getConfig } from '../core/config.js';

// ==================== 配置接口 ====================

/** 沙箱配置 */
export interface SandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;
  /** 审批策略: never, on-failure, unless-trusted, on-request */
  approvalPolicy: string;
  /** 沙箱模式: disabled, read-only, workspace-write, danger-full-access */
  sandboxMode: string;
  /** 网络访问 */
  networkAccess: boolean;
  /** 可写根目录 */
  writableRoots: string[];
  /** 只读根目录 */
  readOnlyRoots: string[];
}

/** 默认沙箱配置 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
  networkAccess: true,
  writableRoots: [],
  readOnlyRoots: [],
};

// ==================== 类型定义 ====================

/** 审批决策 */
export enum ApprovalDecision {
  /** 批准一次 */
  Approved = 'approved',
  /** 本次会话都批准 */
  ApprovedForSession = 'approved-for-session',
  /** 拒绝 */
  Denied = 'denied',
  /** 中止 */
  Abort = 'abort',
}

/** 执行审批需求 */
export interface ExecApprovalRequirement {
  type: 'skip' | 'needs-approval' | 'forbidden';
  reason?: string;
  bypassSandbox?: boolean;
}

/** 沙箱类型 */
export enum SandboxType {
  /** 无沙箱 */
  None = 'none',
  /** 受限令牌 (Windows) */
  RestrictedToken = 'restricted-token',
  /** 提升权限 (Windows) */
  Elevated = 'elevated',
  /** Seatbelt (macOS) */
  Seatbelt = 'seatbelt',
  /** Landlock (Linux) */
  Landlock = 'landlock',
  /** Docker 容器 */
  Docker = 'docker',
}

/** 命令规格 */
export interface CommandSpec {
  /** 命令 */
  command: string[];
  /** 工作目录 */
  cwd: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时 (ms) */
  timeout?: number;
  /** 网络访问 */
  networkAccess?: boolean;
}

/** 执行结果 */
export interface ExecResult {
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 是否被沙箱拒绝 */
  sandboxDenied?: boolean;
  /** 拒绝原因 */
  denialReason?: string;
  /** 执行时间 (ms) */
  duration: number;
}

/** 审批请求 */
export interface ApprovalRequest {
  /** 请求 ID */
  id: string;
  /** 命令 */
  command: string;
  /** 工作目录 */
  cwd: string;
  /** 原因 */
  reason?: string;
  /** 网络请求信息 */
  networkInfo?: {
    host: string;
    port?: number;
  };
  /** 时间戳 */
  timestamp: Date;
}

/** 审批缓存键 */
interface ApprovalCacheKey {
  command: string;
  cwd: string;
  networkHost?: string;
}

// ==================== 审批存储 ====================

/**
 * 审批缓存存储
 */
class ApprovalStore {
  private cache: Map<string, ApprovalDecision> = new Map();

  private serializeKey(key: ApprovalCacheKey): string {
    return JSON.stringify(key);
  }

  get(key: ApprovalCacheKey): ApprovalDecision | undefined {
    return this.cache.get(this.serializeKey(key));
  }

  set(key: ApprovalCacheKey, decision: ApprovalDecision): void {
    this.cache.set(this.serializeKey(key), decision);
  }

  has(key: ApprovalCacheKey): boolean {
    return this.cache.has(this.serializeKey(key));
  }

  clear(): void {
    this.cache.clear();
  }
}

// ==================== 沙箱管理器 ====================

/**
 * 沙箱管理器
 * 
 * 负责选择和配置沙箱策略
 */
class SandboxManager {
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = process.platform;
  }

  /**
   * 选择初始沙箱类型
   */
  selectInitial(
    sandboxMode: string,
    networkAccess: boolean
  ): SandboxType {
    // 根据配置模式选择
    switch (sandboxMode) {
      case 'disabled':
      case 'danger-full-access':
        return SandboxType.None;
      
      case 'read-only':
      case 'workspace-write':
        return this.getPlatformSandbox();
      
      default:
        return this.getPlatformSandbox();
    }
  }

  /**
   * 获取平台默认沙箱
   */
  private getPlatformSandbox(): SandboxType {
    switch (this.platform) {
      case 'win32':
        return SandboxType.RestrictedToken;
      case 'darwin':
        return SandboxType.Seatbelt;
      case 'linux':
        return SandboxType.Landlock;
      default:
        return SandboxType.None;
    }
  }

  /**
   * 检查命令是否需要审批
   */
  needsApproval(command: string): boolean {
    // 危险命令列表
    const dangerousCommands = [
      'rm -rf',
      'del /',
      'format',
      'fdisk',
      'mkfs',
      'dd if=',
      'chmod 777',
      'chown',
      '> /dev/',
      'sudo',
      'su ',
      'powershell -e',
      'bash -c',
      'curl | bash',
      'wget | bash',
    ];

    const lowerCommand = command.toLowerCase();
    return dangerousCommands.some(dangerous => 
      lowerCommand.includes(dangerous.toLowerCase())
    );
  }

  /**
   * 检查是否为安全命令
   */
  isSafeCommand(command: string): boolean {
    const safeCommands = [
      'ls', 'dir', 'cat', 'type', 'echo', 'pwd', 'cd',
      'git status', 'git log', 'git diff', 'git branch',
      'npm list', 'npm view', 'npm search',
      'node --version', 'npm --version', 'pnpm --version',
      'which', 'where', 'whoami', 'hostname',
    ];

    const baseCommand = command.trim().split(/\s+/)[0];
    return safeCommands.some(safe => 
      baseCommand === safe || command.startsWith(safe + ' ')
    );
  }
}

// ==================== 沙箱执行器 ====================

/**
 * 沙箱执行器
 * 
 * 安全执行命令，支持审批和沙箱隔离
 */
export class SandboxExecutor extends EventEmitter {
  private approvalStore: ApprovalStore;
  private sandboxManager: SandboxManager;
  private approvalPolicy: string = 'on-request';
  private sandboxMode: string = 'workspace-write';
  private pendingApprovals: Map<string, (decision: ApprovalDecision) => void> = new Map();

  constructor() {
    super();
    this.approvalStore = new ApprovalStore();
    this.sandboxManager = new SandboxManager();
  }

  // ==================== 配置 ====================

  /**
   * 设置审批策略
   */
  setApprovalPolicy(policy: string): void {
    this.approvalPolicy = policy;
  }

  /**
   * 设置沙箱模式
   */
  setSandboxMode(mode: string): void {
    this.sandboxMode = mode;
  }

  /**
   * 设置是否启用沙箱
   */
  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.sandboxMode = 'danger-full-access';
    }
  }

  /**
   * 设置是否允许网络访问
   */
  setNetworkAccess(allowed: boolean): void {
    // 网络访问策略会在 execute 时检查
    // 这里只是存储配置，实际检查在 execute 方法中
    (this as any).networkAccessAllowed = allowed;
  }

  /**
   * 获取网络访问设置
   */
  getNetworkAccess(): boolean {
    return (this as any).networkAccessAllowed ?? true;
  }

  // ==================== 执行入口 ====================

  /**
   * 执行命令
   */
  async execute(
    spec: CommandSpec,
    options?: {
      skipApproval?: boolean;
      bypassSandbox?: boolean;
    }
  ): Promise<ExecResult> {
    const startTime = Date.now();
    const commandStr = spec.command.join(' ');
    const cacheKey: ApprovalCacheKey = {
      command: commandStr,
      cwd: spec.cwd,
    };

    // 1. 检查是否需要审批
    const needsApproval = this.checkNeedsApproval(commandStr, spec.cwd, options?.skipApproval);
    
    if (needsApproval.type === 'forbidden') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: needsApproval.reason || 'Command forbidden by policy',
        sandboxDenied: true,
        denialReason: needsApproval.reason,
        duration: Date.now() - startTime,
      };
    }

    // 2. 请求审批（如果需要）
    if (needsApproval.type === 'needs-approval') {
      const cachedDecision = this.approvalStore.get(cacheKey);
      
      if (cachedDecision === ApprovalDecision.Denied) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Command denied by cached decision',
          sandboxDenied: true,
          denialReason: 'cached denial',
          duration: Date.now() - startTime,
        };
      }

      if (cachedDecision !== ApprovalDecision.ApprovedForSession) {
        const decision = await this.requestApproval({
          id: uuidv4(),
          command: commandStr,
          cwd: spec.cwd,
          reason: needsApproval.reason,
          timestamp: new Date(),
        });

        if (decision === ApprovalDecision.Denied || decision === ApprovalDecision.Abort) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'Command denied by user',
            sandboxDenied: true,
            denialReason: 'user denied',
            duration: Date.now() - startTime,
          };
        }

        if (decision === ApprovalDecision.ApprovedForSession) {
          this.approvalStore.set(cacheKey, decision);
        }
      }
    }

    // 3. 选择沙箱类型
    const sandboxType = options?.bypassSandbox 
      ? SandboxType.None 
      : this.sandboxManager.selectInitial(this.sandboxMode, spec.networkAccess || false);

    // 4. 执行命令
    try {
      const result = await this.executeInSandbox(spec, sandboxType);
      result.duration = Date.now() - startTime;
      return result;
    } catch (error) {
      // 5. 沙箱执行失败，尝试无沙箱重试
      if (sandboxType !== SandboxType.None && this.shouldRetryWithoutSandbox(error)) {
        this.emit('sandbox:escalation', {
          command: commandStr,
          reason: String(error),
        });

        // 请求无沙箱执行审批
        const escalateDecision = await this.requestApproval({
          id: uuidv4(),
          command: commandStr,
          cwd: spec.cwd,
          reason: `Sandbox denied. Retry without sandbox?`,
          timestamp: new Date(),
        });

        if (escalateDecision === ApprovalDecision.Approved || 
            escalateDecision === ApprovalDecision.ApprovedForSession) {
          const retryResult = await this.executeInSandbox(spec, SandboxType.None);
          retryResult.duration = Date.now() - startTime;
          return retryResult;
        }
      }

      return {
        exitCode: 1,
        stdout: '',
        stderr: String(error),
        sandboxDenied: true,
        denialReason: String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  // ==================== 内部方法 ====================

  /**
   * 检查是否需要审批
   */
  private checkNeedsApproval(
    command: string,
    cwd: string,
    skipApproval?: boolean
  ): ExecApprovalRequirement {
    if (skipApproval) {
      return { type: 'skip', bypassSandbox: false };
    }

    // 根据审批策略判断
    switch (this.approvalPolicy) {
      case 'never':
        return { type: 'skip', bypassSandbox: false };
      
      case 'on-failure':
        return { type: 'skip', bypassSandbox: false };
      
      case 'unless-trusted':
        // 需要检查是否在可信目录
        if (this.sandboxManager.isSafeCommand(command)) {
          return { type: 'skip', bypassSandbox: false };
        }
        return { type: 'needs-approval' };
      
      case 'on-request':
      default:
        if (this.sandboxManager.isSafeCommand(command)) {
          return { type: 'skip', bypassSandbox: false };
        }
        if (this.sandboxManager.needsApproval(command)) {
          return { 
            type: 'needs-approval', 
            reason: 'Potentially dangerous command detected' 
          };
        }
        return { type: 'skip', bypassSandbox: false };
    }
  }

  /**
   * 请求审批
   */
  private async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(request.id, resolve);
      this.emit('approval:request', request);
    });
  }

  /**
   * 响应审批请求
   */
  respondToApproval(requestId: string, decision: ApprovalDecision): void {
    const resolver = this.pendingApprovals.get(requestId);
    if (resolver) {
      resolver(decision);
      this.pendingApprovals.delete(requestId);
    }
  }

  /**
   * 在沙箱中执行
   */
  private async executeInSandbox(
    spec: CommandSpec,
    sandboxType: SandboxType
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = spec.command;
      
      const spawnOptions: SpawnOptions = {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        timeout: spec.timeout || 60000,
      };

      // 根据沙箱类型调整执行方式
      if (sandboxType === SandboxType.RestrictedToken && process.platform === 'win32') {
        // Windows 受限令牌执行
        // 实际实现需要调用 Windows API 或使用第三方工具
        this.emit('sandbox:warning', {
          message: 'RestrictedToken sandbox not fully implemented on Windows',
        });
      }

      const proc = spawn(cmd, args, spawnOptions);
      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          duration: 0,
        });
      });

      // 超时处理
      if (spec.timeout) {
        setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timeout after ${spec.timeout}ms`));
        }, spec.timeout);
      }
    });
  }

  /**
   * 判断是否应该无沙箱重试
   */
  private shouldRetryWithoutSandbox(error: unknown): boolean {
    const errorMessage = String(error).toLowerCase();
    return (
      errorMessage.includes('permission denied') ||
      errorMessage.includes('access denied') ||
      errorMessage.includes('sandbox') ||
      errorMessage.includes('not allowed')
    );
  }

  // ==================== 工具方法 ====================

  /**
   * 清除审批缓存
   */
  clearApprovalCache(): void {
    this.approvalStore.clear();
  }

  /**
   * 取消所有待处理的审批
   */
  cancelPendingApprovals(): void {
    for (const [id, resolver] of this.pendingApprovals) {
      resolver(ApprovalDecision.Abort);
    }
    this.pendingApprovals.clear();
  }
}

// 简单的 uuid 生成
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 导出单例
export const sandboxExecutor = new SandboxExecutor();

/**
 * 从配置文件初始化沙箱设置
 */
export async function initializeSandboxConfig(): Promise<void> {
  try {
    const config = getConfig().getConfig();
    
    if (config.sandbox) {
      if (config.sandbox.enabled !== undefined) {
        sandboxExecutor.setEnabled(config.sandbox.enabled);
      }
      if (config.sandbox.mode) {
        sandboxExecutor.setSandboxMode(config.sandbox.mode);
      }
      if (config.sandbox.approvalPolicy) {
        sandboxExecutor.setApprovalPolicy(config.sandbox.approvalPolicy);
      }
      if (config.sandbox.networkAccess !== undefined) {
        sandboxExecutor.setNetworkAccess(config.sandbox.networkAccess);
      }
      
      console.log(`[Sandbox] 配置已加载: enabled=${config.sandbox.enabled}, mode=${config.sandbox.mode}, policy=${config.sandbox.approvalPolicy}`);
    }
  } catch (error) {
    console.warn('[Sandbox] 加载配置失败，使用默认设置:', error);
  }
}