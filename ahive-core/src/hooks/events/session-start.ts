/**
 * SessionStart 事件处理
 * 
 * 参考: codex-rs/hooks/src/events/session_start.rs
 */

import type {
  SessionStartRequest,
  SessionStartOutcome,
  SessionStartSource,
  HookCompletedEvent,
} from '../types.js';
import type { HookEngine } from '../engine/index.js';

// ============ 类型导出 ============

export type { SessionStartRequest, SessionStartOutcome, SessionStartSource };

// ============ 辅助函数 ============

/**
 * 创建 SessionStart 请求
 */
export function createSessionStartRequest(
  sessionId: string,
  cwd: string,
  options: {
    transcriptPath?: string;
    model: string;
    permissionMode: string;
    source?: SessionStartSource;
  }
): SessionStartRequest {
  return {
    sessionId,
    cwd,
    transcriptPath: options.transcriptPath,
    model: options.model,
    permissionMode: options.permissionMode,
    source: options.source ?? ('startup' as SessionStartSource),
  };
}

/**
 * 检查 SessionStart 结果是否应该停止
 */
export function shouldStopFromSessionStart(outcome: SessionStartOutcome): boolean {
  return outcome.shouldStop;
}

/**
 * 获取附加上下文
 */
export function getAdditionalContext(outcome: SessionStartOutcome): string | undefined {
  return outcome.additionalContext;
}

/**
 * 格式化 SessionStart 结果用于日志
 */
export function formatSessionStartOutcome(outcome: SessionStartOutcome): string {
  const lines: string[] = [];

  if (outcome.shouldStop) {
    lines.push(`🛑 SessionStart Hook 请求停止: ${outcome.stopReason ?? '无原因'}`);
  }

  if (outcome.additionalContext) {
    lines.push(`📝 注入上下文: ${outcome.additionalContext.slice(0, 100)}...`);
  }

  lines.push(`📊 触发 ${outcome.hookEvents.length} 个 Hook`);

  return lines.join('\n');
}