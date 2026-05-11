/**
 * 配置管理模块
 * 统一管理应用配置
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Logger } from '../utils/logger.js';

export interface AppConfig {
  // 服务器配置
  server: {
    port: number;
    host: string;
  };
  
  // 模型配置
  models: {
    defaultModel: string;
    apiKey: string;
    baseUrl: string;
  };
  
  // 进程隔离配置
  isolation: {
    enabled: boolean;
    maxProcesses: number;
    restartOnCrash: boolean;
    healthCheckInterval: number;
  };
  
  // 日志配置
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file: string | null;
  };
  
  // 存储配置
  storage: {
    sessionDir: string;
    maxSessions: number;
  };
  
  // WebSocket 监控配置
  websocket: {
    enabled: boolean;
    url: string;
    reconnectInterval: number;
    maxReconnectInterval: number;
    heartbeatInterval: number;
    heartbeatTimeout: number;
    autoReconnect: boolean;
    maxReconnectAttempts: number;
    connectionTimeout: number;
    gracefulDegradation: boolean;
  };

  // 功能特性开关
  features: {
    enableWebUI: boolean;
    enableVoiceCall: boolean;
    enableFileUpload: boolean;
    enableThinkingStream: boolean;
  };

  // 沙箱配置
  sandbox: {
    enabled: boolean;
    mode: string;
    approvalPolicy: string;
    networkAccess: boolean;
    writableRoots: string[];
    deniedCommands: string[];
    deniedPaths: string[];
  };
}

/**
 * 默认配置
 */
const defaultConfig: AppConfig = {
  server: {
    port: 3000,
    host: 'localhost'
  },
  
  models: {
    defaultModel: 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  },
  
  isolation: {
    enabled: false,
    maxProcesses: 10,
    restartOnCrash: true,
    healthCheckInterval: 30000
  },
  
  logging: {
    level: 'info',
    file: null
  },
  
  storage: {
    sessionDir: './sessions',
    maxSessions: 100
  },
  
  websocket: {
    enabled: true,
    url: 'ws://127.0.0.1:3005',
    reconnectInterval: 5000,
    maxReconnectInterval: 60000,
    heartbeatInterval: 30000,
    heartbeatTimeout: 10000,
    autoReconnect: true,
    maxReconnectAttempts: 0,
    connectionTimeout: 10000,
    gracefulDegradation: true
  },

  features: {
    enableWebUI: true,
    enableVoiceCall: false,
    enableFileUpload: true,
    enableThinkingStream: true
  },

  sandbox: {
    enabled: true,
    mode: 'workspace-write',
    approvalPolicy: 'on-request',
    networkAccess: true,
    writableRoots: [],
    deniedCommands: ['rm -rf /', 'format', 'fdisk', 'mkfs', 'dd if='],
    deniedPaths: ['.git/hooks', '.ssh', '.env']
  }
};

/**
 * 配置管理类
 */
export class ConfigManager {
  private config: AppConfig;
  private configPath: string | null = null;
  
  constructor(configPath?: string) {
    this.config = { ...defaultConfig };
    
    if (configPath) {
      this.configPath = configPath;
      this.loadFromFile(configPath);
    }
    
    // 从环境变量加载
    this.loadFromEnv();
  }
  
  /**
   * 从文件加载配置
   */
  private loadFromFile(configPath: string): void {
    try {
      if (!existsSync(configPath)) {
        console.warn(`配置文件不存在: ${configPath}`);
        return;
      }
      
      const content = readFileSync(configPath, 'utf-8');
      const userConfig = JSON.parse(content);
      
      // 深度合并配置
      this.config = this.mergeDeep(this.config, userConfig);
      console.log(`已加载配置文件: ${configPath}`);
    } catch (error) {
      console.error(`加载配置文件失败: ${configPath}`, error);
    }
  }
  
  /**
   * 从环境变量加载配置
   */
  private loadFromEnv(): void {
    // 服务器配置
    if (process.env.PORT) {
      this.config.server.port = parseInt(process.env.PORT, 10);
    }
    if (process.env.HOST) {
      this.config.server.host = process.env.HOST;
    }
    
    // 模型配置
    if (process.env.OPENAI_API_KEY) {
      this.config.models.apiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.OPENAI_BASE_URL) {
      this.config.models.baseUrl = process.env.OPENAI_BASE_URL;
    }
    if (process.env.DEFAULT_MODEL) {
      this.config.models.defaultModel = process.env.DEFAULT_MODEL;
    }
    
    // 进程隔离配置
    if (process.env.ISOLATION_ENABLED) {
      this.config.isolation.enabled = process.env.ISOLATION_ENABLED === 'true';
    }
    if (process.env.MAX_PROCESSES) {
      this.config.isolation.maxProcesses = parseInt(process.env.MAX_PROCESSES, 10);
    }
    
    // 日志配置
    if (process.env.LOG_LEVEL) {
      const level = process.env.LOG_LEVEL as AppConfig['logging']['level'];
      if (['debug', 'info', 'warn', 'error'].includes(level)) {
        this.config.logging.level = level;
      }
    }
    
    // 存储配置
    if (process.env.SESSION_DIR) {
      this.config.storage.sessionDir = process.env.SESSION_DIR;
    }
  }
  
  /**
   * 深度合并对象
   */
  private mergeDeep<T>(target: T, source: Partial<T>): T {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] !== undefined) {
        if (
          typeof source[key] === 'object' &&
          source[key] !== null &&
          !Array.isArray(source[key])
        ) {
          result[key] = this.mergeDeep(
            result[key],
            source[key] as Partial<T[Extract<keyof T, string>]>
          );
        } else {
          result[key] = source[key] as T[Extract<keyof T, string>];
        }
      }
    }
    
    return result;
  }
  
  /**
   * 获取完整配置
   */
  getConfig(): Readonly<AppConfig> {
    return this.config;
  }
  
  /**
   * 获取服务器配置
   */
  getServerConfig() {
    return this.config.server;
  }
  
  /**
   * 获取模型配置
   */
  getModelsConfig() {
    return this.config.models;
  }
  
  /**
   * 获取隔离配置
   */
  getIsolationConfig() {
    return this.config.isolation;
  }
  
  /**
   * 获取日志配置
   */
  getLoggingConfig() {
    return this.config.logging;
  }
  
  /**
   * 获取存储配置
   */
  getStorageConfig() {
    return this.config.storage;
  }
  
  /**
   * 更新配置（运行时）
   */
  updateConfig(updates: Partial<AppConfig>): void {
    this.config = this.mergeDeep(this.config, updates);
  }
  
  /**
   * 验证配置
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // 验证服务器配置
    if (this.config.server.port < 1 || this.config.server.port > 65535) {
      errors.push(`无效的端口号: ${this.config.server.port}`);
    }
    
    // 验证模型配置
    if (!this.config.models.apiKey && !process.env.OPENAI_API_KEY) {
      errors.push('缺少 API Key');
    }
    
    // 验证隔离配置
    if (this.config.isolation.maxProcesses < 1) {
      errors.push(`无效的最大进程数: ${this.config.isolation.maxProcesses}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * 全局配置实例
 */
let globalConfig: ConfigManager | null = null;

/**
 * 获取全局配置实例
 */
export function getConfig(): ConfigManager {
  if (!globalConfig) {
    const configPath = process.env.CONFIG_PATH || join(process.cwd(), 'config.json');
    globalConfig = new ConfigManager(configPath);
  }
  return globalConfig;
}

/**
 * 初始化配置
 */
export function initConfig(configPath?: string): ConfigManager {
  globalConfig = new ConfigManager(configPath);
  return globalConfig;
}