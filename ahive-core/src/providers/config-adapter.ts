/**
 * 配置适配器
 * 
 * 统一处理 agents.json 和 providers.json 之间的参数名差异
 * 
 * ## 问题背景
 * 
 * agents.json 的 AgentModelConfig 使用：
 * - provider: 提供者类型
 * - name: 模型名称
 * - baseUrl: API 地址
 * 
 * providers.json 的 ProviderConfig 使用：
 * - type: 提供者类型
 * - modelName / apiModel / ollamaModel: 模型名称
 * - apiEndpoint / baseUrl: API 地址
 * 
 * 这个适配器负责在两种格式之间转换
 */

import type { ProviderConfig, ProviderType } from './index.js';
import { logger } from '../utils/index.js';

/**
 * 智能体模型配置（来自 agents.json）
 */
export interface AgentModelConfig {
  provider?: string;
  name?: string;
  apiKey?: string;
  baseUrl?: string;
  ollamaHost?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;  // 请求超时（毫秒），修复：支持从 agentConfig 传递
}

/**
 * 将 AgentModelConfig 转换为 ProviderConfig
 * 
 * @param agentConfig 来自 agents.json 的配置
 * @param fallbackConfig 可选的回退配置（来自 providers.json）
 */
export function agentConfigToProviderConfig(
  agentConfig: AgentModelConfig,
  fallbackConfig?: Partial<ProviderConfig>
): ProviderConfig {
  // 确定 provider 类型
  const providerType = normalizeProviderType(agentConfig.provider || fallbackConfig?.type || 'local');
  
  // 构建基础配置
  const config: ProviderConfig = {
    type: providerType,
    
    // 模型名称：优先使用 agentConfig.name
    modelName: agentConfig.name || fallbackConfig?.modelName || fallbackConfig?.apiModel,
    apiModel: agentConfig.name || fallbackConfig?.apiModel || fallbackConfig?.modelName,
    
    // API 地址：agentConfig.baseUrl -> ProviderConfig.apiEndpoint
    apiEndpoint: agentConfig.baseUrl || fallbackConfig?.apiEndpoint,
    baseUrl: agentConfig.baseUrl || fallbackConfig?.baseUrl,
    
    // API Key
    apiKey: agentConfig.apiKey || fallbackConfig?.apiKey,
    
    // Ollama 配置
    ollamaHost: agentConfig.ollamaHost || fallbackConfig?.ollamaHost,
    ollamaModel: providerType === 'ollama' ? (agentConfig.name || fallbackConfig?.ollamaModel) : undefined,
    
    // 通用配置
    temperature: agentConfig.temperature ?? fallbackConfig?.temperature,
    maxTokens: agentConfig.maxTokens ?? fallbackConfig?.maxTokens,
    
    // 其他配置从 fallback 继承
    modelPath: fallbackConfig?.modelPath,
    gpuLayers: fallbackConfig?.gpuLayers,
    threads: fallbackConfig?.threads,
    contextSize: fallbackConfig?.contextSize,
    sequences: fallbackConfig?.sequences,
    // 修复：timeout 优先使用 agentConfig，其次 fallbackConfig
    timeout: agentConfig.timeout ?? fallbackConfig?.timeout,
    presetId: fallbackConfig?.presetId,
  };
  
  // 清理 undefined 值
  return cleanUndefined(config);
}

/**
 * 将 ProviderConfig 转换为 AgentModelConfig
 * 
 * @param providerConfig 来自 providers.json 的配置
 */
export function providerConfigToAgentConfig(
  providerConfig: ProviderConfig
): AgentModelConfig {
  return {
    provider: providerConfig.type,
    name: providerConfig.modelName || providerConfig.apiModel || providerConfig.ollamaModel,
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.apiEndpoint || providerConfig.baseUrl,
    ollamaHost: providerConfig.ollamaHost,
    temperature: providerConfig.temperature,
    maxTokens: providerConfig.maxTokens,
  };
}

/**
 * 标准化 Provider 类型名称
 * 
 * 统一处理各种命名方式：
 * - 'bailian' -> 'openai' (使用 OpenAI 兼容 API)
 * - 'deepseek' -> 'openai'
 * - 'qwen' -> 'openai'
 * - 'anthropic' -> 'openai' (暂用兼容模式)
 * - 'custom' -> 'openai'
 */
export function normalizeProviderType(type: string): ProviderType {
  const normalized = type.toLowerCase();
  
  // 直接支持的类型
  if (normalized === 'local' || normalized === 'ollama' || normalized === 'openai') {
    return normalized;
  }
  
  // 使用 OpenAI 兼容 API 的类型
  const openaiCompatible = [
    'bailian', 'deepseek', 'qwen', 'zhipu', 'moonshot', 
    'anthropic', 'custom', 'glm', 'kimi'
  ];
  
  if (openaiCompatible.includes(normalized)) {
    logger.debug(`[ConfigAdapter] Provider 类型 "${type}" 映射为 "openai" (兼容模式)`);
    return 'openai';
  }
  
  // 默认使用 openai
  logger.warn(`[ConfigAdapter] 未知的 Provider 类型 "${type}"，使用 "openai" 作为默认`);
  return 'openai';
}

/**
 * 获取模型名称（统一从各种字段中提取）
 */
export function getModelName(config: Partial<ProviderConfig>): string {
  return config.modelName || config.apiModel || config.ollamaModel || 'unknown';
}

/**
 * 获取 API 端点（统一从各种字段中提取）
 */
export function getApiEndpoint(config: Partial<ProviderConfig>): string | undefined {
  return config.apiEndpoint || config.baseUrl;
}

/**
 * 合并配置（agentConfig 覆盖 fallbackConfig）
 */
export function mergeConfigs(
  agentConfig: Partial<AgentModelConfig>,
  fallbackConfig: Partial<ProviderConfig>
): ProviderConfig {
  return agentConfigToProviderConfig(agentConfig, fallbackConfig);
}

/**
 * 清理对象中的 undefined 值
 */
function cleanUndefined<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * 验证配置是否有效
 */
export function validateConfig(config: Partial<ProviderConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // 检查必要字段
  if (!config.type) {
    errors.push('缺少 provider 类型');
  }
  
  // 根据类型检查必要字段
  switch (config.type) {
    case 'local':
      if (!config.modelName && !config.modelPath) {
        errors.push('本地模型需要指定 modelName 或 modelPath');
      }
      break;
      
    case 'ollama':
      if (!config.ollamaModel && !config.modelName) {
        errors.push('Ollama 需要指定模型名称');
      }
      break;
      
    case 'openai':
      if (!config.apiKey) {
        errors.push('OpenAI 兼容 API 需要 apiKey');
      }
      if (!config.apiEndpoint && !config.baseUrl) {
        errors.push('OpenAI 兼容 API 需要 apiEndpoint 或 baseUrl');
      }
      break;
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 创建配置摘要（用于日志）
 */
export function createConfigSummary(config: Partial<ProviderConfig>): string {
  const parts: string[] = [];
  
  parts.push(`type=${config.type || 'unknown'}`);
  
  const model = getModelName(config);
  if (model !== 'unknown') {
    parts.push(`model=${model}`);
  }
  
  const endpoint = getApiEndpoint(config);
  if (endpoint) {
    parts.push(`endpoint=${endpoint}`);
  }
  
  if (config.temperature !== undefined) {
    parts.push(`temp=${config.temperature}`);
  }
  
  if (config.maxTokens !== undefined) {
    parts.push(`tokens=${config.maxTokens}`);
  }
  
  return parts.join(', ');
}