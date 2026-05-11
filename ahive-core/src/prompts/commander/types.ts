/**
 * 指挥官提示词类型定义
 */

/**
 * 提示词 SKILL 定义
 */
export interface PromptSkill {
  /** SKILL 名称 */
  name: string;
  /** 触发关键词 */
  trigger: string[];
  /** 提示词内容 */
  prompt: string;
  /** 关联的工具名称（可选） */
  tools?: string[];
  /** SKILL 描述 */
  description?: string;
  /** 优先级（可选，数值越大优先级越高） */
  priority?: number;
}

/**
 * SKILL 加载状态
 */
export interface SkillLoadState {
  /** 已加载的 SKILL 名称列表 */
  loadedSkills: string[];
  /** 总 Token 估算 */
  estimatedTokens: number;
  /** 加载时间 */
  loadTime: number;
}

/**
 * SKILL 加载历史记录
 */
export interface SkillLoadHistory {
  /** SKILL 名称 */
  skill: string;
  /** 加载原因 */
  reason: string;
  /** 加载时间 */
  time: number;
}