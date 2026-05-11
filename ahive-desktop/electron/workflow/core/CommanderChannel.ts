/**
 * 指挥官通信通道
 * 复用现有 WebSocket 服务器，实现工作流引擎与 AHIVECORE 指挥官的双向通信
 */

import { EventEmitter } from 'events';
import type { WebSocketServer } from '../../services/ahivecore/WebSocketServer';
import type { 
  WorkflowExecutionState, 
  NodeExecutionState,
  AgentStatusReport,
  CommanderMessage,
  TaskAssignMessage,
  TaskQueryMessage,
  StatusReportMessage,
  TaskCompleteMessage,
  AgentWakeupMessage,
} from '../types';

// 消息类型定义
export interface CommanderMessage {
  type: 'task_assign' | 'task_query' | 'status_report' | 'task_complete' | 'task_failed' | 'agent_wakeup';
  payload: any;
  timestamp: number;
  messageId: string;
}

// 任务分配消息
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

// 任务查询消息
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

// 状态报告消息
export interface StatusReportMessage {
  type: 'status_report';
  payload: AgentStatusReport;
  timestamp: number;
  messageId: string;
}

// 任务完成消息
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

// Agent 唤醒消息
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

/**
 * 指挥官通信通道配置
 */
export interface CommanderChannelConfig {
  wsServer: WebSocketServer;
  // WorkflowScheduler 传入的参数
  instanceId?: string;
  workflowId?: string;
  projectId?: string;
  onMessage?: (message: CommanderMessage) => void;
  // 可选参数
  heartbeatInterval?: number;  // 心跳间隔，默认 30 秒
  queryTimeout?: number;        // 查询超时，默认 60 秒
  maxRetries?: number;          // 最大重试次数，默认 3
  // WorkflowEngine 传入的参数
  onInquiry?: (message: CommanderMessage) => Promise<AgentStatusReport>;
  onTaskAssign?: (message: CommanderMessage) => Promise<void>;
}

/**
 * 指挥官通信通道
 * 负责工作流引擎与 AHIVECORE 指挥官之间的通信
 */
export class CommanderChannel extends EventEmitter {
  private wsServer: WebSocketServer;
  private heartbeatInterval: number;
  private queryTimeout: number;
  private maxRetries: number;
  
  // 实例信息
  private instanceId?: string;
  private workflowId?: string;
  private projectId?: string;
  private onMessage?: (message: CommanderMessage) => void;
  private onInquiry?: (message: CommanderMessage) => Promise<AgentStatusReport>;
  private onTaskAssign?: (message: CommanderMessage) => Promise<void>;
  
