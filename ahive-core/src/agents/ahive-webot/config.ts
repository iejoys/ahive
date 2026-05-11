/**
 * 企业微信配置管理
 * 
 * 加载和保存企业微信智能体配置
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { WebotConfig } from './types.js';

// 获取当前文件的目录路径 (ES Module 兼容)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置文件路径（相对于项目根目录）
const CONFIG_PATH = path.resolve(__dirname, '../../../config/wecom.json');

/**
 * 加载企业微信配置
 */
export function loadWebotConfig(): WebotConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.warn('[WebotConfig] 配置文件不存在:', CONFIG_PATH);
      return null;
    }

    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);

    return {
      botId: config.botId || '',
      secret: config.secret || '',
      enabled: config.enabled !== false,
      // 支持多个微信号（逗号分隔）
      defaultChatIds: config.defaultChatIds || '',
    };
  } catch (error) {
    console.error('[WebotConfig] 加载配置失败:', error);
    return null;
  }
}

/**
 * 保存企业微信配置
 */
export function saveWebotConfig(config: WebotConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('[WebotConfig] 配置已保存:', CONFIG_PATH);
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}