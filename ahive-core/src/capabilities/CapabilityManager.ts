/**
 * 统一能力管理器
 * 
 * 整合 MCP 管理器和技能管理器，提供统一的能力管理接口
 * 
 * @created 2025-01-09
 */

import { logger } from '../utils/index.js';
import { MCPManager, createMCPManager } from './mcp-manager.js';
import { CapabilitySkillManager, createCapabilitySkillManager } from './skill-manager.js';
import type { MCPServer, MCPTool, SkillConfig, CapabilitiesSummary } from './types.js';

/**
 * 统一能力管理器类
 */
export class CapabilityManager {
  private mcpManager: MCPManager;
  private skillManager: CapabilitySkillManager;
  private initialized: boolean = false;

  constructor(storePath: string = './data/capabilities') {
    this.mcpManager = createMCPManager(`${storePath}/mcp-servers.json`);
    this.skillManager = createCapabilitySkillManager(`${storePath}/skills.json`);
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.mcpManager.initialize();
    await this.skillManager.initialize();
    this.initialized = true;

    logger.info('[CapabilityManager] 初始化完成');
  }

  // ==================== MCP 相关方法 ====================

  /**
   * 获取所有 MCP 服务器
   */
  getMCPServers(agentId?: string): MCPServer[] {
    return this.mcpManager.getAllServers(agentId);
  }

  /**
   * 获取指定 MCP 服务器
   */
  getMCPServer(serverId: string, agentId?: string): MCPServer | undefined {
    const server = this.mcpManager.getServer(serverId);
    if (!server) return undefined;
    if (!agentId) return server;
    return server.agentIds?.includes(agentId) ? server : undefined;
  }

  /**
   * 删除 MCP 服务器
   */
  removeMCPServer(serverId: string): boolean {
    return this.mcpManager.removeCapability(serverId);
  }

  /**
   * 获取所有 MCP 工具
   */
  getAllMCPTools(agentId?: string): Array<{ serverId: string; tool: MCPTool }> {
    return this.mcpManager.getAllTools(agentId);
  }

  /**
   * 调用 MCP 工具
   */
  async callMCPTool(serverId: string, toolName: string, params: Record<string, any>): Promise<any> {
    return this.mcpManager.callTool(serverId, toolName, params);
  }

  /**
   * 处理 capability_update 消息
   */
  handleCapabilityUpdate(agentId: string, action: string, payload: any, skipSave: boolean = false): void {
    this.mcpManager.handleCapabilityUpdate(agentId, action, payload, skipSave);
  }

  // ==================== 技能相关方法 ====================

  /**
   * 获取所有技能
   */
  getSkills(agentId?: string): SkillConfig[] {
    return this.skillManager.getAllSkills(agentId);
  }

  /**
   * 获取指定技能
   */
  getSkill(skillId: string): SkillConfig | undefined {
    return this.skillManager.getSkill(skillId);
  }

  /**
   * 注册技能
   */
  registerSkill(skill: Omit<SkillConfig, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }, agentId?: string): SkillConfig {
    return this.skillManager.registerSkill(skill, agentId);
  }

  /**
   * 更新技能
   */
  updateSkill(skillId: string, updates: Partial<SkillConfig>): SkillConfig | null {
    return this.skillManager.updateSkill(skillId, updates);
  }

  /**
   * 删除技能
   */
  removeSkill(skillId: string): boolean {
    return this.skillManager.removeSkill(skillId);
  }

  /**
   * 启用技能
   */
  enableSkill(skillId: string): boolean {
    return this.skillManager.setSkillEnabled(skillId, true);
  }

  /**
   * 禁用技能
   */
  disableSkill(skillId: string): boolean {
    return this.skillManager.setSkillEnabled(skillId, false);
  }

  /**
   * 匹配技能
   */
  matchSkills(input: string, agentId?: string): SkillConfig[] {
    return this.skillManager.matchSkills(input, agentId);
  }

  /**
   * 获取 MCP 管理器
   */
  getMCPManager(): MCPManager {
    return this.mcpManager;
  }

  /**
   * 获取技能管理器（兼容旧代码）
   */
  getSkillManager(): CapabilitySkillManager {
    return this.skillManager;
  }

  // ==================== 统计和摘要 ====================

  /**
   * 获取统计信息
   */
  getStats(agentId?: string): {
    mcpServers: number;
    mcpTools: number;
    skills: number;
    enabledSkills: number;
  } {
    return {
      mcpServers: this.mcpManager.getServerCount(agentId),
      mcpTools: this.mcpManager.getToolCount(agentId),
      skills: this.skillManager.getSkillCount(agentId),
      enabledSkills: this.skillManager.getEnabledSkillCount(agentId),
    };
  }

  /**
   * 获取能力摘要（用于注入系统提示词）
   */
  getCapabilitiesSummary(agentId?: string): string {
    const stats = this.getStats(agentId);
    const mcpTools = this.getAllMCPTools(agentId);
    const skills = this.skillManager.getEnabledSkills(agentId);

    if (mcpTools.length === 0 && skills.length === 0) {
      return '';
    }

    let summary = `## 🔧 可用能力\n\n`;

    // MCP 工具
    if (mcpTools.length > 0) {
      summary += `### MCP 工具 (${mcpTools.length} 个)\n\n`;
      for (const { serverId, tool } of mcpTools.slice(0, 20)) { // 限制显示数量
        summary += `- **${tool.name}** (来自 ${serverId.slice(0, 8)}): ${tool.description.slice(0, 100)}\n`;
      }
      if (mcpTools.length > 20) {
        summary += `\n... 还有 ${mcpTools.length - 20} 个工具\n`;
      }
      summary += '\n';
    }

    // 技能
    if (skills.length > 0) {
      summary += `### 技能 (${skills.length} 个)\n\n`;
      for (const skill of skills) {
        summary += `- **${skill.name}** (${skill.id}): 触发词: ${skill.triggers.join(', ')}\n`;
      }
      summary += '\n';
    }

    return summary;
  }
}

// ==================== 单例 ====================

let capabilityManagerInstance: CapabilityManager | null = null;

/**
 * 获取能力管理器实例
 */
export function getCapabilityManager(storePath?: string): CapabilityManager {
  if (!capabilityManagerInstance) {
    capabilityManagerInstance = new CapabilityManager(storePath || './data/capabilities');
  }
  return capabilityManagerInstance;
}

/**
 * 创建能力管理器
 */
export function createCapabilityManager(storePath: string): CapabilityManager {
  return new CapabilityManager(storePath);
}

/**
 * 初始化能力管理器
 */
export async function initializeCapabilityManager(storePath?: string): Promise<CapabilityManager> {
  const manager = getCapabilityManager(storePath);
  await manager.initialize();
  return manager;
}