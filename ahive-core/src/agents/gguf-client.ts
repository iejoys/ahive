/**
 * GGUF 本地模型客户端
 * 
 * 功能：
 * - 直接加载 GGUF 模型文件，无需 Ollama
 * - 完全本地运行，开箱即用
 * - 支持内嵌模型和自定义模型路径
 * - 使用 node-llama-cpp 的 LlamaChatSession 自动处理 Qwen 格式
 * - 支持 Function Calling / 工具调用
 */

import type { LLMClient, LLMResponse, ChatMessage, ModelConfig, ToolCall } from './index.js';
import { logger } from '../utils/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// node-llama-cpp 类型（动态导入）
type LlamaModel = any;
type LlamaContext = any;
type LlamaChatSession = any;

/**
 * 工具/函数定义
 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数定义 (JSON Schema) */
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  /** 处理函数 */
  handler: (params: Record<string, any>) => Promise<any> | any;
}

/**
 * GGUF 配置
 */
export interface GGUFConfig {
  /** 模型文件路径 */
  modelPath?: string;
  /** 默认模型名称 */
  modelName?: string;
  /** 温度 */
  temperature?: number;
  /** 最大 Token */
  maxTokens?: number;
  /** 上下文长度 */
  contextSize?: number;
  /** GPU 层数（0 = 纯 CPU，-1 = 全部 GPU） */
  gpuLayers?: number;
  /** 线程数 */
  threads?: number;
  /** 批次序列数（默认1，用于并发调用） */
  sequences?: number;
  /** 注册的工具/函数 */
  tools?: ToolDefinition[];
}

/**
 * GGUF 客户端实现
 * 
 * 使用 node-llama-cpp 的 LlamaChatSession，自动识别 Qwen chat 格式
 */
export class GGUFClient implements LLMClient {
  private config: Required<Omit<GGUFConfig, 'tools'>> & { tools: ToolDefinition[] };
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private session: LlamaChatSession | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private registeredFunctions: Map<string, ToolDefinition> = new Map();

  constructor(config?: GGUFConfig) {
    // 从配置文件读取当前模型
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(__dirname, '../../config/models.json');
    
    let currentModelFile = 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'; // 兜底默认值
    let defaultSettings = {
      defaultGpuLayers: 0,
      defaultThreads: 4,
      defaultContextSize: 2048,
      defaultTemperature: 0.7,
      defaultMaxTokens: 2048
    };
    
    try {
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const modelConfig = JSON.parse(configContent);
        if (modelConfig.currentModel) {
          currentModelFile = modelConfig.currentModel;
        }
        if (modelConfig.settings) {
          defaultSettings = {
            defaultGpuLayers: modelConfig.settings.defaultGpuLayers ?? 0,
            defaultThreads: modelConfig.settings.defaultThreads ?? 4,
            defaultContextSize: modelConfig.settings.defaultContextSize ?? 2048,
            defaultTemperature: modelConfig.settings.defaultTemperature ?? 0.7,
            defaultMaxTokens: modelConfig.settings.defaultMaxTokens ?? 2048
          };
        }
      }
    } catch (e) {
      logger.warn(`[GGUF] 无法读取模型配置，使用默认模型: ${currentModelFile}`);
    }
    
    const defaultModelPath = path.join(__dirname, '../../models', currentModelFile);

    this.config = {
      modelPath: config?.modelPath || defaultModelPath,
      modelName: config?.modelName || currentModelFile.replace('.gguf', ''),
      temperature: config?.temperature ?? defaultSettings.defaultTemperature,
      maxTokens: config?.maxTokens || defaultSettings.defaultMaxTokens,
      contextSize: config?.contextSize || defaultSettings.defaultContextSize,
      gpuLayers: config?.gpuLayers ?? defaultSettings.defaultGpuLayers,
      threads: config?.threads || defaultSettings.defaultThreads,
      sequences: config?.sequences ?? 1, // 默认单序列，减少显存占用
      tools: config?.tools || [],
    };

    // 注册工具
    for (const tool of this.config.tools) {
      this.registerTool(tool);
    }

