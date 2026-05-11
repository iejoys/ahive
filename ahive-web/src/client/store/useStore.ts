import { create } from 'zustand';
import type { 
  Agent, 
  Skill, 
  Task, 
  TabType, 
  Workflow, 
  WorkflowNode, 
  WorkflowEdge, 
  Review, 
  ReviewCondition,
  EdgeCondition,
  Position3D,
  Language,
  ScheduledTask,
  ScheduledTaskRun,
  Department,
} from '../types';
import { 
  taskScheduler, 
  executeScheduledTask, 
  loadScheduledTasksFromStorage, 
  saveScheduledTaskToStorage, 
  deleteScheduledTaskFromStorage, 
  addTaskRunToStorage, 
  toggleScheduledTaskInStorage, 
  loadAllTaskRunsFromStorage,
  // 黑板服务
  blackboard,
  templateRenderer,
  outputParser,
  // 工作流执行器 V2 - 已迁移到主进程，仅保留类型
  // WorkflowExecutorV2,
  // createWorkflowExecutor,
  // 工作流持久化
  saveWorkflowToStorage,
  loadWorkflowsFromStorage,
  deleteWorkflowFromStorage,
  // 黑板持久化（旧版兼容）
  loadBlackboardStateFromStorage,
  saveBlackboardStateToStorage,
  // 黑板持久化（V2 - 分文件存储）
  saveGlobalVariablesToStorage,
  loadGlobalVariablesFromStorage,
  saveWorkflowVariablesToStorage,
  loadWorkflowVariablesFromStorage,
  loadAllWorkflowVariablesFromStorage,
  // 工作流执行日志持久化
  saveWorkflowExecutionLogToStorage,
  // 部门持久化
  loadDepartmentsFromStorage,
  saveDepartmentsToStorage,
  saveDepartmentToStorage,
  deleteDepartmentFromStorage,
} from '../scheduler';
import type { VariableScope } from '../scheduler';
import type {
  ExecutionCallback,
  NodeExecutionRecord,
} from '../scheduler';

// ========== 配置黑板持久化 ==========

// 设置黑板变量变更时的持久化回调（V2 - 支持全局/工作流分离）
blackboard.setPersistCallback(async (variables, scope, workflowId) => {
  try {
    if (scope === 'global') {
      // 保存全局变量
      await saveGlobalVariablesToStorage(variables);
      console.log('[Blackboard] Persisted', variables.length, 'global variables');
    } else if (scope === 'workflow' && workflowId) {
      // 保存工作流变量
      await saveWorkflowVariablesToStorage(workflowId, variables);
      console.log('[Blackboard] Persisted', variables.length, 'workflow variables for', workflowId);
    }
  } catch (error) {
    console.error('[Blackboard] Failed to persist variables:', error);
  }
});

console.log('[Store] Blackboard persist callback configured (V2)');


// ========== 内部类型定义 ==========

/** 执行实例状态 */
interface ExecutionInstance {
  id: string;
  workflowId: string;
  currentNodeId: string;
  status: 'idle' | 'running' | 'paused' | 'waiting_review' | 'completed' | 'failed';
  taskData: Record<string, unknown>;
  executionPath: string[];
  reviewHistory: Review[];
  startedAt: string;
  completedAt?: string;
  error?: string;  // 错误信息
}

/** 未完成的工作流实例（从数据库） */
interface IncompleteInstance {
  instanceId: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'paused' | 'failed' | 'completed';
  startedAt: string;
  completedAt?: string;
  pausedAt?: string;
  currentNodeId: string;
  currentNodeName: string;
  updatedAt: string;
  projectId?: string;
  error?: string;
  triggeredBy?: string;
  executionPath?: string[];
  variables?: Record<string, unknown>;
  // 中断相关字段
  interruptReason?: string;
  interruptAt?: string;
  interruptStack?: string;
}

/** 节点执行状态 */
interface NodeExecutionState {
  nodeId: string;
  nodeName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  error?: string;
}

/** 实例详情（包括节点状态） */
interface InstanceDetails extends IncompleteInstance {
  nodeStates: NodeExecutionState[];
}

/** 智能体移动目标 */
interface MovementTarget {
  agentId: string;
  targetPosition: Position3D;
}

/** 智能体绕节点轨道状态 */
interface AgentOrbitState {
  agentId: string;
  nodeId: string;
  centerPosition: [number, number, number];
  radius: number;
  speed: number;
  angleOffset: number; // 初始角度偏移（让多个 Agent 分散）
  height: number; // 轨道高度
}

/** 对话消息 */
interface ChatMessage {
  id: string;
  agentId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ========== 工具函数 ==========

/** 评估审核条件 (兼容旧版 ReviewCondition) */
function evaluateCondition(condition: ReviewCondition | EdgeCondition, review: Review): boolean {
  // 检查是否为新的 EdgeCondition 格式
  if ('variableName' in condition) {
    // 新格式：基于黑板变量
    const value = blackboard.getVariableValue(condition.variableName);
    if (value === undefined) return false;
    
    const numValue = Number(value);
    const conditionValue = Number(condition.value);
    
    switch (condition.operator) {
      case 'gte': return numValue >= conditionValue;
      case 'gt':  return numValue > conditionValue;
      case 'eq':  return numValue === conditionValue;
      case 'lte': return numValue <= conditionValue;
      case 'lt':  return numValue < conditionValue;
      default:    return false;
    }
  }
  
  // 旧格式：ReviewCondition
  let actualValue = 0;
  
  if (condition.type === 'score') {
    actualValue = review.score || 0;
  } else if (condition.type === 'stars') {
    actualValue = review.stars || 0;
  } else {
    actualValue = review.score || 0;
  }
  
  switch (condition.operator) {
    case 'gte': return actualValue >= condition.threshold;
    case 'gt':  return actualValue > condition.threshold;
    case 'eq':  return actualValue === condition.threshold;
    case 'lte': return actualValue <= condition.threshold;
    case 'lt':  return actualValue < condition.threshold;
    default:    return false;
  }
}

// ========== 应用状态接口 ==========

interface AppState {
  // 数据
  agents: Agent[];
  skills: Skill[];
  tasks: Task[];
  workflows: Workflow[];
  departments: Department[];
  currentWorkflowId: string | null;
  reviews: Review[];
  // MCP 状态版本号（用于触发刷新）
  mcpStatusVersion: number;
  refreshMCPStatus: () => void;
  
  // UI 状态
  
  // UI 状态
  selectedAgentId: string | null;
  selectedSkillId: string | null;
  selectedWorkflowNodeId: string | null;
  activeTab: TabType;
  isLoading: boolean;
  language: Language;
  showSettingsPanel: boolean;

  // 执行状态
  executionInstance: ExecutionInstance | null;
  movementTarget: MovementTarget | null;
  chatMessages: Record<string, ChatMessage[]>;
  agentTypingStatus: Record<string, boolean>; // 每个智能体的等待状态
  
  // 工作流实例
  incompleteInstances: IncompleteInstance[];
  loadIncompleteInstances: () => Promise<void>;
  allInstances: IncompleteInstance[];
  loadAllInstances: () => Promise<void>;
  deleteInstance: (instanceId: string) => Promise<boolean>;
  deleteAllInstances: (workflowId: string) => Promise<boolean>;
  selectedInstanceDetails: InstanceDetails | null;
  loadInstanceDetails: (instanceId: string) => Promise<InstanceDetails | null>;
  
  // 工作流节点 3D 位置映射（用于 Agent 移动）
  workflowNodePositions: Record<string, [number, number, number]>;
  setWorkflowNodePositions: (positions: Record<string, [number, number, number]>) => void;
  
  // 工作流驱动的 Agent 移动记录（用于冲突处理和返回原位）
  workflowDrivenMovement: Record<string, { nodeId: string; originalPosition: { x: number; y: number; z: number } }>;
  setWorkflowDrivenMovement: (agentId: string, data: { nodeId: string; originalPosition: { x: number; y: number; z: number } } | null) => void;
  
  // Agent 绕节点轨道运动状态（工作执行中）
  agentOrbitState: Record<string, {
    nodeId: string;
    centerPosition: { x: number; y: number; z: number };
    radius: number;
    speed: number;
    angleOffset: number; // 初始角度偏移，让多个 Agent 错开
    tiltAngle: number; // 轨道倾斜角（弧度）
  }>;
  setAgentOrbitState: (agentId: string, data: {
    nodeId: string;
    centerPosition: { x: number; y: number; z: number };
    radius?: number;
    speed?: number;
    angleOffset?: number;
    tiltAngle?: number;
  } | null) => void;
  
  // 工作流实例详情对话框
  showInstanceDetailDialog: boolean;
  setShowInstanceDetailDialog: (show: boolean) => void;
  instanceDetailDialogInstanceId: string | null;
  setInstanceDetailDialogInstanceId: (instanceId: string | null) => void;
  instanceDetailDialogWorkflowId: string | null;
  setInstanceDetailDialogWorkflowId: (workflowId: string | null) => void;
  openInstanceDetailDialog: (instanceId: string, workflowId?: string) => void;
  
