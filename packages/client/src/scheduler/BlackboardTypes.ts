/**
 * 共享黑板类型定义 V2
 * 支持全局变量和工作流变量隔离
 */

// ========== 变量空间类型 ==========

/** 变量空间标识 */
export type VariableScope = 'global' | 'workflow';

// ========== 变量条目 ==========

export interface VariableEntry {
  /** 变量键名 */
  key: string;
  /** 变量值 */
  value: unknown;
  /** 可见性类型 */
  type: 'public' | 'protected' | 'private';
  /** 创建该变量的 Agent/节点 */
  owner?: string;
  /** 版本号，支持追溯 */
  version: number;
  /** 最后更新时间 */
  updatedAt: string;
  /** 订阅者列表 */
  subscribers: string[];
  /** 描述信息 */
  description?: string;
  
  // ========== V2 新增字段 ==========
  
  /** 变量空间（全局/工作流） */
  scope: VariableScope;
  /** 工作流ID（仅 workflow 变量） */
  workflowId?: string;
  /** 是否来自执行实例（实时同步） */
  fromExecution?: boolean;
  /** 执行实例ID */
  instanceId?: string;
}

// ========== 任务状态 ==========

export type TaskStatus = 
  | 'pending'      // 等待分配
  | 'assigned'     // 已分配
  | 'running'      // 执行中
  | 'blocked'      // 被阻塞（等待依赖）
  | 'completed'    // 完成
  | 'failed'       // 失败
  | 'waiting-human'; // 等待人工

// ========== 黑板任务 ==========

export interface BlackboardTask {
  /** 任务 ID */
  id: string;
  /** 所属工作流/意图 */
  parentIntentId?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 分配给的 Agent ID */
  assignee: string | null;
  /** 优先级 */
  priority: number;
  
  // 输入输出
  /** 输入数据 */
  inputs: Record<string, unknown>;
  /** 输出数据 */
  outputs: Record<string, unknown>;
  
  // 依赖关系
  /** 依赖的任务 ID */
  dependencies: string[];
  
  // 时间戳
  /** 创建时间 */
  createdAt: string;
  /** 开始时间 */
  startedAt?: string;
  /** 完成时间 */
  completedAt?: string;
  
  // 元数据
  /** 任务类型 */
  type?: string;
  /** 描述 */
  description?: string;
  /** 标签 */
  tags?: string[];
  /** 尝试次数 */
  attempts?: number;
}

// ========== Agent 状态 ==========

export interface AgentState {
  /** Agent ID */
  agentId: string;
  /** 状态 */
  status: 'idle' | 'working' | 'paused' | 'error';
  /** 当前任务 */
  currentTask?: string;
  /** 当前任务 ID */
  currentTaskId?: string;
  /** 负载 (0-1) */
  load: number;
  /** 工作负载 */
  workload?: number;
  /** 技能列表 */
  skills?: string[];
  /** 统计信息 */
  stats?: {
    tasksCompleted?: number;
    tasksFailed?: number;
    averageDuration?: number;
  };
  /** 最后心跳 */
  lastHeartbeat: string;
  /** 自定义状态数据 */
  customState?: Record<string, unknown>;
}

// ========== 工件 ==========

export interface Artifact {
  /** 工件 ID */
  id: string;
  /** 类型 */
  type: 'file' | 'code' | 'document' | 'data' | 'other';
  /** 名称 */
  name: string;
  /** 内容或路径 */
  content?: string;
  path?: string;
  /** 创建者 */
  createdBy: string;
  /** 创建时间 */
  createdAt: string;
  /** 版本 */
  version: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ========== 黑板配置 ==========

export interface BlackboardConfig {
  /** 最大变量数 */
  maxVariables?: number;
  /** 最大任务数 */
  maxTasks?: number;
  /** 变量历史记录限制 */
  variableHistoryLimit?: number;
  /** 是否启用持久化 */
  persistEnabled?: boolean;
  /** 持久化间隔 (ms) */
  persistInterval?: number;
  /** 是否支持工作流隔离（V2） */
  workflowIsolation?: boolean;
}

// ========== 黑板事件 ==========

export type BlackboardEventType = 
  | 'variable-set'
  | 'variable-deleted'
  | 'task-created'
  | 'task-updated'
  | 'task-completed'
  | 'task-failed'
  | 'agent-state-changed'
  | 'broadcast'
  | 'workflow-switched'      // V2 新增：工作流切换
  | 'execution-sync';       // V2 新增：执行实例同步

export interface BlackboardEvent {
  type: BlackboardEventType;
  timestamp: string;
  data: unknown;
  source?: string;
}

// ========== 订阅回调 ==========

export type VariableSubscribeCallback = (entry: VariableEntry) => void;
export type TaskSubscribeCallback = (task: BlackboardTask) => void;
export type EventCallback = (event: BlackboardEvent) => void;

// ========== 导出选项 ==========

export interface SetVariableOptions {
  /** 所有者 */
  owner?: string;
  /** 可见性类型 */
  type?: 'public' | 'protected' | 'private';
  /** 描述 */
  description?: string;
  /** 是否通知订阅者 */
  notify?: boolean;
  
  // ========== V2 新增选项 ==========
  
  /** 变量空间 */
  scope?: VariableScope;
  /** 工作流ID */
  workflowId?: string;
}

// ========== 快照 ==========

export interface BlackboardSnapshot {
  id: string;
  timestamp: string;
  variables: Array<{
    key: string;
    value: unknown;
  }>;
  tasks: BlackboardTask[];
  agentStates: AgentState[];
}

// ========== 文件引用类型 ==========

/** 文件引用 */
export interface FileReference {
  /** 文件路径 */
  path: string;
  /** 文件类型 */
  type: 'document' | 'code' | 'design' | 'data' | 'report' | 'other';
  /** 描述 */
  description?: string;
  /** 创建时间 */
  createdAt?: string;
  /** 创建者 */
  createdBy?: string;
}

/** 带文件引用的变量值 */
export interface VariableValueWithFileRef {
  /** 值 */
  value: unknown;
  /** 文件引用 */
  fileRef?: FileReference;
}

// ========== V2 新增：工作流变量同步事件 ==========

/** 工作流变量同步事件（WebSocket） */
export interface WorkflowVariableSyncEvent {
  type: 'workflow-variable-sync';
  instanceId: string;
  workflowId: string;
  variables: VariableEntry[];
  timestamp: string;
}

/** 全局变量变更事件（WebSocket） */
export interface GlobalVariableChangeEvent {
  type: 'global-variable-change';
  key: string;
  value: unknown;
  action: 'set' | 'delete';
}

// ========== V2 新增：黑板统计信息 ==========

export interface BlackboardStats {
  /** 全局变量数量 */
  globalVariableCount: number;
  /** 当前工作流变量数量 */
  workflowVariableCount: number;
  /** 工作流数量 */
  workflowCount: number;
  /** 任务数量 */
  taskCount: number;
  /** Agent数量 */
  agentCount: number;
  /** 产物数量 */
  artifactCount: number;
  /** 事件数量 */
  eventCount: number;
  /** 当前活动工作流ID */
  activeWorkflowId: string | null;
  /** 当前活动执行实例ID */
  activeInstanceId: string | null;
}