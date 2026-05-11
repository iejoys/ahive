/**
 * 共享黑板服务 V2
 * 支持全局变量和工作流变量隔离
 * 
 * 核心功能：
 * 1. 全局变量 - 所有工作流共享
 * 2. 工作流变量 - 按 workflowId 隔离
 * 3. 工作流切换 - 自动切换显示的变量
 * 4. 执行同步 - 接收主进程实时变量
 * 5. 持久化 - 分离存储全局和工作流变量
 */

import type {
  VariableEntry,
  BlackboardTask,
  AgentState,
  Artifact,
  TaskStatus,
  SetVariableOptions,
  VariableSubscribeCallback,
  TaskSubscribeCallback,
  EventCallback,
  BlackboardEvent,
  BlackboardConfig,
  BlackboardSnapshot,
  FileReference,
  VariableScope,
  WorkflowVariableSyncEvent,
} from './BlackboardTypes';

/** 持久化回调函数类型 */
export type PersistCallback = (
  variables: VariableEntry[],
  scope: VariableScope,
  workflowId?: string
) => void | Promise<void>;

/**
 * 共享黑板服务类 V2
 * 
 * 支持全局变量和工作流变量隔离
 */
export class BlackboardService {
  // ========== 存储空间 ==========
  
  /** 全局变量（所有工作流共享） */
  private globalVariables: Map<string, VariableEntry> = new Map();
  
  /** 工作流变量（按 workflowId 隔离） */
  private workflowVariables: Map<string, Map<string, VariableEntry>> = new Map();
  
  /** 任务存储 */
  private tasks: Map<string, BlackboardTask> = new Map();
  
  /** Agent 状态存储 */
  private agentStates: Map<string, AgentState> = new Map();
  
  /** 产物存储 */
  private artifacts: Map<string, Artifact> = new Map();
  
  // ========== 状态管理 ==========
  
  /** 当前活动工作流ID */
  private activeWorkflowId: string | null = null;
  
  /** 当前执行实例ID（用于接收实时同步） */
  private activeInstanceId: string | null = null;
  
  // ========== 订阅管理 ==========
  
  private globalVariableSubscribers: Map<string, Set<VariableSubscribeCallback>> = new Map();
  private workflowVariableSubscribers: Map<string, Map<string, Set<VariableSubscribeCallback>>> = new Map();
  private taskSubscribers: Map<string, Set<TaskSubscribeCallback>> = new Map();
  private eventListeners: Set<EventCallback> = new Set();
  
  // ========== 配置 ==========
  
  private config: Required<BlackboardConfig>;
  
  // ========== 历史记录 ==========
  
  private events: BlackboardEvent[] = [];
  private snapshots: BlackboardSnapshot[] = [];
  
  // ========== 持久化 ==========
  
  private persistCallback: PersistCallback | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private pendingPersist = false;
  private pendingWorkflowPersists: Map<string, boolean> = new Map();

  constructor(config: BlackboardConfig = {}) {
    this.config = {
      maxVariables: config.maxVariables ?? 1000,
      maxTasks: config.maxTasks ?? 100,
      variableHistoryLimit: config.variableHistoryLimit ?? 10,
      persistEnabled: config.persistEnabled ?? false,
      persistInterval: config.persistInterval ?? 5000,
      workflowIsolation: config.workflowIsolation ?? true,
    };
    
    // 如果启用持久化，启动定时保存
    if (this.config.persistEnabled) {
      this.startPersistTimer();
    }
    
    console.log('[BlackboardV2] Initialized with workflow isolation support');
  }
  
