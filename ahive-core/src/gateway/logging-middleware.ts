/**
 * Logging Middleware - 日志中间件
 * 
 * 功能：
 * - 记录所有 HTTP 请求
 * - 记录响应时间和状态码
 * - 支持日志轮转（按大小）
 * - 支持日志查询
 */

import fs from 'fs';
import path from 'path';
import { generateId } from '../utils/index.js';

// ============ 接口定义 ============

/**
 * 日志条目
 */
export interface LogEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  agent_id?: string;
  request_size?: number;
  response_size?: number;
  user_agent?: string;
  ip?: string;
}

/**
 * 日志查询参数
 */
export interface LogQuery {
  path?: string;
  method?: string;
  agent_id?: string;
  status_min?: number;
  status_max?: number;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}

// ============ 日志存储类 ============

export class LogStore {
  private logPath: string;
  private maxSize: number;  // 最大文件大小（字节）
  private maxFiles: number; // 最多保留几个文件

  constructor(logPath?: string, maxSizeMB: number = 10, maxFiles: number = 5) {
    this.logPath = logPath || path.join(process.cwd(), 'logs', 'access.log');
    this.maxSize = maxSizeMB * 1024 * 1024;
    this.maxFiles = maxFiles;
    this.ensureLogDir();
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 检查是否需要轮转
   */
  private shouldRotate(): boolean {
    try {
      if (!fs.existsSync(this.logPath)) {
        return false;
      }
      const stats = fs.statSync(this.logPath);
      return stats.size >= this.maxSize;
    } catch {
      return false;
    }
  }

  /**
   * 轮转日志文件
   */
  private rotate(): void {
    try {
      // 删除最旧的文件
      const oldestFile = `${this.logPath}.${this.maxFiles - 1}`;
      if (fs.existsSync(oldestFile)) {
        fs.unlinkSync(oldestFile);
      }

      // 重命名现有文件
      for (let i = this.maxFiles - 2; i >= 0; i--) {
        const oldPath = `${this.logPath}.${i}`;
        const newPath = `${this.logPath}.${i + 1}`;
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath);
        }
      }

      // 重命名当前文件
      if (fs.existsSync(this.logPath)) {
        fs.renameSync(this.logPath, `${this.logPath}.1`);
      }
    } catch (error) {
      console.error('[LogStore] 轮转失败:', error);
    }
  }

  /**
   * 写入日志
   */
  write(entry: LogEntry): void {
    try {
      // 检查是否需要轮转
      if (this.shouldRotate()) {
        this.rotate();
      }

      // 写入日志（JSONL 格式）
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logPath, line, 'utf-8');
    } catch (error) {
      console.error('[LogStore] 写入日志失败:', error);
    }
  }

  /**
   * 查询日志
   */
  query(filters: LogQuery): LogEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) {
        return [];
      }

      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const entries: LogEntry[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // 过滤
          if (filters.path && !entry.path.includes(filters.path)) continue;
          if (filters.method && entry.method !== filters.method) continue;
          if (filters.agent_id && entry.agent_id !== filters.agent_id) continue;
          if (filters.status_min && entry.status < filters.status_min) continue;
          if (filters.status_max && entry.status > filters.status_max) continue;
          if (filters.start && entry.timestamp < filters.start) continue;
          if (filters.end && entry.timestamp > filters.end) continue;

          entries.push(entry);
        } catch {
          // 跳过无效行
        }
      }

      // 排序（最新在前）
      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      // 分页
      const offset = filters.offset || 0;
      const limit = filters.limit || 100;
      return entries.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }

  /**
   * 获取日志统计
   */
  getStats(hours: number = 24): {
    total_requests: number;
    avg_duration_ms: number;
    error_count: number;
    by_path: Array<{ path: string; count: number }>;
    by_status: Array<{ status: number; count: number }>;
  } {
    try {
      const now = Date.now();
      const cutoff = new Date(now - hours * 60 * 60 * 1000).toISOString();
      const entries = this.query({ start: cutoff, limit: 10000 });

      const stats = {
        total_requests: entries.length,
        avg_duration_ms: 0,
        error_count: entries.filter(e => e.status >= 400).length,
        by_path: [] as Array<{ path: string; count: number }>,
        by_status: [] as Array<{ status: number; count: number }>,
      };

      // 平均响应时间
      if (entries.length > 0) {
        stats.avg_duration_ms = Math.round(
          entries.reduce((sum, e) => sum + e.duration_ms, 0) / entries.length
        );
      }

      // 按路径统计
      const pathMap = new Map<string, number>();
      for (const e of entries) {
        const basePath = e.path.split('?')[0];
        pathMap.set(basePath, (pathMap.get(basePath) || 0) + 1);
      }
      stats.by_path = Array.from(pathMap.entries())
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // 按状态码统计
      const statusMap = new Map<number, number>();
      for (const e of entries) {
        statusMap.set(e.status, (statusMap.get(e.status) || 0) + 1);
      }
      stats.by_status = Array.from(statusMap.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);

      return stats;
    } catch {
      return {
        total_requests: 0,
        avg_duration_ms: 0,
        error_count: 0,
        by_path: [],
        by_status: [],
      };
    }
  }

  /**
   * 清除旧日志
   */
  clearOlderThan(hours: number): number {
    try {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      let kept = 0;
      const newLines: string[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.timestamp >= cutoff) {
            newLines.push(line);
            kept++;
          }
        } catch {
          newLines.push(line); // 保留无效行
          kept++;
        }
      }

      const removed = lines.length - kept;
      if (removed > 0) {
        fs.writeFileSync(this.logPath, newLines.join('\n'), 'utf-8');
      }

      return removed;
    } catch {
      return 0;
    }
  }
}

// 全局单例
export const logStore = new LogStore();

// ============ 日志中间件 ============

/**
 * HTTP 请求接口
 */
interface HttpRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/**
 * HTTP 响应接口
 */
interface HttpResponse {
  statusCode?: number;
  on: (event: string, listener: () => void) => void;
}

/**
 * 创建日志中间件
 */
export function createLoggingMiddleware() {
  return function loggingMiddleware(
    req: HttpRequest,
    res: HttpResponse,
    next: () => void
  ): void {
    const startTime = Date.now();
    const requestId = generateId('req');

    // 监听响应完成
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      const entry: LogEntry = {
        id: requestId,
        timestamp: new Date().toISOString(),
        method: req.method || 'UNKNOWN',
        path: req.url || '/',
        status: res.statusCode || 0,
        duration_ms: duration,
        agent_id: (req as any).agentId,
        ip: req.socket?.remoteAddress,
        user_agent: Array.isArray(req.headers['user-agent']) 
          ? req.headers['user-agent'][0] 
          : req.headers['user-agent'],
      };

      logStore.write(entry);
    });

    next();
  };
}

// ============ 辅助函数 ============

/**
 * 查询日志（快捷函数）
 */
export function queryLogs(filters?: LogQuery): LogEntry[] {
  return logStore.query(filters || {});
}

/**
 * 获取日志统计（快捷函数）
 */
export function getLogStats(hours?: number) {
  return logStore.getStats(hours);
}