  // ========== 工作流启动检测状态（指挥官启动时使用） ==========
  workflowStartupCheckStatus: 'idle' | 'checking' | 'passed' | 'failed';
  workflowStartupCheckWorkflowId: string | null;
  workflowStartupCheckWorkflowName: string;
  workflowStartupCheckSteps: Array<{
    id: string;
    name: string;
    nameEn: string;
    status: 'pending' | 'checking' | 'success' | 'failed' | 'skipped' | 'warning';
    details: string[];
    error?: string;
    timestamp: number;
  }>;
  setWorkflowStartupCheckStatus: (status: 'idle' | 'checking' | 'passed' | 'failed', workflowId?: string | null, workflowName?: string) => void;
  setWorkflowStartupCheckSteps: (steps: Array<{
    id: string;
    name: string;
    nameEn: string;
    status: 'pending' | 'checking' | 'success' | 'failed' | 'skipped' | 'warning';
    details: string[];
    error?: string;
    timestamp: number;
  }>) => void;
  clearWorkflowStartupCheck: () => void;
  
  // 执行日志 (右侧面板显示)
  executionLogs: Array<{
    id: string;
    timestamp: number;
    agentId: string;
    agentName: string;
    type: 'tool_call' | 'tool_result' | 'message' | 'thinking' | 'error' | 'system' | 'agent_chat';
    content: string;
    details?: Record<string, any>;
  }>;
  addExecutionLog: (log: Omit<AppState['executionLogs'][0], 'id' | 'timestamp'>) => void;
  clearExecutionLogs: () => void;
  
  // 离线智能体状态
  offlineAgents: Set<string>;
  setOfflineAgents: (agentIds: string[]) => void;
  isAgentOffline: (agentId: string) => boolean;

  // ========== WebSocket 全局状态 ==========
  // WebSocket 连接状态
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  // 流式消息（正在输出的消息）
  streamingMessages: Record<string, {
    agentId: string;
    agentName: string;
    content: string;
    messageId: string;
  }>;
  updateStreamMessage: (agentId: string, delta: string, agentName?: string) => void;
  clearStreamMessage: (agentId: string) => void;

  // 内存监控数据
  memoryData: {
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    rssMB: number;
    heapUsedPercent: number;
    systemMemoryPercent: number;
  } | null;
  updateMemoryData: (data: any) => void;

  // 智能体对话消息（agent-chat）
  agentChatMessages: Array<{
    fromAgentId: string;
    fromAgentName: string;
    toAgentId: string;
    toAgentName: string;
    message: string;
    timestamp: number;
  }>;
  addAgentChatMessage: (data: {
    fromAgentId: string;
    fromAgentName?: string;
    toAgentId: string;
    toAgentName?: string;
    message: string;
  }) => void;

  
  // 聊天目标 (null = 全体广播)
  chatTargetId: string | null;
  
  // 定时任务
  scheduledTasks: ScheduledTask[];
  scheduledTaskRuns: Record<string, ScheduledTaskRun[]>;
  setScheduledTasks: (tasks: ScheduledTask[]) => void;
  
  // 黑板状态 (新增)
  blackboardVariables: Record<string, unknown>;
  setBlackboardVariable: (key: string, value: unknown) => void;
  getBlackboardVariable: (key: string) => unknown;
  clearBlackboard: () => void;

  setLanguage: (lang: Language) => void;

  // 智能体方法
  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgentPosition: (id: string, position: Position3D) => void;
  updateAgentStatus: (id: string, status: Agent['status']) => void;
  selectAgent: (id: string | null) => void;
  updateAgentSkills: (id: string, skills: string[]) => void;

  // 技能方法
  setSkills: (skills: Skill[]) => void;
  selectSkill: (id: string | null) => void;

  // 任务方法
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;

  // UI 方法
  setActiveTab: (tab: TabType) => void;
  setLoading: (loading: boolean) => void;
  setShowSettingsPanel: (show: boolean) => void;

  // 移动和对话
  setMovementTarget: (target: MovementTarget | null) => void;
  addChatMessage: (agentId: string, role: 'user' | 'assistant', content: string, messageId?: string) => void;
  updateChatMessage: (agentId: string, messageId: string, content: string) => void;
  clearChatMessages: (agentId: string) => void;
  setAgentTyping: (agentId: string, isTyping: boolean) => void;
  setChatTargetId: (id: string | null) => void;

  // 定时任务方法
  addScheduledTask: (task: ScheduledTask) => void;
  updateScheduledTask: (task: ScheduledTask) => void;
  deleteScheduledTask: (id: string) => void;
  toggleScheduledTask: (id: string, enabled: boolean) => void;
  addScheduledTaskRun: (run: ScheduledTaskRun) => void;
  updateScheduledTaskRun: (run: ScheduledTaskRun) => void;

  // 工作流方法
  setWorkflows: (workflows: Workflow[]) => void;
  addWorkflow: (workflow: Workflow) => void;
  updateWorkflow: (workflow: Workflow) => void;
  setCurrentWorkflow: (id: string | null) => void;
  selectWorkflowNode: (id: string | null) => void;
  addWorkflowNode: (node: WorkflowNode) => void;
  updateWorkflowNode: (node: WorkflowNode) => void;
  updateWorkflowNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  removeWorkflowNode: (nodeId: string) => void;
  addWorkflowEdge: (edge: WorkflowEdge) => void;
  updateWorkflowEdge: (edge: WorkflowEdge) => void;
  removeWorkflowEdge: (edgeId: string) => void;
  deleteWorkflow: (workflowId: string) => void;
  refreshWorkflows: () => Promise<void>;

  // 部门方法
  setDepartments: (departments: Department[]) => void;
  addDepartment: (department: Department) => void;
  updateDepartment: (department: Department) => void;
  deleteDepartment: (id: string) => void;

  // 审核方法
  addReview: (review: Review) => void;
  updateReview: (review: Review) => void;

  // ========== 启动检测界面全局状态 ==========
  // 用于 AHIVECORE 对话触发启动检测界面
  showStartupCheckDialog: boolean;
  pendingStartupWorkflowId: string | null;
  pendingStartupWorkflowName: string;
  setShowStartupCheckDialog: (show: boolean, workflowId?: string | null, workflowName?: string) => void;

  // 执行控制
  startExecution: (workflowId: string, initialData?: Record<string, unknown>) => void;
  pauseExecution: () => void;
  resumeExecution: () => void;
  submitReviewResult: (review: Review) => void;
  stopExecution: () => void;

  // ========== 智能体动画状态 ==========
  // 动画状态类型
  agentAnimationStates: Record<string, {
    state: 'idle' | 'working' | 'thinking' | 'talking' | 'walking' | 'celebrating' | 'error';
    action: string;
    expression: string;
    timestamp: number;
  }>;
  updateAgentAnimationState: (agentId: string, data: {
    state: 'idle' | 'working' | 'thinking' | 'talking' | 'walking' | 'celebrating' | 'error';
    action?: string;
    expression?: string;
  }) => void;
  clearAgentAnimationState: (agentId: string) => void;

