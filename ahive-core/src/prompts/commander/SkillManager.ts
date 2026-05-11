/**
 * 指挥官 SKILL 管理器
 * 
 * 负责：
 * 1. 加载基础提示词
 * 2. 根据用户消息自动加载相关 SKILL
 * 3. 构建完整的系统提示词
 */

import { logger } from '../../utils/index.js';
import { COMMANDER_SYSTEM_PROMPT } from './commander.js';
import { 
  SKILL_PAGE_CONTROL, 
  SKILL_WORKFLOW, 
  SKILL_WORKFLOW_REFINE,
  SKILL_AGENT_ORCHESTRATOR, 
  SKILL_CONFIG, 
  SKILL_MCP 
} from './skills/index.js';

// ==================== 类型定义 ====================

/**
 * SKILL 定义
 */
export interface CommanderSkill {
  /** SKILL 名称 */
  name: string;
  /** 触发关键词 */
  trigger: string[];
  /** 提示词内容 */
  prompt: string;
  /** 关联的工具名称 */
  tools?: string[];
  /** 描述 */
  description?: string;
}

/**
 * SKILL 加载状态
 */
export interface SkillLoadState {
  loadedSkills: string[];
  estimatedTokens: number;
  loadTime: number;
}

// ==================== SkillManager 类 ====================

export class CommanderSkillManager {
  private skills: Map<string, CommanderSkill> = new Map();
  private loadedSkills: Set<string> = new Set();
  private basePrompt: string;
  private loadHistory: Array<{ skill: string; reason: string; time: number }> = [];
  
  constructor() {
    this.basePrompt = COMMANDER_SYSTEM_PROMPT;
    
    // 注册内置 SKILL
    this.registerSkill(SKILL_PAGE_CONTROL);
    this.registerSkill(SKILL_WORKFLOW);
    this.registerSkill(SKILL_WORKFLOW_REFINE);
    this.registerSkill(SKILL_AGENT_ORCHESTRATOR);
    this.registerSkill(SKILL_CONFIG);
    this.registerSkill(SKILL_MCP);
    
    logger.info(`[CommanderSkillManager] 已注册 ${this.skills.size} 个 SKILL`);
  }
  
  /**
   * 注册 SKILL
   */
  registerSkill(skill: CommanderSkill): void {
    this.skills.set(skill.name, skill);
    logger.debug(`[CommanderSkillManager] 注册 SKILL: ${skill.name}, 触发词: ${skill.trigger.join(', ')}`);
  }
  
  /**
   * 分析用户消息，确定需要加载的 SKILL
   */
  analyzeRequiredSkills(userMessage: string): string[] {
    const required: string[] = [];
    const lowerMessage = userMessage.toLowerCase();
    
    for (const [name, skill] of this.skills) {
      for (const trigger of skill.trigger) {
        if (lowerMessage.includes(trigger.toLowerCase())) {
          required.push(name);
          this.loadHistory.push({
            skill: name,
            reason: `触发词: ${trigger}`,
            time: Date.now(),
          });
          break;
        }
      }
    }
    
    if (required.length > 0) {
      logger.info(`[CommanderSkillManager] 检测到需要的 SKILL: ${required.join(', ')}`);
    }
    
    return required;
  }
  
  /**
   * 加载 SKILL
   */
  loadSkill(skillName: string): boolean {
    if (this.loadedSkills.has(skillName)) {
      logger.debug(`[CommanderSkillManager] SKILL 已加载: ${skillName}`);
      return true;
    }
    
    const skill = this.skills.get(skillName);
    if (!skill) {
      logger.warn(`[CommanderSkillManager] SKILL 不存在: ${skillName}`);
      return false;
    }
    
    this.loadedSkills.add(skillName);
    logger.info(`[CommanderSkillManager] ✅ 加载 SKILL: ${skillName}`);
    
    return true;
  }
  
  /**
   * 卸载 SKILL
   */
  unloadSkill(skillName: string): boolean {
    if (!this.loadedSkills.has(skillName)) {
      return false;
    }
    
    this.loadedSkills.delete(skillName);
    logger.info(`[CommanderSkillManager] 卸载 SKILL: ${skillName}`);
    
    return true;
  }
  
  /**
   * 清空所有已加载的 SKILL（保留基础上下文）
   * 
   * 注意：此方法只卸载 SKILL 提示词，不会影响 basePrompt（基础上下文）
   */
  clearLoadedSkills(): void {
    const previousCount = this.loadedSkills.size;
    const previousSkills = Array.from(this.loadedSkills);
    
    this.loadedSkills.clear();
    
    logger.info(`[CommanderSkillManager] 清空所有已加载的 SKILL（保留基础上下文）`);
    logger.info(`[CommanderSkillManager] 卸载 SKILL 数量: ${previousCount}, 已卸载: ${previousSkills.join(', ') || '无'}`);
  }
  
