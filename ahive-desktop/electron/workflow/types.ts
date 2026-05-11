/**
 * 工作流类型定义
 * 从 ahive-1.0/packages/client/src/types/index.ts 迁移并整理
 */

// ========== Agent 类型 ==========

export interface Agent {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'working' | 'paused' | 'error' | 'offline';
  avatar: string;
  agentId?: string;    // 真实的智能体 ID (用于 AHIVECORE 等系统)
  agentType?: string;
  group?: string;
  customUrl?: string;
  skills: string[];
  type: 'opencode' | 'mcp' | 'mock' | 'custom' | 'openclaw' | 'claude' | 'a2a';
  protocolType?: 'ahivecore' | 'openclaw' | 'opencode' | 'a2a-standard';
  equippedSkills?: string[];
  createdAt: string;
  updatedAt: string;
}

// ========== 工作流节点类型 ==========

export type WorkflowNodeType =
  | 'agent'
  | 'milestone'
  | 'department'
  | 'api'
  | 'condition'
  | 'parallel'
  | 'loop'
  | 'delay'
  | 'variable'
  | 'transform'
  | 'output'
  | 'human'
  | 'review'
  | 'notify'
  | 'webhook'
  | 'email'
  | 'message'
  | 'group'
  | 'planner'           // 规划节点 - 动态任务拆分
  | 'dynamic-parallel'; // 动态并行节点 - 按批次执行动态生成的任务

// ========== 输入输出映射 ==========

export interface InputMapping {
  name: string;
  source: 'blackboard' | 'prev-output' | 'user-input' | 'env';
  sourceKey?: string;
  sourcePath?: string;
  defaultValue?: unknown;
  required?: boolean;
  description?: string;
}

export interface OutputMapping {
  name: string;
  extractPath: string;
  description?: string;
  required?: boolean;
}

// ========== 执行者配置 ==========

export interface ExecutorConfig {
  mode: 'single' | 'any' | 'all' | 'vote' | 'round-robin';
  executors: Array<{
    type: 'agent' | 'department';
    id: string;
    weight?: number;
    timeout?: number;
  }>;
  voteConfig?: {
    method: 'majority' | 'unanimous' | 'weighted';
    timeout: number;
  };
  failureStrategy: {
    action: 'abort' | 'continue' | 'retry' | 'fallback';
    retryCount?: number;
    fallbackExecutorId?: string;
  };
}

// ========== 各节点配置类型 ==========

export interface LoopNodeConfig {
  type: 'count' | 'condition' | 'array';
  count?: number;
  condition?: string;
  arrayVariable?: string;
  iteratorName?: string;
  loopBodyNode: string;
}

export interface DelayNodeConfig {
  duration: number;
  unit: 'seconds' | 'minutes' | 'hours';
}

/**
 * 单个变量项定义（V2版本）
 */
