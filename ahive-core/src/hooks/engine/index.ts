/**
 * Hook 引擎模块
 * 
 * 参考: codex-rs/hooks/src/engine/mod.rs
 */

export * from './config.js';
export * from './command-runner.js';
export * from './output-parser.js';
export * from './dispatcher.js';
export * from './discovery.js';

import { logger } from '../../utils/index.js';
import {
  type ConfiguredHandler,
  type HookPayload,
  HookEventName,
  type SessionStartRequest,
  type SessionStartOutcome,
  type StopRequest,
  type StopOutcome,
  type AfterAgentRequest,
  type AfterAgentOutcome,
  type AfterToolUseRequest,
  type AfterToolUseOutcome,
  HookRunStatus,
  HookOutputEntry,
  HookOutputEntryKind,
} from '../types.js';
import { discoverHandlers, type DiscoveryResult } from './discovery.js';
import {
  selectHandlers,
  executeHandlers,
  runningSummary,
  createCompletedEvent,
  DEFAULT_SHELL,
} from './dispatcher.js';
import { parseSessionStart, parseStop } from './output-parser.js';
import type { CommandShell } from './command-runner.js';

// ============ HookEngine ============

/**
 * Hook 引擎
 * 
 * 参考: codex-rs/hooks/src/engine/mod.rs ClaudeHooksEngine
 */
export class HookEngine {
  private handlers: ConfiguredHandler[] = [];
  private shell: CommandShell;
  private discoveryResult?: DiscoveryResult;

  constructor(shell?: Partial<CommandShell>) {
    this.shell = {
      windows: shell?.windows ?? DEFAULT_SHELL.windows,
      unix: shell?.unix ?? DEFAULT_SHELL.unix,
    };
  }

  /**
   * 发现并加载 hooks
   */
  async discover(cwd: string, configFolders?: string[]): Promise<DiscoveryResult> {
    this.discoveryResult = await discoverHandlers(cwd, configFolders);
    this.handlers = this.discoveryResult.handlers;
    return this.discoveryResult;
  }

  /**
   * 获取已加载的 handlers
   */
  getHandlers(): ConfiguredHandler[] {
    return this.handlers;
  }

  // ============ SessionStart ============

  /**
   * 预览 SessionStart hooks
   */
  previewSessionStart(source?: string) {
    const matched = selectHandlers(this.handlers, HookEventName.SessionStart, source);
    return matched.map((h) => runningSummary(h));
  }

  /**
   * 执行 SessionStart hooks
   * 
   * 参考: codex-rs/hooks/src/events/session_start.rs run
   */
  async runSessionStart(request: SessionStartRequest): Promise<SessionStartOutcome> {
    const matched = selectHandlers(
      this.handlers,
      HookEventName.SessionStart,
      request.source
    );

    if (matched.length === 0) {
      return {
        hookEvents: [],
        shouldStop: false,
        stopReason: undefined,
        additionalContext: undefined,
      };
    }

    // 构建输入 JSON
    const inputJson = JSON.stringify({
      session_id: request.sessionId,
      transcript_path: request.transcriptPath ?? null,
      cwd: request.cwd,
      hook_event_name: 'SessionStart',
      model: request.model,
      permission_mode: request.permissionMode,
      source: request.source,
    });

    // 执行 handlers
    const results = await executeHandlers(this.shell, matched, inputJson, request.cwd);

    // 解析结果
    let shouldStop = false;
    let stopReason: string | undefined;
    const additionalContexts: string[] = [];
    const hookEvents = results.map((result, i) => {
      const handler = matched[i];
      const parsed = this.parseSessionStartResult(handler, result);

      if (parsed.shouldStop) {
        shouldStop = true;
        stopReason = parsed.stopReason;
      }
      if (parsed.additionalContext) {
        additionalContexts.push(parsed.additionalContext);
      }

      return parsed.event;
    });

    return {
      hookEvents,
      shouldStop,
      stopReason,
      additionalContext: additionalContexts.length > 0 ? additionalContexts.join('\n\n') : undefined,
    };
  }

