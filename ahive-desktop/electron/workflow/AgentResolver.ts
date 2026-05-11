/**
 * Agent 解析器
 * 解决工作流 JSON 中 Agent ID 与实际 Agent ID 不匹配的问题
 * 
 * 支持多种匹配方式：
 * 1. 精确 ID 匹配
 * 2. 别名匹配
 * 3. 名称匹配
 * 4. 模糊匹配
 */

import type { Agent } from './types';

export class AgentResolver {
  private agents: Map<string, Agent> = new Map();
  private aliasMap: Map<string, string> = new Map();
  
  /**
   * 注册 Agent
   */
  registerAgent(agent: Agent, aliases?: string[]): void {
    // 主 ID
    this.agents.set(agent.id, agent);
    
    // 别名
    if (aliases) {
      for (const alias of aliases) {
        this.aliasMap.set(alias, agent.id);
      }
    }
    
    // 自动添加名称别名
    if (agent.name) {
      this.aliasMap.set(agent.name, agent.id);
    }
    
    // 如果有 agentId 字段，添加为别名
    if (agent.agentId) {
      this.aliasMap.set(agent.agentId, agent.id);
    }
    
    console.log(`[AgentResolver] Registered agent: ${agent.id} (${agent.name})`);
    if (aliases?.length || agent.agentId) {
      console.log(`[AgentResolver] Aliases: ${[...(aliases || []), agent.name, agent.agentId].filter(Boolean).join(', ')}`);
    }
  }
  
  /**
   * 批量注册 Agent
   */
  registerAgents(agents: Agent[]): void {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
    console.log(`[AgentResolver] Registered ${agents.length} agents`);
  }
  
  /**
   * 注销 Agent
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      
      // 清除相关别名
      for (const [alias, id] of this.aliasMap.entries()) {
        if (id === agentId) {
          this.aliasMap.delete(alias);
        }
      }
    }
  }
  
  /**
   * 解析 Agent
   * 支持多种匹配方式
   */
  resolve(idOrName: string): Agent | undefined {
    if (!idOrName) {
      return undefined;
    }
    
    // 1. 精确匹配 ID
    if (this.agents.has(idOrName)) {
      return this.agents.get(idOrName);
    }
    
    // 2. 别名匹配
    const actualId = this.aliasMap.get(idOrName);
    if (actualId && this.agents.has(actualId)) {
      console.log(`[AgentResolver] Resolved "${idOrName}" -> "${actualId}" via alias`);
      return this.agents.get(actualId);
    }
    
    // 3. 模糊匹配（ID 包含）
    for (const [id, agent] of this.agents) {
      if (id.includes(idOrName) || idOrName.includes(id)) {
        console.log(`[AgentResolver] Resolved "${idOrName}" -> "${id}" via fuzzy match`);
        return agent;
      }
    }
    
    // 4. 名称模糊匹配
    const lowerName = idOrName.toLowerCase();
    for (const agent of this.agents.values()) {
      if (agent.name && agent.name.toLowerCase().includes(lowerName)) {
        console.log(`[AgentResolver] Resolved "${idOrName}" -> "${agent.id}" via name match`);
        return agent;
      }
    }
    
    console.warn(`[AgentResolver] Agent not found: ${idOrName}`);
    return undefined;
  }
  
  /**
   * 解析多个执行者
   */
  resolveExecutors(executors: Array<{ type: string; id: string }>): Agent[] {
    const resolved: Agent[] = [];
    
    for (const executor of executors) {
      if (executor.type === 'agent') {
        const agent = this.resolve(executor.id);
        if (agent) {
          resolved.push(agent);
        } else {
          console.warn(`[AgentResolver] Could not resolve executor: ${executor.id}`);
        }
      }
      // department 类型暂不支持
    }
    
    return resolved;
  }
  
  /**
   * 获取所有 Agent
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }
  
  /**
   * 获取 Agent 数量
   */
  getAgentCount(): number {
    return this.agents.size;
  }
  
  /**
   * 检查 Agent 是否存在
   */
  hasAgent(idOrName: string): boolean {
    return this.resolve(idOrName) !== undefined;
  }
  
  /**
   * 获取空闲 Agent
   */
  getIdleAgents(): Agent[] {
    return this.getAllAgents().filter(a => a.status === 'idle');
  }
  
  /**
   * 按技能筛选 Agent
   */
  getAgentsBySkill(skill: string): Agent[] {
    return this.getAllAgents().filter(a => 
      a.skills && a.skills.includes(skill)
    );
  }
  
  /**
   * 清空所有注册
   */
  clear(): void {
    this.agents.clear();
    this.aliasMap.clear();
    console.log('[AgentResolver] Cleared all agents');
  }
}