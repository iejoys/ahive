/**
 * 技能管理器（能力模块）
 * 
 * 管理动态技能的注册、触发匹配和持久化
 * 
 * @created 2026-03-21
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/index.js';
import type { SkillConfig, SkillsStore } from './types.js';

/**
 * 技能管理器
 */
export class CapabilitySkillManager {
  private skills: Map<string, SkillConfig> = new Map();
  private storePath: string;
  private initialized: boolean = false;

  constructor(storePath: string) {
    this.storePath = storePath;
  }

  /**
   * 初始化：从文件加载
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 确保目录存在
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 加载已有数据
    this.load();
    this.initialized = true;

    logger.info(`[SkillManager] 初始化完成，已加载 ${this.skills.size} 个技能`);
  }

  /**
   * 从文件加载
   */
  load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const content = fs.readFileSync(this.storePath, 'utf-8');
        const store: SkillsStore = JSON.parse(content);

        if (store.skills && Array.isArray(store.skills)) {
          for (const skill of store.skills) {
            this.skills.set(skill.id, skill);
          }
        }

        logger.info(`[SkillManager] 从 ${this.storePath} 加载 ${this.skills.size} 个技能`);
      }
    } catch (error) {
      logger.warn(`[SkillManager] 加载失败: ${error}`);
    }
  }

  /**
   * 保存到文件
   */
  save(): void {
    try {
      const store: SkillsStore = {
        version: '1.0',
        skills: Array.from(this.skills.values()),
      };

      // 确保目录存在
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), { encoding: 'utf-8' });
      logger.debug(`[SkillManager] 已保存 ${this.skills.size} 个技能到 ${this.storePath}`);
    } catch (error) {
      logger.error(`[SkillManager] 保存失败: ${error}`);
    }
  }

  /**
   * 注册技能
   */
  registerSkill(skill: Omit<SkillConfig, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }, agentId?: string): SkillConfig {
    const now = new Date().toISOString();

    const fullSkill: SkillConfig = {
      ...skill,
      agentId: agentId || skill.agentId,
      version: skill.version || '1.0.0',
      createdAt: skill.createdAt || now,
      updatedAt: now,
      enabled: skill.enabled !== false,
    };

    const existing = this.skills.get(skill.id);
    if (existing) {
      fullSkill.createdAt = existing.createdAt;
    }

    this.skills.set(skill.id, fullSkill);
    this.save();

    logger.info(`[SkillManager] 注册技能: ${skill.name} (${skill.id})`);
    return fullSkill;
  }

  /**
   * 更新技能
   */
  updateSkill(skillId: string, updates: Partial<SkillConfig>): SkillConfig | null {
    const existing = this.skills.get(skillId);
    if (!existing) {
      logger.warn(`[SkillManager] 技能不存在: ${skillId}`);
      return null;
    }

    const updated: SkillConfig = {
      ...existing,
      ...updates,
      id: skillId, // 不允许修改 ID
      updatedAt: new Date().toISOString(),
    };

    this.skills.set(skillId, updated);
    this.save();

    logger.info(`[SkillManager] 更新技能: ${skillId}`);
    return updated;
  }

  /**
   * 删除技能
   */
  removeSkill(skillId: string): boolean {
    const removed = this.skills.delete(skillId);
    if (removed) {
      this.save();
      logger.info(`[SkillManager] 删除技能: ${skillId}`);
    }
    return removed;
  }

  /**
   * 启用/禁用技能
   */
  setSkillEnabled(skillId: string, enabled: boolean): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) {
      logger.warn(`[SkillManager] 技能不存在: ${skillId}`);
      return false;
    }

    skill.enabled = enabled;
    skill.updatedAt = new Date().toISOString();
    this.save();

    logger.info(`[SkillManager] ${enabled ? '启用' : '禁用'}技能: ${skillId}`);
    return true;
  }

  /**
   * 根据触发词匹配技能
   */
  matchSkills(input: string, agentId?: string): SkillConfig[] {
    const inputLower = input.toLowerCase();
    const matched: SkillConfig[] = [];

    const scopeSkills = agentId ? this.getAllSkills(agentId) : Array.from(this.skills.values());

    for (const skill of scopeSkills) {
      if (!skill.enabled) continue;

      for (const trigger of skill.triggers) {
        // 支持简单字符串匹配和正则表达式
        if (trigger.startsWith('/') && trigger.endsWith('/')) {
          // 正则表达式
          try {
            const regex = new RegExp(trigger.slice(1, -1), 'i');
            if (regex.test(input)) {
              matched.push(skill);
              break;
            }
          } catch (e) {
            // 正则表达式无效，忽略
          }
        } else {
          // 简单字符串匹配
          if (inputLower.includes(trigger.toLowerCase())) {
            matched.push(skill);
            break;
          }
        }
      }
    }

    return matched;
  }

  /**
   * 获取所有技能
   */
  getAllSkills(agentId?: string): SkillConfig[] {
    const all = Array.from(this.skills.values());
    if (!agentId) return all;
    return all.filter(s => s.agentId === agentId);
  }

  /**
   * 获取所有启用的技能
   */
  getEnabledSkills(agentId?: string): SkillConfig[] {
    return this.getAllSkills(agentId).filter(s => s.enabled);
  }

  /**
   * 获取单个技能
   */
  getSkill(skillId: string): SkillConfig | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 获取技能的系统提示词
   */
  getSkillSystemPrompt(skillId: string): string {
    const skill = this.skills.get(skillId);
    if (!skill || !skill.systemPrompt) {
      return '';
    }
    return skill.systemPrompt;
  }

  /**
   * 检查技能是否存在
   */
  hasSkill(skillId: string): boolean {
    return this.skills.has(skillId);
  }

  /**
   * 获取技能数量
   */
  getSkillCount(agentId?: string): number {
    if (!agentId) return this.skills.size;
    return this.getAllSkills(agentId).length;
  }

  /**
   * 获取启用的技能数量
   */
  getEnabledSkillCount(agentId?: string): number {
    return this.getEnabledSkills(agentId).length;
  }
}

/**
 * 创建技能管理器
 */
export function createCapabilitySkillManager(storePath: string): CapabilitySkillManager {
  return new CapabilitySkillManager(storePath);
}