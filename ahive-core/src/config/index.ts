/**
 * Config System - 从 OpenClaw 复用的配置系统核心
 * 
 * 原路径：openclaw-main/src/config/
 * 
 * 功能：
 * - 配置加载与保存
 * - 密钥管理
 * - 环境变量
 */

// ============ 核心接口 ============

/**
 * 配置定义
 */
export interface Config {
  /** 应用名称 */
  appName: string;
  /** 应用版本 */
  version: string;
  /** 环境 */
  environment: 'development' | 'production' | 'test';
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** 服务器配置 */
  server?: ServerConfig;
  /** 数据库配置 */
  database?: DatabaseConfig;
  /** 认证配置 */
  auth?: AuthConfig;
  /** 自定义配置 */
  [key: string]: any;
}

/**
 * 服务器配置
 */
export interface ServerConfig {
  /** 主机 */
  host: string;
  /** 端口 */
  port: number;
}

/**
 * 数据库配置
 */
export interface DatabaseConfig {
  /** 数据库类型 */
  type: 'memory' | 'sqlite' | 'postgres' | 'mongodb';
  /** 连接字符串 */
  connectionString?: string;
  /** 数据库路径 */
  path?: string;
}

/**
 * 认证配置
 */
export interface AuthConfig {
  /** API Keys */
  apiKeys?: Record<string, string>;
  /** JWT 密钥 */
  jwtSecret?: string;
}

/**
 * 配置存储接口
 */
export interface ConfigStore {
  /** 加载配置 */
  load: () => Promise<Config>;
  /** 保存配置 */
  save: (config: Config) => Promise<void>;
  /** 获取配置项 */
  get: <T>(key: string, defaultValue?: T) => T;
  /** 设置配置项 */
  set: <T>(key: string, value: T) => void;
}

// ============ 配置管理器 ============

/**
 * 配置管理器
 */
export class ConfigManager implements ConfigStore {
  private config: Config;
  private configPath?: string;

  constructor(defaultConfig?: Partial<Config>) {
    this.config = {
      appName: 'AHIVE Core',
      version: '0.1.0',
      environment: 'development',
      logLevel: 'info',
      ...defaultConfig,
    };
  }

  /**
   * 加载配置
   */
  async load(): Promise<Config> {
    // 从环境变量加载
    this.loadFromEnv();

    // 从文件加载（如果有路径）
    if (this.configPath) {
      await this.loadFromFile();
    }

    return this.config;
  }

  /**
   * 保存配置
   */
  async save(): Promise<void> {
    if (this.configPath) {
      await this.saveToFile();
    }
  }

  /**
   * 获取配置项
   */
  get<T>(key: string, defaultValue?: T): T {
    const keys = key.split('.');
    let value: any = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return defaultValue as T;
      }
    }

    return value !== undefined ? value : (defaultValue as T);
  }

  /**
   * 设置配置项
   */
  set<T>(key: string, value: T): void {
    const keys = key.split('.');
    let obj: any = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!obj[k] || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }

    obj[keys[keys.length - 1]] = value;
  }

  /**
   * 从环境变量加载
   */
  private loadFromEnv(): void {
    // AHIVE_ENV
    const env = process.env.AHIVE_ENV;
    if (env) {
      this.config.environment = env as 'development' | 'production' | 'test';
    }

    // AHIVE_LOG_LEVEL
    const logLevel = process.env.AHIVE_LOG_LEVEL;
    if (logLevel) {
      this.config.logLevel = logLevel as 'debug' | 'info' | 'warn' | 'error';
    }

    // AHIVE_PORT
    const port = process.env.AHIVE_PORT;
    if (port) {
      this.config.server = {
        ...this.config.server,
        port: parseInt(port, 10),
      };
    }

    // AHIVE_HOST
    const host = process.env.AHIVE_HOST;
    if (host) {
      this.config.server = {
        ...this.config.server,
        host,
      };
    }
  }

  /**
   * 从文件加载（模拟）
   */
  private async loadFromFile(): Promise<void> {
    // 简化实现：不实际读取文件
    console.log('[Config] Would load from:', this.configPath);
  }

  /**
   * 保存到文件（模拟）
   */
  private async saveToFile(): Promise<void> {
    // 简化实现：不实际写入文件
    console.log('[Config] Would save to:', this.configPath);
  }

  /**
   * 设置配置路径
   */
  setConfigPath(path: string): void {
    this.configPath = path;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Config {
    return { ...this.config };
  }

  /**
   * 验证配置
   */
  validate(): boolean {
    // 基本验证
    if (!this.config.appName) {
      console.error('[Config] Missing appName');
      return false;
    }

    if (!this.config.version) {
      console.error('[Config] Missing version');
      return false;
    }

    return true;
  }
}

// ============ 密钥管理器 ============

/**
 * 密钥存储
 */
export interface SecretStore {
  /** 获取密钥 */
  get: (key: string) => Promise<string | undefined>;
  /** 设置密钥 */
  set: (key: string, value: string) => Promise<void>;
  /** 删除密钥 */
  delete: (key: string) => Promise<void>;
  /** 列出所有密钥名 */
  list: () => Promise<string[]>;
}

/**
 * 内存密钥存储（简化版）
 */
export class MemorySecretStore implements SecretStore {
  private secrets: Map<string, string> = new Map();

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }
}

/**
 * 密钥管理器
 */
export class SecretManager {
  private store: SecretStore;

  constructor(store: SecretStore) {
    this.store = store;
  }

  /**
   * 获取密钥
   */
  async get(key: string): Promise<string | undefined> {
    // 先从环境变量尝试
    const envValue = process.env[key];
    if (envValue) {
      return envValue;
    }

    // 从存储获取
    return this.store.get(key);
  }

  /**
   * 设置密钥
   */
  async set(key: string, value: string): Promise<void> {
    await this.store.set(key, value);
  }

  /**
   * 删除密钥
   */
  async delete(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /**
   * 列出所有密钥名
   */
  async list(): Promise<string[]> {
    return this.store.list();
  }
}

// ============ 辅助函数 ============

/**
 * 创建配置管理器
 */
export function createConfigManager(defaultConfig?: Partial<Config>): ConfigManager {
  return new ConfigManager(defaultConfig);
}

/**
 * 创建密钥管理器
 */
export function createSecretManager(store?: SecretStore): SecretManager {
  return new SecretManager(store || new MemorySecretStore());
}

/**
 * 创建内存密钥存储
 */
export function createMemorySecretStore(): SecretStore {
  return new MemorySecretStore();
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: Config = {
  appName: 'AHIVE Core',
  version: '0.1.0',
  environment: 'development',
  logLevel: 'info',
  server: {
    host: '127.0.0.1',
    port: 18789,
  },
};

// 默认导出
export default {
  ConfigManager,
  SecretManager,
  MemorySecretStore,
  createConfigManager,
  createSecretManager,
  createMemorySecretStore,
  DEFAULT_CONFIG,
};
