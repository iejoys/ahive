/**
 * 提示词模块导出
 */

// 指挥官提示词系统
export { CommanderSkillManager, getCommanderSkillManager } from './commander/SkillManager.js';
export type { PromptSkill } from './commander/types.js';
export { COMMANDER_SYSTEM_PROMPT } from './commander/commander.js';

// 导出所有 SKILL
export * from './commander/skills/index.js';