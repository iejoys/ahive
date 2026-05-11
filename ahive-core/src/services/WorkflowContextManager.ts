/**
 * 工作流上下文管理器
 * 负责接收心跳、检测配置变化、注入项目配置到智能体
 */

import { EventEmitter } from 'events';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/index.js';

// ==================== 类型定义 ====================

/** 工作流状态枚举 */
export enum WorkflowStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** 节点状态枚举 */
export enum NodeStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
  SKIPPED = 'skipped',
}

/** 项目配置提示词元数据 */
export interface ProjectPromptMeta {
  agentId: string;
  currentNodeId?: string;
  nodeStatus?: NodeStatus;
  version: number;
  mtime: number;
}

/** 心跳数据 */
export interface HeartbeatData {
  workflowId: string;
  status: WorkflowStatus;
  timestamp: number;
  projectPrompts?: ProjectPromptMeta[];
  participatingAgents?: string[];  // 参与工作流的 Agent ID 列表
}

/** 心跳响应 */
export interface HeartbeatResponse {
  success: boolean;
  timestamp: number;
  agents: AgentStatusInfo[];
}

/** Agent 状态信息 */
export interface AgentStatusInfo {
  agentId: string;
  status: 'active' | 'idle' | 'busy' | 'offline';
  currentTaskId: string | null;
  hasTask: boolean;
}

/** 工作流上下文 */
export interface WorkflowContext {
  workflowId: string;
  status: WorkflowStatus;
  lastHeartbeat: number;
  projectPrompts: Map<string, ProjectPromptMeta>;
  promptContents: Map<string, string>;
  participatingAgents: Set<string>;  // 参与工作流的 Agent ID 集合
}

/** 上下文更新事件 */
export interface ContextUpdateEvent {
  workflowId: string;
  agentId: string;
  type: 'public' | 'private';
  content: string;
  version: number;
  mtime: number;
}

// ==================== WorkflowContextManager ====================

/**
 * 工作流上下文管理器
 * 
 * 功能：
 * 1. 接收工作流心跳
 * 2. 检测项目配置版本号/mtime变化
 * 3. 读取配置文件并注入到智能体
 */
export class WorkflowContextManager extends EventEmitter {
  // 工作流上下文缓存
  private workflowContexts: Map<string, WorkflowContext> = new Map();
  
  // 项目配置文件基础路径（ahive-electron/data/workflow-states）
  private workflowStatesDir: string;
  
  // 心跳超时（毫秒）
  private heartbeatTimeout: number;
  
  // 清理定时器
  private cleanupTimer: NodeJS.Timeout | null = null;
  
  constructor(options: {
    workflowStatesDir?: string;
    heartbeatTimeout?: number;
  } = {}) {
    super();
    
    // 默认路径：ahive-electron/data/workflow-states
    // AHIVECORE 和 ahive-electron 在同一项目目录下
    this.workflowStatesDir = options.workflowStatesDir || 
      join(process.cwd(), '..', 'ahive-electron', 'data', 'workflow-states');
    
    this.heartbeatTimeout = options.heartbeatTimeout || 120000; // 2分钟
    
    logger.info('[WorkflowContextManager] Initialized with states dir:', this.workflowStatesDir);
    
    // 启动清理定时器
    this.startCleanupTimer();
  }
  
  /**
   * 处理心跳
   */
  async handleHeartbeat(heartbeat: HeartbeatData): Promise<HeartbeatResponse> {
    const { workflowId, status, timestamp, projectPrompts, participatingAgents } = heartbeat;
    
    logger.info('[WorkflowContextManager] Received heartbeat:', {
      workflowId,
      status,
      timestamp,
      promptCount: projectPrompts?.length || 0,
      participatingAgents: participatingAgents?.length || 0,
    });
    
    // 获取或创建工作流上下文
    let context = this.workflowContexts.get(workflowId);
    
    if (!context) {
      context = {
        workflowId,
        status,
        lastHeartbeat: timestamp,
        projectPrompts: new Map(),
        promptContents: new Map(),
        participatingAgents: new Set(participatingAgents || []),
      };
      this.workflowContexts.set(workflowId, context);
    } else {
      // 更新状态
      context.status = status;
      context.lastHeartbeat = timestamp;
      // 更新参与的 Agent 列表
      if (participatingAgents) {
        context.participatingAgents = new Set(participatingAgents);
      }
    }
    
    // 检测项目配置变化
    if (projectPrompts && projectPrompts.length > 0) {
      await this.checkProjectPromptChanges(workflowId, context, projectPrompts);
    }
    
    // 返回 Agent 状态（从 ProcessManager 获取）
    const agents = await this.getAgentStatuses(workflowId);
    
    return {
      success: true,
      timestamp: Date.now(),
      agents,
    };
  }
  
