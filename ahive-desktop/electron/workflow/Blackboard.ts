/**
 * 黑板服务 - 实例级隔离
 * 
 * 每个工作流执行实例创建独立的黑板实例
 * 解决多工作流并行执行时的数据隔离问题
 */

import type {
  BlackboardVariableEntry,
  BlackboardTask,
  SetVariableOptions,
  BlackboardSnapshot,
} from './types';

/** 持久化回调函数类型 */
export type PersistCallback = (variables: BlackboardVariableEntry[]) => void | Promise<void>;

/** 黑板配置 */
export interface BlackboardConfig {
  maxVariables?: number;
  maxTasks?: number;
  persistEnabled?: boolean;
  persistInterval?: number;
}

/** Agent 状态 */
interface AgentState {
  agentId: string;
  status: 'idle' | 'working' | 'paused' | 'error';
  currentTask?: string;
  currentTaskId?: string;
  load: number;
  workload?: number;
  lastHeartbeat: string;
}

/** 黑板事件 */
interface BlackboardEvent {
  type: string;
  timestamp: string;
  data: unknown;
  source?: string;
}

/**
 * 黑板服务类
 * 
 * 核心功能：
 * 1. 变量管理 - 存储和共享跨节点的变量
 * 2. 任务管理 - 任务状态跟踪
 * 3. 订阅机制 - 变更通知
 * 4. 持久化 - 变量自动保存
 */
export class BlackboardService {
  // ========== 存储空间 ==========
  
  private variables: Map<string, BlackboardVariableEntry> = new Map();
  private tasks: Map<string, BlackboardTask> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  
  // ========== 订阅管理 ==========
  
  private variableSubscribers: Map<string, Set<(entry: BlackboardVariableEntry) => void>> = new Map();
  private eventListeners: Set<(event: BlackboardEvent) => void> = new Set();
  
  // ========== 配置 ==========
  
  private config: Required<BlackboardConfig>;
  
  // ========== 历史记录 ==========
  
  private events: BlackboardEvent[] = [];
  private snapshots: BlackboardSnapshot[] = [];
  
  // ========== 持久化 ==========
  
  private persistCallback: PersistCallback | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPersist = false;
  
  // ========== 实例标识 ==========
  
  public readonly instanceId: string;

  constructor(instanceId: string, config: BlackboardConfig = {}) {
    this.instanceId = instanceId;
    this.config = {
      maxVariables: config.maxVariables ?? 1000,
      maxTasks: config.maxTasks ?? 100,
      persistEnabled: config.persistEnabled ?? false,
      persistInterval: config.persistInterval ?? 5000,
    };
    
    // 如果启用持久化，启动定时保存
    if (this.config.persistEnabled) {
      this.startPersistTimer();
    }
    
    console.log(`[Blackboard:${instanceId}] Created`);
  }
  
  /**
   * 设置持久化回调函数
   */
  setPersistCallback(callback: PersistCallback | null): void {
    this.persistCallback = callback;
  }
  
