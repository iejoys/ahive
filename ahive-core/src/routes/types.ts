/**
 * 路由层类型定义
 * 统一请求和响应类型
 */

import { IncomingMessage, ServerResponse } from 'http';

/**
 * 路由上下文
 */
export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  body?: any;
  query?: Record<string, string>;
  params?: Record<string, string>;
  userId?: string;
  sessionId?: string;
}

/**
 * 路由处理器
 */
export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

/**
 * 路由定义
 */
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: RouteHandler;
  middleware?: RouteHandler[];
}

/**
 * API 响应格式
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 分页参数
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * 流式响应事件
 */
export interface StreamEvent {
  type: 'data' | 'error' | 'done';
  data?: any;
  error?: string;
}

/**
 * 智能体状态
 */
export interface AgentStatus {
  id: string;
  type: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  lastActive?: string;
  currentTask?: string;
  metadata?: Record<string, any>;
}

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  metadata?: Record<string, any>;
}

/**
 * 模型信息
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  type: 'chat' | 'completion' | 'embedding';
  contextWindow?: number;
  capabilities?: string[];
}

/**
 * Provider 信息
 */
export interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  models: ModelInfo[];
  status: 'active' | 'inactive' | 'error';
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  required?: string[];
}

/**
 * 消息格式
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

/**
 * 聊天请求
 */
export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  metadata?: Record<string, any>;
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  id: string;
  choices: {
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * RPC 请求
 */
export interface RpcRequest {
  method: string;
  params?: any;
  id?: string | number;
}

/**
 * RPC 响应
 */
export interface RpcResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id?: string | number;
}