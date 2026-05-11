/**
 * MCP 能力管理与技能持久化 - 类型定义
 * 
 * @created 2026-03-21
 */

// ==================== MCP 相关类型 ====================

/**
 * MCP 工具定义
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      default?: any;
      [key: string]: any;
    }>;
    required?: string[];
    [key: string]: any;
  };
}

/**
 * MCP 服务器配置
 */
export interface MCPServer {
  serverId: string;
  serverType: 'mcp-server' | 'mcp-api' | 'websocket' | 'game_engine' | string;
  apiEndpoint: string;
  agentKey: string;
  urlPattern: string;
  tools: MCPTool[];
  agentIds?: string[]; // 已授权使用该服务器的智能体 ID 列表
  instruction?: {
    usage?: string;
    url_pattern?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  updatedAt: string;
  createdAt: string;
}

/**
 * capability_update 消息负载
 */
export interface CapabilityUpdatePayload {
  apiEndpoint?: string;
  agentKey?: string;
  agentIds?: string[];
  capabilities?: Array<{
    server: string;
    serverType: 'mcp-server' | 'mcp-api';
    tools: MCPTool[];
    serverId?: string; // 兼容旧版或备用字段
  }>;
  serverId?: string; // 单服务器更新
  name?: string;     // 服务器名称
  tools?: MCPTool[];  // 单服务器工具列表
  action?: 'update' | 'remove';
  instruction?: {
    usage?: string;
    url_pattern?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  changes?: {
    added?: Array<{
      server: string;
      serverType: 'mcp-server' | 'mcp-api';
      tools: MCPTool[];
    }>;
    removed?: Array<{
      server: string;
      serverType: 'mcp-server' | 'mcp-api';
      tools?: string[];
    }>;
  };
}

/**
 * capability_update 消息
 */
export interface CapabilityUpdateMessage {
  type: 'capability_update';
  agentId: string;
  action: 'update' | 'remove';
  payload: CapabilityUpdatePayload;
}

// ==================== Skill 相关类型 ====================

/**
 * 技能配置
 */
export interface SkillConfig {
  id: string;
  agentId?: string; // 关联的智能体 ID
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];

  // 触发条件
  triggers: string[];

  // 提示词模板
  systemPrompt?: string;
  userPromptTemplate?: string;

  // 工具配置
  tools?: string[];

  // 执行配置
  config?: {
    maxIterations?: number;
    timeout?: number;
    model?: string;
  };

  // 元数据
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
}

/**
 * 技能存储结构
 */
export interface SkillsStore {
  version: string;
  skills: SkillConfig[];
}

// ==================== MCP 存储类型 ====================

/**
 * MCP 服务器存储结构
 */
export interface MCPServersStore {
  version: string;
  servers: MCPServer[];
}

// ==================== 能力摘要类型 ====================

/**
 * 能力摘要（用于注入系统提示词）
 */
export interface CapabilitiesSummary {
  mcpTools: Array<{
    serverId: string;
    tool: MCPTool;
  }>;
  skills: SkillConfig[];
}