  /**
   * 启动持久化定时器
   */
  private startPersistTimer(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
    }
    this.persistTimer = setInterval(() => {
      this.doPersist();
    }, this.config.persistInterval);
  }
  
  /**
   * 立即触发持久化（防抖）
   */
  private schedulePersist(): void {
    if (!this.persistCallback) return;
    
    if (this.pendingPersist) return;
    this.pendingPersist = true;
    
    setTimeout(() => {
      this.doPersist();
      this.pendingPersist = false;
    }, 100);
  }
  
  /**
   * 执行持久化
   */
  private async doPersist(): Promise<void> {
    if (!this.persistCallback) return;
    
    try {
      const variables = this.getAllVariables();
      await this.persistCallback(variables);
    } catch (error) {
      console.error(`[Blackboard:${this.instanceId}] Persist error:`, error);
    }
  }

  // ========== 变量操作 ==========

  /**
   * 设置变量
   */
  setVariable(
    key: string,
    value: unknown,
    options: SetVariableOptions = {}
  ): BlackboardVariableEntry {
    const existing = this.variables.get(key);
    const version = existing ? existing.version + 1 : 1;
    
    const entry: BlackboardVariableEntry = {
      key,
      value,
      type: options.type ?? 'public',
      owner: options.owner,
      version,
      updatedAt: new Date().toISOString(),
      description: options.description,
    };
    
    this.variables.set(key, entry);
    
    // 记录事件
    this.emitEvent({
      type: 'variable-set',
      timestamp: entry.updatedAt,
      data: { key, value, version },
      source: options.owner,
    });
    
    // 通知订阅者
    if (options.notify !== false) {
      this.notifyVariableSubscribers(key, entry);
    }
    
    // 触发持久化
    this.schedulePersist();
    
    console.log(`[Blackboard:${this.instanceId}] Set variable: ${key} = ${JSON.stringify(value).slice(0, 100)}`);
    
    return entry;
  }

  /**
   * 获取变量
   */
  getVariable(key: string): BlackboardVariableEntry | undefined {
    return this.variables.get(key);
  }

  /**
   * 获取变量值
   */
  getVariableValue<T = unknown>(key: string): T | undefined {
    return this.variables.get(key)?.value as T | undefined;
  }

  /**
   * 批量设置变量
   */
  setVariables(
    variables: Record<string, unknown>,
    options: SetVariableOptions = {}
  ): void {
    for (const [key, value] of Object.entries(variables)) {
      this.setVariable(key, value, { ...options, notify: false });
    }
    
    // 统一通知一次
    this.emitEvent({
      type: 'variable-set',
      timestamp: new Date().toISOString(),
      data: { keys: Object.keys(variables), count: Object.keys(variables).length },
      source: options.owner,
    });
    
    // 触发持久化
    this.schedulePersist();
  }

  /**
   * 获取所有变量
   */
  getAllVariables(): BlackboardVariableEntry[] {
    return Array.from(this.variables.values());
  }

  /**
   * 删除变量
   */
  deleteVariable(key: string): boolean {
    const deleted = this.variables.delete(key);
    
    if (deleted) {
      this.emitEvent({
        type: 'variable-deleted',
        timestamp: new Date().toISOString(),
        data: { key },
      });
      
      this.schedulePersist();
    }
    
    return deleted;
  }

  /**
   * 订阅变量变更
   */
  subscribeVariable(
    key: string,
    callback: (entry: BlackboardVariableEntry) => void
  ): () => void {
    if (!this.variableSubscribers.has(key)) {
      this.variableSubscribers.set(key, new Set());
    }
    
    this.variableSubscribers.get(key)!.add(callback);
    
    return () => {
      this.variableSubscribers.get(key)?.delete(callback);
    };
  }

  /**
   * 通知变量订阅者
   */
  private notifyVariableSubscribers(key: string, entry: BlackboardVariableEntry): void {
    const subscribers = this.variableSubscribers.get(key);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(entry);
        } catch (error) {
          console.error(`[Blackboard:${this.instanceId}] Error in subscriber:`, error);
        }
      }
    }
  }

  // ========== 任务操作 ==========

  /**
   * 创建任务
   */
  createTask(task: Omit<BlackboardTask, 'id'>, id?: string): BlackboardTask {
    const taskId = id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    const newTask: BlackboardTask = {
      ...task,
      id: taskId,
      status: task.status ?? 'pending',
      attempts: task.attempts ?? 0,
    };
    
    this.tasks.set(taskId, newTask);
    
    this.emitEvent({
      type: 'task-created',
      timestamp: new Date().toISOString(),
      data: { taskId, status: newTask.status },
    });
    
    return newTask;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): BlackboardTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(
    taskId: string, 
    status: 'pending' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed' | 'waiting-human'
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    
    task.status = status;
    
    if (status === 'completed' || status === 'failed') {
      task.completedAt = new Date().toISOString();
    } else if (status === 'running') {
      task.startedAt = new Date().toISOString();
    }
    
    this.emitEvent({
      type: status === 'completed' ? 'task-completed' : 
            status === 'failed' ? 'task-failed' : 'task-updated',
      timestamp: new Date().toISOString(),
      data: { taskId, status },
    });
    
    return true;
  }

  // ========== Agent 状态操作 ==========

  /**
   * 更新 Agent 状态
   */
  updateAgentState(agentId: string, state: Partial<AgentState>): void {
    const existing = this.agentStates.get(agentId);
    
    const newState: AgentState = {
      agentId,
      status: state.status ?? existing?.status ?? 'idle',
      currentTask: state.currentTask ?? existing?.currentTask,
      currentTaskId: state.currentTaskId ?? existing?.currentTaskId,
      load: state.load ?? existing?.load ?? 0,
      workload: state.workload ?? existing?.workload ?? 0,
      lastHeartbeat: new Date().toISOString(),
    };
    
    this.agentStates.set(agentId, newState);
    
    this.emitEvent({
      type: 'agent-state-changed',
      timestamp: newState.lastHeartbeat,
      data: { agentId, status: newState.status },
    });
  }

  /**
   * 获取 Agent 状态
   */
  getAgentState(agentId: string): AgentState | undefined {
    return this.agentStates.get(agentId);
  }

  /**
   * 获取空闲 Agent
   */
  getIdleAgents(): string[] {
    return Array.from(this.agentStates.values())
      .filter(s => s.status === 'idle' && (s.workload ?? 0) < 0.3)
      .map(s => s.agentId);
  }

  // ========== 事件管理 ==========

  /**
   * 发送事件
   */
  emitEvent(event: BlackboardEvent): void {
    this.events.push(event);
    
    // 限制历史记录大小
    if (this.events.length > 1000) {
      this.events = this.events.slice(-500);
    }
    
    // 通知事件监听器
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[Blackboard:${this.instanceId}] Error in event listener:`, error);
      }
    }
  }

  /**
   * 订阅事件
   */
  subscribeEvent(callback: (event: BlackboardEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  /**
   * 广播消息
   */
  broadcast(type: string, data: unknown, source?: string): void {
    const event: BlackboardEvent = {
      type: 'broadcast',
      timestamp: new Date().toISOString(),
      data: { type, payload: data },
      source,
    };
    
    this.events.push(event);
    
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[Blackboard:${this.instanceId}] Error in broadcast listener:`, error);
      }
    }
  }

  // ========== 快照 ==========

  /**
   * 创建快照
   */
  createSnapshot(): BlackboardSnapshot {
    const snapshot: BlackboardSnapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: new Date().toISOString(),
      variables: Array.from(this.variables.values()).map(v => ({
        key: v.key,
        value: v.value,
      })),
      tasks: Array.from(this.tasks.values()),
    };
    
    this.snapshots.push(snapshot);
    
    // 限制快照数量
    if (this.snapshots.length > 10) {
      this.snapshots = this.snapshots.slice(-10);
    }
    
    return snapshot;
  }

  /**
   * 导出黑板数据
   */
  export(): {
    variables: Record<string, unknown>;
    tasks: BlackboardTask[];
  } {
    return {
      variables: Object.fromEntries(
        Array.from(this.variables.entries()).map(([k, v]) => [k, v.value])
      ),
      tasks: Array.from(this.tasks.values()),
    };
  }

  /**
   * 清空黑板
   */
  clear(): void {
    this.variables.clear();
    this.tasks.clear();
    this.agentStates.clear();
    this.events = [];
    this.snapshots = [];
    
    this.schedulePersist();
    
    console.log(`[Blackboard:${this.instanceId}] Cleared`);
  }

  /**
   * 销毁黑板（停止定时器）
   */
  destroy(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    this.clear();
    console.log(`[Blackboard:${this.instanceId}] Destroyed`);
  }

  /**
   * 获取黑板统计信息
   */
  getStats(): {
    variableCount: number;
    taskCount: number;
    agentCount: number;
    eventCount: number;
  } {
    return {
      variableCount: this.variables.size,
      taskCount: this.tasks.size,
      agentCount: this.agentStates.size,
      eventCount: this.events.length,
    };
  }
}