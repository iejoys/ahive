/**
 * Provider Manager
 * 
 * 管理多个 LLM Provider，支持热切换
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  ILLMProvider,
  ProviderType,
  ProviderConfig,
  LLMResponse,
  HealthCheckResult,
  ProvidersConfigFile,
  SavedProvider,
} from './index.js';
import {
  LocalProvider,
  OllamaProvider,
  OpenAIProvider,
  MiniMaxProvider,
  isMiniMaxModel,
  API_PRESETS,
  createDefaultProvidersConfig,
  type ToolDefinition,
} from './index.js';
import type { ChatMessage } from '../agents/index.js';
import type { StreamCallbacks } from './index.js';
import { logger, llmLogger } from '../utils/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '../../config/providers.json');

/**
 * Provider 切换事件
 */
export type ProviderSwitchCallback = (
  oldProvider: ILLMProvider,
  newProvider: ILLMProvider
) => void | Promise<void>;

/**
 * Provider Manager 实现
 */
export class ProviderManager {
  private config: ProvidersConfigFile;
  private currentProvider: ILLMProvider | null = null;
  private providerCache: Map<string, ILLMProvider> = new Map();
  private switchCallbacks: ProviderSwitchCallback[] = [];

  constructor() {
    this.config = this.loadConfig();
    logger.info(`[ProviderManager] 初始化，当前 Provider: ${this.config.currentProvider}`);
  }

