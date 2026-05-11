/**
 * AHIVECORE 宕机恢复模块
 * 监控 AHIVECORE 状态，自动重启并恢复任务
 */

import { EventEmitter } from 'events';
import type { WebSocketServer } from '../../services/ahivecore/WebSocketServer';

/**
 * AHIVECORE 状态
 */
export type AHIVECOREState = 
  | 'running'      // 正常运行
  | 'unhealthy'    // 不健康（响应慢或部分功能异常）
  | 'crashed'     // 崩溃
  | 'restarting'   // 重启中
  | 'offline';     // 离线

/**
 * 恢复配置
 */
export interface RecoveryConfig {
  /** 心跳检测间隔（毫秒） */
  heartbeatInterval: number;
  /** 心跳超时时间（毫秒） */
  heartbeatTimeout: number;
  /** 最大重启尝试次数 */
  maxRestartAttempts: number;
  /** 重启间隔（毫秒） */
  restartInterval: number;
  /** 不健康阈值（连续失败次数） */
  unhealthyThreshold: number;
  /** 是否启用自动恢复 */
  autoRecovery: boolean;
}

/**
 * 心跳记录
 */
interface HeartbeatRecord {
  timestamp: number;
  responseTime: number;
  success: boolean;
}

/**
 * 恢复事件
 */
export interface RecoveryEvent {
  type: 'state-change' | 'heartbeat' | 'restart' | 'recovery' | 'error';
  previousState?: AHIVECOREState;
  currentState: AHIVECOREState;
  timestamp: number;
  data?: {
    attemptCount?: number;
    error?: string;
    recoveredTasks?: string[];
  };
}

/**
 * AHIVECORE 宕机恢复管理器
 */
export class AHIVECORERecovery extends EventEmitter {
  private wsServer: WebSocketServer;
  private config: RecoveryConfig;
  private state: AHIVECOREState = 'offline';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatHistory: HeartbeatRecord[] = [];
  private restartAttempts: number = 0;
  private consecutiveFailures: number = 0;
  private lastHeartbeatTime: number = 0;
  private recoveryInProgress: boolean = false;

  // 回调函数
  private onRestartCallback?: () => Promise<boolean>;
  private onRecoveryCallback?: (interruptedTasks: string[]) => Promise<void>;

  constructor(wsServer: WebSocketServer, config?: Partial<RecoveryConfig>) {
    super();
    this.wsServer = wsServer;
    this.config = {
      heartbeatInterval: 30000,      // 30秒
      heartbeatTimeout: 10000,        // 10秒
      maxRestartAttempts: 3,          // 最多3次
      restartInterval: 5000,          // 5秒间隔
      unhealthyThreshold: 3,          // 连续3次失败
      autoRecovery: true,
      ...config,
    };

    console.log('[AHIVECORERecovery] Initialized with config:', this.config);
  }

  /**
   * 设置重启回调
   */
  onRestart(callback: () => Promise<boolean>): void {
    this.onRestartCallback = callback;
  }

  /**
   * 设置恢复回调
   */
  onRecovery(callback: (interruptedTasks: string[]) => Promise<void>): void {
    this.onRecoveryCallback = callback;
  }

  /**
   * 启动监控
   */
  start(): void {
    console.log('[AHIVECORERecovery] Starting monitoring...');
    
    this.state = 'running';
    this.startHeartbeat();
    
    this.emitEvent('state-change', 'offline', 'running');
  }

  /**
   * 停止监控
   */
  stop(): void {
    console.log('[AHIVECORERecovery] Stopping monitoring...');
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    this.state = 'offline';
    this.emitEvent('state-change', 'running', 'offline');
  }

  /**
   * 获取当前状态
   */
  getState(): AHIVECOREState {
    return this.state;
  }

