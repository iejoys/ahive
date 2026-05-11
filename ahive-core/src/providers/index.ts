/**
 * LLM Provider 统一接口
 * 
 * 支持多种后端：
 * - local: 本地 GGUF 模型
 * - ollama: Ollama 服务
 * - openai: OpenAI / 兼容 API (DeepSeek, GLM, 通义千问等)
 */

import type { ChatMessage } from '../agents/index.js';

/**
 * Provider 类型
 */
export type ProviderType = 'local' | 'ollama' | 'openai';

/**
 * API Provider 预设配置
 */
export interface APIProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  description?: string;
}

/**
 * 预设的 API Provider 列表
 */
export const API_PRESETS: APIProviderPreset[] = [
  {
    id: 'bailian-coding',
    name: '阿里百炼 Coding Plan',
    endpoint: 'https://coding.dashscope.aliyuncs.com/v1',
    models: [
      'qwen3.5-plus',        // 推荐，支持图片，200K 上下文
      'glm-5',               // 智谱旗舰，200K 上下文
      'kimi-k2.5',           // 支持图片
      'MiniMax-M2.5',        // Agent 场景优秀
      'qwen3-max-2026-01-23',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'glm-4.7',
    ],
    defaultModel: 'qwen3.5-plus',
    description: '阿里百炼 Coding Plan - 聚合 Qwen/GLM/Kimi/MiniMax，首月 ¥7.9 起',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    description: 'OpenAI GPT 系列模型',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek 推理和代码模型',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air', 'glm-4'],
    defaultModel: 'glm-4-flash',
    description: '智谱 GLM 系列模型',
  },
  {
    id: 'qwen',
    name: '通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
    defaultModel: 'qwen-turbo',
    description: '阿里通义千问系列模型（按量付费）',
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    endpoint: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-8k',
    description: '月之暗面 Kimi 模型',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    endpoint: 'https://api.minimax.chat/v1',
    models: [
      'MiniMax-Text-01',
      'MiniMax-M1',
      'abab6.5-chat',
      'abab6.5s-chat',
      'abab5.5-chat',
      'abab5.5s-chat',
    ],
    defaultModel: 'MiniMax-Text-01',
    description: 'MiniMax 模型 - Agent 场景优秀，支持长上下文',
  },
  {
    id: 'minimax2',
    name: 'MiniMax M2.7',
    endpoint: 'https://api.minimaxi.com/v1',
    models: [
      'MiniMax-M2.7',          // MiniMax M2.7 最新模型
      'MiniMax-Text-01',       // 强推理能力
      'MiniMax-M1',            // 多模态模型
      'abab6.5-chat',          // 6.5版本
      'abab6.5s-chat',         // 6.5s版本，快速响应
    ],
    defaultModel: 'MiniMax-M2.7',
    description: 'MiniMax M2.7 - 最新 Agent 专用模型，支持 Function Calling',
  },
  {
    id: 'custom',
    name: '自定义 API',
    endpoint: '',
    models: [],
    defaultModel: '',
    description: '自定义 OpenAI 兼容 API',
  },
];

/**
 * Provider 配置
 */
export interface ProviderConfig {
  /** Provider 类型 */
  type: ProviderType;
  
  // ===== 本地模型配置 =====
  /** 本地模型路径 */
  modelPath?: string;
  /** 模型名称 */
  modelName?: string;
  /** GPU 层数 */
  gpuLayers?: number;
  /** 线程数 */
  threads?: number;
  /** 上下文长度 */
  contextSize?: number;
  /** 批次序列数（并发调用支持） */
  sequences?: number;
  
  // ===== Ollama 配置 =====
  /** Ollama 服务地址 */
  ollamaHost?: string;
  /** Ollama 模型名 */
  ollamaModel?: string;
  /** API 基础 URL (通用，用于 Ollama/OpenAI 等) */
  baseUrl?: string;
  
