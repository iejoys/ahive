/**
 * Skills 加载器
 * 
 * 从文件系统加载技能定义，支持：
 * - 从 skills/ 目录加载
 * - 解析 SKILL.md frontmatter
 * - 加载 _meta.json 元数据
 */

import fs from 'fs';
import path from 'path';
import type { Skill, SkillMeta } from './types.js';
import { logger } from '../../utils/index.js';

const SKILL_FILE = 'SKILL.md';
const META_FILE = '_meta.json';

/**
 * Frontmatter 解析结果
 */
interface ParsedFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  version?: string;
  model?: 'standard' | 'reasoning' | 'fast';
  dependencies?: string[];
  tools?: string[];
  network?: 'full' | 'none' | 'restricted';
}

/**
 * 解析 SKILL.md 文件的 frontmatter
 */
export function parseSkillFrontmatter(content: string): { frontmatter: ParsedFrontmatter; body: string } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    return {
      frontmatter: {},
      body: content.trim()
    };
  }
  
  const frontmatterText = match[1];
  const body = match[2].trim();
  const frontmatter: ParsedFrontmatter = {};
  
  // 解析 YAML 格式的 frontmatter
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value: string | string[] = line.slice(colonIndex + 1).trim();
      
      // 处理数组格式
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, ''));
      }
      
      // 移除引号
      if (typeof value === 'string' && (value.startsWith('"') || value.startsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      (frontmatter as Record<string, unknown>)[key] = value;
    }
  }
  
  return { frontmatter, body };
}

/**
 * 加载单个技能
 */
export function loadSkill(skillDir: string): Skill | null {
  const skillPath = path.join(skillDir, SKILL_FILE);
  const metaPath = path.join(skillDir, META_FILE);
  
  if (!fs.existsSync(skillPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    const { frontmatter, body } = parseSkillFrontmatter(content);
    
    // 加载元数据
    let installs = 0;
    let publishedAt: Date | undefined;
    if (fs.existsSync(metaPath)) {
      try {
        const metaContent = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        installs = meta.installs || 0;
        publishedAt = meta.publishedAt ? new Date(meta.publishedAt) : undefined;
      } catch {
        // 忽略解析错误
      }
    }
    
    const skillName = path.basename(skillDir);
    
    // 构建 dependencies 对象
    const dependencies = {
      tools: frontmatter.tools || [],
      skills: frontmatter.dependencies || [],
    };
    
    // 构建 policy 对象
    const policy = {
      network: frontmatter.network || 'full' as const,
      filesystem: 'full' as const,
      timeout: 300000,
    };
    
    return {
      id: skillName,
      slug: skillName,
      name: frontmatter.name || skillName,
      description: frontmatter.description || '',
      category: frontmatter.category || 'general',
      version: frontmatter.version || '1.0.0',
      model: frontmatter.model || 'standard',
      content: body,
      instructions: body,
      dependencies,
      policy,
      publishedAt,
      installs,
    };
  } catch (error) {
    logger.warn(`[Skills] 加载技能失败: ${skillDir}`, error);
    return null;
  }
}

/**
 * 加载所有技能
 */
export function loadAllSkills(skillsDir: string): Skill[] {
  if (!fs.existsSync(skillsDir)) {
    logger.info(`[Skills] 技能目录不存在: ${skillsDir}`);
    return [];
  }
  
  const skills: Skill[] = [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skill = loadSkill(path.join(skillsDir, entry.name));
      if (skill) {
        skills.push(skill);
      }
    }
  }
  
  logger.info(`[Skills] 加载了 ${skills.length} 个技能`);
  return skills;
}

/**
 * 保存技能
 */
export function saveSkill(skill: Skill, skillsDir: string): boolean {
  const skillDir = path.join(skillsDir, skill.id);
  
  try {
    // 创建目录
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }
    
    // 生成 SKILL.md 内容
    const frontmatterLines: string[] = ['---'];
    frontmatterLines.push(`name: ${skill.name}`);
    frontmatterLines.push(`description: ${skill.description}`);
    if (skill.category) frontmatterLines.push(`category: ${skill.category}`);
    if (skill.version) frontmatterLines.push(`version: ${skill.version}`);
    if (skill.model) frontmatterLines.push(`model: ${skill.model}`);
    if (skill.dependencies.skills.length > 0) {
      frontmatterLines.push(`dependencies: [${skill.dependencies.skills.map(d => `'${d}'`).join(', ')}]`);
    }
    if (skill.dependencies.tools.length > 0) {
      frontmatterLines.push(`tools: [${skill.dependencies.tools.map(d => `'${d}'`).join(', ')}]`);
    }
    frontmatterLines.push('---');
    frontmatterLines.push('');
    
    const skillContent = frontmatterLines.join('\n') + skill.content;
    
    // 写入 SKILL.md
    fs.writeFileSync(path.join(skillDir, SKILL_FILE), skillContent, 'utf-8');
    
    // 写入 _meta.json
    const meta: SkillMeta = {
      slug: skill.id,
      version: skill.version,
      installs: skill.installs || 0,
    };
    fs.writeFileSync(path.join(skillDir, META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
    
    logger.info(`[Skills] 保存技能成功: ${skill.id}`);
    return true;
  } catch (error) {
    logger.error(`[Skills] 保存技能失败: ${skill.id}`, error);
    return false;
  }
}

/**
 * 删除技能
 */
export function deleteSkill(skillId: string, skillsDir: string): boolean {
  const skillDir = path.join(skillsDir, skillId);
  
  if (!fs.existsSync(skillDir)) {
    return false;
  }
  
  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
    logger.info(`[Skills] 删除技能成功: ${skillId}`);
    return true;
  } catch (error) {
    logger.error(`[Skills] 删除技能失败: ${skillId}`, error);
    return false;
  }
}

/**
 * 生成技能的 prompt
 */
export function generateSkillPrompt(skill: Skill): string {
  const lines: string[] = [];
  
  lines.push(`## Skill: ${skill.name}`);
  lines.push('');
  
  if (skill.description) {
    lines.push(`**描述**: ${skill.description}`);
    lines.push('');
  }
  
  if (skill.category) {
    lines.push(`**分类**: ${skill.category}`);
    lines.push('');
  }
  
  lines.push('---');
  lines.push('');
  lines.push(skill.content);
  
  return lines.join('\n');
}

/**
 * 生成所有技能的 prompt
 */
export function generateAllSkillsPrompt(skills: Skill[], maxSkills: number = 10): string {
  if (skills.length === 0) {
    return '';
  }
  
  const lines: string[] = ['# 可用技能', ''];
  
  // 按安装次数排序，取前 N 个
  const sortedSkills = [...skills]
    .sort((a, b) => (b.installs || 0) - (a.installs || 0))
    .slice(0, maxSkills);
  
  for (const skill of sortedSkills) {
    lines.push(generateSkillPrompt(skill));
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  
  return lines.join('\n');
}

export {
  SKILL_FILE,
  META_FILE,
};