  /**
   * 获取心跳历史
   */
  getHeartbeatHistory(): HeartbeatRecord[] {
    return [...this.heartbeatHistory];
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.checkHealth();
    }, this.config.heartbeatInterval);

    // 立即执行一次
    this.checkHealth();
  }

  /**
   * 检查健康状态
   */
  private async checkHealth(): Promise<void> {
    const startTime = Date.now();
    let success = false;
    let responseTime = 0;

    try {
      // 通过 WebSocket 检查 AHIVECORE 状态
      const healthPromise = this.pingAHIVECORE();
      
      // 设置超时
      const result = await Promise.race([
        healthPromise,
        new Promise<boolean>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.config.heartbeatTimeout)
        ),
      ]);

      responseTime = Date.now() - startTime;
      success = result === true;

    } catch (error) {
      responseTime = Date.now() - startTime;
      success = false;
      console.error('[AHIVECORERecovery] Health check failed:', error);
    }

    // 记录心跳
    const record: HeartbeatRecord = {
      timestamp: startTime,
      responseTime,
      success,
    };
    this.heartbeatHistory.push(record);
    this.lastHeartbeatTime = startTime;

    // 保留最近100条记录
    if (this.heartbeatHistory.length > 100) {
      this.heartbeatHistory.shift();
    }

    // 更新状态
    if (success) {
      this.consecutiveFailures = 0;
      this.handleHealthy();
    } else {
      this.consecutiveFailures++;
      this.handleUnhealthy();
    }

    // 发送心跳事件
    this.emitEvent('heartbeat', this.state, this.state, {
      responseTime,
      success,
    });
  }

  /**
   * Ping AHIVECORE
   */
  private async pingAHIVECORE(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // 检查 WebSocket 服务器是否有连接的客户端
        // 如果 AHIVECORE 正常，应该有对应的连接
        const clientCount = this.wsServer.getClientCount();
        
        // 简单判断：如果有客户端连接，认为 AHIVECORE 在运行
        // 实际应该发送 ping 消息并等待 pong 响应
        resolve(clientCount > 0);
        
      } catch (error) {
        console.error('[AHIVECORERecovery] Ping failed:', error);
        resolve(false);
      }
    });
  }

  /**
   * 处理健康状态
   */
  private handleHealthy(): void {
    if (this.state !== 'running') {
      const previousState = this.state;
      this.state = 'running';
      this.restartAttempts = 0;
      
      console.log('[AHIVECORERecovery] AHIVECORE is now healthy');
      this.emitEvent('state-change', previousState, 'running');
    }
  }

  /**
   * 处理不健康状态
   */
  private handleUnhealthy(): void {
    console.warn(`[AHIVECORERecovery] Unhealthy detected (${this.consecutiveFailures}/${this.config.unhealthyThreshold})`);

    if (this.consecutiveFailures >= this.config.unhealthyThreshold) {
      // 超过阈值，认为崩溃
      if (this.state !== 'crashed' && this.state !== 'restarting') {
        const previousState = this.state;
        this.state = 'crashed';
        
        console.error('[AHIVECORERecovery] AHIVECORE appears to have crashed');
        this.emitEvent('state-change', previousState, 'crashed');
        
        // 触发恢复流程
        if (this.config.autoRecovery) {
          this.attemptRecovery();
        }
      }
    } else if (this.state === 'running') {
      // 标记为不健康
      const previousState = this.state;
      this.state = 'unhealthy';
      
      console.warn('[AHIVECORERecovery] AHIVECORE is unhealthy');
      this.emitEvent('state-change', previousState, 'unhealthy');
    }
  }

  /**
   * 尝试恢复
   */
  private async attemptRecovery(): Promise<void> {
    if (this.recoveryInProgress) {
      console.log('[AHIVECORERecovery] Recovery already in progress');
      return;
    }

    this.recoveryInProgress = true;
    console.log('[AHIVECORERecovery] Starting recovery process...');

    // 1. 尝试重启 AHIVECORE
    const restarted = await this.restartAHIVECORE();

    if (!restarted) {
      console.error('[AHIVECORERecovery] Failed to restart AHIVECORE after max attempts');
      this.recoveryInProgress = false;
      return;
    }

    // 2. 恢复中断的任务
    await this.recoverTasks();

    this.recoveryInProgress = false;
  }

  /**
   * 重启 AHIVECORE
   */
  private async restartAHIVECORE(): Promise<boolean> {
    const previousState = this.state;
    this.state = 'restarting';
    this.emitEvent('state-change', previousState, 'restarting');

    while (this.restartAttempts < this.config.maxRestartAttempts) {
      this.restartAttempts++;
      
      console.log(`[AHIVECORERecovery] Restart attempt ${this.restartAttempts}/${this.config.maxRestartAttempts}`);
      
      this.emitEvent('restart', 'restarting', 'restarting', {
        attemptCount: this.restartAttempts,
      });

      try {
        // 调用重启回调
        if (this.onRestartCallback) {
          const success = await this.onRestartCallback();
          
          if (success) {
            console.log('[AHIVECORERecovery] AHIVECORE restarted successfully');
            
            // 等待稳定
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 验证健康状态
            const healthy = await this.pingAHIVECORE();
            if (healthy) {
              this.state = 'running';
              this.restartAttempts = 0;
              this.emitEvent('state-change', 'restarting', 'running');
              return true;
            }
          }
        }
      } catch (error) {
        console.error(`[AHIVECORERecovery] Restart attempt ${this.restartAttempts} failed:`, error);
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, this.config.restartInterval));
    }

    return false;
  }

  /**
   * 恢复中断的任务
   */
  private async recoverTasks(): Promise<void> {
    console.log('[AHIVECORERecovery] Recovering interrupted tasks...');

    try {
      // 获取中断的任务列表
      const interruptedTasks = await this.getInterruptedTasks();

      if (interruptedTasks.length === 0) {
        console.log('[AHIVECORERecovery] No interrupted tasks found');
        return;
      }

      console.log(`[AHIVECORERecovery] Found ${interruptedTasks.length} interrupted tasks`);

      // 调用恢复回调
      if (this.onRecoveryCallback) {
        await this.onRecoveryCallback(interruptedTasks);
      }

      this.emitEvent('recovery', this.state, this.state, {
        recoveredTasks: interruptedTasks,
      });

    } catch (error) {
      console.error('[AHIVECORERecovery] Failed to recover tasks:', error);
      this.emitEvent('error', this.state, this.state, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 获取中断的任务列表
   */
  private async getInterruptedTasks(): Promise<string[]> {
    // 从状态管理器读取中断的任务
    // 这里需要与 StateManager 集成
    // 暂时返回空数组，实际实现需要读取 workflow-execution.json
    return [];
  }

  /**
   * 发送事件
   */
  private emitEvent(
    type: RecoveryEvent['type'],
    previousState: AHIVECOREState | undefined,
    currentState: AHIVECOREState,
    data?: RecoveryEvent['data']
  ): void {
    const event: RecoveryEvent = {
      type,
      previousState,
      currentState,
      timestamp: Date.now(),
      data,
    };
    
    this.emit('recovery-event', event);
  }

  /**
   * 手动触发恢复
   */
  async triggerRecovery(): Promise<void> {
    console.log('[AHIVECORERecovery] Manual recovery triggered');
    await this.attemptRecovery();
  }

  /**
   * 获取健康报告
   */
  getHealthReport(): {
    state: AHIVECOREState;
    lastHeartbeat: number;
    consecutiveFailures: number;
    restartAttempts: number;
    recentHeartbeats: HeartbeatRecord[];
  } {
    return {
      state: this.state,
      lastHeartbeat: this.lastHeartbeatTime,
      consecutiveFailures: this.consecutiveFailures,
      restartAttempts: this.restartAttempts,
      recentHeartbeats: this.heartbeatHistory.slice(-10),
    };
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stop();
    this.removeAllListeners();
  }
}

// 导出单例工厂
let recoveryInstance: AHIVECORERecovery | null = null;

export function getAHIVECORERecovery(
  wsServer: WebSocketServer,
  config?: Partial<RecoveryConfig>
): AHIVECORERecovery {
  if (!recoveryInstance) {
    recoveryInstance = new AHIVECORERecovery(wsServer, config);
  }
  return recoveryInstance;
}

export function resetAHIVECORERecovery(): void {
  if (recoveryInstance) {
    recoveryInstance.destroy();
    recoveryInstance = null;
  }
}