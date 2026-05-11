/**
 * 优化的文件读取器
 *
 * 特性：
 * - 双路径读取：小文件全量读取（快），大文件流式读取
 * - 自动去重：相同文件相同范围不重复发送
 * - Token 预检：估算 token 数，防止输出过大
 * - 行号格式化：可选添加行号
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import { createReadStream } from 'fs';
import path from 'path';
import { logger } from '../utils/index.js';
import {
  FileReadCacheManager,
  getFileReadCache,
} from './file-read-cache.js';
import { FILE_UNCHANGED_MARKER } from './file-read-cache.js';

// ============ 配置常量 ============

/** 小文件阈值：10MB 以下使用快速路径 */
const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024;

/** 默认最大输出 token 数 */
const DEFAULT_MAX_TOKENS = 25000;

/** 默认最大文件大小：256KB */
const DEFAULT_MAX_FILE_SIZE = 256 * 1024;

/** 流式读取的缓冲区大小 */
const STREAM_BUFFER_SIZE = 512 * 1024;

/** 每个 token 约 4 字节（估算） */
const BYTES_PER_TOKEN_ESTIMATE = 4;

// 重新导出常量供外部使用
export { FILE_UNCHANGED_MARKER } from './file-read-cache.js';

// ============ 类型定义 ============

/**
 * 文件编码类型
 */
export type FileEncoding = 'utf-8' | 'binary' | 'base64';

/**
 * 文件读取选项
 */
export interface FileReadOptions {
  /** 起始行号（1-based） */
  startLine?: number;
  /** 读取行数限制 */
  lineLimit?: number;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 最大文件字节数 */
  maxBytes?: number;
  /** 是否添加行号 */
  addLineNumbers?: boolean;
  /** 是否启用去重 */
  enableDedup?: boolean;
  /** 文件编码 */
  encoding?: FileEncoding;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 文件读取结果
 */
export interface FileReadResult {
  /** 是否成功 */
  success: boolean;
  /** 文件绝对路径 */
  absolutePath: string;
  /** 文件内容 */
  content: string;
  /** 实际读取行数 */
  linesRead: number;
  /** 文件总行数 */
  totalLines: number;
  /** 读取字节数 */
  bytesRead: number;
  /** 文件总字节数 */
  totalBytes: number;
  /** 是否从缓存命中 */
  cacheHit: boolean;
  /** 是否被截断 */
  truncated: boolean;
  /** Token 估算数 */
  estimatedTokens: number;
  /** 编码方式 */
  encoding?: FileEncoding;
  /** 是否为二进制模式 */
  isBinary?: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * Token 超限错误
 */
export class TokenLimitExceededError extends Error {
  constructor(
    public actualTokens: number,
    public maxTokens: number
  ) {
    super(
      `File content (${actualTokens} tokens) exceeds limit (${maxTokens}). ` +
        `Use startLine and lineLimit to read specific portions.`
    );
    this.name = 'TokenLimitExceededError';
  }
}

/**
 * 文件过大错误
 */
export class FileTooLargeError extends Error {
  constructor(
    public actualBytes: number,
    public maxBytes: number
  ) {
    super(
      `File size (${formatBytes(actualBytes)}) exceeds limit (${formatBytes(maxBytes)}). ` +
        `Use startLine and lineLimit to read specific portions.`
    );
    this.name = 'FileTooLargeError';
  }
}

// ============ 主类 ============

/**
 * 优化的文件读取器
 */
export class OptimizedFileReader {
  private cache: FileReadCacheManager;
  private workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.cache = getFileReadCache();
    this.workspaceRoot = workspaceRoot ?? process.cwd();
  }

