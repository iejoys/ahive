/**
 * AHIVECORE 服务管理器
 * 负责管理 AHIVECORE 连接、健康检查和基础通信
 */

import { EventEmitter } from 'events';
import { AHIVECoreConfig, defaultConfig, loadConfig } from './config';
import { AHIVECoreEvent, ConnectionState } from './types';
import { getProjectPromptMeta, ProjectPromptMeta } from '../../storage';

/**
 * 工作流心跳数据格式
 */
export interface WorkflowHeartbeatData {
  workflowId: string;
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  timestamp: number;
  projectPrompts: ProjectPromptMeta[];
}

/**
 * 项目配置提示词元数据
 */
export interface ProjectPromptMeta {
  agentId: string | null;  // null 表示公共配置
  currentNodeId?: string;
  nodeStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  version: number;
  mtime: number;
}

/**
 * 心跳响应数据格式
 */
export interface HeartbeatResponse {
  success: boolean;
  timestamp: number;
  agents?: Array<{
    agentId: string;
    status: 'active' | 'idle' | 'busy' | 'offline';
    currentTaskId: string | null;
    hasTask: boolean;
  }>;
}

export class AHIVECoreService extends EventEmitter {
  private config: AHIVECoreConfig;
  private connectionState: ConnectionState = 'disconnected';
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  
  // 工作流心跳定时器
  private workflowHeartbeatTimer: NodeJS.Timeout | null = null;
  // 当前活跃工作流
  private activeWorkflows: Map<string, {
    status: 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
    currentNodeId?: string;
    nodeStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  }> = new Map();

  constructor(config?: Partial<AHIVECoreConfig>) {
    super();
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    console.log('[AHIVECoreService] Initializing...');
    
    // 加载配置
    this.config = loadConfig();
    
    // 检查 AHIVECORE 连接
    await this.checkConnection();
    
    // 启动健康检查
    this.startHealthCheck();
    
    console.log('[AHIVECoreService] Initialized successfully');
  }

  /**
   * 检查 AHIVECORE 连接状态
   */
  async checkConnection(): Promise<boolean> {
    try {
      this.connectionState = 'connecting';
      this.emit('connection-state-change', this.connectionState);
      
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.emit('connection-state-change', this.connectionState);
        console.log('[AHIVECoreService] Connected to AHIVECORE');
        return true;
      } else {
        throw new Error(`Health check failed: ${response.status}`);
      }
    } catch (error) {
      this.connectionState = 'error';
      this.emit('connection-state-change', this.connectionState);
      this.emit('error', error);
      console.error('[AHIVECoreService] Connection failed:', error);
      return false;
    }
  }

  /**
   * 启动健康检查定时器
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.healthCheckTimer = setInterval(async () => {
      const connected = await this.checkConnection();
      if (!connected) {
        this.handleDisconnect();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(): void {
    this.connectionState = 'disconnected';
    this.emit('connection-state-change', this.connectionState);
    
    // 尝试重连
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[AHIVECoreService] Reconnecting... (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.checkConnection();
      }, this.config.reconnectInterval);
    } else {
      console.error('[AHIVECoreService] Max reconnect attempts reached');
      this.emit('max-reconnect-failed');
    }
  }

  /**
   * 获取连接状态
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * 检查是否已连接（便捷方法）
   */
  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * 发送工作流心跳到 AHIVECORE
   */
  async sendWorkflowHeartbeat(data: WorkflowHeartbeatData): Promise<HeartbeatResponse> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/workflow/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        return {
          success: false,
          timestamp: Date.now(),
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
      
      return await response.json();
    } catch (error) {
      console.error('[AHIVECoreService] Failed to send workflow heartbeat:', error);
      return {
        success: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取配置
   */
  getConfig(): AHIVECoreConfig {
    return { ...this.config };
  }

  /**
   * 获取可用智能体列表
   */
  async getAgents(): Promise<any[]> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/agents`);
      if (!response.ok) {
        throw new Error(`Failed to get agents: ${response.status}`);
      }
      const data = await response.json();
      return data.agents || [];
    } catch (error) {
      console.error('[AHIVECoreService] Failed to get agents:', error);
      throw error;
    }
  }

  /**
   * 获取智能体详情
   */
  async getAgent(agentId: string): Promise<any> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/agents/${agentId}`);
      if (!response.ok) {
        throw new Error(`Failed to get agent: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[AHIVECoreService] Failed to get agent:', error);
      throw error;
    }
  }

  /**
   * 激活智能体
   */
  async activateAgent(agentId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/agents/${agentId}/activate`, {
        method: 'POST',
      });
      return response.ok;
    } catch (error) {
      console.error('[AHIVECoreService] Failed to activate agent:', error);
      throw error;
    }
  }

  /**
   * 创建智能体
   */
  async createAgent(type: 'ahive-coder' | 'ahive-worker', config: {
    nickname?: string;
    model?: {
      provider?: string;
      name?: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      baseUrl?: string;
    };
  }): Promise<{ success: boolean; agent?: any; error?: string }> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/unified-agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          agentId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          config,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }
      
      const data = await response.json();
      return { success: true, agent: data.agent };
    } catch (error) {
      console.error('[AHIVECoreService] Failed to create agent:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 更新智能体
   */
  async updateAgent(agentId: string, config: {
    nickname?: string;
    model?: {
      provider?: string;
      name?: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      baseUrl?: string;
    };
  }): Promise<{ success: boolean; agent?: any; error?: string }> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/unified-agents/${agentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }
      
      const data = await response.json();
      return { success: true, agent: data.agent };
    } catch (error) {
      console.error('[AHIVECoreService] Failed to update agent:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 删除智能体
   */
  async deleteAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/unified-agents/${agentId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }
      
      return { success: true };
    } catch (error) {
      console.error('[AHIVECoreService] Failed to delete agent:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 获取所有智能体列表（使用 unified-agents API）
   */
  async listAgents(): Promise<{ success: boolean; agents?: any[]; error?: string }> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/unified-agents`);
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }
      
      const data = await response.json();
      return { success: true, agents: data.agents || [] };
    } catch (error) {
      console.error('[AHIVECoreService] Failed to list agents:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 获取单个智能体详情（使用 unified-agents API）
   */
  async getAgentDetails(agentId: string): Promise<{ success: boolean; agent?: any; error?: string }> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/unified-agents/${agentId}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }
      
      const data = await response.json();
      return { success: true, agent: data.agent };
    } catch (error) {
      console.error('[AHIVECoreService] Failed to get agent details:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    console.log('[AHIVECoreService] Stopping...');
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    this.connectionState = 'disconnected';
    this.emit('connection-state-change', this.connectionState);
    
    console.log('[AHIVECoreService] Stopped');
  }
}

// 单例实例
let serviceInstance: AHIVECoreService | null = null;

export function getAHIVECoreService(config?: Partial<AHIVECoreConfig>): AHIVECoreService {
  if (!serviceInstance) {
    serviceInstance = new AHIVECoreService(config);
  }
  return serviceInstance;
}