export interface VariableItem {
  /** 变量名 */
  name: string;
  /** 变量值 */
  value: string;
  /** 变量类型 */
  type: 'string' | 'number' | 'boolean' | 'json' | 'array' | 'object' | 'file' | 'directory';
  /** 变量描述 */
  description?: string;
  /** 所属分组 */
  group?: string;
  /** 专用智能体ID - 为空表示公共参数 */
  agentId?: string;
  /** 是否必填 */
  required?: boolean;
  /** 是否敏感信息（如 API Key） */
  sensitive?: boolean;
  /** 默认值 */
  defaultValue?: string;
  /** 验证规则 */
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 变量分组定义
 */
export interface VariableGroup {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  collapsed?: boolean;
}

/**
 * 变量节点配置（V2版本 - 支持多变量打包）
 */
export interface VariableNodeConfigV2 {
  /** 版本标识 */
  version: 'v2';
  /** 变量列表 */
  variables: VariableItem[];
  /** 分组列表 */
  groups?: VariableGroup[];
  /** 打包后的变量名（存入黑板时使用，默认 'project'） */
  packedVariableName?: string;
  /** 全局设置 */
  settings?: {
    allowDynamicAdd?: boolean;
    namingHint?: string;
    enableTemplateInterpolation?: boolean;
  };
}

/**
 * 变量节点配置（向后兼容）
 * 支持 V2 多变量格式和旧版单变量格式
 */
export type VariableNodeConfig = VariableNodeConfigV2 | {
  // 旧版本格式（向后兼容）
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
};

export interface ReviewNodeConfig {
  reviewType: 'agent' | 'human' | 'auto';
  reviewerAgentId?: string;
  title: string;
  instruction: string;
  scoreMethod: 'score' | 'stars' | 'pass_fail';
  criteria?: Array<{
    name: string;
    description: string;
    weight: number;
  }>;
  passCondition: {
    variableName: string;
    operator: 'gte' | 'gt' | 'eq' | 'lte' | 'lt';
    threshold: number;
  };
  failAction: {
    type: 'return' | 'retry' | 'abort' | 'branch';
    targetNodeId?: string;
    maxRetries?: number;
    retryPromptModifier?: string;
  };
  timeout?: number;
  timeoutAction?: 'pass' | 'fail' | 'notify';
}

export interface DepartmentNodeConfig {
  departmentId: string;
  triggerInternalWorkflow: boolean;
  waitForResult: boolean;
  resultTimeout?: number;
}

export interface MilestoneNodeConfig {
  description?: string;
  subWorkflowId?: string;
  waitForCompletion?: boolean;
  timeout?: number;
  /** 子节点ID列表 - 属于此里程碑的任务节点 */
  childNodes?: string[];
}

export interface NotifyNodeConfig {
  channels: Array<'email' | 'sms' | 'dingtalk' | 'wecom' | 'feishu'>;
  recipients: string[];
  template: string;
}

export interface ApiNodeConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  authType?: 'none' | 'bearer' | 'basic' | 'api-key';
  authValue?: string;
  timeout?: number;
}

export interface TransformNodeConfig {
  type: 'jsonpath' | 'jq' | 'template' | 'script';
  inputVariable: string;
  outputVariable: string;
  expression: string;
}

export interface OutputNodeConfig {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  isFinalOutput?: boolean;
}

export interface WebhookNodeConfig {
  path: string;
  method: 'GET' | 'POST';
  requireAuth?: boolean;
  authToken?: string;
  responseTemplate?: string;
}

export interface EmailNodeConfig {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
}

export interface MessageNodeConfig {
  type: 'dingtalk' | 'wecom' | 'feishu' | 'slack';
  recipients: string[];
  content: string;
}

// ========== 节点配置 ==========

export interface WorkflowNodeConfig {
  description?: string;
  executor?: ExecutorConfig;
  /** @deprecated 使用 executor 替代 */
  agentId?: string;
  /** @deprecated 使用 executor 替代 */
  groupId?: string;
  taskTemplate?: string;
  inputs?: InputMapping[];
  outputs?: OutputMapping[];
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
  conditions?: Array<{
    label?: string;
    expression: string;
    targetNode: string;
  }>;
  defaultNode?: string;
  branches?: string[];
  mergeType?: 'all' | 'any' | 'none';
  loopConfig?: LoopNodeConfig;
  delayConfig?: DelayNodeConfig;
  variableConfig?: VariableNodeConfig;
  reviewConfig?: ReviewNodeConfig;
  notifyConfig?: NotifyNodeConfig;
  apiConfig?: ApiNodeConfig;
  departmentConfig?: DepartmentNodeConfig;
  milestoneConfig?: MilestoneNodeConfig;
  transformConfig?: TransformNodeConfig;
  outputConfig?: OutputNodeConfig;
  webhookConfig?: WebhookNodeConfig;
  emailConfig?: EmailNodeConfig;
  messageConfig?: MessageNodeConfig;
  skillConfig?: {
    inheritFromAgent: boolean;
    customSkills?: string[];
  };
}

