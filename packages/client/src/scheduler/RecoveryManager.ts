/**
 * 故障恢复管理器
 * 处理 Agent 执行失败时的自动恢复策略
 */

import type { Agent } from '../types';
import { blackboard } from './Blackboard';

// ========== 类型定义 ==========

/** 故障类型 */
export type FailureType = 
  | 'timeout'           // 执行超时
  | 'error'             // 执行错误
  | 'rate-limit'        // 速率限制
  | 'unavailable'       // Agent 不可用
  | 'invalid-response'  // 无效响应
  | 'network';          // 网络错误

/** 恢复策略 */
export type RecoveryStrategy = 
  | 'retry'             // 重试同一个 Agent
  | 'reassign'          // 重新分配给其他 Agent
  | 'fallback'          // 使用备用方案
  | 'abort';            // 中止任务

/** 故障记录 */
export interface FailureRecord {
  /** 记录 ID */
  id: string;
  /** 工作流实例 ID */
  workflowInstanceId?: string;
  /** 节点 ID */
  nodeId: string;
  /** 节点名称 */
  nodeName: string;
  /** Agent ID */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** 故障类型 */
  failureType: FailureType;
  /** 错误信息 */
  errorMessage: string;
  /** 故障时间 */
  timestamp: string;
  /** 重试次数 */
  retryCount: number;
  /** 使用的恢复策略 */
  recoveryStrategy?: RecoveryStrategy;
  /** 恢复结果 */
  recoveryResult?: 'success' | 'failed' | 'pending';
  /** 重新分配的 Agent ID */
  reassignedTo?: string;
}

/** 恢复配置 */
export interface RecoveryConfig {
  /** 是否启用自动恢复 */
  enabled: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔基数 (ms) */
  retryDelayBase: number;
  /** 重试间隔最大值 (ms) */
  retryDelayMax: number;
  /** 是否启用指数退避 */
  exponentialBackoff: boolean;
  /** 超时时间 (ms) */
  timeout: number;
  /** 是否启用自动重分配 */
  autoReassign: boolean;
  /** 重分配时优先选择同技能 Agent */
  preferSameSkills: boolean;
  /** 故障阈值 - 超过后标记 Agent 为不可用 */
  failureThreshold: number;
  /** 故障窗口期 (ms) */
  failureWindow: number;
}

/** 恢复动作 */
export interface RecoveryAction {
  /** 策略类型 */
  strategy: RecoveryStrategy;
  /** 目标 Agent ID (reassign 时使用) */
  targetAgentId?: string;
  /** 重试延迟 (ms) */
  retryDelay?: number;
  /** 备用提示 (fallback 时使用) */
  fallbackPrompt?: string;
  /** 是否应该中止 */
  shouldAbort: boolean;
  /** 说明信息 */
  message: string;
}

/** Agent 健康状态 */
export interface AgentHealthStatus {
  agentId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  failureCount: number;
  lastFailure?: string;
  successRate: number;
  averageResponseTime: number;
}

// ========== 恢复管理器类 ==========

/**
 * 故障恢复管理器
 * 
 * 功能：
 * 1. 自动重试 - 支持指数退避
 * 2. Agent 重分配 - 选择健康的替代 Agent
 * 3. 健康状态跟踪 - 监控 Agent 可用性
 * 4. 故障记录 - 持久化故障历史
 */
