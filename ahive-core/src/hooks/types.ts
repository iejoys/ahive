/**
 * Hook 系统核心类型定义
 * 
 * 参考: codex-rs/hooks/src/types.rs
 */

// ============ HookResult ============

/**
 * Hook 执行结果
 * 参考: codex-rs/hooks/src/types.rs:16-25
 */
export enum HookResultKind {
  /** 成功 */
  Success = 'success',
  /** 失败但继续 */
  FailedContinue = 'failed_continue',
  /** 失败并中止 */
  FailedAbort = 'failed_abort',
}

export interface HookResult {
  kind: HookResultKind;
  error?: string;
}

export const HookResultSuccess: HookResult = { kind: HookResultKind.Success };
export const HookResultFailedContinue = (error: string): HookResult => ({
  kind: HookResultKind.FailedContinue,
  error,
});
export const HookResultFailedAbort = (error: string): HookResult => ({
  kind: HookResultKind.FailedAbort,
  error,
});

// ============ HookResponse ============

/**
 * Hook 响应
 * 参考: codex-rs/hooks/src/types.rs:33-37
 */
export interface HookResponse {
  hookName: string;
  result: HookResult;
}

// ============ HookEventName ============

/**
 * Hook 事件名称
 * 参考: codex-rs/protocol/src/protocol.rs HookEventName
 */
export enum HookEventName {
  SessionStart = 'SessionStart',
  Stop = 'Stop',
  AfterAgent = 'AfterAgent',
  AfterToolUse = 'AfterToolUse',
}

// ============ SessionStart 事件 ============

/**
 * SessionStart 来源
 * 参考: codex-rs/hooks/src/events/session_start.rs:18-22
 */
export enum SessionStartSource {
  Startup = 'startup',
  Resume = 'resume',
  Clear = 'clear',
}

/**
 * SessionStart 请求数据
 * 参考: codex-rs/hooks/src/events/session_start.rs:34-41
 */
export interface SessionStartRequest {
  sessionId: string;
  cwd: string;
  transcriptPath?: string;
  model: string;
  permissionMode: string;
  source: SessionStartSource;
}

/**
 * SessionStart 输出结果
 * 参考: codex-rs/hooks/src/events/session_start.rs:44-49
 */
export interface SessionStartOutcome {
  hookEvents: HookCompletedEvent[];
  shouldStop: boolean;
  stopReason?: string;
  additionalContext?: string;
}

// ============ Stop 事件 ============

/**
 * Stop 请求数据
 * 参考: codex-rs/hooks/src/events/stop.rs:19-28
 */
export interface StopRequest {
  sessionId: string;
  turnId: string;
  cwd: string;
  transcriptPath?: string;
  model: string;
  permissionMode: string;
  stopHookActive: boolean;
  lastAssistantMessage?: string;
}

/**
 * Stop 输出结果
 * 参考: codex-rs/hooks/src/events/stop.rs:31-38
 */
export interface StopOutcome {
  hookEvents: HookCompletedEvent[];
  shouldStop: boolean;
  stopReason?: string;
  shouldBlock: boolean;
  blockReason?: string;
  continuationPrompt?: string;
}

// ============ AfterAgent 事件 ============

/**
 * AfterAgent 请求数据
 * 参考: codex-rs/hooks/src/types.rs:77-82
 */
export interface AfterAgentRequest {
  sessionId: string;
  threadId: string;
  turnId: string;
  inputMessages: string[];
  lastAssistantMessage?: string;
}

/**
 * AfterAgent 输出结果
 */
export interface AfterAgentOutcome {
  hookEvents: HookCompletedEvent[];
  shouldStop: boolean;
  stopReason?: string;
}

// ============ AfterToolUse 事件 ============

/**
 * 工具类型
 * 参考: codex-rs/hooks/src/types.rs:84-91
 */
export enum HookToolKind {
  Function = 'function',
  Custom = 'custom',
  LocalShell = 'local_shell',
  Mcp = 'mcp',
}

/**
 * 工具输入
 * 参考: codex-rs/hooks/src/types.rs:104-121
 */
