/**
 * Utils - 通用工具函数
 * 
 * 从 OpenClaw 复用的工具函数
 */

// ============ ID 生成 ============

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成 UUID（简化版）
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ============ 时间工具 ============

/**
 * 格式化时间戳
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * 解析时间戳
 */
export function parseTimestamp(timestamp: string): Date {
  return new Date(timestamp);
}

/**
 * 相对时间描述
 */
export function relativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

// ============ 字符串工具 ============

/**
 * 截断字符串
 */
export function truncate(str: string, maxLength: number, suffix: string = '...'): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 安全 JSON 解析
 */
export function safeJsonParse<T>(str: string, defaultValue: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * 安全 JSON 字符串化
 */
export function safeJsonStringify(obj: any, defaultValue: string = '{}'): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return defaultValue;
  }
}

/**
 * 格式化 JSON（带缩进）
 */
export function formatJson(obj: any, indent: number = 2): string {
  return JSON.stringify(obj, null, indent);
}

// ============ 对象工具 ============

/**
 * 深度合并对象
 */
export function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue);
      } else {
        result[key] = sourceValue as any;
      }
    }
  }

  return result;
}

/**
 * 挑选对象属性
 */
export function pick<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
  return result as Pick<T, K>;
}

/**
 * 省略对象属性
 */
export function omit<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !keys.includes(key as any)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * 对象转 Map
 */
export function objectToMap<T>(obj: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(obj));
}

/**
 * Map 转对象
 */
export function mapToObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries(map);
}

// ============ 数组工具 ============

/**
 * 去重数组
 */
export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * 数组分块
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * 数组扁平化
 */
export function flatten<T>(arr: T[][]): T[] {
  return arr.flat();
}

/**
 * 数组分组
 */
export function groupBy<T, K extends string | number | symbol>(
  arr: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  const result: Partial<Record<K, T[]>> = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key]!.push(item);
  }
  return result as Record<K, T[]>;
}

// ============ 异步工具 ============

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的异步操作
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    backoff?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, delayMs = 1000, backoff = 2 } = options;

  let lastError: Error;
  let currentDelay = delayMs;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < maxRetries - 1) {
        await delay(currentDelay);
        currentDelay *= backoff;
      }
    }
  }

  throw lastError!;
}

/**
 * 超时包装
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    ),
  ]);
}

/**
 * 并行执行（带限制）
 */
export async function parallel<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const promise = Promise.resolve().then(async () => {
      results[i] = await fn(items[i], i);
      executing.splice(executing.indexOf(promise), 1);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// ============ 验证工具 ============

/**
 * 检查是否为空
 */
export function isEmpty(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * 检查是否为对象
 */
export function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 检查是否为函数
 */
export function isFunction(value: any): value is Function {
  return typeof value === 'function';
}

/**
 * 检查是否为 Promise
 */
export function isPromise(value: any): value is Promise<any> {
  return value && typeof value.then === 'function';
}

// ============ 智能体消息清理工具 ============

/**
 * 清理智能体消息内容
 * - 去掉提示词部分（[AGENT COMMUNICATION PROTOCOL]...[END PROTOCOL]）
 * - 解析 JSON 格式的消息
 */
export function cleanAgentMessage(content: string): string {
  let cleaned = content.trim();

  // 1. 去掉提示词部分
  const protocolEnd = cleaned.indexOf('[END PROTOCOL]');
  if (protocolEnd !== -1) {
    cleaned = cleaned.substring(protocolEnd + 14).trim();
  }

  // 2. 尝试解析 JSON 格式 {"content":"...","type":"..."}
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.content && typeof parsed.content === 'string') {
        cleaned = parsed.content;
      } else if (parsed.message && typeof parsed.message === 'string') {
        cleaned = parsed.message;
      }
    } catch {
      // 不是有效 JSON，保持原样
    }
  }

  return cleaned;
}

// ============ 日志工具 ============

export { Logger, Loggers, createLogger, setupLogLevel, initLogger } from './logger.js';
export { notifyCapabilityUpdate } from './capability-notifier.js';
export type { LogLevel, LoggerOptions } from './logger.js';

// ============ Ripgrep 引擎 ============

export { RipgrepEngine } from './ripgrep.js';
export type { RipgrepResult, GlobResult, GrepMatch } from './ripgrep.js';

// ============ LLM 调用日志 ============

export {
  logLLMCall,
  logCompact,
  LLMCallTracker,
  llmLogger,
  compactionLogger,
  getLogFilePaths,
  cleanOldLogs,
} from './llm-logger.js';
export type { LLMCallLog, CompactLog } from './llm-logger.js';

/**
 * 全局日志实例
 * 
 * 使用方式：
 * - logger.debug('调试信息')  // 仅 DEBUG 环境输出
 * - logger.info('普通信息')
 * - logger.warn('警告信息')
 * - logger.error('错误信息')
 * 
 * 配置方式：
 * - 环境变量：LOG_LEVEL=debug|info|warn|error
 * - 或在代码中：Logger.setGlobalLevel('debug')
 */
import { Logger } from './logger.js';

// 创建默认日志实例
export const logger = new Logger({ module: 'app' });

/**
 * 设置全局日志级别
 */
export function setGlobalLogger(level: string): void {
  Logger.setGlobalLevel(level as any);
}

// 默认导出
export default {
  generateId,
  generateUUID,
  formatTimestamp,
  parseTimestamp,
  relativeTime,
  truncate,
  safeJsonParse,
  safeJsonStringify,
  formatJson,
  deepMerge,
  pick,
  omit,
  objectToMap,
  mapToObject,
  unique,
  chunk,
  flatten,
  groupBy,
  delay,
  retry,
  withTimeout,
  parallel,
  isEmpty,
  isObject,
  isFunction,
  isPromise,
  logger,
};