export class RecoveryManager {
  private config: Required<RecoveryConfig>;
  private failures: Map<string, FailureRecord[]> = new Map();
  private agentHealth: Map<string, AgentHealthStatus> = new Map();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<RecoveryConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      maxRetries: config.maxRetries ?? 3,
      retryDelayBase: config.retryDelayBase ?? 1000,
      retryDelayMax: config.retryDelayMax ?? 30000,
      exponentialBackoff: config.exponentialBackoff ?? true,
      timeout: config.timeout ?? 120000,
      autoReassign: config.autoReassign ?? true,
      preferSameSkills: config.preferSameSkills ?? true,
      failureThreshold: config.failureThreshold ?? 5,
      failureWindow: config.failureWindow ?? 300000, // 5 分钟
    };
  }

  // ========== 公共方法 ==========

  /**
   * 处理执行失败
   * 分析故障类型并返回恢复策略
   */
  handleFailure(
    nodeId: string,
    nodeName: string,
    agentId: string,
    agentName: string,
    error: Error | string,
    currentRetryCount: number,
    workflowInstanceId?: string
  ): RecoveryAction {
    if (!this.config.enabled) {
      return {
        strategy: 'abort',
        shouldAbort: true,
        message: 'Recovery is disabled',
      };
    }

    // 分析故障类型
    const failureType = this.analyzeFailureType(error);
    const errorMessage = error instanceof Error ? error.message : error;

    // 记录故障
    this.recordFailure({
      id: `fail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      workflowInstanceId,
      nodeId,
      nodeName,
      agentId,
      agentName,
      failureType,
      errorMessage,
      timestamp: new Date().toISOString(),
      retryCount: currentRetryCount,
    });

    // 更新 Agent 健康状态
    this.updateAgentHealth(agentId, false, 0);

    // 决定恢复策略
    return this.decideRecoveryStrategy(
      agentId,
      failureType,
      currentRetryCount
    );
  }

  /**
   * 计算重试延迟
   */
  calculateRetryDelay(retryCount: number): number {
    if (!this.config.exponentialBackoff) {
      return Math.min(this.config.retryDelayBase, this.config.retryDelayMax);
    }

    // 指数退避: base * 2^retryCount + 随机抖动
    const delay = this.config.retryDelayBase * Math.pow(2, retryCount);
    const jitter = Math.random() * 1000; // 0-1 秒随机抖动
    
    return Math.min(delay + jitter, this.config.retryDelayMax);
  }

  /**
   * 选择替代 Agent
   */
  selectReplacementAgent(
    failedAgentId: string,
    agents: Agent[],
    requiredSkills?: string[]
  ): Agent | null {
    if (!this.config.autoReassign) {
      return null;
    }

    // 过滤可用 Agent
    const availableAgents = agents.filter(agent => {
      // 排除失败的 Agent
      if (agent.id === failedAgentId) return false;
      
      // 检查健康状态
      const health = this.agentHealth.get(agent.id);
      if (health && health.status === 'unhealthy') return false;
      
      // 检查 Agent 状态
      if (agent.status === 'error') return false;
      
      return true;
    });

    if (availableAgents.length === 0) {
      return null;
    }

    // 如果有技能要求且优先同技能
    if (this.config.preferSameSkills && requiredSkills && requiredSkills.length > 0) {
      const skilledAgents = availableAgents.filter(agent => 
        requiredSkills.some(skill => 
          agent.skills.some(s => s.toLowerCase().includes(skill.toLowerCase()))
        )
      );
      
      if (skilledAgents.length > 0) {
        return this.selectLeastLoadedAgent(skilledAgents);
      }
    }

    // 选择负载最低的 Agent
    return this.selectLeastLoadedAgent(availableAgents);
  }

  /**
   * 获取 Agent 健康状态
   */
  getAgentHealth(agentId: string): AgentHealthStatus | undefined {
    return this.agentHealth.get(agentId);
  }

  /**
   * 获取所有 Agent 健康状态
   */
  getAllAgentHealth(): AgentHealthStatus[] {
    return Array.from(this.agentHealth.values());
  }

  /**
   * 记录执行成功
   */
  recordSuccess(agentId: string, responseTime: number): void {
    this.updateAgentHealth(agentId, true, responseTime);
  }

  /**
   * 取消待处理的重试
   */
  cancelRetry(taskId: string): void {
    const timer = this.retryTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(taskId);
    }
  }

  /**
   * 安排重试
   */
  scheduleRetry(
    taskId: string,
    callback: () => Promise<void>,
    delay: number
  ): void {
    const timer = setTimeout(async () => {
      this.retryTimers.delete(taskId);
      try {
        await callback();
      } catch (error) {
        console.error(`[Recovery] Retry failed for task ${taskId}:`, error);
      }
    }, delay);
    
    this.retryTimers.set(taskId, timer);
  }

  /**
   * 获取故障历史
   */
  getFailureHistory(agentId?: string): FailureRecord[] {
    if (agentId) {
      return this.failures.get(agentId) || [];
    }
    
    return Array.from(this.failures.values()).flat();
  }

  /**
   * 清除过期故障记录
   */
  cleanupExpiredFailures(): void {
    const now = Date.now();
    const windowStart = now - this.config.failureWindow;

    for (const [agentId, records] of this.failures.entries()) {
      const validRecords = records.filter(
        r => new Date(r.timestamp).getTime() > windowStart
      );
      
      if (validRecords.length === 0) {
        this.failures.delete(agentId);
      } else if (validRecords.length !== records.length) {
        this.failures.set(agentId, validRecords);
      }
    }
  }

  /**
   * 重置 Agent 健康状态
   */
  resetAgentHealth(agentId: string): void {
    this.agentHealth.delete(agentId);
    this.failures.delete(agentId);
  }

  /**
   * 获取配置
   */
  getConfig(): Required<RecoveryConfig> {
    return this.config;
  }

  // ========== 私有方法 ==========

  /**
   * 分析故障类型
   */
  private analyzeFailureType(error: Error | string): FailureType {
    const message = error instanceof Error ? error.message.toLowerCase() : error.toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return 'rate-limit';
    }
    if (message.includes('network') || message.includes('connection') || message.includes('econnrefused')) {
      return 'network';
    }
    if (message.includes('not found') || message.includes('unavailable') || message.includes('not available')) {
      return 'unavailable';
    }
    if (message.includes('invalid') || message.includes('parse') || message.includes('json')) {
      return 'invalid-response';
    }
    
    return 'error';
  }

  /**
   * 记录故障
   */
  private recordFailure(record: FailureRecord): void {
    if (!this.failures.has(record.agentId)) {
      this.failures.set(record.agentId, []);
    }
    
    this.failures.get(record.agentId)!.push(record);

    // 写入黑板
    blackboard.setVariable(
      `failure_${record.id}`,
      record,
      { type: 'public' }
    );

    console.log(`[Recovery] Recorded failure: ${record.failureType} for agent ${record.agentName}`);
  }

  /**
   * 决定恢复策略
   */
  private decideRecoveryStrategy(
    agentId: string,
    failureType: FailureType,
    currentRetryCount: number
  ): RecoveryAction {
    const health = this.agentHealth.get(agentId);
    const failureCount = health?.failureCount || 0;

    // 检查是否超过重试上限
    if (currentRetryCount >= this.config.maxRetries) {
      // 尝试重分配
      if (this.config.autoReassign && failureType !== 'rate-limit') {
        return {
          strategy: 'reassign',
          shouldAbort: false,
          message: `Max retries (${this.config.maxRetries}) reached, attempting reassignment`,
        };
      }
      
      return {
        strategy: 'abort',
        shouldAbort: true,
        message: `Max retries (${this.config.maxRetries}) reached, cannot reassign`,
      };
    }

    // 检查 Agent 是否健康
    if (health?.status === 'unhealthy') {
      if (this.config.autoReassign) {
        return {
          strategy: 'reassign',
          shouldAbort: false,
          message: 'Agent is unhealthy, attempting reassignment',
        };
      }
      
      return {
        strategy: 'fallback',
        fallbackPrompt: 'The primary agent is unavailable. Please try a simpler approach.',
        shouldAbort: false,
        message: 'Agent is unhealthy, using fallback',
      };
    }

    // 根据故障类型决定策略
    switch (failureType) {
      case 'timeout':
        if (currentRetryCount < 2) {
          return {
            strategy: 'retry',
            retryDelay: this.calculateRetryDelay(currentRetryCount),
            shouldAbort: false,
            message: 'Timeout occurred, will retry with longer timeout',
          };
        }
        return {
          strategy: 'reassign',
          shouldAbort: false,
          message: 'Multiple timeouts, attempting reassignment',
        };

      case 'rate-limit':
        // 速率限制：等待后重试
        return {
          strategy: 'retry',
          retryDelay: Math.max(this.calculateRetryDelay(currentRetryCount), 10000),
          shouldAbort: false,
          message: 'Rate limited, will retry after delay',
        };

      case 'network':
        // 网络错误：快速重试
        return {
          strategy: 'retry',
          retryDelay: 2000,
          shouldAbort: false,
          message: 'Network error, will retry quickly',
        };

      case 'unavailable':
        // Agent 不可用：重分配
        return {
          strategy: 'reassign',
          shouldAbort: false,
          message: 'Agent unavailable, attempting reassignment',
        };

      case 'invalid-response':
        // 无效响应：使用备用提示重试
        return {
          strategy: 'retry',
          retryDelay: this.calculateRetryDelay(currentRetryCount),
          fallbackPrompt: 'Please provide a valid response in the expected format.',
          shouldAbort: false,
          message: 'Invalid response, will retry with guidance',
        };

      default:
        return {
          strategy: 'retry',
          retryDelay: this.calculateRetryDelay(currentRetryCount),
          shouldAbort: false,
          message: `Error occurred, will retry (${currentRetryCount + 1}/${this.config.maxRetries})`,
        };
    }
  }

  /**
   * 更新 Agent 健康状态
   */
  private updateAgentHealth(
    agentId: string,
    success: boolean,
    responseTime: number
  ): void {
    const existing = this.agentHealth.get(agentId);
    const now = new Date();

    // 获取故障记录
    const failures = this.failures.get(agentId) || [];
    const recentFailures = failures.filter(
      f => now.getTime() - new Date(f.timestamp).getTime() < this.config.failureWindow
    );

    // 计算成功率
    const totalRequests = (existing?.successRate || 0) * 100 + 1;
    const successCount = success ? 1 : 0;
    const newSuccessRate = successCount / totalRequests;

    // 计算平均响应时间
    const avgResponseTime = existing?.averageResponseTime || 0;
    const newAvgResponseTime = success
      ? (avgResponseTime + responseTime) / 2
      : avgResponseTime;

    // 确定健康状态
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (recentFailures.length >= this.config.failureThreshold) {
      status = 'unhealthy';
    } else if (recentFailures.length >= Math.floor(this.config.failureThreshold / 2)) {
      status = 'degraded';
    } else if (newSuccessRate < 0.5) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    const healthStatus: AgentHealthStatus = {
      agentId,
      status,
      failureCount: recentFailures.length,
      lastFailure: success ? undefined : now.toISOString(),
      successRate: newSuccessRate,
      averageResponseTime: newAvgResponseTime,
    };

    this.agentHealth.set(agentId, healthStatus);

    // 写入黑板
    blackboard.setVariable(
      `agent_health_${agentId}`,
      healthStatus,
      { type: 'public' }
    );
  }

  /**
   * 选择负载最低的 Agent
   */
  private selectLeastLoadedAgent(agents: Agent[]): Agent {
    // 优先选择空闲的
    const idleAgents = agents.filter(a => a.status === 'idle');
    if (idleAgents.length > 0) {
      // 随机选择一个空闲的
      return idleAgents[Math.floor(Math.random() * idleAgents.length)];
    }

    // 否则选择健康的
    const healthyAgents = agents.filter(a => {
      const health = this.agentHealth.get(a.id);
      return !health || health.status !== 'unhealthy';
    });

    if (healthyAgents.length > 0) {
      // 选择响应时间最短的
      healthyAgents.sort((a, b) => {
        const healthA = this.agentHealth.get(a.id);
        const healthB = this.agentHealth.get(b.id);
        return (healthA?.averageResponseTime || 0) - (healthB?.averageResponseTime || 0);
      });
      return healthyAgents[0];
    }

    // 最后随机选择
    return agents[Math.floor(Math.random() * agents.length)];
  }
}

// ========== 默认实例 ==========

export const recoveryManager = new RecoveryManager();

// ========== 辅助函数 ==========

/**
 * 创建带超时的执行器
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * 带重试的执行器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delay?: number;
    backoff?: boolean;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 1000, backoff = true, onRetry } = options;
  
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, lastError);
        
        const retryDelay = backoff 
          ? delay * Math.pow(2, attempt) 
          : delay;
        
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  throw lastError;
}