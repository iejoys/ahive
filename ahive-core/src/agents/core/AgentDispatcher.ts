/**
 * AHIVECORE - 智能体调度器
 * 
 * 自动分析任务并决定是否分身执行
 * 
 * 核心逻辑：
 * 1. 分析任务复杂度
 * 2. 判断是否需要分身
 * 3. 自动拆分任务
 * 4. 并行执行并汇总结果
 */

import { AgentController, AgentStatus, type AgentResult } from './AgentController.js';
import type { LLMClient, ChatMessage } from '../index.js';

// ==================== 类型定义 ====================

/** 任务复杂度 */
export type TaskComplexity = 'simple' | 'medium' | 'complex' | 'parallel';

/** 任务分析结果 */
export interface TaskAnalysis {
  /** 复杂度 */
  complexity: TaskComplexity;
  
  /** 是否需要分身 */
  needsSpawn: boolean;
  
  /** 子任务列表 */
  subTasks?: string[];
  
  /** 推荐分身数量 */
  recommendedAgents?: number;
  
  /** 推理过程 */
  reasoning: string;
}

/** 调度结果 */
export interface DispatchResult {
  /** 主智能体 ID */
  mainAgentId: string;
  
  /** 子智能体 ID 列表 */
  workerAgentIds: string[];
  
  /** 各智能体结果 */
  results: AgentResult[];
  
  /** 汇总结果 */
  summary: string;
  
  /** 总耗时 */
  totalDuration: number;
}

// ==================== 智能体调度器 ====================

/**
 * 智能体调度器
 * 
 * 自动分析任务并分身执行
 */
export class AgentDispatcher {
  private controller: AgentController;
  private llmClient?: LLMClient;
  private maxWorkers: number = 3;
  private autoSpawnThreshold: 'medium' | 'complex' = 'complex';

  constructor(options?: {
    llmClient?: LLMClient;
    maxWorkers?: number;
    autoSpawnThreshold?: 'medium' | 'complex';
  }) {
    this.controller = new AgentController();
    this.llmClient = options?.llmClient;
    this.maxWorkers = options?.maxWorkers ?? 3;
    this.autoSpawnThreshold = options?.autoSpawnThreshold ?? 'complex';
  }

  // ==================== 核心方法 ====================

  /**
   * 智能调度 - 自动分析并执行任务
   */
  async dispatch(task: string): Promise<DispatchResult> {
    const startTime = Date.now();

    // 1. 创建主智能体
    const mainId = this.controller.createMainAgent();

    // 2. 分析任务
    const analysis = await this.analyzeTask(task);

    // 3. 根据复杂度决定执行方式
    if (!analysis.needsSpawn) {
      // 简单任务：主智能体直接执行
      return this.executeSimple(mainId, task, startTime);
    }

    // 4. 复杂任务：分身执行
    return this.executeParallel(mainId, task, analysis, startTime);
  }

  /**
   * 分析任务复杂度
   */
  async analyzeTask(task: string): Promise<TaskAnalysis> {
    // 简单规则判断（快速）
    const ruleAnalysis = this.analyzeWithRules(task);
    
    // 如果规则置信度高，直接返回
    if (ruleAnalysis.needsSpawn !== undefined) {
      return ruleAnalysis;
    }

    // 使用 LLM 深度分析
    if (this.llmClient) {
      return this.analyzeWithLLM(task);
    }

    // 默认：中等复杂度，不分身
    return {
      complexity: 'medium',
      needsSpawn: false,
      reasoning: 'Unable to analyze task complexity, using single agent',
    };
  }

  /**
   * 规则分析（快速）
   */
  private analyzeWithRules(task: string): TaskAnalysis {
    const lowerTask = task.toLowerCase();

    // 明确需要并行的关键词
    const parallelKeywords = [
      '同时', '并行', '分别', '同时处理', '一起',
      'analyze and implement', 'both', 'simultaneously',
      '多个文件', '批量', '所有',
    ];

    for (const keyword of parallelKeywords) {
      if (lowerTask.includes(keyword)) {
        return {
          complexity: 'parallel',
          needsSpawn: true,
          recommendedAgents: 2,
          reasoning: `Detected parallel keyword: "${keyword}"`,
        };
      }
    }

    // 复杂任务关键词
    const complexKeywords = [
      '重构', '迁移', '系统', '架构', '模块',
      'refactor', 'migrate', 'architecture', 'system',
      '多步骤', '完整', '全栈',
    ];

    for (const keyword of complexKeywords) {
      if (lowerTask.includes(keyword)) {
        return {
          complexity: 'complex',
          needsSpawn: this.autoSpawnThreshold === 'complex',
          recommendedAgents: 3,
          reasoning: `Detected complex task keyword: "${keyword}"`,
        };
      }
    }

    // 简单任务关键词
    const simpleKeywords = [
      '修改', '修复', '添加', '更新', '删除',
      'fix', 'update', 'add', 'remove', 'change',
      '单个', '简单',
    ];

    for (const keyword of simpleKeywords) {
      if (lowerTask.includes(keyword)) {
        return {
          complexity: 'simple',
          needsSpawn: false,
          reasoning: `Detected simple task keyword: "${keyword}"`,
        };
      }
    }

    // 无法确定
    return {
      complexity: 'medium',
      needsSpawn: false,
      reasoning: 'Task complexity unclear, using single agent',
    };
  }

