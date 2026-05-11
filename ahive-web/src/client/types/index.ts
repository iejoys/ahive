export interface Agent {
  id: string;
  name: string;
  description: string;
  status: 'idle' | 'working' | 'paused' | 'error' | 'offline';
  avatar: string;
  agentType?: string;  // 智能体类型: openclaw, opencode, claude, custom, ahive-coder, ahive-worker
  agentId?: string;    // 真实的智能体 ID (用于 AHIVECORE 等系统)
  group?: string;      // 分组(部门): code, search, analyze, general
  customUrl?: string; // 自定义端点
  position: { x: number; y: number; z: number };
  skills: string[];
  type: 'opencode' | 'mcp' | 'mock' | 'custom' | 'openclaw' | 'claude' | 'a2a' | 'ahivecore' | 'ahive-coder' | 'ahive-worker';
  protocolType?: 'ahivecore' | 'openclaw' | 'opencode' | 'a2a-standard';  // A2A 协议类型
  // MCP 技能配置
  equippedSkills?: string[];  // 已装备的 MCP 工具 ID 列表 ['search_repositories', 'read_file', ...]
  // 自定义字段（用于存储 LLM 配置等）
  customFields?: {
    endpoint?: string;
    agentId?: string;
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
}


export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  dependencies: string[];
  installs: number;
  createdAt: string;
}

export interface Task {
  id: string;
  agentId: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
}

export interface SkillNode {
  id: string;
  type: 'skill';
  position: { x: number; y: number };
  data: Skill;
}

export interface SkillEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
}

export type TabType = 'world' | 'skills' | 'mcp-tools' | 'tasks' | 'workflow' | 'logs';

// ========== 通用类型 ==========

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export type Language = 'zh' | 'en';

// ========== 定时任务类型 ==========

// ========== 定时任务类型 ==========
export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  
  // 执行目标 - 工作流或智能体二选一
  targetType: 'workflow' | 'agent';
  workflowId?: string;           // 关联的工作流 (targetType=workflow 时)
  agentId?: string;              // 关联的智能体 (targetType=agent 时)
  taskPrompt?: string;           // 发送给智能体的任务提示 (targetType=agent 时)
  
  triggerType: 'once' | 'interval' | 'cron';
  cronExpression?: string;
  intervalMs?: number;
  scheduledTime?: string;       // 指定执行时间 (一次性任务)
  nextRunAt?: string;
  enabled: boolean;
  lastRunAt?: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

// 定时任务执行记录
export interface ScheduledTaskRun {
  id: string;
  scheduledTaskId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
  error?: string;
  duration?: number;  // 毫秒
}

// ========== 工作流类型 ==========

// ========== 工作流节点配置 (增强) ==========

/** 输入映射 - 定义从哪里获取输入 */
export interface InputMapping {
  /** 模板中使用的变量名 */
  name: string;
  /** 数据来源 */
  source: 'blackboard' | 'prev-output' | 'user-input' | 'env';
  /** 来源键名/路径 */
  sourceKey?: string;
  /** JSONPath 提取路径 */
  sourcePath?: string;
  /** 默认值 */
  defaultValue?: unknown;
  /** 是否必须 */
  required?: boolean;
  /** 描述 */
  description?: string;
}

/** 输出映射 - 定义输出什么变量 */
export interface OutputMapping {
  /** 输出变量名 (存入黑板) */
  name: string;
  /** JSONPath 提取路径 */
  extractPath: string;
  /** 变量说明 */
  description?: string;
  /** 是否必须提取成功 */
  required?: boolean;
}

/** 工作流节点配置 (增强版) */
export interface WorkflowNodeConfig {
  // ========== 通用配置 ==========
  /** 节点描述 */
  description?: string;
  
  // ========== 执行者配置 (替代单一 agentId) ==========
  /** 执行者配置 - 支持多执行者 */
  executor?: ExecutorConfig;
  
  /** @deprecated 使用 executor 替代 */
  agentId?: string;
  /** @deprecated 使用 executor 替代 */
  groupId?: string;
  
  // ========== 任务定义 ==========
  /** 任务模板 (支持变量插值 {{variable}}) */
  taskTemplate?: string;
  /** 输入映射 */
  inputs?: InputMapping[];
  /** 输出映射 */
  outputs?: OutputMapping[];
  
