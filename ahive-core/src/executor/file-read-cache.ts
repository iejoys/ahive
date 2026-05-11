/**
 * 文件读取缓存管理器
 *
 * 功能：
 * - 跟踪已读取文件的状态
 * - 支持去重检测（避免重复发送相同内容）
 * - 记录文件修改时间用于变更检测
 */

import fs from 'fs/promises';
import { logger } from '../utils/index.js';

/**
 * 文件读取记录
 */
interface FileReadRecord {
  /** 文件绝对路径 */
  absolutePath: string;
  /** 文件内容（可能被截断） */
  content: string;
  /** 最后修改时间戳 (ms) */
  lastModifiedTime: number;
  /** 读取起始行（0-based） */
  startLine: number;
  /** 读取行数限制 */
  lineLimit: number | undefined;
  /** 记录创建时间 */
  recordedAt: number;
}

/**
 * 缓存统计信息
 */
interface CacheStats {
  totalRecords: number;
  hitCount: number;
  missCount: number;
  lastCleanupTime: number;
}

/**
 * 文件读取缓存管理器
 */
export class FileReadCacheManager {
  private records: Map<string, FileReadRecord> = new Map();
  private stats: CacheStats = {
    totalRecords: 0,
    hitCount: 0,
    missCount: 0,
    lastCleanupTime: Date.now(),
  };

  /** 最大缓存条目数 */
  private maxEntries: number;

  /** 缓存过期时间 (ms) - 默认 30 分钟 */
  private expiryTime: number;

  constructor(options?: { maxEntries?: number; expiryTime?: number }) {
    this.maxEntries = options?.maxEntries ?? 500;
    this.expiryTime = options?.expiryTime ?? 30 * 60 * 1000;
  }

  /**
   * 生成缓存键
   */
  private createCacheKey(
    absolutePath: string,
    startLine: number,
    lineLimit: number | undefined
  ): string {
    return `${absolutePath}:${startLine}:${lineLimit ?? 'all'}`;
  }

  /**
   * 检查是否有缓存命中
   * 返回 null 表示未命中或已过期
   */
  async checkCache(
    absolutePath: string,
    startLine: number,
    lineLimit: number | undefined
  ): Promise<{ hit: boolean; content?: string; record?: FileReadRecord }> {
    const key = this.createCacheKey(absolutePath, startLine, lineLimit);
    const record = this.records.get(key);

    if (!record) {
      this.stats.missCount++;
      return { hit: false };
    }

    // 检查是否过期
    if (Date.now() - record.recordedAt > this.expiryTime) {
      this.records.delete(key);
      this.stats.missCount++;
      return { hit: false };
    }

    // 检查文件是否被修改
    try {
      const stats = await fs.stat(absolutePath);
      if (stats.mtimeMs !== record.lastModifiedTime) {
        // 文件已修改，缓存失效
        this.records.delete(key);
        this.stats.missCount++;
        return { hit: false };
      }
    } catch {
      // 文件可能已被删除
      this.records.delete(key);
      this.stats.missCount++;
      return { hit: false };
    }

    this.stats.hitCount++;
    return { hit: true, content: record.content, record };
  }

  /**
   * 记录文件读取
   */
  recordRead(
    absolutePath: string,
    content: string,
    lastModifiedTime: number,
    startLine: number,
    lineLimit: number | undefined
  ): void {
    const key = this.createCacheKey(absolutePath, startLine, lineLimit);

    // 清理过期条目
    if (this.records.size >= this.maxEntries) {
      this.cleanupExpired();
    }

    this.records.set(key, {
      absolutePath,
      content,
      lastModifiedTime,
      startLine,
      lineLimit,
      recordedAt: Date.now(),
    });

    this.stats.totalRecords = this.records.size;
  }

  /**
   * 使指定文件的缓存失效
   */
  invalidate(absolutePath: string): void {
    for (const [key, record] of this.records) {
      if (record.absolutePath === absolutePath) {
        this.records.delete(key);
      }
    }
    this.stats.totalRecords = this.records.size;
  }

  /**
   * 清理过期条目
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.records) {
      if (now - record.recordedAt > this.expiryTime) {
        this.records.delete(key);
      }
    }
    this.stats.totalRecords = this.records.size;
    this.stats.lastCleanupTime = now;
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.records.clear();
    this.stats.totalRecords = 0;
    this.stats.hitCount = 0;
    this.stats.missCount = 0;
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hitCount + this.stats.missCount;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hitCount / total : 0,
    };
  }
}

/**
 * 文件未变更标记
 * 当检测到重复读取相同内容时返回此标记
 */
export const FILE_UNCHANGED_MARKER = '[File content unchanged since last read]';

/**
 * 全局文件读取缓存实例
 */
let globalCacheManager: FileReadCacheManager | null = null;

/**
 * 获取全局缓存管理器
 */
export function getFileReadCache(): FileReadCacheManager {
  if (!globalCacheManager) {
    globalCacheManager = new FileReadCacheManager();
  }
  return globalCacheManager;
}