/**
 * AHIVECORE 执行器 - Shell 命令执行
 * 
 * 功能：
 * - 执行 Shell 命令
 * - 支持超时控制
 * - 安全策略检查
 * - Windows/Linux 兼容
 */

import { spawn, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { ExecParamsSchema, ExecResult, SecurityPolicy } from './types.js';
import { DEFAULT_SECURITY_POLICY } from './types.js';

const execFile = promisify(execFileCb);

/**
 * Shell 执行器
 */
export class ShellExecutor {
  private policy: SecurityPolicy;

  constructor(policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) {
    this.policy = policy;
  }

  /**
   * 执行命令
   */
  async execute(
    params: z.infer<typeof ExecParamsSchema>,
    signal?: AbortSignal
  ): Promise<ExecResult> {
    const { command, workdir, timeout = 60000, env } = params;
    const startTime = Date.now();

    // 安全检查
    const securityCheck = this.checkSecurity(command, workdir);
    if (!securityCheck.allowed) {
      return {
        success: false,
        stdout: '',
        stderr: `Security policy violation: ${securityCheck.reason}`,
        exitCode: -1,
        duration: Date.now() - startTime,
      };
    }

    // 限制超时
    const effectiveTimeout = Math.min(timeout, this.policy.maxTimeout || 300000);

    try {
      const result = await this.runCommand(command, {
        cwd: workdir,
        timeout: effectiveTimeout,
        env: { ...process.env, ...env },
        signal,
      });

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 运行命令 (核心实现)
   */
  private runCommand(
    command: string,
    options: {
      cwd?: string;
      timeout: number;
      env: Record<string, string>;
      signal?: AbortSignal;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['/c', command] : ['-c', command];

      const proc = spawn(shell, shellArgs, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let exited = false;

      // 超时处理
      if (options.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!exited) {
            proc.kill('SIGKILL');
            stderr += '\nCommand timed out';
          }
        }, options.timeout);
      }

      // 中断信号处理
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          if (!exited) {
            proc.kill('SIGKILL');
            stderr += '\nCommand aborted';
          }
        });
      }

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        exited = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? -1,
        });
      });

      proc.on('error', (err) => {
        exited = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(err);
      });
    });
  }

  /**
   * 安全检查
   */
  private checkSecurity(
    command: string,
    workdir?: string
  ): { allowed: boolean; reason?: string } {
    // 检查禁止的命令
    if (this.policy.blockedCommands) {
      for (const pattern of this.policy.blockedCommands) {
        if (pattern.test(command)) {
          return { allowed: false, reason: `Blocked command pattern: ${pattern}` };
        }
      }
    }

    // 检查允许的命令 (如果设置了白名单)
    if (this.policy.allowedCommands && this.policy.allowedCommands.length > 0) {
      const allowed = this.policy.allowedCommands.some(pattern => pattern.test(command));
      if (!allowed) {
        return { allowed: false, reason: 'Command not in allowlist' };
      }
    }

    // 检查禁止的路径
    if (workdir && this.policy.blockedPaths) {
      for (const blocked of this.policy.blockedPaths) {
        if (workdir.startsWith(blocked)) {
          return { allowed: false, reason: `Blocked path: ${blocked}` };
        }
      }
    }

    return { allowed: true };
  }
}

/**
 * 创建 Shell 执行器
 */
export function createShellExecutor(policy?: SecurityPolicy): ShellExecutor {
  return new ShellExecutor(policy);
}