/**
 * 审核任务追踪器
 * 
 * 维护 task_id → 审核任务的映射
 * 确保用户点击审核按钮后能路由回原智能体
 */

import { logger } from '../../utils/index.js';
import type { AuditTask } from './types.js';

export class AuditTracker {
  private tasks: Map<string, AuditTask> = new Map();
  private maxTasks: number = 100;     // 最大追踪任务数
  private timeout: number = 3600000;  // 任务超时时间（1小时）
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 定期清理超时任务（每5分钟清理一次）
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 300000);
  }

  /**
   * 追踪审核任务
   */
  track(taskId: string, task: AuditTask): void {
    this.tasks.set(taskId, task);

    // 限制任务数量
    if (this.tasks.size > this.maxTasks) {
      this.cleanupOldest();
    }

    logger.debug(`[AuditTracker] 追踪审核任务: taskId=${taskId}, fromAgent=${task.fromAgentId}`);
  }

  /**
   * 获取审核任务
   */
  get(taskId: string): AuditTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 移除审核任务
   */
  remove(taskId: string): void {
    this.tasks.delete(taskId);
    logger.debug(`[AuditTracker] 移除审核任务: taskId=${taskId}`);
  }

  /**
   * 检查任务是否存在
   */
  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  /**
   * 清理超时任务
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [taskId, task] of this.tasks) {
      if (now - task.timestamp > this.timeout) {
        expired.push(taskId);
      }
    }

    for (const taskId of expired) {
      this.tasks.delete(taskId);
      logger.debug(`[AuditTracker] 清理超时任务: taskId=${taskId}`);
    }

    if (expired.length > 0) {
      logger.info(`[AuditTracker] 清理了 ${expired.length} 个超时审核任务`);
    }
  }

  /**
   * 清理最旧的任务
   */
  private cleanupOldest(): void {
    const entries = Array.from(this.tasks.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, 10);
    for (const [taskId] of toRemove) {
      this.tasks.delete(taskId);
    }

    logger.info(`[AuditTracker] 清理了 ${toRemove.length} 个最旧审核任务`);
  }

  /**
   * 获取任务数量
   */
  size(): number {
    return this.tasks.size;
  }

  /**
   * 获取所有任务
   */
  getAll(): AuditTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 清空所有任务
   */
  clear(): void {
    this.tasks.clear();
    logger.info('[AuditTracker] 已清空所有审核任务');
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