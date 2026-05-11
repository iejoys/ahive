/**
 * 指挥官提示词模块
 * 
 * 统一入口，导出：
 * - COMMANDER_SYSTEM_PROMPT: 完整的指挥官提示词
 * - CommanderSkillManager: SKILL 管理器
 * - 所有 SKILL 定义
 */

export { COMMANDER_SYSTEM_PROMPT, COMMANDER_CONFIG } from './commander.js';
export { CommanderSkillManager, getCommanderSkillManager, resetCommanderSkillManager } from './SkillManager.js';
export type { PromptSkill, SkillLoadState } from './types.js';

// 导出所有 SKILL
export {
  SKILL_PAGE_CONTROL,
  SKILL_WORKFLOW,
  SKILL_WORKFLOW_REFINE,
  SKILL_AGENT_ORCHESTRATOR,
  SKILL_CONFIG,
  SKILL_MCP,
} from './skills/index.js';