  // 待处理的查询
  private pendingQueries: Map<string, {
    resolve: (response: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();
  
  // 待处理的任务（用于异步等待任务完成）
  private pendingTasks: Map<string, {
    resolve: (result: { success: boolean; output: string; error?: string }) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();
  
  // 心跳定时器
  private heartbeatTimer: NodeJS.Timeout | null = null;
  
  // 指挥官状态
  private commanderStatus: 'online' | 'offline' | 'busy' = 'offline';
  private lastHeartbeat: number = 0;

  constructor(config: CommanderChannelConfig) {
    super();
    this.wsServer = config.wsServer;
    this.instanceId = config.instanceId;
    this.workflowId = config.workflowId;
    this.projectId = config.projectId;
    this.onMessage = config.onMessage;
    this.onInquiry = config.onInquiry;
    this.onTaskAssign = config.onTaskAssign;
    this.heartbeatInterval = config.heartbeatInterval || 30000;
    this.queryTimeout = config.queryTimeout || 60000;
    this.maxRetries = config.maxRetries || 3;
    
    this.setupListeners();
    this.startHeartbeat();
    
    console.log('[CommanderChannel] Initialized');
  }

  /**
   * 设置 WebSocket 事件监听
   */
  private setupListeners(): void {
    // 监听来自指挥官的消息（command 类型）
    this.wsServer.on('command', (command: any, clientId: string) => {
      this.handleCommand(command, clientId);
    });
    
    // 监听工作流事件（event 类型：task_complete, status_report 等）
    this.wsServer.on('workflow-event', (event: any, clientId?: string) => {
      this.handleWorkflowEvent(event, clientId);
    });
    
    // 监听客户端连接状态
    this.wsServer.on('client-connected', (clientId: string) => {
      console.log(`[CommanderChannel] Client connected: ${clientId}`);
      // 假设第一个连接的是指挥官（后续可以通过认证机制改进）
      if (this.commanderStatus === 'offline') {
        this.commanderStatus = 'online';
        this.emit('commander-online');
      }
    });
    
    this.wsServer.on('client-disconnected', (clientId: string) => {
      console.log(`[CommanderChannel] Client disconnected: ${clientId}`);
      // 检查是否还有其他客户端
      if (this.wsServer.getClientCount() === 0) {
        this.commanderStatus = 'offline';
        this.emit('commander-offline');
      }
    });
  }

  /**
   * 处理收到的命令
   */
  private handleCommand(command: any, clientId: string): void {
    console.log(`[CommanderChannel] Received command: ${command.type} from ${clientId}`);
    
    switch (command.type) {
      case 'status_report':
        this.handleStatusReport(command);
        break;
        
      case 'task_complete':
        this.handleTaskComplete(command);
        break;
        
      case 'task_failed':
        this.handleTaskFailed(command);
        break;
        
      case 'query_response':
        this.handleQueryResponse(command);
        break;
        
      case 'pong':
        this.handlePong(command);
        break;
        
      default:
        console.warn(`[CommanderChannel] Unknown command type: ${command.type}`);
    }
  }

  /**
   * 处理工作流事件（来自 AHIVECORE）
   */
  private handleWorkflowEvent(event: any, clientId: string): void {
    console.log(`[CommanderChannel] Received workflow event: ${event.type} from ${clientId}`);
    
    switch (event.type) {
      case 'task_complete':
        this.handleTaskCompleteEvent(event);
        break;
        
      case 'task_failed':
        this.handleTaskFailedEvent(event);
        break;
        
      case 'status_report':
        this.handleStatusReportEvent(event);
        break;
        
      case 'workflow_report':
        this.handleWorkflowReport(event);
        break;
        
      // 新增：任务拆解相关事件
      case 'task_assessment':
        this.handleTaskAssessment(event);
        break;
        
      case 'task_proposal':
        this.handleTaskProposal(event);
        break;
        
      case 'sub_task_complete':
        this.handleSubTaskComplete(event);
        break;
        
      case 'task_merge':
        this.handleTaskMerge(event);
        break;
        
      default:
        console.log(`[CommanderChannel] Ignoring workflow event: ${event.type}`);
    }
  }

  /**
   * 处理任务完成事件
   */
  private handleTaskCompleteEvent(event: any): void {
    const data = event.data;
    const { taskId, nodeId, agentId, success, outputs, error } = data;
    
    console.log(`[CommanderChannel] Task complete event: taskId=${taskId}, success=${success}`);
    
    // 如果有等待此任务的 Promise，resolve 它
    const pendingTask = this.pendingTasks.get(taskId);
    if (pendingTask) {
      if (pendingTask.timer) {
        clearTimeout(pendingTask.timer);  // 只有 timer 存在才清除
      }
      this.pendingTasks.delete(taskId);
      pendingTask.resolve({
        success,
        output: outputs?.output as string || JSON.stringify(outputs) || '',
        error,
      });
    }
    
    this.emit('task-complete', {
      taskId,
      nodeId,
      agentId,
      success,
      outputs,
      error,
    });
  }

  /**
   * 处理任务失败事件
   */
  private handleTaskFailedEvent(event: any): void {
    const data = event.data;
    const { taskId, nodeId, agentId, error } = data;
    
    console.log(`[CommanderChannel] Task failed event: taskId=${taskId}, error=${error}`);
    
    // 如果有等待此任务的 Promise，reject 它
    const pendingTask = this.pendingTasks.get(taskId);
    if (pendingTask) {
      if (pendingTask.timer) {
        clearTimeout(pendingTask.timer);  // 只有 timer 存在才清除
      }
      this.pendingTasks.delete(taskId);
      pendingTask.reject(new Error(error));
    }
    
    this.emit('task-failed', {
      taskId,
      nodeId,
      agentId,
      error,
    });
  }

  /**
   * 处理状态报告事件
   */
  private handleStatusReportEvent(event: any): void {
    const report = event.data;
    this.lastHeartbeat = Date.now();
    
    console.log(`[CommanderChannel] Status report event: taskId=${report.taskId}`);
    
    this.emit('status-report', report);
    
    // 如果有待处理的查询，检查是否匹配
    const pendingQuery = this.pendingQueries.get(report.taskId);
    if (pendingQuery) {
      clearTimeout(pendingQuery.timer);
      this.pendingQueries.delete(report.taskId);
      pendingQuery.resolve(report);
    }
  }

  /**
   * 处理 workflow_report 事件（来自 AHIVECORE 指挥官）
   * 将指挥官的汇报转换为前端已订阅的 workflow_task_* 事件
   */
  private handleWorkflowReport(event: any): void {
    const data = event.data;
    const { report_type, task_id, node_id, agent_id, success, progress, error, outputs } = data;
    
    console.log(`[CommanderChannel] workflow_report: type=${report_type}, task_id=${task_id}`);
    
    switch (report_type) {
      case 'task_ack':
        // Agent 确认接受任务 → 触发前端 workflow_task_start → Agent 开始工作动画
        this.notifyTaskStart({
          nodeId: node_id || '',
          nodeName: node_id || '',
          agentId: agent_id || '',
          agentName: agent_id || '',
          prompt: `Task ${task_id} acknowledged`,
        });
        break;
        
      case 'task_progress':
        // 任务进度更新 → 可选：触发前端进度事件
        console.log(`[CommanderChannel] Task progress: ${task_id} = ${progress}%`);
        break;
        
      case 'task_error':
        // 任务异常 → 触发前端 workflow_task_error → Agent 错误处理
        this.notifyTaskError({
          nodeId: node_id || '',
          nodeName: node_id || '',
          error: error || 'Unknown error',
        });
        break;
        
      case 'task_complete':
        // 任务完成 → 触发前端 workflow_task_complete → Agent 完成动画
        this.notifyTaskComplete({
          nodeId: node_id || '',
          nodeName: node_id || '',
          output: outputs?.output as string || JSON.stringify(outputs) || '',
        });
        break;
        
      // ========== 拆解相关消息处理 ==========
      
      case 'task_decompose':
        // 提案提交 → 触发前端 workflow_task_decompose 事件
        this.handleDecomposeReport(data);
        break;
        
      case 'task_decompose_approved':
        // 提案批准 → 触发前端 workflow_decompose_approved 事件
        this.handleDecomposeApprovedReport(data);
        break;
        
      case 'task_decompose_rejected':
        // 提案驳回 → 触发前端 workflow_decompose_rejected 事件
        this.handleDecomposeRejectedReport(data);
        break;
        
      case 'sub_task_start':
        // 子任务开始 → 触发前端 workflow_sub_task_start 事件
        this.handleSubTaskStartReport(data);
        break;
        
      case 'sub_task_complete':
        // 子任务完成 → 触发前端 workflow_sub_task_complete 事件
        this.handleSubTaskCompleteReport(data);
        break;
        
      case 'task_merge':
        // 任务合并 → 触发前端 workflow_task_merge 事件
        this.handleTaskMergeReport(data);
        break;
        
      default:
        console.warn(`[CommanderChannel] Unknown workflow_report type: ${report_type}`);
    }
  }

  /**
   * 处理状态报告
   */
  private handleStatusReport(command: StatusReportMessage): void {
    const report = command.payload;
    this.lastHeartbeat = Date.now();
    
    this.emit('status-report', report);
    
    // 如果有待处理的查询，检查是否匹配
    const pendingQuery = this.pendingQueries.get(report.taskId);
    if (pendingQuery) {
      clearTimeout(pendingQuery.timer);
      this.pendingQueries.delete(report.taskId);
      pendingQuery.resolve(report);
    }
  }

  /**
   * 处理任务完成
   */
  private handleTaskComplete(command: TaskCompleteMessage): void {
    const { taskId, nodeId, agentId, success, outputs, error } = command.payload;
    
    // 如果有等待此任务的 Promise，resolve 它
    const pendingTask = this.pendingTasks.get(taskId);
    if (pendingTask) {
      if (pendingTask.timer) {
        clearTimeout(pendingTask.timer);  // 只有 timer 存在才清除
      }
      this.pendingTasks.delete(taskId);
      pendingTask.resolve({
        success,
        output: outputs?.output as string || JSON.stringify(outputs) || '',
        error,
      });
    }
    
    this.emit('task-complete', {
      taskId,
      nodeId,
      agentId,
      success,
      outputs,
      error,
    });
  }

  /**
   * 处理任务失败
   */
  private handleTaskFailed(command: any): void {
    const { taskId, nodeId, agentId, error } = command.payload;
    
    // 如果有等待此任务的 Promise，reject 它
    const pendingTask = this.pendingTasks.get(taskId);
    if (pendingTask) {
      clearTimeout(pendingTask.timer);
      this.pendingTasks.delete(taskId);
      pendingTask.reject(new Error(error || 'Task failed'));
    }
    
    this.emit('task-failed', {
      taskId,
      nodeId,
      agentId,
      error,
    });
  }

  /**
   * 处理查询响应
   */
  private handleQueryResponse(command: any): void {
    const { queryId, response } = command.payload;
    
    const pending = this.pendingQueries.get(queryId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingQueries.delete(queryId);
      pending.resolve(response);
    }
  }

  /**
   * 处理心跳响应
   */
  private handlePong(command: any): void {
    this.lastHeartbeat = Date.now();
    this.commanderStatus = 'online';
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      // 检查指挥官是否在线
      if (this.wsServer.getClientCount() > 0) {
        if (Date.now() - this.lastHeartbeat > this.heartbeatInterval * 2) {
          // 超时未收到心跳，标记为离线
          if (this.commanderStatus === 'online') {
            this.commanderStatus = 'offline';
            this.emit('commander-offline');
          }
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 分配任务给指挥官
   */
  async assignTask(
    taskId: string,
    nodeId: string,
    nodeName: string,
    taskBrief: string,
    targetAgentId: string,
    workflowId: string,
    instanceId: string,
    inputs?: Record<string, unknown>,
    timeout?: number
  ): Promise<void> {
    // 🔍 检查客户端连接状态
    const clientCount = this.wsServer.getClientCount();
    if (clientCount === 0) {
      console.warn(`[CommanderChannel] ⚠️ 没有客户端连接！任务 ${taskId} 无法送达 AHIVECORE`);
      console.warn(`[CommanderChannel] 请确保 AHIVECORE 已启动并连接到 WebSocket Server (端口 3005)`);
      console.warn(`[CommanderChannel] 当前 commanderStatus: ${this.commanderStatus}`);
    }
    
    // 广播给所有客户端（指挥官会处理）
    // 注意：broadcastAll 期望 StreamEvent 格式，会自动包装成 WebSocketMessage
    // data 字段直接传入任务数据，不需要额外包装
    this.wsServer.broadcastAll({
      type: 'workflow_task_assign',
      agentId: 'ahivecore',
      timestamp: Date.now(),
      data: {
        taskId,
        nodeId,
        nodeName,
        taskBrief,
        agentId: targetAgentId,
        workflowId,
        instanceId,
        inputs,
        timeout,
      },
    });
    
    console.log(`[CommanderChannel] Task assigned: ${taskId} to agent ${targetAgentId} (clients: ${clientCount})`);
  }

  /**
   * 等待任务完成（异步模式）
   * 与 assignTask 配合使用，实现异步任务分发和等待
   */
  waitForTaskComplete(
    taskId: string,
    timeout: number = 0  // 默认 0 表示无超时,永久等待
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      
      // 只有 timeout > 0 才设置超时定时器
      if (timeout > 0) {
        timer = setTimeout(() => {
          this.pendingTasks.delete(taskId);
          reject(new Error(`Task timeout: ${taskId}`));
        }, timeout);
      }

      this.pendingTasks.set(taskId, { resolve, reject, timer });
    });
  }

  /**
   * 查询任务状态
   */
  async queryTaskStatus(
    taskId: string,
    nodeId: string,
    agentId: string,
    queryBrief: string
  ): Promise<AgentStatusReport> {
    const queryId = this.generateMessageId();
    
    const message: TaskQueryMessage = {
      type: 'task_query',
      payload: {
        taskId,
        nodeId,
        agentId,
        queryBrief,
      },
      timestamp: Date.now(),
      messageId: queryId,
    };
    
    return new Promise((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.pendingQueries.delete(queryId);
        reject(new Error(`Query timeout for task ${taskId}`));
      }, this.queryTimeout);
      
      // 保存待处理查询
      this.pendingQueries.set(queryId, {
        resolve: (response) => resolve(response as AgentStatusReport),
        reject,
        timer,
      });
      
      // 发送查询
      this.wsServer.broadcastAll({
        type: 'workflow_task_query',
        agentId: 'ahivecore',
        timestamp: Date.now(),
        data: message,
      });
    });
  }

  /**
   * 唤醒 Agent
   */
  async wakeupAgent(
    agentId: string,
    taskBrief: string,
    lastState?: string,
    projectPath?: string
  ): Promise<void> {
    const message: AgentWakeupMessage = {
      type: 'agent_wakeup',
      payload: {
        agentId,
        taskBrief,
        lastState,
        projectPath: projectPath || '',
      },
      timestamp: Date.now(),
      messageId: this.generateMessageId(),
    };
    
    this.wsServer.broadcastAll({
      type: 'workflow_agent_wakeup',
      agentId: 'commander',
      timestamp: Date.now(),
      data: message.payload,
    });
    
    console.log(`[CommanderChannel] Agent wakeup: ${agentId}`);
  }

  /**
   * 通知节点完成
   */
  notifyNodeComplete(
    nodeId: string,
    nodeName: string,
    workflowId: string,
    instanceId: string,
    success: boolean,
    outputs?: Record<string, unknown>
  ): void {
    this.wsServer.broadcastAll({
      type: 'workflow_node_complete',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data: {
        nodeId,
        nodeName,
        workflowId,
        instanceId,
        success,
        outputs,
      },
    });
  }

  /**
   * 通知工作流状态变更
   */
  notifyWorkflowState(state: WorkflowExecutionState): void {
    this.wsServer.broadcastAll({
      type: 'workflow_state_change',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data: state,
    });
  }

  /**
   * 获取指挥官状态
   */
  getCommanderStatus(): 'online' | 'offline' | 'busy' {
    return this.commanderStatus;
  }

  /**
   * 检查指挥官是否在线
   */
  isCommanderOnline(): boolean {
    return this.commanderStatus === 'online' || this.commanderStatus === 'busy';
  }

  /**
   * 请求状态更新
   */
  requestStatusUpdate(context: any): void {
    this.wsServer.broadcastAll({
      type: 'workflow_status_request',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data: {
        instanceId: context.instanceId,
        workflowId: context.workflowId,
      },
    });
  }

  /**
   * 通知任务开始
   */
  notifyTaskStart(data: {
    nodeId: string;
    nodeName: string;
    agentId: string;
    agentName: string;
    prompt: string;
  }): void {
    this.wsServer.broadcastAll({
      type: 'workflow_task_start',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data,
    });
    console.log(`[CommanderChannel] Task started: ${data.nodeName} (${data.agentName})`);
  }

  /**
   * 通知任务错误
   */
  notifyTaskError(data: {
    nodeId: string;
    nodeName: string;
    error: string;
  }): void {
    this.wsServer.broadcastAll({
      type: 'workflow_task_error',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data,
    });
    console.log(`[CommanderChannel] Task error: ${data.nodeName} - ${data.error}`);
  }

  /**
   * 通知任务完成
   */
  notifyTaskComplete(data: {
    nodeId: string;
    nodeName: string;
    output: string;
  }): void {
    this.wsServer.broadcastAll({
      type: 'workflow_task_complete',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data,
    });
    console.log(`[CommanderChannel] Task completed: ${data.nodeName}`);
  }

  // ==================== 任务拆解相关方法 ====================

  /**
   * 处理任务评估消息
   */
  private handleTaskAssessment(event: any): void {
    const { taskId, nodeId, assessment, estimatedEffort, needsDecomposition, reason } = event.data;
    
    console.log(`[CommanderChannel] Task assessment: taskId=${taskId}, needsDecomposition=${needsDecomposition}`);
    
    this.emit('task-assessment', {
      taskId,
      nodeId,
      assessment,
      estimatedEffort,
      needsDecomposition,
      reason,
    });
  }

  /**
   * 处理拆解提案消息
   */
  private handleTaskProposal(event: any): void {
    const { taskId, nodeId, proposalId, planPath, subTaskCount, estimatedTime, riskLevel } = event.data;
    
    console.log(`[CommanderChannel] Task proposal: proposalId=${proposalId}, subTasks=${subTaskCount}`);
    
    this.emit('task-proposal', {
      taskId,
      nodeId,
      proposalId,
      planPath,
      subTaskCount,
      estimatedTime,
      riskLevel,
    });
  }

  /**
   * 处理拆解审批结果消息
   */
  private handleProposalReview(event: any): void {
    const { proposalId, status, notes, authorizedSubAgents, reason, suggestions } = event.data;
    
    console.log(`[CommanderChannel] Proposal review: proposalId=${proposalId}, status=${status}`);
    
    this.emit('proposal-review', {
      proposalId,
      status, // 'APPROVED' | 'REJECTED'
      notes,
      authorizedSubAgents,
      reason,
      suggestions,
    });
  }

  /**
   * 处理子任务完成消息
   */
  private handleSubTaskComplete(event: any): void {
    const { parentTaskId, subTaskId, status, outputs, error } = event.data;
    
    console.log(`[CommanderChannel] Sub-task complete: subTaskId=${subTaskId}, status=${status}`);
    
    this.emit('sub-task-complete', {
      parentTaskId,
      subTaskId,
      status,
      outputs,
      error,
    });
  }

  /**
   * 处理合并汇报消息
   */
  private handleMergeReport(event: any): void {
    const { taskId, nodeId, subTasksCompleted, mergeResult, outputs } = event.data;
    
    console.log(`[CommanderChannel] Merge report: taskId=${taskId}, completed=${subTasksCompleted}`);
    
    this.emit('merge-report', {
      taskId,
      nodeId,
      subTasksCompleted,
      mergeResult,
      outputs,
    });
  }

  /**
   * 发送拆解审批结果给 Agent
   */
  sendProposalReview(data: {
    proposalId: string;
    status: 'APPROVED' | 'REJECTED';
    notes?: string;
    authorizedSubAgents?: number;
    reason?: string;
    suggestions?: string;
  }): void {
    this.wsServer.broadcastAll({
      type: 'workflow_proposal_review',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data,
    });
    console.log(`[CommanderChannel] Proposal review sent: ${data.proposalId} -> ${data.status}`);
  }

  /**
   * 通知拆解状态变更（前端可视化）
   */
  notifyDecompositionStatus(data: {
    taskId: string;
    nodeId: string;
    proposalId?: string;
    status: 'assessing' | 'proposing' | 'reviewing' | 'approved' | 'rejected' | 'executing' | 'merged';
    subTasks?: Array<{ id: string; name: string; status: string }>;
  }): void {
    this.wsServer.broadcastAll({
      type: 'workflow_decomposition_status',
      agentId: 'workflow-engine',
      timestamp: Date.now(),
      data,
    });
    console.log(`[CommanderChannel] Decomposition status: ${data.taskId} -> ${data.status}`);
  }

  /**
   * 生成消息 ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stopHeartbeat();
    
    // 清理待处理的查询
    for (const [queryId, pending] of this.pendingQueries) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Channel destroyed'));
    }
    this.pendingQueries.clear();
    
    // 清理待处理的任务
    for (const [taskId, pending] of this.pendingTasks) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Channel destroyed'));
    }
    this.pendingTasks.clear();
    
    this.removeAllListeners();
    console.log('[CommanderChannel] Destroyed');
  }
}

export default CommanderChannel;