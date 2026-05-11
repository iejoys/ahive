/**
 * Plugin SDK - 从 OpenClaw 复用的插件系统核心
 * 
 * 原路径：openclaw-main/src/plugin-sdk/
 */

// ============ 核心接口 ============

/**
 * 插件定义
 */
export interface Plugin {
  /** 插件唯一标识 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 插件作者 */
  author?: string;
  /** 插件入口 */
  activate: (context: PluginContext) => Promise<void> | void;
  /** 插件停用 */
  deactivate?: () => Promise<void> | void;
}

/**
 * 插件上下文
 */
export interface PluginContext {
  /** 插件配置 */
  config: Record<string, any>;
  /** 日志工具 */
  logger: Logger;
  /** 存储接口 */
  storage: Storage;
  /** 发送消息 */
  send: (target: string, message: MessagePayload) => Promise<SendResult>;
  /** 注册命令 */
  registerCommand: (command: Command) => void;
  /** 注册工具 */
  registerTool: (tool: Tool) => void;
}

/**
 * 消息负载
 */
export interface MessagePayload {
  /** 消息内容 */
  text?: string;
  /** 消息类型 */
  type?: 'text' | 'image' | 'file' | 'voice';
  /** 附件 */
  attachments?: Attachment[];
  /** 引用消息 ID */
  replyTo?: string;
  /** 额外参数 */
  [key: string]: any;
}

/**
 * 附件
 */
export interface Attachment {
  /** 附件类型 */
  type: 'image' | 'file' | 'audio' | 'video';
  /** 附件 URL 或路径 */
  url?: string;
  /** 附件数据（Base64） */
  data?: string;
  /** 文件名 */
  filename?: string;
  /** MIME 类型 */
  mimeType?: string;
}

/**
 * 发送结果
 */
export interface SendResult {
  /** 是否成功 */
  success: boolean;
  /** 消息 ID */
  messageId?: string;
  /** 错误信息 */
  error?: string;
  /** 额外数据 */
  [key: string]: any;
}

/**
 * 日志接口
 */
export interface Logger {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

/**
 * 存储接口
 */
export interface Storage {
  get: <T>(key: string) => Promise<T | undefined>;
  set: <T>(key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix?: string) => Promise<string[]>;
}

/**
 * 命令定义
 */
export interface Command {
  /** 命令名称 */
  name: string;
  /** 命令描述 */
  description: string;
  /** 命令处理函数 */
  handler: (args: CommandArgs) => Promise<CommandResult>;
  /** 参数定义 */
  parameters?: CommandParameter[];
}

/**
 * 命令参数
 */
export interface CommandParameter {
  /** 参数名称 */
  name: string;
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'array';
  /** 是否必需 */
  required?: boolean;
  /** 默认值 */
  default?: any;
  /** 描述 */
  description?: string;
}

/**
 * 命令参数
 */
export interface CommandArgs {
  /** 参数值 */
  [key: string]: any;
  /** 调用者信息 */
  caller?: CallerInfo;
  /** 上下文 */
  context?: any;
}

/**
 * 调用者信息
 */
export interface CallerInfo {
  /** 用户 ID */
  userId: string;
  /** 用户名 */
  userName?: string;
  /** 权限级别 */
  permissions?: string[];
}

/**
 * 命令结果
 */
export interface CommandResult {
  /** 是否成功 */
  success: boolean;
  /** 返回消息 */
  message?: string;
  /** 返回数据 */
  data?: any;
  /** 错误信息 */
  error?: string;
}

/**
 * 工具定义
 */
export interface Tool {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具处理函数 */
  handler: (input: any) => Promise<any>;
  /** 输入 Schema（JSON Schema） */
  inputSchema?: any;
  /** 输出 Schema（JSON Schema） */
  outputSchema?: any;
}

// ============ 插件管理器 ============

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private contexts: Map<string, PluginContext> = new Map();
  private commands: Map<string, Command> = new Map();
  private tools: Map<string, Tool> = new Map();

  /**
   * 注册插件
   */
  async register(plugin: Plugin, context: PluginContext): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin already registered: ${plugin.id}`);
    }

    this.plugins.set(plugin.id, plugin);
    this.contexts.set(plugin.id, context);

    try {
      await plugin.activate(context);
      context.logger.info(`Plugin activated: ${plugin.id}`);
    } catch (error) {
      this.plugins.delete(plugin.id);
      this.contexts.delete(plugin.id);
      throw error;
    }
  }

  /**
   * 注销插件
   */
  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    try {
      if (plugin.deactivate) {
        await plugin.deactivate();
      }
    } finally {
      this.plugins.delete(pluginId);
      this.contexts.delete(pluginId);
    }
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 列出所有插件
   */
  listPlugins(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * 注册命令
   */
  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
  }

  /**
   * 执行命令
   */
  async executeCommand(name: string, args: CommandArgs): Promise<CommandResult> {
    const command = this.commands.get(name);
    if (!command) {
      return { success: false, error: `Command not found: ${name}` };
    }

    try {
      return await command.handler(args);
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * 注册工具
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 执行工具
   */
  async executeTool(name: string, input: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return await tool.handler(input);
  }

  /**
   * 列出所有工具
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

// ============ 辅助函数 ============

/**
 * 创建简单的日志记录器
 */
export function createLogger(prefix: string): Logger {
  return {
    debug: (msg, ...args) => console.debug(`[${prefix}]`, msg, ...args),
    info: (msg, ...args) => console.info(`[${prefix}]`, msg, ...args),
    warn: (msg, ...args) => console.warn(`[${prefix}]`, msg, ...args),
    error: (msg, ...args) => console.error(`[${prefix}]`, msg, ...args),
  };
}

/**
 * 创建内存存储
 */
export function createMemoryStorage(): Storage {
  const store = new Map<string, any>();

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return store.get(key);
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(prefix?: string): Promise<string[]> {
      if (!prefix) return Array.from(store.keys());
      return Array.from(store.keys()).filter(k => k.startsWith(prefix));
    },
  };
}

// 默认导出
export default {
  PluginManager,
  createLogger,
  createMemoryStorage,
};
