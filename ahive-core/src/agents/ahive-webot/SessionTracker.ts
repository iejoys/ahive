/**
 * 会话追踪器
 *
 * 维护 agentId → 会话信息的映射
 * 确保同一 Agent 的多次消息复用同一个会话
 * 每次新消息更新会话中的 reqId
 */

import { logger } from '../../utils/index.js';
import type { WecomSession } from './types.js';

export class SessionTracker {
  private sessions: Map<string, WecomSession> = new Map();
  private maxSessions: number = 100;  // 最大追踪 Agent 数量
  private timeout: number = 300000;    // 会话超时时间（5分钟）
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 定期清理超时会话（每分钟清理一次）
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000);
  }

  /**
   * 追踪/更新会话
   * 使用 targetAgentId 作为 key，同一 Agent 的多次消息复用同一个会话
   * 每次调用会更新会话中的 reqId 和 timestamp
   *
   * @param targetAgentId 目标 Agent ID
   * @param session 会话信息（包含最新的 reqId）
   */
  track(targetAgentId: string, session: WecomSession): void {
    const existing = this.sessions.get(targetAgentId);
    if (existing) {
      // 更新现有会话：保留 chatId，只更新 reqId 和 timestamp
      existing.reqId = session.reqId;
      existing.timestamp = Date.now();
      logger.debug(`[SessionTracker] 更新会话: agent=${targetAgentId}, reqId=${session.reqId}, chatId=${session.chatId}`);
    } else {
      // 创建新会话
      this.sessions.set(targetAgentId, session);
      logger.debug(`[SessionTracker] 创建新会话: agent=${targetAgentId}, reqId=${session.reqId}, chatId=${session.chatId}`);

      // 限制会话数量
      if (this.sessions.size > this.maxSessions) {
        this.cleanupOldest();
      }
    }
  }

  /**
   * 获取会话
   */
  get(targetAgentId: string): WecomSession | undefined {
    return this.sessions.get(targetAgentId);
  }

  /**
   * 移除会话
   */
  remove(targetAgentId: string): void {
    this.sessions.delete(targetAgentId);
    logger.debug(`[SessionTracker] 移除会话: agent=${targetAgentId}`);
  }

  /**
   * 检查会话是否存在
   */
  has(targetAgentId: string): boolean {
    return this.sessions.has(targetAgentId);
  }

  /**
   * 清理超时会话
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [agentId, session] of this.sessions) {
      if (now - session.timestamp > this.timeout) {
        expired.push(agentId);
      }
    }

    for (const agentId of expired) {
      this.sessions.delete(agentId);
      logger.debug(`[SessionTracker] 清理超时会话: agent=${agentId}`);
    }

    if (expired.length > 0) {
      logger.info(`[SessionTracker] 清理了 ${expired.length} 个超时会话`);
    }
  }

  /**
   * 清理最旧的会话
   */
  private cleanupOldest(): void {
    const entries = Array.from(this.sessions.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, 10);
    for (const [agentId] of toRemove) {
      this.sessions.delete(agentId);
    }

    logger.info(`[SessionTracker] 清理了 ${toRemove.length} 个最旧会话`);
  }

  /**
   * 获取会话数量
   */
  size(): number {
    return this.sessions.size;
  }

  /**
   * 获取所有会话
   */
  getAll(): WecomSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 清空所有会话
   */
  clear(): void {
    this.sessions.clear();
    logger.info('[SessionTracker] 已清空所有会话');
  }

  /**
   * 销毁追踪器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}