/**
 * Agent Swarm 集群执行管理器
 * 支持多 Agent 并行执行、负载均衡、结果聚合
 */

import type { Agent } from '../types';
import { blackboard } from './Blackboard';

// ========== 类型定义 ==========

/** Swarm 任务 */
export interface SwarmTask {
  /** 任务 ID */
  id: string;
  /** 任务内容 */
  content: string;
  /** 优先级 (1-10, 默认 5) */
  priority?: number;
  /** 需要的技能 */
  requiredSkills?: string[];
  /** 超时时间 (ms) */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 上下文数据 */
  context?: Record<string, unknown>;
}

/** Swarm 任务状态 */
export type SwarmTaskStatus = 
  | 'pending'      // 等待分配
  | 'assigned'     // 已分配
  | 'running'      // 执行中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'timeout';     // 超时

/** Swarm 任务执行记录 */
export interface SwarmTaskRecord {
  /** 任务 ID */
  taskId: string;
  /** 分配的 Agent ID */
  agentId: string;
  /** 状态 */
  status: SwarmTaskStatus;
  /** 开始时间 */
  startedAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行耗时 (ms) */
  duration?: number;
  /** 重试次数 */
  retryCount: number;
}

/** Swarm 执行结果 */
export interface SwarmResult {
  /** Swarm ID */
  swarmId: string;
  /** 总任务数 */
  totalTasks: number;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  failedCount: number;
  /** 超时数 */
  timeoutCount: number;
  /** 总耗时 (ms) */
  totalDuration: number;
  /** 并行度 */
  parallelism: number;
  /** 各任务结果 */
  taskResults: Map<string, SwarmTaskRecord>;
  /** 聚合结果 */
  aggregatedResult?: unknown;
  /** 是否全部成功 */
  allSucceeded: boolean;
}

/** Swarm 配置 */
export interface SwarmConfig {
  /** 最大并行数 */
  maxParallelism: number;
  /** 任务超时 (ms) */
  taskTimeout: number;
  /** 是否启用负载均衡 */
  loadBalancing: boolean;
  /** 负载均衡策略 */
  loadBalanceStrategy: 'round-robin' | 'least-loaded' | 'random' | 'skill-based';
  /** 失败时是否重试 */
  retryOnFailure: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 结果聚合策略 */
  aggregationStrategy: 'first' | 'all' | 'majority' | 'best';
  /** 是否收集所有结果 */
  collectAllResults: boolean;
}

/** Agent 负载信息 */
export interface AgentLoad {
  agentId: string;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageResponseTime: number;
  loadScore: number; // 0-1, 越低越好
}

/** 执行回调 */
export interface SwarmCallbacks {
  /** 任务分配回调 */
  onTaskAssigned?: (taskId: string, agentId: string) => void;
  /** 任务开始回调 */
  onTaskStart?: (taskId: string, agentId: string) => void;
  /** 任务完成回调 */
  onTaskComplete?: (record: SwarmTaskRecord) => void;
  /** 任务失败回调 */
  onTaskFailed?: (taskId: string, error: string) => void;
  /** 进度更新回调 */
  onProgress?: (completed: number, total: number) => void;
}

// ========== Agent Swarm 类 ==========

/**
 * Agent Swarm 集群执行管理器
 * 
 * 功能：
 * 1. 并行执行 - 多 Agent 同时处理多个任务
 * 2. 负载均衡 - 根据 Agent 负载分配任务
 * 3. 结果聚合 - 合并多个 Agent 的结果
 * 4. 容错处理 - 失败自动重试
 */