// ========== 工作流节点 ==========

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  agentId?: string;
  groupId?: string;
  name: string;
  description?: string;
  position: { x: number; y: number };
  config?: WorkflowNodeConfig;
  createdAt?: string;
  updatedAt?: string;
}

// ========== 工作流边 ==========

export interface EdgeCondition {
  variableName: string;
  operator: 'gte' | 'gt' | 'eq' | 'lte' | 'lt';
  value: number | string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle?: 'bottom';
  target: string;
  targetHandle?: 'top' | 'left';
  label?: string;
  failCondition?: EdgeCondition;
  /** @deprecated */
  condition?: EdgeCondition;
  /** @deprecated */
  conditionFailTarget?: string;
  createdAt?: string;
}

// ========== 工作流 ==========

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isActive: boolean;
  context?: {
    projectPath: string;
    outputPath: string;
    assets: Record<string, string>;
    [key: string]: unknown;
  };
  createdAt?: string;
  updatedAt?: string;
}

// ========== 黑板类型 ==========

export interface BlackboardVariableEntry {
  key: string;
  value: unknown;
  type: 'public' | 'protected' | 'private';
  owner?: string;
  version: number;
  updatedAt: string;
  subscribers?: string[];
  description?: string;
}

export interface BlackboardTask {
  id: string;
  parentIntentId?: string;
  status: 'pending' | 'assigned' | 'running' | 'blocked' | 'completed' | 'failed' | 'waiting-human';
  assignee: string | null;
  priority: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  dependencies: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  type?: string;
  description?: string;
  tags?: string[];
  attempts?: number;
}

export interface BlackboardSnapshot {
  id: string;
  timestamp: string;
  variables: Array<{ key: string; value: unknown }>;
  tasks: BlackboardTask[];
}

export interface SetVariableOptions {
  owner?: string;
  type?: 'public' | 'protected' | 'private';
  description?: string;
  notify?: boolean;
}

// ========== 执行状态 ==========

export type ExecutionStatus = 
  | 'idle' 
  | 'running' 
  | 'paused' 
  | 'waiting_review' 
  | 'completed' 
  | 'failed';