  /**
   * 任务完成后自动清理 SKILL
   * 
   * 当检测到任务完成信号时调用，自动卸载所有已加载的 SKILL
   * 保留基础上下文（basePrompt），只清理动态加载的 SKILL 提示词
   * 
   * @param taskCompleteSignals 任务完成信号关键词
   */
  autoCleanupOnTaskComplete(taskCompleteSignals: string[] = ['完成', 'done', 'finished', 'completed', '成功', 'success']): boolean {
    // 记录清理前的状态
    const previousSkills = this.getLoadedSkills();
    
    if (previousSkills.length === 0) {
      logger.debug('[CommanderSkillManager] 没有已加载的 SKILL，无需清理');
      return false;
    }
    
    // 清理 SKILL
    this.clearLoadedSkills();
    
    logger.info(`[CommanderSkillManager] ✅ 任务完成，已自动卸载 SKILL: ${previousSkills.join(', ')}`);
    
    return true;
  }
  
  /**
   * 构建仅包含基础上下文的提示词（不加载任何 SKILL）
   * 
   * 用于需要重置上下文的场景
   */
  buildBaseOnlyPrompt(): string {
    logger.info('[CommanderSkillManager] 构建仅包含基础上下文的提示词');
    return this.basePrompt;
  }
  
  /**
   * 构建完整提示词
   * 
   * @param userMessage 用户消息（用于分析需要加载的 SKILL）
   * @param forceLoadSkills 强制加载的 SKILL 列表
   */
  buildSystemPrompt(userMessage?: string, forceLoadSkills?: string[]): string {
    // 分析需要加载的 SKILL
    if (userMessage) {
      const required = this.analyzeRequiredSkills(userMessage);
      for (const skillName of required) {
        this.loadSkill(skillName);
      }
    }
    
    // 强制加载指定的 SKILL
    if (forceLoadSkills) {
      for (const skillName of forceLoadSkills) {
        this.loadSkill(skillName);
      }
    }
    
    // 组合提示词
    let fullPrompt = this.basePrompt;
    
    // 添加已加载的 SKILL
    for (const skillName of this.loadedSkills) {
      const skill = this.skills.get(skillName);
      if (skill) {
        fullPrompt += '\n\n---\n\n' + skill.prompt;
      }
    }
    
    logger.info(`[CommanderSkillManager] 构建提示词完成，已加载 SKILL: ${this.loadedSkills.size} 个`);
    
    return fullPrompt;
  }
  
  /**
   * 获取已加载的 SKILL 列表
   */
  getLoadedSkills(): string[] {
    return Array.from(this.loadedSkills);
  }
  
  /**
   * 获取所有注册的 SKILL 信息
   */
  getAllSkillsInfo(): Array<{ name: string; trigger: string[]; description?: string; loaded: boolean }> {
    const infos: Array<{ name: string; trigger: string[]; description?: string; loaded: boolean }> = [];
    
    for (const [name, skill] of this.skills) {
      infos.push({
        name,
        trigger: skill.trigger,
        description: skill.description,
        loaded: this.loadedSkills.has(name),
      });
    }
    
    return infos;
  }
  
  /**
   * 获取 SKILL 加载状态
   */
  getLoadState(): SkillLoadState {
    // 估算 Token 数量（粗略估算：每 4 个字符约 1 Token）
    let totalChars = this.basePrompt.length;
    
    for (const skillName of this.loadedSkills) {
      const skill = this.skills.get(skillName);
      if (skill) {
        totalChars += skill.prompt.length;
      }
    }
    
    const estimatedTokens = Math.ceil(totalChars / 4);
    
    return {
      loadedSkills: this.getLoadedSkills(),
      estimatedTokens,
      loadTime: Date.now(),
    };
  }
  
  /**
   * 获取加载历史
   */
  getLoadHistory(): Array<{ skill: string; reason: string; time: number }> {
    return [...this.loadHistory];
  }
  
  /**
   * 预加载指定 SKILL
   */
  preloadSkills(skillNames: string[]): void {
    for (const name of skillNames) {
      this.loadSkill(name);
    }
    logger.info(`[CommanderSkillManager] 预加载 SKILL: ${skillNames.join(', ')}`);
  }
  
  /**
   * 检查 SKILL 是否已注册
   */
  hasSkill(skillName: string): boolean {
    return this.skills.has(skillName);
  }
  
  /**
   * 获取 SKILL 详情
   */
  getSkill(skillName: string): CommanderSkill | undefined {
    return this.skills.get(skillName);
  }
  
  /**
   * 获取基础提示词
   */
  getBasePrompt(): string {
    return this.basePrompt;
  }
}

// ==================== 单例 ====================

let commanderSkillManagerInstance: CommanderSkillManager | null = null;

/**
 * 获取 CommanderSkillManager 实例
 */
export function getCommanderSkillManager(): CommanderSkillManager {
  if (!commanderSkillManagerInstance) {
    commanderSkillManagerInstance = new CommanderSkillManager();
  }
  return commanderSkillManagerInstance;
}

/**
 * 重置 CommanderSkillManager（用于测试）
 */
export function resetCommanderSkillManager(): void {
  if (commanderSkillManagerInstance) {
    commanderSkillManagerInstance.clearLoadedSkills();
  }
  commanderSkillManagerInstance = null;
}