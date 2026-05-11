/**
 * 统一日志系统
 * 支持日志级别控制和模块化日志
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  /** 日志级别 */
  level?: LogLevel;
  /** 模块名称 */
  module?: string;
  /** 是否显示时间戳 */
  timestamp?: boolean;
  /** 是否显示模块名 */
  showModule?: boolean;
  /** 是否启用颜色 */
  colorize?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4
};

const COLORS = {
  debug: '\x1b[36m',  // cyan
  info: '\x1b[32m',   // green
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m'
};

/**
 * 日志管理器
 */
export class Logger {
  private static globalLevel: LogLevel = 'info';
  private static modules: Map<string, LogLevel> = new Map();
  
  private module: string;
  private level: LogLevel | null;
  private timestamp: boolean;
  private showModule: boolean;
  private colorize: boolean;

  constructor(options: LoggerOptions = {}) {
    this.module = options.module || 'app';
    this.level = options.level || null;
    this.timestamp = options.timestamp ?? true;
    this.showModule = options.showModule ?? true;
    this.colorize = options.colorize ?? true;
  }

  /**
   * 设置全局日志级别
   */
  static setGlobalLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  /**
   * 获取全局日志级别
   */
  static getGlobalLevel(): LogLevel {
    return Logger.globalLevel;
  }

  /**
   * 设置特定模块的日志级别
   */
  static setModuleLevel(module: string, level: LogLevel): void {
    Logger.modules.set(module, level);
  }

  /**
   * 获取当前有效日志级别
   */
  private getEffectiveLevel(): LogLevel {
    // 优先级：实例级别 > 模块级别 > 全局级别
    if (this.level) return this.level;
    if (Logger.modules.has(this.module)) {
      return Logger.modules.get(this.module)!;
    }
    return Logger.globalLevel;
  }

  /**
   * 检查是否应该输出日志
   */
  private shouldLog(level: LogLevel): boolean {
    const currentLevel = this.getEffectiveLevel();
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * 格式化日志前缀
   */
  private formatPrefix(level: LogLevel): string {
    const parts: string[] = [];
    
    if (this.timestamp) {
      const ts = this.colorize 
        ? `${COLORS.dim}${this.formatTimestamp()}${COLORS.reset}`
        : this.formatTimestamp();
      parts.push(ts);
    }

    const levelStr = level.toUpperCase().padEnd(5);
    if (this.colorize) {
      parts.push(`${COLORS[level]}${COLORS.bright}${levelStr}${COLORS.reset}`);
    } else {
      parts.push(levelStr);
    }

    if (this.showModule) {
      const moduleStr = `[${this.module}]`;
      parts.push(this.colorize ? `${COLORS.bright}${moduleStr}${COLORS.reset}` : moduleStr);
    }

    return parts.join(' ');
  }

  /**
   * 输出日志
   */
  private log(level: LogLevel, ...args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const prefix = this.formatPrefix(level);
    
    // 根据级别选择正确的 console 方法
    switch (level) {
      case 'debug':
        console.log(prefix, ...args);
        break;
      case 'info':
        console.info(prefix, ...args);
        break;
      case 'warn':
        console.warn(prefix, ...args);
        break;
      case 'error':
        console.error(prefix, ...args);
        break;
    }
  }

  /**
   * 调试日志 - 仅在 DEBUG 模式下输出
   */
  debug(...args: unknown[]): void {
    this.log('debug', ...args);
  }

  /**
   * 信息日志
   */
  info(...args: unknown[]): void {
    this.log('info', ...args);
  }

  /**
   * 警告日志
   */
  warn(...args: unknown[]): void {
    this.log('warn', ...args);
  }

  /**
   * 错误日志
   */
  error(...args: unknown[]): void {
    this.log('error', ...args);
  }

  /**
   * 创建子日志器
   */
  child(subModule: string, options?: Omit<LoggerOptions, 'module'>): Logger {
    return new Logger({
      ...options,
      module: `${this.module}:${subModule}`
    });
  }

  /**
   * 性能计时器
   */
  time(label: string): { end: () => number } {
    const start = Date.now();
    const fullLabel = `[${this.module}] ${label}`;
    
    return {
      end: () => {
        const duration = Date.now() - start;
        if (this.shouldLog('debug')) {
          this.debug(`${label} 耗时 ${duration}ms`);
        }
        return duration;
      }
    };
  }

  /**
   * 分组日志
   */
  group(label: string): void {
    if (this.shouldLog('debug')) {
      console.group(`[${this.module}] ${label}`);
    }
  }

  groupEnd(): void {
    if (this.shouldLog('debug')) {
      console.groupEnd();
    }
  }

  /**
   * 表格输出
   */
  table(data: unknown): void {
    if (this.shouldLog('debug')) {
      console.table(data);
    }
  }
}

/**
 * 预定义模块日志器
 */
export const Loggers = {
  /** 核心模块 */
  core: new Logger({ module: 'core' }),
  /** 智能体模块 */
  agent: new Logger({ module: 'agent' }),
  /** 执行器模块 */
  executor: new Logger({ module: 'executor' }),
  /** 内存模块 */
  memory: new Logger({ module: 'memory' }),
  /** 压缩模块 */
  compact: new Logger({ module: 'compact' }),
  /** 网关模块 */
  gateway: new Logger({ module: 'gateway' }),
  /** 存储模块 */
  storage: new Logger({ module: 'storage' }),
  /** 配置模块 */
  config: new Logger({ module: 'config' }),
  /** 插件模块 */
  plugin: new Logger({ module: 'plugin' }),
  /** 监控模块 */
  monitor: new Logger({ module: 'monitor' }),
  /** 路由模块 */
  router: new Logger({ module: 'router' }),
  /** 工具模块 */
  tool: new Logger({ module: 'tool' }),
  /** 提示词模块 */
  prompt: new Logger({ module: 'prompt' }),
  /** 会话模块 */
  session: new Logger({ module: 'session' }),
  /** 沙箱模块 */
  sandbox: new Logger({ module: 'sandbox' }),
};

/**
 * 创建自定义日志器
 */
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}

/**
 * 快速设置日志级别（从字符串或环境变量）
 */
export function setupLogLevel(level?: string): void {
  const envLevel = process.env.LOG_LEVEL || level;
  if (envLevel && envLevel in LOG_LEVELS) {
    Logger.setGlobalLevel(envLevel as LogLevel);
  }
}

/**
 * 初始化日志系统
 */
export function initLogger(config?: { 
  level?: LogLevel;
  modules?: Record<string, LogLevel>;
}): void {
  if (config?.level) {
    Logger.setGlobalLevel(config.level);
  }
  if (config?.modules) {
    for (const [module, level] of Object.entries(config.modules)) {
      Logger.setModuleLevel(module, level);
    }
  }
}

// 默认导出
export default Logger;