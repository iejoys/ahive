/**
 * Agent 动画状态管理
 * 用于 3D 世界中小人的动画表现
 */

import { EventEmitter } from 'events';

/**
 * Agent 动画状态
 */
export type AgentAnimationState = 
  | 'idle'       // 空闲/偷懒
  | 'working'    // 工作中
  | 'thinking'   // 思考中
  | 'talking'    // 与指挥官对话
  | 'walking'    // 移动中
  | 'celebrating'// 庆祝/完成
  | 'error';     // 错误状态

/**
 * Agent 动画配置
 */
export interface AgentAnimationConfig {
  agentId: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: number;
}

/**
 * Agent 动画事件
 */
export interface AgentAnimationEvent {
  type: 'state-change' | 'position-update' | 'action' | 'expression';
  agentId: string;
  timestamp: number;
  data: {
    previousState?: AgentAnimationState;
    currentState?: AgentAnimationState;
    position?: { x: number; y: number; z: number };
    action?: string;
    expression?: string;
    duration?: number;
  };
}

/**
 * Agent 动画状态数据
 */
export interface AgentAnimationData {
  agentId: string;
  state: AgentAnimationState;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: number;
  currentAction: string | null;
  expression: string;
  lastUpdate: number;
  stateStartTime: number;
  animationProgress: number; // 0-1 动画进度
}

/**
 * 动画动作定义
 */
export const ANIMATION_ACTIONS: Record<AgentAnimationState, string[]> = {
  idle: ['idle', 'stretch', 'yawn', 'look_around', 'check_phone'],
  working: ['typing', 'reading', 'drawing', 'analyzing', 'coding'],
  thinking: ['chin_scratch', 'head_tilt', 'pacing', 'looking_up'],
  talking: ['gesturing', 'nodding', 'explaining', 'listening'],
  walking: ['walk', 'run', 'jog'],
  celebrating: ['cheer', 'clap', 'jump', 'fist_pump'],
  error: ['head_shake', 'sigh', 'confused', 'frustrated'],
};

/**
 * 表情定义
 */
export const ANIMATION_EXPRESSIONS: Record<AgentAnimationState, string[]> = {
  idle: ['neutral', 'bored', 'sleepy', 'relaxed'],
  working: ['focused', 'serious', 'determined', 'concentrated'],
  thinking: ['thoughtful', 'curious', 'puzzled', 'wondering'],
  talking: ['friendly', 'engaged', 'enthusiastic', 'attentive'],
  walking: ['neutral', 'hurried', 'casual'],
  celebrating: ['happy', 'excited', 'proud', 'joyful'],
  error: ['worried', 'stressed', 'confused', 'frustrated'],
};

/**
 * Agent 动画管理器
 * 管理所有 Agent 的动画状态，并通过 WebSocket 广播给 3D 世界
 */
export class AgentAnimationManager extends EventEmitter {
  private agents: Map<string, AgentAnimationData> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private broadcastCallback: ((event: AgentAnimationEvent) => void) | null = null;
  
  // 配置
  private config = {
    updateFrequency: 100, // 动画更新频率 (ms)
    idleActionInterval: 5000, // 空闲时随机动作间隔 (ms)
    workingActionInterval: 10000, // 工作时动作间隔 (ms)
    stateMinDuration: 2000, // 状态最小持续时间 (ms)
  };

  constructor() {
    super();
    console.log('[AgentAnimationManager] Created');
  }

  /**
   * 设置广播回调
   */
  setBroadcastCallback(callback: (event: AgentAnimationEvent) => void): void {
    this.broadcastCallback = callback;
  }

  /**
   * 注册 Agent
   */
  registerAgent(config: AgentAnimationConfig): void {
    const data: AgentAnimationData = {
      agentId: config.agentId,
      state: 'idle',
      position: config.position,
      rotation: config.rotation || { x: 0, y: 0, z: 0 },
      scale: config.scale || 1,
      currentAction: null,
      expression: 'neutral',
      lastUpdate: Date.now(),
      stateStartTime: Date.now(),
      animationProgress: 0,
    };

    this.agents.set(config.agentId, data);
    console.log(`[AgentAnimationManager] Registered agent: ${config.agentId}`);
  }