export interface ExecutionContext {
  instanceId: string;
  workflowId: string;
  currentNodeId: string;
  status: ExecutionStatus;
  executionPath: string[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface NodeExecutionRecord {
  nodeId: string;
  nodeName: string;
  startedAt: string;
  completedAt?: string;
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  input: {
    prompt: string;
    variables: string[];
  };
  output: {
    raw: string;
    extracted: Record<string, unknown>;
  };
  error?: string;
  duration?: number;
}

export interface WorkflowExecutionResult {
  success: boolean;
  context: ExecutionContext;
  outputs: Record<string, unknown>;
  history: NodeExecutionRecord[];
  error?: string;
}

// ========== 审核结果 ==========

export interface ReviewResult {
  nodeId: string;
  score?: number;
  stars?: number;
  feedback?: string;
  approved: boolean;
}

// ========== WebSocket 事件 ==========

export type WorkflowEventType = 
  | 'workflow-started'
  | 'workflow-completed'
  | 'workflow-error'
  | 'workflow-node-start'
  | 'workflow-node-complete'
  | 'workflow-node-error'
  | 'workflow-variable-set'
  | 'workflow-waiting-review'
  | 'workflow-paused'
  | 'workflow-resumed'
  | 'workflow-stopped';

export interface WorkflowEvent {
  type: WorkflowEventType;
  instanceId: string;
  workflowId: string;
  nodeId?: string;
  nodeName?: string;
  timestamp: number;
  data?: any;
}

// ========== IPC 接口 ==========

export interface WorkflowIPC {
  'workflow:execute': (workflowId: string, variables?: Record<string, unknown>) => Promise<{
    instanceId: string;
    success: boolean;
  }>;
  'workflow:pause': (instanceId: string) => Promise<boolean>;
  'workflow:resume': (instanceId: string) => Promise<boolean>;
  'workflow:stop': (instanceId: string) => Promise<boolean>;
  'workflow:get-state': (instanceId: string) => Promise<ExecutionContext | null>;
  'workflow:get-variables': (instanceId: string) => Promise<Record<string, unknown>>;
  'workflow:submit-review': (instanceId: string, nodeId: string, result: ReviewResult) => Promise<boolean>;
  'workflow:list-instances': () => Promise<ExecutionContext[]>;
}

// ========== 部门 ==========

export interface Department {
  id: string;
  name: string;
  description?: string;
  icon: string;
  members: Array<{
    agentId: string;
    role: 'leader' | 'member';
    skills?: string[];
  }>;
  internalWorkflows: Array<{
    id: string;
    name: string;
    triggerCondition: string;
    workflowId: string;
    triggerType?: 'manual' | 'auto' | 'webhook' | 'schedule';
    schedule?: string;
    enabled?: boolean;
  }>;
  blackboard: Record<string, unknown>;
  settings: {
    autoAssign: boolean;
    assignStrategy: 'random' | 'round-robin' | 'skill-match';
    notifyOnTask: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

// ========== 回调类型 ==========

export interface ExecutionCallback {
  onStateChange?: (context: ExecutionContext) => void;
  onNodeStart?: (nodeId: string, nodeName: string) => void;
  onNodeComplete?: (record: NodeExecutionRecord) => void;
  onError?: (nodeId: string, error: Error) => void;
  onAgentStatusChange?: (agentId: string, status: string) => void;
  onWaitingReview?: (nodeId: string, nodeName: string, reviewConfig: ReviewNodeConfig) => void;
}

// ========== 状态管理类型（三层文件架构） ==========

/**
 * 节点执行状态（状态管理器视角）
 */
export type NodeExecutionStatus = 
  | 'pending'      // 待执行
  | 'running'      // 执行中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'skipped';     // 跳过

/**
 * 工作流执行状态（状态管理器视角）
 */
export type WorkflowExecutionStatus =
  | 'idle'         // 空闲
  | 'running'      // 运行中
  | 'paused'       // 已暂停
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'interrupted'; // 中断（可恢复）

/**
 * 节点执行状态记录（状态管理器视角）
 */
export interface NodeExecutionState {
  nodeId: string;
  nodeName: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  agentId?: string;
  agentName?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  duration?: number;
  retryCount?: number;
}

/**
 * 工作流执行状态（引擎视角 - 用于持久化）
 */
export interface WorkflowExecutionState {
  // 基本信息
  instanceId: string;
  workflowId: string;
  workflowName: string;
  projectPath: string;
  
  // 状态
  status: WorkflowExecutionStatus;
  currentNodeId: string | null;
  currentNodeName: string | null;
  
  // 时间
  startedAt: string;
  completedAt?: string;
  lastUpdatedAt: string;
  interruptedAt?: string;
  
  // 执行路径
  executionPath: string[];
  nodeRecords: NodeExecutionState[];
  
  // 黑板变量
  variables: Record<string, unknown>;
  
  // 错误信息
  error?: string;
  
  // 元数据
  metadata?: {
    totalNodes?: number;
    completedNodes?: number;
    failedNodes?: number;
    [key: string]: unknown;
  };
}

/**
 * 持久化执行状态（用于引擎恢复）
 */
export interface PersistedExecutionState {
  instanceId: string;
  workflowId: string;
  workflowName: string;
  context: ExecutionContext;
  history: NodeExecutionRecord[];
  blackboard: Array<{
    key: string;
    value: unknown;
    type: 'public' | 'protected' | 'private';
    owner?: string;
    updatedAt: string;
  }>;
  currentNodeIndex: number;
  savedAt: string;
}

/**
 * 指挥官日志条目
 */
export interface CommanderLogEntry {
  timestamp: string;
  type: 'info' | 'task' | 'complete' | 'error' | 'query' | 'response';
  nodeId?: string;
  nodeName?: string;
  agentId?: string;
  agentName?: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Agent工作状态
 */
export interface AgentWorkState {
  agentId: string;
  agentName: string;
  status: 'idle' | 'working' | 'waiting' | 'error';
  
  // 当前任务
  currentTask?: {
    instanceId: string;
    workflowId: string;
    workflowName: string;
    nodeId: string;
    nodeName: string;
    taskDescription: string;
    startedAt: string;
  };
  
  // 历史任务
  completedTasks?: Array<{
    instanceId: string;
    nodeId: string;
    nodeName: string;
    completedAt: string;
    success: boolean;
  }>;
  
  // 时间戳
  lastUpdatedAt: string;
  lastHeartbeatAt: string;
  
  // 工作目录
  projectPath?: string;
}

// ========== 指挥官通信类型 ==========

/**
 * 指挥官消息类型
 */
export interface CommanderMessage {
  type: 'task_assign' | 'task_query' | 'status_report' | 'task_complete' | 'task_failed' | 'agent_wakeup' | 'inquiry' | 'heartbeat' | 'pong';
  payload: any;
  timestamp: number;
  messageId: string;
}

/**
 * Agent状态报告
 */
export interface AgentStatusReport {
  agentId: string;
  status: ExecutionStatus | 'idle' | 'working' | 'waiting' | 'error';
  currentNodeId?: string;
  currentNodeName?: string;
  progress?: number;
  lastUpdate?: string;
  message?: string;
  taskId?: string;
}

/**
 * 任务分配消息
 */
export interface TaskAssignMessage {
  type: 'task_assign';
  payload: {
    taskId: string;
    nodeId: string;
    nodeName: string;
    taskBrief: string;
    agentId: string;
    workflowId: string;
    instanceId: string;
    inputs?: Record<string, unknown>;
    timeout?: number;
  };
  timestamp: number;
  messageId: string;
}

/**
 * 任务查询消息
 */
export interface TaskQueryMessage {
  type: 'task_query';
  payload: {
    taskId: string;
    nodeId: string;
    agentId: string;
    queryBrief: string;
  };
  timestamp: number;
  messageId: string;
}

/**
 * 状态报告消息
 */
export interface StatusReportMessage {
  type: 'status_report';
  payload: AgentStatusReport;
  timestamp: number;
  messageId: string;
}

/**
 * 任务完成消息
 */
export interface TaskCompleteMessage {
  type: 'task_complete';
  payload: {
    taskId: string;
    nodeId: string;
    agentId: string;
    success: boolean;
    outputs?: Record<string, unknown>;
    error?: string;
  };
  timestamp: number;
  messageId: string;
}

/**
 * Agent唤醒消息
 */
export interface AgentWakeupMessage {
  type: 'agent_wakeup';
  payload: {
    agentId: string;
    taskBrief: string;
    lastState?: string;
    projectPath: string;
  };
  timestamp: number;
  messageId: string;
}

// ========== Agent自主拆解类型（Phase 1 - 新增，不影响现有） ==========

/**
 * 任务复杂度评估结果
 */
export interface TaskAssessment {
  taskId: string;
  nodeId: string;
  assessment: 'simple' | 'moderate' | 'complex';
  estimatedEffort: 'low' | 'medium' | 'high';
  needsDecomposition: boolean;
  reason: string;
  timestamp: number;
}

/**
 * 子任务定义
 */
export interface SubTaskDefinition {
  id: string;
  name: string;
  description: string;
  agentType: 'frontend' | 'backend' | 'fullstack' | 'art' | 'audio' | 'general';
  dependsOn: string[];  // 依赖的子任务ID列表
  estimatedMinutes: number;
  expectedOutputs: string[];  // 预期产出文件路径
}

/**
 * 拆解方案提案
 */
export interface DecompositionProposal {
  proposalId: string;
  taskId: string;
  nodeId: string;
  instanceId: string;
  workflowId: string;
  
  // 评估信息
  assessment: TaskAssessment;
  
  // 拆解方案
  subTasks: SubTaskDefinition[];
  executionMode: 'sequential' | 'parallel' | 'mixed';
  mergeStrategy: string;  // 如何合并子任务成果
  
  // 风险评估
  riskLevel: 'low' | 'medium' | 'high';
  riskNotes?: string;
  
  // 文件路径
  planPath: string;  // Markdown方案文件路径
  
  // 时间戳
  submittedAt: string;
}

/**
 * 拆解方案审批结果
 */
export interface ProposalReviewResult {
  proposalId: string;
  status: 'approved' | 'rejected' | 'modified';
  reviewer: 'ahivecore' | 'committee' | 'human';
  notes?: string;
  rejectionReason?: string;
  modificationSuggestions?: string;
  authorizedSubAgents?: number;  // 允许的最大子Agent数量
  reviewedAt: string;
}

/**
 * 子任务执行状态
 */
export interface SubTaskExecutionState {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  agentId?: string;
  startedAt?: string;
  completedAt?: string;
  outputs?: Record<string, unknown>;
  error?: string;
}

/**
 * 节点拆解状态（简化版 - 4种核心状态）
 */
export interface NodeDecompositionState {
  // 状态：none(未拆解) | proposing(提案中) | approved(已批准) | executing(执行中) | merged(已合并)
  status: 'none' | 'proposing' | 'approved' | 'executing' | 'merged';
  
  // 提案信息
  proposalId?: string;
  proposal?: DecompositionProposal;
  
  // 审批结果
  reviewResult?: ProposalReviewResult;
  
  // 子任务状态
  subTasks: SubTaskExecutionState[];
  
  // 合并结果
  mergedOutput?: Record<string, unknown>;
  
  // 重试计数
  retryCount: number;
  maxRetries: number;
}

/**
 * 拆解相关WebSocket事件类型
 */
export type DecompositionEventType =
  | 'workflow_task_assessment'      // Agent提交评估
  | 'workflow_task_proposal'        // Agent提交拆解方案
  | 'workflow_proposal_review'      // 指挥官审批结果
  | 'workflow_sub_task_start'       // 子任务开始
  | 'workflow_sub_task_progress'    // 子任务进度
  | 'workflow_sub_task_complete'    // 子任务完成
  | 'workflow_task_merge';          // 任务合并完成

/**
 * 拆解相关WebSocket事件
 */
export interface DecompositionEvent {
  type: DecompositionEventType;
  instanceId: string;
  workflowId: string;
  nodeId: string;
  timestamp: number;
  data: {
    taskId?: string;
    proposalId?: string;
    assessment?: TaskAssessment;
    proposal?: DecompositionProposal;
    reviewResult?: ProposalReviewResult;
    subTaskId?: string;
    subTaskStatus?: string;
    mergedOutput?: Record<string, unknown>;
  };
}

/**
 * Agent节点配置扩展 - 自主拆解配置
 */
export interface AgentDecompositionConfig {
  /** 是否启用自主拆解（默认false） */
  enabled: boolean;
  
  /** 复杂度阈值 - 超过此阈值才触发拆解评估 */
  complexityThreshold?: 'moderate' | 'complex';
  
  /** 最大子Agent数量限制 */
  maxSubAgents?: number;
  
  /** 审批超时时间（毫秒），超时自动通过 */
  approvalTimeout?: number;
  
  /** 最大重试次数 */
  maxRetries?: number;
  
  /** 是否允许人工干预审批 */
  allowHumanReview?: boolean;
}