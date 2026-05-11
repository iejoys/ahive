/**
 * 项目配置模板加载服务
 * 
 * 功能：
 * 1. 从配置文件加载模板列表
 * 2. 支持模板继承（extends）
 * 3. 提供IPC接口供前端调用
 */

import * as fs from 'fs';
import * as path from 'path';

// ========== 类型定义 ==========

export interface ProjectConfigTemplateGroup {
  id: string;
  name: string;
  nameEn?: string;
  icon?: string;
  color?: string;
  collapsed?: boolean;
}

export interface ProjectConfigTemplateVariable {
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'array' | 'object' | 'file' | 'directory';
  group?: string;
  description?: string;
  descriptionEn?: string;
  required?: boolean;
  sensitive?: boolean;
  enabled?: boolean;
}

export interface ProjectConfigTemplate {
  id: string;
  name: string;
  nameEn?: string;
  description?: string;
  descriptionEn?: string;
  category?: string;
  icon?: string;
  /** 继承自哪个模板 */
  extends?: string;
  groups: ProjectConfigTemplateGroup[];
  variables: ProjectConfigTemplateVariable[];
}

export interface ProjectConfigTemplatesFile {
  $schema?: string;
  templates: ProjectConfigTemplate[];
}

// ========== ProjectConfigTemplateService 类 ==========

