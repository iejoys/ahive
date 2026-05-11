/**
 * A2A Agent 管理器 (重构版)
 * 使用客户端抽象支持多种 A2A 协议
 * 
 * 支持的协议:
 * - a2a-standard: 标准 A2A 协议 (OpenCode 等)
 * - openclaw: OpenClaw OpenResponses 协议
 */

import log from 'electron-log';
import { 
  getA2AAgents, 
  saveA2AAgent, 
  deleteA2AAgent as deleteA2AAgentFromStorage 
} from '../storage';
import type { A2AAgentConfig, A2AAgentCard, A2ATaskStatus, A2AArtifact } from '../storage';
import { 
  a2aClientFactory, 
  type IA2AClient, 
  type StreamCallback,
  type A2AStreamEvent 
} from './clients';
import { getStreamBroadcasterInstance } from '../services/ahivecore/StreamBroadcaster';

/**
 * 扩展的 Agent 配置（包含协议类型）
 */
export interface ExtendedA2AAgentConfig extends A2AAgentConfig {
  protocolType?: 'a2a-standard' | 'openclaw' | 'opencode' | 'ahivecore';
  supportsStreaming?: boolean;
  apiKey?: string;
}

/**
 * A2A 管理器
 */
export class A2AManager {
  private clients: Map<string, IA2AClient> = new Map();
  private agentCards: Map<string, A2AAgentCard> = new Map();
  private agentConfigs: Map<string, ExtendedA2AAgentConfig> = new Map();
  private initialized: boolean = false;

  /**
   * 初始化：加载已保存的 Agents
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    log.info('[A2AManager] Initializing...');
    const agents = getA2AAgents();
    
    for (const agent of agents) {
      try {
        // 只加载已启用的 Agents
        if (agent.enabled !== false) {
          const client = a2aClientFactory.createClient(agent as A2AAgentConfig);
          const card = await client.initialize();
          
          this.clients.set(agent.id, client);
          this.agentConfigs.set(agent.id, agent as ExtendedA2AAgentConfig);
          
          if (card) {
            this.agentCards.set(agent.id, card);
          }
          
          log.info(`[A2AManager] Loaded agent: ${agent.name} (${agent.protocolType || 'default'})`);
        }
      } catch (error) {
        log.error(`[A2AManager] Failed to load agent ${agent.name}:`, error);
      }
    }
    
    this.initialized = true;
    log.info(`[A2AManager] Initialized with ${this.clients.size} agents`);
  }

  /**
   * 添加 A2A Agent
   */
  async addAgent(config: ExtendedA2AAgentConfig): Promise<A2AAgentCard | null> {
    // 保存配置
    saveA2AAgent(config as A2AAgentConfig);
    this.agentConfigs.set(config.id, config);

    try {
      // 创建客户端
      const client = a2aClientFactory.createClient(config as A2AAgentConfig);
      const card = await client.initialize();

      this.clients.set(config.id, client);
      if (card) {
        this.agentCards.set(config.id, card);
      }

      log.info(`[A2AManager] Agent ${config.name} added with protocol: ${client.protocolType}`);
      return card;
    } catch (error) {
      log.error('[A2AManager] Failed to add agent:', error);
      return null;
    }
  }

  /**
   * 移除 A2A Agent
   */
  async removeAgent(agentId: string): Promise<void> {
    const client = this.clients.get(agentId);
    if (client) {
      await client.cleanup();
    }
    
    this.clients.delete(agentId);
    this.agentCards.delete(agentId);
    this.agentConfigs.delete(agentId);
    deleteA2AAgentFromStorage(agentId);
    
    log.info(`[A2AManager] Agent ${agentId} removed`);
  }

  /**
   * 获取所有 Agent
   */
  getAllAgents(): A2AAgentConfig[] {
    return getA2AAgents();
  }

  /**
   * 获取 Agent 列表（带 Card）
   */
  getAgentList(): Array<A2AAgentConfig & { card?: A2AAgentCard }> {
    const agents = getA2AAgents();
    return agents.map(agent => ({
      ...agent,
      card: this.agentCards.get(agent.id)
    }));
  }

