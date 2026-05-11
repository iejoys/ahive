/**
 * A2A 协议配置类型定义
 * 
 * 支持通过配置文件定义不同 Agent 的协议规范
 * 新增 Agent 只需添加配置，无需修改代码
 */

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

// ==================== 认证配置 ====================

/**
 * 认证类型
 */
export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key';

/**
 * 认证配置
 */
export interface AuthConfig {
  /** 认证类型 */
  type: AuthType;
  /** Header 名称 (默认 Authorization) */
  header?: string;
  /** 前缀 (如 Bearer ) */
  prefix?: string;
  /** API Key 的位置: header, query, body */
  location?: 'header' | 'query' | 'body';
  /** 查询参数名 (location=query 时) */
  queryParam?: string;
  /** Body 字段名 (location=body 时) */
  bodyField?: string;
}

// ==================== 端点配置 ====================

/**
 * 端点配置
 */
export interface EndpointConfig {
  /** 端点路径，支持变量替换 ${sessionId} */
  path: string;
  /** HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** 是否流式 */
  stream?: boolean;
  /** 超时时间 (ms) */
  timeout?: number;
  /** 额外 Headers */
  headers?: Record<string, string>;
}

// ==================== 会话配置 ====================

/**
 * 会话创建配置
 */
export interface SessionConfig {
  /** 创建会话的端点 */
  create?: EndpointConfig;
  /** 获取会话的端点 */
  get?: EndpointConfig;
  /** 删除会话的端点 */
  delete?: EndpointConfig;
  /** Session ID 在响应中的 JSONPath */
  idPath: string;
  /** 是否需要持久化 Session */
  persist?: boolean;
}

// ==================== 请求配置 ====================

/**
 * 请求模板配置
 */
export interface RequestTemplateConfig {
  /** 请求体模板，支持变量替换 */
  template: Record<string, any>;
  /** Content-Type (默认 application/json) */
  contentType?: string;
  /** 变量映射：将标准变量映射到模板变量 */
  variableMapping?: Record<string, string>;
}

// ==================== 响应配置 ====================

/**
 * JSONPath 配置
 */
export interface JsonPathConfig {
  /** 提取文本的 JSONPath */
  text?: string;
  /** 提取状态的 JSONPath */
  status?: string;
  /** 提取错误信息的 JSONPath */
  error?: string;
  /** 提取消息 ID 的 JSONPath */
  messageId?: string;
  /** 提取使用量的 JSONPath */
  usage?: string;
}

/**
 * 响应解析配置
 */
export interface ResponseParserConfig {
  /** JSONPath 提取配置 */
  paths: JsonPathConfig;
  /** 状态值映射 */
  statusMapping?: Record<string, 'pending' | 'working' | 'completed' | 'failed' | 'canceled'>;
  /** 文本提取方式 */
  textExtraction?: 'single' | 'array' | 'concat';
  /** 数组分隔符 (textExtraction=concat 时) */
  arraySeparator?: string;
}

// ==================== SSE 配置 ====================

/**
 * SSE 事件配置
 */
export interface SSEEventConfig {
  /** 事件类型名称 */
  eventType: string;
  /** 数据字段的 JSONPath */
  dataPath?: string;
  /** 文本字段的 JSONPath */
  textField?: string;
  /** 完成标志 */
  doneFlag?: string | boolean;
}

/**
 * SSE 配置
 */
export interface SSEConfig {
  /** SSE 端点 */
  endpoint: EndpointConfig;
  /** 事件类型配置 */
  events: {
    /** 连接成功事件 */
    connected?: string;
    /** 心跳事件 */
    heartbeat?: string;
    /** 文本增量事件 */
    textDelta?: SSEEventConfig;
    /** 文本完成事件 */
    textDone?: SSEEventConfig;
    /** 消息完成事件 */
    messageComplete?: SSEEventConfig;
    /** 错误事件 */
    error?: SSEEventConfig;
  };
  /** 事件数据格式: json, text */
  dataFormat?: 'json' | 'text';
  /** 事件数据前缀 (默认 "data: ") */
  dataPrefix?: string;
}