  /**
   * 注销 Agent
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    console.log(`[AgentAnimationManager] Unregistered agent: ${agentId}`);
  }

  /**
   * 更新 Agent 状态
   */
  updateState(agentId: string, newState: AgentAnimationState): void {
    let agent = this.agents.get(agentId);
    
    // 如果智能体未注册，自动注册
    if (!agent) {
      console.log(`[AgentAnimationManager] Auto-registering agent: ${agentId}`);
      this.registerAgent({
        agentId,
        position: { x: 0, y: 0, z: 0 },
      });
      agent = this.agents.get(agentId);
    }

    const previousState = agent!.state;
    
    // 检查状态最小持续时间
    const stateDuration = Date.now() - agent!.stateStartTime;
    if (stateDuration < this.config.stateMinDuration && previousState !== newState) {
      console.log(`[AgentAnimationManager] State change too fast, ignoring: ${agentId}`);
      return;
    }

    agent!.state = newState;
    agent!.stateStartTime = Date.now();
    agent!.animationProgress = 0;
    agent!.lastUpdate = Date.now();

    // 随机选择动作和表情
    agent!.currentAction = this.getRandomAction(newState);
    agent!.expression = this.getRandomExpression(newState);

    // 广播状态变化
    const event: AgentAnimationEvent = {
      type: 'state-change',
      agentId,
      timestamp: Date.now(),
      data: {
        previousState,
        currentState: newState,
        action: agent!.currentAction,
        expression: agent!.expression,
      },
    };

    this.broadcast(event);
    this.emit('state-change', event);

    console.log(`[AgentAnimationManager] Agent ${agentId} state: ${previousState} -> ${newState}`);
  }

  /**
   * 更新 Agent 位置
   */
  updatePosition(agentId: string, position: { x: number; y: number; z: number }): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.position = position;
    agent.lastUpdate = Date.now();

    const event: AgentAnimationEvent = {
      type: 'position-update',
      agentId,
      timestamp: Date.now(),
      data: { position },
    };

