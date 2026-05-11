/**
 * 任务计划类型定义
 * 
 * 用于 update_plan 工具的数据结构
 * 支持工作流场景的审批流程
 */

// ============ 步骤状态 ============

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

// ============ 任务状态（扩展：支持审批） ============

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'pending_approval' | 'approved' | 'rejected';

// ============ Agent 类型（用于工作流协作） ============

export type AgentType = 'frontend' | 'backend' | 'fullstack' | 'art' | 'audio' | 'general';

// ============ 任务步骤（扩展：支持工作流协作） ============

export interface TaskStep {
  /** 步骤ID: step-1, step-2, ... */
  id: string;
  /** 步骤名称（简短，用于显示） */
  name?: string;
  /** 步骤描述 */
  description: string;
  /** 步骤状态 */
  status: StepStatus;
  /** 依赖的步骤ID（可选） */
  dependencies?: string[];
  
  // ========== 工作流协作字段（可选） ==========
  
  /** 执行此步骤的 Agent 类型（工作流场景） */
  agentType?: AgentType;
  /** 预估耗时（分钟） */
  estimatedMinutes?: number;
  /** 预期产出文件路径 */
  expectedOutputs?: string[];
  
  // ========== 执行结果 ==========
  
  /** 执行结果（可选） */
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
  /** 开始时间（可选） */
  startedAt?: number;
  /** 完成时间（可选） */
  completedAt?: number;
}

// ============ 任务计划（扩展：支持工作流上下文） ============

export interface TaskPlan {
  /** 计划ID: plan-{timestamp}-{random} */
  id: string;
  /** 任务标题 */
  title: string;
  /** 任务描述（可选） */
  description?: string;
  /** 步骤列表 */
  steps: TaskStep[];
  /** 任务状态 */
  status: TaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间（可选） */
  completedAt?: number;
  /** 创建者 Agent ID */
  agentId: string;
  /** 会话 ID */
  sessionId: string;
  
  // ========== 工作流上下文（可选） ==========
  
  /** 工作流任务 ID */
  taskId?: string;
  /** 工作流节点 ID */
  nodeId?: string;
  /** 工作流 ID */
  workflowId?: string;
  /** 工作流实例 ID */
  instanceId?: string;
  
  // ========== 审批信息（可选） ==========
  
  /** 审批状态 */
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  /** 审批意见 */
  approvalNotes?: string;
  /** 授权的子 Agent 数量 */
  authorizedSubAgents?: number;
  /** 审批时间 */
  approvedAt?: number;
  /** 审批者 */
  reviewer?: string;
}

// ============ 工具参数类型 ============

export interface UpdatePlanArgs {
  /** 更新说明（可选） */
  explanation?: string;
  /** 步骤列表 */
  plan: Array<{
    /** 步骤描述 */
    step: string;
    /** 步骤状态 */
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

// ============ 进度信息 ============

export interface TaskProgress {
  /** 总步骤数 */
  total: number;
  /** 已完成数 */
  completed: number;
  /** 执行中数 */
  inProgress: number;
  /** 待执行数 */
  pending: number;
  /** 完成百分比 */
  percentage: number;
}
