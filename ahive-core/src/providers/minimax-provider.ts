/**
 * MiniMax API Provider
 * 
 * MiniMax API 有特殊的格式要求：
 * - 官方 API: https://api.minimax.chat/v1
 * - 国际版 API: https://api.minimaxi.com/v1 (M2.7 等新模型)
 * 
 * 特殊处理：
 * 1. 只接受最基本的参数（model + messages）
 * 2. 不支持多个 system 消息，需要合并
 * 3. 不支持 temperature、max_tokens 等参数（会报错 2013）
 * 4. 支持 Function Calling（tools 参数）- 仅国际版 API
 */

import type {
  ILLMProvider,
  ProviderConfig,
  LLMResponse,
  HealthCheckResult,
  ToolCall,
} from './index.js';
import type { ChatMessage } from '../agents/index.js';
import { logger, llmLogger } from '../utils/index.js';

/**
 * MiniMax 模型信息
 */
export const MINIMAX_MODELS = {
  // 国际版 API (api.minimaxi.com)
  international: {
    endpoint: 'https://api.minimaxi.com/v1',
    models: [
      'MiniMax-M2.7',          // 最新 Agent 专用模型，支持 FC
      'MiniMax-Text-01',       // 强推理能力
      'MiniMax-M1',            // 多模态模型
    ],
    defaultModel: 'MiniMax-M2.7',
    supportsFC: true,          // 支持 Function Calling
  },
  // 官方 API (api.minimax.chat)
  official: {
    endpoint: 'https://api.minimax.chat/v1',
    models: [
      'abab6.5-chat',          // 6.5版本
      'abab6.5s-chat',         // 6.5s版本，快速响应
      'abab5.5-chat',          // 5.5版本
      'abab5.5s-chat',         // 5.5s版本
      'MiniMax-Text-01',
      'MiniMax-M1',
    ],
    defaultModel: 'abab6.5-chat',
    supportsFC: false,         // 官方 API 的 abab 系列不支持 FC
  },
};

/**
 * 工具定义（OpenAI 格式）
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * 判断是否是 MiniMax 模型
 */
export function isMiniMaxModel(modelName: string): boolean {
  const name = modelName.toLowerCase();
  return name.includes('minimax') || name.includes('abab');
}

/**
 * 判断是否使用国际版 API
 */
export function isInternationalAPI(modelName: string): boolean {
  const name = modelName.toLowerCase();
  // M2.7 和 Text-01 等新模型使用国际版 API
  return name.includes('m2.7') || name.includes('m2.5') || name.includes('text-01');
}

/**
 * MiniMax Provider 实现
 */
export class MiniMaxProvider implements ILLMProvider {
  readonly type = 'openai' as const;
  private _name: string;

  get name(): string { return this._name; }

  private config: ProviderConfig;
  private initialized = false;
  private tools: ToolDefinition[] = [];

  constructor(config: ProviderConfig) {
    this.config = { ...config };
    this._name = 'MiniMax';

    // 根据模型自动选择端点
    const model = this.config.apiModel || '';
    if (!this.config.apiEndpoint) {
      if (isInternationalAPI(model)) {
        this.config.apiEndpoint = MINIMAX_MODELS.international.endpoint;
        this._name = 'MiniMax International';
        logger.info(`[MiniMaxProvider] 模型 ${model} 使用国际版 API`);
      } else {
        this.config.apiEndpoint = MINIMAX_MODELS.official.endpoint;
        this._name = 'MiniMax Official';
      }
    }

    // 设置默认值
    if (!this.config.apiModel) {
      this.config.apiModel = MINIMAX_MODELS.international.defaultModel;
    }
    if (this.config.temperature === undefined) {
      this.config.temperature = 0.7;
    }
    if (this.config.maxTokens === undefined) {
      this.config.maxTokens = 4096;
    }
    if (this.config.timeout === undefined) {
      this.config.timeout = 600000; // 10 分钟
    }

    // API Key 优先从环境变量读取
    if (!this.config.apiKey) {
      this.config.apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || '';
    }

    logger.info(`[MiniMaxProvider] 初始化: ${this.name}, 端点: ${this.config.apiEndpoint}, 模型: ${this.config.apiModel}`);
  }