export class AgentSwarm {
  private config: Required<SwarmConfig>;
  private agents: Agent[] = [];
  private agentLoads: Map<string, AgentLoad> = new Map();
  private roundRobinIndex = 0;
  private executeAgentFn: ((agent: Agent, task: string, context?: Record<string, unknown>) => Promise<{
    success: boolean;
    output: string[];
    error?: string;
  }>) | null = null;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = {
      maxParallelism: config.maxParallelism ?? 5,
      taskTimeout: config.taskTimeout ?? 120000,
      loadBalancing: config.loadBalancing ?? true,
      loadBalanceStrategy: config.loadBalanceStrategy ?? 'least-loaded',
      retryOnFailure: config.retryOnFailure ?? true,
      maxRetries: config.maxRetries ?? 2,
      aggregationStrategy: config.aggregationStrategy ?? 'all',
      collectAllResults: config.collectAllResults ?? true,
    };
  }

  // ========== 初始化方法 ==========

  /**
   * 设置 Agent 列表
   */
  setAgents(agents: Agent[]): void {
    this.agents = agents.filter(a => a.status !== 'error');
    
    // 初始化负载信息
    for (const agent of this.agents) {
      if (!this.agentLoads.has(agent.id)) {
        this.agentLoads.set(agent.id, {
          agentId: agent.id,
          activeTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          averageResponseTime: 0,
          loadScore: 0,
        });
      }
    }
  }

  /**
   * 设置执行函数
   */
  setExecuteFn(
    fn: (agent: Agent, task: string, context?: Record<string, unknown>) => Promise<{
      success: boolean;
      output: string[];
      error?: string;
    }>
  ): void {
    this.executeAgentFn = fn;
  }

  // ========== 核心执行方法 ==========

  /**
   * 执行 Swarm 任务
   * 将多个任务分配给多个 Agent 并行执行
   */
  async execute(
    tasks: SwarmTask[],
    callbacks: SwarmCallbacks = {}
  ): Promise<SwarmResult> {
    const swarmId = `swarm-${Date.now()}`;
    const startTime = Date.now();
    const taskResults = new Map<string, SwarmTaskRecord>();

    if (tasks.length === 0) {
      return {
        swarmId,
        totalTasks: 0,
        successCount: 0,
        failedCount: 0,
        timeoutCount: 0,
        totalDuration: 0,
        parallelism: 0,
        taskResults,
        allSucceeded: true,
      };
    }

    console.log(`[Swarm] Starting execution with ${tasks.length} tasks, ${this.agents.length} agents`);

    // 按优先级排序任务
    const sortedTasks = [...tasks].sort((a, b) => (b.priority || 5) - (a.priority || 5));

    // 执行队列
    const pendingTasks = [...sortedTasks];
    const runningTasks: Map<string, Promise<void>> = new Map();
    const parallelism = Math.min(this.config.maxParallelism, this.agents.length, tasks.length);

    // 处理任务
    while (pendingTasks.length > 0 || runningTasks.size > 0) {
      // 填充执行队列
      while (pendingTasks.length > 0 && runningTasks.size < parallelism) {
        const task = pendingTasks.shift()!;
        const agent = this.selectAgent(task);

        if (!agent) {
          // 没有可用 Agent，标记失败
          taskResults.set(task.id, {
            taskId: task.id,
            agentId: '',
            status: 'failed',
            startedAt: new Date().toISOString(),
            error: 'No available agent',
            retryCount: 0,
          });
          callbacks.onTaskFailed?.(task.id, 'No available agent');
          continue;
        }

        // 分配任务
        callbacks.onTaskAssigned?.(task.id, agent.id);
        this.updateAgentLoad(agent.id, 1, 0);

        // 执行任务
        const promise = this.executeTask(task, agent, callbacks)
          .then(record => {
            taskResults.set(task.id, record);
            runningTasks.delete(task.id);
            
            // 更新负载
            this.updateAgentLoad(
              agent.id,
              -1,
              record.status === 'completed' ? 1 : 0
            );

            // 进度回调
            callbacks.onProgress?.(taskResults.size, tasks.length);
          });

        runningTasks.set(task.id, promise);
      }

      // 等待任一任务完成
      if (runningTasks.size > 0) {
        await Promise.race(runningTasks.values());
      }
    }

    // 计算结果
    const records = Array.from(taskResults.values());
    const successCount = records.filter(r => r.status === 'completed').length;
    const failedCount = records.filter(r => r.status === 'failed').length;
    const timeoutCount = records.filter(r => r.status === 'timeout').length;

    // 聚合结果
    const aggregatedResult = this.aggregateResults(records);

    const result: SwarmResult = {
      swarmId,
      totalTasks: tasks.length,
      successCount,
      failedCount,
      timeoutCount,
      totalDuration: Date.now() - startTime,
      parallelism,
      taskResults,
      aggregatedResult,
      allSucceeded: successCount === tasks.length,
    };

    // 写入黑板
    blackboard.setVariable(`swarm_${swarmId}`, result, { type: 'public' });

    console.log(`[Swarm] Completed: ${successCount}/${tasks.length} succeeded in ${result.totalDuration}ms`);

    return result;
  }

  /**
   * 执行单个任务 (带重试)
   */
  private async executeTask(
    task: SwarmTask,
    agent: Agent,
    callbacks: SwarmCallbacks
  ): Promise<SwarmTaskRecord> {
    const startedAt = new Date().toISOString();
    let retryCount = 0;
    let lastError: string | undefined;

    callbacks.onTaskStart?.(task.id, agent.id);

    while (retryCount <= (task.maxRetries ?? this.config.maxRetries)) {
      try {
        if (!this.executeAgentFn) {
          throw new Error('Execute function not set');
        }

        const timeout = task.timeout ?? this.config.taskTimeout;
        const context = task.context;

        // 带超时执行
        const result = await this.executeWithTimeout(
          this.executeAgentFn(agent, task.content, context),
          timeout
        );

        if (result.success) {
          const record: SwarmTaskRecord = {
            taskId: task.id,
            agentId: agent.id,
            status: 'completed',
            startedAt,
            completedAt: new Date().toISOString(),
            result: result.output,
            duration: Date.now() - new Date(startedAt).getTime(),
            retryCount,
          };

          callbacks.onTaskComplete?.(record);
          return record;
        }

        lastError = result.error || 'Unknown error';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      // 重试
      if (this.config.retryOnFailure && retryCount < (task.maxRetries ?? this.config.maxRetries)) {
        retryCount++;
        console.log(`[Swarm] Retrying task ${task.id} (attempt ${retryCount})`);
        await this.delay(1000 * retryCount); // 指数退避
      } else {
        break;
      }
    }

    // 失败
    const record: SwarmTaskRecord = {
      taskId: task.id,
      agentId: agent.id,
      status: lastError?.includes('timeout') ? 'timeout' : 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      error: lastError,
      duration: Date.now() - new Date(startedAt).getTime(),
      retryCount,
    };

    callbacks.onTaskFailed?.(task.id, lastError || 'Unknown error');
    return record;
  }

  /**
   * 并行执行同一任务 (多 Agent 竞争/协作)
   */
  async executeParallel(
    task: SwarmTask,
    numAgents: number = 3,
    callbacks: SwarmCallbacks = {}
  ): Promise<SwarmResult> {
    const tasks: SwarmTask[] = [];
    
    for (let i = 0; i < numAgents; i++) {
      tasks.push({
        ...task,
        id: `${task.id}-p${i}`,
      });
    }

    return this.execute(tasks, callbacks);
  }

  /**
   * 映射执行 (Map 模式)
   * 对每个输入项执行相同的任务
   */
  async map<T, R>(
    items: T[],
    taskTemplate: (item: T, index: number) => string,
    callbacks: SwarmCallbacks = {}
  ): Promise<SwarmResult> {
    const tasks: SwarmTask[] = items.map((item, index) => ({
      id: `map-${index}`,
      content: taskTemplate(item, index),
      context: { item, index },
    }));

    return this.execute(tasks, callbacks);
  }

  /**
   * 归约执行 (Reduce 模式)
   * 先并行执行，然后聚合结果
   */
  async reduce<T, R>(
    items: T[],
    mapFn: (item: T, index: number) => string,
    reduceFn: (results: unknown[]) => R,
    callbacks: SwarmCallbacks = {}
  ): Promise<R> {
    const result = await this.map(items, mapFn, callbacks);
    const results = Array.from(result.taskResults.values())
      .filter(r => r.status === 'completed')
      .map(r => r.result);

    return reduceFn(results);
  }

  // ========== Agent 选择方法 ==========

  /**
   * 选择执行任务的 Agent
   */
  private selectAgent(task: SwarmTask): Agent | null {
    if (this.agents.length === 0) {
      return null;
    }

    // 过滤可用 Agent
    const availableAgents = this.agents.filter(a => {
      const load = this.agentLoads.get(a.id);
      // 负载未超过阈值
      return a.status === 'idle' || (load && load.activeTasks < 3);
    });

    if (availableAgents.length === 0) {
      return null;
    }

    // 根据技能过滤
    if (task.requiredSkills && task.requiredSkills.length > 0) {
      const skilledAgents = availableAgents.filter(agent =>
        task.requiredSkills!.some(skill =>
          agent.skills.some(s => s.toLowerCase().includes(skill.toLowerCase()))
        )
      );
      
      if (skilledAgents.length > 0) {
        return this.selectByStrategy(skilledAgents);
      }
    }

    return this.selectByStrategy(availableAgents);
  }

  /**
   * 根据策略选择 Agent
   */
  private selectByStrategy(agents: Agent[]): Agent {
    switch (this.config.loadBalanceStrategy) {
      case 'round-robin':
        return this.selectRoundRobin(agents);
      
      case 'least-loaded':
        return this.selectLeastLoaded(agents);
      
      case 'random':
        return this.selectRandom(agents);
      
      case 'skill-based':
        return this.selectLeastLoaded(agents); // 默认用 least-loaded
      
      default:
        return agents[0];
    }
  }

  /**
   * 轮询选择
   */
  private selectRoundRobin(agents: Agent[]): Agent {
    const agent = agents[this.roundRobinIndex % agents.length];
    this.roundRobinIndex++;
    return agent;
  }

  /**
   * 最少负载选择
   */
  private selectLeastLoaded(agents: Agent[]): Agent {
    let minLoad = Infinity;
    let selected = agents[0];

    for (const agent of agents) {
      const load = this.agentLoads.get(agent.id);
      const loadScore = load?.loadScore || 0;
      
      if (loadScore < minLoad) {
        minLoad = loadScore;
        selected = agent;
      }
    }

    return selected;
  }

  /**
   * 随机选择
   */
  private selectRandom(agents: Agent[]): Agent {
    return agents[Math.floor(Math.random() * agents.length)];
  }

  // ========== 辅助方法 ==========

  /**
   * 更新 Agent 负载
   */
  private updateAgentLoad(
    agentId: string,
    activeDelta: number,
    completedDelta: number
  ): void {
    const load = this.agentLoads.get(agentId);
    if (!load) return;

    load.activeTasks = Math.max(0, load.activeTasks + activeDelta);
    load.completedTasks += completedDelta > 0 ? completedDelta : 0;
    load.failedTasks += completedDelta === 0 && activeDelta < 0 ? 1 : 0;
    
    // 计算负载分数 (0-1, 越低越好)
    load.loadScore = (load.activeTasks * 0.5 + load.failedTasks * 0.3) / 
                     Math.max(1, load.completedTasks + load.activeTasks);

    this.agentLoads.set(agentId, load);
  }

  /**
   * 聚合结果
   */
  private aggregateResults(records: SwarmTaskRecord[]): unknown {
    const successRecords = records.filter(r => r.status === 'completed');
    
    if (successRecords.length === 0) {
      return null;
    }

    const results = successRecords.map(r => r.result);

    switch (this.config.aggregationStrategy) {
      case 'first':
        return results[0];
      
      case 'all':
        return results;
      
      case 'majority':
        return this.findMajorityResult(results);
      
      case 'best':
        // 选择最长的结果（假设内容更丰富）
        return results.reduce((best, current) => {
          const bestLen = JSON.stringify(best).length;
          const curLen = JSON.stringify(current).length;
          return curLen > bestLen ? current : best;
        }, results[0]);
      
      default:
        return results;
    }
  }

  /**
   * 找出多数结果
   */
  private findMajorityResult(results: unknown[]): unknown {
    const counts = new Map<string, { result: unknown; count: number }>();
    
    for (const result of results) {
      const key = JSON.stringify(result);
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { result, count: 1 });
      }
    }

    // 找出出现最多的结果
    let maxCount = 0;
    let majorityResult = results[0];
    
    for (const entry of counts.values()) {
      if (entry.count > maxCount) {
        maxCount = entry.count;
        majorityResult = entry.result;
      }
    }

    return majorityResult;
  }

  /**
   * 带超时执行
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task timed out after ${timeoutMs}ms`));
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
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取 Agent 负载信息
   */
  getAgentLoads(): AgentLoad[] {
    return Array.from(this.agentLoads.values());
  }

  /**
   * 获取配置
   */
  getConfig(): Required<SwarmConfig> {
    return this.config;
  }
}

// ========== 默认实例 ==========

export const agentSwarm = new AgentSwarm();

// ========== 辅助函数 ==========

/**
 * 创建 Swarm 任务
 */
export function createSwarmTask(
  content: string,
  options: Partial<SwarmTask> = {}
): SwarmTask {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content,
    priority: options.priority ?? 5,
    requiredSkills: options.requiredSkills,
    timeout: options.timeout,
    maxRetries: options.maxRetries,
    context: options.context,
  };
}

/**
 * 创建批量 Swarm 任务
 */
export function createSwarmTasks(
  contents: string[],
  options: Partial<SwarmTask> = {}
): SwarmTask[] {
  return contents.map((content, index) => ({
    ...createSwarmTask(content, options),
    id: `task-${index}-${Date.now()}`,
  }));
}