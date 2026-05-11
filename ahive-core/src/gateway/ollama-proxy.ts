/**
 * Ollama 代理层 - 本地模型网关
 * 
 * 功能：
 * - 兼容 OpenAI API 格式
 * - 调用本地 Ollama 服务
 * - 无需 API Key，完全本地运行
 */

import { logger } from '../utils/index.js';
import { generateId } from '../utils/index.js';

// ============ 接口定义 ============

/**
 * LLM 请求（OpenAI 兼容格式）
 */
export interface LLMRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * 消息结构
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM 响应（OpenAI 兼容格式）
 */
export interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Choice[];
  usage: Usage;
  ahive_meta?: AHIVEMeta;
}

/**
 * 选择项
 */
export interface Choice {
  index: number;
  message: Message;
  finish_reason: string;
}

/**
 * Token 使用量
 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * AHIVE 元数据
 */
export interface AHIVEMeta {
  agent_id: string;
  cost: number;  // 本地模型为 0
  currency: string;
  timestamp: string;
  provider: string;  // 'ollama'
}

// ============ Ollama 代理类 ============

export class OllamaProxy {
  private baseUrl: string;
  private defaultModel: string;
  private timeout: number;

  constructor(baseUrl: string, defaultModel?: string) {
    this.baseUrl = baseUrl || 'http://localhost:11434';
    this.defaultModel = defaultModel || 'qwen2.5:3b';
    this.timeout = 60000; // 60 秒超时
  }

  /**
   * 聊天完成（代理调用）
   */
  async chatCompletion(
    request: LLMRequest,
    agentId: string
  ): Promise<LLMResponse> {
    const requestId = generateId('ahive');
    const startTime = Date.now();
    const model = request.model || this.defaultModel;

    logger.info(`🤖 [Ollama Proxy] 请求模型：${model}, Agent: ${agentId}`);

    try {
      // 使用 OpenAI 兼容 API
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: request.messages,
            temperature: request.temperature || 0.7,
            max_tokens: request.max_tokens || 2048,
            stream: false,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API 错误 (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      const duration = Date.now() - startTime;

      // 构建响应（添加 AHIVE 元数据）
      const ahiveResponse: LLMResponse = {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: data.model || model,
        choices: data.choices || [],
        usage: data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        ahive_meta: {
          agent_id: agentId,
          cost: 0,  // 本地模型无成本
          currency: 'CNY',
          timestamp: new Date().toISOString(),
          provider: 'ollama',
        },
      };

      logger.info(
        `✅ [Ollama Proxy] 响应成功，耗时：${duration}ms, Tokens: ${ahiveResponse.usage.total_tokens}`
      );

      return ahiveResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        `❌ [Ollama Proxy] 请求失败，耗时：${duration}ms: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  /**
   * 获取模型列表
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000
      );

      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.status}`);
      }

      const data = await response.json() as any;
      return (data.models || []).map((m: any) => m.name);
    } catch (error) {
      logger.error(`[Ollama Proxy] 获取模型列表失败: ${error}`);
      return [this.defaultModel];
    }
  }

  /**
   * 检查服务状态
   */
  async checkHealth(): Promise<{ available: boolean; error?: string }> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000
      );

      return { available: response.ok };
    } catch (error) {
      return {
        available: false,
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
  getConfig(): { baseUrl: string; model: string } {
    return {
      baseUrl: this.baseUrl,
      model: this.defaultModel,
    };
  }

  /**
   * 设置默认模型
   */
  setModel(model: string): void {
    this.defaultModel = model;
    logger.info(`[Ollama Proxy] 切换模型: ${model}`);
  }
}

// ============ 辅助函数 ============

/**
 * 创建 Ollama 代理实例
 */
export function createOllamaProxy(baseUrl: string, defaultModel?: string): OllamaProxy {
  return new OllamaProxy(baseUrl, defaultModel);
}