/**
 * LLM Center 服务 (Electron 版本) - 暂时禁用
 * 
 * 注意：ahive-llm-center 模块暂时禁用
 * 这是一个占位实现，避免编译错误
 */

import log from 'electron-log';

// 类型定义
export interface IModelProvider {}
export interface ChatMessage {
  role: string;
  content: string;
}
export interface ChatResponse {
  content: string;
  usage?: any;
}
export interface ChatOptions {}
export interface UsageStats {}
export interface LLMCenterOptions {}
export interface AgentConfig {}

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  enabled: boolean;
}

export interface LLMCenterServiceConfig {
  providers: ProviderConfig[];
  defaultProvider?: string;
  dataDir?: string;
}

/**
 * LLM Center 服务类（占位实现）
 */
export class LLMCenterService {
  private config: LLMCenterServiceConfig;
  private initialized: boolean = false;

  constructor() {
    this.config = { providers: [] };
    log.info('[LLMCenterService] Created (disabled mode)');
  }

  async initialize(config: LLMCenterServiceConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
    log.info('[LLMCenterService] Initialized (disabled mode)');
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    log.warn('[LLMCenterService] chat() called but service is disabled');
    return { content: 'LLM Center service is disabled' };
  }

  async chatStream(messages: ChatMessage[], options?: ChatOptions): Promise<void> {
    log.warn('[LLMCenterService] chatStream() called but service is disabled');
  }

  getConfig(): LLMCenterServiceConfig {
    return this.config;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// 单例导出
export const llmCenterService = new LLMCenterService();
