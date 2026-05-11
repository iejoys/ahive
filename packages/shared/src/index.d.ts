/** 智能体运行时类型 */
export type AgentRuntimeType = 'opencode' | 'mcp' | 'mock' | 'custom' | 'openclaw' | 'claude';
/** 智能体状态 */
export type AgentStatus = 'idle' | 'working' | 'paused' | 'error';
/** 智能体 */
export interface Agent {
    id: string;
    name: string;
    description: string;
    status: AgentStatus;
    avatar: string;
    agentType?: string;
    group?: string;
    customUrl?: string;
    position: Position3D;
    skills: string[];
    type: AgentRuntimeType;
    createdAt: string;
    updatedAt: string;
}
/** 创建智能体请求 */
export interface CreateAgentRequest {
    name: string;
    description?: string;
    status?: AgentStatus;
    avatar?: string;
    position?: Position3D;
    skills?: string[];
    type?: AgentRuntimeType;
}
/** 技能 */
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
/** 创建技能请求 */
export interface CreateSkillRequest {
    id: string;
    name: string;
    description?: string;
    category?: string;
    icon?: string;
    dependencies?: string[];
}
/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
/** 任务 */
export interface Task {
    id: string;
    agentId: string;
    task: string;
    status: TaskStatus;
    output: string[];
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    exitCode?: number;
}
/** 任务上下文 */
export interface TaskContext {
    cwd?: string;
    env?: Record<string, string>;
}
/** 创建任务请求 */
export interface CreateTaskRequest {
    agentId: string;
    task: string;
    context?: TaskContext;
}
/** 工作流节点类型 */
export type WorkflowNodeType = 'agent' | 'group';
/** 工作流节点 */
export interface WorkflowNode {
    id: string;
    type: WorkflowNodeType;
    agentId?: string;
    groupId?: string;
    name: string;
    description?: string;
    position: Position2D;
    config?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
/** 审核条件类型 */
export type ReviewConditionType = 'score' | 'stars' | 'percentage';
/** 审核条件操作符 */
export type ReviewConditionOperator = 'gte' | 'gt' | 'eq' | 'lte' | 'lt';
/** 审核条件 */
export interface ReviewCondition {
    type: ReviewConditionType;
    threshold: number;
    operator: ReviewConditionOperator;
}
/** 工作流边 */
export interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
    condition?: ReviewCondition;
    conditionFailTarget?: string;
    createdAt: string;
}
/** 工作流 */
export interface Workflow {
    id: string;
    name: string;
    description?: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
/** 审核状态 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
/** 审核记录 */
export interface Review {
    id: string;
    workflowId: string;
    taskId: string;
    nodeId: string;
    reviewer?: string;
    score?: number;
    stars?: number;
    feedback?: string;
    status: ReviewStatus;
    createdAt: string;
    reviewedAt?: string;
}
/** 工作流实例状态 */
export type WorkflowInstanceStatus = 'running' | 'paused' | 'completed' | 'failed';
/** 工作流实例 */
export interface WorkflowInstance {
    id: string;
    workflowId: string;
    status: WorkflowInstanceStatus;
    currentNodeId: string;
    taskData: Record<string, unknown>;
    reviews: Review[];
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}
/** 定时任务触发类型 */
export type ScheduledTaskTriggerType = 'once' | 'interval' | 'cron';
/** 定时任务 */
export interface ScheduledTask {
    id: string;
    name: string;
    description?: string;
    workflowId: string;
    triggerType: ScheduledTaskTriggerType;
    cronExpression?: string;
    intervalMs?: number;
    nextRunAt?: string;
    enabled: boolean;
    lastRunAt?: string;
    runCount: number;
    createdAt: string;
    updatedAt: string;
}
/** 2D 坐标 */
export interface Position2D {
    x: number;
    y: number;
}
/** 3D 坐标 */
export interface Position3D {
    x: number;
    y: number;
    z: number;
}
/** 标签页类型 */
export type TabType = 'world' | 'skills' | 'tasks' | 'workflow';
/** 语言类型 */
export type Language = 'zh' | 'en';
/** 技能树节点 */
export interface SkillNode {
    id: string;
    type: 'skill';
    position: Position2D;
    data: Skill;
}
/** 技能树边 */
export interface SkillEdge {
    id: string;
    source: string;
    target: string;
    animated?: boolean;
}
export * from './protocols';