  /**
   * 检测项目配置变化
   */
  private async checkProjectPromptChanges(
    workflowId: string,
    context: WorkflowContext,
    projectPrompts: ProjectPromptMeta[]
  ): Promise<void> {
    for (const promptMeta of projectPrompts) {
      const { agentId, version, mtime } = promptMeta;
      
      // 获取缓存的元数据
      const cachedMeta = context.projectPrompts.get(agentId);
      
      // 检测是否需要更新
      const needsUpdate = !cachedMeta || 
        cachedMeta.version < version || 
        cachedMeta.mtime < mtime;
      
      if (needsUpdate) {
        logger.info('[WorkflowContextManager] Project prompt changed:', {
          workflowId,
          agentId,
          oldVersion: cachedMeta?.version || 0,
          newVersion: version,
          oldMtime: cachedMeta?.mtime || 0,
          newMtime: mtime,
        });
        
        // 读取配置文件
        const content = await this.readProjectPromptFile(workflowId, agentId);
        
        if (content) {
          // 更新缓存
          context.projectPrompts.set(agentId, promptMeta);
          context.promptContents.set(agentId, content);
          
          // 发送更新事件
          this.emit('context-update', {
            workflowId,
            agentId,
            type: agentId === 'public' ? 'public' : 'private',
            content,
            version,
            mtime,
          } as ContextUpdateEvent);
          
          logger.info('[WorkflowContextManager] Project prompt updated:', {
            workflowId,
            agentId,
            contentLength: content.length,
          });
        }
      }
    }
  }
  
  /**
   * 读取项目配置文件
   */
  private async readProjectPromptFile(workflowId: string, agentId: string): Promise<string | null> {
    try {
      // 公共配置文件：projectinfo_prompt.md
      // 专用配置文件：projectinfo_{agentId}_prompt.md
      const fileName = agentId === 'public' 
        ? 'projectinfo_prompt.md' 
        : `projectinfo_${agentId}_prompt.md`;
      
      const filePath = join(this.workflowStatesDir, workflowId, fileName);
      
      // 检查文件是否存在
      try {
        await access(filePath);
      } catch {
        logger.warn('[WorkflowContextManager] File not found:', filePath);
        return null;
      }
      
      // 读取文件内容
      const content = await readFile(filePath, 'utf-8');
      
      return content;
    } catch (error) {
      logger.error('[WorkflowContextManager] Failed to read project prompt file:', {
        workflowId,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  
  /**
   * 获取项目配置内容
   */
  getProjectPrompt(workflowId: string, agentId: string): string | null {
    const context = this.workflowContexts.get(workflowId);
    
    if (!context) {
      return null;
    }
    
    // 先尝试获取专用配置
    if (agentId !== 'public') {
      const privateContent = context.promptContents.get(agentId);
      if (privateContent) {
        return privateContent;
      }
    }
    
    // 获取公共配置
    const publicContent = context.promptContents.get('public');
    
    return publicContent || null;
  }
  
  /**
   * 获取工作流上下文
   */
  getWorkflowContext(workflowId: string): WorkflowContext | undefined {
    return this.workflowContexts.get(workflowId);
  }
  
  /**
   * 清理工作流上下文
   */
  clearWorkflowContext(workflowId: string): void {
    this.workflowContexts.delete(workflowId);
    logger.info('[WorkflowContextManager] Workflow context cleared:', workflowId);
  }
  
  /**
   * 获取所有活跃工作流
   */
  getActiveWorkflows(): WorkflowContext[] {
    const now = Date.now();
    
    return Array.from(this.workflowContexts.values())
      .filter(ctx => ctx.status === WorkflowStatus.RUNNING || ctx.status === WorkflowStatus.PAUSED)
      .filter(ctx => now - ctx.lastHeartbeat < this.heartbeatTimeout);
  }
  
  /**
   * 获取 Agent 状态
   * TODO: 从 ProcessManager 获取实际状态
   */
  private async getAgentStatuses(workflowId: string): Promise<AgentStatusInfo[]> {
    // 暂时返回空数组，后续需要从 ProcessManager 获取
    // ProcessManager 需要提供 getAgentStatus 方法
    return [];
  }
  
  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleContexts();
    }, 60000); // 每分钟清理一次
  }
  
  /**
   * 清理过期上下文
   */
  private cleanupStaleContexts(): void {
    const now = Date.now();
    const staleThreshold = this.heartbeatTimeout * 5; // 10分钟
    
    for (const [workflowId, context] of this.workflowContexts) {
      if (now - context.lastHeartbeat > staleThreshold) {
        this.workflowContexts.delete(workflowId);
        logger.info('[WorkflowContextManager] Cleaned stale workflow context:', workflowId);
      }
    }
  }
  
  /**
   * 停止管理器
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    this.workflowContexts.clear();
    logger.info('[WorkflowContextManager] Stopped');
  }
}

// 单例实例
let managerInstance: WorkflowContextManager | null = null;

/**
 * 获取 WorkflowContextManager 单例
 */
export function getWorkflowContextManager(options?: {
  workflowStatesDir?: string;
  heartbeatTimeout?: number;
}): WorkflowContextManager {
  if (!managerInstance) {
    managerInstance = new WorkflowContextManager(options);
  }
  return managerInstance;
}