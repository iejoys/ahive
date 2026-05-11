/**
 * 工作流监控服务 (Electron 版本)
 * 负责智能体连接状态监控、超时检测、中断恢复
 * 
 * 功能:
 * - 智能体连接状态监控 (online/offline/busy/idle)
 * - 心跳检测与超时标记
 * - 任务状态跟踪
 * - 超时警报 (warning/critical)
 * - 中断恢复支持（持久化）
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import {
  getInterruptions,
  saveInterruption,
  markInterruptionRecovered,
  type InterruptionRecordData,
} from '../storage';

// ==================== 类型定义 ====================

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

/** 任务状态 */
export type TaskStatus = 'pending' | 'in_progress' | 'waiting_review' | 'completed' | 'failed';

/** 任务监控信息 */
export interface TaskMonitorInfo {
  nodeId: string;
  nodeName: string;
  workflowId: string;
  status: TaskStatus;
  executor?: string;
  startedAt?: string;
  expectedDuration?: number;  // 预期时长（分钟）
  lastUpdate: string;
  progress?: number;
}

/** 超时警报 */
export interface TimeoutAlert {
  nodeId: string;
  workflowId: string;
  type: 'warning' | 'critical';
  overdue: number;  // 超时时长（分钟）
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

/** 监控事件 */
export type MonitorEvent = 
  | 'agent_online'
  | 'agent_offline'
  | 'agent_busy'
  | 'agent_idle'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'timeout_warning'
  | 'timeout_critical'
  | 'interruption'
  | 'recovery';

/** 监控事件数据 */
export interface MonitorEventData {
  type: MonitorEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

// ==================== 监控服务 ====================

export class WorkflowMonitor extends EventEmitter {
  private agentConnections: Map<string, AgentConnectionInfo> = new Map();
  private taskStates: Map<string, TaskMonitorInfo> = new Map();
  private timeoutAlerts: TimeoutAlert[] = [];
  private interruptions: InterruptionRecord[] = [];
  
  private heartbeatTimeout: number;  // 心跳超时（毫秒）
  private checkInterval: number;     // 检查间隔（毫秒）
  private checkTimer?: NodeJS.Timeout;
  
  constructor(options: {
    heartbeatTimeout?: number;  // 默认 2 分钟
    checkInterval?: number;     // 默认 30 秒
  } = {}) {
    super();
    this.heartbeatTimeout = options.heartbeatTimeout || 120000;  // 2 分钟
    this.checkInterval = options.checkInterval || 30000;         // 30 秒
  }

  /**
   * 启动监控
   */
  start(): void {
    if (this.checkTimer) return;
    
    // 加载持久化的中断记录
    this.loadPersistedInterruptions();
    
    this.checkTimer = setInterval(() => {
      this.checkAgentConnections();
      this.checkTaskTimeouts();
    }, this.checkInterval);
    
    log.info('[WorkflowMonitor] Started');
  }

  /**
   * 加载持久化的中断记录
   */
  private loadPersistedInterruptions(): void {
    try {
      const persisted = getInterruptions();
      // 只加载未恢复的记录
      this.interruptions = persisted
        .filter(i => !i.recoveredAt)
        .map(i => ({
          nodeId: i.nodeId,
          workflowId: i.workflowId,
          agentId: i.agentId,
          reason: i.reason,
          interruptedAt: i.interruptedAt,
          recoveredAt: i.recoveredAt,
          taskState: i.taskState as TaskMonitorInfo | undefined,
        }));
      log.info(`[WorkflowMonitor] Loaded ${this.interruptions.length} unrecovered interruptions`);
    } catch (error) {
      log.error('[WorkflowMonitor] Failed to load persisted interruptions:', error);
      this.interruptions = [];
    }
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    log.info('[WorkflowMonitor] Stopped');
  }

  // ==================== 智能体连接管理 ====================

  /**
   * 注册智能体
   */
  registerAgent(agent: {
    agentId: string;
    agentName: string;
    workspace?: string;
  }): void {
    const info: AgentConnectionInfo = {
      agentId: agent.agentId,
      agentName: agent.agentName,
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
      workspace: agent.workspace,
    };
    
    this.agentConnections.set(agent.agentId, info);
    
    this.emit('agent_online', {
      type: 'agent_online',
      timestamp: new Date().toISOString(),
      data: { agentId: agent.agentId, agentName: agent.agentName },
    });
    
    log.info(`[WorkflowMonitor] Agent registered: ${agent.agentName} (${agent.agentId})`);
  }