  // ========== 执行策略 ==========
  /** 超时时间 (ms) */
  timeout?: number;
  /** 重试次数 */
  retryCount?: number;
  /** 重试间隔 (ms) */
  retryDelay?: number;
  
  // ========== 条件节点专用 ==========
  /** 条件表达式列表 */
  conditions?: Array<{
    label?: string;
    expression: string;
    targetNode: string;
  }>;
  /** 默认目标节点 */
  defaultNode?: string;
  
  // ========== 并行节点专用 ==========
  /** 并行分支节点 ID 列表 */
  branches?: string[];
  /** 合并策略 */
  mergeType?: 'all' | 'any' | 'none';
  
  // ========== 循环节点专用 ==========
  loopConfig?: LoopNodeConfig;
  
  // ========== 延时节点专用 ==========
  delayConfig?: DelayNodeConfig;
  
  // ========== 变量节点专用 ==========
  variableConfig?: VariableNodeConfig;
  
  // ========== 审核节点专用 (增强版) ==========
  reviewConfig?: ReviewNodeConfig;
  
  /** @deprecated 使用 reviewConfig 替代 */
  reviewTitle?: string;
  /** @deprecated 使用 reviewConfig 替代 */
  reviewDescription?: string;
  /** @deprecated 使用 reviewConfig 替代 */
  reviewOptions?: Array<{ label: string; value: string }>;
  
  // ========== 通知节点专用 ==========
  notifyConfig?: NotifyNodeConfig;
  
  // ========== API 节点专用 ==========
  apiConfig?: ApiNodeConfig;
  
  // ========== 部门节点专用 ==========
  departmentConfig?: DepartmentNodeConfig;
  
  // ========== 里程碑节点专用 ==========
  milestoneConfig?: MilestoneNodeConfig;
  /** 子节点ID列表（里程碑节点专用，快捷访问） */
  childNodes?: string[];
  
  // ========== 数据转换节点专用 ==========
  transformConfig?: TransformNodeConfig;
  
  // ========== 输出节点专用 ==========
  outputConfig?: OutputNodeConfig;
  
  // ========== Webhook 节点专用 ==========
  webhookConfig?: WebhookNodeConfig;
  
  // ========== 邮件节点专用 ==========
  emailConfig?: EmailNodeConfig;
  
  // ========== 消息节点专用 ==========
  messageConfig?: MessageNodeConfig;
  
  // ========== MCP 技能配置 ==========
  /** 技能配置 - 节点级别覆盖 Agent 默认技能 */
  skillConfig?: {
    inheritFromAgent: boolean;
    customSkills?: string[];
  };
}

// ========== 工作流节点类型 (扩展) ==========

/** 工作流节点类型 - 扩展支持更多节点 */
export type WorkflowNodeType =
  | 'agent'      // 智能体节点
  | 'milestone'  // 里程碑节点（阶段容器，支持多级工作流）
  | 'department' // 部门节点 (原 group)
  | 'api'        // 外部 API 节点
  | 'condition'  // 条件分支节点
  | 'parallel'   // 并行执行节点
  | 'loop'       // 循环节点
  | 'delay'      // 延时节点
  | 'variable'   // 项目配置节点（定义静态配置参数）
  | 'transform'  // 数据转换节点
  | 'output'     // 输出节点
  | 'human'      // 人工审核节点
  | 'review'     // 审核节点 (增强版)
  | 'notify'     // 通知节点
  | 'webhook'    // Webhook 节点
  | 'email'      // 邮件节点
  | 'message'    // 消息节点
  | 'group'      // 兼容旧版
  | 'planner'           // 规划节点 - 动态任务拆分
  | 'dynamic-parallel'; // 动态并行节点 - 按批次执行动态生成的任务

/** 执行者配置 - 支持多个执行者 */
export interface ExecutorConfig {
  /** 执行模式 */
  mode: 'single' | 'any' | 'all' | 'vote' | 'round-robin';
  
  /** 执行者列表 */
  executors: Array<{
    type: 'agent' | 'department';
    id: string;           // Agent ID 或 部门 ID
    weight?: number;      // 权重 (用于投票或轮询)
    timeout?: number;     // 超时时间
  }>;
  