  /**
   * 获取 Agent Card
   */
  getAgentCard(agentId: string): A2AAgentCard | undefined {
    return this.agentCards.get(agentId);
  }

  /**
   * 获取 Agent 配置
   */
  getAgentConfig(agentId: string): ExtendedA2AAgentConfig | undefined {
    return this.agentConfigs.get(agentId);
  }

  /**
   * 发送任务（同步）
   */
  async sendTaskSync(agentId: string, task: string, timeout = 300000): Promise<A2ATaskStatus> {
    // 确保已初始化
    if (!this.initialized) {
      await this.initialize();
    }

    const client = this.clients.get(agentId);
    const config = this.agentConfigs.get(agentId);
    
    // 详细日志：打印请求信息
    log.info(`[A2AManager] ====== sendTaskSync ======`);
    log.info(`[A2AManager] agentId: ${agentId}`);
    log.info(`[A2AManager] task: ${task.substring(0, 100)}...`);
    log.info(`[A2AManager] client found: ${!!client}`);
    log.info(`[A2AManager] config found: ${!!config}`);
    
    if (config) {
      log.info(`[A2AManager] config.endpoint: ${config.endpoint}`);
      log.info(`[A2AManager] config.protocolType: ${config.protocolType}`);
      log.info(`[A2AManager] config.agentId: ${config.agentId}`);
    }
    
    if (!client) {
      log.error(`[A2AManager] Agent not found: ${agentId}. Available: ${Array.from(this.clients.keys()).join(', ')}`);
      throw new Error(`Agent ${agentId} not found`);
    }
    
    const result = await client.sendTaskSync(task, timeout);
    log.info(`[A2AManager] Task result:`, result.status, result.error || '');
    
    // 保存 sessionKey（如果是 OpenClaw 客户端）
    this.persistSessionKey(agentId, client);
    
    return result;
  }
  /**
   * 发送任务（异步）
   */
  async sendTaskAsync(agentId: string, task: string, webhookUrl?: string): Promise<string> {
    const client = this.clients.get(agentId);
    if (!client) {
      throw new Error(`Agent ${agentId} not found`);
    }
    return client.sendTaskAsync(task, webhookUrl);
  }

