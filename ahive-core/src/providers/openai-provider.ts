/**
 * OpenAI 兼容 API Provider
 * 
 * 支持：
 * - OpenAI
 * - 阿里百炼 Coding Plan
 * - DeepSeek
 * - 智谱 GLM
 * - 通义千问
 * - 自定义 OpenAI 兼容 API
 * 
 * 支持 Function Calling（工具调用）
 */

import type {
  ILLMProvider,
  ProviderConfig,
  LLMResponse,
  HealthCheckResult,
  ToolCall,
  StreamCallbacks,
} from './index.js';
import type { ChatMessage } from '../agents/index.js';
import { logger, llmLogger } from '../utils/index.js';
import { API_PRESETS } from './index.js';

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
 * OpenAI Provider 实现
 */
export class OpenAIProvider implements ILLMProvider {
  readonly type = 'openai' as const;
  private _name: string;

  get name(): string { return this._name; }

  private config: ProviderConfig;
  private initialized = false;
  private presetId: string | null = null;
  private tools: ToolDefinition[] = [];

  constructor(config: ProviderConfig) {
    this.config = { ...config };
    this._name = 'OpenAI API';

    // 根据 presetId 设置默认值
    if (this.config.presetId) {
      this.presetId = this.config.presetId;
      const preset = API_PRESETS.find(p => p.id === this.config.presetId);
      if (preset) {
        this._name = preset.name;
        if (!this.config.apiEndpoint) {
          this.config.apiEndpoint = preset.endpoint;
        }
        if (!this.config.apiModel) {
          this.config.apiModel = preset.defaultModel;
        }
      } else {
        this._name = '自定义 API';
      }
    } else {
      this._name = 'OpenAI API';
    }

    // 设置默认值
    if (!this.config.apiEndpoint) {
      this.config.apiEndpoint = 'https://api.openai.com/v1';
    }
    if (!this.config.apiModel) {
      this.config.apiModel = 'gpt-4o-mini';
    }
    if (this.config.temperature === undefined) {
      this.config.temperature = 0.7;
    }
    if (this.config.maxTokens === undefined) {
      this.config.maxTokens = 4096;
    }
    if (this.config.timeout === undefined) {
      this.config.timeout = 600000; // 10 分钟（代码审计等复杂任务需要更长时间）
    }

    // API Key 优先从环境变量读取
    if (!this.config.apiKey) {
      this.config.apiKey = process.env.OPENAI_API_KEY || process.env.ALIYUN_API_KEY || '';
    }

    logger.info(`[OpenAIProvider] 初始化: ${this.name}, 端点: ${this.config.apiEndpoint}, 超时: ${(this.config.timeout! / 1000).toFixed(0)}s`);
  }