  /**
   * 设置可用工具
   */
  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
    logger.info(`[MiniMaxProvider] 设置 ${tools.length} 个工具: ${tools.map(t => t.function.name).join(', ')}`);
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      logger.warn(`[MiniMaxProvider] 未配置 API Key，请在设置中配置或设置环境变量 MINIMAX_API_KEY`);
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 带重试的 chat 方法
   */
  async chat(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    const apiKey = config?.apiKey || this.config.apiKey;
    const endpoint = config?.apiEndpoint || this.config.apiEndpoint!;
    const model = (config as any)?.name ?? config?.modelName ?? config?.apiModel ?? this.config.apiModel!;

    if (!apiKey) {
      throw new Error('未配置 MiniMax API Key');
    }

    const startTime = Date.now();

    // 记录 LLM 调用开始
    const callId = llmLogger.logCallStart({
      provider: this.name,
      model,
      messages,
      config: { endpoint },
    });

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.chatInternal(messages, config);

        // 记录 LLM 调用成功
        llmLogger.logCallEnd(callId, {
          duration: Date.now() - startTime,
          tokens: {
            promptTokens: response.usage?.promptTokens || 0,
            completionTokens: response.usage?.completionTokens || 0,
            totalTokens: response.usage?.totalTokens || 0,
          },
          finishReason: response.finishReason || 'stop',
          toolCalls: response.toolCalls?.map(tc => tc.name),
          responseContent: response.content,
        });

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 判断是否可重试
        const isRetryable =
          error instanceof Error && (
            error.message.includes('aborted') ||
            error.message.includes('timeout') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('network') ||
            error.message.includes('503') ||
            error.message.includes('502')
          );

        if (!isRetryable || attempt === maxRetries) {
          llmLogger.logCallError(callId, {
            duration: Date.now() - startTime,
            error: lastError.message,
          });
          throw error;
        }

        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        logger.warn(`[MiniMaxProvider] 请求失败，${waitTime / 1000}s 后重试 (${attempt}/${maxRetries}): ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    llmLogger.logCallError(callId, {
      duration: Date.now() - startTime,
      error: lastError?.message || 'Unknown error',
    });

    throw lastError;
  }

  /**
   * 内部 chat 实现
   * MiniMax API 特殊处理：
   * 1. 只发送 model + messages（不发送 temperature、max_tokens 等）
   * 2. 合并多个 system 消息
   * 3. 国际版 API 支持 tools 参数
   */
  async chatInternal(
    messages: ChatMessage[],
    config?: Partial<ProviderConfig>
  ): Promise<LLMResponse> {
    const apiKey = config?.apiKey || this.config.apiKey;
    const endpoint = config?.apiEndpoint || this.config.apiEndpoint!;
    const model = (config as any)?.name ?? config?.modelName ?? config?.apiModel ?? this.config.apiModel!;

    if (!apiKey) {
      throw new Error('未配置 MiniMax API Key');
    }

    // MiniMax 特殊处理：合并所有 system 消息为一个
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    let processedMessages: ChatMessage[];
    if (systemMessages.length > 1) {
      // 合并所有 system 消息
      const combinedSystemContent = systemMessages.map(m => m.content).join('\n\n---\n\n');
      processedMessages = [
        { role: 'system', content: combinedSystemContent },
        ...nonSystemMessages
      ];
      logger.info(`[MiniMaxProvider] 合并 ${systemMessages.length} 个 system 消息为一个`);
    } else {
      processedMessages = messages;
    }

    // 构建请求体 - MiniMax 最简格式
    // 重要：MiniMax API 不接受 temperature、max_tokens 等参数，会报错 2013
    const requestBody: Record<string, any> = {
      model,
      messages: processedMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    };

    // 国际版 API 支持 Function Calling
    const isInternational = isInternationalAPI(model);
    const toolsToUse = (config as any)?.tools || this.tools;

    if (isInternational && toolsToUse.length > 0) {
      requestBody.tools = toolsToUse;
      requestBody.tool_choice = 'auto';
      logger.info(`[MiniMaxProvider] 国际版 API 支持 FC，添加 ${toolsToUse.length} 个工具`);
    } else if (toolsToUse.length > 0) {
      logger.warn(`[MiniMaxProvider] 官方 API 不支持 FC，跳过 tools 参数`);
    }

    // 调试日志
    logger.debug(`[MiniMaxProvider] 请求体: ${JSON.stringify(requestBody, null, 2)}`);
    logger.info(`[MiniMaxProvider] 发送请求到: ${endpoint}/chat/completions`);

    const response = await this.fetchWithTimeout(
      `${endpoint}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    try {
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = errorText;

        try {
          const errorJson = JSON.parse(errorText);
          // MiniMax 特殊错误码处理
          if (errorJson.error_code === 2013) {
            errorMessage = 'MiniMax API 参数错误 (2013): 不支持的参数，请检查请求格式';
          } else {
            errorMessage = errorJson.error?.message || errorJson.message || errorText;
          }
        } catch {
          // ignore
        }

        throw new Error(`MiniMax API 错误 (${response.status}): ${errorMessage}`);
      }

      const data = await response.json() as any;

      // 提取工具调用（如果有）
      const rawToolCalls = data.choices?.[0]?.message?.tool_calls;
      const toolCalls: ToolCall[] | undefined = rawToolCalls?.map((tc: any) => ({
        id: tc.id || `tc_${Date.now()}`,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
      }));

      if (toolCalls && toolCalls.length > 0) {
        logger.info(`[MiniMaxProvider] 收到 ${toolCalls.length} 个工具调用: ${toolCalls.map(t => t.name).join(', ')}`);
      }

      return {
        content: data.choices?.[0]?.message?.content || '',
        model: data.model || model,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
        toolCalls,
      };
    } finally {
      this.clearRequestTimeout(response);
    }
  }

