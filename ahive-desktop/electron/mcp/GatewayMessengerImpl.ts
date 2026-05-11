/**
 * Gateway 消息发送器实现
 * 
 * 根据智能体来源渠道选择不同的发送方式：
 * - OpenClaw 本地 Agent: 使用 CLI 方式
 * - A2A 远程 Agent: 使用 A2A SSE 方式
 */

import log from 'electron-log';
import { sendMessageToAgent, getOpenClawAgents } from '../cli-bridge';
import { a2aManager } from '../a2a/A2AManager';

/**
 * Agent 来源渠道
 */
export type AgentChannel = 'openclaw-local' | 'a2a-remote' | 'unknown';

/**
 * Agent 信息（扩展）
 */
interface AgentChannelInfo {
  id: string;      // 通讯 ID (如 uuid 或 cli name)
  name: string;    // 显示名称
  logicalId: string; // 逻辑 ID (智能体内部使用的名字，如 saner)
  channel: AgentChannel;
}

/**
 * Gateway 消息发送器接口
 */
export interface IGatewayMessenger {
  sendToAgent(agentId: string, message: any): Promise<boolean>;
  broadcast(message: any): Promise<void>;
}

/**
 * Gateway 消息发送器实现
 */
export class GatewayMessengerImpl implements IGatewayMessenger {
  private openClawAgents: Map<string, AgentChannelInfo> = new Map();
  private a2aAgents: Map<string, AgentChannelInfo> = new Map();
  private initialized: boolean = false;

  /**
   * 初始化 - 刷新 Agent 缓存
   */
  async initialize(): Promise<void> {
    await this.refreshAgentCache();
    this.initialized = true;
    log.info('[GatewayMessenger] Initialized');
  }

  /**
   * 刷新 Agent 缓存
   */
  async refreshAgentCache(): Promise<void> {
    // 注释原因：CLI 类型智能体已放弃，openclaw agents list 命令因 Node 版本要求过高而失败
    // 2026-03-18: 暂时注释，保留代码以备将来恢复
    // 刷新 OpenClaw 本地 Agent
    this.openClawAgents.clear();
    // try {
    //   const localAgents = await getOpenClawAgents();
    //   for (const agent of localAgents) {
    //     this.openClawAgents.set(agent.name, {
    //       id: agent.id,
    //       name: agent.name,
    //       logicalId: agent.name, // 本地智能体逻辑 ID 即名称
    //       channel: 'openclaw-local'
    //     });
    //     // 同时用 id 作为 key，方便查找
    //     this.openClawAgents.set(agent.id, {
    //       id: agent.id,
    //       name: agent.name,
    //       logicalId: agent.name,
    //       channel: 'openclaw-local'
    //     });
    //   }
    //   log.info(`[GatewayMessenger] Found ${localAgents.length} OpenClaw local agents`);
    // } catch (error) {
    //   log.error('[GatewayMessenger] Failed to get OpenClaw agents:', error);
    // }

    // 刷新 A2A 远程 Agent
    this.a2aAgents.clear();
    try {
      const remoteAgents = a2aManager.getAllAgents();
      for (const agent of remoteAgents) {
        this.a2aAgents.set(agent.id, {
          id: agent.id,
          name: agent.name,
          logicalId: agent.agentId || agent.name, // A2A 智能体使用配置中的 agentId
          channel: 'a2a-remote'
        });
        // 同时用 name 作为 key，方便查找
        this.a2aAgents.set(agent.name, {
          id: agent.id,
          name: agent.name,
          logicalId: agent.agentId || agent.name,
          channel: 'a2a-remote'
        });
      }
      log.info(`[GatewayMessenger] Found ${remoteAgents.length} A2A remote agents`);
    } catch (error) {
      log.error('[GatewayMessenger] Failed to get A2A agents:', error);
    }
  }

