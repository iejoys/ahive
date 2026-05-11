/**
 * 本地 GGUF 模型 Provider
 * 
 * 使用 node-llama-cpp 直接加载 GGUF 模型文件
 * 
 * 注意：本地模型不支持原生 Function Calling
 * 采用优雅降级策略：将工具描述注入系统提示，让模型以文本格式输出工具调用
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ILLMProvider,
  ProviderConfig,
  LLMResponse,
  HealthCheckResult,
  ToolCall,
} from './index.js';
import type { ChatMessage } from '../agents/index.js';
import { logger, llmLogger } from '../utils/index.js';

// node-llama-cpp 类型（动态导入）
type LlamaModel = any;
type LlamaContext = any;
type LlamaChatSession = any;

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
 * 本地模型 Provider 实现
 */
export class LocalProvider implements ILLMProvider {
  readonly type = 'local' as const;
  readonly name = '本地模型 (GGUF)';

  private config: ProviderConfig;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private session: LlamaChatSession | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  
  // 工具定义（优雅降级：注入到系统提示）
  private tools: ToolDefinition[] = [];

  constructor(config: ProviderConfig) {
    // 先读取 models.json 配置作为基础默认值
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const modelsConfigPath = path.join(__dirname, '../../config/models.json');
    let modelsSettings = {
      defaultGpuLayers: 35,  // 默认使用 GPU
      defaultThreads: 4,
      defaultContextSize: 2048,
      defaultSequences: 1,
      defaultTemperature: 0.7,
      defaultMaxTokens: 2048
    };
    let currentModelFile = 'Qwen2.5-7B-Instruct-Q4_K_M.gguf';
    
    try {
      if (fs.existsSync(modelsConfigPath)) {
        const modelsConfig = JSON.parse(fs.readFileSync(modelsConfigPath, 'utf-8'));
        if (modelsConfig.settings) {
          modelsSettings = {
            defaultGpuLayers: modelsConfig.settings.defaultGpuLayers ?? 35,
            defaultThreads: modelsConfig.settings.defaultThreads ?? 4,
            defaultContextSize: modelsConfig.settings.defaultContextSize ?? 2048,
            defaultSequences: modelsConfig.settings.defaultSequences ?? 1,
            defaultTemperature: modelsConfig.settings.defaultTemperature ?? 0.7,
            defaultMaxTokens: modelsConfig.settings.defaultMaxTokens ?? 2048
          };
        }
        if (modelsConfig.currentModel) {
          currentModelFile = modelsConfig.currentModel;
        }
      }
    } catch (e) {
      logger.warn(`[LocalProvider] 读取 models.json 失败，使用默认配置`);
    }
    
    // 合并配置：前端传入的参数优先，但需要验证有效性
    this.config = {
      type: config.type || 'local',
      modelPath: config.modelPath || path.join(__dirname, '../../models', currentModelFile),
      modelName: config.modelName,
      // 关键：验证传入值是否有效（NaN 或 undefined 使用默认值）
      gpuLayers: (config.gpuLayers !== undefined && !isNaN(config.gpuLayers) && config.gpuLayers !== null) 
        ? config.gpuLayers 
        : modelsSettings.defaultGpuLayers,
      threads: (config.threads !== undefined && !isNaN(config.threads) && config.threads !== null) 
        ? config.threads 
        : modelsSettings.defaultThreads,
      contextSize: (config.contextSize !== undefined && !isNaN(config.contextSize) && config.contextSize !== null) 
        ? config.contextSize 
        : modelsSettings.defaultContextSize,
      sequences: (config.sequences !== undefined && !isNaN(config.sequences) && config.sequences !== null) 
        ? config.sequences 
        : modelsSettings.defaultSequences,
      temperature: (config.temperature !== undefined && !isNaN(config.temperature)) 
        ? config.temperature 
        : modelsSettings.defaultTemperature,
      maxTokens: config.maxTokens || modelsSettings.defaultMaxTokens,
    };
    
    // 从 modelPath 提取模型名（如果未提供）
    if (!this.config.modelName) {
      const modelFile = path.basename(this.config.modelPath!);
      this.config.modelName = modelFile.replace(/\.gguf$/i, '').replace(/-Q[0-9]_[A-Z]+$/i, '');
    }

    // 打印配置日志，方便调试
    logger.info(`[LocalProvider] 初始化配置:`);
    logger.info(`  - 模型: ${this.config.modelName}`);
    logger.info(`  - GPU Layers: ${this.config.gpuLayers}`);
    logger.info(`  - Threads: ${this.config.threads}`);
    logger.info(`  - Context Size: ${this.config.contextSize}`);
    logger.info(`  - Sequences: ${this.config.sequences}`);
  }