  // ========== 任务拆解状态 ==========
  // 拆解状态类型
  decompositionStates: Record<string, {
    taskId: string;
    nodeId: string;
    proposalId?: string;
    status: 'assessing' | 'proposing' | 'reviewing' | 'approved' | 'rejected' | 'executing' | 'merged';
    subTasks?: Array<{
      id: string;
      name: string;
      agentType: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      progress: number;
    }>;
    createdAt: number;
    updatedAt: number;
  }>;
  updateDecompositionState: (taskId: string, data: {
    nodeId?: string;
    proposalId?: string;
    status?: 'assessing' | 'proposing' | 'reviewing' | 'approved' | 'rejected' | 'executing' | 'merged';
    subTasks?: Array<{
      id: string;
      name: string;
      agentType: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      progress: number;
    }>;
  }) => void;
  clearDecompositionState: (taskId: string) => void;
}

// ========== Store 实现 ==========

export const useStore = create<AppState>((set, get) => ({
  // 初始数据
  agents: [],
  skills: [],
  tasks: [],
  workflows: [],
  departments: [],
  currentWorkflowId: null,
  reviews: [],
  // MCP 状态版本号
  mcpStatusVersion: 0,
  
  selectedAgentId: null,
  selectedSkillId: null,
  selectedWorkflowNodeId: null,
  activeTab: 'world',
  isLoading: false,
  language: 'zh',
  showSettingsPanel: false,


  executionInstance: null,
  movementTarget: null,
  workflowNodePositions: {},
  workflowDrivenMovement: {},
  agentOrbitState: {},
  chatMessages: {},
  agentTypingStatus: {},
  
  // ========== 启动检测界面全局状态 ==========
  showStartupCheckDialog: false,
  pendingStartupWorkflowId: null,
  pendingStartupWorkflowName: '',
  setShowStartupCheckDialog: (show: boolean) => set({ showStartupCheckDialog: show }),
  setPendingStartupWorkflow: (workflowId: string | null, workflowName: string) => set({ 
    pendingStartupWorkflowId: workflowId, 
    pendingStartupWorkflowName: workflowName 
  }),
  triggerStartupCheck: (workflowId: string, workflowName: string) => set({
    showStartupCheckDialog: true,
    pendingStartupWorkflowId: workflowId,
    pendingStartupWorkflowName: workflowName,
  }),
  
  // ========== 工作流启动检测状态（指挥官启动时） ==========
  workflowStartupCheckStatus: 'idle' as 'idle' | 'checking' | 'success' | 'failed',
  workflowStartupCheckWorkflowId: null as string | null,
  workflowStartupCheckError: null as string | null,
  setWorkflowStartupCheckStatus: (status: 'idle' | 'checking' | 'success' | 'failed', workflowId?: string, error?: string) => set({
    workflowStartupCheckStatus: status,
    workflowStartupCheckWorkflowId: workflowId || null,
    workflowStartupCheckError: error || null,
  }),
  
  // 工作流实例
  incompleteInstances: [],
  loadIncompleteInstances: async () => {
    try {
      if (!window.electronAPI?.getIncompleteWorkflowInstances) {
        console.warn('[Store] getIncompleteWorkflowInstances not available');
        return;
      }
      const instances = await window.electronAPI.getIncompleteWorkflowInstances();
      set({ incompleteInstances: instances || [] });
    } catch (error) {
      console.error('[Store] Failed to load incomplete instances:', error);
    }
  },
  allInstances: [],
  loadAllInstances: async () => {
    try {
      if (!window.electronAPI?.getAllWorkflowInstances) {
        console.warn('[Store] getAllWorkflowInstances not available');
        return;
      }
      const instances = await window.electronAPI.getAllWorkflowInstances();
      set({ allInstances: instances || [] });
    } catch (error) {
      console.error('[Store] Failed to load all instances:', error);
    }
  },
  deleteInstance: async (instanceId: string) => {
    try {
      if (!window.electronAPI?.deleteWorkflowInstance) {
        console.warn('[Store] deleteWorkflowInstance not available');
        return false;
      }
      const result = await window.electronAPI.deleteWorkflowInstance(instanceId);
      if (result.success) {
        // 重新加载实例列表
        get().loadAllInstances();
        get().loadIncompleteInstances();
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Store] Failed to delete instance:', error);
      return false;
    }
  },
  deleteAllInstances: async (workflowId: string) => {
    try {
      if (!window.electronAPI?.deleteAllWorkflowInstances) {
        console.warn('[Store] deleteAllWorkflowInstances not available');
        return false;
      }
      const result = await window.electronAPI.deleteAllWorkflowInstances(workflowId);
      if (result.success) {
        // 重新加载实例列表
        get().loadAllInstances();
        get().loadIncompleteInstances();
        return true;
      }
      return false;
    } catch (error) {
      console.error('[Store] Failed to delete all instances:', error);
      return false;
    }
  },
  selectedInstanceDetails: null,
  loadInstanceDetails: async (instanceId: string) => {
    try {
      if (!window.electronAPI?.getWorkflowInstanceDetails) {
        console.warn('[Store] getWorkflowInstanceDetails not available');
        return null;
      }
      const details = await window.electronAPI.getWorkflowInstanceDetails(instanceId);
      set({ selectedInstanceDetails: details || null });
      return details || null;
    } catch (error) {
      console.error('[Store] Failed to load instance details:', error);
      return null;
    }
  },
  
  // 工作流实例详情对话框
  showInstanceDetailDialog: false,
  setShowInstanceDetailDialog: (show: boolean) => set({ showInstanceDetailDialog: show }),
  instanceDetailDialogInstanceId: null,
  setInstanceDetailDialogInstanceId: (instanceId: string | null) => set({ instanceDetailDialogInstanceId: instanceId }),
  instanceDetailDialogWorkflowId: null,
  setInstanceDetailDialogWorkflowId: (workflowId: string | null) => set({ instanceDetailDialogWorkflowId: workflowId }),
  openInstanceDetailDialog: (instanceId: string, workflowId?: string) => {
    set({
      showInstanceDetailDialog: true,
      instanceDetailDialogInstanceId: instanceId,
      instanceDetailDialogWorkflowId: workflowId || null,
    });
  },
  
  // 执行日志
  executionLogs: [],
  addExecutionLog: (log) => set((state) => ({
    executionLogs: [
      ...state.executionLogs.slice(-499), // 保留最近500条
      {
        ...log,
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
      }
    ]
  })),
  clearExecutionLogs: () => set({ executionLogs: [] }),
  
  // 离线智能体状态
  offlineAgents: new Set<string>(),
  setOfflineAgents: (agentIds) => set({ offlineAgents: new Set(agentIds) }),
  isAgentOffline: (agentId) => get().offlineAgents.has(agentId),

  // ========== WebSocket 全局状态 ==========
  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),

  streamingMessages: {},
  updateStreamMessage: (agentId, delta, agentName) => set((state) => {
    const existing = state.streamingMessages[agentId];
    // 确保 delta 是字符串，避免 undefined/null 导致的问题
    const safeDelta = typeof delta === 'string' ? delta : (delta?.toString() || '');
    return {
      streamingMessages: {
        ...state.streamingMessages,
        [agentId]: {
          agentId,
          agentName: agentName || existing?.agentName || agentId,
          content: (existing?.content || '') + safeDelta,
          messageId: existing?.messageId || `stream-${Date.now()}`,
        }
      }
    };
  }),
  clearStreamMessage: (agentId) => set((state) => {
    const { [agentId]: _, ...rest } = state.streamingMessages;
    return { streamingMessages: rest };
  }),

  memoryData: null,
  updateMemoryData: (data) => set({ memoryData: data }),

  agentChatMessages: [],
  addAgentChatMessage: (data) => set((state) => ({
    agentChatMessages: [
      ...state.agentChatMessages.slice(-99), // 保留最近100条
      {
        fromAgentId: data.fromAgentId,
        fromAgentName: data.fromAgentName || data.fromAgentId,
        toAgentId: data.toAgentId,
        toAgentName: data.toAgentName || data.toAgentId,
        message: data.message,
        timestamp: Date.now(),
      }
    ]
  })),

  chatTargetId: null,
  scheduledTasks: [],
  scheduledTaskRuns: {},
  // 黑板状态 (新增)
  blackboardVariables: {},
  // ========== 语言设置 ==========
  setLanguage: (lang) => set({ language: lang }),

  // ========== 智能体方法 ==========
  setAgents: (agents) => set({ agents }),
  
  addAgent: (agent) => set((state) => ({
    agents: [...state.agents, agent]
  })),
  
  updateAgentPosition: (id, position) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === id ? { ...agent, position } : agent
      ),
    })),
  
  updateAgentStatus: (id, status) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === id ? { ...agent, status } : agent
      ),
    })),
  
  selectAgent: (id) => set({ selectedAgentId: id, chatTargetId: id }),
  
  updateAgentSkills: async (id, skills) => {
    // 更新内存状态
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === id 
          ? { ...agent, equippedSkills: skills, updatedAt: new Date().toISOString() } 
          : agent
      ),
    }));
    
    // 持久化到本地存储（Electron 环境）
    if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) {
      try {
        await window.electronAPI?.updateAgentSkills?.(id, skills);
        console.log('[Store] Agent skills persisted:', id, skills);
      } catch (error) {
        console.error('[Store] Failed to persist agent skills:', error);
      }
    }
  },

  // ========== 技能方法 ==========
  setSkills: (skills) => set({ skills }),
  selectSkill: (id) => set({ selectedSkillId: id }),

  // ========== 任务方法 ==========
  setTasks: (tasks) => set({ tasks }),
  
  addTask: (task) => set((state) => ({
    tasks: [task, ...state.tasks]
  })),
  
  updateTask: (updatedTask) => set((state) => ({
    tasks: state.tasks.map((task) =>
      task.id === updatedTask.id ? updatedTask : task
    )
  })),

  // ========== UI 方法 ==========
  setActiveTab: (tab) => set({ activeTab: tab }),
  setLoading: (loading) => set({ isLoading: loading }),
  setShowSettingsPanel: (show) => set({ showSettingsPanel: show }),
  
  // ========== MCP 状态刷新 ==========
  refreshMCPStatus: () => set((state) => ({ 
    mcpStatusVersion: state.mcpStatusVersion + 1 
  })),
  
  // ========== 移动和对话 ==========
  setMovementTarget: (target) => set({ movementTarget: target }),
  
  addChatMessage: (agentId, role, content, messageId) =>
    set((state) => ({
      chatMessages: {
        ...state.chatMessages,
        [agentId]: [
          ...(state.chatMessages[agentId] || []),
          { id: messageId || `msg-${Date.now()}`, agentId, role, content, timestamp: new Date().toISOString() }
        ]
      }
    })),
  
  updateChatMessage: (agentId, messageId, content) =>
    set((state) => ({
      chatMessages: {
        ...state.chatMessages,
        [agentId]: (state.chatMessages[agentId] || []).map(msg =>
          msg.id === messageId ? { ...msg, content: typeof content === 'string' ? content : (content?.toString() || '') } : msg
        )
      }
    })),
  
  clearChatMessages: (agentId) =>
    set((state) => ({
      chatMessages: {
        ...state.chatMessages,
        [agentId]: []
      }
    })),
  
  setAgentTyping: (agentId, isTyping) =>
    set((state) => ({
      agentTypingStatus: {
        ...state.agentTypingStatus,
        [agentId]: isTyping
      }
    })),
  
  setChatTargetId: (id) => set({ chatTargetId: id, selectedAgentId: id }),

  // ========== 定时任务方法 ==========
  setScheduledTasks: (tasks) => set({ scheduledTasks: tasks }),
  
  addScheduledTask: (task) => set((state) => {
    // 调度任务
    taskScheduler.schedule(task, state.agents);
    // 同步到本地存储
    saveScheduledTaskToStorage(task);
    return {
      scheduledTasks: [...state.scheduledTasks, task]
    };
  }),

  updateScheduledTask: (task) => set((state) => {
    // 重新调度任务
    taskScheduler.schedule(task, state.agents);
    // 同步到本地存储
    saveScheduledTaskToStorage(task);
    return {
      scheduledTasks: state.scheduledTasks.map(t => t.id === task.id ? task : t)
    };
  }),
  
  deleteScheduledTask: (id) => set((state) => {
    // 取消调度
    taskScheduler.cancel(id);
    // 从本地存储删除
    deleteScheduledTaskFromStorage(id);
    return {
      scheduledTasks: state.scheduledTasks.filter(t => t.id !== id)
    };
  }),
  
  toggleScheduledTask: (id, enabled) => set((state) => {
    const task = state.scheduledTasks.find(t => t.id === id);
    if (task) {
      const updatedTask = { ...task, enabled };
      if (enabled) {
        taskScheduler.schedule(updatedTask, state.agents);
      } else {
        taskScheduler.cancel(id);
      }
      // 同步到本地存储（异步，但不阻塞 UI）
toggleScheduledTaskInStorage(id, enabled).catch(err => {
        console.error('[Store] Failed to sync toggle to storage:', err);
      });
    }
    return {
      scheduledTasks: state.scheduledTasks.map(t => t.id === id ? { ...t, enabled } : t)
    };
  }),
  
  addScheduledTaskRun: (run) => set((state) => {
    // 同步到本地存储
    addTaskRunToStorage(run);
    return {
      scheduledTaskRuns: {
        ...state.scheduledTaskRuns,
        [run.scheduledTaskId]: [...(state.scheduledTaskRuns[run.scheduledTaskId] || []), run]
      }
    };
  }),
  
  updateScheduledTaskRun: (run) => set((state) => {
    // 同步到本地存储
    addTaskRunToStorage(run);
    return {
      scheduledTaskRuns: {
        ...state.scheduledTaskRuns,
        [run.scheduledTaskId]: (state.scheduledTaskRuns[run.scheduledTaskId] || []).map(r => r.id === run.id ? run : r)
      }
    };
  }),

  setWorkflows: (workflows) => set({ workflows }),
  
  addWorkflow: (workflow) => {
    // 保存到本地存储
    saveWorkflowToStorage(workflow).catch(err => {
      console.error('[Store] Failed to save workflow:', err);
    });
    return set((state) => ({
      workflows: [...state.workflows, workflow]
    }));
  },
  
  updateWorkflow: (workflow) => {
    // 保存到本地存储
    saveWorkflowToStorage(workflow).catch(err => {
      console.error('[Store] Failed to update workflow:', err);
    });
    return set((state) => ({
      workflows: state.workflows.map(w => w.id === workflow.id ? workflow : w)
    }));
  },
  
  setCurrentWorkflow: (id) => {
    // 切换黑板的活动工作流
    blackboard.setActiveWorkflow(id);
    console.log('[Store] Switched blackboard to workflow:', id);
    return set({ currentWorkflowId: id });
  },
  selectWorkflowNode: (id) => set({ selectedWorkflowNodeId: id }),
  
  addWorkflowNode: (node) => set((state) => {
    const workflow = state.workflows.find(w => w.id === state.currentWorkflowId);
    if (!workflow) return state;
    
    const updatedWorkflows = state.workflows.map(w =>
      w.id === workflow.id
        ? { ...w, nodes: [...w.nodes, node], updatedAt: new Date().toISOString() }
        : w
    );
    
    // 保存到本地存储
    const updatedWorkflow = updatedWorkflows.find(w => w.id === workflow.id);
    if (updatedWorkflow) {
      saveWorkflowToStorage(updatedWorkflow).catch(err => {
        console.error('[Store] Failed to save workflow after adding node:', err);
      });
    }
    
    return { workflows: updatedWorkflows };
  }),
  
  updateWorkflowNode: (node) => set((state) => {
    const workflow = state.workflows.find(w => w.id === state.currentWorkflowId);
    if (!workflow) return state;
    
    const updatedWorkflows = state.workflows.map(w =>
      w.id === workflow.id
        ? { ...w, nodes: w.nodes.map(n => n.id === node.id ? node : n), updatedAt: new Date().toISOString() }
        : w
    );
    
    // 保存到本地存储
    const updatedWorkflow = updatedWorkflows.find(w => w.id === workflow.id);
    if (updatedWorkflow) {
      saveWorkflowToStorage(updatedWorkflow).catch(err => {
        console.error('[Store] Failed to save workflow after updating node:', err);
      });
    }
    
    return { workflows: updatedWorkflows };
  }),
  
  updateWorkflowNodePosition: (nodeId, position) => set((state) => {
    const workflow = state.workflows.find(w => w.id === state.currentWorkflowId);
    if (!workflow) return state;
    
    const updatedWorkflows = state.workflows.map(w =>
      w.id === workflow.id
        ? {
            ...w, 
            nodes: w.nodes.map(n => n.id === nodeId ? { ...n, position, updatedAt: new Date().toISOString() } : n),
            updatedAt: new Date().toISOString()
          }
        : w
    );
    
    // 保存到本地存储
    const updatedWorkflow = updatedWorkflows.find(w => w.id === workflow.id);
    if (updatedWorkflow) {
      saveWorkflowToStorage(updatedWorkflow).catch(err => {
        console.error('[Store] Failed to save workflow after updating node position:', err);
      });
    }
    
    return { workflows: updatedWorkflows };
  }),
  
  removeWorkflowNode: (nodeId: string) => set((state) => {
    const workflow = state.workflows.find(w => w.id === state.currentWorkflowId);
    if (!workflow) return state;
    
    const updatedWorkflows = state.workflows.map(w =>
      w.id === workflow.id
        ? {
            ...w,
            nodes: w.nodes.filter(n => n.id !== nodeId),
            edges: w.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
            updatedAt: new Date().toISOString()
          }
        : w
    );
    
    // 保存到本地存储
    const updatedWorkflow = updatedWorkflows.find(w => w.id === workflow.id);
    if (updatedWorkflow) {
      saveWorkflowToStorage(updatedWorkflow).catch(err => {
        console.error('[Store] Failed to save workflow after removing node:', err);
      });
    }
    
    return { workflows: updatedWorkflows };
  }),
  
  addWorkflowEdge: (edge) => set((state) => {
    const workflow = state.workflows.find(w => w.id === state.currentWorkflowId);
    if (!workflow) return state;
    
    const updatedWorkflows = state.workflows.map(w =>
      w.id === workflow.id
        ? { ...w, edges: [...w.edges, edge], updatedAt: new Date().toISOString() }
        : w
    );
    
    // 保存到本地存储
    const updatedWorkflow = updatedWorkflows.find(w => w.id === workflow.id);
    if (updatedWorkflow) {
      saveWorkflowToStorage(updatedWorkflow).catch(err => {
        console.error('[Store] Failed to save workflow after adding edge:', err);
      });
    }
    
    return { workflows: updatedWorkflows };
  }),
  
  updateWorkflowEdge: (edge: WorkflowEdge) => set((state) => {
    const workflow = state.workflows.find(w => w.id === state.currentWorkflowId);
    if (!workflow) return state;
    
    const updatedWorkflows = state.workflows.map(w =>
      w.id === workflow.id
        ? { ...w, edges: w.edges.map(e => e.id === edge.id ? edge : e), updatedAt: new Date().toISOString() }
        : w
    );
    
    // 保存到本地存储
    const updatedWorkflow = updatedWorkflows.find(w => w.id === workflow.id);
    if (updatedWorkflow) {
      saveWorkflowToStorage(updatedWorkflow).catch(err => {
        console.error('[Store] Failed to save workflow after updating edge:', err);
      });
    }
    
    return { workflows: updatedWorkflows };
  }),
  
  removeWorkflowEdge: (edgeId) => set((state) => {
    const workflow = state.workflows.find(w => w.id === state.currentWorkflowId);
    if (!workflow) return state;
    
    const updatedWorkflows = state.workflows.map(w =>
      w.id === workflow.id
        ? { ...w, edges: w.edges.filter(e => e.id !== edgeId), updatedAt: new Date().toISOString() }
        : w
    );
    
    // 保存到本地存储
    const updatedWorkflow = updatedWorkflows.find(w => w.id === workflow.id);
    if (updatedWorkflow) {
      saveWorkflowToStorage(updatedWorkflow).catch(err => {
        console.error('[Store] Failed to save workflow after removing edge:', err);
      });
    }
    
    return { workflows: updatedWorkflows };
  }),
  
  deleteWorkflow: (workflowId) => {
    // 从本地存储删除
    deleteWorkflowFromStorage(workflowId).catch(err => {
      console.error('[Store] Failed to delete workflow:', err);
    });
    return set((state) => {
      const newWorkflows = state.workflows.filter(w => w.id !== workflowId);
      // 如果删除的是当前工作流，重置当前工作流ID
      const newCurrentId = state.currentWorkflowId === workflowId 
        ? (newWorkflows[0]?.id || null) 
        : state.currentWorkflowId;
      return { 
        workflows: newWorkflows,
        currentWorkflowId: newCurrentId
      };
    });
  },

  // 刷新工作流列表（从本地存储重新加载）
  refreshWorkflows: async () => {
    const workflows = await loadWorkflowsFromStorage();
    set({ workflows });
    console.log('[Store] Refreshed workflows:', workflows.length);
  },

  // ========== 部门方法 ==========
  
  setDepartments: (departments) => {
    set({ departments });
    // 自动保存到本地存储
    saveDepartmentsToStorage(departments).catch(err => {
      console.error('[Store] Failed to save departments:', err);
    });
  },
  
  addDepartment: (department) => set((state) => ({
    departments: [...state.departments, department]
  })),
  
  updateDepartment: (department) => set((state) => ({
    departments: state.departments.map(d => d.id === department.id ? department : d)
  })),
  
  deleteDepartment: (id) => set((state) => ({
    departments: state.departments.filter(d => d.id !== id)
  })),

  // ========== 审核方法 ==========
  addReview: (review) => set((state) => ({
    reviews: [...state.reviews, review]
  })),
  
  updateReview: (review) => set((state) => ({
    reviews: state.reviews.map(r => r.id === review.id ? review : r)
  })),

  // ========== 执行控制 ==========
  startExecution: (workflowId: string, initialData?: Record<string, unknown>) => {
    const workflow = get().workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    // 找到起始节点
    const targetIds = new Set(workflow.edges.map(e => e.target));
    const startNode = workflow.nodes.find(n => !targetIds.has(n.id)) || workflow.nodes[0];

    const instance: ExecutionInstance = {
      id: `instance-${Date.now()}`,
      workflowId,
      currentNodeId: startNode?.id || '',
      status: 'running',
      taskData: initialData || {},
      executionPath: [startNode?.id || ''],
      reviewHistory: [],
      startedAt: new Date().toISOString(),
    };

    set({ executionInstance: instance });
  },
  
  pauseExecution: () => set((state) => ({
    executionInstance: state.executionInstance
      ? { ...state.executionInstance, status: 'paused' }
      : null
  })),
  
  resumeExecution: () => set((state) => {
    if (!state.executionInstance || state.executionInstance.status !== 'paused') {
      return state;
    }

    const workflow = state.workflows.find(w => w.id === state.executionInstance!.workflowId);
    if (!workflow) return state;

    // 找到下一节点
    const currentNodeId = state.executionInstance.currentNodeId;
    const outgoingEdges = workflow.edges.filter(e => e.source === currentNodeId);
    const nextEdge = outgoingEdges.find(e => !e.condition) || outgoingEdges[0];

    if (!nextEdge) {
      return {
        executionInstance: {
          ...state.executionInstance,
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      };
    }

    return {
      executionInstance: {
        ...state.executionInstance,
        status: 'running',
        currentNodeId: nextEdge.target,
        executionPath: [...state.executionInstance.executionPath, nextEdge.target],
      }
    };
  }),
  
  submitReviewResult: (review: Review) => set((state) => {
    if (!state.executionInstance) return state;

    const newHistory = [...state.executionInstance.reviewHistory, review];

    if (review.status === 'approved') {
      // 审核通过，找下一节点
      const workflow = state.workflows.find(w => w.id === state.executionInstance!.workflowId);
      if (!workflow) return state;

      const currentNodeId = state.executionInstance.currentNodeId;
      const outgoingEdges = workflow.edges.filter(e => e.source === currentNodeId);
      const nextEdge = outgoingEdges.find(e => !e.condition ||
        (e.condition && evaluateCondition(e.condition, review)));

      if (nextEdge) {
        return {
          executionInstance: {
            ...state.executionInstance,
            status: 'running',
            currentNodeId: nextEdge.target,
            executionPath: [...state.executionInstance.executionPath, nextEdge.target],
            reviewHistory: newHistory,
          }
        };
      }

      return {
        executionInstance: {
          ...state.executionInstance,
          status: 'completed',
          completedAt: new Date().toISOString(),
          reviewHistory: newHistory,
        }
      };
    } else {
      // 退回 - 找退回目标
      const workflow = state.workflows.find(w => w.id === state.executionInstance!.workflowId);
      if (!workflow) return state;

      const currentNodeId = state.executionInstance.currentNodeId;
      const currentEdge = workflow.edges.find(e => e.source === currentNodeId && e.condition);

      if (currentEdge?.conditionFailTarget) {
        return {
          executionInstance: {
            ...state.executionInstance,
            status: 'running',
            currentNodeId: currentEdge.conditionFailTarget,
            executionPath: [...state.executionInstance.executionPath, currentEdge.conditionFailTarget],
            reviewHistory: newHistory,
          }
        };
      }

      return {
        executionInstance: {
          ...state.executionInstance,
          status: 'failed',
          reviewHistory: newHistory,
        }
      };
    }
  }),
  
  stopExecution: () => set({ executionInstance: null }),

  // ========== 黑板方法 (新增) ==========
  
  setBlackboardVariable: (key, value) => set((state) => {
    // 更新本地状态
    const newVariables = { ...state.blackboardVariables, [key]: value };
    
    // 同步到黑板服务
    blackboard.setVariable(key, value, { owner: 'store' });
    
    return { blackboardVariables: newVariables };
  }),
  
  getBlackboardVariable: (key) => {
    return get().blackboardVariables[key];
  },
  
  clearBlackboard: () => set({
    blackboardVariables: {}
  }),

  // ========== 智能体动画状态方法 ==========
  
  agentAnimationStates: {},
  
  updateAgentAnimationState: (agentId, data) => set((state) => ({
    agentAnimationStates: {
      ...state.agentAnimationStates,
      [agentId]: {
        state: data.state,
        action: data.action || state.agentAnimationStates[agentId]?.action || 'idle',
        expression: data.expression || state.agentAnimationStates[agentId]?.expression || 'neutral',
        timestamp: Date.now(),
      },
    },
  })),
  
  clearAgentAnimationState: (agentId) => set((state) => {
    const { [agentId]: _, ...rest } = state.agentAnimationStates;
    return { agentAnimationStates: rest };
  }),

  // ========== 任务拆解状态 ==========

  decompositionStates: {},
  
  updateDecompositionState: (taskId, data) => set((state) => ({
    decompositionStates: {
      ...state.decompositionStates,
      [taskId]: {
        ...state.decompositionStates[taskId],
        ...data,
        updatedAt: Date.now(),
      },
    },
  })),
  
  clearDecompositionState: (taskId) => set((state) => {
    const { [taskId]: _, ...rest } = state.decompositionStates;
    return { decompositionStates: rest };
  }),
  
  clearAllDecompositionStates: () => set({ decompositionStates: {} }),

  // ========== 工作流 3D 节点位置 ==========
  setWorkflowNodePositions: (positions) => set({ workflowNodePositions: positions }),

  // ========== 工作流驱动的移动状态 ==========
  setWorkflowDrivenMovement: (agentId, data) => set((state) => {
    const newMovement = { ...state.workflowDrivenMovement };
    if (data === null) {
      delete newMovement[agentId];
    } else {
      newMovement[agentId] = data;
    }
    return { workflowDrivenMovement: newMovement };
  }),

  // ========== Agent 轨道运动状态 ==========
  setAgentOrbitState: (agentId, data) => set((state) => {
    if (data === null) {
      console.log('[Store] Clearing orbit state for:', agentId);
      const { [agentId]: _, ...rest } = state.agentOrbitState;
      return { agentOrbitState: rest };
    }
    console.log('[Store] Setting orbit state for:', agentId, data);
    return {
      agentOrbitState: {
        ...state.agentOrbitState,
        [agentId]: {
          nodeId: data.nodeId,
          centerPosition: data.centerPosition,
          radius: data.radius ?? 1.5,
          speed: data.speed ?? 0.8,
          angleOffset: data.angleOffset ?? 0,
          tiltAngle: data.tiltAngle ?? 0,
        },
      },
    };
  }),
}));