  /** 投票配置 (mode='vote' 时) */
  voteConfig?: {
    method: 'majority' | 'unanimous' | 'weighted';
    timeout: number;
  };
  
  /** 失败策略 */
  failureStrategy: {
    action: 'abort' | 'continue' | 'retry' | 'fallback';
    retryCount?: number;
    fallbackExecutorId?: string;
  };
}

/** 审核节点配置 */
export interface ReviewNodeConfig {
  /** 审核类型 */
  reviewType: 'agent' | 'human' | 'auto';
  
  /** 审核执行者 (reviewType='agent' 时) */
  reviewerAgentId?: string;
  
  /** 审核标题 */
  title: string;
  
  /** 审核说明/提示词 */
  instruction: string;
  
  /** 审核报告要求（附加到提示词中） */
  reviewReportInstruction?: string;
  
  /** 评分方式 */
  scoreMethod: 'score' | 'stars' | 'pass_fail';
  
  /** 评分项配置 */
  criteria?: Array<{
    name: string;           // 评分项名称
    description: string;    // 评分项说明
    weight: number;         // 权重
  }>;
  
  /** 通过条件 */
  passCondition: {
    variableName: string;
    operator: 'gte' | 'gt' | 'eq' | 'lte' | 'lt';
    threshold: number;
  };
  
  /** 不通过时的处理 */
  failAction: {
    type: 'return' | 'retry' | 'abort' | 'branch';
    targetNodeId?: string;
    maxRetries?: number;
    retryPromptModifier?: string;
  };
  
  /** 超时设置 */
  timeout?: number;
  
  /** 超时处理 */
  timeoutAction?: 'pass' | 'fail' | 'notify';
}

/** 部门节点配置 */
export interface DepartmentNodeConfig {
  departmentId: string;
  triggerInternalWorkflow: boolean;
  waitForResult: boolean;
  resultTimeout?: number;
}

/** 里程碑节点配置（阶段容器，支持多级工作流） */
export interface MilestoneNodeConfig {
  /** 阶段描述 */
  description?: string;
  /** 子工作流ID（可选，用于引用预定义的子流程） */
  subWorkflowId?: string;
  /** 是否等待阶段完成 */
  waitForCompletion?: boolean;
  /** 阶段超时时间 */
  timeout?: number;
  /** 子节点ID列表（属于该里程碑的任务节点） */
  childNodes?: string[];
}

/** 循环节点配置 */
export interface LoopNodeConfig {
  type: 'count' | 'condition' | 'array';
  count?: number;
  condition?: string;
  arrayVariable?: string;
  iteratorName?: string;
  loopBodyNode: string;
}

/** 延时节点配置 */
export interface DelayNodeConfig {
  duration: number;
  unit: 'seconds' | 'minutes' | 'hours';
}

/** 变量节点配置 (旧版 - 单变量) */
export interface VariableNodeConfig {
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
}

/** 单个变量项定义 (新版 - 多变量支持) */
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
  /** 专用智能体ID (为空表示公共参数) */
  agentId?: string;
  /** 是否必填 */
  required?: boolean;
  /** 是否敏感信息 */
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

/** 变量分组定义 */
export interface VariableGroup {
  /** 分组ID */
  id: string;
  /** 分组名称 */
  name: string;
  /** 分组描述 */
  description?: string;
  /** 分组图标 */
  icon?: string;
  /** 分组颜色 */
  color?: string;
  /** 是否折叠 */
  collapsed?: boolean;
}

/** 变量节点配置 (新版 - 多变量支持) */
export interface VariableNodeConfigV2 {
  /** 版本标识 */
  version: 'v2';
  /** 变量列表 */
  variables: VariableItem[];
  /** 分组列表 */
  groups?: VariableGroup[];
  /** 打包后的变量名 (存入黑板时使用，默认 'project') */
  packedVariableName?: string;
  /** 全局设置 */
  settings?: {
    allowDynamicAdd?: boolean;
    namingHint?: string;
    enableTemplateInterpolation?: boolean;
  };
  /** 任务上报提示词配置 */
  reportPrompt?: {
    /** 是否使用默认提示词 */
    useDefault: boolean;
    /** 自定义提示词 (useDefault=false时使用) */
    customPrompt?: string;
  };
}

