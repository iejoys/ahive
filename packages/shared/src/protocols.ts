// ============================================================================
// MCP + A2A 协议类型定义
// 文档: MCP_A2A_INTEGRATION_DESIGN.md
// 创建日期: 2026-03-05
// ============================================================================

// ============================================================================
// MCP 类型定义 (Model Context Protocol)
// ============================================================================

/** MCP 工具定义 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 服务器配置 */
export interface MCPServerConfig {
id: string;
name: string;
command: string;
args?: string[];
env?: Record<string, string>;
url?: string;              // HTTP 模式
enabledTools?: string[];   // 允许的工具列表
disabledTools?: string[];  // 禁用的工具列表
enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** MCP 服务器状态 */
export interface MCPServerStatus {
  id: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  availableTools: MCPTool[];
  error?: string;
  lastHeartbeat: string;
}

/** MCP 工具调用请求 */
export interface MCPToolCallRequest {
  serverId: string;
  toolName: string;
  params: Record<string, unknown>;
}

/** MCP 工具调用结果 */
export interface MCPToolCallResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// A2A 类型定义 (Agent-to-Agent Protocol)
// ============================================================================

/** A2A Agent 能力 */
export interface A2AAgentCapability {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

/** A2A Agent Card - Agent 元数据描述 */
export interface A2AAgentCard {
  agentId: string;
  name: string;
  description: string;
  url: string;
  provider?: {
    organization: string;
    url?: string;
  };
  capabilities: A2AAgentCapability[];
  skills?: string[];
  version: string;
}

/** A2A Agent 配置 */
export interface A2AAgentConfig {
  id: string;
  name: string;
  endpoint: string;          // A2A Agent 端点
  agentId: string;           // 外部 Agent ID
  webhookUrl?: string;       // 回调地址
  capabilities?: string[];   // 能力描述
  enabled: boolean;
  protocolType?: 'a2a-standard' | 'openclaw' | 'opencode' | 'ahivecore';  // 协议类型
  apiKey?: string;           // API 密钥
  customFields?: Record<string, any>;  // 动态字段存储
  createdAt?: string;
  updatedAt?: string;
}


/** A2A 任务状态 */
export interface A2ATaskStatus {
  id: string;
  status: 'pending' | 'submitted' | 'working' | 'completed' | 'failed' | 'canceled';
  message?: {
    role: 'user' | 'agent';
    content: string;
  };
  artifacts?: A2AArtifact[];
  result?: unknown;
  error?: string;
}

/** A2A 产物 */
export interface A2AArtifact {
  type: string;
  content: string;
  uri?: string;
  mimeType?: string;
}

/** A2A Webhook 回调载荷 */
export interface A2AWebhookPayload {
  taskId: string;
  status: string;
  message?: { content: string };
  artifacts?: A2AArtifact[];
  nonce?: string;  // 幂等性标识
}

// ============================================================================
// 扩展类型定义
// ============================================================================

/** 扩展的 Agent 运行时类型 */
export type ExtendedAgentRuntimeType = 
  | 'opencode'    // OpenCode CLI
  | 'openclaw'    // OpenClaw
  | 'mcp'         // MCP 代理的外部 Agent
  | 'a2a'         // A2A 代理的外部 Agent
  | 'mock'        // 模拟 Agent
  | 'custom'      // 自定义
  | 'claude';     // Claude

/** 任务定义 (简化版，避免循环导入) */
export interface TaskDefinition {
  id: string;
  agentId: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string[];
  createdAt: string;
}

/** 任务执行结果 */
export interface TaskResult {
  success: boolean;
  output: string[];
  artifacts?: A2AArtifact[];
  error?: string;
  duration?: number;
  metadata: {
    protocol: 'mcp' | 'a2a' | 'internal';
    agentType: ExtendedAgentRuntimeType;
    toolsUsed?: string[];
    asyncTaskId?: string;
  };
  /** 使用量统计 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
  };
}

/** 执行上下文 */
export interface ExecutionContext {
  cwd?: string;
  env?: Record<string, string>;
  mcpTools?: string[];
  a2aWebhookUrl?: string;
  asyncMode?: boolean;
  timeout?: number;
}

/** 工具调用解析结果 */
export interface ToolCall {
  server: string;
  tool: string;
  params: Record<string, unknown>;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 创建 MCP Server 请求 */
export interface CreateMCPServerRequest {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** 创建 A2A Agent 请求 */
export interface CreateA2AAgentRequest {
  name: string;
  endpoint: string;
  agentId: string;
  webhookUrl?: string;
  capabilities?: string[];
}

/** MCP Server 列表响应 */
export interface MCPServerListResponse extends MCPServerConfig {
  status: MCPServerStatus['status'];
}

/** A2A Agent 列表响应 */
export interface A2AAgentListResponse extends A2AAgentConfig {
  card?: A2AAgentCard;
}

// ============================================================================
// A2A 协议扩展类型 (2026-03-06)
// ============================================================================

/** A2A 协议类型 */
export type A2AProtocolType = 
  | 'a2a-standard'  // 标准 A2A 协议 (OpenCode 等)
  | 'openclaw'      // OpenClaw OpenResponses 协议
  | 'opencode'      // OpenCode (使用标准 A2A)
  | 'ahivecore';    // AHIVECORE 本地智能体引擎

/** 扩展的 A2A Agent 配置 */
export interface ExtendedA2AAgentConfig extends A2AAgentConfig {
  protocolType: A2AProtocolType;
  supportsStreaming?: boolean;
  apiKey?: string;
  description?: string;
}

// ============================================================================
// A2A SSE 流式通信类型 (2026-03-06)
// ============================================================================

/** SSE 流式事件类型 */
export type A2AStreamEventType = 
  | 'delta'           // 文本增量（流式输出）
  | 'status_update'   // 任务状态更新
  | 'artifact_update' // 产物更新
  | 'message'         // 完整消息
  | 'error';          // 错误

/** SSE 流式事件 */
export interface A2AStreamEvent {
  type: A2AStreamEventType;
  data: A2AStreamEventData;
}

/** SSE 流式事件数据联合类型 */
export type A2AStreamEventData = 
  | A2ATextDelta 
  | A2ATaskStatusUpdate 
  | A2ATaskArtifactUpdate 
  | A2AAgentMessage
  | A2AErrorInfo;

/** 文本增量（流式输出） */
export interface A2ATextDelta {
  text: string;
  isFinal?: boolean;
}

/** 任务状态更新 */
export interface A2ATaskStatusUpdate {
  taskId: string;
  status: 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  message?: {
    role: 'agent';
    content: string;
  };
  progress?: number;
}

/** 任务产物更新 */
export interface A2ATaskArtifactUpdate {
  taskId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
}

/** Agent 消息 */
export interface A2AAgentMessage {
  role: 'agent';
  content: string;
  parts?: A2AMessagePart[];
}

/** 消息部分 */
export interface A2AMessagePart {
  type: 'text' | 'image' | 'file';
  text?: string;
  data?: string;
  mimeType?: string;
}

/** 错误信息 */
export interface A2AErrorInfo {
  code: string;
  message: string;
  details?: unknown;
}

/** 流式回调函数类型 */
export type A2AStreamCallback = (event: A2AStreamEvent) => void;
