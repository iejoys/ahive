/**
 * AHIVECORE 内存监控模块
 * 
 * 职责：
 * - 定时采集进程内存数据
 * - 通过 WebSocket 推送到 AHIVE 客户端
 * - 内存预警机制
 * 
 * 使用 ws-client 统一通讯通道
 */

import { logger } from '../utils/index.js';
import { EventEmitter } from 'events';
import os from 'os';
import { getWSClient, WSClient, type MemoryUpdateData } from './ws-client.js';

// ==================== 类型定义 ====================

/**
 * 内存使用数据
 */
export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  timestamp: number;
}

/**
 * 内存统计信息
 */
export interface MemoryStats {
  current: MemoryUsage;
  peak: MemoryUsage;
  average: MemoryUsage;
  uptime: number;
  sampleCount: number;
  isWarning: boolean;
  warningMessage?: string;
}

/**
 * 内存监控配置
 */
export interface MemoryMonitorConfig {
  sampleInterval: number;
  warningThresholdMB: number;
  dangerThresholdMB: number;
  maxHistorySize: number;
  enableLogging: boolean;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: MemoryMonitorConfig = {
  sampleInterval: 30000,
  warningThresholdMB: 500,
  dangerThresholdMB: 800,
  maxHistorySize: 2880,
  enableLogging: true,
};

// ==================== 内存监控器 ====================

/**
 * 内存监控器
 */
export class MemoryMonitor extends EventEmitter {
  private config: MemoryMonitorConfig;
  private interval: NodeJS.Timeout | null = null;
  private history: MemoryUsage[] = [];
  private peak: MemoryUsage;
  private startTime: number;
  private isRunning: boolean = false;
  private wsClient: WSClient;

  constructor(config?: Partial<MemoryMonitorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
    this.peak = this.captureMemoryUsage();
    this.wsClient = getWSClient();
  }

  /**
   * 启动监控
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[MemoryMonitor] 监控已在运行中');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();
    
    // 立即采集一次
    this.sample();
    
    // 定时采集
    this.interval = setInterval(() => {
      this.sample();
    }, this.config.sampleInterval);

    logger.info(`[MemoryMonitor] 📊 内存监控已启动 (采样间隔: ${this.config.sampleInterval / 1000}s)`);
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('[MemoryMonitor] 内存监控已停止');
  }

  /**
   * 获取当前统计信息
   */
  getStats(): MemoryStats {
    const current = this.captureMemoryUsage();
    
    return {
      current,
      peak: this.peak,
      average: this.calculateAverage(),
      uptime: Date.now() - this.startTime,
      sampleCount: this.history.length,
      isWarning: this.isWarningState(current),
      warningMessage: this.getWarningMessage(current),
    };
  }