/** API 节点配置 */
export interface ApiNodeConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  authType?: 'none' | 'bearer' | 'basic' | 'api-key';
  authValue?: string;
  timeout?: number;
}

/** 通知节点配置 */
export interface NotifyNodeConfig {
  channels: Array<'email' | 'sms' | 'dingtalk' | 'wecom' | 'feishu'>;
  recipients: string[];
  template: string;
}

/** 数据转换节点配置 */
export interface TransformNodeConfig {
  /** 转换类型 */
  type: 'jsonpath' | 'jq' | 'template' | 'script';
  /** 输入变量名 */
  inputVariable: string;
  /** 输出变量名 */
  outputVariable: string;
  /** 转换表达式 */
  expression: string;
}

/** 输出节点配置 */
export interface OutputNodeConfig {
  /** 输出变量名 */
  name: string;
  /** 输出描述 */
  description?: string;
  /** 输出类型 */
  type: 'string' | 'number' | 'boolean' | 'json';
  /** 是否作为工作流最终输出 */
  isFinalOutput?: boolean;
}

/** Webhook 节点配置 */
export interface WebhookNodeConfig {
  /** Webhook 端点路径 */
  path: string;
  /** HTTP 方法 */
  method: 'GET' | 'POST';
  /** 是否需要认证 */
  requireAuth?: boolean;
  /** 认证令牌 */
  authToken?: string;
  /** 响应模板 */
  responseTemplate?: string;
}

/** 邮件节点配置 */
export interface EmailNodeConfig {
  /** 收件人 */
  to: string[];
  /** 抄送 */
  cc?: string[];
  /** 主题 */
  subject: string;
  /** 正文 */
  body: string;
  /** 是否 HTML 格式 */
  isHtml?: boolean;
}

/** 消息节点配置 */
export interface MessageNodeConfig {
  /** 消息类型 */
  type: 'dingtalk' | 'wecom' | 'feishu' | 'slack';
  /** 接收者 */
  recipients: string[];
  /** 消息内容 */
  content: string;
}

/** 部门定义 */
export interface Department {
  id: string;
  name: string;
  description?: string;
  icon: string;
  
  /** 部门成员 */
  members: Array<{
    agentId: string;
    role: 'leader' | 'member';
    skills?: string[];
  }>;
  
  /** 部门工作流 */
  internalWorkflows: Array<{
    id: string;
    name: string;
    triggerCondition: string;
    workflowId: string;
    /** 触发类型 */
    triggerType?: 'manual' | 'auto' | 'webhook' | 'schedule';
    /** 定时表达式 (triggerType='schedule'时) */
    schedule?: string;
    /** 是否启用 */
    enabled?: boolean;
  }>;
  
  /** 部门黑板 */
  blackboard: Record<string, unknown>;
  