  private parseSessionStartResult(handler: ConfiguredHandler, result: import('../types.js').CommandRunResult) {
    const event = createCompletedEvent(handler, result);
    let shouldStop = false;
    let stopReason: string | undefined;
    let additionalContext: string | undefined;

    if (!result.error && result.exitCode === 0) {
      const parsed = parseSessionStart(result.stdout);

      if (parsed) {
        if (!parsed.continue) {
          shouldStop = true;
          stopReason = parsed.stopReason;
          event.run.status = HookRunStatus.Stopped;
          if (parsed.stopReason) {
            event.run.entries.push({
              kind: HookOutputEntryKind.Stop,
              text: parsed.stopReason,
            });
          }
        } else if (parsed.hookSpecificOutput?.additionalContext) {
          additionalContext = parsed.hookSpecificOutput.additionalContext;
        }
      } else if (result.stdout.trim()) {
        // 非 JSON，作为纯文本上下文
        additionalContext = result.stdout.trim();
      }
    }

    return { event, shouldStop, stopReason, additionalContext };
  }

  // ============ Stop ============

  /**
   * 预览 Stop hooks
   */
  previewStop() {
    const matched = selectHandlers(this.handlers, HookEventName.Stop);
    return matched.map((h) => runningSummary(h));
  }

  /**
   * 执行 Stop hooks
   * 
   * 参考: codex-rs/hooks/src/events/stop.rs run
   */
  async runStop(request: StopRequest): Promise<StopOutcome> {
    const matched = selectHandlers(this.handlers, HookEventName.Stop);

    if (matched.length === 0) {
      return {
        hookEvents: [],
        shouldStop: false,
        stopReason: undefined,
        shouldBlock: false,
        blockReason: undefined,
        continuationPrompt: undefined,
      };
    }

    // 构建输入 JSON
    const inputJson = JSON.stringify({
      session_id: request.sessionId,
      turn_id: request.turnId,
      transcript_path: request.transcriptPath ?? null,
      cwd: request.cwd,
      hook_event_name: 'Stop',
      model: request.model,
      permission_mode: request.permissionMode,
      stop_hook_active: request.stopHookActive,
      last_assistant_message: request.lastAssistantMessage ?? null,
    });

    // 执行 handlers
    const results = await executeHandlers(this.shell, matched, inputJson, request.cwd);

    // 解析结果
    let shouldStop = false;
    let stopReason: string | undefined;
    let shouldBlock = false;
    let blockReason: string | undefined;
    let continuationPrompt: string | undefined;

    const hookEvents = results.map((result, i) => {
      const handler = matched[i];
      const parsed = this.parseStopResult(handler, result, request.turnId);

      if (parsed.shouldStop) {
        shouldStop = true;
        stopReason = parsed.stopReason;
      }
      if (parsed.shouldBlock && !shouldStop) {
        shouldBlock = true;
        blockReason = parsed.blockReason;
        continuationPrompt = parsed.continuationPrompt;
      }

      return parsed.event;
    });

    return {
      hookEvents,
      shouldStop,
      stopReason,
      shouldBlock,
      blockReason,
      continuationPrompt,
    };
  }

