/**
 * 能力模块导出
 */

// 页面控制
export * from './page-control/index.js';

// 工作流编排
export * from './workflow/index.js';

// 配置管理
export * from './config/index.js';

// 智能体统筹
export * from './agent-orchestrator/index.js';

// 统一能力管理器（新增）
export { CapabilityManager, createCapabilityManager } from './CapabilityManager.js';

// MCP 能力管理（原有）
export { CapabilitySkillManager, createCapabilitySkillManager } from './skill-manager.js';
export { MCPManager, createMCPManager } from './mcp-manager.js';
export { MCPWSPool } from './mcp-ws-pool.js';
export type { SkillConfig, MCPServer, MCPTool, CapabilityUpdatePayload, CapabilitiesSummary } from './types.js';

// 兼容旧代码的别名（使用默认路径）
import { CapabilityManager } from './CapabilityManager.js';

const DEFAULT_SKILLS_PATH = './data/capabilities/skills.json';
const DEFAULT_MCP_PATH = './data/capabilities/mcp-servers.json';

let _capabilityManagerInstance: CapabilityManager | null = null;

/**
 * 获取能力管理器实例（单例，使用默认路径）
 */
export function getCapabilityManager(): CapabilityManager {
  if (!_capabilityManagerInstance) {
    _capabilityManagerInstance = new CapabilityManager('./data/capabilities');
  }
  return _capabilityManagerInstance;
}

/**
 * 兼容旧代码的别名
 */
export const getCapabilitySkillManager = getCapabilityManager;