    logger.info(`[GGUF] 客户端初始化: ${this.config.modelPath}`);
  }

  /**
   * 注册工具/函数
   */
  registerTool(tool: ToolDefinition): void {
    this.registeredFunctions.set(tool.name, tool);
    logger.info(`[GGUF] 注册工具: ${tool.name}`);
  }

  /**
   * 获取所有已注册的工具
   */
  getTools(): ToolDefinition[] {
    return Array.from(this.registeredFunctions.values());
  }

  /**
   * 初始化模型（异步加载）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      // 检查模型文件是否存在
      if (!fs.existsSync(this.config.modelPath)) {
        throw new Error(`模型文件不存在: ${this.config.modelPath}\n请运行: npm run download-model`);
      }

      logger.info(`[GGUF] 加载模型: ${this.config.modelPath}`);
      const startTime = Date.now();

      // 动态导入 node-llama-cpp
      let getLlama: any, LlamaChatSession: any;
      try {
        const llamaCpp = await import('node-llama-cpp');
        getLlama = llamaCpp.getLlama;
        LlamaChatSession = llamaCpp.LlamaChatSession;
      } catch (importError) {
        throw new Error('node-llama-cpp 未安装。请运行: npm install node-llama-cpp');
      }

      // 获取 Llama 实例
      const llama = await getLlama({
        gpuLayers: this.config.gpuLayers,
        threads: this.config.threads,
      });

      // 加载模型
      this.model = await llama.loadModel({
        modelPath: this.config.modelPath,
      });

      // 创建上下文
      // sequences 可配置，默认为 1（单序列，减少显存占用）
      // 如果需要并发调用，可设置为 2：
      // - sequence 0: 主 session（正常对话）
      // - sequence 1: 隔离调用（内部判断等）
      this.context = await this.model.createContext({
        contextSize: this.config.contextSize,
        sequences: this.config.sequences,
      });

      // 创建 Chat Session（自动识别 Qwen 格式）
      this.session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
      });

      const loadTime = Date.now() - startTime;
      this.initialized = true;

      logger.info(`[GGUF] 模型加载完成，耗时: ${loadTime}ms`);
      console.log(`  ✅ 本地模型已加载: ${this.config.modelName}`);

    } catch (error) {
      logger.error(`[GGUF] 模型加载失败:`, error);
      throw error;
    }
  }

  /**
   * 聊天完成（支持 Function Calling）
   */
  async chat(messages: ChatMessage[], config?: ModelConfig): Promise<LLMResponse> {
    // 确保模型已初始化
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.session) {
      throw new Error('模型未初始化');
    }

    const temperature = config?.temperature ?? this.config.temperature;
    const maxTokens = config?.maxTokens || this.config.maxTokens;

    const startTime = Date.now();

    try {
      // 构建完整的对话提示
      const prompt = this.buildPrompt(messages);
      
      logger.debug(`[GGUF] 生成回复...`);

      // 构建生成选项
      const promptOptions: any = {
        maxTokens,
        temperature,
        topP: 0.9,
        minP: 0,
        repeatPenalty: 1.1,
      };

      // 注意：Qwen2.5 不是 Function Calling 模型，不使用原生 functions
      // 工具调用通过 System Prompt 实现，在 main.ts 中处理响应解析
      // if (this.registeredFunctions.size > 0) {
      //   promptOptions.functions = await this.buildFunctions();
      //   logger.debug(`[GGUF] 已启用 ${this.registeredFunctions.size} 个工具`);
      // }

      // 使用 session.prompt 进行对话
      const responseText = await this.session.prompt(prompt, promptOptions);

      const duration = Date.now() - startTime;

      logger.info(`[GGUF] 生成完成，耗时: ${duration}ms, 长度: ${responseText.length}`);

      return {
        content: responseText,
        model: this.config.modelName,
        usage: {
          promptTokens: Math.floor(prompt.length / 4), // 估算
          completionTokens: Math.floor(responseText.length / 4),
          totalTokens: Math.floor((prompt.length + responseText.length) / 4),
        },
        finishReason: 'stop',
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[GGUF] 生成失败 (${duration}ms):`, error);
      throw error;
    }
  }

  /**
   * 构建 node-llama-cpp 函数定义
   */
  private async buildFunctions(): Promise<Record<string, any>> {
    const { defineChatSessionFunction } = await import('node-llama-cpp');
    const functions: Record<string, any> = {};

    for (const [name, tool] of this.registeredFunctions) {
      functions[name] = defineChatSessionFunction({
        description: tool.description,
        params: tool.parameters,
        handler: tool.handler,
      });
    }

    return functions;
  }

  /**
   * 构建提示词（从消息列表提取用户最后的问题）
   */
  private buildPrompt(messages: ChatMessage[]): string {
    // 找到最后一条用户消息
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        // 如果有系统消息，前缀添加
        const systemMsg = messages.find(m => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        const rawContent = messages[i].content;
        const userText: string = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
        if (systemMsg && i === messages.length - 1) {
          return `${systemText}\n\n${userText}`;
        }
        return userText;
      }
    }
    
    const lastContent = messages[messages.length - 1]?.content;
    return (typeof lastContent === 'string' ? lastContent : '') || '';
  }

  /**
   * 隔离对话（不记录到 session 历史）
   * 用于内部独立调用，不影响主会话历史
   */
  async chatIsolated(messages: ChatMessage[], config?: ModelConfig): Promise<LLMResponse> {
    // 确保模型已初始化
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.context) {
      throw new Error('模型未初始化');
    }

    const temperature = config?.temperature ?? this.config.temperature;
    const maxTokens = config?.maxTokens || 1024; // 隔离调用不需要太长

    const startTime = Date.now();
    let tempSequence: any = null;

    try {
      // 创建临时的 context sequence（隔离历史）
      tempSequence = this.context.getSequence();
      
      // 动态导入 LlamaChatSession
      const { LlamaChatSession } = await import('node-llama-cpp');
      
      // 创建临时 session
      const tempSession = new LlamaChatSession({
        contextSequence: tempSequence,
      });

      // 构建提示词
      const prompt = this.buildPrompt(messages);
      
      logger.debug(`[GGUF] 隔离调用（不记录历史）...`);

      const promptOptions: any = {
        maxTokens,
        temperature,
        topP: 0.9,
        minP: 0,
        repeatPenalty: 1.1,
      };

      // 使用临时 session 进行生成
      const responseText = await tempSession.prompt(prompt, promptOptions);

      const duration = Date.now() - startTime;
      logger.debug(`[GGUF] 隔离调用完成，耗时: ${duration}ms`);

      return {
        content: responseText,
        model: this.config.modelName,
        usage: {
          promptTokens: Math.floor(prompt.length / 4),
          completionTokens: Math.floor(responseText.length / 4),
          totalTokens: Math.floor((prompt.length + responseText.length) / 4),
        },
        finishReason: 'stop',
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[GGUF] 隔离调用失败 (${duration}ms):`, error);
      throw error;
    } finally {
      // 释放 sequence，让其他调用可以复用
      if (tempSequence && !tempSequence.disposed) {
        try {
          tempSequence.dispose();
          logger.debug(`[GGUF] sequence 已释放`);
        } catch (e) {
          logger.debug(`[GGUF] sequence 释放失败:`, e);
        }
      }
    }
  }

  /**
   * 检查模型是否可用
   */
  async checkHealth(): Promise<{ available: boolean; error?: string }> {
    try {
      if (!fs.existsSync(this.config.modelPath)) {
        return {
          available: false,
          error: `模型文件不存在: ${this.config.modelPath}`,
        };
      }

      if (!this.initialized) {
        await this.initialize();
      }

      return { available: this.initialized };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取配置
   */
  getConfig(): GGUFConfig {
    return { ...this.config };
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    if (this.session) {
      this.session = null;
    }
    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }
    this.initialized = false;
    logger.info('[GGUF] 资源已释放');
  }
}