// ========== 初始化调度器 ==========

// 配置任务执行器
taskScheduler.setExecutor(async (task, agents) => {
  return executeScheduledTask(task, agents);
});

// 配置任务运行回调
taskScheduler.setOnTaskRun((run) => {
  const state = useStore.getState();
  state.addScheduledTaskRun(run);
});

// 配置任务更新回调
taskScheduler.setOnTaskUpdate((task) => {
  const state = useStore.getState();
  state.updateScheduledTask(task);
});

// ========== 从本地存储加载数据 ==========

export async function initializeDataFromStorage() {
  const tasks = await loadScheduledTasksFromStorage();
  const taskRuns = await loadAllTaskRunsFromStorage();
  
  const state = useStore.getState();
  
  // ========== 加载 Agents 技能 ==========
  if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) {
    try {
      const persistedAgents = await window.electronAPI?.getPersistedAgents?.();
      if (persistedAgents && persistedAgents.length > 0) {
        // 更新现有 agents 的技能
        const currentAgents = state.agents;
        if (currentAgents && currentAgents.length > 0) {
          const updatedAgents = currentAgents.map(agent => {
            // 支持多种 ID 格式匹配：完全匹配、name 匹配、agent-${name} 格式匹配
            const persisted = persistedAgents.find((p: any) => 
              p.id === agent.id || 
              p.id === `agent-${agent.name}` ||
              p.name === agent.name ||
              agent.id === `agent-${p.name}`
            );
            if (persisted && persisted.equippedSkills && persisted.equippedSkills.length > 0) {
              console.log(`[Store] Loading skills for agent ${agent.name}:`, persisted.equippedSkills);
              return { ...agent, equippedSkills: persisted.equippedSkills };
            }
            return agent;
          });
          state.setAgents(updatedAgents);
          console.log('[Store] Loaded agent skills from local storage:', persistedAgents.length, 'agents');
        } else {
          console.log('[Store] No current agents to update with skills');
        }
      }
    } catch (error) {
      console.error('[Store] Failed to load agent skills:', error);
    }
  }
  
  

  // 设置任务列表
  if (tasks.length > 0) {
    state.setScheduledTasks(tasks);
    
    // 重新调度所有启用的任务
    tasks.forEach(task => {
      if (task.enabled) {
        taskScheduler.schedule(task, state.agents);
      }
    });
    
    console.log('[Store] Loaded', tasks.length, 'tasks from local storage');
  }
  
  // 设置执行记录
  if (Object.keys(taskRuns).length > 0) {
    // 直接设置 scheduledTaskRuns
    useStore.setState({ scheduledTaskRuns: taskRuns });
    console.log('[Store] Loaded task runs from local storage:', Object.keys(taskRuns).length, 'tasks');
  }
  
  // ========== 工作流持久化 ==========
  
  // 加载工作流（只从本地存储加载）
  const workflows = await loadWorkflowsFromStorage();
  
  useStore.setState({ workflows });
  
  if (workflows.length > 0) {
    console.log('[Store] Loaded', workflows.length, 'workflows from local storage');
  }
  
  // 如果没有当前选中的工作流，且存在工作流，自动选中第一个
  const currentState = useStore.getState();
  if (!currentState.currentWorkflowId && currentState.workflows.length > 0) {
    useStore.setState({ currentWorkflowId: currentState.workflows[0].id });
    console.log('[Store] Auto-selected workflow:', currentState.workflows[0].name);
  }
  
  // 加载黑板状态
  const blackboardState = await loadBlackboardStateFromStorage();
  if (blackboardState && blackboardState.variables) {
    // 恢复黑板变量
    for (const entry of blackboardState.variables) {
      blackboard.setVariable(entry.key, entry.value, { 
        owner: entry.owner,
        type: entry.type 
      });
    }
    console.log('[Store] Loaded blackboard state from local storage:', blackboardState.variables.length, 'variables');
  }
  
  // 暂时禁用持久化（加载时不需要触发保存）
  const oldCallback = blackboard.setPersistCallback(null);
  
  // ========== 全局变量持久化 ==========
  
  // 加载全局变量
  const globalVariables = await loadGlobalVariablesFromStorage();
  if (globalVariables && globalVariables.length > 0) {
    // 恢复全局变量到黑板
    for (const entry of globalVariables) {
      blackboard.setGlobalVariable(entry.key, entry.value, {
        owner: entry.owner,
        type: entry.type,
        description: entry.description,
      });
    }
    console.log('[Store] Loaded global variables from local storage:', globalVariables.length, 'variables');
  }
  
  // ========== 工作流变量持久化 ==========
  
  // 加载所有工作流变量
  const allWorkflowVariables = await loadAllWorkflowVariablesFromStorage();
  if (allWorkflowVariables && Object.keys(allWorkflowVariables).length > 0) {
    // 恢复工作流变量到黑板
    for (const [workflowId, state] of Object.entries(allWorkflowVariables)) {
      const variables = (state as any).variables || [];
      for (const entry of variables) {
        blackboard.setWorkflowVariable(entry.key, entry.value, workflowId, {
          owner: entry.owner,
          type: entry.type,
          description: entry.description,
        });
      }
    }
    console.log('[Store] Loaded workflow variables from local storage:', Object.keys(allWorkflowVariables).length, 'workflows');
  }
  
  // 恢复持久化回调
  blackboard.setPersistCallback(oldCallback);
  
  // ========== 部门持久化 ==========
  
  // 加载部门数据
  const departments = await loadDepartmentsFromStorage();
  if (departments.length > 0) {
    useStore.setState({ departments });
    console.log('[Store] Loaded', departments.length, 'departments from local storage');
  }
  
  // 缓存部门到黑板（供工作流执行器使用）- 明确存储为全局变量
  if (departments.length > 0) {
    blackboard.setGlobalVariable('cached_departments', departments, { owner: 'system' });
  }
}

