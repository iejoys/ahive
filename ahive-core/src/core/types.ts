/**
 * Core Types - 核心类型定义
 * 
 * 避免循环依赖，将类型定义单独存放
 */

/**
 * 应用配置
 */
export interface AppConfig {
  port?: number;
  host?: string;
  mode?: 'local' | 'isolated';
  modelMode?: 'embedded' | 'ollama';
  ollamaHost?: string;
  ollamaModel?: string;
}

/**
 * 请求上下文
 */
export interface RequestContext {
  /** 请求 ID */
  requestId: string;
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** 请求时间 */
  timestamp: Date;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}