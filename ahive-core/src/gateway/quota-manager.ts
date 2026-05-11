/**
 * Quota Manager - 配额管理器
 * 
 * 功能：
 * - 速率限制（QPM）
 * - 月度预算检查
 * - 并发限制
 */

import { logger } from '../utils/index.js';
import { usageTracker } from '../analytics/usage-tracker.js';
import { configStore, type QuotaConfig as StoreQuotaConfig } from '../storage/config-store.js';

// ============ 接口定义 ============

/**
 * 配额配置
 */
export interface QuotaConfig {
  agent_id: string;
  monthly_budget: number;      // 月度预算（元）
  daily_budget: number;        // 日预算（元）
  qpm_limit: number;           // 每分钟请求数限制
  concurrent_limit: number;    // 并发请求数限制
  token_limit_per_minute: number; // 每分钟 token 限制
}

/**
 * 配额检查结果
 */
export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    budget: number;
    qpm: number;
    tokens: number;
  };
}

// ============ 默认配额配置 ============

const DEFAULT_QUOTAS: Record<string, QuotaConfig> = {
  'ahive-worker': {
    agent_id: 'ahive-worker',
    monthly_budget: 500,
    daily_budget: 50,
    qpm_limit: 60,
    concurrent_limit: 5,
    token_limit_per_minute: 100000,
  },
  'ahive-coder': {
    agent_id: 'ahive-coder',
    monthly_budget: 300,
    daily_budget: 30,
    qpm_limit: 40,
    concurrent_limit: 3,
    token_limit_per_minute: 75000,
  },
  'default': {
    agent_id: 'default',
    monthly_budget: 100,
    daily_budget: 10,
    qpm_limit: 20,
    concurrent_limit: 2,
    token_limit_per_minute: 30000,
  },
};

// ============ 配额管理器类 ============

export class QuotaManager {
  private qpmCounters: Map<string, number[]> = new Map();
  private concurrentCounters: Map<string, number> = new Map();
  private tokenCounters: Map<string, { tokens: number; timestamp: number }[]> = new Map();

  constructor() {
    logger.info(`📊 [Quota Manager] 配额管理器已初始化`);
  }

  /**
   * 获取配额配置
   */
  getQuota(agentId: string): QuotaConfig {
    const quota = configStore.getQuota(agentId);
    if (!quota) {
      return DEFAULT_QUOTAS['default'];
    }
    return {
      agent_id: quota.agent_id,
      monthly_budget: quota.monthly_budget,
      daily_budget: quota.daily_budget,
      qpm_limit: quota.qpm_limit,
      concurrent_limit: quota.concurrent_limit,
      token_limit_per_minute: quota.token_limit_per_minute,
    };
  }

  /**
   * 更新配额配置
   */
  updateQuota(config: QuotaConfig): QuotaConfig {
    const stored: StoreQuotaConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    configStore.updateQuota(stored);
    logger.info(`🔄 [Quota Manager] 已更新配额：${config.agent_id}`);
    return config;
  }

  /**
   * 检查配额
   */
  async checkQuota(agentId: string, estimatedTokens: number = 0): Promise<QuotaCheckResult> {
    const quota = this.getQuota(agentId);

    // 1. 检查月度预算
    const monthlyUsage = usageTracker.getAgentMonthlyUsage(agentId);
    if (monthlyUsage.cost >= quota.monthly_budget) {
      logger.warn(`⚠️ [Quota] ${agentId} 月度预算已用尽：¥${monthlyUsage.cost.toFixed(2)} / ¥${quota.monthly_budget}`);
      return {
        allowed: false,
        reason: '月度预算已用尽',
        remaining: {
          budget: 0,
          qpm: quota.qpm_limit - this.getCurrentQPM(agentId),
          tokens: quota.token_limit_per_minute - this.getCurrentTokenUsage(agentId),
        },
      };
    }

    // 2. 检查日预算
    const dailyUsage = this.getDailyUsage(agentId);
    if (dailyUsage.cost >= quota.daily_budget) {
      logger.warn(`⚠️ [Quota] ${agentId} 日预算已用尽：¥${dailyUsage.cost.toFixed(2)} / ¥${quota.daily_budget}`);
      return {
        allowed: false,
        reason: '日预算已用尽',
        remaining: {
          budget: quota.daily_budget - dailyUsage.cost,
          qpm: quota.qpm_limit - this.getCurrentQPM(agentId),
          tokens: quota.token_limit_per_minute - this.getCurrentTokenUsage(agentId),
        },
      };
    }

    // 3. 检查 QPM
    const currentQPM = this.getCurrentQPM(agentId);
    if (currentQPM >= quota.qpm_limit) {
      logger.warn(`⚠️ [Quota] ${agentId} QPM 超限：${currentQPM} / ${quota.qpm_limit}`);
      return {
        allowed: false,
        reason: '请求速率超限 (QPM)',
        remaining: {
          budget: quota.monthly_budget - monthlyUsage.cost,
          qpm: 0,
          tokens: quota.token_limit_per_minute - this.getCurrentTokenUsage(agentId),
        },
      };
    }

    // 4. 检查并发
    const currentConcurrent = this.concurrentCounters.get(agentId) || 0;
    if (currentConcurrent >= quota.concurrent_limit) {
      logger.warn(`⚠️ [Quota] ${agentId} 并发超限：${currentConcurrent} / ${quota.concurrent_limit}`);
      return {
        allowed: false,
        reason: '并发请求数超限',
        remaining: {
          budget: quota.monthly_budget - monthlyUsage.cost,
          qpm: quota.qpm_limit - currentQPM,
          tokens: quota.token_limit_per_minute - this.getCurrentTokenUsage(agentId),
        },
      };
    }

    // 5. 检查 Token 速率
    const currentTokenUsage = this.getCurrentTokenUsage(agentId);
    if (currentTokenUsage + estimatedTokens > quota.token_limit_per_minute) {
      logger.warn(`⚠️ [Quota] ${agentId} Token 速率超限：${currentTokenUsage + estimatedTokens} / ${quota.token_limit_per_minute}`);
      return {
        allowed: false,
        reason: 'Token 速率超限',
        remaining: {
          budget: quota.monthly_budget - monthlyUsage.cost,
          qpm: quota.qpm_limit - currentQPM,
          tokens: 0,
        },
      };
    }

    // 全部通过
    return {
      allowed: true,
      remaining: {
        budget: quota.monthly_budget - monthlyUsage.cost,
        qpm: quota.qpm_limit - currentQPM,
        tokens: quota.token_limit_per_minute - currentTokenUsage - estimatedTokens,
      },
    };
  }

