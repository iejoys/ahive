/**
 * A2A 协议相关类型定义
 * 扩展自 storage.ts 中的基础类型
 */

/**
 * A2A 协议类型
 */
export type A2AProtocolType = 
  | 'a2a-standard'  // 标准 A2A 协议 (OpenCode 等)
  | 'openclaw'      // OpenClaw OpenResponses 协议
  | 'opencode';     // OpenCode (使用标准 A2A)

/**
 * 扩展的 A2A Agent 配置
 * 在基础配置上添加协议相关字段
 */
export interface ExtendedA2AAgentConfig {
  id: string;
  name: string;
  endpoint: string;
  agentId: string;
  
  // 协议相关
  protocolType: A2AProtocolType;
  supportsStreaming?: boolean;
  
  // 认证相关
  apiKey?: string;
  webhookUrl?: string;
  
  // 能力描述
  capabilities?: string[];
  description?: string;
  
  // 状态
  enabled: boolean;
  
  // 元数据
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A2A Agent Card
 */
export interface A2AAgentCard {
  agentId: string;
  name: string;
  description: string;
  url: string;
  provider?: {
    organization: string;
    url?: string;
  };
  capabilities: Array<{
    name: string;
    description?: string;
  }>;
  skills?: string[];
  version: string;
}

/**
 * A2A 任务状态
 */
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

/**
 * A2A 产物
 */
export interface A2AArtifact {
  type: string;
  content: string;
  uri?: string;
  mimeType?: string;
}