  // ========== 持久化方法 ==========
  
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
      this.doPersistAll();
    }, this.config.persistInterval);
  }
  
  /**
   * 立即触发持久化（防抖）
   */
  private schedulePersist(scope: VariableScope, workflowId?: string): void {
    if (!this.persistCallback) return;
    
    if (scope === 'global') {
      if (this.pendingPersist) return;
      this.pendingPersist = true;
      
      setTimeout(() => {
        this.doPersistGlobal();
        this.pendingPersist = false;
      }, 100);
    } else if (scope === 'workflow' && workflowId) {
      if (this.pendingWorkflowPersists.get(workflowId)) return;
      this.pendingWorkflowPersists.set(workflowId, true);
      
      setTimeout(() => {
        this.doPersistWorkflow(workflowId);
        this.pendingWorkflowPersists.delete(workflowId);
      }, 100);
    }
  }
  
  /**
   * 执行全局变量持久化
   */
  private async doPersistGlobal(): Promise<void> {
    if (!this.persistCallback) return;
    
    try {
      const variables = this.getAllGlobalVariables();
      await this.persistCallback(variables, 'global');
    } catch (error) {
      console.error('[BlackboardV2] Global persist error:', error);
    }
  }
  
  /**
   * 执行工作流变量持久化
   */
  private async doPersistWorkflow(workflowId: string): Promise<void> {
    if (!this.persistCallback) return;
    
    try {
      const variables = this.getWorkflowVariables(workflowId);
      await this.persistCallback(variables, 'workflow', workflowId);
    } catch (error) {
      console.error(`[BlackboardV2] Workflow ${workflowId} persist error:`, error);
    }
  }
  
  /**
   * 执行所有持久化
   */
  private async doPersistAll(): Promise<void> {
    await this.doPersistGlobal();
    
    // 持久化所有工作流变量
    for (const workflowId of this.workflowVariables.keys()) {
      await this.doPersistWorkflow(workflowId);
    }
  }

  // ========== 全局变量操作 ==========

  /**
   * 设置全局变量
   */
  setGlobalVariable(
    key: string,
    value: unknown,
    options: SetVariableOptions = {}
  ): VariableEntry {
    const existing = this.globalVariables.get(key);
    const version = existing ? existing.version + 1 : 1;
    
    const entry: VariableEntry = {
      key,
      value,
      type: options.type ?? 'public',
      owner: options.owner,
      scope: 'global',
      version,
      updatedAt: new Date().toISOString(),
      subscribers: existing?.subscribers ?? [],
      description: options.description,
    };
    
    this.globalVariables.set(key, entry);
    
    // 记录事件
    this.emitEvent({
      type: 'variable-set',
      timestamp: entry.updatedAt,
      data: { key, value, version, scope: 'global' },
      source: options.owner,
    });
    
    // 通知订阅者
    if (options.notify !== false) {
      this.notifyGlobalVariableSubscribers(key, entry);
    }
    
    // 触发持久化
    this.schedulePersist('global');
    
    console.log(`[BlackboardV2] Set global variable: ${key}`);
    
    return entry;
  }

  /**
   * 获取全局变量
   */
  getGlobalVariable(key: string): VariableEntry | undefined {
    return this.globalVariables.get(key);
  }

  /**
   * 获取全局变量值
   */
  getGlobalVariableValue<T = unknown>(key: string): T | undefined {
    return this.globalVariables.get(key)?.value as T | undefined;
  }

  /**
   * 删除全局变量
   */
  deleteGlobalVariable(key: string): boolean {
    const deleted = this.globalVariables.delete(key);
    
    if (deleted) {
      this.emitEvent({
        type: 'variable-deleted',
        timestamp: new Date().toISOString(),
        data: { key, scope: 'global' },
      });
      
      this.schedulePersist('global');
    }
    
    return deleted;
  }

  /**
   * 获取所有全局变量
   */
  getAllGlobalVariables(): VariableEntry[] {
    return Array.from(this.globalVariables.values());
  }

  /**
   * 通知全局变量订阅者
   */
  private notifyGlobalVariableSubscribers(key: string, entry: VariableEntry): void {
    const subscribers = this.globalVariableSubscribers.get(key);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(entry);
        } catch (error) {
          console.error('[BlackboardV2] Error in global variable subscriber:', error);
        }
      }
    }
  }

  /**
   * 订阅全局变量变更
   */
  subscribeGlobalVariable(
    key: string,
    callback: VariableSubscribeCallback
  ): () => void {
    if (!this.globalVariableSubscribers.has(key)) {
      this.globalVariableSubscribers.set(key, new Set());
    }
    
    this.globalVariableSubscribers.get(key)!.add(callback);
    
    return () => {
      this.globalVariableSubscribers.get(key)?.delete(callback);
    };
  }

  // ========== 工作流变量操作 ==========

  /**
   * 获取工作流变量存储空间
   */
  private getWorkflowVariableMap(workflowId: string): Map<string, VariableEntry> {
    if (!this.workflowVariables.has(workflowId)) {
      this.workflowVariables.set(workflowId, new Map());
    }
    return this.workflowVariables.get(workflowId)!;
  }

  /**
   * 设置工作流变量
   * @param workflowId 工作流ID，默认使用当前活动工作流
   */
  setWorkflowVariable(
    key: string,
    value: unknown,
    workflowId?: string,
    options: SetVariableOptions = {}
  ): VariableEntry {
    const targetWorkflowId = workflowId ?? this.activeWorkflowId;
    
    if (!targetWorkflowId) {
      console.warn('[BlackboardV2] No active workflow, setting as global variable');
      return this.setGlobalVariable(key, value, options);
    }
    
    const variableMap = this.getWorkflowVariableMap(targetWorkflowId);
    const existing = variableMap.get(key);
    const version = existing ? existing.version + 1 : 1;
    
    const entry: VariableEntry = {
      key,
      value,
      type: options.type ?? 'public',
      owner: options.owner,
      scope: 'workflow',
      workflowId: targetWorkflowId,
      version,
      updatedAt: new Date().toISOString(),
      subscribers: existing?.subscribers ?? [],
      description: options.description,
    };
    
    variableMap.set(key, entry);
    
    // 记录事件
    this.emitEvent({
      type: 'variable-set',
      timestamp: entry.updatedAt,
      data: { key, value, version, scope: 'workflow', workflowId: targetWorkflowId },
      source: options.owner,
    });
    
    // 通知订阅者
    if (options.notify !== false) {
      this.notifyWorkflowVariableSubscribers(targetWorkflowId, key, entry);
    }
    
    // 触发持久化
    this.schedulePersist('workflow', targetWorkflowId);
    
    console.log(`[BlackboardV2] Set workflow variable: ${key} (workflow: ${targetWorkflowId})`);
    
    return entry;
  }

  /**
   * 获取工作流变量
   * @param workflowId 工作流ID，默认使用当前活动工作流
   */
  getWorkflowVariable(key: string, workflowId?: string): VariableEntry | undefined {
    const targetWorkflowId = workflowId ?? this.activeWorkflowId;
    
    if (!targetWorkflowId) {
      return undefined;
    }
    
    return this.workflowVariables.get(targetWorkflowId)?.get(key);
  }

  /**
   * 获取工作流变量值
   */
  getWorkflowVariableValue<T = unknown>(key: string, workflowId?: string): T | undefined {
    const entry = this.getWorkflowVariable(key, workflowId);
    return entry?.value as T | undefined;
  }

  /**
   * 删除工作流变量
   */
  deleteWorkflowVariable(key: string, workflowId?: string): boolean {
    const targetWorkflowId = workflowId ?? this.activeWorkflowId;
    
    if (!targetWorkflowId) {
      return false;
    }
    
    const variableMap = this.workflowVariables.get(targetWorkflowId);
    if (!variableMap) {
      return false;
    }
    
    const deleted = variableMap.delete(key);
    
    if (deleted) {
      this.emitEvent({
        type: 'variable-deleted',
        timestamp: new Date().toISOString(),
        data: { key, scope: 'workflow', workflowId: targetWorkflowId },
      });
      
      this.schedulePersist('workflow', targetWorkflowId);
    }
    
    return deleted;
  }

  /**
   * 获取指定工作流的所有变量
   */
  getWorkflowVariables(workflowId?: string): VariableEntry[] {
    const targetWorkflowId = workflowId ?? this.activeWorkflowId;
    
    if (!targetWorkflowId) {
      return [];
    }
    
    const variableMap = this.workflowVariables.get(targetWorkflowId);
    return variableMap ? Array.from(variableMap.values()) : [];
  }

  /**
   * 清空工作流变量（保留全局变量）
   */
  clearWorkflowVariables(workflowId?: string): void {
    const targetWorkflowId = workflowId ?? this.activeWorkflowId;
    
    if (!targetWorkflowId) {
      return;
    }
    
    const variableMap = this.workflowVariables.get(targetWorkflowId);
    if (variableMap) {
      variableMap.clear();
      this.schedulePersist('workflow', targetWorkflowId);
      console.log(`[BlackboardV2] Cleared workflow variables: ${targetWorkflowId}`);
    }
  }

  /**
   * 通知工作流变量订阅者
   */
  private notifyWorkflowVariableSubscribers(workflowId: string, key: string, entry: VariableEntry): void {
    const workflowSubscribers = this.workflowVariableSubscribers.get(workflowId);
    if (!workflowSubscribers) return;
    
    const subscribers = workflowSubscribers.get(key);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(entry);
        } catch (error) {
          console.error('[BlackboardV2] Error in workflow variable subscriber:', error);
        }
      }
    }
  }

  /**
   * 订阅工作流变量变更
   */
  subscribeWorkflowVariable(
    key: string,
    callback: VariableSubscribeCallback,
    workflowId?: string
  ): () => void {
    const targetWorkflowId = workflowId ?? this.activeWorkflowId;
    
    if (!targetWorkflowId) {
      return () => {};
    }
    
    if (!this.workflowVariableSubscribers.has(targetWorkflowId)) {
      this.workflowVariableSubscribers.set(targetWorkflowId, new Map());
    }
    
    const workflowSubscribers = this.workflowVariableSubscribers.get(targetWorkflowId)!;
    if (!workflowSubscribers.has(key)) {
      workflowSubscribers.set(key, new Set());
    }
    
    workflowSubscribers.get(key)!.add(callback);
    
    return () => {
      workflowSubscribers.get(key)?.delete(callback);
    };
  }

  // ========== 工作流切换 ==========

  /**
   * 切换活动工作流
   * 自动切换黑板面板显示的变量
   */
  setActiveWorkflow(workflowId: string | null): void {
    const previousWorkflowId = this.activeWorkflowId;
    this.activeWorkflowId = workflowId;
    
    // 发出工作流切换事件
    this.emitEvent({
      type: 'workflow-switched',
      timestamp: new Date().toISOString(),
      data: {
        previousWorkflowId,
        currentWorkflowId: workflowId,
      },
    });
    
    console.log(`[BlackboardV2] Switched active workflow: ${previousWorkflowId} -> ${workflowId}`);
  }

  /**
   * 获取当前活动工作流ID
   */
  getActiveWorkflowId(): string | null {
    return this.activeWorkflowId;
  }

  /**
   * 设置活动执行实例ID
   */
  setActiveInstanceId(instanceId: string | null): void {
    this.activeInstanceId = instanceId;
    console.log(`[BlackboardV2] Set active instance: ${instanceId}`);
  }

  /**
   * 获取活动执行实例ID
   */
  getActiveInstanceId(): string | null {
    return this.activeInstanceId;
  }

  // ========== 兼容旧 API ==========

  /**
   * 设置变量（自动判断空间）
   * 如果有活动工作流 → 设置工作流变量
   * 如果没有活动工作流 → 设置全局变量
   */
  setVariable(
    key: string,
    value: unknown,
    options: SetVariableOptions = {}
  ): VariableEntry {
    if (this.activeWorkflowId) {
      return this.setWorkflowVariable(key, value, this.activeWorkflowId, options);
    } else {
      return this.setGlobalVariable(key, value, options);
    }
  }

  /**
   * 获取变量（自动判断空间）
   * 优先查找工作流变量，再查找全局变量
   */
  getVariable(key: string): VariableEntry | undefined {
    // 优先查找工作流变量
    if (this.activeWorkflowId) {
      const workflowVar = this.getWorkflowVariable(key, this.activeWorkflowId);
      if (workflowVar) {
        return workflowVar;
      }
    }
    
    // 再查找全局变量
    return this.getGlobalVariable(key);
  }

  /**
   * 获取变量值
   */
  getVariableValue<T = unknown>(key: string): T | undefined {
    const entry = this.getVariable(key);
    return entry?.value as T | undefined;
  }

  /**
   * 获取所有变量（兼容旧 API）
   * 返回当前工作流变量 + 全局变量（合并）
   */
  getAllVariables(): VariableEntry[] {
    const result: VariableEntry[] = [];
    
    // 添加当前工作流变量
    if (this.activeWorkflowId) {
      result.push(...this.getWorkflowVariables(this.activeWorkflowId));
    }
    
    // 添加全局变量
    result.push(...this.getAllGlobalVariables());
    
    return result;
  }

  /**
   * 删除变量（自动判断空间）
   */
  deleteVariable(key: string): boolean {
    // 先尝试删除工作流变量
    if (this.activeWorkflowId) {
      const deleted = this.deleteWorkflowVariable(key, this.activeWorkflowId);
      if (deleted) {
        return true;
      }
    }
    
    // 再尝试删除全局变量
    return this.deleteGlobalVariable(key);
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
    if (this.activeWorkflowId) {
      this.schedulePersist('workflow', this.activeWorkflowId);
    } else {
      this.schedulePersist('global');
    }
  }

  /**
   * 订阅变量变更（兼容旧 API）
   */
  subscribeVariable(
    key: string,
    callback: VariableSubscribeCallback
  ): () => void {
    // 同时订阅全局和工作流变量
    const unsubGlobal = this.subscribeGlobalVariable(key, callback);
    const unsubWorkflow = this.subscribeWorkflowVariable(key, callback);
    
    return () => {
      unsubGlobal();
      unsubWorkflow();
    };
  }

  // ========== 执行同步 ==========

  /**
   * 接收执行实例变量同步
   * 从主进程 WebSocket 接收实时变量
   */
  syncFromExecution(instanceId: string, variables: VariableEntry[]): void {
    // 检查是否是当前活动实例
    if (instanceId !== this.activeInstanceId) {
      console.log(`[BlackboardV2] Ignoring sync from non-active instance: ${instanceId}`);
      return;
    }
    
    // 找到对应的 workflowId
    const workflowId = this.activeWorkflowId;
    if (!workflowId) {
      console.warn('[BlackboardV2] No active workflow for execution sync');
      return;
    }
    
    const variableMap = this.getWorkflowVariableMap(workflowId);
    
    // 更新变量
    for (const entry of variables) {
      const existing = variableMap.get(entry.key);
      const version = existing ? existing.version + 1 : 1;
      
      const newEntry: VariableEntry = {
        ...entry,
        scope: 'workflow',
        workflowId,
        version,
        updatedAt: new Date().toISOString(),
        fromExecution: true,
        instanceId,
      };
      
      variableMap.set(entry.key, newEntry);
    }
    
    // 发出同步事件
    this.emitEvent({
      type: 'execution-sync',
      timestamp: new Date().toISOString(),
      data: {
        instanceId,
        workflowId,
        variableCount: variables.length,
      },
    });
    
    console.log(`[BlackboardV2] Synced ${variables.length} variables from execution: ${instanceId}`);
  }

  // ========== 文件引用变量 ==========

  /**
   * 设置文件引用变量
   */
  setFileVariable(
    key: string,
    fileRef: FileReference,
    options: SetVariableOptions = {}
  ): VariableEntry {
    const value = {
      path: fileRef.path,
      type: fileRef.type,
      description: fileRef.description,
    };
    
    const entry = this.setVariable(key, value, {
      ...options,
      type: options.type ?? 'public',
      description: options.description ?? fileRef.description,
    });
    
    // 存储文件引用元数据
    (entry as any).fileRef = fileRef;
    
    console.log(`[BlackboardV2] Set file variable: ${key} = ${fileRef.path}`);
    
    return entry;
  }

  /**
   * 获取文件引用变量
   */
  getFileVariable(key: string): FileReference | undefined {
    const entry = this.getVariable(key);
    if (entry && typeof entry.value === 'object' && entry.value !== null && 'path' in entry.value) {
      return {
        path: (entry.value as any).path,
        type: (entry.value as any).type || 'other',
        description: (entry.value as any).description,
        createdAt: entry.updatedAt,
        createdBy: entry.owner,
      };
    }
    return undefined;
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
    
    console.log(`[BlackboardV2] Created task: ${taskId}`);
    
    return newTask;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): BlackboardTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 认领任务
   */
  claimTask(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') {
      return false;
    }
    
    task.status = 'assigned';
    task.assignee = agentId;
    
    this.emitEvent({
      type: 'task-updated',
      timestamp: new Date().toISOString(),
      data: { taskId, status: 'assigned', assignee: agentId },
    });
    
    console.log(`[BlackboardV2] Task ${taskId} claimed by ${agentId}`);
    
    return true;
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId: string, status: TaskStatus): boolean {
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

  /**
   * 订阅任务变更
   */
  subscribeTask(
    taskId: string,
    callback: TaskSubscribeCallback
  ): () => void {
    if (!this.taskSubscribers.has(taskId)) {
      this.taskSubscribers.set(taskId, new Set());
    }
    
    this.taskSubscribers.get(taskId)!.add(callback);
    
    return () => {
      this.taskSubscribers.get(taskId)?.delete(callback);
    };
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
      skills: state.skills ?? existing?.skills ?? [],
      stats: state.stats ?? existing?.stats ?? {
        tasksCompleted: 0,
        tasksFailed: 0,
        averageDuration: 0,
      },
      customState: state.customState ?? existing?.customState,
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
   * 获取 Agent 工作负载
   */
  getAgentWorkload(agentId: string): number {
    return this.agentStates.get(agentId)?.workload ?? 0;
  }

  /**
   * 获取空闲 Agent
   */
  getIdleAgents(): string[] {
    return Array.from(this.agentStates.values())
      .filter(s => s.status === 'idle' && (s.workload ?? 0) < 0.3)
      .map(s => s.agentId);
  }

  // ========== 产物管理 ==========

  /**
   * 添加产物
   */
  addArtifact(artifact: Omit<Artifact, 'id' | 'createdAt' | 'version'>): Artifact {
    const newArtifact: Artifact = {
      ...artifact,
      id: `artifact-${Date.now()}`,
      createdAt: new Date().toISOString(),
      version: 1,
    };
    
    this.artifacts.set(newArtifact.id, newArtifact);
    return newArtifact;
  }

  /**
   * 获取产物
   */
  getArtifact(artifactId: string): Artifact | undefined {
    return this.artifacts.get(artifactId);
  }

  // ========== 事件管理 ==========

  /**
   * 发送事件 (公开方法，供外部使用)
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
        console.error('[BlackboardV2] Error in event listener:', error);
      }
    }
  }

  /**
   * 订阅事件
   */
  subscribeEvent(callback: EventCallback): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  // ========== 广播机制 ==========

  /**
   * 广播消息给所有订阅者
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
        console.error('[BlackboardV2] Error in broadcast listener:', error);
      }
    }
    
    console.log(`[BlackboardV2] Broadcast: ${type}`, data);
  }

  /**
   * 订阅特定类型的广播消息
   */
  subscribeBroadcast(messageType: string, callback: (data: unknown, source?: string) => void): () => void {
    const wrappedCallback: EventCallback = (event) => {
      if (event.type === 'broadcast') {
        const broadcastData = event.data as { type: string; payload: unknown };
        if (broadcastData.type === messageType) {
          callback(broadcastData.payload, event.source);
        }
      }
    };
    
    this.eventListeners.add(wrappedCallback);
    return () => {
      this.eventListeners.delete(wrappedCallback);
    };
  }

  /**
   * 订阅所有广播消息
   */
  subscribeAllBroadcasts(callback: (type: string, data: unknown, source?: string) => void): () => void {
    const wrappedCallback: EventCallback = (event) => {
      if (event.type === 'broadcast') {
        const broadcastData = event.data as { type: string; payload: unknown };
        callback(broadcastData.type, broadcastData.payload, event.source);
      }
    };
    
    this.eventListeners.add(wrappedCallback);
    return () => {
      this.eventListeners.delete(wrappedCallback);
    };
  }

  /**
   * 获取事件历史
   */
  getEventHistory(limit?: number): BlackboardEvent[] {
    const events = this.events;
    return limit ? events.slice(-limit) : [...events];
  }

  // ========== 快照 ==========

  /**
   * 创建快照
   */
  createSnapshot(): BlackboardSnapshot {
    const snapshot: BlackboardSnapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: new Date().toISOString(),
      variables: this.getAllVariables().map(v => ({
        key: v.key,
        value: v.value,
      })),
      tasks: Array.from(this.tasks.values()),
      agentStates: Array.from(this.agentStates.values()),
    };
    
    this.snapshots.push(snapshot);
    
    // 限制快照数量
    if (this.snapshots.length > this.config.variableHistoryLimit) {
      this.snapshots = this.snapshots.slice(-this.config.variableHistoryLimit);
    }
    
    return snapshot;
  }

  // ========== 导出 ==========

  /**
   * 导出黑板数据
   */
  export(): {
    global: Record<string, unknown>;
    workflows: Map<string, Record<string, unknown>>;
    variables: Record<string, unknown>;
    tasks: BlackboardTask[];
    agentStates: AgentState[];
  } {
    // 导出全局变量
    const global = Object.fromEntries(
      Array.from(this.globalVariables.entries()).map(([k, v]) => [k, v.value])
    );
    
    // 导出所有工作流变量
    const workflows = new Map<string, Record<string, unknown>>();
    for (const [workflowId, variableMap] of this.workflowVariables) {
      workflows.set(workflowId, Object.fromEntries(
        Array.from(variableMap.entries()).map(([k, v]) => [k, v.value])
      ));
    }
    
    // 兼容旧 API 的 variables 字段
    const variables = Object.fromEntries(
      this.getAllVariables().map(v => [v.key, v.value])
    );
    
    return {
      global,
      workflows,
      variables,
      tasks: Array.from(this.tasks.values()),
      agentStates: Array.from(this.agentStates.values()),
    };
  }

  /**
   * 清空黑板
   */
  clear(): void {
    this.globalVariables.clear();
    this.workflowVariables.clear();
    this.tasks.clear();
    this.agentStates.clear();
    this.artifacts.clear();
    this.events = [];
    this.snapshots = [];
    this.activeWorkflowId = null;
    this.activeInstanceId = null;
    
    // 触发持久化
    this.schedulePersist('global');
    
    console.log('[BlackboardV2] Cleared all data');
  }

  /**
   * 获取黑板统计信息
   */
  getStats(): {
    globalVariableCount: number;
    workflowVariableCount: number;
    workflowCount: number;
    activeWorkflowId: string | null;
    activeInstanceId: string | null;
    taskCount: number;
    agentCount: number;
    artifactCount: number;
    eventCount: number;
  } {
    // 计算所有工作流变量总数
    let workflowVariableCount = 0;
    for (const variableMap of this.workflowVariables.values()) {
      workflowVariableCount += variableMap.size;
    }
    
    return {
      globalVariableCount: this.globalVariables.size,
      workflowVariableCount,
      workflowCount: this.workflowVariables.size,
      activeWorkflowId: this.activeWorkflowId,
      activeInstanceId: this.activeInstanceId,
      taskCount: this.tasks.size,
      agentCount: this.agentStates.size,
      artifactCount: this.artifacts.size,
      eventCount: this.events.length,
    };
  }
}

// ========== 默认实例 ==========

export const blackboard = new BlackboardService();