  /**
   * 记录请求（QPM 计数）
   */
  recordRequest(agentId: string): void {
    const now = Date.now();
    const timestamps = this.qpmCounters.get(agentId) || [];
    
    // 保留最近 1 分钟的记录
    const windowMs = 60000;
    const recent = timestamps.filter(t => now - t < windowMs);
    recent.push(now);
    
    this.qpmCounters.set(agentId, recent);
  }

  /**
   * 记录 Token 使用
   */
  recordTokens(agentId: string, tokens: number): void {
    const now = Date.now();
    const records = this.tokenCounters.get(agentId) || [];
    
    // 保留最近 1 分钟的记录
    const windowMs = 60000;
    const recent = records.filter(r => now - r.timestamp < windowMs);
    recent.push({ tokens, timestamp: now });
    
    this.tokenCounters.set(agentId, recent);
  }

  /**
   * 增加并发计数
   */
  incrementConcurrent(agentId: string): void {
    const current = this.concurrentCounters.get(agentId) || 0;
    this.concurrentCounters.set(agentId, current + 1);
  }

  /**
   * 减少并发计数
   */
  decrementConcurrent(agentId: string): void {
    const current = this.concurrentCounters.get(agentId) || 0;
    this.concurrentCounters.set(agentId, Math.max(0, current - 1));
  }

  /**
   * 获取当前 QPM
   */
  private getCurrentQPM(agentId: string): number {
    const now = Date.now();
    const windowMs = 60000;
    const timestamps = this.qpmCounters.get(agentId) || [];
    return timestamps.filter(t => now - t < windowMs).length;
  }

  /**
   * 获取当前 Token 使用量（每分钟）
   */
  private getCurrentTokenUsage(agentId: string): number {
    const now = Date.now();
    const windowMs = 60000;
    const records = this.tokenCounters.get(agentId) || [];
    return records
      .filter(r => now - r.timestamp < windowMs)
      .reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * 获取日使用量
   */
  private getDailyUsage(agentId: string): { cost: number; tokens: number; requests: number } {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    
    const stats = usageTracker.getStats({
      agent_id: agentId,
      start: startOfDay,
    });
    
    return {
      cost: stats.total.cost,
      tokens: stats.total.total_tokens,
      requests: stats.total.requests,
    };
  }

  /**
   * 获取所有配额状态
   */
  getAllQuotaStatus(): Array<{
    agent_id: string;
    quota: QuotaConfig;
    usage: {
      monthly_cost: number;
      daily_cost: number;
      current_qpm: number;
      current_concurrent: number;
    };
  }> {
    const result = [];
    const quotas = configStore.getAllQuotas();
    
    for (const quota of quotas) {
      const monthlyUsage = usageTracker.getAgentMonthlyUsage(quota.agent_id);
      const dailyUsage = this.getDailyUsage(quota.agent_id);
      
      result.push({
        agent_id: quota.agent_id,
        quota: {
          agent_id: quota.agent_id,
          monthly_budget: quota.monthly_budget,
          daily_budget: quota.daily_budget,
          qpm_limit: quota.qpm_limit,
          concurrent_limit: quota.concurrent_limit,
          token_limit_per_minute: quota.token_limit_per_minute,
        },
        usage: {
          monthly_cost: monthlyUsage.cost,
          daily_cost: dailyUsage.cost,
          current_qpm: this.getCurrentQPM(quota.agent_id),
          current_concurrent: this.concurrentCounters.get(quota.agent_id) || 0,
        },
      });
    }
    
    return result;
  }
}

// 全局单例
export const quotaManager = new QuotaManager();

// ============ 辅助函数 ============

/**
 * 检查配额（快捷函数）
 */
export function checkAgentQuota(agentId: string, estimatedTokens?: number): Promise<QuotaCheckResult> {
  return quotaManager.checkQuota(agentId, estimatedTokens);
}

/**
 * 获取配额配置（快捷函数）
 */
export function getAgentQuota(agentId: string): QuotaConfig {
  return quotaManager.getQuota(agentId);
}
