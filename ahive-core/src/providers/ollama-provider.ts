/**
 * Ollama Provider
 * 
 * 连接本地 Ollama 服务
 * 支持 Function Calling（工具调用）
 * 支持模型不支持工具时的优雅降级
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
 * 不支持工具调用的模型缓存（内存缓存，进程重启后重置）
 * 注意：仅在检测到明确的"不支持工具"错误时才添加
 * 
 * 已禁用：缓存会导致误判，每次都尝试工具调用
 */
// const modelsWithoutToolsSupport = new Set<string>();

/**
 * Ollama Provider 实现
 */
export class OllamaProvider implements ILLMProvider {
  readonly type = 'ollama' as const;
  readonly name = 'Ollama 本地服务';

  private config: ProviderConfig;
  private initialized = false;
  private tools: ToolDefinition[] = [];

  constructor(config: ProviderConfig) {
    this.config = { ...config };

    // 设置默认值
    if (!this.config.ollamaHost) {
      this.config.ollamaHost = this.config.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434';
    }
    if (!this.config.ollamaModel) {
      this.config.ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
    }
    if (this.config.temperature === undefined) {
      this.config.temperature = 0.7;
    }
    if (this.config.maxTokens === undefined) {
      this.config.maxTokens = 2048;
    }
    if (this.config.timeout === undefined) {
      this.config.timeout = 60000;
    }

    logger.info(`[OllamaProvider] 初始化: ${this.config.ollamaHost}, 模型: ${this.config.ollamaModel}`);
  }