  private parseStopResult(
    handler: ConfiguredHandler,
    result: import('../types.js').CommandRunResult,
    turnId: string
  ) {
    const event = createCompletedEvent(handler, result, turnId);
    let shouldStop = false;
    let stopReason: string | undefined;
    let shouldBlock = false;
    let blockReason: string | undefined;
    let continuationPrompt: string | undefined;

    if (result.error) {
      event.run.status = HookRunStatus.Failed;
      event.run.entries.push({
        kind: HookOutputEntryKind.Error,
        text: result.error,
      });
    } else if (result.exitCode === 0) {
      const parsed = parseStop(result.stdout);

      if (parsed) {
        if (!parsed.continue) {
          shouldStop = true;
          stopReason = parsed.stopReason;
          event.run.status = HookRunStatus.Stopped;
        } else if (parsed.decision === 'block') {
          const reason = parsed.reason?.trim();
          if (reason) {
            shouldBlock = true;
            blockReason = reason;
            continuationPrompt = reason;
            event.run.status = HookRunStatus.Blocked;
            event.run.entries.push({
              kind: HookOutputEntryKind.Feedback,
              text: reason,
            });
          } else {
            event.run.status = HookRunStatus.Failed;
            event.run.entries.push({
              kind: HookOutputEntryKind.Error,
              text: 'Stop hook 返回 decision:block 但没有提供 reason',
            });
          }
        }
      } else {
        event.run.status = HookRunStatus.Failed;
        event.run.entries.push({
          kind: HookOutputEntryKind.Error,
          text: 'Stop hook 返回无效的 JSON 输出',
        });
      }
    } else if (result.exitCode === 2) {
      // 特殊退出码: block，使用 stderr 作为 continuation_prompt
      const feedback = result.stderr.trim();
      if (feedback) {
        shouldBlock = true;
        blockReason = feedback;
        continuationPrompt = feedback;
        event.run.status = HookRunStatus.Blocked;
        event.run.entries.push({
          kind: HookOutputEntryKind.Feedback,
          text: feedback,
        });
      } else {
        event.run.status = HookRunStatus.Failed;
        event.run.entries.push({
          kind: HookOutputEntryKind.Error,
          text: 'Stop hook 退出码为 2 但 stderr 为空',
        });
      }
    } else {
      event.run.status = HookRunStatus.Failed;
      event.run.entries.push({
        kind: HookOutputEntryKind.Error,
        text: `Hook 退出码: ${result.exitCode}`,
      });
    }

    return { event, shouldStop, stopReason, shouldBlock, blockReason, continuationPrompt };
  }

  // ============ AfterAgent ============

  /**
   * 执行 AfterAgent hooks
   */
  async runAfterAgent(request: AfterAgentRequest, cwd: string): Promise<AfterAgentOutcome> {
    const matched = selectHandlers(this.handlers, HookEventName.AfterAgent);

    if (matched.length === 0) {
      return { hookEvents: [], shouldStop: false };
    }

    const inputJson = JSON.stringify({
      session_id: request.sessionId,
      thread_id: request.threadId,
      turn_id: request.turnId,
      input_messages: request.inputMessages,
      last_assistant_message: request.lastAssistantMessage ?? null,
    });

    const results = await executeHandlers(this.shell, matched, inputJson, cwd);

    const hookEvents = results.map((result, i) =>
      createCompletedEvent(matched[i], result, request.turnId)
    );

    return { hookEvents, shouldStop: false };
  }

  // ============ AfterToolUse ============

  /**
   * 执行 AfterToolUse hooks
   */
  async runAfterToolUse(request: AfterToolUseRequest, cwd: string): Promise<AfterToolUseOutcome> {
    const matched = selectHandlers(this.handlers, HookEventName.AfterToolUse);

    if (matched.length === 0) {
      return { hookEvents: [] };
    }

    const inputJson = JSON.stringify({
      session_id: request.sessionId,
      turn_id: request.turnId,
      call_id: request.callId,
      tool_name: request.toolName,
      tool_kind: request.toolKind,
      tool_input: request.toolInput,
      executed: request.executed,
      success: request.success,
      duration_ms: request.durationMs,
      mutating: request.mutating,
      sandbox: request.sandbox,
      sandbox_policy: request.sandboxPolicy,
      output_preview: request.outputPreview,
    });

    const results = await executeHandlers(this.shell, matched, inputJson, cwd);

    const hookEvents = results.map((result, i) =>
      createCompletedEvent(matched[i], result, request.turnId)
    );

    return { hookEvents };
  }
}