  // ===== OpenAI/API 配置 =====
  /** API 端点 */
  apiEndpoint?: string;
  /** API Key */
  apiKey?: string;
  /** API 模型名 */
  apiModel?: string;
  /** 预设 ID */
  presetId?: string;
  
  // ===== 通用配置 =====
  /** 温度 */
  temperature?: number;
  /** 最大 Token */
  maxTokens?: number;
  /** 请求超时 (ms) */
  timeout?: number;
}

/**
 * LLM 响应
 */
export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  toolCalls?: ToolCall[];
  reasoningContent?: string;
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Provider 健康检查结果
 */
export interface HealthCheckResult {
  available: boolean;
  error?: string;
  models?: string[];
  modelInfo?: {
    name: string;
    size?: string;
    contextLength?: number;
  };
}

/**
 * 流式响应回调
 */
export interface StreamCallbacks {
  /** 收到文本增量 */
  onDelta?: (delta: string) => void;
  /** 收到思考/推理增量 (reasoning_content) */
  onThinkingDelta?: (delta: string) => void;
  /** 收到工具调用 */
  onToolCall?: (toolCall: ToolCall) => void;
  /** 完成 */
  onComplete?: (response: LLMResponse) => void;
  /** 错误 */
  onError?: (error: Error) => void;
}

/**
 * LLM Provider 接口
 */
export interface ILLMProvider {
  /** Provider 类型 */
  readonly type: ProviderType;
  
  /** Provider 名称 */
  readonly name: string;
  
  /**
   * 初始化 Provider
   */
  initialize(): Promise<void>;
  
  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean;
  
  /**
   * 聊天完成
   */
  chat(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse>;
  
  /**
   * 流式聊天完成
   */
  chatStream?(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    config?: Partial<ProviderConfig>
  ): Promise<LLMResponse>;
  
  /**
   * 隔离调用（不记录历史）
   */
  chatIsolated?(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse>;
  
  /**
   * 健康检查
   */
  healthCheck(): Promise<HealthCheckResult>;
  
  /**
   * 获取当前配置
   */
  getConfig(): ProviderConfig;
  
  /**
   * 更新配置
   */
  updateConfig(config: Partial<ProviderConfig>): void;
  
  /**
   * 释放资源
   */
  dispose?(): Promise<void>;
}

/**
 * Providers 配置文件结构
 */
export interface ProvidersConfigFile {
  /** 当前使用的 Provider */
  currentProvider: ProviderType;
  
  /** 当前 Provider 配置 */
  currentConfig: ProviderConfig;
  
  /** 保存的 API Provider 配置 */
  savedProviders: SavedProvider[];
  
  /** 通用设置 */
  settings: {
    defaultTemperature: number;
    defaultMaxTokens: number;
    defaultTimeout: number;
  };
}

/**
 * 保存的 Provider 配置
 */
export interface SavedProvider {
  id: string;
  name: string;
  type: ProviderType;
  presetId?: string;
  config: ProviderConfig;
  createdAt: string;
  lastUsed?: string;
}

/**
 * 创建默认配置
 */
export function createDefaultProvidersConfig(): ProvidersConfigFile {
  return {
    currentProvider: 'local',
    currentConfig: {
      type: 'local',
      modelName: 'Qwen2.5-1.5B-Instruct',
      temperature: 0.7,
      maxTokens: 2048,
    },
    savedProviders: [],
    settings: {
      defaultTemperature: 0.7,
      defaultMaxTokens: 2048,
      defaultTimeout: 60000,
    },
  };
}

// 导出所有 Provider
export { LocalProvider } from './local-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export { OpenAIProvider, type ToolDefinition } from './openai-provider.js';
export { MiniMaxProvider, MINIMAX_MODELS, isMiniMaxModel, isInternationalAPI } from './minimax-provider.js';
export { ProviderManager, getProviderManager } from './provider-manager.js';