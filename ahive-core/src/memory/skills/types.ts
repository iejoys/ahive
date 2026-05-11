/**
 * Skills 系统类型定义
 * 基于 CODEX 的 skills 规范
 */

/**
 * Skill frontmatter（SKILL.md 文件头部）
 */
export interface SkillFrontmatter {
  name?: string;
  version?: string;
  description?: string;
  category?: string;
  model?: 'standard' | 'reasoning' | 'fast';
  dependencies?: string[];
  tools?: string[];
  network?: 'full' | 'none' | 'restricted';
  timeout?: number;
  maxTokens?: number;
}

/**
 * Skill 元数据（_meta.json）
 */
export interface SkillMeta {
  ownerId?: string;
  slug?: string;
  version?: string;
  publishedAt?: number;
  installs?: number;
}

/**
 * Skill 引用（用于依赖声明）
 */
export interface SkillReference {
  id: string;
  name: string;
  description?: string;
  category?: string;
  keywords?: string[];
}

/**
 * Skill 配置（skill.toml 格式）
 */
export interface SkillConfig {
  interface?: {
    display_name?: string;
    icon?: string;
    category?: string;
  };
  dependencies?: {
    tools?: string[];
    skills?: string[];
    packages?: string[];
  };
  policy?: {
    network?: 'full' | 'none' | 'restricted';
    filesystem?: 'full' | 'restricted' | 'readonly';
    timeout?: number;
  };
}

/**
 * 完整的 Skill 定义
 */
export interface Skill {
  id: string;                    // skill 目录名（唯一标识）
  slug: string;                  // 发布时的 slug
  name: string;                  // 显示名称
  description: string;           // 描述
  version: string;               // 版本号
  category: string;              // 分类
  model: 'standard' | 'reasoning' | 'fast';
  
  // 内容
  content: string;               // SKILL.md 的完整内容
  instructions: string;          // 提取的指令部分
  
  // 配置
  dependencies: {
    tools: string[];
    skills: string[];
  };
  
  // 策略
  policy: {
    network: 'full' | 'none' | 'restricted';
    filesystem: 'full' | 'restricted' | 'readonly';
    timeout: number;
  };
  
  // 元信息
  ownerId?: string;
  publishedAt?: Date;
  installedAt?: Date;
  updatedAt?: Date;
  
  // 统计
  installs?: number;
  usageCount?: number;
  lastUsed?: Date;
}

/**
 * Skill 引用（用于依赖声明）
 */
export interface SkillRef {
  id: string;
  version?: string;
}

/**
 * Skill 加载选项
 */
export interface SkillLoadOptions {
  skillsDir: string;
  validateDependencies?: boolean;
  loadReferences?: boolean;
}

/**
 * Skill 执行上下文
 */
export interface SkillExecutionContext {
  skillId: string;
  workingDir: string;
  variables: Record<string, string | number | boolean>;
  onProgress?: (message: string) => void;
}

/**
 * Skill 解析结果
 */
export interface SkillParseResult {
  success: boolean;
  skill?: Skill;
  errors?: string[];
  warnings?: string[];
}

/**
 * Skill 目录结构
 */
export interface SkillDirectoryStructure {
  root: string;                  // skills/
  skillDirs: string[];           // 各个 skill 目录
  indexFile: string;             // skills_index.json
}

/**
 * Skills 索引
 */
export interface SkillsIndex {
  skills: Array<{
    id: string;
    name: string;
    version: string;
    category: string;
    description: string;
    path: string;
    updatedAt: string;
  }>;
  lastUpdated: string;
  totalCount: number;
}

/**
 * Skill 模板变量
 */
export interface SkillTemplateVars {
  [key: string]: string | number | boolean | undefined;
  cwd?: string;
  project?: string;
  user?: string;
  date?: string;
  time?: string;
}

/**
 * Skill 验证规则
 */
export const SKILL_VALIDATION_RULES = {
  id: {
    pattern: /^[a-z0-9-]+$/,
    minLength: 3,
    maxLength: 100,
  },
  name: {
    minLength: 1,
    maxLength: 100,
  },
  description: {
    maxLength: 500,
  },
  content: {
    maxLength: 100000,  // 100KB
  },
};

/**
 * 默认 Skill 配置
 */
export const DEFAULT_SKILL_CONFIG: Partial<Skill> = {
  version: '1.0.0',
  category: 'general',
  model: 'standard',
  dependencies: {
    tools: [],
    skills: [],
  },
  policy: {
    network: 'full',
    filesystem: 'full',
    timeout: 300000,  // 5 分钟
  },
};