    this.broadcast(event);
  }

  /**
   * 触发特定动作
   */
  triggerAction(agentId: string, action: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.currentAction = action;
    agent.lastUpdate = Date.now();

    const event: AgentAnimationEvent = {
      type: 'action',
      agentId,
      timestamp: Date.now(),
      data: { action },
    };

    this.broadcast(event);
  }

  /**
   * 设置表情
   */
  setExpression(agentId: string, expression: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.expression = expression;
    agent.lastUpdate = Date.now();

    const event: AgentAnimationEvent = {
      type: 'expression',
      agentId,
      timestamp: Date.now(),
      data: { expression },
    };

    this.broadcast(event);
  }

  /**
   * 获取 Agent 状态
   */
  getAgentState(agentId: string): AgentAnimationData | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * 获取所有 Agent 状态
   */
  getAllStates(): AgentAnimationData[] {
    return Array.from(this.agents.values());
  }

  /**
   * 启动动画更新循环
   */
  startUpdateLoop(): void {
    if (this.updateInterval) {
      console.log('[AgentAnimationManager] Update loop already running');
      return;
    }

    this.updateInterval = setInterval(() => {
      this.updateAnimations();
    }, this.config.updateFrequency);

    console.log('[AgentAnimationManager] Update loop started');
  }

  /**
   * 停止动画更新循环
   */
  stopUpdateLoop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('[AgentAnimationManager] Update loop stopped');
    }
  }

  /**
   * 更新动画（内部循环）
   */
  private updateAnimations(): void {
    const now = Date.now();

    this.agents.forEach((agent) => {
      // 更新动画进度
      const stateDuration = now - agent.stateStartTime;
      agent.animationProgress = Math.min(1, stateDuration / 5000); // 5秒一个周期

      // 根据状态随机触发动作
      if (agent.state === 'idle') {
        if (stateDuration > this.config.idleActionInterval) {
          if (Math.random() < 0.3) { // 30% 概率触发随机动作
            agent.currentAction = this.getRandomAction('idle');
            agent.stateStartTime = now;
            this.broadcast({
              type: 'action',
              agentId: agent.agentId,
              timestamp: now,
              data: { action: agent.currentAction },
            });
          }
        }
      } else if (agent.state === 'working') {
        if (stateDuration > this.config.workingActionInterval) {
          if (Math.random() < 0.2) {
            agent.currentAction = this.getRandomAction('working');
            agent.stateStartTime = now;
            this.broadcast({
              type: 'action',
              agentId: agent.agentId,
              timestamp: now,
              data: { action: agent.currentAction },
            });
          }
        }
      }

      agent.lastUpdate = now;
    });
  }

  /**
   * 获取随机动作
   */
  private getRandomAction(state: AgentAnimationState): string {
    const actions = ANIMATION_ACTIONS[state];
    return actions[Math.floor(Math.random() * actions.length)];
  }

  /**
   * 获取随机表情
   */
  private getRandomExpression(state: AgentAnimationState): string {
    const expressions = ANIMATION_EXPRESSIONS[state];
    return expressions[Math.floor(Math.random() * expressions.length)];
  }

  /**
   * 广播事件
   */
  private broadcast(event: AgentAnimationEvent): void {
    if (this.broadcastCallback) {
      this.broadcastCallback(event);
    }
    this.emit('animation-event', event);
  }

  /**
   * 批量更新状态（用于工作流状态同步）
   */
  batchUpdateStates(updates: Array<{ agentId: string; state: AgentAnimationState }>): void {
    updates.forEach(({ agentId, state }) => {
      this.updateState(agentId, state);
    });
  }

  /**
   * 导出状态快照（用于持久化）
   */
  exportSnapshot(): AgentAnimationData[] {
    return this.getAllStates();
  }

  /**
   * 导入状态快照（用于恢复）
   */
  importSnapshot(snapshot: AgentAnimationData[]): void {
    snapshot.forEach((data) => {
      this.agents.set(data.agentId, {
        ...data,
        lastUpdate: Date.now(),
      });
    });
    console.log(`[AgentAnimationManager] Imported ${snapshot.length} agent states`);
  }

  /**
   * 清理所有 Agent
   */
  clear(): void {
    this.agents.clear();
    console.log('[AgentAnimationManager] Cleared all agents');
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stopUpdateLoop();
    this.clear();
    this.removeAllListeners();
    console.log('[AgentAnimationManager] Destroyed');
  }
}

// 单例实例
let animationManagerInstance: AgentAnimationManager | null = null;

/**
 * 获取动画管理器单例
 */
export function getAgentAnimationManager(): AgentAnimationManager {
  if (!animationManagerInstance) {
    animationManagerInstance = new AgentAnimationManager();
  }
  return animationManagerInstance;
}

/**
 * 重置动画管理器
 */
export function resetAgentAnimationManager(): void {
  if (animationManagerInstance) {
    animationManagerInstance.destroy();
    animationManagerInstance = null;
  }
}

// ========== 工作流状态到动画状态映射 ==========

/**
 * 工作流状态枚举（与 AHIVECORE 同步）
 */
export enum WorkflowStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * 节点状态枚举（与 AHIVECORE 同步）
 */
export enum NodeStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
  SKIPPED = 'skipped',
}

/**
 * 工作流状态到动画状态映射
 * 
 * @param workflowStatus 工作流状态
 * @param nodeStatus 节点状态（可选）
 * @param isThinking 是否正在思考（可选）
 * @returns 对应的动画状态
 */
