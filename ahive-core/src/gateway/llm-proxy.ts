/**
 * LLM Proxy - 大模型代理层
 * 
 * 功能：
 * - 兼容 OpenAI API 格式
 * - 路由到真实大模型 API（阿里云百炼等）
 * - 统一响应格式，添加 AHIVE 元数据
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
  cost: number;
  currency: string;
  timestamp: string;
}

// ============ 模型定价（元/千 token） ============

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // 阿里云百炼
  'qwen3-max': { input: 0.02, output: 0.06 },
  'qwen3-max-2026-01-23': { input: 0.02, output: 0.06 },
  'qwen-plus': { input: 0.004, output: 0.012 },
  'qwen-turbo': { input: 0.001, output: 0.003 },
  // DeepSeek
  'deepseek-chat': { input: 0.001, output: 0.002 },
  'deepseek-coder': { input: 0.001, output: 0.002 },
  // MiniMax
  'abab6.5': { input: 0.003, output: 0.003 },
  'abab6.5s': { input: 0.001, output: 0.001 },
  // 默认（如果模型不在列表中）
  'default': { input: 0.001, output: 0.002 },
};

// ============ LLM 代理类 ============

export class LLMProxy {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://coding.dashscope.aliyuncs.com/v1';
  }

  /**
   * 聊天完成（代理调用）
   * 
   * 修复：添加超时控制和重试机制，之前使用裸 fetch 无任何保护
   */
  async chatCompletion(
    request: LLMRequest,
    agentId: string
  ): Promise<LLMResponse> {
    const requestId = generateId('ahive');
    const startTime = Date.now();

    logger.info(`🤖 [LLM Proxy] 请求模型：${request.model}, Agent: ${agentId}`);

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutMs = 600000; // 10 分钟超时
      const timeoutId = setTimeout(() => {
        logger.warn(`[LLM Proxy] 请求超时 (${timeoutMs}ms)，中止`);
        controller.abort();
      }, timeoutMs);

      try {
        // 调用真实 API
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            temperature: request.temperature || 0.7,
            max_tokens: request.max_tokens || 2048,
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`LLM API 错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json() as any;

        // 成功：清除超时定时器
        clearTimeout(timeoutId);

        // 计算成本
        const cost = this.calculateCost(
          request.model,
          data.usage?.prompt_tokens || 0,
          data.usage?.completion_tokens || 0
        );

        // 构建响应（添加 AHIVE 元数据）
        const ahiveResponse: LLMResponse = {
          id: requestId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: data.choices || [],
          usage: data.usage || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          ahive_meta: {
            agent_id: agentId,
            cost: cost,
            currency: 'CNY',
            timestamp: new Date().toISOString(),
          },
        };

        const duration = Date.now() - startTime;
        logger.info(
          `✅ [LLM Proxy] 响应成功，耗时：${duration}ms, 成本：¥${cost.toFixed(4)}`
        );

        return ahiveResponse;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error instanceof Error ? error : new Error(String(error));
        const duration = Date.now() - startTime;
        const errMsg = lastError.message;

        // 判断是否可重试
        const isRetryable =
          errMsg.includes('aborted') ||
          errMsg.includes('timeout') ||
          errMsg.includes('ECONNRESET') ||
          errMsg.includes('ETIMEDOUT') ||
          errMsg.includes('429') ||
          errMsg.includes('503') ||
          errMsg.includes('502') ||
          errMsg.includes('500');

        if (!isRetryable || attempt === maxRetries) {
          logger.error(
            `❌ [LLM Proxy] 请求失败，耗时：${duration}ms: ${errMsg}`
          );
          throw lastError;
        }

        // 指数退避重试
        let waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        if (errMsg.includes('429')) {
          waitTime = Math.min(10000 * Math.pow(2, attempt - 1), 60000);
        }
        logger.warn(`[LLM Proxy] 请求失败，${waitTime / 1000}s 后重试 (${attempt}/${maxRetries}): ${errMsg}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // 所有重试都失败
    throw lastError;
  }

  /**
   * 计算成本
   */
  private calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
    
    const inputCost = (promptTokens / 1000) * pricing.input;
    const outputCost = (completionTokens / 1000) * pricing.output;
    
    return inputCost + outputCost;
  }

  /**
   * 获取模型列表
   */
  async models(): Promise<string[]> {
    return Object.keys(MODEL_PRICING);
  }

  /**
   * 获取模型定价
   */
  getPricing(model: string): { input: number; output: number } {
    return MODEL_PRICING[model] || MODEL_PRICING['default'];
  }
}

// ============ 辅助函数 ============

/**
 * 创建 LLM 代理实例
 */
export function createLLMProxy(apiKey: string, baseUrl?: string): LLMProxy {
  return new LLMProxy(apiKey, baseUrl);
}

/**
 * 计算成本（独立函数）
 */
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (promptTokens / 1000) * pricing.input;
  const outputCost = (completionTokens / 1000) * pricing.output;
  return inputCost + outputCost;
}