  /**
   * 注销智能体
   */
  unregisterAgent(agentId: string): void {
    const info = this.agentConnections.get(agentId);
    this.agentConnections.delete(agentId);
    
    if (info) {
      this.emit('agent_offline', {
        type: 'agent_offline',
        timestamp: new Date().toISOString(),
        data: { agentId, agentName: info.agentName },
      });
    }
    
    log.info(`[WorkflowMonitor] Agent unregistered: ${agentId}`);
  }

  /**
   * 更新心跳
   */
  updateHeartbeat(agentId: string): void {
    const info = this.agentConnections.get(agentId);
    if (info) {
      info.lastHeartbeat = new Date().toISOString();
      
      // 如果之前是离线，现在恢复
      if (info.status === 'offline') {
        info.status = 'idle';
        this.emit('agent_online', {
          type: 'agent_online',
          timestamp: new Date().toISOString(),
          data: { agentId, agentName: info.agentName, recovered: true },
        });
      }
    }
  }

  /**
   * 更新智能体状态
   */
  updateAgentStatus(agentId: string, status: AgentConnectionStatus, currentTask?: string): void {
    const info = this.agentConnections.get(agentId);
    if (!info) return;
    
    const oldStatus = info.status;
    info.status = status;
    info.lastHeartbeat = new Date().toISOString();
    
    if (currentTask) {
      info.currentTask = currentTask;
      if (status === 'busy' && !info.currentTaskStartedAt) {
        info.currentTaskStartedAt = new Date().toISOString();
      }
    } else if (status === 'idle') {
      info.currentTask = undefined;
      info.currentTaskStartedAt = undefined;
    }
    
    // 发送状态变更事件
    if (oldStatus !== status) {
      const eventType: MonitorEvent = status === 'offline' ? 'agent_offline' : 
                                       status === 'busy' ? 'agent_busy' : 'agent_idle';
      this.emit(eventType, {
        type: eventType,
        timestamp: new Date().toISOString(),
        data: { agentId, agentName: info.agentName, oldStatus, newStatus: status, currentTask },
      });
    }
  }

  /**
   * 获取智能体连接信息
   */
  getAgentConnection(agentId: string): AgentConnectionInfo | undefined {
    return this.agentConnections.get(agentId);
  }

  /**
   * 获取所有智能体连接
   */
  getAllAgentConnections(): AgentConnectionInfo[] {
    return Array.from(this.agentConnections.values());
  }

  /**
   * 检查智能体连接状态
   */
  private checkAgentConnections(): void {
    const now = Date.now();
    
    for (const [agentId, info] of this.agentConnections) {
      if (info.status === 'offline') continue;
      
      const lastHeartbeat = new Date(info.lastHeartbeat).getTime();
      const elapsed = now - lastHeartbeat;
      
      if (elapsed > this.heartbeatTimeout) {
        // 标记为离线
        const oldStatus = info.status;
        info.status = 'offline';
        
        // 记录中断
        if (info.currentTask) {
          this.recordInterruption({
            nodeId: info.currentTask,
            workflowId: 'unknown',
            agentId,
            reason: 'heartbeat_timeout',
            interruptedAt: new Date().toISOString(),
          });
        }
        
        this.emit('agent_offline', {
          type: 'agent_offline',
          timestamp: new Date().toISOString(),
          data: { 
            agentId, 
            agentName: info.agentName, 
            oldStatus,
            elapsed: Math.floor(elapsed / 1000),
            currentTask: info.currentTask,
          },
        });
        
        log.warn(`[WorkflowMonitor] Agent ${info.agentName} marked offline (no heartbeat for ${Math.floor(elapsed / 1000)}s)`);
      }
    }
  }

  // ==================== 任务状态管理 ====================

