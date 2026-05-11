/**
 * 配置管理器
 * 指挥官用于管理系统配置
 */

import { logger } from '../../utils/index.js';
import { getWSClient } from '../../monitoring/ws-client.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * 配置项定义
 */
export interface ConfigItem {
  key: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  category: string;
  editable: boolean;
}

/**
 * 配置变更通知
 */
export interface ConfigChangeNotification {
  type: 'config-change';
  key: string;
  oldValue: any;
  newValue: any;
  category: string;
  timestamp: number;
  source: 'ahivecore';
}

/**
 * 配置管理器类
 */
export class ConfigManager {
  private configPath: string;
  private config: Record<string, any> = {};
  private configItems: Map<string, ConfigItem> = new Map();
  private wsClient: ReturnType<typeof getWSClient>;
  
  constructor(configPath: string = './data/config/ahivecore-config.json') {
    this.configPath = configPath;
    this.wsClient = getWSClient();
    
    // 初始化默认配置项
    this.initDefaultConfigItems();
  }
  
  /**
   * 初始化默认配置项定义
   */
  private initDefaultConfigItems(): void {
    // 系统配置
    this.configItems.set('system.logLevel', {
      key: 'system.logLevel',
      value: 'info',
      type: 'string',
      description: '日志级别 (debug/info/warn/error)',
      category: 'system',
      editable: true,
    });
    
    this.configItems.set('system.maxAgents', {
      key: 'system.maxAgents',
      value: 6,
      type: 'number',
      description: '最大并发智能体数量',
      category: 'system',
      editable: true,
    });
    
    this.configItems.set('system.agentTimeout', {
      key: 'system.agentTimeout',
      value: 60000,
      type: 'number',
      description: '智能体任务超时时间（毫秒）',
      category: 'system',
      editable: true,
    });
    
    // 模型配置
    this.configItems.set('model.defaultProvider', {
      key: 'model.defaultProvider',
      value: 'openai',
      type: 'string',
      description: '默认模型提供商',
      category: 'model',
      editable: true,
    });
    
    this.configItems.set('model.defaultModel', {
      key: 'model.defaultModel',
      value: 'gpt-4o',
      type: 'string',
      description: '默认模型名称',
      category: 'model',
      editable: true,
    });
    
    this.configItems.set('model.temperature', {
      key: 'model.temperature',
      value: 0.7,
      type: 'number',
      description: '模型温度参数',
      category: 'model',
      editable: true,
    });
    
    this.configItems.set('model.maxTokens', {
      key: 'model.maxTokens',
      value: 8192,
      type: 'number',
      description: '最大输出 token 数',
      category: 'model',
      editable: true,
    });
    
    // 工作流配置
    this.configItems.set('workflow.autoSave', {
      key: 'workflow.autoSave',
      value: true,
      type: 'boolean',
      description: '工作流自动保存',
      category: 'workflow',
      editable: true,
    });
    
    this.configItems.set('workflow.refinementLayers', {
      key: 'workflow.refinementLayers',
      value: 4,
      type: 'number',
      description: '工作流精化层数',
      category: 'workflow',
      editable: true,
    });
    
    this.configItems.set('workflow.defaultFolder', {
      key: 'workflow.defaultFolder',
      value: '../ahive-1.0/doc/workflow-samples',
      type: 'string',
      description: '工作流默认存储文件夹',
      category: 'workflow',
      editable: true,
    });
    
    // UI 配置
    this.configItems.set('ui.theme', {
      key: 'ui.theme',
      value: 'dark',
      type: 'string',
      description: '界面主题 (dark/light)',
      category: 'ui',
      editable: true,
    });
    
    this.configItems.set('ui.language', {
      key: 'ui.language',
      value: 'zh-CN',
      type: 'string',
      description: '界面语言',
      category: 'ui',
      editable: true,
    });
    
    this.configItems.set('ui.showAgentWorld', {
      key: 'ui.showAgentWorld',
      value: true,
      type: 'boolean',
      description: '显示 3D 智能体世界',
      category: 'ui',
      editable: true,
    });
  }
  