export class ProjectConfigTemplateService {
  private templatesDir: string;
  private templates: Map<string, ProjectConfigTemplate> = new Map();
  private loaded: boolean = false;

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir;
  }

  /**
   * 加载所有模板
   */
  async loadTemplates(): Promise<ProjectConfigTemplate[]> {
    if (this.loaded) {
      console.log(`[ProjectConfigTemplateService] 返回缓存的 ${this.templates.size} 个模板`);
      return Array.from(this.templates.values());
    }

    try {
      console.log('[ProjectConfigTemplateService] 开始加载模板, 目录:', this.templatesDir);
      
      // 确保目录存在
      if (!fs.existsSync(this.templatesDir)) {
        fs.mkdirSync(this.templatesDir, { recursive: true });
        console.log('[ProjectConfigTemplateService] 创建模板目录:', this.templatesDir);
      }

      // 读取模板文件
      const templatesFile = path.join(this.templatesDir, 'templates.json');
      console.log('[ProjectConfigTemplateService] 模板文件路径:', templatesFile);
      
      if (!fs.existsSync(templatesFile)) {
        console.log('[ProjectConfigTemplateService] 模板文件不存在，使用空模板');
        this.loaded = true;
        return [];
      }

      const content = fs.readFileSync(templatesFile, 'utf-8');
      const data: ProjectConfigTemplatesFile = JSON.parse(content);
      console.log(`[ProjectConfigTemplateService] JSON文件中有 ${data.templates.length} 个模板`);

      // 处理模板继承
      for (const template of data.templates) {
        const resolvedTemplate = this.resolveTemplate(template, data.templates);
        this.templates.set(resolvedTemplate.id, resolvedTemplate);
      }

      this.loaded = true;
      console.log(`[ProjectConfigTemplateService] 加载了 ${this.templates.size} 个模板`);
      
      return Array.from(this.templates.values());
    } catch (error) {
      console.error('[ProjectConfigTemplateService] 加载模板失败:', error);
      this.loaded = true;
      return [];
    }
  }

  /**
   * 解析模板继承
   */
  private resolveTemplate(
    template: ProjectConfigTemplate,
    allTemplates: ProjectConfigTemplate[]
  ): ProjectConfigTemplate {
    if (!template.extends) {
      return template;
    }

    // 找到父模板
    const parentTemplate = allTemplates.find(t => t.id === template.extends);
    if (!parentTemplate) {
      console.warn(`[ProjectConfigTemplateService] 模板 ${template.id} 的父模板 ${template.extends} 不存在`);
      return template;
    }

    // 递归解析父模板
    const resolvedParent = this.resolveTemplate(parentTemplate, allTemplates);

    // 合并分组
    const mergedGroups = this.mergeGroups(resolvedParent.groups, template.groups);

    // 合并变量
    const mergedVariables = this.mergeVariables(resolvedParent.variables, template.variables);

    return {
      ...resolvedParent,
      ...template,
      groups: mergedGroups,
      variables: mergedVariables,
    };
  }

  /**
   * 合并分组
   */
  private mergeGroups(
    parentGroups: ProjectConfigTemplateGroup[],
    childGroups: ProjectConfigTemplateGroup[]
  ): ProjectConfigTemplateGroup[] {
    const groupMap = new Map<string, ProjectConfigTemplateGroup>();

    // 先添加父分组
    for (const group of parentGroups) {
      groupMap.set(group.id, group);
    }

    // 子分组覆盖或添加
    for (const group of childGroups) {
      groupMap.set(group.id, group);
    }

    return Array.from(groupMap.values());
  }

  /**
   * 合并变量
   */
  private mergeVariables(
    parentVariables: ProjectConfigTemplateVariable[],
    childVariables: ProjectConfigTemplateVariable[]
  ): ProjectConfigTemplateVariable[] {
    const varMap = new Map<string, ProjectConfigTemplateVariable>();

    // 先添加父变量
    for (const v of parentVariables) {
      varMap.set(v.name, { ...v, enabled: true });
    }

    // 子变量覆盖或添加
    for (const v of childVariables) {
      if (varMap.has(v.name)) {
        // 合并同名变量
        varMap.set(v.name, { ...varMap.get(v.name)!, ...v, enabled: true });
      } else {
        varMap.set(v.name, { ...v, enabled: true });
      }
    }

    return Array.from(varMap.values());
  }

  /**
   * 获取所有模板
   */
  getTemplates(): ProjectConfigTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 获取单个模板
   */
  getTemplate(id: string): ProjectConfigTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 获取所有分类
   */
  getCategories(): string[] {
    const categories = new Set<string>();
    for (const template of this.templates.values()) {
      if (template.category) {
        categories.add(template.category);
      }
    }
    return Array.from(categories);
  }

  /**
   * 按分类获取模板
   */
  getTemplatesByCategory(category: string): ProjectConfigTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.category === category);
  }

  /**
   * 重新加载模板
   */
  async reload(): Promise<ProjectConfigTemplate[]> {
    this.loaded = false;
    this.templates.clear();
    return this.loadTemplates();
  }

  /**
   * 获取模板用于前端显示（根据语言选择名称和描述）
   */
  getTemplateForDisplay(id: string, language: 'zh' | 'en' = 'zh'): {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    category?: string;
    groups: Array<{ id: string; name: string; icon?: string; color?: string }>;
    variables: Array<{
      name: string;
      value: string;
      type: string;
      group?: string;
      description?: string;
      required?: boolean;
      enabled?: boolean;
    }>;
  } | undefined {
    const template = this.templates.get(id);
    if (!template) return undefined;

    return {
      id: template.id,
      name: language === 'en' && template.nameEn ? template.nameEn : template.name,
      description: language === 'en' && template.descriptionEn ? template.descriptionEn : template.description,
      icon: template.icon,
      category: template.category,
      groups: template.groups.map(g => ({
        id: g.id,
        name: language === 'en' && g.nameEn ? g.nameEn : g.name,
        icon: g.icon,
        color: g.color,
      })),
      variables: template.variables.map(v => ({
        name: v.name,
        value: v.value,
        type: v.type,
        group: v.group,
        description: language === 'en' && v.descriptionEn ? v.descriptionEn : v.description,
        required: v.required,
        enabled: v.enabled ?? true,
      })),
    };
  }

  /**
   * 获取所有模板用于前端显示
   */
  getAllTemplatesForDisplay(language: 'zh' | 'en' = 'zh'): Array<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    category?: string;
  }> {
    console.log(`[ProjectConfigTemplateService] getAllTemplatesForDisplay: this.templates.size = ${this.templates.size}`);
    console.log(`[ProjectConfigTemplateService] 模板ID列表: ${Array.from(this.templates.keys()).join(', ')}`);
    return Array.from(this.templates.values()).map(t => ({
      id: t.id,
      name: language === 'en' && t.nameEn ? t.nameEn : t.name,
      description: language === 'en' && t.descriptionEn ? t.descriptionEn : t.description,
      icon: t.icon,
      category: t.category,
    }));
  }
}

// ========== 单例 ==========

let projectConfigTemplateServiceInstance: ProjectConfigTemplateService | null = null;

/**
 * 获取 ProjectConfigTemplateService 实例
 */
export function getProjectConfigTemplateService(templatesDir?: string): ProjectConfigTemplateService {
  if (!projectConfigTemplateServiceInstance) {
    const defaultDir = path.join(process.cwd(), 'data', 'project-config-templates');
    projectConfigTemplateServiceInstance = new ProjectConfigTemplateService(templatesDir || defaultDir);
  }
  return projectConfigTemplateServiceInstance;
}

/**
 * 初始化 ProjectConfigTemplateService
 */
export function initializeProjectConfigTemplateService(templatesDir: string): ProjectConfigTemplateService {
  projectConfigTemplateServiceInstance = new ProjectConfigTemplateService(templatesDir);
  return projectConfigTemplateServiceInstance;
}