// 添加 setScheduledTasks 方法到 AppState 接口中已隐含定义
taskScheduler.setOnTaskUpdate((task) => {
  const state = useStore.getState();
  state.updateScheduledTask(task);
});

// ========== 工作流执行辅助函数 ==========

/** 当前执行实例 ID */
let currentInstanceId: string | null = null;

/**
 * 执行工作流
 * 
 * 注意：工作流执行已迁移到主进程 (WorkflowScheduler)
 * 前端只负责调用 IPC 和通过 WebSocket 订阅状态更新
 */
export async function executeWorkflow(
  workflowId: string,
  initialVariables?: Record<string, unknown>
): Promise<void> {
  const state = useStore.getState();
  const workflow = state.workflows.find(w => w.id === workflowId);
  
  if (!workflow) {
    console.error('[Store] Workflow not found:', workflowId);
    return;
  }
  
  // 检查是否在 Electron 环境
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.executeWorkflow) {
    console.error('[Store] Not in Electron environment or workflow API not available');
    return;
  }
  
  // 更新 UI 状态为执行中
  const targetIds = new Set(workflow.edges.map(e => e.target));
  const startNode = workflow.nodes.find(n => !targetIds.has(n.id)) || workflow.nodes[0];
  
  useStore.setState({
    executionInstance: {
      id: `instance-${Date.now()}`, // 临时 ID，会被实际 instanceId 替换
      workflowId,
      currentNodeId: startNode?.id || '',
      status: 'running',
      taskData: initialVariables || {},
      executionPath: [startNode?.id || ''],
      reviewHistory: [],
      startedAt: new Date().toISOString(),
    }
  });
  
  console.log('[Store] Starting workflow execution via IPC:', workflowId);
  
  try {
    // 调用主进程的工作流执行器
    const result = await electronAPI.executeWorkflow(workflowId, initialVariables);
    
    if (result.success && result.instanceId) {
      currentInstanceId = result.instanceId;
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, id: result.instanceId }
          : null
      }));
    } else {
      console.error('[Store] Failed to start workflow:', result.error);
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, status: 'failed' }
          : null
      }));
    }
  } catch (error) {
    console.error('[Store] Workflow execution error:', error);
    useStore.setState((state) => ({
      executionInstance: state.executionInstance
        ? { ...state.executionInstance, status: 'failed' }
        : null
    }));
  }
}

