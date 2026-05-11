/**
 * AHIVE Core - Skills 管理器
 * 
 * 管理技能的加载、解析、缓存和使用
 * 完全兼容 CODEX 的 skills 系统
 */

import fs from 'fs';
import path from 'path';
import type { Skill, SkillMeta } from './types.js';
import { loadSkill, saveSkill, deleteSkill } from './loader.js';
import { logger } from '../../utils/index.js';

export class SkillManager {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private initialized: boolean = false;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * 初始化：加载所有技能
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 确保目录存在
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
      logger.info(`[Skills] 创建技能目录: ${this.skillsDir}`);
      this.initialized = true;
      return;
    }

    // 扫描所有技能目录
    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const skillPath = path.join(this.skillsDir, entry.name);
      try {
        const skill = loadSkill(skillPath);
        if (skill) {
          this.skills.set(skill.id, skill);
          logger.info(`[Skills] 加载技能: ${skill.name} (${skill.id})`);
        }
      } catch (error) {
        logger.warn(`[Skills] 加载技能失败: ${entry.name}`, error);
      }
    }

    this.initialized = true;
    logger.info(`[Skills] 初始化完成，共 ${this.skills.size} 个技能`);
  }

  /**
   * 获取所有技能
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取单个技能
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * 检查技能是否存在
   */
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * 创建新技能
   */
  async create(config: {
    id: string;
    name: string;
    description?: string;
    category?: string;
    content?: string;
  }): Promise<Skill | null> {
    // 检查是否已存在
    if (this.skills.has(config.id)) {
      logger.warn(`[Skills] 技能已存在: ${config.id}`);
      return null;
    }

    const skillPath = path.join(this.skillsDir, config.id);
    
    // 创建目录
    if (!fs.existsSync(skillPath)) {
      fs.mkdirSync(skillPath, { recursive: true });
    }

    // 创建 SKILL.md
    const skillContent = config.content || this.generateDefaultContent(config);
    const skillFile = path.join(skillPath, 'SKILL.md');
    fs.writeFileSync(skillFile, skillContent, 'utf-8');

    // 创建 _meta.json
    const meta: SkillMeta = {
      slug: config.id,
      version: '1.0.0',
      publishedAt: Date.now(),
    };
    const metaFile = path.join(skillPath, '_meta.json');
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8');

    // 加载技能
    const skill = loadSkill(skillPath);
    if (skill) {
      this.skills.set(skill.id, skill);
      logger.info(`[Skills] 创建技能: ${skill.name} (${skill.id})`);
      return skill;
    }

    return null;
  }

  /**
   * 更新技能
   */
  async update(id: string, updates: Partial<Skill>): Promise<Skill | null> {
    const existing = this.skills.get(id);
    if (!existing) {
      logger.warn(`[Skills] 技能不存在: ${id}`);
      return null;
    }

    const skillPath = path.join(this.skillsDir, id);
    const skillFile = path.join(skillPath, 'SKILL.md');

    // 更新 frontmatter
    const updated: Skill = { ...existing, ...updates };
    
    // 重新生成 SKILL.md
    const content = this.serializeSkill(updated);
    fs.writeFileSync(skillFile, content, 'utf-8');

    // 重新加载
    const skill = loadSkill(skillPath);
    if (skill) {
      this.skills.set(id, skill);
      logger.info(`[Skills] 更新技能: ${skill.name} (${id})`);
      return skill;
    }

    return null;
  }

  /**
   * 删除技能
   */
  deleteSkill(id: string): boolean {
    const skill = this.skills.get(id);
    if (!skill) {
      logger.warn(`[Skills] 技能不存在: ${id}`);
      return false;
    }

    const skillPath = path.join(this.skillsDir, id);
    if (fs.existsSync(skillPath)) {
      fs.rmSync(skillPath, { recursive: true });
    }

    this.skills.delete(id);
    logger.info(`[Skills] 删除技能: ${id}`);
    return true;
  }

  /**
   * 根据关键词搜索技能
   */
  search(query: string): Skill[] {
    const queryLower = query.toLowerCase();
    return this.getAll().filter(skill => 
      skill.name.toLowerCase().includes(queryLower) ||
      skill.description.toLowerCase().includes(queryLower) ||
      skill.id.toLowerCase().includes(queryLower)
    );
  }

  /**
   * 根据类别获取技能
   */
  getByCategory(category: string): Skill[] {
    return this.getAll().filter(skill => skill.category === category);
  }

  /**
   * 生成技能元数据摘要（始终注入系统提示词）
   * 仅包含名称、ID、描述，不含全文
   */
  generateSkillsSummary(): string {
    const skills = this.getAll();
    if (skills.length === 0) return '';

    const lines: string[] = [
      '<skills-instructions>',
      '## Skills',
      'A skill is a set of local instructions stored in a SKILL.md file. Use skills when the task matches a skill\'s description.',
      '',
      '### Available skills',
    ];

    for (const skill of skills) {
      lines.push(`- ${skill.id}: ${skill.description} (use $${skill.id} to activate)`);
    }

    lines.push('');
    lines.push('### How to use skills');
    lines.push('- Mention a skill with $SkillName in your message to activate it');
    lines.push('- After activation, the full SKILL.md content will be loaded into context');
    lines.push('</skills-instructions>');

    return lines.join('\n');
  }

  /**
   * 检测用户消息中触发的技能
   * 支持显式 $skill-name 和隐式 description 匹配
   */
  detectTriggeredSkills(userMessage: string): string[] {
    const triggered: string[] = [];
    const lowerMsg = userMessage.toLowerCase();

    for (const skill of this.getAll()) {
      // 显式触发: $skill-name
      if (lowerMsg.includes(`$${skill.id.toLowerCase()}`)) {
        triggered.push(skill.id);
        continue;
      }
      // 隐式触发: description 关键词匹配（仅短描述，避免误触）
      const descWords = skill.description.toLowerCase().split(/[,，\s]+/).filter(w => w.length >= 3);
      const matchCount = descWords.filter(w => lowerMsg.includes(w)).length;
      if (descWords.length > 0 && matchCount >= Math.min(2, descWords.length)) {
        triggered.push(skill.id);
      }
    }

    return triggered;
  }

  /**
   * 生成被触发技能的全文注入（第二级注入）
   */
  generateTriggeredSkillsPrompt(triggeredIds: string[]): string {
    if (triggeredIds.length === 0) return '';

    const lines: string[] = [];

    for (const id of triggeredIds) {
      const skill = this.skills.get(id);
      if (!skill) continue;

      lines.push(`<skill name="${skill.id}">`);
      lines.push(skill.content);
      lines.push('</skill>');
      lines.push('');

      // 记录使用
      skill.usageCount = (skill.usageCount || 0) + 1;
      skill.lastUsed = new Date();
    }

    return lines.join('\n');
  }

  /**
   * 安装技能（从SKILL.md内容创建）
   */
  async install(skillId: string, content: string): Promise<Skill | null> {
    if (this.skills.has(skillId)) {
      logger.warn(`[Skills] 技能已存在: ${skillId}，将更新`);
      return this.update(skillId, { content });
    }
    return this.create({ id: skillId, name: skillId, content });
  }

  /**
   * 卸载技能
   */
  uninstall(skillId: string): boolean {
    return this.deleteSkill(skillId);
  }

  /**
   * 列出所有技能（摘要格式，用于API返回）
   */
  list(): Array<{ id: string; name: string; description: string; category: string; version: string; installed: boolean }> {
    return this.getAll().map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      version: s.version,
      installed: true,
    }));
  }

  /**
   * 生成技能的 prompt 片段
   * 用于将技能注入到 LLM 的 system prompt 中
   */
  generateSkillPrompt(skillIds?: string[]): string {
    const skills = skillIds 
      ? skillIds.map(id => this.skills.get(id)).filter(Boolean) as Skill[]
      : this.getAll();

    if (skills.length === 0) {
      return '';
    }

    const sections: string[] = ['## 可用技能\n'];

    for (const skill of skills) {
      sections.push(`### ${skill.name}`);
      sections.push(`ID: ${skill.id}`);
      sections.push(`类别: ${skill.category}`);
      sections.push(`描述: ${skill.description}`);
      sections.push('');
      sections.push(skill.content);
      sections.push('\n---\n');
    }

    return sections.join('\n');
  }

  /**
   * 生成默认技能内容
   */
  private generateDefaultContent(config: {
    id: string;
    name: string;
    description?: string;
    category?: string;
  }): string {
    return `---
name: ${config.name}
description: ${config.description || '自定义技能'}
category: ${config.category || 'custom'}
---

# ${config.name}

${config.description || '这是一个自定义技能。'}

## 使用场景

描述何时应该使用这个技能。

## 指令

给 AI 的具体指令...

## 示例

提供一些使用示例...
`;
  }

  /**
   * 序列化技能为 SKILL.md 格式
   */
  private serializeSkill(skill: Skill): string {
    const frontmatter = [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `category: ${skill.category}`,
      `version: ${skill.version}`,
      '---'
    ].join('\n');

    return `${frontmatter}\n\n${skill.content}`;
  }
}

/**
 * 创建技能管理器
 */
export function createSkillManager(skillsDir: string): SkillManager {
  return new SkillManager(skillsDir);
}