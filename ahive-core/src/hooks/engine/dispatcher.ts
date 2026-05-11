/**
 * Hook 分发器
 * 
 * 参考: codex-rs/hooks/src/engine/dispatcher.rs
 */

import { logger } from '../../utils/index.js';
import {
  type ConfiguredHandler,
  type CommandRunResult,
  HookEventName,
  HookRunStatus,
  HookRunSummary,
  HookCompletedEvent,
  HookOutputEntry,
  HookOutputEntryKind,
} from '../types.js';
import { runCommand, DEFAULT_SHELL } from './command-runner.js';
import type { CommandShell } from './command-runner.js';

// ============ Handler 选择 ============

/**
 * 选择匹配的 Handler
 * 
 * 参考: codex-rs/hooks/src/engine/dispatcher.rs select_handlers
 */
export function selectHandlers(
  handlers: ConfiguredHandler[],
  eventName: HookEventName,
  sessionStartSource?: string
): ConfiguredHandler[] {
  return handlers.filter((handler) => {
    // 事件名必须匹配
    if (handler.eventName !== eventName) {
      return false;
    }

    // SessionStart 支持 matcher
    if (eventName === HookEventName.SessionStart && handler.matcher) {
      if (!sessionStartSource) {
        return false;
      }
      // matcher 是正则表达式
      try {
        const regex = new RegExp(handler.matcher, 'i');
        return regex.test(sessionStartSource);
      } catch {
        return false;
      }
    }

    return true;
  });
}

// ============ Handler 执行 ============

/**
 * 执行单个 Handler
 */
export async function executeHandler(
  shell: CommandShell,
  handler: ConfiguredHandler,
  inputJson: string,
  cwd: string
): Promise<CommandRunResult> {
  logger.info(`[HookDispatcher] 执行 Hook: ${handler.eventName} - ${handler.command}`);
  return runCommand(shell, handler, inputJson, cwd);
}

/**
 * 并行执行多个 Handler
 * 
 * 参考: codex-rs/hooks/src/engine/dispatcher.rs execute_handlers
 */
export async function executeHandlers(
  shell: CommandShell,
  handlers: ConfiguredHandler[],
  inputJson: string,
  cwd: string
): Promise<CommandRunResult[]> {
  if (handlers.length === 0) {
    return [];
  }

  // 并行执行所有 handler
  const promises = handlers.map((handler) => executeHandler(shell, handler, inputJson, cwd));
  return Promise.all(promises);
}

// ============ 摘要生成 ============

/**
 * 生成运行中摘要
 * 
 * 参考: codex-rs/hooks/src/engine/dispatcher.rs running_summary
 */
export function runningSummary(handler: ConfiguredHandler): HookRunSummary {
  return {
    hookName: generateHookName(handler),
    eventName: handler.eventName,
    matcher: handler.matcher,
    command: handler.command,
    timeoutSec: handler.timeoutSec,
    startedAt: Date.now(),
    status: HookRunStatus.Running,
    entries: [],
  };
}

/**
 * 生成完成摘要
 * 
 * 参考: codex-rs/hooks/src/engine/dispatcher.rs completed_summary
 */
export function completedSummary(
  handler: ConfiguredHandler,
  runResult: CommandRunResult,
  status: HookRunStatus,
  entries: HookOutputEntry[]
): HookRunSummary {
  return {
    hookName: generateHookName(handler),
    eventName: handler.eventName,
    matcher: handler.matcher,
    command: handler.command,
    timeoutSec: handler.timeoutSec,
    startedAt: runResult.startedAt,
    completedAt: runResult.completedAt,
    durationMs: runResult.durationMs,
    status,
    entries,
  };
}

/**
 * 生成 Hook 名称
 */
export function generateHookName(handler: ConfiguredHandler): string {
  const parts: string[] = [handler.eventName as string];
  if (handler.matcher) {
    parts.push(handler.matcher);
  }
  parts.push(handler.command.slice(0, 30));
  return parts.join('-').replace(/[^a-zA-Z0-9-_]/g, '_');
}

// ============ 结果解析辅助 ============

/**
 * 从命令结果解析状态
 */
export function parseStatusFromResult(runResult: CommandRunResult): HookRunStatus {
  if (runResult.error) {
    return HookRunStatus.Failed;
  }

  switch (runResult.exitCode) {
    case 0:
      return HookRunStatus.Completed;
    case 2:
      // Stop Hook 特殊退出码: block
      return HookRunStatus.Blocked;
    case null:
      return HookRunStatus.Timeout;
    default:
      return HookRunStatus.Failed;
  }
}

/**
 * 从命令结果创建输出条目
 */
export function createEntriesFromResult(
  runResult: CommandRunResult,
  status: HookRunStatus
): HookOutputEntry[] {
  const entries: HookOutputEntry[] = [];

  if (runResult.error) {
    entries.push({
      kind: HookOutputEntryKind.Error,
      text: runResult.error,
    });
    return entries;
  }

  if (status === HookRunStatus.Completed && runResult.stdout.trim()) {
    entries.push({
      kind: HookOutputEntryKind.Context,
      text: runResult.stdout.trim(),
    });
  }

  if (status === HookRunStatus.Blocked && runResult.stderr.trim()) {
    entries.push({
      kind: HookOutputEntryKind.Feedback,
      text: runResult.stderr.trim(),
    });
  }

  if (status === HookRunStatus.Failed) {
    if (runResult.exitCode !== null && runResult.exitCode !== 0) {
      entries.push({
        kind: HookOutputEntryKind.Error,
        text: `Hook 退出码: ${runResult.exitCode}`,
      });
    }
    if (runResult.stderr.trim()) {
      entries.push({
        kind: HookOutputEntryKind.Error,
        text: runResult.stderr.trim(),
      });
    }
  }

  return entries;
}

// ============ HookCompletedEvent 生成 ============

/**
 * 创建 HookCompletedEvent
 */
export function createCompletedEvent(
  handler: ConfiguredHandler,
  runResult: CommandRunResult,
  turnId?: string
): HookCompletedEvent {
  const status = parseStatusFromResult(runResult);
  const entries = createEntriesFromResult(runResult, status);

  return {
    turnId,
    run: completedSummary(handler, runResult, status, entries),
  };
}

export { DEFAULT_SHELL };