/**
 * 获取当前执行实例 ID
 */
export function getCurrentInstanceId(): string | null {
  return currentInstanceId;
}

/**
 * 暂停工作流执行
 */
export async function pauseWorkflowExecution(): Promise<void> {
  if (!currentInstanceId) {
    console.warn('[Store] No active workflow instance to pause');
    return;
  }
  
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.pauseWorkflow) {
    console.error('[Store] pauseWorkflow API not available');
    return;
  }
  
  console.log('[Store] Pausing workflow:', currentInstanceId);
  const success = await electronAPI.pauseWorkflow(currentInstanceId);
  
  if (success) {
    useStore.setState((state) => ({
      executionInstance: state.executionInstance
        ? { ...state.executionInstance, status: 'paused' }
        : null
    }));
  }
}

/**
 * 恢复工作流执行
 */
export async function resumeWorkflowExecution(): Promise<void> {
  if (!currentInstanceId) {
    console.warn('[Store] No active workflow instance to resume');
    return;
  }
  
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.resumeWorkflow) {
    console.error('[Store] resumeWorkflow API not available');
    return;
  }
  
  console.log('[Store] Resuming workflow:', currentInstanceId);
  const success = await electronAPI.resumeWorkflow(currentInstanceId);
  
  if (success) {
    useStore.setState((state) => ({
      executionInstance: state.executionInstance
        ? { ...state.executionInstance, status: 'running' }
        : null
    }));
  }
}

