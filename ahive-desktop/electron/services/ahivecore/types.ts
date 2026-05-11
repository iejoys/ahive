// 流式事件类型
export type StreamEventType = 'thinking' | 'action' | 'status' | 'result' | 'error' | 'workflow' | 'workflow-startup-check' | 'workflow-event';

// 流式事件基类
export interface StreamEvent {
  type: StreamEventType;
  agentId: string;
  timestamp: number;
  data: any;
}

// 思考流事件
export interface ThinkingEvent extends StreamEvent {
  type: 'thinking';
  data: {
    content: string;
    phase: 'analyzing' | 'planning' | 'executing' | 'reflecting';
    progress?: number;
  };
}

// 动作流事件
export interface ActionEvent extends StreamEvent {
  type: 'action';
  data: {
    tool: string;
    params: any;
    status: 'start' | 'progress' | 'complete' | 'error';
    progress?: number;
    output?: string;
    duration?: number;
  };
}

// 状态流事件
export interface StatusEvent extends StreamEvent {
  type: 'status';
  data: {
    state: 'idle' | 'thinking' | 'working' | 'waiting' | 'error';
    task?: string;
    progress?: number;
    metrics?: {
      tokens: number;
      duration: number;
      actions: number;
    };
  };
}

// 结果流事件
export interface ResultEvent extends StreamEvent {
  type: 'result';
  data: {
    output: string;
    files?: string[];
    metrics: {
      tokens: number;
      duration: number;
      actions: number;
    };
    success: boolean;
  };
}

// 工作流事件
export interface WorkflowEvent extends StreamEvent {
  type: 'workflow';
  data: {
    nodeId: string;
    nodeName: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress?: number;
    message?: string;
  };
}

// 错误流事件
export interface ErrorEvent extends StreamEvent {
  type: 'error';
  data: {
    code: string;
    message: string;
    details?: any;
    recoverable: boolean;
  };
}

// 工作流启动检测事件
export interface WorkflowStartupCheckEvent extends StreamEvent {
  type: 'workflow-startup-check';
  data: {
    workflowId: string;
    overallStatus: 'checking' | 'success' | 'failed' | 'skipped';
    checks: StartupCheckItem[];
    canProceed: boolean;
    timestamp: number;
  };
}

// 启动检测项状态
export type StartupCheckItemStatus = 'pending' | 'checking' | 'success' | 'failed' | 'skipped' | 'warning';

// 启动检测项
export interface StartupCheckItem {
  step: string;
  status: StartupCheckItemStatus;
  details: string[];
  error?: string;
}

// WebSocket 连接状态
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// WebSocket 消息类型
export interface WebSocketMessage {
  type: 'event' | 'command' | 'ping' | 'pong';
  payload: StreamEvent | AgentCommand | null;
}

// 智能体指令
export interface AgentCommand {
  type: 'pause' | 'resume' | 'cancel' | 'input' | 'workflow' | 'subscribe' | 'unsubscribe';
  agentId: string;
  data?: any;
}

// ========== 工作流消息类型 ==========

// 工作流任务分配
export interface WorkflowTaskAssign {
  taskId: string;
  nodeId: string;
  nodeName: string;
  taskBrief: string;
  agentId: string;
  workflowId: string;
  instanceId: string;
  inputs?: Record<string, unknown>;
  timeout?: number;
}

// 工作流任务完成
export interface WorkflowTaskComplete {
  taskId: string;
  nodeId: string;
  agentId: string;
  success: boolean;
  outputs?: Record<string, unknown>;
  error?: string;
}

// 工作流任务失败
export interface WorkflowTaskFailed {
  taskId: string;
  nodeId: string;
  agentId: string;
  error: string;
}

// 工作流事件类型扩展
export type WorkflowEventType = 
  | 'workflow_task_assign'
  | 'workflow_task_query'
  | 'workflow_agent_wakeup'
  | 'workflow_node_complete'
  | 'workflow_state_change'
  | 'workflow_task_start'
  | 'workflow_task_error'
  | 'workflow_task_complete'
  | 'workflow_status_request'
  | 'workflow_node_progress';

// 工作流消息负载
export interface WorkflowMessagePayload {
  type: WorkflowEventType;
  agentId: string;
  timestamp: number;
  data: any;
}

// AHIVECORE SSE 事件
export interface AHIVECoreEvent {
  type: string;
  message?: string;
  delta?: string;
  itemId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  command?: string;
  callId?: string;
  output?: string;
  stream?: string;
  exitCode?: number;
  content?: string;
  toolCallsExecuted?: number;
  iterations?: number;
  timestamp?: number;
}