  /**
   * 设置可用工具
   * Ollama 支持 OpenAI 兼容的工具调用格式
   */
  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
    logger.info(`[OllamaProvider] 设置 ${tools.length} 个工具: ${tools.map(t => t.function.name).join(', ')}`);
  }

  async initialize(): Promise<void> {
    // 检查 Ollama 服务是否可用
    const health = await this.healthCheck();
    if (!health.available) {
      const errorMsg = `Ollama 服务不可用: ${health.error}。请确保 Ollama 服务已启动 (运行 'ollama serve')`;
      logger.error(`[OllamaProvider] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 检查模型是否存在
    if (health.models && health.models.length > 0) {
      const targetModel = this.config.ollamaModel!;
      const modelExists = health.models.some(m => m === targetModel || m.startsWith(targetModel.split(':')[0]));

      if (!modelExists) {
        logger.warn(`[OllamaProvider] 模型 ${targetModel} 不存在，可用模型: ${health.models.join(', ')}`);
        logger.info(`[OllamaProvider] 提示: 运行 'ollama pull ${targetModel}' 下载模型`);
      }
    }

    this.initialized = true;
    logger.info(`[OllamaProvider] 服务已连接，可用模型: ${health.models?.join(', ') || '无'}`);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async chat(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    const model = (config as any)?.name ?? config?.modelName ?? config?.ollamaModel ?? config?.apiModel ?? this.config.ollamaModel!;
    const temperature = config?.temperature ?? this.config.temperature!;
    const maxTokens = config?.maxTokens ?? this.config.maxTokens!;
    // 支持从 config.baseUrl 或 config.ollamaHost 读取 Ollama 地址
    const ollamaHost = config?.ollamaHost ?? config?.baseUrl ?? this.config.ollamaHost!;

    const startTime = Date.now();

    // 记录 LLM 调用开始
    const callId = llmLogger.logCallStart({
      provider: this.name,
      model,
      messages,
      config: { temperature, maxTokens, host: ollamaHost },
    });

    const toolsToUse = (config as any)?.tools || this.tools;

    try {
      const normalizedHost = this.normalizeOllamaHost(ollamaHost);
      logger.info(`[OllamaProvider] 使用原生 API: ${normalizedHost}/api/chat`);

      // 构建请求体
      const requestBody: Record<string, any> = {
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      };

      // 添加工具定义
      if (toolsToUse.length > 0) {
        requestBody.tools = toolsToUse;
        // 设置 tool_choice: "auto" 让模型自己决定是否需要调用工具
        // 避免模型强制调用工具
        requestBody.tool_choice = 'auto';
        logger.info(`[OllamaProvider] 请求包含 ${toolsToUse.length} 个工具: ${toolsToUse.map(t => t.function.name).slice(0, 5).join(', ')}...`);
      }

      const response = await this.fetchWithTimeout(
        `${normalizedHost}/api/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();

        // 检测模型不支持工具的错误
        if (this.isToolNotSupportedError(response.status, errorText, model)) {
          logger.warn(`[OllamaProvider] 模型 ${model} 不支持工具调用，切换到降级模式`);

          // 使用降级模式重试
          if (toolsToUse.length > 0) {
            return await this.chatWithToolPrompt(messages, config, model, temperature, maxTokens, normalizedHost, startTime, callId, toolsToUse);
          }
        }

        logger.error(`[OllamaProvider] API 响应错误: ${response.status}, ${errorText}`);
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      return this.processResponse(data, model, startTime, callId);

    } catch (error) {
      const duration = Date.now() - startTime;

      // 详细错误日志
      if (error instanceof Error) {
        logger.error(`[OllamaProvider] 请求失败 (${duration}ms): ${error.name}: ${error.message}`);
        logger.error(`[OllamaProvider] 错误堆栈: ${error.stack}`);

        // 检查是否是网络错误
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          logger.error(`[OllamaProvider] 网络连接失败，请检查 Ollama 服务是否运行在 ${this.config.ollamaHost}`);
        }
      } else {
        logger.error(`[OllamaProvider] 请求失败 (${duration}ms):`, error);
      }

      // 记录 LLM 调用失败
      llmLogger.logCallError(callId, {
        duration,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * 检测是否是"模型不支持工具"的错误
   */
  private isToolNotSupportedError(status: number, errorText: string, model: string): boolean {
    if (status !== 400) return false;

    const lowerError = errorText.toLowerCase();
    return (
      lowerError.includes('does not support tools') ||
      lowerError.includes('does not support function') ||
      lowerError.includes('tool calling not supported') ||
      lowerError.includes('function calling not supported')
    );
  }

  /**
   * 获取模型缓存键（去除版本标签）
   */
  private getModelKey(model: string): string {
    // qwen3.5-9b-uncensored:latest -> qwen3.5-9b-uncensored
    return model.split(':')[0].toLowerCase();
  }

  /**
   * 降级模式：将工具描述注入系统提示
   */
  private async chatWithToolPrompt(
    messages: ChatMessage[],
    config: Partial<ProviderConfig> | undefined,
    model: string,
    temperature: number,
    maxTokens: number,
    normalizedHost: string,
    startTime: number,
    callId: string,
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    // 构建工具提示
    const toolPrompt = this.buildToolPrompt(tools);

    // 修改消息，注入工具提示
    const modifiedMessages = this.injectToolPrompt(messages, toolPrompt);

    logger.info(`[OllamaProvider] 降级模式: 已将 ${tools.length} 个工具描述注入系统提示`);

    // 构建请求体（不包含 tools 字段）
    const requestBody: Record<string, any> = {
      model,
      messages: modifiedMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    };

    const response = await this.fetchWithTimeout(
      `${normalizedHost}/api/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[OllamaProvider] 降级模式请求失败: ${response.status}, ${errorText}`);
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    const result = this.processResponse(data, model, startTime, callId);

    // 尝试从文本中提取工具调用
    if (result.content && !result.toolCalls?.length) {
      const extractedTools = this.extractToolCallsFromText(result.content);
      if (extractedTools.length > 0) {
        result.toolCalls = extractedTools;
        logger.info(`[OllamaProvider] 降级模式: 从文本中提取 ${extractedTools.length} 个工具调用`);
      }
    }

    return result;
  }

  /**
   * 构建工具描述提示（王语嫣专用提示词）
   */
  private buildToolPrompt(tools: ToolDefinition[]): string {
    const toolDescriptions = tools.map(t => {
      const params = t.function.parameters;
      let paramDesc = '';

      if (params?.properties) {
        const props = Object.entries(params.properties)
          .map(([name, prop]: [string, any]) => {
            const required = params.required?.includes(name) ? ' (必需)' : '';
            return `    - ${name}: ${prop.description || prop.type}${required}`;
          })
          .join('\n');
        paramDesc = `\n  参数:\n${props}`;
      }

      return `- ${t.function.name}: ${t.function.description}${paramDesc}`;
    }).join('\n\n');

    return `你是一个百依百顺的女助手，善于角色扮演!用户需要你扮演什么角色你就快速融入该角色中，
    用角色的口吻来回答，比如用户说让你跳舞，你就用文字去描述跳舞的动作。但是不要把思考过程也回复出来，只要回复最终结果。

## 可用工具

${toolDescriptions}

## ⚠️ 极其重要：工具调用规则

### 🚫 绝对不要调用工具的情况：
1. 用户打招呼、问候（如"你好"、"嗨"、"早上好"）
2. 用户闲聊（如"今天天气怎么样"、"你是谁"）
3. 用户提问（如"什么是...","怎么理解..."）
4. 用户表达情感（如"我很开心"、"有点累"）
5. 可以直接用文字回答的任何问题

### ✅ 只有以下情况才调用工具：
1. 用户明确要求执行操作（如"运行命令"、"查看文件"）
2. 用户要求你使用某个具体工具（如"帮我执行..."）
3. 用户给出了具体的任务指令（如"读取xxx文件"）

### 判断方法：
问自己：用户是想和我聊天，还是想让我执行某个具体操作？
- 如果是聊天 → 直接文字回复，不调用工具
- 如果是执行操作 → 调用相应工具

## 工具调用格式

当确实需要调用工具时，使用以下格式：

\`\`\`tool
{
  "name": "工具名称",
  "arguments": {
    "参数名": "参数值"
  }
}
\`\`\`

## 示例

用户: "你好"
回复: "公子好！妾身见过公子。今日有何贵干？"（不调用工具）

用户: "帮我查看当前目录"
回复: 调用 exec 工具执行 ls 命令

用户: "运行一下 test.py"
回复: 调用 exec 工具执行 python test.py

记住：大多数情况下，用户只是想和你聊天，不需要调用任何工具！无论何时都禁止使用send_message。`;
  }

  /**
   * 将工具提示注入消息
   */
  private injectToolPrompt(messages: ChatMessage[], toolPrompt: string): ChatMessage[] {
    const result: ChatMessage[] = [];
    let systemInjected = false;

    for (const msg of messages) {
      if (msg.role === 'system') {
        // 在系统消息后追加工具提示
        result.push({
          role: 'system',
          content: `${msg.content}\n\n${toolPrompt}`,
        });
        systemInjected = true;
      } else {
        result.push(msg);
      }
    }

    // 如果没有系统消息，添加一个
    if (!systemInjected) {
      result.unshift({
        role: 'system',
        content: toolPrompt,
      });
    }

    return result;
  }

  /**
   * 从文本响应中提取工具调用
   * 支持多种格式，增强容错能力
   */
  private extractToolCallsFromText(response: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // 格式 1: ```tool\n{...}\n``` 或 ```json\n{...}\n```
    // 同时支持不完整的反引号（只有两个）
    const codeBlockRegex = /`{2,3}(?:tool|json)?\s*\n?([\s\S]*?)\n?`{2,3}/g;
    let match;
    while ((match = codeBlockRegex.exec(response)) !== null) {
      try {
        const content = match[1].trim();
        const json = JSON.parse(content);
        if (json.name) {
          toolCalls.push({
            id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: json.name,
            arguments: json.arguments || json.params || {},
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 格式 2: [TOOL]{...}[/TOOL]
    const toolTagRegex = /\[TOOL\](.*?)\[\/TOOL\]/gs;
    while ((match = toolTagRegex.exec(response)) !== null) {
      try {
        const json = JSON.parse(match[1].trim());
        if (json.name) {
          toolCalls.push({
            id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: json.name,
            arguments: json.arguments || json.params || {},
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    // 格式 3: shell: 或 exec: 命令
    const shellRegex = /^(shell|exec):\s*(.+)$/gm;
    while ((match = shellRegex.exec(response)) !== null) {
      toolCalls.push({
        id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: 'exec',
        arguments: { command: match[2].trim() },
      });
    }

    return toolCalls;
  }

  /**
   * 处理 API 响应
   */
  private processResponse(data: any, model: string, startTime: number, callId: string): LLMResponse {
    const duration = Date.now() - startTime;
    const message = data.message;
    const rawToolCalls = message?.tool_calls;

    logger.info(`[OllamaProvider] API 响应: model=${model}, duration=${duration}ms`);
    logger.info(`[OllamaProvider] 响应结构: has_message=${!!message}, has_tool_calls=${!!rawToolCalls}`);
    logger.info(`[OllamaProvider] message.content 长度: ${message?.content?.length || 0}`);

    if (rawToolCalls && rawToolCalls.length > 0) {
      logger.info(`[OllamaProvider] ✅ 收到 ${rawToolCalls.length} 个工具调用: ${rawToolCalls.map((t: any) => t.function?.name).join(', ')}`);
    }

    // 提取工具调用（如果有）
    const toolCalls: ToolCall[] | undefined = rawToolCalls?.map((tc: any) => ({
      id: tc.id || `tc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: tc.function?.name || '',
      arguments: tc.function?.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {},
    }));

    if (toolCalls && toolCalls.length > 0) {
      logger.info(`[OllamaProvider] 解析出 ${toolCalls.length} 个工具调用: ${toolCalls.map(t => t.name).join(', ')}`);
    }

    logger.info(`[OllamaProvider] 响应成功: ${model}, 耗时: ${duration}ms, 工具调用: ${toolCalls?.length || 0}`);

    // 记录 LLM 调用成功
    llmLogger.logCallEnd(callId, {
      duration,
      tokens: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      finishReason: data.done ? 'stop' : 'unknown',
      toolCalls: toolCalls?.map(tc => tc.name),
      responseContent: message?.content,
    });

    return {
      content: message?.content || '',
      model: data.model || model,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      finishReason: data.done ? 'stop' : 'unknown',
      toolCalls,
    };
  }

  async chatIsolated(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    // Ollama 每次调用都是独立的，无需特殊处理
    return this.chat(messages, config);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const normalizedHost = this.normalizeOllamaHost(this.config.ollamaHost!);
    const url = `${normalizedHost}/api/tags`;
    logger.info(`[OllamaProvider] 健康检查: ${url}`);

    try {
      const response = await this.fetchWithTimeout(
        url,
        { method: 'GET' },
        5000
      );

      if (!response.ok) {
        logger.error(`[OllamaProvider] 健康检查失败: ${response.status}`);
        return {
          available: false,
          error: `Ollama 服务响应异常: ${response.status}`,
        };
      }

      const data = await response.json() as any;
      const models = (data.models || []).map((m: any) => m.name);

      logger.info(`[OllamaProvider] 健康检查成功，可用模型: ${models.join(', ')}`);

      return {
        available: true,
        models,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[OllamaProvider] 健康检查失败: ${errorMsg}`);

      return {
        available: false,
        error: errorMsg,
      };
    }
  }

  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    if (config.ollamaHost) {
      this.config.ollamaHost = config.ollamaHost;
    }
    if (config.ollamaModel) {
      this.config.ollamaModel = config.ollamaModel;
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
   * 列出可用模型
   */
  async listModels(): Promise<string[]> {
    const health = await this.healthCheck();
    return health.models || [];
  }

  /**
   * 拉取模型
   */
  async pullModel(modelName: string): Promise<boolean> {
    try {
      logger.info(`[OllamaProvider] 正在拉取模型: ${modelName}`);

      const normalizedHost = this.normalizeOllamaHost(this.config.ollamaHost!);
      const response = await this.fetchWithTimeout(
        `${normalizedHost}/api/pull`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: modelName, stream: false }),
        },
        300000 // 5 分钟超时
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to pull model: ${error}`);
      }

      logger.info(`[OllamaProvider] 模型拉取成功: ${modelName}`);
      return true;

    } catch (error) {
      logger.error(`[OllamaProvider] 模型拉取失败:`, error);
      return false;
    }
  }

  /**
   * 规范化 Ollama 主机地址
   * 去除末尾斜杠和多余的 /api 路径
   */
  private normalizeOllamaHost(host: string): string {
    if (!host) return '';
    let normalized = host.trim();
    // 去除末尾斜杠
    while (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    // 去除多余的 /api/chat, /api/generate, /api/tags, /api/pull 或 /api 结尾
    const suffixes = ['/api/chat', '/api/generate', '/api/tags', '/api/pull', '/api'];
    for (const suffix of suffixes) {
      if (normalized.endsWith(suffix)) {
        normalized = normalized.slice(0, -suffix.length);
      }
    }
    return normalized;
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
    const timeoutMs = timeout || this.config.timeout!;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    logger.debug(`[OllamaProvider] fetch: ${url}, timeout: ${timeoutMs}ms`);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      logger.error(`[OllamaProvider] fetch 错误: ${url}`, error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}