  /**
   * 读取文件
   */
  async readFile(
    filePath: string,
    options: FileReadOptions = {}
  ): Promise<FileReadResult> {
    const {
      startLine = 1,
      lineLimit,
      maxTokens = DEFAULT_MAX_TOKENS,
      maxBytes = DEFAULT_MAX_FILE_SIZE,
      addLineNumbers = true,
      enableDedup = true,
      encoding = 'utf-8',
      signal,
    } = options;

    // 解析绝对路径
    const absolutePath = this.resolveAbsolutePath(filePath);
    signal?.throwIfAborted();

    try {
      // 获取文件信息
      const stats = await fs.stat(absolutePath);

      if (stats.isDirectory()) {
        return this.createErrorResult(absolutePath, 'Path is a directory, not a file');
      }

      // 二进制/base64 模式：直接读取整个文件，不做行处理
      if (encoding === 'binary' || encoding === 'base64') {
        return await this.readBinaryFile(absolutePath, stats, {
          encoding,
          maxBytes,
          signal,
        });
      }

      // 文本模式：检查是否启用去重
      if (enableDedup) {
        const cacheCheck = await this.cache.checkCache(
          absolutePath,
          startLine - 1,
          lineLimit
        );

        if (cacheCheck.hit && cacheCheck.content) {
          logger.debug(`[FileReader] Cache hit: ${absolutePath}`);
          // 返回实际缓存内容，而不是标记
          const lines = cacheCheck.content.split('\n');
          return {
            success: true,
            absolutePath,
            content: cacheCheck.content,
            linesRead: lines.length,
            totalLines: lines.length, // 缓存模式下无法得知总行数
            bytesRead: Buffer.byteLength(cacheCheck.content, 'utf-8'),
            totalBytes: stats.size,
            cacheHit: true,
            truncated: false,
            estimatedTokens: this.estimateTokens(cacheCheck.content),
            encoding: 'utf-8',
          };
        }
      }

      // 根据文件大小选择读取策略
      let result: FileReadResult;

      if (stats.size < SMALL_FILE_THRESHOLD) {
        // 快速路径：小文件全量读取
        result = await this.readSmallFile(absolutePath, stats, {
          startLine,
          lineLimit,
          maxBytes,
          maxTokens,
          addLineNumbers,
          signal,
        });
      } else {
        // 流式路径：大文件流式读取
        result = await this.readLargeFile(absolutePath, stats, {
          startLine,
          lineLimit,
          maxBytes,
          maxTokens,
          addLineNumbers,
          signal,
        });
      }

      // 记录到缓存
      if (enableDedup && result.success) {
        this.cache.recordRead(
          absolutePath,
          result.content,
          stats.mtimeMs,
          startLine - 1,
          lineLimit
        );
      }

      return result;

    } catch (error) {
      if (error instanceof TokenLimitExceededError || error instanceof FileTooLargeError) {
        throw error;
      }
      return this.createErrorResult(
        absolutePath,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 读取二进制文件（binary/base64 编码）
   */
  private async readBinaryFile(
    absolutePath: string,
    stats: fsSync.Stats,
    options: {
      encoding: 'binary' | 'base64';
      maxBytes: number;
      signal?: AbortSignal;
    }
  ): Promise<FileReadResult> {
    const { encoding, maxBytes, signal } = options;

    // 检查文件大小
    if (stats.size > maxBytes * 4) { // 二进制文件允许更大
      throw new FileTooLargeError(stats.size, maxBytes * 4);
    }

    signal?.throwIfAborted();

    // 读取为 Buffer
    const buffer = await fs.readFile(absolutePath);
    signal?.throwIfAborted();

    let content: string;
    if (encoding === 'base64') {
      content = buffer.toString('base64');
    } else {
      // binary: 转为十六进制字符串（用于调试）
      content = buffer.toString('hex');
    }

    const estimatedTokens = this.estimateTokens(content);

    return {
      success: true,
      absolutePath,
      content,
      linesRead: 1,
      totalLines: 1,
      bytesRead: buffer.length,
      totalBytes: stats.size,
      cacheHit: false,
      truncated: false,
      estimatedTokens,
      encoding,
      isBinary: true,
    };
  }

  /**
   * 快速路径：读取小文件
   */
  private async readSmallFile(
    absolutePath: string,
    stats: fsSync.Stats,
    options: {
      startLine: number;
      lineLimit?: number;
      maxBytes: number;
      maxTokens: number;
      addLineNumbers: boolean;
      signal?: AbortSignal;
    }
  ): Promise<FileReadResult> {
    const { startLine, lineLimit, maxBytes, maxTokens, addLineNumbers, signal } = options;

    // 检查文件大小限制（仅在没有行限制时检查）
    if (!lineLimit && stats.size > maxBytes) {
      throw new FileTooLargeError(stats.size, maxBytes);
    }

    signal?.throwIfAborted();

    // 读取整个文件
    const rawContent = await fs.readFile(absolutePath, 'utf-8');
    const content = this.stripBOM(rawContent);

    // 分割行
    const lines = this.splitLines(content);
    const totalLines = lines.length;

    // 提取目标范围
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = lineLimit !== undefined
      ? Math.min(startIdx + lineLimit, totalLines)
      : totalLines;

    const selectedLines = lines.slice(startIdx, endIdx);
    const linesRead = selectedLines.length;

    // 格式化输出
    let output = addLineNumbers
      ? this.formatWithLineNumbers(selectedLines, startLine)
      : selectedLines.join('\n');

    const bytesRead = Buffer.byteLength(output, 'utf-8');

    // Token 预检
    const estimatedTokens = this.estimateTokens(output);
    if (estimatedTokens > maxTokens) {
      throw new TokenLimitExceededError(estimatedTokens, maxTokens);
    }

    return {
      success: true,
      absolutePath,
      content: output,
      linesRead,
      totalLines,
      bytesRead,
      totalBytes: stats.size,
      cacheHit: false,
      truncated: endIdx < totalLines,
      estimatedTokens,
    };
  }

  /**
   * 流式路径：读取大文件
   * 只保留目标行范围内的内容，避免内存爆炸
   */
  private async readLargeFile(
    absolutePath: string,
    stats: fsSync.Stats,
    options: {
      startLine: number;
      lineLimit?: number;
      maxBytes: number;
      maxTokens: number;
      addLineNumbers: boolean;
      signal?: AbortSignal;
    }
  ): Promise<FileReadResult> {
    const { startLine, lineLimit, maxTokens, addLineNumbers, signal } = options;

    return new Promise((resolve, reject) => {
      const startIdx = Math.max(0, startLine - 1);
      const endIdx = lineLimit !== undefined ? startIdx + lineLimit : Infinity;

      const selectedLines: string[] = [];
      let currentLineIndex = 0;
      let totalBytesRead = 0;
      let partialLine = '';
      let foundBOM = false;
      let totalLineCount = 0;

      const stream = createReadStream(absolutePath, {
        encoding: 'utf-8',
        highWaterMark: STREAM_BUFFER_SIZE,
      });

      const cleanup = () => {
        stream.removeAllListeners();
        stream.destroy();
      };

      stream.on('data', (chunk: string) => {
        // 处理 BOM
        if (!foundBOM && chunk.charCodeAt(0) === 0xfeff) {
          chunk = chunk.slice(1);
          foundBOM = true;
        }

        totalBytesRead += Buffer.byteLength(chunk, 'utf-8');

        // 合并上一个不完整的行
        const data = partialLine + chunk;
        partialLine = '';

        // 按换行符分割
        let lineStart = 0;
        let newlinePos: number;

        while ((newlinePos = data.indexOf('\n', lineStart)) !== -1) {
          let line = data.slice(lineStart, newlinePos);

          // 移除回车符
          if (line.endsWith('\r')) {
            line = line.slice(0, -1);
          }

          // 只保留目标范围内的行
          if (currentLineIndex >= startIdx && currentLineIndex < endIdx) {
            selectedLines.push(line);
          }

          currentLineIndex++;
          lineStart = newlinePos + 1;
        }

        // 保存不完整的行
        if (lineStart < data.length) {
          partialLine = data.slice(lineStart);
        }
      });

      stream.on('end', () => {
        // 处理最后一行（没有换行符结尾）
        if (partialLine.length > 0) {
          let line = partialLine;
          if (line.endsWith('\r')) {
            line = line.slice(0, -1);
          }
          if (currentLineIndex >= startIdx && currentLineIndex < endIdx) {
            selectedLines.push(line);
          }
          currentLineIndex++;
        }

        totalLineCount = currentLineIndex;

        cleanup();

        // 格式化输出
        let output = addLineNumbers
          ? this.formatWithLineNumbers(selectedLines, startLine)
          : selectedLines.join('\n');

        const bytesRead = Buffer.byteLength(output, 'utf-8');
        const estimatedTokens = this.estimateTokens(output);

        // Token 预检
        if (estimatedTokens > maxTokens) {
          reject(new TokenLimitExceededError(estimatedTokens, maxTokens));
          return;
        }

        resolve({
          success: true,
          absolutePath,
          content: output,
          linesRead: selectedLines.length,
          totalLines: totalLineCount,
          bytesRead,
          totalBytes: stats.size,
          cacheHit: false,
          truncated: endIdx < totalLineCount,
          estimatedTokens,
        });
      });

      stream.on('error', (err) => {
        cleanup();
        reject(err);
      });

      // 中止处理
      if (signal) {
        signal.addEventListener('abort', () => {
          cleanup();
          reject(new Error('Read operation aborted'));
        });
      }
    });
  }

  // ============ 辅助方法 ============

  /**
   * 解析绝对路径
   */
  private resolveAbsolutePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }
    return path.resolve(this.workspaceRoot, filePath);
  }

  /**
   * 移除 BOM
   */
  private stripBOM(content: string): string {
    return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  }

  /**
   * 分割行（保留空行）
   */
  private splitLines(content: string): string[] {
    const lines: string[] = [];
    let start = 0;
    let pos: number;

    while ((pos = content.indexOf('\n', start)) !== -1) {
      let line = content.slice(start, pos);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      lines.push(line);
      start = pos + 1;
    }

    // 处理最后一行
    if (start < content.length) {
      let line = content.slice(start);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      lines.push(line);
    }

    return lines;
  }

  /**
   * 添加行号格式化
   */
  private formatWithLineNumbers(lines: string[], startLineNumber: number): string {
    const maxLineNum = startLineNumber + lines.length - 1;
    const width = String(maxLineNum).length;

    return lines
      .map((line, idx) => {
        const lineNum = String(startLineNumber + idx).padStart(width, ' ');
        return `${lineNum}\t${line}`;
      })
      .join('\n');
  }

  /**
   * 估算 token 数
   */
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / BYTES_PER_TOKEN_ESTIMATE);
  }

  /**
   * 创建错误结果
   */
  private createErrorResult(
    absolutePath: string,
    error: string
  ): FileReadResult {
    return {
      success: false,
      absolutePath,
      content: '',
      linesRead: 0,
      totalLines: 0,
      bytesRead: 0,
      totalBytes: 0,
      cacheHit: false,
      truncated: false,
      estimatedTokens: 0,
      error,
    };
  }
}

// ============ 辅助函数 ============

/**
 * 格式化字节数
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 全局读取器实例
 */
let globalReader: OptimizedFileReader | null = null;

/**
 * 获取全局文件读取器
 */
export function getFileReader(): OptimizedFileReader {
  if (!globalReader) {
    globalReader = new OptimizedFileReader();
  }
  return globalReader;
}

/**
 * 快捷读取方法
 */
export async function readOptimizedFile(
  filePath: string,
  options?: FileReadOptions
): Promise<FileReadResult> {
  return getFileReader().readFile(filePath, options);
}