  /**
   * 设置可用工具
   * 本地模型不支持原生 Function Calling，采用优雅降级策略
   */
  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
    logger.info(`[LocalProvider] 设置 ${tools.length} 个工具（将注入到系统提示）: ${tools.map(t => t.function.name).join(', ')}`);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      // 检查模型文件是否存在
      if (!fs.existsSync(this.config.modelPath!)) {
        throw new Error(`模型文件不存在: ${this.config.modelPath}`);
      }

      logger.info(`[LocalProvider] 加载模型: ${this.config.modelPath}`);
      const startTime = Date.now();

      // 动态导入 node-llama-cpp
      const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

      // 获取 Llama 实例
      const llama = await getLlama({
        gpuLayers: this.config.gpuLayers,
        threads: this.config.threads,
      });

      // 加载模型
      this.model = await llama.loadModel({
        modelPath: this.config.modelPath!,
      });

      // 创建上下文（sequences 数量可配置，默认 1 以减少显存占用）
      this.context = await this.model.createContext({
        contextSize: this.config.contextSize,
        sequences: this.config.sequences ?? 1,
      });

      // 创建 Chat Session
      this.session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
      });

      const loadTime = Date.now() - startTime;
      this.initialized = true;

      logger.info(`[LocalProvider] 模型加载完成，耗时: ${loadTime}ms`);
      console.log(`  ✅ 本地模型已加载: ${this.config.modelName}`);

    } catch (error) {
      logger.error(`[LocalProvider] 模型加载失败:`, error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async chat(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.session) {
      throw new Error('模型未初始化');
    }

    const temperature = config?.temperature ?? this.config.temperature!;
    const maxTokens = config?.maxTokens ?? this.config.maxTokens!;
    const model = this.config.modelName!;
    
    // 获取工具定义（支持从 config 中传递）
    const toolsToUse = (config as any)?.tools || this.tools;

    const startTime = Date.now();
    
    // 记录 LLM 调用开始
    const callId = llmLogger.logCallStart({
      provider: this.name,
      model,
      messages,
      config: { temperature, maxTokens, contextSize: this.config.contextSize },
    });

    try {
      // 构建提示词（如果有工具，注入工具描述）
      const prompt = this.buildPrompt(messages, toolsToUse);

      const promptOptions: any = {
        maxTokens,
        temperature,
        topP: 0.9,
        minP: 0,
        repeatPenalty: 1.1,
      };

      const responseText = await this.session.prompt(prompt, promptOptions);

      const duration = Date.now() - startTime;
      logger.info(`[LocalProvider] 生成完成，耗时: ${duration}ms, 长度: ${responseText.length}`);

      // 从响应文本中提取工具调用
      const toolCalls = this.extractToolCallsFromText(responseText);
      
      // 估算 token 使用（本地模型没有精确的 token 计数）
      const estimatedPromptTokens = Math.floor(prompt.length / 4);
      const estimatedCompletionTokens = Math.floor(responseText.length / 4);
      
      // 记录 LLM 调用成功
      llmLogger.logCallEnd(callId, {
        duration,
        tokens: {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
        },
        finishReason: 'stop',
        toolCalls: toolCalls.map(tc => tc.name),
        responseContent: responseText,
      });

      return {
        content: responseText,
        model: this.config.modelName!,
        usage: {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
        },
        finishReason: 'stop',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[LocalProvider] 生成失败 (${duration}ms):`, error);
      
      // 记录 LLM 调用失败
      llmLogger.logCallError(callId, {
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    }
  }

  /**
   * 构建带工具描述的提示词
   * 优雅降级：将工具描述注入到系统提示中
   */
  private buildPrompt(messages: ChatMessage[], tools?: ToolDefinition[]): string {
    // 构建系统提示
    let systemPrompt = '';
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg) {
      systemPrompt = typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content);
    }
    
    // 如果有工具，注入工具描述
    if (tools && tools.length > 0) {
      const toolsDescription = this.buildToolsDescription(tools);
      if (systemPrompt) {
        systemPrompt = `${systemPrompt}\n\n${toolsDescription}`;
      } else {
        systemPrompt = toolsDescription;
      }
      logger.info(`[LocalProvider] 注入 ${tools.length} 个工具描述到系统提示`);
    }
    
    // 找到最后一条用户消息
    let userPrompt = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const rawContent = messages[i].content;
        userPrompt = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
        break;
      }
    }
    
    // 组合提示
    if (systemPrompt && userPrompt) {
      return `${systemPrompt}\n\n${userPrompt}`;
    }
    const lastContent = messages[messages.length - 1]?.content;
    const lastText = typeof lastContent === 'string' ? lastContent : '';
    return userPrompt || systemPrompt || lastText || '';
  }
  
  /**
   * 构建工具描述文本
   * 将 OpenAI 格式的工具定义转换为文本描述
   */
  private buildToolsDescription(tools: ToolDefinition[]): string {
    const toolLines = tools.map(tool => {
      const fn = tool.function;
      const params = fn.parameters?.properties 
        ? Object.entries(fn.parameters.properties)
            .map(([name, schema]: [string, any]) => {
              const type = schema.type || 'any';
              const desc = schema.description || '';
              const required = fn.parameters.required?.includes(name) ? ' (必需)' : '';
              return `    - ${name}: ${type}${required} - ${desc}`;
            })
            .join('\n')
        : '    无参数';
      
      return `### ${fn.name}\n${fn.description}\n参数:\n${params}`;
    });
    
    return `## 可用工具

你可以使用以下工具来完成任务。如果需要调用工具，请使用以下格式之一：

### 格式 1: [TOOL] 格式（推荐）
\`\`\`
[TOOL]
{
  "name": "工具名称",
  "arguments": { 参数对象 }
}
[/TOOL]
\`\`\`

### 格式 2: 代码块格式
\`\`\`tool
{
  "name": "工具名称",
  "arguments": { 参数对象 }
}
\`\`\`

### 格式 3: 简单命令格式（仅适用于 exec 工具）
\`\`\`
shell: 你的命令
\`\`\`

## 工具列表

${toolLines.join('\n\n')}

---
请根据用户需求选择合适的工具。`;
  }

  /**
   * 从文本响应中提取工具调用
   * 支持多种格式：
   * - ```tool\n{...}\n``` 代码块格式
   * - [TOOL]{...}[/TOOL] 格式
   * - shell: command 格式
   * - exec: command 格式
   */
  private extractToolCallsFromText(response: string): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    
    // ========== 格式 1: [TOOL]{...}[/TOOL] ==========
    // 使用手动解析处理嵌套JSON
    const startMarker = '[TOOL]';
    const endMarker = '[/TOOL]';
    let searchPos = 0;
    
    while (true) {
      const startPos = response.indexOf(startMarker, searchPos);
      if (startPos === -1) break;
      
      const jsonStart = startPos + startMarker.length;
      const jsonEnd = this.findMatchingBrace(response, jsonStart);
      
      if (jsonEnd !== -1) {
        const jsonStr = response.slice(jsonStart, jsonEnd + 1).trim();
        if (jsonStr && jsonStr !== '{}') {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.name && typeof parsed.name === 'string') {
              toolCalls.push({
                id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: parsed.name,
                arguments: parsed.arguments || parsed.params || {},
              });
            }
          } catch (e) {
            logger.warn(`[LocalProvider] [TOOL] JSON 解析失败: ${jsonStr.substring(0, 50)}`);
          }
        }
      }
      
      const endPos = response.indexOf(endMarker, jsonStart);
      searchPos = endPos !== -1 ? endPos + endMarker.length : jsonStart + 1;
    }
    
    // ========== 格式 2: ```tool\n{...}\n``` ==========
    // 使用手动解析
    const codeBlockStart = '```tool\n';
    const codeBlockEnd = '\n```';
    searchPos = 0;
    
    while (true) {
      const startPos = response.indexOf(codeBlockStart, searchPos);
      if (startPos === -1) break;
      
      const jsonStart = startPos + codeBlockStart.length;
      const jsonEnd = this.findMatchingBrace(response, jsonStart);
      
      if (jsonEnd !== -1) {
        const jsonStr = response.slice(jsonStart, jsonEnd + 1).trim();
        if (jsonStr && jsonStr !== '{}' && jsonStr.startsWith('{')) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.name && typeof parsed.name === 'string') {
              toolCalls.push({
                id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: parsed.name,
                arguments: parsed.arguments || parsed.params || {},
              });
            }
          } catch (e) {
            logger.warn(`[LocalProvider] tool code block JSON parse failed: ${jsonStr.substring(0, 50)}`);
          }
        }
      }
      
      const endPos = response.indexOf(codeBlockEnd, jsonStart);
      searchPos = endPos !== -1 ? endPos + codeBlockEnd.length : jsonStart + 1;
    }
    
    // ========== 格式 3: shell: command 或 exec: command ==========
    const shellPattern = /^(shell|exec):\s*(.+?)(?:\n|$)/gm;
    let match;
    while ((match = shellPattern.exec(response)) !== null) {
      const cmd = match[2].trim();
      if (cmd) {
        toolCalls.push({
          id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: 'exec',
          arguments: { command: cmd },
        });
      }
    }
    
    return toolCalls;
  }
  
  /**
   * 查找匹配的闭合大括号
   * 正确处理嵌套JSON对象和字符串转义
   */
  private findMatchingBrace(str: string, start: number): number {
    if (str[start] !== '{') return -1;
    
    let depth = 0;
    let inString = false;
    let escape = false;
    
    for (let i = start; i < str.length; i++) {
      const char = str[i];
      
      if (escape) {
        escape = false;
        continue;
      }
      
      if (char === '\\') {
        escape = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) return i;
        }
      }
    }
    
    return -1;
  }

  async chatIsolated(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.context) {
      throw new Error('模型未初始化');
    }

    const temperature = config?.temperature ?? this.config.temperature!;
    const maxTokens = config?.maxTokens ?? 1024;
    const model = this.config.modelName!;
    
    // 获取工具定义（支持从 config 中传递）
    const toolsToUse = (config as any)?.tools || this.tools;

    const startTime = Date.now();
    
    // 记录 LLM 调用开始（标记为 isolated）
    const callId = llmLogger.logCallStart({
      provider: this.name,
      model,
      messages,
      config: { temperature, maxTokens, contextSize: this.config.contextSize },
      isIsolated: true,
    });
    
    let tempSequence: any = null;

    try {
      // 创建临时的 context sequence
      tempSequence = this.context.getSequence();
      
      const { LlamaChatSession } = await import('node-llama-cpp');
      
      const tempSession = new LlamaChatSession({
        contextSequence: tempSequence,
      });

      const prompt = this.buildPrompt(messages, toolsToUse);

      const promptOptions: any = {
        maxTokens,
        temperature,
        topP: 0.9,
        minP: 0,
        repeatPenalty: 1.1,
      };

      const responseText = await tempSession.prompt(prompt, promptOptions);

      const duration = Date.now() - startTime;
      logger.debug(`[LocalProvider] 隔离调用完成，耗时: ${duration}ms`);

      // 从响应文本中提取工具调用
      const toolCalls = this.extractToolCallsFromText(responseText);
      
      // 估算 token 使用
      const estimatedPromptTokens = Math.floor(prompt.length / 4);
      const estimatedCompletionTokens = Math.floor(responseText.length / 4);
      
      // 记录 LLM 调用成功
      llmLogger.logCallEnd(callId, {
        duration,
        tokens: {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
        },
        finishReason: 'stop',
        toolCalls: toolCalls.map(tc => tc.name),
        responseContent: responseText,
      });

      return {
        content: responseText,
        model: this.config.modelName!,
        usage: {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
        },
        finishReason: 'stop',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[LocalProvider] 隔离调用失败:`, error);
      
      // 记录 LLM 调用失败
      llmLogger.logCallError(callId, {
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    } finally {
      if (tempSequence && !tempSequence.disposed) {
        try {
          tempSequence.dispose();
        } catch (e) {
          // ignore
        }
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      if (!fs.existsSync(this.config.modelPath!)) {
        return {
          available: false,
          error: `模型文件不存在: ${this.config.modelPath}`,
        };
      }

      if (!this.initialized) {
        await this.initialize();
      }

      return {
        available: this.initialized,
        modelInfo: {
          name: this.config.modelName!,
          contextLength: this.config.contextSize,
        },
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getConfig(): ProviderConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ProviderConfig>): void {
    // 本地模型更新配置需要重新加载
    if (config.modelPath && config.modelPath !== this.config.modelPath) {
      this.config.modelPath = config.modelPath;
      this._needsReload();
    }
    if (config.modelName) {
      this.config.modelName = config.modelName;
    }
    if (config.gpuLayers !== undefined) {
      this.config.gpuLayers = config.gpuLayers;
      this._needsReload();
    }
    if (config.threads !== undefined) {
      this.config.threads = config.threads;
      this._needsReload();
    }
    if (config.contextSize !== undefined) {
      this.config.contextSize = config.contextSize;
      this._needsReload();
    }
    if (config.temperature !== undefined) {
      this.config.temperature = config.temperature;
    }
    if (config.maxTokens !== undefined) {
      this.config.maxTokens = config.maxTokens;
    }
  }

  private _needsReload(): void {
    // 标记需要重新加载
    if (this.initialized) {
      logger.info(`[LocalProvider] 配置已更新，需要重新加载模型`);
      // 不自动重新加载，等待下次 initialize
    }
  }

  async dispose(): Promise<void> {
    if (this.session) {
      this.session = null;
    }
    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }
    this.initialized = false;
    this.initPromise = null;
    logger.info('[LocalProvider] 资源已释放');
  }
}