  /**
   * 加载配置文件
   */
  async load(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      
      const content = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(content);
      
      // 更新配置项的值
      for (const [key, value] of Object.entries(this.config)) {
        const item = this.configItems.get(key);
        if (item) {
          item.value = value;
        }
      }
      
      logger.info('[ConfigManager] 配置已加载:', this.configPath);
    } catch (error) {
      // 配置文件不存在，使用默认值
      logger.info('[ConfigManager] 使用默认配置');
      await this.save();
    }
  }
  
  /**
   * 保存配置文件
   */
  async save(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      await fs.mkdir(dir, { recursive: true });
      
      // 从配置项收集值
      for (const [key, item] of this.configItems) {
        this.config[key] = item.value;
      }
      
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.info('[ConfigManager] 配置已保存:', this.configPath);
    } catch (error) {
      logger.error('[ConfigManager] 保存配置失败:', error);
      throw error;
    }
  }
  
  /**
   * 获取配置值
   */
  get(key: string): any {
    const item = this.configItems.get(key);
    return item?.value;
  }
  
  /**
   * 获取所有配置项
   */
  getAll(): ConfigItem[] {
    return Array.from(this.configItems.values());
  }
  
  /**
   * 获取指定类别的配置项
   */
  getByCategory(category: string): ConfigItem[] {
    return Array.from(this.configItems.values()).filter(item => item.category === category);
  }
  
  /**
   * 设置配置值
   */
  async set(key: string, value: any): Promise<boolean> {
    const item = this.configItems.get(key);
    
    if (!item) {
      logger.warn(`[ConfigManager] 未知的配置项: ${key}`);
      return false;
    }
    
    if (!item.editable) {
      logger.warn(`[ConfigManager] 配置项不可编辑: ${key}`);
      return false;
    }
    
    // 类型检查
    const typeMatch = this.checkType(value, item.type);
    if (!typeMatch) {
      logger.warn(`[ConfigManager] 配置值类型不匹配: ${key} (期望 ${item.type})`);
      return false;
    }
    
    const oldValue = item.value;
    item.value = value;
    this.config[key] = value;
    
    // 保存配置
    await this.save();
    
    // 通知前端
    this.notifyConfigChange(key, oldValue, value, item.category);
    
    logger.info(`[ConfigManager] 配置已更新: ${key} = ${JSON.stringify(value)}`);
    return true;
  }
  
  /**
   * 批量设置配置
   */
  async setMultiple(configs: Record<string, any>): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const [key, value] of Object.entries(configs)) {
      results[key] = await this.set(key, value);
    }
    
    return results;
  }
  
  /**
   * 重置配置为默认值
   */
  async reset(key: string): Promise<boolean> {
    const item = this.configItems.get(key);
    
    if (!item) {
      return false;
    }
    
    // 获取默认值（从 initDefaultConfigItems 中获取）
    const defaultItem = this.getDefaultConfigItem(key);
    if (defaultItem) {
      return await this.set(key, defaultItem.value);
    }
    
    return false;
  }
  
  /**
   * 获取默认配置项
   */
  private getDefaultConfigItem(key: string): ConfigItem | undefined {
    // 重新初始化临时 Map 获取默认值
    const tempItems = new Map<string, ConfigItem>();
    
    // 系统配置
    tempItems.set('system.logLevel', {
      key: 'system.logLevel',
      value: 'info',
      type: 'string',
      category: 'system',
      editable: true,
    });
    tempItems.set('system.maxAgents', {
      key: 'system.maxAgents',
      value: 6,
      type: 'number',
      category: 'system',
      editable: true,
    });
    tempItems.set('model.defaultProvider', {
      key: 'model.defaultProvider',
      value: 'openai',
      type: 'string',
      category: 'model',
      editable: true,
    });
    tempItems.set('model.defaultModel', {
      key: 'model.defaultModel',
      value: 'gpt-4o',
      type: 'string',
      category: 'model',
      editable: true,
    });
    tempItems.set('workflow.refinementLayers', {
      key: 'workflow.refinementLayers',
      value: 4,
      type: 'number',
      category: 'workflow',
      editable: true,
    });
    
    return tempItems.get(key);
  }
  
  /**
   * 类型检查
   */
  private checkType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }
  
  /**
   * 通知前端配置变更
   */
  private notifyConfigChange(key: string, oldValue: any, newValue: any, category: string): void {
    const notification: ConfigChangeNotification = {
      type: 'config-change',
      key,
      oldValue,
      newValue,
      category,
      timestamp: Date.now(),
      source: 'ahivecore',
    };
    
    this.wsClient.send({
      type: 'event',
      payload: {
        type: 'config-change',
        agentId: 'ahivecore',
        timestamp: Date.now(),
        data: notification,
      },
    });
    
    logger.debug(`[ConfigManager] 配置变更通知已发送: ${key}`);
  }
  
  /**
   * 获取配置描述
   */
  getDescription(key: string): string | undefined {
    const item = this.configItems.get(key);
    return item?.description;
  }
  
  /**
   * 检查配置项是否存在
   */
  exists(key: string): boolean {
    return this.configItems.has(key);
  }
  
  /**
   * 检查配置项是否可编辑
   */
  isEditable(key: string): boolean {
    const item = this.configItems.get(key);
    return item?.editable ?? false;
  }
}

// 单例
let configManagerInstance: ConfigManager | null = null;

/**
 * 获取配置管理器实例
 */
export function getConfigManager(configPath?: string): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager(configPath);
  }
  return configManagerInstance;
}

/**
 * 初始化配置管理器
 */
export async function initializeConfigManager(configPath?: string): Promise<ConfigManager> {
  const manager = getConfigManager(configPath);
  await manager.load();
  return manager;
}