/**
 * AHIVECORE 执行器 - 后台进程管理
 * 
 * 功能：
 * - 启动后台进程
 * - 进程状态监控
 * - 日志轮询
 * - 进程终止
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import type { ProcessResult, SecurityPolicy } from './types.js';
import { DEFAULT_SECURITY_POLICY } from './types.js';

/**
 * 进程会话
 */
interface ProcessSession {
  id: string;
  command: string;
  process: ChildProcess;
  startTime: Date;
  stdout: string[];
  stderr: string[];
  status: 'running' | 'exited' | 'killed';
  exitCode?: number;
}

/**
 * 进程管理器
 */
export class ProcessManager {
  private sessions: Map<string, ProcessSession> = new Map();
  private policy: SecurityPolicy;
  private maxSessions: number = 10;
  private maxLogLines: number = 1000;

  constructor(policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) {
    this.policy = policy;
  }

  /**
   * 启动后台进程
   */
  async start(
    command: string,
    options: {
      workdir?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<ProcessResult> {
    // 检查会话数量限制
    if (this.sessions.size >= this.maxSessions) {
      // 清理已结束的会话
      this.cleanupExitedSessions();
      
      if (this.sessions.size >= this.maxSessions) {
        return {
          success: false,
          status: 'exited',
          output: 'Maximum number of background processes reached',
        };
      }
    }

    const sessionId = randomUUID();
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];

    const proc = spawn(shell, shellArgs, {
      cwd: options.workdir,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });

    const session: ProcessSession = {
      id: sessionId,
      command,
      process: proc,
      startTime: new Date(),
      stdout: [],
      stderr: [],
      status: 'running',
    };

    // 收集输出
    proc.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          session.stdout.push(line);
          if (session.stdout.length > this.maxLogLines) {
            session.stdout.shift();
          }
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          session.stderr.push(line);
          if (session.stderr.length > this.maxLogLines) {
            session.stderr.shift();
          }
        }
      }
    });

    proc.on('close', (code) => {
      session.status = 'exited';
      session.exitCode = code ?? 0;
    });

    proc.on('error', () => {
      session.status = 'killed';
      session.exitCode = -1;
    });

    this.sessions.set(sessionId, session);

    return {
      success: true,
      sessionId,
      status: 'running',
      output: `Started background process: ${sessionId}`,
    };
  }

  /**
   * 轮询进程状态
   */
  async poll(sessionId: string, options: { timeout?: number } = {}): Promise<ProcessResult> {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return {
        success: false,
        status: 'exited',
        output: `Session not found: ${sessionId}`,
      };
    }

    const output = [
      '--- STDOUT ---',
      ...session.stdout.slice(-100),
      '',
      '--- STDERR ---',
      ...session.stderr.slice(-100),
    ].join('\n');

    return {
      success: true,
      sessionId,
      status: session.status,
      output,
      exitCode: session.exitCode,
    };
  }

  /**
   * 停止进程
   */
  async stop(sessionId: string): Promise<ProcessResult> {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return {
        success: false,
        status: 'exited',
        output: `Session not found: ${sessionId}`,
      };
    }

    if (session.status !== 'running') {
      return {
        success: true,
        sessionId,
        status: session.status,
        output: 'Process already stopped',
        exitCode: session.exitCode,
      };
    }

    // 发送终止信号
    session.process.kill('SIGTERM');
    session.status = 'killed';

    return {
      success: true,
      sessionId,
      status: 'killed',
      output: 'Process terminated',
    };
  }

  /**
   * 列出所有进程
   */
  async list(): Promise<ProcessResult[]> {
    const results: ProcessResult[] = [];

    for (const [id, session] of this.sessions) {
      results.push({
        success: true,
        sessionId: id,
        status: session.status,
        output: session.command,
        exitCode: session.exitCode,
      });
    }

    return results;
  }

  /**
   * 清理会话
   */
  async cleanup(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && session.status !== 'running') {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * 清理已结束的会话
   */
  private cleanupExitedSessions(): void {
    for (const [id, session] of this.sessions) {
      if (session.status !== 'running') {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * 关闭所有进程
   */
  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.status === 'running') {
        session.process.kill('SIGKILL');
        session.status = 'killed';
      }
    }
    this.sessions.clear();
  }
}

// 全局进程管理器实例
let globalProcessManager: ProcessManager | null = null;

/**
 * 获取全局进程管理器
 */
export function getProcessManager(policy?: SecurityPolicy): ProcessManager {
  if (!globalProcessManager) {
    globalProcessManager = new ProcessManager(policy);
  }
  return globalProcessManager;
}