/**
 * 创建 GGUF 客户端
 */
export function createGGUFClient(config?: GGUFConfig): LLMClient {
  return new GGUFClient(config);
}

/**
 * 获取默认模型路径（从配置文件读取）
 */
export function getDefaultModelPath(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const configPath = path.join(__dirname, '../../config/models.json');
  
  let currentModelFile = 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'; // 兜底默认值
  try {
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const modelConfig = JSON.parse(configContent);
      if (modelConfig.currentModel) {
        currentModelFile = modelConfig.currentModel;
      }
    }
  } catch (e) {
    // ignore
  }
  
  return path.join(__dirname, '../../models', currentModelFile);
}

/**
 * 检查内嵌模型是否存在
 */
export function hasEmbeddedModel(): boolean {
  const modelPath = getDefaultModelPath();
  return fs.existsSync(modelPath);
}

// ============ 内置工具定义 ============

import { getToolRegistry } from '../executor/index.js';

/**
 * 注册执行器工具到 GGUFClient
 */
export function registerExecutorTools(client: GGUFClient): void {
  const registry = getToolRegistry();
  
  for (const tool of registry.getAll()) {
    // 将 Zod schema 转换为 JSON Schema
    const jsonSchema = zodToJsonSchema(tool.parameters);
    
    client.registerTool({
      name: tool.name,
      description: tool.description,
      parameters: jsonSchema,
      handler: async (params: any) => {
        const result = await tool.execute(params);
        return JSON.stringify(result);
      },
    });
  }
}

/**
 * 将 Zod Schema 转换为 JSON Schema
 */
