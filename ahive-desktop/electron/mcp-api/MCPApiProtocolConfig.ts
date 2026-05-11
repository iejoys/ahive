/**
 * MCP API 协议配置类型定义
 * 
 * 支持通过配置文件定义不同平台的 MCP API 规范
 * 新增平台只需添加配置，无需修改代码
 */

// ==================== 平台类型 ====================

/**
 * 平台类型（决定请求/响应格式）
 */
export type MCPApiPlatformType = 'bailian' | 'openai' | 'anthropic';

// ==================== 输入字段定义 ====================

/**
 * 输入字段类型
 */
export type InputFieldType = 'text' | 'password' | 'select' | 'number' | 'checkbox';

/**
 * 输入字段选项（用于 select 类型）
 */
export interface InputFieldOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * 输入字段定义
 * UI 根据此配置动态渲染表单
 */
export interface InputField {
  /** 字段名称（对应请求模板中的变量名） */
  name: string;
  /** 显示标签 */
  label: string;
  /** 字段类型 */
  type: InputFieldType;
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default?: string | number | boolean;
  /** 占位符 */
  placeholder?: string;
  /** 帮助说明 */
  description?: string;
  /** 选项列表（type=select 时） */
  options?: InputFieldOption[];
  /** 验证规则 */
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  /** 是否敏感字段（需要加密存储） */
  sensitive?: boolean;
}

// ==================== 请求模板 ====================

/**
 * 请求配置
 */
export interface MCPApiRequestConfig {
  /** 请求路径 */
  path: string;
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体模板 */
  template: Record<string, any>;
  /** 变量映射 */
  variableMapping?: Record<string, string>;
}

// ==================== 响应解析 ====================

/**
 * 响应解析配置
 */
export interface MCPApiResponseConfig {
  /** 响应字段提取路径（JSONPath） */
  paths: {
    text: string;
    usage?: string;
    inputTokens?: string;
    outputTokens?: string;
    totalTokens?: string;
    [key: string]: string | undefined;
  };
  /** 流式事件配置 */
  streaming?: {
    events: Record<string, {
      eventType: string;
      textField?: string;
      responseField?: string;
    }>;
  };
  /** 错误提取配置 */
  error?: {
    path: string;
    messagePath?: string;
  };
}

// ==================== 认证配置 ====================

/**
 * 认证配置
 */
export interface MCPApiAuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'api-key';
  header?: string;
  prefix?: string;
}

// ==================== 特性支持 ====================

/**
 * 平台特性支持
 */
export interface MCPApiFeatures {
  /** 是否支持流式输出 */
  streaming?: boolean;
  /** 是否支持多个 MCP Server */
  multipleMcpServers?: boolean;
  /** 是否支持工具审批 */
  toolApproval?: boolean;
  /** 最大 MCP Server 数量 */
  maxMcpServers?: number;
}

// ==================== 平台配置 ====================

/**
 * MCP API 平台配置（从 YAML 加载）
 */
export interface MCPApiPlatformConfig {
  /** 平台 ID */
  id: string;
  /** 平台名称 */
  name: string;
  /** 平台描述 */
  description?: string;
  /** 版本 */
  version?: string;
  
  /** 平台类型 */
  platformType: MCPApiPlatformType;
  
  /** 输入字段定义 */
  inputFields: InputField[];
  
  /** 请求配置 */
  request: MCPApiRequestConfig;
  
  /** 响应配置 */
  response: MCPApiResponseConfig;
  
  /** 认证配置 */
  auth?: MCPApiAuthConfig;
  
  /** 特性支持 */
  features?: MCPApiFeatures;
  
  /** 默认超时 */
  defaultTimeout?: number;
}

/**
 * MCP API 协议注册表（YAML 文件结构）
 */
export interface MCPApiProtocolRegistry {
  platforms: Record<string, MCPApiPlatformConfig>;
  defaultPlatform?: string;
}

// ==================== 用户配置实例 ====================

/**
 * MCP API 中的 MCP Server 配置
 */
export interface MCPApiServerConfig {
  /** Server 标签 */
  label: string;
  /** Server 描述 */
  description?: string;
  /** SSE 端点 */
  url: string;
  /** 请求头 */
  headers?: Record<string, string>;
}

/**
 * MCP API 用户配置实例（存储在 protocol-config.json）
 */
export interface MCPApiConfig {
  /** 配置 ID */
  id: string;
  /** 配置名称 */
  name: string;
  /** 配置描述 */
  description?: string;
  /** 是否启用 */
  enabled: boolean;
  
  /** 平台类型 */
  platformType: MCPApiPlatformType;
  
  /** 用户填写的字段值 */
  fieldValues: Record<string, any>;
  
  /** MCP Server 配置列表 */
  mcpServers: MCPApiServerConfig[];
  
  /** 创建时间 */
  createdAt?: string;
  /** 更新时间 */
  updatedAt?: string;
}

// ==================== 统一响应格式 ====================

/**
 * 统一的 MCP API 响应格式
 */
export interface UnifiedMCPApiResponse {
  /** 响应 ID */
  id: string;
  /** 状态 */
  status: 'completed' | 'failed' | 'streaming';
  
  /** 文本输出 */
  outputText: string;
  
  /** Token 用量 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  
  /** MCP 工具调用记录 */
  toolCalls?: {
    serverLabel: string;
    toolName: string;
    arguments: Record<string, any>;
    output: string;
  }[];
  
  /** 错误信息 */
  error?: string;
  
  /** 原始响应（调试用） */
  raw?: any;
}