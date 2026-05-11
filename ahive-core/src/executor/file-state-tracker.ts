/**
 * 文件状态跟踪器
 *
 * 功能：
 * - 跟踪已读取文件（防止未读就写）
 * - 跟踪已写入文件（避免重复验证）
 * - 支持 Append 模式增量写入
 *
 * 参考 CC 的 harness 文件状态跟踪机制
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import { logger } from '../utils/index.js';

/**
 * 文件状态记录
 */
interface FileStateRecord {
  /** 文件绝对路径 */
  absolutePath: string;
  /** 是否已读取 */
  hasRead: boolean;
  /** 是否已写入 */
  hasWritten: boolean;
  /** 最后修改时间戳 (ms) */
  lastModifiedTime: number;
  /** 文件大小 */
  fileSize: number;
  /** 记录更新时间 */
  updatedAt: number;
}

/**
 * 文件状态跟踪器
 */
export class FileStateTracker {
  private states: Map<string, FileStateRecord> = new Map();

  /** 状态过期时间 (ms) - 默认 30 分钟 */
  private expiryTime: number;

  constructor(options?: { expiryTime?: number }) {
    this.expiryTime = options?.expiryTime ?? 30 * 60 * 1000;
  }

  /**
   * 生成状态键
   */
  private createStateKey(absolutePath: string): string {
    return absolutePath.toLowerCase();  // 路径标准化
  }

  /**
   * 检查文件是否已读取
   */
  hasReadFile(absolutePath: string): boolean {
    const key = this.createStateKey(absolutePath);
    const record = this.states.get(key);

    if (!record) return false;

    // 检查过期
    if (Date.now() - record.updatedAt > this.expiryTime) {
      this.states.delete(key);
      return false;
    }

    return record.hasRead;
  }

  /**
   * 检查文件是否已写入
   */
  hasWrittenFile(absolutePath: string): boolean {
    const key = this.createStateKey(absolutePath);
    const record = this.states.get(key);

    if (!record) return false;

    // 检查过期
    if (Date.now() - record.updatedAt > this.expiryTime) {
      this.states.delete(key);
      return false;
    }

    return record.hasWritten;
  }

  /**
   * 检查文件是否已修改（自上次读取/写入后）
   */
  async checkFileModified(absolutePath: string): Promise<boolean> {
    const key = this.createStateKey(absolutePath);
    const record = this.states.get(key);

    if (!record) return true;  // 无记录视为已修改

    try {
      const stats = await fs.stat(absolutePath);
      return stats.mtimeMs !== record.lastModifiedTime || stats.size !== record.fileSize;
    } catch {
      return true;  // 文件不存在视为已修改
    }
  }

  /**
   * 记录文件读取
   */
  recordRead(absolutePath: string, mtimeMs: number, fileSize: number): void {
    const key = this.createStateKey(absolutePath);

    const existing = this.states.get(key);

    this.states.set(key, {
      absolutePath,
      hasRead: true,
      hasWritten: existing?.hasWritten ?? false,
      lastModifiedTime: mtimeMs,
      fileSize,
      updatedAt: Date.now(),
    });

    logger.debug(`[FileState] 记录读取: ${absolutePath}`);
  }

  /**
   * 记录文件写入
   */
  recordWrite(absolutePath: string, mtimeMs: number, fileSize: number): void {
    const key = this.createStateKey(absolutePath);

    const existing = this.states.get(key);

    this.states.set(key, {
      absolutePath,
      hasRead: existing?.hasRead ?? false,  // 写入不改变读取状态
      hasWritten: true,
      lastModifiedTime: mtimeMs,
      fileSize,
      updatedAt: Date.now(),
    });

    logger.debug(`[FileState] 记录写入: ${absolutePath}`);
  }

  /**
   * 使文件状态失效
   */
  invalidate(absolutePath: string): void {
    const key = this.createStateKey(absolutePath);
    this.states.delete(key);
    logger.debug(`[FileState] 状态失效: ${absolutePath}`);
  }

  /**
   * 清空所有状态
   */
  clear(): void {
    this.states.clear();
    logger.debug(`[FileState] 清空所有状态`);
  }

  /**
   * 获取状态统计
   */
  getStats(): {
    totalFiles: number;
    readFiles: number;
    writtenFiles: number;
  } {
    let readCount = 0;
    let writeCount = 0;

    for (const record of this.states.values()) {
      if (record.hasRead) readCount++;
      if (record.hasWritten) writeCount++;
    }

    return {
      totalFiles: this.states.size,
      readFiles: readCount,
      writtenFiles: writeCount,
    };
  }
}

/**
 * 全局文件状态跟踪器实例
 */
let globalTracker: FileStateTracker | null = null;

/**
 * 获取全局文件状态跟踪器
 */
export function getFileStateTracker(): FileStateTracker {
  if (!globalTracker) {
    globalTracker = new FileStateTracker();
  }
  return globalTracker;
}