function zodToJsonSchema(zodSchema: any): any {
  // 处理 ZodObject
  if (zodSchema._def?.shape) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(zodSchema._def.shape)) {
      properties[key] = zodToJsonSchema(value);
      // 检查是否可选
      const valueType = (value as any)?._def?.typeName;
      if (valueType !== 'ZodOptional') {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
  
  // 处理 ZodOptional
  if (zodSchema._def?.innerType) {
    return zodToJsonSchema(zodSchema._def.innerType);
  }
  
  // 处理 ZodString
  if (zodSchema._def?.typeName === 'ZodString') {
    return { type: 'string', description: zodSchema._def.description };
  }
  
  // 处理 ZodNumber
  if (zodSchema._def?.typeName === 'ZodNumber') {
    return { type: 'number', description: zodSchema._def.description };
  }
  
  // 处理 ZodBoolean
  if (zodSchema._def?.typeName === 'ZodBoolean') {
    return { type: 'boolean', description: zodSchema._def.description };
  }
  
  // 处理 ZodEnum
  if (zodSchema._def?.typeName === 'ZodEnum') {
    return { type: 'string', enum: zodSchema._def.values };
  }
  
  // 处理 ZodDefault
  if (zodSchema._def?.innerType) {
    return zodToJsonSchema(zodSchema._def.innerType);
  }
  
  // 默认
  return { type: 'string' };
}

/**
 * 内置工具：获取当前时间
 */
/**
 * 内置工具：获取当前时间
 */
export const getcurrentTimeTool: ToolDefinition = {
  name: 'get_current_time',
  description: '获取当前日期和时间',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: '时区，如 Asia/Shanghai, UTC',
      },
    },
  },
  handler: (params) => {
    const tz = params.timezone || 'Asia/Shanghai';
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('zh-CN', { timeZone: tz }),
      timestamp: now.getTime(),
    };
  },
};

/**
 * 内置工具：执行数学计算
 */
export const calculateTool: ToolDefinition = {
  name: 'calculate',
  description: '执行数学计算表达式',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，如 "2 + 2", "Math.sqrt(16)"',
      },
    },
    required: ['expression'],
  },
  handler: (params) => {
    try {
      const safeEval = (expr: string) => {
        const allowedChars = /^[\d\s+\-*/.()Math,sin,cos,tan,sqrt,pow,abs,ceil,floor,round,PI,E]+$/;
        if (!allowedChars.test(expr)) {
          throw new Error('表达式包含不允许的字符');
        }
        return Function(`"use strict"; return (${expr})`)();
      };
      const result = safeEval(params.expression);
      return { result, expression: params.expression };
    } catch (error) {
      return { error: '计算失败', expression: params.expression };
    }
  },
};

/**
 * 内置工具：获取系统信息
 */
export const getSystemInfoTool: ToolDefinition = {
  name: 'get_system_info',
  description: '获取系统信息',
  parameters: {
    type: 'object',
    properties: {},
  },
  handler: () => {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      arch: process.arch,
      uptime: process.uptime(),
      memory: {
        total: Math.floor(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        used: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      },
    };
  },
};

/**
 * 内置工具：执行 Shell 命令
 */
export const execTool: ToolDefinition = {
  name: 'exec',
  description: '执行 Shell 命令。可以用于文件操作、系统命令等。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令' },
      workdir: { type: 'string', description: '工作目录（可选）' },
    },
    required: ['command'],
  },
  handler: async (params) => {
    const { ShellExecutor } = await import('../executor/shell-executor.js');
    const executor = new ShellExecutor();
    return executor.execute({
      command: params.command,
      workdir: params.workdir,
    });
  },
};

/**
 * 内置工具：读取文件
 */
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
    },
    required: ['path'],
  },
  handler: async (params) => {
    const { FileSystemExecutor } = await import('../executor/fs-executor.js');
    const executor = new FileSystemExecutor();
    return executor.readFile(params.path);
  },
};

/**
 * 内置工具：写入文件
 */
export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '写入文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['path', 'content'],
  },
  handler: async (params) => {
    const { FileSystemExecutor } = await import('../executor/fs-executor.js');
    const executor = new FileSystemExecutor();
    return executor.writeFile(params.path, params.content);
  },
};

/**
 * 内置工具：列出目录
 */
export const listDirTool: ToolDefinition = {
  name: 'list_dir',
  description: '列出目录内容',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径' },
      recursive: { type: 'boolean', description: '是否递归列出' },
    },
    required: ['path'],
  },
  handler: async (params) => {
    const { FileSystemExecutor } = await import('../executor/fs-executor.js');
    const executor = new FileSystemExecutor();
    return executor.listDir(params.path, params.recursive);
  },
};

/**
 * 所有内置工具（包含执行器）
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  getcurrentTimeTool,
  calculateTool,
  getSystemInfoTool,
  execTool,
  readFileTool,
  writeFileTool,
  listDirTool,
];