  /**
   * 设置可用工具
   * 参考 CODEX：在 API 请求中传递工具定义
   */
  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
    logger.info(`[OpenAIProvider] 设置 ${tools.length} 个工具: ${tools.map(t => t.function.name).join(', ')}`);
  }

  async initialize(): Promise<void> {
    // 验证配置
    if (!this.config.apiKey) {
      logger.warn(`[OpenAIProvider] 未配置 API Key，请在设置中配置或设置环境变量`);
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 带重试的 chat 方法
   * 对于网络错误和超时自动重试
   * 
   * 日志记录在此层面进行，确保每次调用都有完整的开始和结束记录
   */
  async chat(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    const apiKey = config?.apiKey || this.config.apiKey;
    const endpoint = config?.apiEndpoint || this.config.apiEndpoint!;
    const model = (config as any)?.name ?? config?.modelName ?? config?.apiModel ?? this.config.apiModel!;
    const temperature = config?.temperature ?? this.config.temperature!;
    const maxTokens = config?.maxTokens ?? this.config.maxTokens!;

    if (!apiKey) {
      throw new Error('未配置 API Key');
    }

    const startTime = Date.now();

    // 记录 LLM 调用开始（在 chat 层面，确保只记录一次）
    const callId = llmLogger.logCallStart({
      provider: this.name,
      model,
      messages,
      config: { temperature, maxTokens, endpoint },
    });

    const maxRetries = 3;
    let lastError: Error | null = null;
    let attempt = 0;

    for (attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.chatInternal(messages, config, callId, startTime);

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

        // 判断是否可重试（aborted 不重试——用户中断应立即停止）
        const isRetryable =
          error instanceof Error && (
            !error.message.includes('aborted') && (
              error.message.includes('timeout') ||
              error.message.includes('ECONNRESET') ||
              error.message.includes('ETIMEDOUT') ||
              error.message.includes('ECONNREFUSED') ||
              error.message.includes('network') ||
              error.message.includes('fetch failed') ||
              error.message.includes('socket hang up') ||
              error.message.includes('429') ||
              error.message.includes('503') ||
              error.message.includes('502') ||
              error.message.includes('500')
            )
          );

        if (!isRetryable || attempt === maxRetries) {
          // 记录 LLM 调用失败
          llmLogger.logCallError(callId, {
            duration: Date.now() - startTime,
            error: lastError.message,
          });
          throw error;
        }

        // 指数退避重试，429 限流使用更长退避
        let waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        if (lastError.message.includes('429')) {
          waitTime = Math.min(10000 * Math.pow(2, attempt - 1), 60000);
        }
        logger.warn(`[OpenAIProvider] 请求失败，${waitTime / 1000}s 后重试 (${attempt}/${maxRetries}): ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // 所有重试都失败
    llmLogger.logCallError(callId, {
      duration: Date.now() - startTime,
      error: lastError?.message || 'Unknown error',
    });

    throw lastError;
  }

  /**
   * 内部 chat 实现（不记录日志，由 chat 方法统一记录）
   */
  async chatInternal(
    messages: ChatMessage[],
    config?: Partial<ProviderConfig>,
    _callId?: string,
    _startTime?: number
  ): Promise<LLMResponse> {
    const apiKey = config?.apiKey || this.config.apiKey;
    const endpoint = config?.apiEndpoint || this.config.apiEndpoint!;
    const model = (config as any)?.name ?? config?.modelName ?? config?.apiModel ?? this.config.apiModel!;
    const temperature = config?.temperature ?? this.config.temperature!;
    const maxTokens = config?.maxTokens ?? this.config.maxTokens!;

    if (!apiKey) {
      throw new Error('未配置 API Key');
    }

    // 构建请求体
    const requestBody: Record<string, any> = {
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature,
      max_tokens: maxTokens,
      stream: false,  // 非流式调用
    };

    // 添加工具定义（参考 CODEX）
    // 🔧 修复：支持从 config 中传递工具定义（用于 Worker IPC 调用）
    const toolsToUse = (config as any)?.tools || this.tools;
    if (toolsToUse.length > 0) {
      requestBody.tools = toolsToUse;
      const modelLower = model.toLowerCase();
      const isQwenThinking = modelLower.includes('qwen3') || modelLower.includes('qwq');
      if (!isQwenThinking) {
        requestBody.tool_choice = 'auto';
      }
      logger.info(`[OpenAIProvider] 请求包含 ${toolsToUse.length} 个工具, model=${model}, tool_choice=${isQwenThinking ? 'unset(thinking)' : 'auto'}`);
    } else {
      logger.warn(`[OpenAIProvider] ⚠️ 请求没有包含工具定义！`);
    }

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
          errorMessage = errorJson.error?.message || errorText;
        } catch {
          // ignore
        }

        throw new Error(`API 错误 (${response.status}): ${errorMessage}`);
      }

      const data = await response.json() as any;
      const duration = Date.now() - (_startTime || Date.now());

      // 详细日志：检查响应结构
      const choice = data.choices?.[0];
      const message = choice?.message;
      const rawToolCalls = message?.tool_calls;

      logger.info(`[OpenAIProvider] API 响应: model=${model}, duration=${duration}ms`);
      logger.info(`[OpenAIProvider] 响应结构: has_choices=${!!data.choices}, has_message=${!!message}, has_tool_calls=${!!rawToolCalls}`);
      logger.info(`[OpenAIProvider] message.content 长度: ${message?.content?.length || 0}`);
      logger.info(`[OpenAIProvider] finish_reason: ${choice?.finish_reason}`);

      if (rawToolCalls && rawToolCalls.length > 0) {
        logger.info(`[OpenAIProvider] ✅ 收到 ${rawToolCalls.length} 个工具调用: ${rawToolCalls.map((t: any) => t.function?.name).join(', ')}`);
      } else {
        logger.warn(`[OpenAIProvider] ⚠️ 没有收到工具调用！模型可能不支持 Function Calling 或没有正确调用工具`);
      }

      // 提取工具调用（如果有）
      const toolCalls: ToolCall[] | undefined = rawToolCalls?.map((tc: any) => ({
        id: tc.id || `tc_${Date.now()}`,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
      }));

      if (toolCalls && toolCalls.length > 0) {
        logger.info(`[OpenAIProvider] 收到 ${toolCalls.length} 个工具调用: ${toolCalls.map(t => t.name).join(', ')}`);
      }

      logger.info(`[OpenAIProvider] 响应成功: ${model}, 耗时: ${duration}ms, 工具调用: ${toolCalls?.length || 0}`);

      const reasoningContent = data.choices?.[0]?.message?.reasoning_content || undefined;

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
        reasoningContent,
      };
    } finally {
      this.clearRequestTimeout(response);
    }
  }

  async chatIsolated(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    // API 调用本身是无状态的，直接调用即可
    return this.chat(messages, config);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      if (!this.config.apiKey) {
        return {
          available: false,
          error: '未配置 API Key',
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
            error: `API 验证失败: ${response.status}`,
          };
        }

        const data = await response.json() as any;
        const models = (data.data || data.models || []).map((m: any) => m.id || m.name || m);

        return {
          available: true,
          models: models.slice(0, 20), // 限制返回数量
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
    // 返回完整配置（包含 API Key，用于内部调用）
    return { ...this.config };
  }

  /**
   * 流式调用 LLM（带重试）
   * 
   * 修复：添加与 chat() 一致的重试机制，之前 chatStream 完全没有重试
   * 
   * @param messages 消息列表
   * @param callbacks 流式回调
   * @param config 配置
   * @returns 完整响应
   */
  async chatStream(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    config?: Partial<ProviderConfig>
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const apiKey = config?.apiKey || this.config.apiKey;
    const endpoint = config?.apiEndpoint || this.config.apiEndpoint!;
    const model = (config as any)?.name ?? config?.modelName ?? config?.apiModel ?? this.config.apiModel!;

    if (!apiKey) {
      throw new Error('未配置 API Key');
    }

    // 记录 LLM 调用开始
    const callId = llmLogger.logCallStart({
      provider: this.name,
      model,
      messages,
      config: { temperature: config?.temperature ?? this.config.temperature!, maxTokens: config?.maxTokens ?? this.config.maxTokens!, endpoint },
      isStream: true,
    });

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.chatStreamInternal(messages, callbacks, config);

        // 记录 LLM 调用成功
        llmLogger.logCallEnd(callId, {
          duration: Date.now() - startTime,
          tokens: response.usage,
          finishReason: response.finishReason,
          toolCalls: response.toolCalls?.map(tc => tc.name),
        });

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 判断是否可重试（aborted 不重试——用户中断应立即停止）
        const isRetryable =
          error instanceof Error && (
            !error.message.includes('aborted') && (
              error.message.includes('timeout') ||
              error.message.includes('ECONNRESET') ||
              error.message.includes('ETIMEDOUT') ||
              error.message.includes('ECONNREFUSED') ||
              error.message.includes('network') ||
              error.message.includes('fetch failed') ||
              error.message.includes('socket hang up') ||
              error.message.includes('429') ||
              error.message.includes('503') ||
              error.message.includes('502') ||
              error.message.includes('500')
            )
          );

        if (!isRetryable || attempt === maxRetries) {
          llmLogger.logCallError(callId, {
            duration: Date.now() - startTime,
            error: lastError.message,
          });
          throw error;
        }

        // 指数退避重试，429 限流使用更长退避
        let waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        if (lastError.message.includes('429')) {
          waitTime = Math.min(10000 * Math.pow(2, attempt - 1), 60000);
        }
        logger.warn(`[OpenAIProvider] 流式请求失败，${waitTime / 1000}s 后重试 (${attempt}/${maxRetries}): ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // 所有重试都失败
    llmLogger.logCallError(callId, {
      duration: Date.now() - startTime,
      error: lastError?.message || 'Unknown error',
    });

    throw lastError;
  }

  /**
   * 流式调用内部实现（不记录日志，由 chatStream 统一记录）
   */
  private async chatStreamInternal(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    config?: Partial<ProviderConfig>
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const apiKey = config?.apiKey || this.config.apiKey;
    const endpoint = config?.apiEndpoint || this.config.apiEndpoint!;
    const model = (config as any)?.name ?? config?.modelName ?? config?.apiModel ?? this.config.apiModel!;
    const temperature = config?.temperature ?? this.config.temperature!;
    const maxTokens = config?.maxTokens ?? this.config.maxTokens!;

    // 构建请求体
    const requestBody: Record<string, any> = {
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature,
      max_tokens: maxTokens,
      stream: true,  // 流式调用
    };

    // 添加工具定义
    const toolsToUse = (config as any)?.tools || this.tools;
    if (toolsToUse.length > 0) {
      requestBody.tools = toolsToUse;
      const modelLower = model.toLowerCase();
      const isQwenThinking = modelLower.includes('qwen3') || modelLower.includes('qwq');
      if (!isQwenThinking) {
        requestBody.tool_choice = 'auto';
      }
    }

    logger.info(`[OpenAIProvider] 流式调用: ${model}`);

    const response = await this.fetchWithTimeout(
      `${endpoint}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
      config?.timeout
    );

    try {
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('响应体为空');
      }

      // 处理 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let fullReasoningContent = '';
      // 临时存储工具调用（arguments 为字符串，流式拼接）
      const rawToolCalls: Array<{ id: string; name: string; argumentsStr: string }> = [];
      let finishReason = 'stop';
      let lastDelta = '';  // 记录最后的delta,用于调试
      const STREAM_READ_TIMEOUT_MS = 120000; // 单次读取超时 2 分钟
      // 🔧 Issue 7 修复：SSE 跨 chunk 行缓冲
      let lineBuffer = '';

      while (true) {
        // 🔧 Issue 2 修复：使用 Promise.race 保护 reader.read() 不会永久阻塞
        const readPromise = reader.read();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Stream read timeout: no data received for ${STREAM_READ_TIMEOUT_MS / 1000}s`));
          }, STREAM_READ_TIMEOUT_MS);
        });

        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await Promise.race([readPromise, timeoutPromise]);
        } catch (timeoutError) {
          logger.warn(`[OpenAIProvider] 流式读取超时 (${STREAM_READ_TIMEOUT_MS / 1000}s 无数据)`);
          // 尝试取消 reader 以释放资源
          try { reader.cancel(); } catch { }
          throw timeoutError;
        }

        const { done, value } = readResult;
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // 🔧 Issue 7 修复：拼接上一个 chunk 的残余行
        const combined = lineBuffer + chunk;
        const lines = combined.split('\n');
        // 最后一个元素可能是不完整的行，保留到下次
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('data: ')) continue;

          const data = trimmedLine.slice(6).trim();
          if (data === '[DONE]') {
            logger.info(`[OpenAIProvider] SSE stream [DONE] received`);
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              // 检查是否重复
              if (delta.content === lastDelta && delta.content.length < 10) {
                logger.warn(`[OpenAIProvider] 可能重复的delta: "${delta.content}"`);
              }
              lastDelta = delta.content;

              fullContent += delta.content;
              if (callbacks.onDelta) {
                callbacks.onDelta(delta.content);
              }
            }

            // 处理推理/思考内容 (DeepSeek-R1, QwQ, Qwen3 等推理模型)
            if (delta?.reasoning_content) {
              fullReasoningContent += delta.reasoning_content;
              if (callbacks.onThinkingDelta) {
                callbacks.onThinkingDelta(delta.reasoning_content);
              }
            }

            // 处理工具调用
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index;
                if (!rawToolCalls[index]) {
                  rawToolCalls[index] = {
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    argumentsStr: '',
                  };
                }
                if (tc.function?.arguments) {
                  rawToolCalls[index].argumentsStr += tc.function.arguments;
                }
              }
            }

            // 获取 finish_reason
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
              logger.info(`[OpenAIProvider] finish_reason: ${finishReason}`);
            }
          } catch (e) {
            // 🔧 SSE JSON 解析错误加日志，便于排查丢失 tool_calls/finish_reason 的问题
            const parseErrMsg = e instanceof Error ? e.message : String(e);
            logger.warn(`[OpenAIProvider] SSE data JSON 解析失败: data="${data.substring(0, 200)}", error=${parseErrMsg}`);
          }
        }
      }

      // 解析工具调用的 arguments（安全处理，避免 JSON.parse 失败导致崩溃）
      const toolCalls: ToolCall[] = [];
      for (const tc of rawToolCalls) {
        let argumentsObj: Record<string, unknown> = {};
        if (tc.argumentsStr) {
          try {
            argumentsObj = JSON.parse(tc.argumentsStr);
          } catch (parseError) {
            logger.warn(`[OpenAIProvider] 工具调用参数 JSON 解析失败: name=${tc.name}, args="${tc.argumentsStr.substring(0, 200)}"`);
            // 尝试修复截断：补全缺失的闭合括号
            let repaired = tc.argumentsStr;
            let openBraces = 0;
            for (const ch of repaired) {
              if (ch === '{') openBraces++;
              if (ch === '}') openBraces--;
            }
            while (openBraces > 0) {
              repaired += '}';
              openBraces--;
            }
            try {
              argumentsObj = JSON.parse(repaired);
              logger.info(`[OpenAIProvider] 工具调用参数修复成功`);
            } catch {
              logger.error(`[OpenAIProvider] 工具调用参数修复失败，使用空参数`);
              argumentsObj = { _parse_error: true, _raw_arguments: tc.argumentsStr.substring(0, 500) };
            }
          }
        }
        toolCalls.push({ id: tc.id, name: tc.name, arguments: argumentsObj });
      }

      const duration = Date.now() - startTime;
      logger.info(`[OpenAIProvider] 流式调用完成: ${duration}ms, 内容长度: ${fullContent.length}`);

      return {
        content: fullContent,
        model,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason,
        reasoningContent: fullReasoningContent || undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[OpenAIProvider] 流式调用失败: ${duration}ms`, error);
      throw error;
    } finally {
      // 无论成功或失败，都清除超时定时器，防止泄漏
      this.clearRequestTimeout(response);
    }
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
    }
    if (config.presetId) {
      this.presetId = config.presetId;
      const preset = API_PRESETS.find(p => p.id === config.presetId);
      if (preset) {
        this._name = preset.name;
        if (!config.apiEndpoint) {
          this.config.apiEndpoint = preset.endpoint;
        }
        if (!config.apiModel) {
          this.config.apiModel = preset.defaultModel;
        }
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
   * 获取预设的模型列表
   */
  getPresetModels(): string[] {
    if (this.presetId) {
      const preset = API_PRESETS.find(p => p.id === this.presetId);
      if (preset) {
        return preset.models;
      }
    }
    return [];
  }

  /**
   * 带超时的 fetch
   * 
   * 关键修复：AbortController 覆盖整个请求生命周期（连接 + 响应体读取）
   * 之前的实现只在 fetch() 返回 Response 前生效，response.json()/response.text()
   * 读取 body 时没有超时保护，网络异常时会无限挂起。
   * 
   * 现在返回的 Response 携带 AbortController 的 signal，只要超时未到，
   * signal 就保持活跃；超时后 abort 会中断正在进行的 body 读取。
   * 调用方在完成 body 读取后必须调用 clearRequestTimeout() 清除定时器。
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout?: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = timeout || this.config.timeout!;
    const timeoutId = setTimeout(() => {
      logger.warn(`[OpenAIProvider] 请求超时 (${timeoutMs}ms)，中止: ${url}`);
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      // 不在这里 clearTimeout！让 AbortController 保持活跃，
      // 这样如果 response.json()/response.text() 读取 body 时超时，
      // abort 信号会中断读取并抛出 AbortError/TimeoutError。
      // 将 timeoutId 附加到 response 上，供调用方在完成读取后清除。
      (response as any)._timeoutId = timeoutId;
      (response as any)._abortController = controller;

      return response;
    } catch (error) {
      // fetch 本身失败（连接超时、网络错误等），清除定时器
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 清除请求超时定时器
   * 在成功读取完响应体后必须调用，防止定时器泄漏
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