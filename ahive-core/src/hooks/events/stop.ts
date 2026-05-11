/**
 * Stop 事件处理
 * 
 * 参考: codex-rs/hooks/src/events/stop.rs
 */

import type {
  StopRequest,
  StopOutcome,
  HookCompletedEvent,
} from '../types.js';

// ============ 类型导出 ============

export type { StopRequest, StopOutcome };

// ============ 辅助函数 ============

/**
 * 创建 Stop 请求
 */
export function createStopRequest(
  sessionId: string,
  turnId: string,
  cwd: string,
  options: {
    transcriptPath?: string;
    model: string;
    permissionMode: string;
    stopHookActive?: boolean;
    lastAssistantMessage?: string;
  }
): StopRequest {
  return {
    sessionId,
    turnId,
    cwd,
    transcriptPath: options.transcriptPath,
    model: options.model,
    permissionMode: options.permissionMode,
    stopHookActive: options.stopHookActive ?? false,
    lastAssistantMessage: options.lastAssistantMessage,
  };
}

/**
 * 检查 Stop 结果是否应该停止
 */
export function shouldStopFromStop(outcome: StopOutcome): boolean {
  return outcome.shouldStop;
}

/**
 * 检查 Stop 结果是否应该阻塞
 */
export function shouldBlockFromStop(outcome: StopOutcome): boolean {
  return outcome.shouldBlock;
}

/**
 * 获取继续提示词
 */
export function getContinuationPrompt(outcome: StopOutcome): string | undefined {
  return outcome.continuationPrompt;
}

/**
 * 格式化 Stop 结果用于日志
 */
export function formatStopOutcome(outcome: StopOutcome): string {
  const lines: string[] = [];

  if (outcome.shouldStop) {
    lines.push(`🛑 Stop Hook 请求停止: ${outcome.stopReason ?? '无原因'}`);
  }

  if (outcome.shouldBlock) {
    lines.push(`⏸️ Stop Hook 阻塞: ${outcome.blockReason ?? '无原因'}`);
    if (outcome.continuationPrompt) {
      lines.push(`   继续提示: ${outcome.continuationPrompt.slice(0, 100)}...`);
    }
  }

  lines.push(`📊 触发 ${outcome.hookEvents.length} 个 Hook`);

  return lines.join('\n');
}

/**
 * 判断是否需要继续执行
 * 
 * 参考: codex-rs/hooks/src/events/stop.rs aggregate_results
 * 
 * 当 shouldBlock=true 且 continuationPrompt 存在时，
 * 应该将 continuationPrompt 注入到下一轮对话
 */
export function needsContinuation(outcome: StopOutcome): boolean {
  return outcome.shouldBlock && !!outcome.continuationPrompt;
}