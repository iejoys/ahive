/**
 * Hook 输出解析器
 * 
 * 参考: codex-rs/hooks/src/engine/output_parser.rs
 */

// ============ 通用输出结构 ============

/**
 * 通用 Hook 输出字段
 * 参考: codex-rs/hooks/src/engine/output_parser.rs UniversalCommandOutputWire
 */
export interface UniversalCommandOutput {
  /** 是否继续处理 */
  continue: boolean;
  /** 停止原因 */
  stopReason?: string;
  /** 是否抑制输出 */
  suppressOutput?: boolean;
  /** 系统消息 (作为警告显示) */
  systemMessage?: string;
}

/**
 * SessionStart Hook 输出
 * 参考: codex-rs/hooks/src/engine/output_parser.rs SessionStartCommandOutputWire
 */
export interface SessionStartCommandOutput extends UniversalCommandOutput {
  hookSpecificOutput?: {
    hookEventName: 'SessionStart';
    additionalContext?: string;
  };
}

/**
 * Stop Hook 输出
 * 参考: codex-rs/hooks/src/engine/output_parser.rs StopCommandOutputWire
 */
export interface StopCommandOutput extends UniversalCommandOutput {
  decision?: 'proceed' | 'block';
  reason?: string;
}

/**
 * Stop Hook 决策类型
 * 参考: codex-rs/hooks/src/engine/output_parser.rs StopDecisionWire
 */
export type StopDecision = 'proceed' | 'block';

// ============ 解析函数 ============

/**
 * 解析 SessionStart Hook 输出
 * 
 * 参考: codex-rs/hooks/src/engine/output_parser.rs parse_session_start
 */
export function parseSessionStart(stdout: string): SessionStartCommandOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  // 尝试解析 JSON
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        continue: parsed.continue ?? true,
        stopReason: parsed.stopReason ?? parsed.stop_reason,
        suppressOutput: parsed.suppressOutput ?? parsed.suppress_output,
        systemMessage: parsed.systemMessage ?? parsed.system_message,
        hookSpecificOutput: parsed.hookSpecificOutput ?? parsed.hook_specific_output,
      };
    } catch {
      return null;
    }
  }

  // 非JSON，作为纯文本上下文
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: trimmed,
    },
  };
}

/**
 * 解析 Stop Hook 输出
 * 
 * 参考: codex-rs/hooks/src/engine/output_parser.rs parse_stop
 */
export function parseStop(stdout: string): StopCommandOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  // 尝试解析 JSON
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        continue: parsed.continue ?? true,
        stopReason: parsed.stopReason ?? parsed.stop_reason,
        suppressOutput: parsed.suppressOutput ?? parsed.suppress_output,
        systemMessage: parsed.systemMessage ?? parsed.system_message,
        decision: parsed.decision,
        reason: parsed.reason,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 解析通用 Hook 输出
 */
export function parseUniversalOutput(stdout: string): UniversalCommandOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        continue: parsed.continue ?? true,
        stopReason: parsed.stopReason ?? parsed.stop_reason,
        suppressOutput: parsed.suppressOutput ?? parsed.suppress_output,
        systemMessage: parsed.systemMessage ?? parsed.system_message,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 验证 Stop Hook block 决策
 * 
 * 参考: codex-rs/hooks/src/events/stop.rs:168-193
 * block 决策必须有非空 reason
 */
export function validateBlockDecision(output: StopCommandOutput): { valid: boolean; reason?: string } {
  if (output.decision !== 'block') {
    return { valid: true };
  }

  const reason = output.reason?.trim();
  if (!reason) {
    return { valid: false };
  }

  return { valid: true, reason };
}