// ==================== 重试配置 ====================

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔 (ms) */
  retryDelay: number;
  /** 重试条件：状态码或错误信息 */
  retryOn?: (string | number)[];
  /** 指数退避 */
  exponentialBackoff?: boolean;
}

// ==================== 完整协议配置 ====================

/**
 * A2A 协议完整配置
 */
export interface A2AProtocolConfig {
  /** 协议 ID */
  id: string;
  /** 协议名称 */
  name: string;
  /** 协议版本 */
  version?: string;
  /** 协议描述 */
  description?: string;
  
  /** 认证配置 */
  auth: AuthConfig;
  
  /** 会话配置 (可选) */
  session?: SessionConfig;
  
  /** 输入字段定义（UI 动态渲染表单） */
  inputFields?: InputField[];
  
  /** 发送消息端点 */
  sendMessage: EndpointConfig & {
    /** 请求模板 */
    request: RequestTemplateConfig;
    /** 响应解析 */
    response: ResponseParserConfig;
  };
  
  /** SSE 配置 (可选) */
  sse?: SSEConfig;
  
  /** 异步任务端点 (可选) */
  asyncTask?: {
    /** 创建异步任务 */
    create?: EndpointConfig;
    /** 查询任务状态 */
    getStatus?: EndpointConfig;
    /** 取消任务 */
    cancel?: EndpointConfig;
  };
  
  /** 健康检查端点 (可选) */
  healthCheck?: EndpointConfig;
  
  /** 重试配置 */
  retry?: RetryConfig;
  
  /** 默认超时 (ms) */
  defaultTimeout?: number;
  
  /** 默认 Provider ID */
  defaultProvider?: string;
  
  /** 默认模型 */
  defaultModel?: string;
  
  /** 默认值配置 */
  defaults?: {
    provider?: string;
    model?: string;
    [key: string]: any;
  };
  
  /** 支持的功能 */
  features?: {
    streaming?: boolean;
    async?: boolean;
    session?: boolean;
    tools?: boolean;
    files?: boolean;
    images?: boolean;
  };
}

// ==================== 协议注册表 ====================

/**
 * 协议注册表
 */
export interface A2AProtocolRegistry {
  /** 协议列表 */
  protocols: A2AProtocolConfig[];
  /** 默认协议 */
  defaultProtocol?: string;
}

// ==================== 运行时上下文 ====================

/**
 * 请求上下文 - 用于变量替换
 */
export interface RequestContext {
  /** 消息内容 */
  message: string;
  /** 模型 ID */
  model?: string;
  /** Provider ID */
  provider?: string;
  /** Agent ID */
  agentId?: string;
  /** Session ID */
  sessionId?: string;
  /** 是否流式 */
  stream?: boolean;
  /** 用户 ID */
  userId?: string;
  /** API Key */
  apiKey?: string;
  /** Webhook URL */
  webhookUrl?: string;
  /** 自定义变量 */
  custom?: Record<string, any>;
}

/**
 * 解析后的请求
 */
export interface ParsedRequest {
  /** 请求 URL */
  url: string;
  /** 请求方法 */
  method: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体 */
  body?: any;
  /** 超时时间 */
  timeout?: number;
}

/**
 * 解析后的响应
 */
export interface ParsedResponse {
  /** 消息 ID */
  messageId?: string;
  /** 状态 */
  status: 'pending' | 'working' | 'completed' | 'failed' | 'canceled';
  /** 文本内容 */
  text: string;
  /** 错误信息 */
  error?: string;
  /** 原始响应 */
  raw: any;
  /** 使用量 */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/**
 * SSE 事件
 */
export interface SSEEventData {
  /** 事件类型 */
  type: 'connected' | 'heartbeat' | 'text_delta' | 'text_done' | 'complete' | 'error';
  /** 文本增量 */
  text?: string;
  /** 完整文本 */
  fullText?: string;
  /** 状态 */
  status?: string;
  /** 错误信息 */
  error?: string;
  /** 原始数据 */
  raw?: any;
}