export type HookToolInput =
  | { inputType: 'function'; arguments: string }
  | { inputType: 'custom'; input: string }
  | { inputType: 'local_shell'; params: { command: string[]; workdir?: string; timeoutMs?: number } }
  | { inputType: 'mcp'; server: string; tool: string; arguments: string };

/**
 * AfterToolUse 请求数据
 * 参考: codex-rs/hooks/src/types.rs:124-138
 */
export interface AfterToolUseRequest {
  sessionId: string;
  turnId: string;
  callId: string;
  toolName: string;
  toolKind: HookToolKind;
  toolInput: HookToolInput;
  executed: boolean;
  success: boolean;
  durationMs: number;
  mutating: boolean;
  sandbox: string;
  sandboxPolicy: string;
  outputPreview: string;
}

/**
 * AfterToolUse 输出结果
 */
export interface AfterToolUseOutcome {
  hookEvents: HookCompletedEvent[];
}

// ============ HookPayload ============

/**
 * Hook 载荷 - 传递给 Hook 的完整数据
 * 参考: codex-rs/hooks/src/types.rs:63-73
 */
export type HookPayload =
  | { eventType: 'session_start'; sessionId: string; cwd: string; triggeredAt: string; data: SessionStartRequest }
  | { eventType: 'stop'; sessionId: string; cwd: string; triggeredAt: string; data: StopRequest }
  | { eventType: 'after_agent'; sessionId: string; cwd: string; triggeredAt: string; data: AfterAgentRequest }
  | { eventType: 'after_tool_use'; sessionId: string; cwd: string; triggeredAt: string; data: AfterToolUseRequest };

// ============ HookRunStatus ============

/**
 * Hook 运行状态
 * 参考: codex-rs/protocol/src/protocol.rs HookRunStatus
 */
export enum HookRunStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Stopped = 'stopped',
  Blocked = 'blocked',
  Timeout = 'timeout',
}

// ============ HookOutputEntry ============

/**
 * Hook 输出条目
 * 参考: codex-rs/protocol/src/protocol.rs HookOutputEntry
 */
export enum HookOutputEntryKind {
  Context = 'context',
  Error = 'error',
  Feedback = 'feedback',
  Stop = 'stop',
  Warning = 'warning',
}

export interface HookOutputEntry {
  kind: HookOutputEntryKind;
  text: string;
}

// ============ HookRunSummary ============

/**
 * Hook 运行摘要
 * 参考: codex-rs/protocol/src/protocol.rs HookRunSummary
 */
export interface HookRunSummary {
  hookName: string;
  eventName: HookEventName;
  matcher?: string;
  command: string;
  timeoutSec: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  status: HookRunStatus;
  entries: HookOutputEntry[];
}

// ============ HookCompletedEvent ============

/**
 * Hook 完成事件
 * 参考: codex-rs/protocol/src/protocol.rs HookCompletedEvent
 */
export interface HookCompletedEvent {
  turnId?: string;
  run: HookRunSummary;
}

// ============ CommandRunResult ============

/**
 * 命令执行结果
 * 参考: codex-rs/hooks/src/engine/command_runner.rs CommandRunResult
 */
export interface CommandRunResult {
  startedAt: number;
  completedAt: number;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

// ============ Hook Handler ============

/**
 * Hook 处理器配置
 * 参考: codex-rs/hooks/src/engine/dispatcher.rs ConfiguredHandler
 */
export interface ConfiguredHandler {
  eventName: HookEventName;
  matcher?: string;
  command: string;
  timeoutSec: number;
  statusMessage?: string;
  sourcePath: string;
  displayOrder: number;
}

// ============ Hook 函数类型 ============

/**
 * Hook 函数类型
 * 参考: codex-rs/hooks/src/types.rs:13
 */
export type HookFn = (payload: HookPayload) => Promise<HookResult>;

/**
 * Hook 定义
 * 参考: codex-rs/hooks/src/types.rs:39-43
 */
export interface Hook {
  name: string;
  func: HookFn;
}