  /**
   * 更新任务状态
   */
  updateTaskStatus(task: {
    nodeId: string;
    nodeName: string;
    workflowId: string;
    status: TaskStatus;
    executor?: string;
    expectedDuration?: number;
    progress?: number;
  }): void {
    const key = `${task.workflowId}_${task.nodeId}`;
    const now = new Date().toISOString();
    
    const existingTask = this.taskStates.get(key);
    
    const taskInfo: TaskMonitorInfo = {
      nodeId: task.nodeId,
      nodeName: task.nodeName,
      workflowId: task.workflowId,
      status: task.status,
      executor: task.executor,
      startedAt: task.status === 'in_progress' && !existingTask?.startedAt 
        ? now 
        : existingTask?.startedAt,
      expectedDuration: task.expectedDuration,
      lastUpdate: now,
      progress: task.progress,
    };
    
    this.taskStates.set(key, taskInfo);
    
    // 清除超时警报（如果任务已完成）
    if (task.status === 'completed' || task.status === 'failed') {
      this.timeoutAlerts = this.timeoutAlerts.filter(
        a => !(a.nodeId === task.nodeId && a.workflowId === task.workflowId)
      );
    }
    
    // 发送事件
    const eventType: MonitorEvent = task.status === 'in_progress' ? 'task_started' :
                                     task.status === 'completed' ? 'task_completed' :
                                     task.status === 'failed' ? 'task_failed' : 'task_started';
    
    this.emit(eventType, {
      type: eventType,
      timestamp: now,
      data: { ...taskInfo },
    });
    
    log.info(`[WorkflowMonitor] Task ${task.nodeName} (${task.nodeId}) status: ${task.status}`);
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(workflowId: string, nodeId: string): TaskMonitorInfo | undefined {
    return this.taskStates.get(`${workflowId}_${nodeId}`);
  }

  /**
   * 获取工作流的所有任务
   */
  getWorkflowTasks(workflowId: string): TaskMonitorInfo[] {
    return Array.from(this.taskStates.values()).filter(t => t.workflowId === workflowId);
  }

  /**
   * 检查任务超时
   */
  private checkTaskTimeouts(): void {
    const now = Date.now();
    
    for (const [key, task] of this.taskStates) {
      if (task.status !== 'in_progress') continue;
      if (!task.startedAt || !task.expectedDuration) continue;
      
      const startedAt = new Date(task.startedAt).getTime();
      const elapsed = (now - startedAt) / 60000;  // 分钟
      const expected = task.expectedDuration;
      
      // 检查是否已存在警报
      const existingAlert = this.timeoutAlerts.find(
        a => a.nodeId === task.nodeId && a.workflowId === task.workflowId
      );
      
      // 超过预期时长 100% - critical
      if (elapsed >= expected) {
        if (!existingAlert || existingAlert.type === 'warning') {
          const alert: TimeoutAlert = {
            nodeId: task.nodeId,
            workflowId: task.workflowId,
            type: 'critical',
            overdue: Math.floor(elapsed - expected),
            alertedAt: new Date().toISOString(),
            executor: task.executor,
          };
          
          this.timeoutAlerts = this.timeoutAlerts.filter(
            a => !(a.nodeId === task.nodeId && a.workflowId === task.workflowId)
          );
          this.timeoutAlerts.push(alert);
          
          this.emit('timeout_critical', {
            type: 'timeout_critical',
            timestamp: new Date().toISOString(),
            data: { 
              nodeId: task.nodeId, 
              nodeName: task.nodeName,
              workflowId: task.workflowId,
              overdue: alert.overdue,
              executor: task.executor,
            },
          });
        }
      }
      // 超过预期时长 50% - warning
      else if (elapsed >= expected * 0.5 && (!existingAlert || existingAlert.type !== 'critical')) {
        if (!existingAlert) {
          const alert: TimeoutAlert = {
            nodeId: task.nodeId,
            workflowId: task.workflowId,
            type: 'warning',
            overdue: Math.floor(elapsed - expected * 0.5),
            alertedAt: new Date().toISOString(),
            executor: task.executor,
          };
          
          this.timeoutAlerts.push(alert);
          
          this.emit('timeout_warning', {
            type: 'timeout_warning',
            timestamp: new Date().toISOString(),
            data: { 
              nodeId: task.nodeId, 
              nodeName: task.nodeName,
              workflowId: task.workflowId,
              expected: expected,
              elapsed: Math.floor(elapsed),
              executor: task.executor,
            },
          });
        }
      }
    }
  }

  // ==================== 中断恢复 ====================

  /**
   * 记录中断
   */
  recordInterruption(interruption: Omit<InterruptionRecord, 'taskState'>): void {
    const taskState = this.taskStates.get(`${interruption.workflowId}_${interruption.nodeId}`);
    
    const record: InterruptionRecord = {
      ...interruption,
      taskState,
    };
    
    this.interruptions.push(record);
    
    // 持久化到文件系统
    const persistenceRecord: InterruptionRecordData = {
      id: `${interruption.workflowId}_${interruption.nodeId}_${Date.now()}`,
      nodeId: interruption.nodeId,
      workflowId: interruption.workflowId,
      agentId: interruption.agentId,
      reason: interruption.reason,
      interruptedAt: interruption.interruptedAt,
      taskState: taskState ? {
        nodeId: taskState.nodeId,
        nodeName: taskState.nodeName,
        workflowId: taskState.workflowId,
        status: taskState.status,
        executor: taskState.executor,
        startedAt: taskState.startedAt,
        expectedDuration: taskState.expectedDuration,
        progress: taskState.progress,
      } : undefined,
    };
    
    saveInterruption(persistenceRecord);
    
    this.emit('interruption', {
      type: 'interruption',
      timestamp: new Date().toISOString(),
      data: record,
    });
    
    log.warn(`[WorkflowMonitor] Interruption recorded and persisted: ${interruption.agentId} on ${interruption.nodeId}`);
  }

  /**
   * 恢复智能体
   */
  recoverAgent(agentId: string): InterruptionRecord | undefined {
    const interruption = this.interruptions
      .filter(i => i.agentId === agentId && !i.recoveredAt)
      .sort((a, b) => new Date(b.interruptedAt).getTime() - new Date(a.interruptedAt).getTime())[0];
    
    if (interruption) {
      interruption.recoveredAt = new Date().toISOString();
      
      // 更新持久化记录
      const persisted = getInterruptions();
      const persistedRecord = persisted.find(
        i => i.agentId === agentId && 
             i.nodeId === interruption.nodeId && 
             i.workflowId === interruption.workflowId &&
             !i.recoveredAt
      );
      if (persistedRecord) {
        markInterruptionRecovered(persistedRecord.id);
      }
      
      this.emit('recovery', {
        type: 'recovery',
        timestamp: new Date().toISOString(),
        data: {
          agentId,
          nodeId: interruption.nodeId,
          workflowId: interruption.workflowId,
          taskState: interruption.taskState,
        },
      });
      
      log.info(`[WorkflowMonitor] Agent ${agentId} recovered`);
    }
    
    return interruption;
  }

  /**
   * 获取恢复信息
   */
  getRecoveryInfo(agentId: string): {
    currentTask?: TaskMonitorInfo;
    interruption?: InterruptionRecord;
    nextSteps: string[];
  } {
    const agentInfo = this.agentConnections.get(agentId);
    const interruption = this.interruptions
      .filter(i => i.agentId === agentId)
      .sort((a, b) => new Date(b.interruptedAt).getTime() - new Date(a.interruptedAt).getTime())[0];
    
    const nextSteps: string[] = [];
    
    if (interruption?.taskState) {
      nextSteps.push(`继续执行任务: ${interruption.taskState.nodeName}`);
      if (interruption.taskState.executor) {
        nextSteps.push(`任务执行者: ${interruption.taskState.executor}`);
      }
    }
    
    return {
      currentTask: agentInfo?.currentTask 
        ? this.taskStates.get(`${agentInfo.workspace || 'default'}_${agentInfo.currentTask}`)
        : undefined,
      interruption,
      nextSteps,
    };
  }

  // ==================== 状态查询 ====================

  /**
   * 获取完整监控状态
   */
  getState(): MonitorState {
    return {
      agentConnections: this.getAllAgentConnections(),
      taskStates: Array.from(this.taskStates.values()),
      timeoutAlerts: [...this.timeoutAlerts],
      interruptions: [...this.interruptions],
    };
  }

  /**
   * 清理过期数据
   */
  cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;
    
    // 清理已完成的任务
    for (const [key, task] of this.taskStates) {
      if (task.status === 'completed' || task.status === 'failed') {
        const lastUpdate = new Date(task.lastUpdate).getTime();
        if (lastUpdate < cutoff) {
          this.taskStates.delete(key);
        }
      }
    }
    
    // 清理旧的中断记录
    this.interruptions = this.interruptions.filter(i => {
      const interruptedAt = new Date(i.interruptedAt).getTime();
      return interruptedAt >= cutoff;
    });
    
    // 清理旧的超时警报
    this.timeoutAlerts = this.timeoutAlerts.filter(a => {
      const alertedAt = new Date(a.alertedAt).getTime();
      return alertedAt >= cutoff;
    });
    
    log.info('[WorkflowMonitor] Cleanup completed');
  }
}

// 单例导出
export const workflowMonitor = new WorkflowMonitor();