  async chatIsolated(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    return this.chat(messages, config);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      if (!this.config.apiKey) {
        return {
          available: false,
          error: '未配置 MiniMax API Key',
        };
      }

      // 尝试获取模型列表来验证连接
      const response = await this.fetchWithTimeout(
        `${this.config.apiEndpoint}/models`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        },
        10000
      );

      try {
        if (!response.ok) {
          return {
            available: false,
            error: `MiniMax API 验证失败: ${response.status}`,
          };
        }

        const data = await response.json() as any;
        const models = (data.data || data.models || []).map((m: any) => m.id || m.name || m);

        return {
          available: true,
          models: models.slice(0, 20),
        };
      } finally {
        this.clearRequestTimeout(response);
      }

    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getConfig(): ProviderConfig {
    // 返回配置时隐藏 API Key
    return {
      ...this.config,
      apiKey: this.config.apiKey ? '******' : undefined,
    };
  }

  getFullConfig(): ProviderConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    if (config.apiEndpoint) {
      this.config.apiEndpoint = config.apiEndpoint;
    }
    if (config.apiKey) {
      this.config.apiKey = config.apiKey;
    }
    if (config.apiModel) {
      this.config.apiModel = config.apiModel;
      // 根据模型自动选择端点
      if (isInternationalAPI(config.apiModel)) {
        this.config.apiEndpoint = MINIMAX_MODELS.international.endpoint;
        this._name = 'MiniMax International';
      }
    }
    if (config.temperature !== undefined) {
      this.config.temperature = config.temperature;
    }
    if (config.maxTokens !== undefined) {
      this.config.maxTokens = config.maxTokens;
    }
    if (config.timeout !== undefined) {
      this.config.timeout = config.timeout;
    }
  }

  /**
   * 获取支持的模型列表
   */
  getSupportedModels(): string[] {
    const isInternational = isInternationalAPI(this.config.apiModel || '');
    if (isInternational) {
      return MINIMAX_MODELS.international.models;
    }
    return MINIMAX_MODELS.official.models;
  }

  /**
   * 带超时的 fetch
   * 
   * 关键修复：AbortController 覆盖整个请求生命周期（连接 + 响应体读取）
   * 与 OpenAIProvider.fetchWithTimeout 相同的修复逻辑
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout?: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = timeout || this.config.timeout!;
    const timeoutId = setTimeout(() => {
      logger.warn(`[MiniMaxProvider] 请求超时 (${timeoutMs}ms)，中止: ${url}`);
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      // 不在这里 clearTimeout！让 AbortController 保持活跃
      (response as any)._timeoutId = timeoutId;
      (response as any)._abortController = controller;

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 清除请求超时定时器
   */
  private clearRequestTimeout(response: Response): void {
    const timeoutId = (response as any)._timeoutId;
    if (timeoutId) {
      clearTimeout(timeoutId);
      delete (response as any)._timeoutId;
      delete (response as any)._abortController;
    }
  }
}