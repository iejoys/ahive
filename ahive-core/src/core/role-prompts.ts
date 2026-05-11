/**
 * 角色提示词管理器
 * 
 * 管理不同角色的系统提示词（仅针对 AHIVE-WORKER 类型智能体）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/index.js';
import { AHIVE_WORKER_TOOLS_PROMPT } from '../agents/ahive-worker/prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 角色配置接口
export interface RoleConfig {
  name: string;
  name_zh: string;
  description: string;
  systemPrompt: string;
}

// 角色提示词配置
export interface RolePromptsConfig {
  version: string;
  description?: string;
  roles: Record<string, RoleConfig>;
  defaultRole: string;
}

/**
 * 角色提示词管理器（仅针对 AHIVE-WORKER 类型）
 */
export class RolePromptManager {
  private config: RolePromptsConfig;
  private configPath: string;
  
  constructor(configPath?: string) {
    this.configPath = configPath || path.join(__dirname, '../../config/role-prompts.json');
    this.config = this.loadConfig();
  }
  
  /**
   * 加载配置文件
   */
  private loadConfig(): RolePromptsConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[RolePromptManager] 加载配置文件失败: ${error}`);
    }
    
    // 返回默认配置
    return this.getDefaultConfig();
  }
  
  /**
   * 获取默认配置
   */
  private getDefaultConfig(): RolePromptsConfig {
    return {
      version: '1.0',
      description: '角色配置仅适用于 AHIVE-WORKER 类型智能体',
      roles: {
        'default': {
          name: 'Default Assistant',
          name_zh: '默认助手',
description: 'Default AHIVE-WORKER assistant',
      systemPrompt: 'You are AHIVE-WORKER, a versatile AI assistant. Keep going until the query is completely resolved.',
        },
      },
      defaultRole: 'default',
    };
  }
  
  /**
   * 获取所有可用角色
   */
  listRoles(): Array<{ id: string; name: string; name_zh: string; description: string }> {
    return Object.entries(this.config.roles).map(([id, role]) => ({
      id,
      name: role.name,
      name_zh: role.name_zh,
      description: role.description,
    }));
  }
  
  /**
   * 获取角色配置
   */
  getRole(roleId: string): RoleConfig | null {
    return this.config.roles[roleId] || null;
  }
  
  /**
   * 获取角色的完整系统提示词（包含工具提示词）
   */
  getSystemPrompt(roleId: string): string {
    const role = this.getRole(roleId);
    
    if (!role) {
      logger.warn(`[RolePromptManager] 角色 ${roleId} 不存在，使用默认角色`);
      const defaultRole = this.config.roles[this.config.defaultRole];
      return `${defaultRole.systemPrompt}\n\n${AHIVE_WORKER_TOOLS_PROMPT}`;
    }
    
    return `${role.systemPrompt}\n\n${AHIVE_WORKER_TOOLS_PROMPT}`;
  }
  
  /**
   * 获取默认角色ID
   */
  getDefaultRole(): string {
    return this.config.defaultRole;
  }
  
  /**
   * 添加或更新角色
   */
  setRole(roleId: string, config: RoleConfig): void {
    this.config.roles[roleId] = config;
    this.saveConfig();
  }
  
  /**
   * 删除角色
   */
  removeRole(roleId: string): boolean {
    if (this.config.roles[roleId]) {
      delete this.config.roles[roleId];
      this.saveConfig();
      return true;
    }
    return false;
  }
  
  /**
   * 保存配置到文件
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.info(`[RolePromptManager] 配置已保存到 ${this.configPath}`);
    } catch (error) {
      logger.error(`[RolePromptManager] 保存配置失败: ${error}`);
    }
  }
  
  /**
   * 重新加载配置
   */
  reload(): void {
    this.config = this.loadConfig();
    logger.info(`[RolePromptManager] 配置已重新加载`);
  }
}

// 单例实例
let instance: RolePromptManager | null = null;

/**
 * 获取角色提示词管理器实例
 */
export function getRolePromptManager(): RolePromptManager {
  if (!instance) {
    instance = new RolePromptManager();
  }
  return instance;
}

// 导出便捷函数
export const listRoles = () => getRolePromptManager().listRoles();
export const getRole = (roleId: string) => getRolePromptManager().getRole(roleId);
export const getSystemPrompt = (roleId: string) => getRolePromptManager().getSystemPrompt(roleId);