  /**
   * 加载配置
   */
  private loadConfig(): ProvidersConfigFile {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[ProviderManager] 加载配置失败，使用默认配置:`, error);
    }
    return createDefaultProvidersConfig();
  }

  /**
   * 保存配置
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      logger.debug(`[ProviderManager] 配置已保存`);
    } catch (error) {
      logger.error(`[ProviderManager] 保存配置失败:`, error);
    }
  }

  /**
   * 初始化当前 Provider
   */
  async initialize(): Promise<void> {
    this.currentProvider = await this.createProvider(
      this.config.currentProvider,
      this.config.currentConfig
    );
    
    try {
      await this.currentProvider.initialize();
      logger.info(`[ProviderManager] Provider 已初始化: ${this.currentProvider.name}`);
    } catch (error) {
      logger.error(`[ProviderManager] Provider 初始化失败:`, error);
    }
  }

  /**
   * 创建 Provider 实例
   */
  private async createProvider(
    type: ProviderType,
    config: ProviderConfig
  ): Promise<ILLMProvider> {
    const cacheKey = `${type}:${JSON.stringify(config)}`;
    
    // 检查缓存
    if (this.providerCache.has(cacheKey)) {
      return this.providerCache.get(cacheKey)!;
    }

    let provider: ILLMProvider;

    // 🔧 特殊处理：MiniMax 模型使用专门的 MiniMaxProvider
    // MiniMax API 有特殊格式要求（不接受 temperature、max_tokens 等参数）
    const modelName = config.apiModel || config.modelName || '';
    if (isMiniMaxModel(modelName)) {
      logger.info(`[ProviderManager] 检测到 MiniMax 模型 "${modelName}"，使用 MiniMaxProvider`);
      provider = new MiniMaxProvider(config);
    } else {
      switch (type) {
        case 'local':
          provider = new LocalProvider(config);
          break;
        case 'ollama':
          provider = new OllamaProvider(config);
          break;
        case 'openai':
        default:
          // 所有非 local/ollama 类型都使用 OpenAI Provider（兼容 OpenAI API 格式）
          // 包括：bailian、deepseek、qwen、moonshot 等
          if (type !== 'openai') {
            logger.info(`[ProviderManager] Provider 类型 "${type}" 使用 OpenAI 兼容模式`);
          }
          provider = new OpenAIProvider(config);
          break;
      }
    }

    this.providerCache.set(cacheKey, provider);
    return provider;
  }

  /**
   * 根据配置获取或创建 Provider
   * 支持智能体独立配置 Provider
   */
  private async getOrCreateProvider(config: Partial<ProviderConfig>): Promise<ILLMProvider> {
    // 如果没有指定 provider 类型，使用全局 Provider
    if (!config.type) {
      return this.getCurrentProvider();
    }

    // 生成缓存 key
    const cacheKey = `${config.type}:${config.apiModel || config.ollamaModel || config.modelName || 'default'}`;
    
    // 检查缓存
    if (this.providerCache.has(cacheKey)) {
      return this.providerCache.get(cacheKey)!;
    }

    // 创建新 Provider
    const provider = await this.createProvider(config.type, {
      ...this.config.currentConfig,
      ...config,
    } as ProviderConfig);
    
    // 初始化
    await provider.initialize();
    
    logger.info(`[ProviderManager] 为配置创建新 Provider: ${config.type}:${config.apiModel || config.ollamaModel || config.modelName}`);
    
    return provider;
  }

  /**
   * 获取当前 Provider
   */
  getCurrentProvider(): ILLMProvider {
    if (!this.currentProvider) {
      throw new Error('Provider 未初始化');
    }
    return this.currentProvider;
  }

  /**
   * 切换 Provider（热切换）
   */
  async switchProvider(
    type: ProviderType,
    config?: Partial<ProviderConfig>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const oldProvider = this.currentProvider;
      
      // 合并配置
      const newConfig: ProviderConfig = {
        ...this.config.currentConfig,
        ...config,
        type,
      };

      // 创建新的 Provider
      const newProvider = await this.createProvider(type, newConfig);
      
      // 初始化新 Provider
      await newProvider.initialize();

      // 切换成功，更新当前 Provider
      this.currentProvider = newProvider;
      this.config.currentProvider = type;
      this.config.currentConfig = newConfig;
      this.saveConfig();

      // 通知回调
      if (oldProvider) {
        for (const callback of this.switchCallbacks) {
          try {
            await callback(oldProvider, newProvider);
          } catch (error) {
            logger.error(`[ProviderManager] 切换回调失败:`, error);
          }
        }
      }

      logger.info(`[ProviderManager] Provider 已切换: ${newProvider.name}`);
      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[ProviderManager] 切换 Provider 失败:`, error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 更新当前 Provider 配置
   */
  updateCurrentConfig(config: Partial<ProviderConfig>): void {
    if (this.currentProvider) {
      this.currentProvider.updateConfig(config);
      this.config.currentConfig = {
        ...this.config.currentConfig,
        ...config,
      };
      this.saveConfig();
    }
  }

  /**
   * 设置工具定义（用于 Function Calling）
   * 参考 CODEX：在 API 请求中传递工具定义
   */
  setTools(tools: ToolDefinition[]): void {
    if (this.currentProvider && 'setTools' in this.currentProvider) {
      (this.currentProvider as any).setTools(tools);
      logger.info(`[ProviderManager] 已设置 ${tools.length} 个工具到 Provider`);
    } else {
      logger.debug(`[ProviderManager] 当前 Provider 不支持 Function Calling`);
    }
  }

  /**
   * 根据 config 动态获取或创建 Provider
   * 如果 config 指定了 provider，使用对应的 Provider；否则使用全局 Provider
   * 
   * 支持的字段映射（兼容 AgentModelConfig）：
   * - provider/type → Provider 类型
   * - name/apiModel/modelName → 模型名称
   * - baseUrl/apiEndpoint → API 端点
   * - ollamaHost → Ollama 地址
   */
  private async getProviderForConfig(config?: Partial<ProviderConfig> & { provider?: string; name?: string }): Promise<ILLMProvider> {
    // 获取 provider 类型（支持 provider 和 type 两种字段名）
    const providerTypeRaw = config?.provider || config?.type;
    
    // 如果没有指定 provider 类型，使用全局 Provider
    if (!providerTypeRaw) {
      return this.getCurrentProvider();
    }

    // 获取模型名称（支持 name/apiModel/modelName/ollamaModel 多种字段名）
    const modelName = config?.name || config?.apiModel || config?.modelName || config?.ollamaModel;
    
    // 映射 provider 类型：local/ollama 保持不变，minimax 使用专用 Provider，其他默认为 openai
    let providerType: ProviderType;
    if (providerTypeRaw === 'local') {
      providerType = 'local';
    } else if (providerTypeRaw === 'ollama') {
      providerType = 'ollama';
    } else if (providerTypeRaw === 'minimax' || (modelName && isMiniMaxModel(modelName))) {
      // MiniMax 模型使用专用 Provider（有特殊 API 格式要求）
      providerType = 'openai'; // MiniMaxProvider 的 type 也是 'openai'
    } else {
      // openai, anthropic, bailian, custom 等都使用 openai provider
      providerType = 'openai';
    }
    
    // 构建 Provider 配置
    const providerConfig: ProviderConfig = {
      ...this.config.currentConfig,
      ...config,
      type: providerType,
    };

    // 设置模型名称
    if (modelName) {
      if (providerType === 'ollama') {
        providerConfig.ollamaModel = modelName;
      } else if (providerType === 'openai') {
        providerConfig.apiModel = modelName;
      } else {
        providerConfig.modelName = modelName;
      }
    }

    // 处理 Ollama 特殊配置
    if (providerType === 'ollama') {
      if (config?.ollamaHost) {
        providerConfig.baseUrl = config.ollamaHost;
        providerConfig.ollamaHost = config.ollamaHost;
      }
    }

    // 处理 OpenAI 兼容 API（包括 anthropic, bailian, custom 等）
    if (providerType === 'openai') {
      // baseUrl 和 apiEndpoint 都支持
      if (config?.baseUrl) {
        providerConfig.apiEndpoint = config.baseUrl;
      }
      if (config?.apiEndpoint) {
        providerConfig.apiEndpoint = config.apiEndpoint;
      }
      if (config?.apiKey) {
        providerConfig.apiKey = config.apiKey;
      }
    }

    logger.debug(`[ProviderManager] 为 Agent 创建 Provider: type=${providerType}, model=${modelName || 'default'}`);
    
    // 创建或从缓存获取 Provider
    return this.createProvider(providerType, providerConfig);
  }

  /**
   * 聊天（代理到当前 Provider 或 config 指定的 Provider）
   * 注意：日志记录由各 Provider 自己处理，避免重复记录
   */
  async chat(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    // 如果 config 指定了 provider，使用对应的 Provider
    const provider = await this.getProviderForConfig(config);
    
    // 如果是新创建的 Provider，需要初始化
    if (!provider.isInitialized()) {
      await provider.initialize();
    }
    
    return provider.chat(messages, config);
  }

  /**
   * 流式聊天（代理到当前 Provider）
   * 支持真正的流式输出，实时返回 LLM 响应
   * 
   * 如果 config 中指定了 provider，则使用对应的 Provider
   * 否则使用全局当前 Provider
   */
  async chatStream(
    messages: ChatMessage[],
    onDelta: (delta: string) => void,
    config?: Partial<ProviderConfig>,
    onThinkingDelta?: (delta: string) => void
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    
    // 根据 config.type 选择 Provider
    const provider = await this.getProviderForConfig(config);
    const providerType = config?.type || this.config.currentProvider;
    const model = config?.apiModel || config?.ollamaModel || config?.modelName || 'unknown';
    
    // 记录调用开始（标记为流式）
    const callId = llmLogger.logCallStart({
      provider: this.config.currentProvider,
      model,
      messages,
      config,
      isStream: true,
    });
    
    try {
      let response: LLMResponse;
      
      if ('chatStream' in provider && typeof (provider as any).chatStream === 'function') {
        const callbacks: StreamCallbacks = { onDelta };
        if (onThinkingDelta) {
          callbacks.onThinkingDelta = onThinkingDelta;
        }
        response = await (provider as any).chatStream(messages, callbacks, config);
      } else {
        // 不支持流式时降级为非流式
        logger.warn(`[ProviderManager] 当前 Provider 不支持流式输出，降级为非流式`);
        response = await provider.chat(messages, config);
        // 模拟流式输出
        if (response.content) {
          const chunkSize = 50;
          for (let i = 0; i < response.content.length; i += chunkSize) {
            const delta = response.content.slice(i, i + chunkSize);
            onDelta(delta);
            await new Promise(resolve => setTimeout(resolve, 10)); // 模拟延迟
          }
        }
      }
      
      const duration = Date.now() - startTime;
      
      // 记录调用成功
      llmLogger.logCallEnd(callId, {
        duration,
        tokens: response.usage,
        finishReason: response.finishReason,
        toolCalls: response.toolCalls?.map(tc => tc.name),
      });
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // 记录调用失败
      llmLogger.logCallError(callId, {
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    }
  }

  /**
   * 隔离调用（代理到当前 Provider）
   * 如果 config 指定了 provider，则使用对应的 Provider；否则使用全局 Provider
   */
  async chatIsolated(messages: ChatMessage[], config?: Partial<ProviderConfig>): Promise<LLMResponse> {
    const startTime = Date.now();
    
    // 根据 config.type 选择 Provider
    const provider = await this.getProviderForConfig(config);
    const providerType = config?.type || this.config.currentProvider;
    const model = config?.apiModel || config?.ollamaModel || config?.modelName || 'unknown';
    
    // 记录调用开始（标记为隔离）
    const callId = llmLogger.logCallStart({
      provider: this.config.currentProvider,
      model,
      messages,
      config,
      isIsolated: true,
    });
    
    try {
      const response = provider.chatIsolated 
        ? await provider.chatIsolated(messages, config)
        : await provider.chat(messages, config);
      
      const duration = Date.now() - startTime;
      
      // 记录调用成功
      llmLogger.logCallEnd(callId, {
        duration,
        tokens: response.usage,
        finishReason: response.finishReason,
        toolCalls: response.toolCalls?.map(tc => tc.name),
      });
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // 记录调用失败
      llmLogger.logCallError(callId, {
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw error;
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<HealthCheckResult> {
    return this.getCurrentProvider().healthCheck();
  }

  /**
   * 测试 Provider 配置
   * 用于验证新配置是否有效，不影响当前 Provider
   */
  async testProvider(
    type: ProviderType,
    config: Partial<ProviderConfig>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 创建临时 Provider 进行测试
      const testConfig: ProviderConfig = {
        ...this.config.currentConfig,
        ...config,
        type,
      };

      const testProvider = await this.createProvider(type, testConfig);
      await testProvider.initialize();

      // 执行健康检查
      const healthResult = await testProvider.healthCheck();

      if (healthResult.available) {
        return { success: true };
      } else {
        return { success: false, error: healthResult.error || '健康检查失败' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[ProviderManager] 测试 Provider 失败:`, error);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * 获取当前配置
   * @param includeSecrets 是否包含敏感信息（如 API Key），默认 false（脱敏）
   */
  getCurrentConfig(includeSecrets?: boolean): { type: ProviderType; config: ProviderConfig } {
    let config: ProviderConfig;
    if (includeSecrets && this.currentProvider && 'getFullConfig' in this.currentProvider) {
      // 返回完整配置（包含 API Key）
      config = (this.currentProvider as any).getFullConfig();
    } else {
      // 返回脱敏配置
      config = this.currentProvider?.getConfig() || this.config.currentConfig;
    }
    return {
      type: this.config.currentProvider,
      config,
    };
  }

  /**
   * 获取所有配置
   */
  getFullConfig(): ProvidersConfigFile {
    return { ...this.config };
  }

  /**
   * 获取 API 预设列表
   */
  getAPIPresets() {
    return API_PRESETS;
  }

  /**
   * 保存 Provider 配置
   */
  saveProviderConfig(saved: SavedProvider): void {
    const existing = this.config.savedProviders.findIndex(p => p.id === saved.id);
    if (existing >= 0) {
      this.config.savedProviders[existing] = saved;
    } else {
      this.config.savedProviders.push(saved);
    }
    this.saveConfig();
  }

  /**
   * 删除保存的 Provider 配置
   */
  deleteSavedProvider(id: string): boolean {
    const index = this.config.savedProviders.findIndex(p => p.id === id);
    if (index >= 0) {
      this.config.savedProviders.splice(index, 1);
      this.saveConfig();
      return true;
    }
    return false;
  }

  /**
   * 获取保存的 Provider 列表
   */
  getSavedProviders(): SavedProvider[] {
    return [...this.config.savedProviders];
  }

  /**
   * 注册切换回调
   */
  onSwitch(callback: ProviderSwitchCallback): void {
    this.switchCallbacks.push(callback);
  }

  /**
   * 取消注册切换回调
   */
  offSwitch(callback: ProviderSwitchCallback): void {
    const index = this.switchCallbacks.indexOf(callback);
    if (index >= 0) {
      this.switchCallbacks.splice(index, 1);
    }
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    for (const provider of this.providerCache.values()) {
      if (provider.dispose) {
        try {
          await provider.dispose();
        } catch (error) {
          logger.error(`[ProviderManager] 释放 Provider 失败:`, error);
        }
      }
    }
    this.providerCache.clear();
    this.currentProvider = null;
    logger.info(`[ProviderManager] 资源已释放`);
  }
}

// 全局实例
let globalProviderManager: ProviderManager | null = null;

/**
 * 获取 Provider Manager 实例
 */
export function getProviderManager(): ProviderManager {
  if (!globalProviderManager) {
    globalProviderManager = new ProviderManager();
  }
  return globalProviderManager;
}