  /**
   * LLM 分析（深度）
   */
  private async analyzeWithLLM(task: string): Promise<TaskAnalysis> {
    const systemPrompt = `你是任务分析器。分析用户任务并判断是否需要并行处理。

返回 JSON 格式：
{
  "complexity": "simple" | "medium" | "complex" | "parallel",
  "needsSpawn": true/false,
  "subTasks": ["子任务1", "子任务2"],
  "recommendedAgents": 1-3,
  "reasoning": "判断理由"
}

判断标准：
- simple: 单文件、单步骤修改
- medium: 2-3个相关步骤
- complex: 多模块、多文件修改
- parallel: 明确可并行的独立任务`;

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ];

      const response = await this.llmClient!.chat(messages);
      
      // 解析 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          complexity: parsed.complexity || 'medium',
          needsSpawn: parsed.needsSpawn ?? false,
          subTasks: parsed.subTasks,
          recommendedAgents: parsed.recommendedAgents,
          reasoning: parsed.reasoning || 'LLM analysis',
        };
      }
    } catch (error) {
      console.warn('[AgentDispatcher] LLM analysis failed:', error);
    }

    return this.analyzeWithRules(task);
  }

  // ==================== 执行方法 ====================

  /**
   * 简单任务执行
   */
  private async executeSimple(
    mainId: string,
    task: string,
    startTime: number
  ): Promise<DispatchResult> {
    // 设置结果（实际执行由外部调用者完成）
    this.controller.setResult(mainId, {
      status: AgentStatus.Completed,
      content: `Task received: ${task}`,
      duration: Date.now() - startTime,
    });

    const result = await this.controller.waitAgent(mainId);

    return {
      mainAgentId: mainId,
      workerAgentIds: [],
      results: [result],
      summary: result.content || '',
      totalDuration: Date.now() - startTime,
    };
  }

  /**
   * 并行任务执行
   */
  private async executeParallel(
    mainId: string,
    task: string,
    analysis: TaskAnalysis,
    startTime: number
  ): Promise<DispatchResult> {
    const subTasks = analysis.subTasks || this.splitTask(task);
    const workerCount = Math.min(subTasks.length, this.maxWorkers);

    // 创建工作智能体
    const workerIds: string[] = [];
    for (let i = 0; i < workerCount; i++) {
      const workerId = await this.controller.spawnAgent(mainId, {
        message: subTasks[i] || `Process part ${i + 1} of: ${task}`,
        role: 'worker',
      });
      workerIds.push(workerId);
    }

    // 设置工作智能体结果（模拟完成）
    for (const workerId of workerIds) {
      this.controller.setResult(workerId, {
        status: AgentStatus.Completed,
        content: `Worker completed task`,
        duration: Math.random() * 1000 + 500,
      });
    }

    // 等待所有工作智能体完成
    const results = await this.controller.waitAgents(workerIds);

    // 汇总结果
    const summary = this.summarizeResults(results);

    return {
      mainAgentId: mainId,
      workerAgentIds: workerIds,
      results,
      summary,
      totalDuration: Date.now() - startTime,
    };
  }

  /**
   * 拆分任务（简单实现）
   */
  private splitTask(task: string): string[] {
    // 按句号或换行拆分
    const parts = task.split(/[。.。\n]+/).filter(p => p.trim().length > 10);
    
    if (parts.length > 1) {
      return parts;
    }

    // 无法拆分，返回原任务
    return [task];
  }

  /**
   * 汇总结果
   */
  private summarizeResults(results: AgentResult[]): string {
    const successCount = results.filter(r => r.status === AgentStatus.Completed).length;
    
    const contents = results
      .filter(r => r.content)
      .map(r => r.content)
      .join('\n\n');

    return `完成 ${successCount}/${results.length} 个子任务\n\n${contents}`;
  }

  // ==================== 配置方法 ====================

  /**
   * 设置最大工作智能体数量
   */
  setMaxWorkers(count: number): void {
    this.maxWorkers = Math.max(1, Math.min(count, 10));
  }

  /**
   * 设置自动分身阈值
   */
  setAutoSpawnThreshold(threshold: 'medium' | 'complex'): void {
    this.autoSpawnThreshold = threshold;
  }

  /**
   * 设置 LLM 客户端
   */
  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  /**
   * 获取控制器
   */
  getController(): AgentController {
    return this.controller;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.controller.destroy();
  }
}

// 导出
export const agentDispatcher = new AgentDispatcher();