  /**
   * 获取历史数据
   */
  getHistory(limit?: number): MemoryUsage[] {
    if (limit && limit < this.history.length) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /**
   * 清空历史数据
   */
  clearHistory(): void {
    this.history = [];
    this.peak = this.captureMemoryUsage();
    logger.info('[MemoryMonitor] 历史数据已清空');
  }

  // ==================== 私有方法 ====================

  /**
   * 采样
   */
  private sample(): void {
    const usage = this.captureMemoryUsage();
    
    // 记录历史
    this.history.push(usage);
    if (this.history.length > this.config.maxHistorySize) {
      this.history.shift();
    }
    
    // 更新峰值
    if (usage.heapUsed > this.peak.heapUsed) {
      this.peak = usage;
    }
    
    // 日志记录
    if (this.config.enableLogging) {
      const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(1);
      const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(1);
      const percent = ((usage.heapUsed / usage.heapTotal) * 100).toFixed(1);
      
      logger.debug(`[MemoryMonitor] 📊 堆内存: ${heapUsedMB}/${heapTotalMB}MB (${percent}%)`);
    }
    
    // 发送更新事件
    this.emit('update', this.getStats());
    
    // 通过 WebSocket 推送
    this.pushToWebSocket();
    
    // 预警检查
    if (this.isWarningState(usage)) {
      const stats = this.getStats();
      logger.warn(`[MemoryMonitor] ⚠️ ${stats.warningMessage}`);
      this.emit('warning', stats);
    }
  }

  /**
   * 推送到 WebSocket
   */
  private pushToWebSocket(): void {
    const stats = this.getStats();
    const current = stats.current;
    const heapUsedPercent = (current.heapUsed / current.heapTotal) * 100;
    
    // 获取系统内存信息
    const totalSystemMemory = os.totalmem();
    const freeSystemMemory = os.freemem();
    const usedSystemMemory = totalSystemMemory - freeSystemMemory;
    const systemMemoryPercent = (current.rss / totalSystemMemory) * 100;
    
    const data: MemoryUpdateData = {
      category: 'memory',
      heapUsedMB: Math.round(current.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotalMB: Math.round(current.heapTotal / 1024 / 1024 * 100) / 100,
      externalMB: Math.round(current.external / 1024 / 1024 * 100) / 100,
      rssMB: Math.round(current.rss / 1024 / 1024 * 100) / 100,
      heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
      peakHeapUsedMB: Math.round(stats.peak.heapUsed / 1024 / 1024 * 100) / 100,
      averageHeapUsedMB: Math.round(stats.average.heapUsed / 1024 / 1024 * 100) / 100,
      uptimeSeconds: Math.floor(stats.uptime / 1000),
      isWarning: stats.isWarning,
      warningMessage: stats.warningMessage,
      // 新增系统内存信息
      systemTotalMB: Math.round(totalSystemMemory / 1024 / 1024),
      systemUsedMB: Math.round(usedSystemMemory / 1024 / 1024),
      systemMemoryPercent: Math.round(systemMemoryPercent * 100) / 100,
    };
    
    this.wsClient.sendMemoryUpdate(data);
  }

  /**
   * 采集内存使用
   */
  private captureMemoryUsage(): MemoryUsage {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      timestamp: Date.now(),
    };
  }

  /**
   * 计算平均值
   */
  private calculateAverage(): MemoryUsage {
    if (this.history.length === 0) {
      return this.captureMemoryUsage();
    }
    
    const sum = this.history.reduce(
      (acc, curr) => ({
        heapUsed: acc.heapUsed + curr.heapUsed,
        heapTotal: acc.heapTotal + curr.heapTotal,
        external: acc.external + curr.external,
        rss: acc.rss + curr.rss,
        timestamp: 0,
      }),
      { heapUsed: 0, heapTotal: 0, external: 0, rss: 0, timestamp: 0 }
    );
    
    const count = this.history.length;
    return {
      heapUsed: Math.round(sum.heapUsed / count),
      heapTotal: Math.round(sum.heapTotal / count),
      external: Math.round(sum.external / count),
      rss: Math.round(sum.rss / count),
      timestamp: Date.now(),
    };
  }

  /**
   * 检查是否处于预警状态
   */
  private isWarningState(usage: MemoryUsage): boolean {
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    return heapUsedMB >= this.config.warningThresholdMB;
  }

  /**
   * 获取预警信息
   */
  private getWarningMessage(usage: MemoryUsage): string | undefined {
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    
    if (heapUsedMB >= this.config.dangerThresholdMB) {
      return `内存使用达到危险水平: ${heapUsedMB.toFixed(1)}MB`;
    }
    
    if (heapUsedMB >= this.config.warningThresholdMB) {
      return `内存使用超过预警阈值: ${heapUsedMB.toFixed(1)}MB`;
    }
    
    return undefined;
  }
}

// ==================== 全局实例 ====================

let globalMemoryMonitor: MemoryMonitor | null = null;

export function getMemoryMonitor(config?: Partial<MemoryMonitorConfig>): MemoryMonitor {
  if (!globalMemoryMonitor) {
    globalMemoryMonitor = new MemoryMonitor(config);
  }
  return globalMemoryMonitor;
}

export function startMemoryMonitor(config?: Partial<MemoryMonitorConfig>): MemoryMonitor {
  const monitor = getMemoryMonitor(config);
  monitor.start();
  return monitor;
}

export function stopMemoryMonitor(): void {
  if (globalMemoryMonitor) {
    globalMemoryMonitor.stop();
  }
}