/**
 * Usage Tracker - 用量追踪器
 * 
 * 功能：
 * - 记录每次 LLM 调用
 * - 计算成本
 * - 提供查询接口
 */

import { logger } from '../utils/index.js';
import { generateId } from '../utils/index.js';
import fs from 'fs';
import path from 'path';

// ============ 接口定义 ============

/**
 * 用量记录
 */
export interface UsageRecord {
  id: string;
  request_id: string;
  agent_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost: number;
  currency: string;
  status: 'success' | 'error';
  error_message?: string;
  created_at: string;
}

/**
 * 用量统计
 */
export interface UsageStats {
  period: {
    start: string;
    end: string;
  };
  total: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: number;
    currency: string;
  };
  by_agent: Array<{
    agent_id: string;
    requests: number;
    cost: number;
  }>;
  by_model: Array<{
    model: string;
    requests: number;
    cost: number;
  }>;
}

// ============ 用量追踪器类 ============

export class UsageTracker {
  private records: UsageRecord[] = [];
  private dataPath: string;

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data', 'usage.json');
    this.load();
  }

  /**
   * 加载历史数据
   */
  private load(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf-8');
        this.records = JSON.parse(data);
        logger.info(`📊 [Usage Tracker] 已加载 ${this.records.length} 条历史用量记录`);
      }
    } catch (error) {
      logger.warn(`⚠️ [Usage Tracker] 加载历史数据失败：${error}`);
      this.records = [];
    }
  }

  /**
   * 保存数据
   */
  private save(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(this.records, null, 2));
    } catch (error) {
      logger.warn(`⚠️ [Usage Tracker] 保存数据失败：${error}`);
    }
  }

  /**
   * 记录用量
   */
  record(record: Omit<UsageRecord, 'id' | 'created_at'>): UsageRecord {
    const fullRecord: UsageRecord = {
      ...record,
      id: generateId('usage'),
      created_at: new Date().toISOString(),
    };

    this.records.push(fullRecord);
    
    // 限制记录数量（保留最近 10000 条）
    if (this.records.length > 10000) {
      this.records = this.records.slice(-10000);
    }

    this.save();

    logger.debug(
      `📝 [Usage Tracker] 记录用量：${record.agent_id}, ${record.model}, ${record.total_tokens} tokens, ¥${record.cost.toFixed(4)}`
    );

    return fullRecord;
  }

  /**
   * 查询用量记录
   */
  query(filters: {
    agent_id?: string;
    model?: string;
    start?: string;
    end?: string;
    limit?: number;
    offset?: number;
  }): UsageRecord[] {
    let result = [...this.records];

    // 按 Agent 过滤
    if (filters.agent_id) {
      result = result.filter(r => r.agent_id === filters.agent_id);
    }

    // 按模型过滤
    if (filters.model) {
      result = result.filter(r => r.model === filters.model);
    }

    // 按时间过滤
    if (filters.start) {
      result = result.filter(r => r.created_at >= filters.start!);
    }
    if (filters.end) {
      result = result.filter(r => r.created_at <= filters.end!);
    }

    // 排序（最新在前）
    result.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // 分页
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    result = result.slice(offset, offset + limit);

    return result;
  }

  /**
   * 获取统计信息
   */
  getStats(filters: {
    agent_id?: string;
    model?: string;
    start?: string;
    end?: string;
  }): UsageStats {
    let result = [...this.records];

    // 按时间过滤
    if (filters.start) {
      result = result.filter(r => r.created_at >= filters.start!);
    }
    if (filters.end) {
      result = result.filter(r => r.created_at <= filters.end!);
    }

    // 按 Agent 过滤
    if (filters.agent_id) {
      result = result.filter(r => r.agent_id === filters.agent_id);
    }

    // 按模型过滤
    if (filters.model) {
      result = result.filter(r => r.model === filters.model);
    }

    // 计算总计
    const total = result.reduce(
      (acc, r) => ({
        requests: acc.requests + 1,
        prompt_tokens: acc.prompt_tokens + r.prompt_tokens,
        completion_tokens: acc.completion_tokens + r.completion_tokens,
        total_tokens: acc.total_tokens + r.total_tokens,
        cost: acc.cost + r.cost,
        currency: 'CNY',
      }),
      {
        requests: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        cost: 0,
        currency: 'CNY',
      }
    );

    // 按 Agent 分组
    const agentMap = new Map<string, { requests: number; cost: number }>();
    for (const r of result) {
      const existing = agentMap.get(r.agent_id) || { requests: 0, cost: 0 };
      existing.requests += 1;
      existing.cost += r.cost;
      agentMap.set(r.agent_id, existing);
    }

    const by_agent = Array.from(agentMap.entries())
      .map(([agent_id, data]) => ({ agent_id, ...data }))
      .sort((a, b) => b.cost - a.cost);

    // 按模型分组
    const modelMap = new Map<string, { requests: number; cost: number }>();
    for (const r of result) {
      const existing = modelMap.get(r.model) || { requests: 0, cost: 0 };
      existing.requests += 1;
      existing.cost += r.cost;
      modelMap.set(r.model, existing);
    }

    const by_model = Array.from(modelMap.entries())
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.cost - a.cost);

    return {
      period: {
        start: filters.start || this.records[0]?.created_at || '',
        end: filters.end || new Date().toISOString(),
      },
      total,
      by_agent,
      by_model,
    };
  }

  /**
   * 获取 Agent 本月用量
   */
  getAgentMonthlyUsage(agentId: string): {
    cost: number;
    tokens: number;
    requests: number;
  } {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const stats = this.getStats({
      agent_id: agentId,
      start: startOfMonth,
    });

    return {
      cost: stats.total.cost,
      tokens: stats.total.total_tokens,
      requests: stats.total.requests,
    };
  }

  /**
   * 清除旧数据
   */
  clearOlderThan(days: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    const initialLength = this.records.length;
    this.records = this.records.filter(r => r.created_at >= cutoffStr);
    const removed = initialLength - this.records.length;

    if (removed > 0) {
      this.save();
      logger.info(`🧹 [Usage Tracker] 已清除 ${removed} 条旧记录（>${days} 天）`);
    }

    return removed;
  }
}

// 全局单例
export const usageTracker = new UsageTracker();

// ============ 辅助函数 ============

/**
 * 记录用量（快捷函数）
 */
export function recordUsage(
  agentId: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  cost: number,
  status: 'success' | 'error' = 'success'
): UsageRecord {
  return usageTracker.record({
    request_id: generateId('req'),
    agent_id: agentId,
    model: model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    cost: cost,
    currency: 'CNY',
    status: status,
  });
}

/**
 * 获取统计信息（快捷函数）
 */
export function getUsageStats(filters?: {
  agent_id?: string;
  model?: string;
  start?: string;
  end?: string;
}): UsageStats {
  return usageTracker.getStats(filters || {});
}
