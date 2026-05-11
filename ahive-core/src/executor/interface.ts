/**
 * 智能体执行器接口
 * 
 * 抽象执行层，支持两种模式：
 * - LocalExecutor: 同进程执行（普通模式）
 * - IsolatedExecutor: 子进程执行（隔离模式）
 */

/**
 * 执行参数
 */
export interface ExecuteParams {
  agentId: string;
  message: string;
  userId?: string;
  appKey?: string;
  sessionId?: string;
  systemPrompt?: string;
  sessionMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  modelConfig?: any;
}

/**
 * 执行结果
 */
export interface ExecuteResult {
  content: string;
  toolCallsExecuted: number;
  iterations: number;
  sessionId?: string;
}

/**
 * 流式执行事件
 * 支持原始事件类型（如 tool_start, tool_end）和转换后的事件类型
 */
export type StreamEvent = 
  // 转换后的事件类型
  | { type: 'status'; status: string; message: string; tool?: string; args?: any }
  | { type: 'text_delta'; delta: string; itemId?: string }
  | { type: 'thinking-delta'; delta: string; itemId?: string; timestamp?: number }
  | { type: 'exec_output'; callId: string; output: string; stream?: string }
  | { type: 'approval_request'; callId: string; toolName: string; args: any }
  | { type: 'heartbeat'; timestamp: number }
  | { type: 'error'; error: string }
  | { type: 'done'; content: string; toolCallsExecuted: number; iterations: number }
  // 原始事件类型（透传给前端）
  | { type: 'tool_start'; toolName: string; args?: any; timestamp?: number }
  | { type: 'tool_end'; toolName: string; success: boolean; duration?: number; result?: string; timestamp?: number }
  | { type: 'tool_error'; toolName: string; error: string; timestamp?: number }
  | { type: 'tool_calls_detected'; count: number; tools?: string[]; timestamp?: number }
  | { type: 'iteration_start'; iteration: number; timestamp?: number }
  | { type: 'llm_call_start'; timestamp?: number }
  | { type: 'llm_call_end'; timestamp?: number }
  | { type: 'llm_prompt'; messages?: Array<{ role: string; content: string }>; categories?: Record<string, Array<{ role: string; content: string }>>; totalMessages?: number; timestamp?: number }
  | { type: 'exec_command_begin'; command: string; timestamp?: number }
  | { type: 'exec_command_end'; command: string; success: boolean; exitCode?: number; timestamp?: number }
  | { type: 'turn_started'; turnId?: string; timestamp?: number }
  | { type: 'turn_complete'; iterations: number; toolCallsExecuted: number; lastAgentMessage?: string; timestamp?: number }
  | { type: 'agent_message'; content: string; timestamp?: number }
  | { type: 'agent_message_delta'; delta: string; itemId?: string; timestamp?: number }
  // 智能体间对话事件
  | { type: 'agent_chat'; fromAgentId: string; fromAgentName?: string; toAgentId: string; toAgentName?: string; message: string; timestamp?: number };

/**
 * 流式执行回调
 */
export type StreamCallback = (event: StreamEvent) => void;

/**
 * 智能体执行器接口
 */
export interface AgentExecutor {
  /**
   * 执行对话（非流式）
   */
  execute(params: ExecuteParams): Promise<ExecuteResult>;

  /**
   * 执行对话（流式）
   */
  executeStream(
    params: ExecuteParams,
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<ExecuteResult>;
}

/**
 * 执行器配置
 */
export interface ExecutorConfig {
  providerManager?: any;
  toolRegistry?: any;
  configStore?: any;
  unifiedAgentSystem?: any;
  codexExecutor?: any;
  processManager?: any;
}