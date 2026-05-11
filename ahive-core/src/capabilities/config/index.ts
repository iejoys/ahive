/**
 * 配置管理能力模块
 * 
 * 指挥官用于管理系统配置
 */

export { ConfigManager, getConfigManager } from './ConfigManager.js';
export { configTools } from './tools.js';
export type {
  ConfigItem,
  ConfigChangeNotification,
} from './ConfigManager.js';