  /**
   * 获取 Agent 的渠道信息
   * 
   * 前端 agents.json 使用带前缀的 ID：
   *   - OpenClaw 本地: "agent-{name}" (如 agent-saner)
   *   - A2A 远程: "a2a-{uuid}" (如 a2a-e045efd1-...)
   * 后端 protocol-config.json 使用原始 ID：
   *   - A2A: "{uuid}" (如 e045efd1-...)
   *   - OpenClaw CLI: "{name}" (如 saner)
   * 
   * 此方法负责剥离前缀并正确路由。
   */
  getAgentChannel(agentId: string): AgentChannelInfo | null {
    // 1. 检查是否是 A2A Agent（a2a- 前缀）
    if (agentId.startsWith('a2a-')) {
      const rawA2AId = agentId.slice(4); // 去掉 "a2a-" 前缀
      try {
        const a2aAgents = a2aManager.getAllAgents();
        const a2aMatch = a2aAgents.find(
          a => a.id === rawA2AId || a.name === rawA2AId
        );
        if (a2aMatch && a2aMatch.enabled !== false) {
          return {
            id: a2aMatch.id,    // 使用真实 A2A ID（不带前缀）
            name: a2aMatch.name,
            logicalId: a2aMatch.agentId || a2aMatch.name,
            channel: 'a2a-remote'
          };
        }
      } catch (error) {
        log.warn('[GatewayMessenger] Failed to query A2A agents:', error);
      }
      // A2A 前缀但没找到匹配的 agent
      log.warn(`[GatewayMessenger] A2A agent ${rawA2AId} not found`);
      return null;
    }

    // 2. 检查是否是 OpenClaw 本地 Agent（agent- 前缀）
    if (agentId.startsWith('agent-')) {
      const agentName = agentId.slice(6); // 去掉 "agent-" 前缀
      // 尝试在 OpenClaw 缓存中查找
      const localAgent = this.openClawAgents.get(agentName);
      if (localAgent) {
        return localAgent;
      }
      // 即使不在缓存中，也按 CLI 方式发送（OpenClaw Agent 可能未刷新进缓存）
      return {
        id: agentName,
        name: agentName,
        logicalId: agentName,
        channel: 'openclaw-local'
      };
    }

    // 3. 无前缀的情况（兼容旧格式）：先查 A2A，再查 OpenClaw
    try {
      const a2aAgents = a2aManager.getAllAgents();
      const a2aMatch = a2aAgents.find(
        a => a.id === agentId || a.name === agentId || a.agentId === agentId
      );
      if (a2aMatch && a2aMatch.enabled !== false) {
        return {
          id: a2aMatch.id,
          name: a2aMatch.name,
          logicalId: a2aMatch.agentId || a2aMatch.name,
          channel: 'a2a-remote'
        };
      }
    } catch (error) {
      log.warn('[GatewayMessenger] Failed to query A2A agents:', error);
    }

    const localAgent = this.openClawAgents.get(agentId);
    if (localAgent) {
      return localAgent;
    }

    log.warn(`[GatewayMessenger] Agent ${agentId} not found in any channel`);
    return null;
  }

  /**
   * 发送消息到指定 Agent
   */
  async sendToAgent(agentId: string, message: any): Promise<boolean> {
    // 确保已初始化
    if (!this.initialized) {
      await this.initialize();
    }

    const channelInfo = this.getAgentChannel(agentId);
    if (!channelInfo) {
      log.warn(`[GatewayMessenger] Agent ${agentId} not found in any channel`);
      return false;
    }

    log.info(`[GatewayMessenger] Sending to ${agentId} via ${channelInfo.channel}`);

    try {
      switch (channelInfo.channel) {
        case 'openclaw-local':
          return await this.sendViaCLI(channelInfo.name, message);

        case 'a2a-remote':
          return await this.sendViaA2A(channelInfo.id, message);

        default:
          log.warn(`[GatewayMessenger] Unknown channel for ${agentId}`);
          return false;
      }
    } catch (error) {
      log.error(`[GatewayMessenger] Failed to send to ${agentId}:`, error);
      return false;
    }
  }

  /**
   * 通过 CLI 方式发送消息（OpenClaw 本地 Agent）
   */
  private async sendViaCLI(agentName: string, message: any): Promise<boolean> {
    log.info(`[GatewayMessenger] Sending via CLI to ${agentName}`);

    const messageStr = typeof message === 'string'
      ? message
      : JSON.stringify(message);

    const result = await sendMessageToAgent(agentName, messageStr);

    if (result.success) {
      log.info(`[GatewayMessenger] CLI send success to ${agentName}`);
      return true;
    } else {
      log.error(`[GatewayMessenger] CLI send failed to ${agentName}:`, result.error);
      return false;
    }
  }

  /**
   * 通过 A2A 方式发送消息（远程 Agent）
   */
  private async sendViaA2A(agentId: string, message: any): Promise<boolean> {
    log.info(`[GatewayMessenger] Sending via A2A to ${agentId}`);

    const messageStr = typeof message === 'string'
      ? message
      : JSON.stringify(message);

    try {
      // 使用同步方式发送
      const result = await a2aManager.sendTaskSync(agentId, messageStr);

      if (result.status === 'completed') {
        log.info(`[GatewayMessenger] A2A send success to ${agentId}`);
        return true;
      } else if (result.status === 'failed') {
        log.error(`[GatewayMessenger] A2A send failed to ${agentId}:`, result.error);
        return false;
      } else {
        // 工作中或其他状态，也算成功（异步处理中）
        log.info(`[GatewayMessenger] A2A task ${result.status} for ${agentId}`);
        return true;
      }
    } catch (error) {
      log.error(`[GatewayMessenger] A2A send error to ${agentId}:`, error);
      return false;
    }
  }

  /**
   * 广播消息到所有 Agent
   */
  async broadcast(message: any): Promise<void> {
    log.info('[GatewayMessenger] Broadcasting to all agents');

    // 确保已初始化
    if (!this.initialized) {
      await this.initialize();
    }

    const results: { agentId: string; success: boolean }[] = [];

    // 广播到 OpenClaw 本地 Agent
    for (const [name, info] of this.openClawAgents) {
      if (info.channel === 'openclaw-local') {
        const success = await this.sendViaCLI(name, message);
        results.push({ agentId: name, success });
      }
    }

    // 广播到 A2A 远程 Agent
    for (const [id, info] of this.a2aAgents) {
      if (info.channel === 'a2a-remote') {
        const success = await this.sendViaA2A(id, message);
        results.push({ agentId: id, success });
      }
    }

    const successCount = results.filter(r => r.success).length;
    log.info(`[GatewayMessenger] Broadcast complete: ${successCount}/${results.length} succeeded`);
  }
}

// 单例导出
export const gatewayMessenger = new GatewayMessengerImpl();