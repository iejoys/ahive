/**
 * 进程隔离架构 - 类型定义
 */

import type { CapabilityUpdateMessage } from '../capabilities/types.js';

// ==================== 智能体类型 ====================

/** 智能体类型 */
export type AgentType = 'ahive-coder' | 'ahive-worker';

/** 智能体状态枚举 */
export enum AgentStatus {
  Idle = 'idle',
  Running = 'running',
  Waiting = 'waiting',
  Error = 'error',
  Stopped = 'stopped',
  Initialized = 'initialized',
  Interrupted = 'interrupted',
}

// ==================== 智能体配置 ====================

/** 智能体模型配置 */
export interface AgentModelConfig {
  provider?: 'openai' | 'anthropic' | 'ollama' | 'local' | 'bailian' | 'custom';
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

/** 智能体配置 */
export interface AgentConfig {
  agentId: string;
  agentType: AgentType;
  modelConfig?: AgentModelConfig;
  systemPrompt?: string;
  /** 角色ID（仅适用于 ahive-worker 类型） */
  roleId?: string;
  /** 智能体昵称 */
  nickname?: string;
  /** 工具注册表 */
  toolRegistry?: any;
  /** LLM 服务 */
  llmService?: any;
  /** 记忆系统 */
  memorySystem?: any;
}

/** 智能体进程配置 */
export interface AgentProcessConfig extends AgentConfig {
  maxRestarts?: number;
  restartDelayMs?: number;
  healthCheckIntervalMs?: number;
}

/** 智能体进程信息 */
export interface AgentProcessInfo {
  agentId: string;
  agentType: AgentType;
  status: AgentStatus;
  pid?: number;
  startTime: number;
  restartCount: number;
  lastActiveTime: number;
  memoryUsage?: NodeJS.MemoryUsage;
}

// ==================== IPC 消息类型 ====================

/** IPC 消息基础接口 */
export interface IPCMessage {
  type: string;
  agentId?: string;
  timestamp?: number;
  [key: string]: any;
}

/** 初始化请求 */
export interface InitRequest {
  type: 'init';
  agentId: string;
  agentType: AgentType;
  modelConfig?: AgentModelConfig;
  /** 角色ID（仅适用于 ahive-worker 类型） */
  roleId?: string;
}

/** 执行请求 */
export interface ExecuteRequest {
  type: 'execute';
  prompt: string;
  systemPrompt?: string;
  sessionMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  modelConfig?: AgentModelConfig;
}

/** 处理消息请求 */
export interface HandleMessageRequest {
  type: 'handleMessage';
  from: string;
  message: string;
  /** 回复的消息 ID */
  replyTo?: string;
  /** 是否需要回复 */
  requireReply?: boolean;
  /** 元数据（用于企业微信会话追踪等） */
  metadata?: Record<string, unknown>;
}

/** 项目配置更新消息 */
export interface ProjectPromptUpdateMessage {
  type: 'project_prompt_update';
  workflowId: string;
  agentId: string;
  content: string;
  version: number;
  mtime: number;
}

/** Worker 消息联合类型 */
export type WorkerMessage = 
  | InitRequest
  | ExecuteRequest
  | { type: 'activate'; prompt: string; systemPrompt?: string; sessionMessages?: Array<{ role: string; content: string }>; modelConfig?: AgentModelConfig }
  | { type: 'interrupt' }
  | { type: 'health_check' }
  | { type: 'stop'; reason?: string }
  | { type: 'user_input'; input: string }
  | { type: 'rpc_call'; id: string; method: string; args: any }
  | { type: 'message'; payload: any }
  | { type: 'agent_message'; from: string; to: string; message: any; timestamp?: number }
  | { type: 'set_workdir'; workdir: string }
  | HandleMessageRequest
  | CapabilityUpdateMessage
  | ProjectPromptUpdateMessage;

/** Worker 响应 */
export interface WorkerResponse {
  type: 'response' | 'error' | 'stream_event' | 'health_response' | 'stopped' | 'ready' | 'status_update';
  success?: boolean;
  content?: string;
  error?: string;
  stack?: string;
  status?: AgentStatus;
  result?: any;
  eventType?: string;
  data?: any;
  agentId?: string;
  agentType?: AgentType;
  pid?: number;
  isReady?: boolean;
  iterations?: number;
  toolCallsExecuted?: number;
  toolCalls?: ToolCallResult[];
  uptime?: number;
  memoryUsage?: NodeJS.MemoryUsage;
}

/** 智能体间消息 */
export interface AgentToAgentMessage {
  type: 'a2a_message';
  fromAgentId: string;
  toAgentId: string;
  message: string;
  messageType: 'task' | 'query' | 'response';
  /** 消息 ID（用于追踪回复） */
  messageId?: string;
  /** 是否需要回复 */
  requireReply?: boolean;
  /** 回复的消息 ID */
  replyTo?: string;
}

/** 智能体间消息（带回复支持） */
export interface AgentMessageWithReply {
  type: 'agent_message';
  from: string;
  to: string;
  message: any;
  timestamp?: number;
  /** 消息 ID（用于追踪回复） */
  messageId?: string;
  /** 是否需要回复 */
  requireReply?: boolean;
  /** 回复的消息 ID */
  replyTo?: string;
}

/** 待回复的消息 */
export interface PendingReply {
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  resolve: (reply: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/** 转发消息 */
export interface ForwardMessage {
  type: 'forward';
  toAgentId: string;
  fromAgentId: string;
  message: string;
  messageType: 'task' | 'query' | 'response';
}

// ==================== 工具调用 ====================

/** 工具调用请求 */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/** 工具调用结果 */
export interface ToolCallResult {
  callId: string;
  toolName: string;
  success: boolean;
  result: string;
}

// ==================== RPC 类型 ====================

/** RPC 调用请求 */
export interface RPCCallRequest {
  type: 'rpc_call';
  callId: string;
  method: string;
  args: any;
}

/** RPC 调用响应 */
export interface RPCCallResponse {
  type: 'rpc_response';
  callId: string;
  result?: any;
  error?: string;
}

// ==================== 事件类型 ====================

/** 进程管理器事件映射 */
export interface ProcessManagerEventMap {
  'agent:ready': { agentId: string; agentType: AgentType };
  'agent:exit': { agentId: string; code: number | null; signal: string | null };
  'agent:restarted': { agentId: string; count: number };
  'agent:restart_failed': { agentId: string; error: Error };
  'agent:max_restarts': { agentId: string; count: number };
  'agent:stopped': { agentId: string };
  'agent:timeout': { agentId: string };
  'error': { agentId: string; error: Error };
  'message': { from: string; message: IPCMessage };
}