  /**
   * 发送任务（流式）
   */
  async sendTaskStream(
    agentId: string,
    task: string,
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<A2ATaskStatus> {
    const client = this.clients.get(agentId);
    if (!client) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    const config = this.agentConfigs.get(agentId);
    const agentName = config?.name || agentId;
    
    // 获取 StreamBroadcaster
    const broadcaster = getStreamBroadcasterInstance();
    
    // 注册流
    const abortController = signal ? undefined : new AbortController();
    broadcaster?.registerStream(agentId, agentName, abortController);
    
    // 包装事件回调，同时广播到 WebSocket
    const wrappedOnEvent: StreamCallback = (event: A2AStreamEvent) => {
      // 先调用原始回调
      onEvent(event);
      
      // 然后广播到 WebSocket
      if (broadcaster) {
        switch (event.type) {
          case 'text-delta':
            if (event.data?.delta) {
              broadcaster.sendTextDelta(agentId, event.data.delta, agentName);
            }
            break;
          case 'text-done':
            if (event.data?.text) {
              broadcaster.sendTextDelta(agentId, '', agentName);
            }
            break;
          case 'thinking':
            if (event.data?.thinking) {
              broadcaster.sendThinking(agentId, event.data.thinking, agentName);
            }
            break;
          case 'tool-call':
            broadcaster.sendAction(agentId, {
              tool: event.data?.tool || 'unknown',
              input: event.data?.input,
            }, agentName);
            break;
          case 'status-update':
            // 状态更新已经在 registerStream/unregisterStream 中处理
            break;
          case 'error':
            broadcaster.sendError(agentId, event.data?.error || 'Unknown error', agentName);
            break;
        }
      }
    };
    
    try {
      const result = await client.sendTaskStream(task, wrappedOnEvent, signal);
      
      // 发送最终结果
      broadcaster?.sendResult(agentId, result, agentName);
      
      // 保存 sessionKey（如果是 OpenClaw 客户端）
      this.persistSessionKey(agentId, client);
      
      return result;
    } catch (error: any) {
      broadcaster?.sendError(agentId, error.message, agentName);
      throw error;
    }
  }

  /**
   * 持久化 sessionKey 到配置文件
   */
  private persistSessionKey(agentId: string, client: IA2AClient): void {
    // 检查是否是 OpenClaw 客户端
    if (client.protocolType === 'openclaw' && 'getSessionKey' in client) {
      const sessionKey = (client as any).getSessionKey();
      if (sessionKey) {
        const config = this.agentConfigs.get(agentId);
        if (config && config.sessionKey !== sessionKey) {
          config.sessionKey = sessionKey;
          saveA2AAgent(config as A2AAgentConfig);
          log.info(`[A2AManager] SessionKey saved for ${agentId}: ${sessionKey}`);
        }
      }
    }
  }

  /**
   * 取消任务
   */
  async cancelTask(agentId: string, taskId: string): Promise<boolean> {
    const client = this.clients.get(agentId);
    if (!client) return false;
    return client.cancelTask(taskId);
  }

  /**
   * 获取任务状态
   */
  async getTaskStatus(agentId: string, taskId: string): Promise<A2ATaskStatus | null> {
    const client = this.clients.get(agentId);
    if (!client) return null;
    return client.getTaskStatus(taskId);
  }

  /**
   * 处理 Webhook 回调
   */
  handleWebhook(agentId: string, payload: {
    taskId: string;
    status: string;
    message?: { content: string };
    artifacts?: A2AArtifact[];
  }): boolean {
    // Webhook 处理通常由异步任务触发
    // 这里更新本地任务状态
    log.info(`[A2AManager] Webhook received for agent ${agentId}:`, payload.taskId);
    return true;
  }

  /**
   * 启用/禁用 Agent
   */
  async setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
    const agents = getA2AAgents();
    const config = agents.find(a => a.id === agentId);

    if (config) {
      config.enabled = enabled;
      saveA2AAgent(config);

      if (!enabled) {
        const client = this.clients.get(agentId);
        if (client) {
          await client.cleanup();
        }
        this.clients.delete(agentId);
      } else {
        const extendedConfig = this.agentConfigs.get(agentId) || config as ExtendedA2AAgentConfig;
        await this.addAgent(extendedConfig);
      }
    }
  }

  /**
   * 刷新 Agent Card
   */
  async refreshAgentCard(agentId: string): Promise<A2AAgentCard | null> {
    const config = this.agentConfigs.get(agentId);
    if (!config) {
      const agents = getA2AAgents();
      const baseConfig = agents.find(a => a.id === agentId);
      if (!baseConfig) return null;
      this.agentConfigs.set(agentId, baseConfig as ExtendedA2AAgentConfig);
    }

    const client = a2aClientFactory.createClient(this.agentConfigs.get(agentId)! as A2AAgentConfig);
    const card = await client.initialize();

    if (card) {
      this.agentCards.set(agentId, card);
      this.clients.set(agentId, client);
    }

    return card;
  }

  /**
   * 健康检查所有 Agent
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [agentId, client] of this.clients) {
      try {
        results.set(agentId, await client.healthCheck());
      } catch {
        results.set(agentId, false);
      }
    }
    return results;
  }

  /**
   * 获取支持的协议类型
   */
  getSupportedProtocols(): string[] {
    return a2aClientFactory.getSupportedProtocols();
  }

  /**
   * 清理
   */
  async cleanup(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.cleanup();
    }
    this.clients.clear();
    this.agentCards.clear();
    this.agentConfigs.clear();
  }
}

// 单例导出
export const a2aManager = new A2AManager();

// 重新导出类型
export type { StreamCallback, A2AStreamEvent } from './clients';