  /** 部门设置 */
  settings: {
    autoAssign: boolean;
    assignStrategy: 'random' | 'round-robin' | 'skill-match';
    notifyOnTask: boolean;
  };
  
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  agentId?: string;
  groupId?: string;
  name: string;
  description?: string;
  position: { x: number; y: number };
  /** 节点执行配置 (增强) */
  config?: WorkflowNodeConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReviewCondition {
  type: 'score' | 'stars' | 'percentage';
  threshold: number;
  operator: 'gte' | 'gt' | 'eq' | 'lte' | 'lt';
}

// ========== 连接点类型 ==========

/** 连接点位置 */
export type HandlePosition = 'top' | 'bottom' | 'left' | 'right';

/** 连接线条件 (基于黑板变量) */
export interface EdgeCondition {
  /** 黑板变量名 */
  variableName: string;
  /** 比较操作符 */
  operator: 'gte' | 'gt' | 'eq' | 'lte' | 'lt';
  /** 比较值 */
  value: number | string;
}


export interface WorkflowEdge {
  id: string;
  source: string;
  /** 源连接点位置: bottom=正常流程 */
  sourceHandle?: 'bottom';
  target: string;
  /** 目标连接点位置: top=正常流程, left=失败退回 */
  targetHandle?: 'top' | 'left';
  label?: string;
  /** 失败退回条件 (当 targetHandle='left' 时使用) */
  failCondition?: EdgeCondition;
  /** @deprecated 使用 failCondition 替代 */
  condition?: EdgeCondition;
  /** @deprecated 使用 targetHandle='left' 替代 */
  conditionFailTarget?: string;
  createdAt?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Review {
  id: string;
  workflowId: string;
  taskId: string;
  nodeId: string;
  reviewer?: string;
  score?: number;
  stars?: number;
  feedback?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  reviewedAt?: string;
}


// ========== 工作流模板类型 ==========

/** 工作流模板 */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;          // 分类：金融、开发、通用、自定义
  author: string;
  tags: string[];
  isOfficial: boolean;       // 是否官方模板
  source?: 'local' | 'online'; // 来源：本地/在线导入
  sourceUrl?: string;        // 在线模板的原始 URL
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
}

/** 模板库 */
export interface WorkflowTemplateLibrary {
  version: string;
  templates: WorkflowTemplate[];
}

/** 在线模板导入结果 */
export interface OnlineTemplateImportResult {
  success: boolean;
  template?: WorkflowTemplate;
  error?: string;
}

// ========== A2A 通讯类型 ==========

/** A2A 消息类型 */
export type A2AMessageType = 
  | 'talktoagent'     // 普通对话
  | 'review_request'  // 审核请求
  | 'review_result'   // 审核结果
  | 'handover'        // 任务交接
  | 'question'        // 提问
  | 'answer';         // 回答

/** A2A 消息 */
export interface A2AMessage {
  id: string;
  type: A2AMessageType;
  from: string;
  to: string;
  message: string;
  nodeId?: string;
  workflowId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/** 团队通讯录 */
export interface TeamDirectory {
  type: 'team_directory';
  projectId: string;
  MCP_URL: string;
  A2A_URL: string;
  agents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  messageTypes: Array<{
    type: A2AMessageType;
    description: string;
  }>;
  usage: {
    MCP调用: {
      description: string;
      format: string;
      example: string;
    };
    A2A通讯: {
      description: string;
      format: string;
      example: string;
    };
  };
}

/** A2A 对话日志 */
export interface A2AConversationLog {
  logId: string;
  workflowId: string;
  nodeId?: string;
  type: A2AMessageType;
  from: string;
  to: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

// ========== 工作流监控类型 ==========

/** 智能体连接状态 */
export type AgentConnectionStatus = 'online' | 'offline' | 'busy' | 'idle';

/** 智能体连接信息 */
export interface AgentConnectionInfo {
  agentId: string;
  agentName: string;
  status: AgentConnectionStatus;
  lastHeartbeat: string;
  currentTask?: string;
  currentTaskStartedAt?: string;
  workspace?: string;
}

/** 任务监控信息 */
export interface TaskMonitorInfo {
  nodeId: string;
  nodeName: string;
  workflowId: string;
  status: 'pending' | 'in_progress' | 'waiting_review' | 'completed' | 'failed';
  executor?: string;
  startedAt?: string;
  expectedDuration?: number;
  lastUpdate: string;
  progress?: number;
}

/** 超时警报 */
export interface TimeoutAlert {
  nodeId: string;
  workflowId: string;
  type: 'warning' | 'critical';
  overdue: number;
  alertedAt: string;
  executor?: string;
}

/** 中断记录 */
export interface InterruptionRecord {
  nodeId: string;
  workflowId: string;
  agentId: string;
  reason: string;
  interruptedAt: string;
  recoveredAt?: string;
  taskState?: TaskMonitorInfo;
}

/** 监控状态 */
export interface MonitorState {
  agentConnections: AgentConnectionInfo[];
  taskStates: TaskMonitorInfo[];
  timeoutAlerts: TimeoutAlert[];
  interruptions: InterruptionRecord[];
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

/** 黑板变量值 (支持文件引用) */
export interface BlackboardVariableValue {
  /** 值 */
  value: unknown;
  /** 元数据 */
  meta?: {
    owner?: string;
    type?: 'variable' | 'file';
    createdAt?: string;
    description?: string;
  };
  /** 文件引用 (当 type='file' 时) */
  fileRef?: FileReference;
}