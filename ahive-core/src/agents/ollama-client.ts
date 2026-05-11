/**
 * Ollama 本地模型客户端
 * 
 * 功能：
 * - 调用本地 Ollama 服务（http://localhost:11434）
 * - 无需 API Key，完全本地运行
 * - 支持 Qwen、DeepSeek、Llama 等开源模型
 */

import type { LLMClient, LLMResponse, ChatMessage, ModelConfig, TokenUsage } from './index.js';
import { logger } from '../utils/index.js';

/**
 * Ollama 配置
 */
export interface OllamaConfig {
  /** Ollama 服务地址 */
  baseUrl?: string;
  /** 默认模型 */
  model?: string;
  /** 温度 */
  temperature?: number;
  /** 最大 Token */
  maxTokens?: number;
  /** 请求超时（毫秒） */
  timeout?: number;
}

/**
 * Ollama 响应格式
 */
interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama 模型列表响应
 */
interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Ollama 客户端实现
 */
export class OllamaClient implements LLMClient {
  private baseUrl: string;
  private defaultModel: string;
  private temperature: number;
  private maxTokens: number;
  private timeout: number;

  constructor(config?: OllamaConfig) {
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.defaultModel = config?.model || process.env.OLLAMA_MODEL || 'qwen2.5:3b';
    this.temperature = config?.temperature ?? 0.7;
    this.maxTokens = config?.maxTokens || 2048;
    this.timeout = config?.timeout || 60000; // 60 秒超时

    logger.info(`[Ollama] 客户端初始化: ${this.baseUrl}, 模型: ${this.defaultModel}`);
  }

  /**
   * 聊天完成
   */
  async chat(messages: ChatMessage[], config?: ModelConfig): Promise<LLMResponse> {
    const model = config?.name || this.defaultModel;
    const temperature = config?.temperature ?? this.temperature;
    const maxTokens = config?.maxTokens || this.maxTokens;

    const startTime = Date.now();

    try {
      // 使用 OpenAI 兼容 API（更标准化）
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
            temperature,
            max_tokens: maxTokens,
            stream: false,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${error}`);
      }

      const data = await response.json() as any as any;
      const duration = Date.now() - startTime;

      logger.info(`[Ollama] 响应成功: ${model}, 耗时: ${duration}ms`);

      return {
        content: data.choices?.[0]?.message?.content || '',
        model: data.model || model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[Ollama] 请求失败 (${duration}ms): ${error}`);
      throw error;
    }
  }

  /**
   * 使用原生 Ollama API（备用）
   */
  async chatNative(messages: ChatMessage[], config?: ModelConfig): Promise<LLMResponse> {
    const model = config?.name || this.defaultModel;
    const temperature = config?.temperature ?? this.temperature;

    const startTime = Date.now();

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
            stream: false,
            options: {
              temperature,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${error}`);
      }

      const data: OllamaResponse = await response.json() as any;
      const duration = Date.now() - startTime;

      logger.info(`[Ollama] Native 响应成功: ${model}, 耗时: ${duration}ms`);

      return {
        content: data.message?.content || '',
        model: data.model,
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        finishReason: data.done ? 'stop' : 'unknown',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[Ollama] Native 请求失败 (${duration}ms): ${error}`);
      throw error;
    }
  }

  /**
   * 列出可用模型
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' }
      );

      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }

      const data = await response.json() as any;
      return data.models || [];
    } catch (error) {
      logger.error(`[Ollama] 列出模型失败: ${error}`);
      return [];
    }
  }

  /**
   * 拉取模型
   */
  async pullModel(modelName: string): Promise<boolean> {
    try {
      logger.info(`[Ollama] 正在拉取模型: ${modelName}`);
      
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/pull`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: modelName, stream: false }),
        },
        300000 // 5 分钟超时（模型下载可能较慢）
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to pull model: ${error}`);
      }

      logger.info(`[Ollama] 模型拉取成功: ${modelName}`);
      return true;
    } catch (error) {
      logger.error(`[Ollama] 模型拉取失败: ${error}`);
      return false;
    }
  }

  /**
   * 检查 Ollama 服务是否可用
   */
  async checkHealth(): Promise<{ available: boolean; models: string[]; error?: string }> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000 // 5 秒超时
      );

      if (!response.ok) {
        return {
          available: false,
          models: [],
          error: `Ollama 服务响应异常: ${response.status}`,
        };
      }

      const data = await response.json() as any;
      const models = (data.models || []).map((m: OllamaModel) => m.name);

      return {
        available: true,
        models,
      };
    } catch (error) {
      return {
        available: false,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 带超时的 fetch
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout?: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = timeout || this.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): { baseUrl: string; model: string; temperature: number; maxTokens: number } {
    return {
      baseUrl: this.baseUrl,
      model: this.defaultModel,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    };
  }

  /**
   * 设置默认模型
   */
  setModel(model: string): void {
    this.defaultModel = model;
    logger.info(`[Ollama] 切换模型: ${model}`);
  }
}

/**
 * 创建 Ollama 客户端
 */
export function createOllamaClient(config?: OllamaConfig): LLMClient {
  return new OllamaClient(config);
}

/**
 * 推荐的本地模型列表
 */
export const RECOMMENDED_MODELS = [
  {
    name: 'qwen2.5:3b',
    description: '阿里通义千问 3B，中文最佳',
    size: '~2GB',
    languages: ['中文', '英文'],
    reason: '中文理解强，参数适中，CPU 可跑',
  },
  {
    name: 'qwen2.5:1.5b',
    description: '阿里通义千问 1.5B，超轻量',
    size: '~1GB',
    languages: ['中文', '英文'],
    reason: '最轻量，适合低配机器',
  },
  {
    name: 'deepseek-r1:7b',
    description: 'DeepSeek R1 7B，推理强',
    size: '~4.5GB',
    languages: ['中文', '英文'],
    reason: '推理能力出色，代码能力强',
  },
  {
    name: 'deepseek-coder:6.7b',
    description: 'DeepSeek Coder 6.7B，代码专用',
    size: '~4GB',
    languages: ['代码', '英文'],
    reason: '代码生成能力强',
  },
  {
    name: 'llama3.2:3b',
    description: 'Meta Llama 3.2 3B',
    size: '~2GB',
    languages: ['英文'],
    reason: 'Meta 出品，英文能力强',
  },
  {
    name: 'phi3:3.8b',
    description: '微软 Phi-3 mini',
    size: '~2.3GB',
    languages: ['英文'],
    reason: '微软出品，小参数高性能',
  },
];