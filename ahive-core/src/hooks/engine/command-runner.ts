/**
 * Hook 命令执行器
 * 
 * 参考: codex-rs/hooks/src/engine/command_runner.rs
 */

import { spawn } from 'child_process';
import { logger } from '../../utils/index.js';
import type { ConfiguredHandler, CommandRunResult } from '../types.js';

// ============ Shell 配置 ============

/**
 * 命令 Shell 配置
 * 参考: codex-rs/hooks/src/engine/mod.rs CommandShell
 */
export interface CommandShell {
  windows: 'cmd' | 'powershell';
  unix: 'sh' | 'bash' | 'zsh';
}

const DEFAULT_SHELL: CommandShell = {
  windows: 'powershell',
  unix: 'bash',
};

// ============ 命令执行 ============

/**
 * 执行 Hook 命令
 * 
 * 参考: codex-rs/hooks/src/engine/command_runner.rs run_command
 */
export async function runCommand(
  shell: CommandShell,
  handler: ConfiguredHandler,
  inputJson: string,
  cwd: string
): Promise<CommandRunResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    let shellCmd: string;
    let shellArgs: string[];

    if (isWindows) {
      // Windows: 使用 PowerShell
      if (shell.windows === 'powershell') {
        shellCmd = 'powershell.exe';
        shellArgs = ['-NoProfile', '-NonInteractive', '-Command', handler.command];
      } else {
        shellCmd = 'cmd.exe';
        shellArgs = ['/c', handler.command];
      }
    } else {
      // Unix: 使用 bash/sh
      shellCmd = shell.unix;
      shellArgs = ['-lc', handler.command];
    }

    logger.debug(`[HookCommand] 执行: ${shellCmd} ${shellArgs.join(' ')}`);

    const proc = spawn(shellCmd, shellArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    // 超时控制
    const timeoutMs = handler.timeoutSec * 1000;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        const completedAt = Date.now();
        resolve({
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          exitCode: null,
          stdout,
          stderr,
          error: `Hook 超时 (${handler.timeoutSec}s)`,
        });
      }
    }, timeoutMs);

    // 写入 stdin (JSON 输入)
    if (proc.stdin) {
      proc.stdin.write(inputJson);
      proc.stdin.end();
    }

    // 收集 stdout
    if (proc.stdout) {
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
    }

    // 收集 stderr
    if (proc.stderr) {
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    // 处理错误
    proc.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        const completedAt = Date.now();
        resolve({
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          exitCode: null,
          stdout,
          stderr,
          error: err.message,
        });
      }
    });

    // 处理完成
    proc.on('close', (exitCode: number | null) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        const completedAt = Date.now();
        resolve({
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          exitCode,
          stdout,
          stderr,
        });
      }
    });
  });
}

// ============ 辅助函数 ============

/**
 * 构建 Hook 命令
 * 
 * 参考: codex-rs/hooks/src/engine/command_runner.rs build_command
 */
export function buildHookCommand(
  shell: CommandShell,
  command: string
): { shell: string; args: string[] } {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    if (shell.windows === 'powershell') {
      return {
        shell: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', command],
      };
    }
    return {
      shell: 'cmd.exe',
      args: ['/c', command],
    };
  }

  return {
    shell: shell.unix,
    args: ['-lc', command],
  };
}

export { DEFAULT_SHELL };