/**
 * 停止工作流执行
 */
export async function stopWorkflowExecution(): Promise<void> {
  if (!currentInstanceId) {
    console.warn('[Store] No active workflow instance to stop');
    return;
  }
  
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.stopWorkflow) {
    console.error('[Store] stopWorkflow API not available');
    return;
  }
  
  console.log('[Store] Stopping workflow:', currentInstanceId);
  const success = await electronAPI.stopWorkflow(currentInstanceId);
  
  if (success) {
    useStore.setState((state) => ({
      executionInstance: state.executionInstance
        ? { ...state.executionInstance, status: 'failed' }
        : null
    }));
    currentInstanceId = null;
  }
}

/**
 * 提交审核结果
 */
export async function submitWorkflowReview(
  nodeId: string,
  result: { score?: number; stars?: number; feedback?: string; approved: boolean }
): Promise<void> {
  if (!currentInstanceId) {
    console.warn('[Store] No active workflow instance to submit review');
    return;
  }
  
  const electronAPI = (window as any).electronAPI;
  if (!electronAPI?.submitWorkflowReview) {
    console.error('[Store] submitWorkflowReview API not available');
    return;
  }
  
  console.log('[Store] Submitting review for node:', nodeId);
  await electronAPI.submitWorkflowReview(currentInstanceId, nodeId, result);
}

/**
 * 节点开始时触发 Agent 移动和动画
 */
function handleNodeStartAnimation(nodeId: string, workflowId: string): void {
  const state = useStore.getState();
  const workflow = state.workflows.find(w => w.id === workflowId);
  if (!workflow) {
    console.warn('[Store] handleNodeStartAnimation: workflow not found', workflowId);
    return;
  }
  
  const node = workflow.nodes.find(n => n.id === nodeId);
  if (!node) {
    console.warn('[Store] handleNodeStartAnimation: node not found', nodeId);
    return;
  }
  
  // 获取该节点的执行 Agent
  const executorIds: string[] = [];
  if (node.config?.executor?.executors) {
    node.config.executor.executors.forEach((exec: { type: string; id: string }) => {
      if (exec.type === 'agent') executorIds.push(exec.id);
    });
  }
  if (node.agentId && !executorIds.includes(node.agentId)) {
    executorIds.push(node.agentId);
  }
  
  // 增强 ID 匹配：处理 a2a- 前缀和 agentId 字段
  const workingAgents = state.agents.filter(a => {
    // 直接匹配 id
    if (executorIds.includes(a.id)) return true;
    // 匹配 agentId 字段
    if (a.agentId && executorIds.includes(a.agentId)) return true;
    // 处理 a2a- 前缀：如果 executorId 是 a2a-xxx，匹配 agent.id 或 a.agentId
    for (const execId of executorIds) {
      if (execId.startsWith('a2a-') && (a.id === execId || a.agentId === execId.replace('a2a-', ''))) return true;
      if (a.id.startsWith('a2a-') && (a.id.replace('a2a-', '') === execId || a.agentId === execId)) return true;
    }
    return false;
  });
  
  // 如果没有找到执行 Agent，对于审核节点使用默认行为
  if (workingAgents.length === 0) {
    const isReviewNode = node.type === 'human' || node.type === 'review';
    if (isReviewNode) {
      console.log('[Store] Review node detected, using nearest idle agent for animation:', nodeId);
      // 审核节点：找一个空闲的智能体来展示动画
      const idleAgent = state.agents.find(a => a.status === 'idle' && a.id !== 'ahivecore');
      if (!idleAgent) {
        console.log('[Store] No idle agent available for review node animation');
        return;
      }
      workingAgents.push(idleAgent);
    } else {
      console.log('[Store] No working agents found for node:', nodeId, 'type:', node.type);
      return;
    }
  }
  
  // 获取节点 3D 位置 - 优先从 store 获取，如果不存在则动态计算
  let nodePos = state.workflowNodePositions[nodeId];
  if (!nodePos) {
    console.warn('[Store] Node position not in store, computing dynamically:', nodeId);
    // 动态计算位置：根据节点在 workflow 中的位置计算
    const allTaskNodes = workflow.nodes.filter(n => n.type !== 'milestone');
    const nodeIndex = allTaskNodes.findIndex(n => n.id === nodeId);
    if (nodeIndex >= 0) {
      const radius = 4;
      const count = allTaskNodes.length;
      const angle = (nodeIndex / count) * Math.PI * 2 - Math.PI / 2;
      nodePos = [
        Math.cos(angle) * radius,
        0.5,
        Math.sin(angle) * radius,
      ];
      console.log('[Store] Computed position for node:', nodeId, nodePos);
    } else {
      // 最后的回退方案
      nodePos = [0, 0.5, 0];
    }
  }
  
  const centerPosition = { x: nodePos[0], y: nodePos[1], z: nodePos[2] };
  
  workingAgents.forEach((agent, index) => {
    // 记录原始位置（用于返回）
    state.setWorkflowDrivenMovement(agent.id, {
      nodeId,
      originalPosition: { ...agent.position }
    });
    
    // 设置绕圈轨道参数 - 多个 Agent 错开角度
    const orbitRadius = 1.5 + index * 0.5; // 每个 Agent 轨道半径递增
    const orbitSpeed = 0.5 + Math.random() * 0.3; // 随机速度增加变化
    const orbitPhase = (index / Math.max(workingAgents.length, 1)) * Math.PI * 2; // 错开起始角度
    
    const orbitData = {
      nodeId,
      centerPosition,
      radius: orbitRadius,
      speed: orbitSpeed,
      angleOffset: orbitPhase,
      tiltAngle: 0,
    };
    
    // 同时为 agent.id 和 agent.agentId 设置轨道状态（确保 AgentCharacter 能匹配）
    state.setAgentOrbitState(agent.id, orbitData);
    if (agent.agentId && agent.agentId !== agent.id) {
      state.setAgentOrbitState(agent.agentId, orbitData);
    }
    
    // 设置工作动画 - 同时更新两种 key
    state.updateAgentAnimationState(agent.id, {
      state: 'working',
      action: 'welding',
      expression: 'focused'
    });
    if (agent.agentId && agent.agentId !== agent.id) {
      state.updateAgentAnimationState(agent.agentId, {
        state: 'working',
        action: 'welding',
        expression: 'focused'
      });
    }
  });
  
  console.log('[Store] Agents orbiting node:', nodeId, workingAgents.map(a => a.name).join(', '));
}

/**
 * 节点完成时触发 Agent 动画切换
 */
function handleNodeCompleteAnimation(nodeId: string, workflowId: string): void {
  const state = useStore.getState();
  const workflow = state.workflows.find(w => w.id === workflowId);
  if (!workflow) return;
  
  const node = workflow.nodes.find(n => n.id === nodeId);
  if (!node) return;
  
  // 获取该节点的执行 Agent
  const executorIds: string[] = [];
  if (node.config?.executor?.executors) {
    node.config.executor.executors.forEach((exec: { type: string; id: string }) => {
      if (exec.type === 'agent') executorIds.push(exec.id);
    });
  }
  if (node.agentId && !executorIds.includes(node.agentId)) {
    executorIds.push(node.agentId);
  }
  
  const workingAgents = state.agents.filter(a => 
    executorIds.includes(a.id) || executorIds.includes(a.agentId || '')
  );
  
  workingAgents.forEach(agent => {
    // 清除轨道状态
    state.setAgentOrbitState(agent.id, null);
    
    // 先庆祝，然后回到空闲
    state.updateAgentAnimationState(agent.id, {
      state: 'celebrating',
      action: 'complete',
      expression: 'happy'
    });
    
    // 2秒后回到空闲状态
    setTimeout(() => {
      state.updateAgentAnimationState(agent.id, {
        state: 'idle',
        action: 'idle',
        expression: 'neutral'
      });
      
      // 清除工作流移动标记
      state.setWorkflowDrivenMovement(agent.id, null);
    }, 2000);
  });
  
  console.log('[Store] Agents completed node:', nodeId);
}

