/**
 * AHIVE Core - Skills 系统
 * 
 * 基于 CODEX 的 skills 设计，实现可复用的技能定义和加载
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/index.js';

/**
 * Skill 元数据（frontmatter）
 */
export interface SkillMeta {
  name: string;
  model?: string;
  category?: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  dependencies?: string[];
  tools?: string[];
}

/**
 * 完整的 Skill 定义
 */
export interface Skill {
  id: string;           // 目录名作为 ID
  path: string;         // skill 目录路径
  meta: SkillMeta;      // 元数据
  content: string;      // SKILL.md 的完整内容（不含 frontmatter）
  references?: Map<string, string>;  // 参考文档
  templates?: Map<string, string>;   // 模板文件
}

/**
 * Skills 加载器
 */
export class SkillsLoader {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private loaded: boolean = false;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * 加载所有 skills
   */
  async loadAll(): Promise<Map<string, Skill>> {
    if (this.loaded) {
      return this.skills;
    }

    if (!fs.existsSync(this.skillsDir)) {
      logger.info(`[Skills] Skills 目录不存在: ${this.skillsDir}`);
      fs.mkdirSync(this.skillsDir, { recursive: true });
      this.loaded = true;
      return this.skills;
    }

    const dirs = fs.readdirSync(this.skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const dir of dirs) {
      try {
        const skill = await this.loadSkill(dir);
        if (skill) {
          this.skills.set(skill.id, skill);
          logger.info(`[Skills] ✅ 加载技能: ${skill.id} - ${skill.meta.description.slice(0, 50)}...`);
        }
      } catch (error) {
        logger.warn(`[Skills] 加载技能失败: ${dir}`, error);
      }
    }

    this.loaded = true;
    logger.info(`[Skills] 共加载 ${this.skills.size} 个技能`);
    return this.skills;
  }

  /**
   * 加载单个 skill
   */
  private async loadSkill(id: string): Promise<Skill | null> {
    const skillDir = path.join(this.skillsDir, id);
    const skillFile = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillFile)) {
      // 尝试其他命名
      const altFile = path.join(skillDir, `${id}.md`);
      if (!fs.existsSync(altFile)) {
        return null;
      }
    }

    const skillPath = fs.existsSync(skillFile) ? skillFile : path.join(skillDir, `${id}.md`);
    const content = fs.readFileSync(skillPath, 'utf-8');

    // 解析 frontmatter
    const { meta, body } = this.parseFrontmatter(content, id);

    // 加载参考文档
    const references = await this.loadReferences(skillDir);

    // 加载模板
    const templates = await this.loadTemplates(skillDir);

    return {
      id,
      path: skillDir,
      meta,
      content: body,
      references,
      templates,
    };
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(content: string, defaultId: string): { meta: SkillMeta; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      // 没有 frontmatter，使用默认值
      return {
        meta: {
          name: defaultId,
          description: `Skill: ${defaultId}`,
        },
        body: content.trim(),
      };
    }

    const frontmatter = match[1];
    const body = match[2].trim();

    // 解析 YAML 格式的 frontmatter
    const meta: SkillMeta = {
      name: defaultId,
      description: '',
    };

    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();

      switch (key) {
        case 'name':
          meta.name = value;
          break;
        case 'model':
          meta.model = value;
          break;
        case 'category':
          meta.category = value;
          break;
        case 'description':
          meta.description = value;
          break;
        case 'version':
          meta.version = value;
          break;
        case 'author':
          meta.author = value;
          break;
        case 'tags':
          meta.tags = value.split(',').map(t => t.trim());
          break;
        case 'dependencies':
          meta.dependencies = value.split(',').map(t => t.trim());
          break;
        case 'tools':
          meta.tools = value.split(',').map(t => t.trim());
          break;
      }
    }

    return { meta, body };
  }

  /**
   * 加载参考文档
   */
  private async loadReferences(skillDir: string): Promise<Map<string, string>> {
    const references = new Map<string, string>();
    const refDir = path.join(skillDir, 'references');

    if (!fs.existsSync(refDir)) {
      return references;
    }

    const files = fs.readdirSync(refDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(refDir, file), 'utf-8');
      references.set(file.replace('.md', ''), content);
    }

    return references;
  }

  /**
   * 加载模板
   */
  private async loadTemplates(skillDir: string): Promise<Map<string, string>> {
    const templates = new Map<string, string>();
    const templateDir = path.join(skillDir, 'templates');

    if (!fs.existsSync(templateDir)) {
      return templates;
    }

    const loadDir = (dir: string, prefix: string = '') => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          loadDir(path.join(dir, item.name), `${prefix}${item.name}/`);
        } else if (item.name.endsWith('.md')) {
          const content = fs.readFileSync(path.join(dir, item.name), 'utf-8');
          templates.set(`${prefix}${item.name}`, content);
        }
      }
    };

    loadDir(templateDir);
    return templates;
  }

  /**
   * 获取所有 skills
   */
  getAll(): Map<string, Skill> {
    return this.skills;
  }

  /**
   * 获取单个 skill
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * 按类别获取 skills
   */
  getByCategory(category: string): Skill[] {
    return Array.from(this.skills.values())
      .filter(s => s.meta.category === category);
  }

  /**
   * 搜索 skills
   */
  search(query: string): Skill[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.skills.values())
      .filter(s => 
        s.id.toLowerCase().includes(queryLower) ||
        s.meta.name.toLowerCase().includes(queryLower) ||
        s.meta.description.toLowerCase().includes(queryLower) ||
        s.meta.tags?.some(t => t.toLowerCase().includes(queryLower))
      );
  }

  /**
   * 生成 skills 的 system prompt 片段
   */
  generateSkillsPrompt(skillIds?: string[]): string {
    const skillsToUse = skillIds
      ? skillIds.map(id => this.skills.get(id)).filter(Boolean) as Skill[]
      : Array.from(this.skills.values());

    if (skillsToUse.length === 0) {
      return '';
    }

    const sections: string[] = ['## 可用技能\n'];

    for (const skill of skillsToUse) {
      sections.push(`### ${skill.meta.name}`);
      sections.push(`${skill.meta.description}\n`);
      
      // 添加核心内容（截断到合理长度）
      const contentPreview = skill.content.slice(0, 2000);
      sections.push(contentPreview);
      if (skill.content.length > 2000) {
        sections.push('\n... (内容已截断)');
      }
      sections.push('');
    }

    return sections.join('\n');
  }
}

/**
 * 创建 Skills 加载器
 */
export function createSkillsLoader(skillsDir: string): SkillsLoader {
  return new SkillsLoader(skillsDir);
}