export function mapWorkflowToAnimationState(
  workflowStatus: WorkflowStatus,
  nodeStatus?: NodeStatus,
  isThinking?: boolean
): AgentAnimationState {
  // 优先处理思考状态
  if (isThinking) {
    return 'thinking';
  }
  
  switch (workflowStatus) {
    case WorkflowStatus.RUNNING:
      // 运行中，根据节点状态细分
      if (nodeStatus === NodeStatus.RUNNING) {
        return 'working';
      } else if (nodeStatus === NodeStatus.PENDING) {
        return 'thinking';
      }
      return 'working';
      
    case WorkflowStatus.COMPLETED:
      // 完成，庆祝
      return 'celebrating';
      
    case WorkflowStatus.FAILED:
      // 失败，错误
      return 'error';
      
    case WorkflowStatus.PAUSED:
      // 暂停，空闲
      return 'idle';
      
    case WorkflowStatus.STOPPED:
      // 停止，空闲
      return 'idle';
      
    case WorkflowStatus.IDLE:
    default:
      // 空闲
      return 'idle';
  }
}

/**
 * 智能体状态到动画状态映射
 * 
 * @param agentStatus 智能体状态
 * @param isTyping 是否正在输入
 * @returns 对应的动画状态
 */
export function mapAgentStatusToAnimationState(
  agentStatus: 'idle' | 'working' | 'paused' | 'error' | 'offline',
  isTyping?: boolean
): AgentAnimationState {
  // 优先处理输入状态
  if (isTyping) {
    return 'talking';
  }
  
  switch (agentStatus) {
    case 'working':
      return 'working';
    case 'error':
      return 'error';
    case 'paused':
      return 'idle';
    case 'offline':
      return 'idle';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * 根据工作流事件更新智能体动画状态
 * 
 * @param agentId 智能体ID
 * @param eventType 工作流事件类型
 * @param eventData 事件数据
 */
export function updateAnimationFromWorkflowEvent(
  agentId: string,
  eventType: string,
  eventData: any
): void {
  const manager = getAgentAnimationManager();
  
  switch (eventType) {
    // 工作流任务开始（来自 CommanderChannel.notifyTaskStart）
    case 'workflow_task_start':
      manager.updateState(agentId, 'working');
      break;
    
    // 工作流任务完成
    case 'workflow_task_complete':
      // 任务完成，恢复空闲或继续工作
      manager.updateState(agentId, 'idle');
      break;
      
    // 工作流任务错误
    case 'workflow_task_error':
      manager.updateState(agentId, 'error');
      // 3秒后恢复空闲
      setTimeout(() => {
        manager.updateState(agentId, 'idle');
      }, 3000);
      break;
    
    case 'workflow-started':
    case 'workflow-node-start':
      manager.updateState(agentId, 'working');
      break;
      
    case 'workflow-node-complete':
      // 节点完成，继续工作状态
      manager.updateState(agentId, 'working');
      break;
      
    case 'workflow-completed':
      // 工作流完成，庆祝
      manager.updateState(agentId, 'celebrating');
      // 3秒后恢复空闲
      setTimeout(() => {
        manager.updateState(agentId, 'idle');
      }, 3000);
      break;
      
    case 'workflow-error':
    case 'workflow-node-error':
      // 错误
      manager.updateState(agentId, 'error');
      // 5秒后恢复空闲
      setTimeout(() => {
        manager.updateState(agentId, 'idle');
      }, 5000);
      break;
      
    case 'workflow-paused':
      manager.updateState(agentId, 'idle');
      break;
      
    case 'workflow-resumed':
      manager.updateState(agentId, 'working');
      break;
      
    case 'thinking':
    case 'thinking-delta':
      manager.updateState(agentId, 'thinking');
      break;
      
    case 'text-delta':
      manager.updateState(agentId, 'talking');
      break;
      
    case 'text-done':
    case 'done':
      // 完成输出，恢复空闲
      manager.updateState(agentId, 'idle');
      break;
      
    case 'agent-chat':
      // 智能体间对话，设置为 talking 状态
      manager.updateState(agentId, 'talking');
      break;
      
    case 'workflow_report':
    case 'workflow_status_request':
      // 工作流报告/状态请求，设置为 working 状态
      manager.updateState(agentId, 'working');
      break;
      
    default:
      // 记录未处理的事件类型（用于调试）
      console.log(`[AgentAnimation] Unhandled event type: ${eventType} for agent ${agentId}`);
      break;
  }
}