/**
 * 处理工作流 WebSocket 事件
 * 由 AgentWorld 或其他组件调用
 */
export function handleWorkflowEvent(event: any): void {
  console.log('[Store] Workflow event received:', event.type);
  
  switch (event.type) {
    case 'workflow-started':
      // 工作流已启动 - 创建 executionInstance
      useStore.setState({
        executionInstance: {
          id: event.instanceId || `exec-${Date.now()}`,
          workflowId: event.workflowId,
          currentNodeId: '',
          status: 'running',
          taskData: {},
          executionPath: [],
          reviewHistory: [],
          startedAt: new Date().toISOString(),
        }
      });
      console.log('[Store] Workflow started, executionInstance created');
      break;
      
    case 'workflow-completed':
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, status: 'completed' }
          : null,
        blackboardVariables: event.data?.variables || {},
      }));
      break;
      
    case 'workflow-node-start':
      // 节点开始 - 更新状态
      useStore.setState((state) => {
        const existingPath = state.executionInstance?.executionPath || [];
        // 去重：如果节点已在 executionPath 中，不再重复添加
        const executionPath = existingPath.includes(event.nodeId)
          ? existingPath
          : [...existingPath, event.nodeId];
        
        return {
          executionInstance: state.executionInstance
            ? {
                ...state.executionInstance,
                currentNodeId: event.nodeId,
                status: 'running',
                executionPath
              }
            : {
                // 如果 executionInstance 不存在，创建一个
                id: event.instanceId || `exec-${Date.now()}`,
                workflowId: event.workflowId,
                currentNodeId: event.nodeId,
                status: 'running',
                taskData: {},
                executionPath: [event.nodeId],
                reviewHistory: [],
                startedAt: new Date().toISOString(),
              }
        };
      });
      console.log('[Store] Node started:', event.nodeId, 'status: running');
      
      // 触发 Agent 移动到节点位置 + 设置工作动画
      // 后端事件可能不包含 workflowId，从 store 回退获取
      const wfId = event.workflowId || useStore.getState().currentWorkflowId || useStore.getState().executionInstance?.workflowId;
      handleNodeStartAnimation(event.nodeId, wfId || '');
      break;
      
    case 'workflow-error':
      console.error('[Store] Workflow error:', event.data?.error);
      console.error('[Store] Workflow error details:', {
        workflowId: event.workflowId,
        workflowName: event.workflowName,
        instanceId: event.instanceId,
        stack: event.stack,
      });
      
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, status: 'failed', error: event.data?.error }
          : null
      }));
      currentInstanceId = null;
      break;
      
    case 'workflow-node-complete':
      // 节点完成 - 更新状态
      useStore.setState((state) => {
        return {
          executionInstance: state.executionInstance
            ? {
                ...state.executionInstance,
                // 节点完成后清空 currentNodeId，等待下一个节点开始时设置
                // 这样可以确保 milestones 的状态计算正确
                currentNodeId: '',
              }
            : null
        };
      });
      console.log('[Store] Node completed:', event.nodeId);
      
      // 回退获取 workflowId（state 在回调外不可用，重新获取）
      const currentState = useStore.getState();
      const completeWorkflowId = event.workflowId || currentState.executionInstance?.workflowId || currentState.currentWorkflowId;
      
      // 触发 Agent 庆祝动画 + 返回原位
      handleNodeCompleteAnimation(event.nodeId, completeWorkflowId);
      break;
      
    case 'workflow-node-error':
      console.error('[Store] Node error:', event.nodeId, event.data?.error);
      break;
      
    case 'workflow-variable-set':
      // 变量设置
      if (event.data?.key && event.data?.value !== undefined) {
        useStore.setState((state) => ({
          blackboardVariables: {
            ...state.blackboardVariables,
            [event.data.key]: event.data.value
          }
        }));
      }
      break;
      
    case 'workflow-paused':
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, status: 'paused' }
          : null
      }));
      break;
      
    case 'workflow-resumed':
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, status: 'running' }
          : null
      }));
      break;
      
    case 'workflow-stopped':
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, status: 'failed' }
          : null
      }));
      currentInstanceId = null;
      break;
      
    case 'workflow-waiting-review':
      // 等待审核
      useStore.setState((state) => ({
        executionInstance: state.executionInstance
          ? { ...state.executionInstance, status: 'waiting_review' }
          : null
      }));
      break;
      
    // ========== 拆解状态事件 ==========
    
    case 'workflow_decomposition_status':
      // 拆解状态变更
      const decompData = event.data;
      useStore.setState((state) => ({
        decompositionStates: {
          ...state.decompositionStates,
          [decompData.taskId]: {
            taskId: decompData.taskId,
            nodeId: decompData.nodeId,
            proposalId: decompData.proposalId,
            status: decompData.status,
            subTasks: decompData.subTasks || [],
            timestamp: Date.now(),
          },
        },
      }));
      console.log('[Store] Decomposition status updated:', decompData.taskId, decompData.status);
      break;
      
    case 'workflow_proposal_review':
      // 拆解审批结果
      const reviewData = event.data;
      useStore.setState((state) => {
        const existingState = state.decompositionStates[reviewData.proposalId];
        if (!existingState) return state;
        
        return {
          decompositionStates: {
            ...state.decompositionStates,
            [reviewData.proposalId]: {
              ...existingState,
              status: reviewData.status === 'APPROVED' ? 'approved' : 'rejected',
              reviewNotes: reviewData.notes,
              authorizedSubAgents: reviewData.authorizedSubAgents,
              rejectionReason: reviewData.reason,
              suggestions: reviewData.suggestions,
              timestamp: Date.now(),
            },
          },
        };
      });
      console.log('[Store] Proposal review received:', reviewData.proposalId, reviewData.status);
      break;
      
    case 'workflow_sub_task_start':
      // 子任务开始
      const subTaskStartData = event.data;
      useStore.setState((state) => {
        const parentState = state.decompositionStates[subTaskStartData.parentTaskId];
        if (!parentState) return state;
        
        const updatedSubTasks = parentState.subTasks.map(st =>
          st.id === subTaskStartData.subTaskId
            ? { ...st, status: 'running', agentId: subTaskStartData.agentId }
            : st
        );
        
        return {
          decompositionStates: {
            ...state.decompositionStates,
            [subTaskStartData.parentTaskId]: {
              ...parentState,
              subTasks: updatedSubTasks,
              status: 'executing',
            },
          },
        };
      });
      console.log('[Store] Sub-task started:', subTaskStartData.subTaskId);
      break;
      
    case 'workflow_sub_task_complete':
      // 子任务完成
      const subTaskCompleteData = event.data;
      useStore.setState((state) => {
        const parentState = state.decompositionStates[subTaskCompleteData.parentTaskId];
        if (!parentState) return state;
        
        const updatedSubTasks = parentState.subTasks.map(st =>
          st.id === subTaskCompleteData.subTaskId
            ? { 
                ...st, 
                status: subTaskCompleteData.status,
                outputs: subTaskCompleteData.outputs,
                error: subTaskCompleteData.error,
              }
            : st
        );
        
        // 检查是否所有子任务都完成
        const allCompleted = updatedSubTasks.every(st => 
          st.status === 'completed' || st.status === 'failed'
        );
        
        return {
          decompositionStates: {
            ...state.decompositionStates,
            [subTaskCompleteData.parentTaskId]: {
              ...parentState,
              subTasks: updatedSubTasks,
              status: allCompleted ? 'merged' : 'executing',
            },
          },
        };
      });
      console.log('[Store] Sub-task completed:', subTaskCompleteData.subTaskId, subTaskCompleteData.status);
      break;
      
    case 'workflow_merge_report':
      // 合并汇报
      const mergeData = event.data;
      useStore.setState((state) => {
        const parentState = state.decompositionStates[mergeData.taskId];
        if (!parentState) return state;
        
        return {
          decompositionStates: {
            ...state.decompositionStates,
            [mergeData.taskId]: {
              ...parentState,
              status: 'merged',
              mergeResult: mergeData.mergeResult,
              mergedOutputs: mergeData.outputs,
              timestamp: Date.now(),
            },
          },
        };
      });
      console.log('[Store] Merge completed:', mergeData.taskId);
      break;
  }
}

// 导出刷新工作流方法
export const refreshWorkflows = async (): Promise<void> => {
  const workflows = await loadWorkflowsFromStorage();
  useStore.getState().setWorkflows(workflows);
  console.log('[Store] Refreshed workflows:', workflows.length);
};

taskScheduler.setOnTaskUpdate((task) => {
  const state = useStore.getState();
  state.updateScheduledTask(task);
});
