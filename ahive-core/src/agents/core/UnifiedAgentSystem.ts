/**
 * AHIVECORE - 统一智能体系统
 * 
 * 支持 AHIVE-Worker 和 AHIVE-Coder 两种智能体类型
 * 各自有独立的执行器和提示词系统
 * 支持分身和内部通信
 * 
 * 关键设计：
 * - 所有智能体类型：直接调用 LLM Gateway
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger, cleanAgentMessage } from '../../utils/index.js';
import { AHIVE_CODER_SYSTEM_PROMPT, AHIVE_CODER_TOOLS_PROMPT, AHIVE_CODER_FORMAT_PROMPT } from '../ahive-coder/prompts.js';
import { agentConfigToProviderConfig } from '../../providers/config-adapter.js';
import { WebotAgent, loadWebotConfig } from '../ahive-webot/index.js';

// 获取当前文件的目录路径 (ES Module 兼容)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== LLM 调用接口 ====================

/**
 * LLM 调用服务接口
 * 由外部注入（main.ts 中的 ProviderManager）
 */
export interface LLMService {
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, config?: any): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    finishReason?: string;
  }>;
}

/**
 * 工具执行器接口
 */
export interface ToolExecutor {
  execute(toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): Promise<Array<{
    callId: string;
    toolName: string;
    success: boolean;
    result: string;
  }>>;
}

// ==================== 类型定义 ====================

/** 智能体类型 */
export type AgentType = 'ahive-worker' | 'ahive-coder';

/** 智能体状态 */
export enum UnifiedAgentStatus {
  Idle = 'idle',
  Running = 'running',
  Waiting = 'waiting',
  Completed = 'completed',
  Error = 'error',
  Closed = 'closed',
}

/** 智能体模型配置 */
export interface AgentModelConfig {
  /** 提供者（可选，不指定时使用 ProviderManager 的当前 Provider） */
  provider?: 'openai' | 'anthropic' | 'ollama' | 'local' | 'bailian' | 'custom';
  /** 模型名称（可选，不指定时使用 ProviderManager 的当前模型） */
  name?: string;
  /** API Key (可覆盖默认) */
  apiKey?: string;
  /** API 基础 URL (可覆盖默认) */
  baseUrl?: string;
  /** Ollama 主机地址 (特定于 Ollama) */
  ollamaHost?: string;
  /** 温度 */
  temperature?: number;
  /** 最大 Token */
  maxTokens?: number;
}

/** 基础智能体配置 */
export interface UnifiedAgentConfig {
  /** 智能体 ID */
  id: string;

  /** 智能体类型 */
  type: AgentType;

  /** 昵称 */
  nickname?: string;

  /** 角色 */
  role?: string;

  /** 角色ID（仅适用于 AHIVE-Worker 类型） */
  roleId?: string;

  /** 模型配置 */
  model?: Partial<AgentModelConfig>;

  /** 分身默认模型配置 - 设置后所有子分身自动使用此模型 */
  spawnModel?: Partial<AgentModelConfig>;

  /** 最大分身数量 */
  maxSpawns?: number;

  /** 最大递归深度 */
  maxDepth: number;

  /** 当前深度 */
  currentDepth: number;

  /** 父智能体 ID */
  parentId?: string;

  /** 创建时间 */
  createdAt: Date;
}

/** 消息格式 */
export interface UnifiedMessage {
  id: string;
  fromAgentId: string;
  toAgentId?: string;  // 为空表示广播
  type: 'task' | 'result' | 'query' | 'response' | 'broadcast';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/** 智能体实例 */
interface AgentInstance {
  config: UnifiedAgentConfig;
  status: UnifiedAgentStatus;
  messages: UnifiedMessage[];
  result?: string;
  childAgents: Set<string>;
  // 会话消息历史（用于多轮对话）
  sessionMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

// ==================== 提示词系统 ====================

/**
 * 提示词管理器
 */
class PromptManager {
  private prompts: Map<AgentType, {
    system: string;
    tools: string;
    format: string;
  }> = new Map();

  constructor() {
    this.initDefaultPrompts();
  }

  private initDefaultPrompts(): void {
    // AHIVE-WORKER 提示词
    this.prompts.set('ahive-worker', {
      system: `你是 AHIVE-WORKER 智能体，一个强大的 AI 助手。

能力：
- 对话和问答
- 代码编写和修改
- 文件操作
- Shell 命令执行
- 与其他智能体通讯

工具调用格式：
\`\`\`tool
{
  "name": "工具名称",
  "arguments": { ... }
}
\`\`\`

跨智能体通讯：
- 可以向其他智能体发送消息：send_message({ to_agent: 'ahive-coder-main', message: '请帮我写个API' })
- 收到消息时会自动响应

注意：谨慎执行危险命令，确保操作安全。

## 任务计划

你可以使用 \`update_plan\` 工具来拆分复杂任务：

1. **创建计划**：列出所有步骤，第一个标记为 in_progress
2. **更新进度**：完成的步骤标记为 completed，下一个标记为 in_progress
3. **完成任务**：所有步骤标记为 completed

步骤描述要简洁（不超过 5-7 个词）。`,
      tools: `可用工具：
- send_message: 向其他智能体发送消息
- exec: 执行 Shell 命令
- read_file: 读取文件
- write_file: 写入文件
- list_dir: 列出目录
- delete: 删除文件
- get_time: 获取当前时间
- get_system_info: 获取系统信息
- update_plan: 更新任务计划（拆分任务、追踪进度）`,
      format: '使用 Markdown 格式回复，代码块注明语言。',
    });

    // AHIVE-CODER 提示词（使用专用提示词文件）
    this.prompts.set('ahive-coder', {
      system: AHIVE_CODER_SYSTEM_PROMPT,
      tools: AHIVE_CODER_TOOLS_PROMPT,
      format: AHIVE_CODER_FORMAT_PROMPT,
    });

  }

  /**
   * 获取提示词
   */
  getPrompts(type: AgentType): {
    system: string;
    tools: string;
    format: string;
  } {
    const prompts = this.prompts.get(type);
    if (!prompts) {
      // 未知类型，返回 ahive-worker 默认提示词
      console.warn(`[PromptManager] 未知的智能体类型: ${type}，使用 ahive-worker 默认提示词`);
      return this.prompts.get('ahive-worker')!;
    }
    return prompts;
  }

  /**
   * 设置自定义提示词
   */
  setPrompts(type: AgentType, prompts: {
    system?: string;
    tools?: string;
    format?: string;
  }): void {
    let existing = this.prompts.get(type);
    if (!existing) {
      // 未知类型，使用 ahive-worker 默认提示词作为基础
      console.warn(`[PromptManager] 未知的智能体类型: ${type}，使用 ahive-worker 默认提示词作为基础`);
      existing = this.prompts.get('ahive-worker')!;
    }
    this.prompts.set(type, {
      system: prompts.system ?? existing.system,
      tools: prompts.tools ?? existing.tools,
      format: prompts.format ?? existing.format,
    });
  }

  /**
   * 获取完整系统提示
   */
  getFullSystemPrompt(type: AgentType): string {
    const prompts = this.prompts.get(type);
    if (!prompts) {
      // 未知类型，返回 ahive-worker 默认提示词
      console.warn(`[PromptManager] 未知的智能体类型: ${type}，使用 ahive-worker 默认提示词`);
      const defaultPrompts = this.prompts.get('ahive-worker')!;
      return `${defaultPrompts.system}\n\n${defaultPrompts.tools}\n\n${defaultPrompts.format}`;
    }
    const { system, tools, format } = prompts;
    return `${system}\n\n${tools}\n\n${format}`;
  }
}

// ==================== 消息总线 ====================

/**
 * 内部消息总线
 * 
 * 智能体之间通信的通道
 */
class MessageBus extends EventEmitter {
  private messageHistory: UnifiedMessage[] = [];
  private maxHistory: number = 1000;

  /**
   * 发送消息
   */
  send(message: UnifiedMessage): void {
    this.messageHistory.push(message);

    // 限制历史记录
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }

    // 发送给指定智能体
    if (message.toAgentId) {
      this.emit(`message:${message.toAgentId}`, message);
    } else {
      // 广播给所有智能体
      this.emit('broadcast', message);
    }
  }

  /**
   * 接收消息
   */
  onMessage(agentId: string, handler: (message: UnifiedMessage) => void): void {
    this.on(`message:${agentId}`, handler);
  }

  /**
   * 接收广播
   */
  onBroadcast(handler: (message: UnifiedMessage) => void): void {
    this.on('broadcast', handler);
  }

  /**
   * 取消订阅
   */
  offMessage(agentId: string, handler?: (message: UnifiedMessage) => void): void {
    if (handler) {
      this.off(`message:${agentId}`, handler);
    } else {
      this.removeAllListeners(`message:${agentId}`);
    }
  }

  /**
   * 获取历史消息
   */
  getHistory(agentId?: string): UnifiedMessage[] {
    if (!agentId) {
      return [...this.messageHistory];
    }
    return this.messageHistory.filter(
      m => m.fromAgentId === agentId || m.toAgentId === agentId
    );
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.messageHistory = [];
  }

  /**
   * 订阅所有消息（用于广播到前端）
   */
  onAllMessages(handler: (message: UnifiedMessage) => void): void {
    this.on('message:all', handler);
  }

  /**
   * 取消订阅所有消息
   */
  offAllMessages(handler?: (message: UnifiedMessage) => void): void {
    if (handler) {
      this.off('message:all', handler);
    } else {
      this.removeAllListeners('message:all');
    }
  }
}

// ==================== 智能体名片 ====================

/**
 * 智能体名片 - 注册到公共池的自我介绍
 */
export interface AgentCard {
  nickname: string;
  type: AgentType;
  role: string;
  capabilities: string[];      // 能力标签
  expertise: string[];         // 专长领域
  introduction: string;        // 自我介绍
}

// ==================== 持久化存储接口 ====================

/**
 * 持久化的智能体配置（可序列化）
 */
interface PersistedAgentConfig {
  id: string;
  type: AgentType;
  nickname?: string;
  role?: string;
  model?: Partial<AgentModelConfig>;
  maxDepth: number;
  currentDepth: number;
  parentId?: string;
  createdAt: string;  // ISO string
}

/**
 * 持久化存储结构
 */
interface PersistedAgentsData {
  version: string;
  mainAgentId: string | null;
  activeAgentId: string | null;
  agents: PersistedAgentConfig[];
  updatedAt: string;
}

// ==================== 统一智能体系统 ====================

/**
 * 统一智能体系统
 * 
 * 管理 ahive-worker 和 ahive-coder 两种类型的智能体
 * 支持持久化存储，重启后可恢复
 */
export class UnifiedAgentSystem extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private promptManager: PromptManager;
  private messageBus: MessageBus;
  private mainAgentId: string | null = null;
  private defaultMaxDepth: number = 3;

  // 并发限制
  private maxThreads: number = 20;           // AHIVECORE 全局最大智能体数量
  private defaultMaxSpawns: number = 6;      // AHIVE-CODER 官方标准：每个父智能体最多 6 个分身
  private activeSpawnCount: number = 0;       // 当前活跃分身数

  // 外部服务注入
  private llmService: LLMService | null = null;
  private toolExecutor: ToolExecutor | null = null;

  // 当前活跃智能体
  private activeAgentId: string | null = null;

  // 持久化配置
  private persistencePath: string;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  // 🆕 企业微信智能体
  private webotAgent: WebotAgent | null = null;

  constructor(options?: {
    persistencePath?: string;
    maxThreads?: number;
    maxDepth?: number;
  }) {
    super();
    this.promptManager = new PromptManager();
    this.messageBus = new MessageBus();
    this.persistencePath = options?.persistencePath || 'config/agents.json';

    if (options?.maxThreads) this.maxThreads = options.maxThreads;
    if (options?.maxDepth) this.defaultMaxDepth = options.maxDepth;

    // 加载持久化的智能体
    this.loadPersistedAgents();

    // 🆕 初始化企业微信智能体（如果配置启用）
    this.initializeWebotAgent();
  }

  /**
   * 初始化企业微信智能体
   */
  private initializeWebotAgent(): void {
    const webotConfig = loadWebotConfig();
    if (webotConfig && webotConfig.enabled) {
      try {
        this.webotAgent = new WebotAgent(webotConfig, this.messageBus);
        this.webotAgent.start().then(() => {
          logger.info('[UnifiedAgentSystem] 📱 ahive-webot 智能体已启动');
        }).catch((error) => {
          logger.error('[UnifiedAgentSystem] ahive-webot 启动失败:', error);
        });
      } catch (error) {
        logger.error('[UnifiedAgentSystem] ahive-webot 初始化失败:', error);
      }
    }
  }

  // ==================== 服务注入 ====================

  /**
   * 注入 LLM 服务（由 main.ts 调用）
   */
  setLLMService(service: LLMService): void {
    this.llmService = service;
  }

  /**
   * 注入工具执行器（由 main.ts 调用）
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /**
   * 设置当前活跃智能体
   */
  setActiveAgent(agentId: string | null): void {
    if (agentId && !this.agents.has(agentId)) {
      throw new Error(`Agent ${agentId} not found`);
    }
    this.activeAgentId = agentId;
    this.emit('agent:activated', { agentId });

    // 持久化活跃状态
    this.scheduleSave();
  }

  /**
   * 获取当前活跃智能体
   */
  getActiveAgent(): string | null {
    return this.activeAgentId;
  }

  // ==================== 智能体创建 ====================

  /**
   * 创建主智能体
   */
  createMainAgent(type: AgentType, config?: Partial<UnifiedAgentConfig> & { fixedId?: string }): string {
    const id = config?.fixedId || this.generateId();

    // 根据类型设置默认配置
    const defaultModelConfig = this.getDefaultModelConfig(type);

    const agentConfig: UnifiedAgentConfig = {
      id,
      type,
      nickname: config?.nickname ?? (type === 'ahive-worker' ? 'AHIVE-Worker-Main' : 'AHIVE-Coder-Main'),
      role: config?.role ?? 'main',
      model: { ...defaultModelConfig, ...config?.model },
      maxDepth: config?.maxDepth ?? this.defaultMaxDepth,
      currentDepth: 0,
      parentId: config?.parentId,
      createdAt: new Date(),
    };

    this.agents.set(id, {
      config: agentConfig,
      status: UnifiedAgentStatus.Idle,
      messages: [],
      childAgents: new Set(),
      sessionMessages: [],  // 初始化会话消息历史
    });

    // 订阅消息
    this.messageBus.onMessage(id, (msg) => this.handleIncomingMessage(id, msg));
    logger.info(`[UnifiedAgentSystem] createMainAgent 创建并订阅 agent: ${id}`);

    this.mainAgentId = id;
    this.activeAgentId = id;  // 默认设为活跃智能体
    this.emit('agent:created', { agentId: id, type, isMain: true });

    // 持久化
    this.scheduleSave();

    return id;
  }

  /**
   * 创建智能体（API 调用入口）
   * 
   * 用于 REST API 创建智能体，支持自定义配置
   * 
   * @param options 创建选项
   * @returns 创建的智能体配置
   */
  async createAgent(options: {
    agentId?: string;
    type: AgentType;
    nickname?: string;
    config?: {
      model?: Partial<AgentModelConfig>;
      roleId?: string;
      maxDepth?: number;
      maxSpawns?: number;
    };
  }): Promise<UnifiedAgentConfig> {
    // 生成或使用提供的 ID
    const id = options.agentId || this.generateId();

    // 检查 ID 是否已存在
    if (this.agents.has(id)) {
      throw new Error(`Agent ID "${id}" already exists`);
    }

    // 检查昵称是否已存在
    if (options.nickname) {
      for (const agent of this.agents.values()) {
        if (agent.config.nickname === options.nickname) {
          throw new Error(`Agent nickname "${options.nickname}" already exists`);
        }
      }
    }

    // 根据类型获取默认模型配置
    const defaultModelConfig = this.getDefaultModelConfig(options.type);

    // 合并模型配置
    const modelConfig: Partial<AgentModelConfig> = {
      ...defaultModelConfig,
      ...options.config?.model,
    };

    // 创建智能体配置
    const agentConfig: UnifiedAgentConfig = {
      id,
      type: options.type,
      nickname: options.nickname || `${options.type}-${id.slice(0, 8)}`,
      role: 'main',  // API 创建的都是主智能体
      roleId: options.config?.roleId,
      model: modelConfig,
      maxDepth: options.config?.maxDepth ?? this.defaultMaxDepth,
      maxSpawns: options.config?.maxSpawns ?? this.defaultMaxSpawns,
      currentDepth: 0,
      createdAt: new Date(),
    };

    // 创建智能体实例
    this.agents.set(id, {
      config: agentConfig,
      status: UnifiedAgentStatus.Idle,
      messages: [],
      childAgents: new Set(),
      sessionMessages: [],
    });

    // 订阅消息
    this.messageBus.onMessage(id, (msg) => this.handleIncomingMessage(id, msg));

    // 设置为活跃智能体（如果还没有）
    if (!this.activeAgentId) {
      this.activeAgentId = id;
    }

    // 发射创建事件
    this.emit('agent:created', { agentId: id, type: options.type, isMain: true });

    // 持久化
    this.scheduleSave();

    return agentConfig;
  }

  /**
   * 根据智能体类型获取默认模型配置
   * 
   * 🔧 修复：不再硬编码 provider，让 ProviderManager 使用当前 Provider
   * 只设置温度和 maxTokens 等通用参数
   */
  private getDefaultModelConfig(type: AgentType): AgentModelConfig {
    switch (type) {
      case 'ahive-worker':
        // AHIVE-WORKER 类型：使用当前 Provider，对话任务用较高温度
        return {
          // 不指定 provider，让 ProviderManager 使用当前 Provider
          temperature: 0.7,
          maxTokens: 4096,
        };

      case 'ahive-coder':
        // AHIVE-CODER 类型：使用当前 Provider，编程任务用较低温度
        return {
          // 不指定 provider，让 ProviderManager 使用当前 Provider
          temperature: 0.3,  // 编程任务用较低温度
          maxTokens: 8192,
        };

      default:
        return {
          // 不指定 provider，让 ProviderManager 使用当前 Provider
          temperature: 0.7,
          maxTokens: 4096,
        };
    }
  }

  /**
   * 生成分身智能体
   * 
   * 支持跨类型创建：
   * - ahive-worker 可以创建 ahive-coder 分身（编程任务）
   * - ahive-coder  可以创建 ahive-worker 分身（对话任务）
   */
  async spawnAgent(parentId: string, options: {
    message?: string;
    role?: string;
    type?: AgentType;  // 可指定类型，默认继承父类型
    model?: Partial<AgentModelConfig>;
    forkHistory?: boolean;  // 是否继承父级会话历史
  }): Promise<string> {
    const parent = this.agents.get(parentId);
    if (!parent) {
      throw new Error(`Parent agent ${parentId} not found`);
    }

    // 检查并发限制（全局）
    if (this.activeSpawnCount >= this.maxThreads) {
      throw new Error(`Agent thread limit reached (max ${this.maxThreads}). Please wait for existing agents to complete.`);
    }

    // 检查父智能体的分身数量限制（AHIVE-CODER 官方标准：每个父智能体最多 6 个分身）
    const parentMaxSpawns = parent.config.maxSpawns || this.defaultMaxSpawns;
    if (parent.childAgents.size >= parentMaxSpawns) {
      throw new Error(`Parent agent spawn limit reached (max ${parentMaxSpawns} children per parent, AHIVE-CODER standard).`);
    }

    const childDepth = parent.config.currentDepth + 1;
    if (childDepth >= parent.config.maxDepth) {
      throw new Error('Agent depth limit reached');
    }

    // 预留槽位
    this.activeSpawnCount++;

    const id = this.generateId();

    // 类型：可指定，默认继承父类型
    const childType = options.type || parent.config.type;

    // 根据类型获取默认配置
    const defaultModelConfig = this.getDefaultModelConfig(childType);

    // 模型配置：强制继承父智能体模型，忽略 LLM 传入的 options.model
    // 原因：LLM 经常幻觉出不存在的模型名（如 "nano"、"mini"），
    // 直接强制继承父智能体模型最可靠
    const modelConfig: Partial<AgentModelConfig> = {
      ...defaultModelConfig,
      ...parent.config.model,
      ...parent.config.spawnModel,  // 分身默认模型优先于父模型
    };
    if (options.model && options.model.name) {
      logger.warn(`[UnifiedAgentSystem] 忽略 LLM 指定的 model: "${options.model.name}"，子智能体强制继承父级模型: ${modelConfig.name}`);
    }

    const config: UnifiedAgentConfig = {
      id,
      type: childType,
      nickname: `${childType}-${id.slice(0, 4)}`,
      role: options.role || 'worker',
      model: modelConfig,
      maxDepth: parent.config.maxDepth,
      currentDepth: childDepth,
      parentId,
      createdAt: new Date(),
    };

    // fork 历史：继承父级会话
    let sessionMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (options.forkHistory && parent.sessionMessages.length > 0) {
      // 复制父级会话历史（最近 20 条）
      sessionMessages = parent.sessionMessages.slice(-20);
    }

    const instance: AgentInstance = {
      config,
      status: UnifiedAgentStatus.Idle,
      messages: options.message ? [{
        id: this.generateId(),
        fromAgentId: parentId,
        toAgentId: id,
        type: 'task',
        content: options.message,
        timestamp: new Date(),
      }] : [],
      childAgents: new Set(),
      sessionMessages,
    };

    this.agents.set(id, instance);
    parent.childAgents.add(id);

    this.messageBus.onMessage(id, (msg) => this.handleIncomingMessage(id, msg));

    this.emit('agent:spawned', {
      parentAgentId: parentId,
      agentId: id,
      type: config.type,
      model: config.model,
      depth: childDepth,
    });

    return id;
  }

  // ==================== 类型相关 ====================

  /**
   * 获取智能体类型
   */
  getType(agentId: string): AgentType | undefined {
    return this.agents.get(agentId)?.config.type;
  }

  /**
   * 获取智能体提示词
   */
  getPrompts(agentId: string): {
    system: string;
    tools: string;
    format: string;
  } | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;
    return this.promptManager.getPrompts(agent.config.type);
  }

  /**
   * 获取完整系统提示
   */
  getSystemPrompt(agentId: string): string | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;
    return this.promptManager.getFullSystemPrompt(agent.config.type);
  }

  /**
   * 获取智能体执行器类型
   */
  getExecutorType(agentId: string): 'ahive-worker' | 'ahive-coder' | undefined {
    const type = this.getType(agentId);
    if (!type) return undefined;

    // AHIVE-WORKER 类型用 AhiveWorker 执行器
    // AHIVE-CODER 类型用 AhiveCoder 执行器（沙箱 + 编排器）
    return type as 'ahive-worker' | 'ahive-coder';
  }

  // ==================== 消息通信 ====================

  /**
   * 发送消息给指定智能体
   */
  sendTo(fromAgentId: string, toAgentId: string, content: string, type: UnifiedMessage['type'] = 'task', metadata?: Record<string, unknown>): void {
    const message: UnifiedMessage = {
      id: this.generateId(),
      fromAgentId,
      toAgentId,
      type,
      content,
      timestamp: new Date(),
      metadata,  // 🆕 支持 metadata 传递（用于企业微信会话追踪）
    };

    this.messageBus.send(message);

    // 发射 agent_chat 事件，用于广播到前端 3D 世界
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);
    this.emit('agent_chat', {
      fromAgentId,
      fromAgentName: fromAgent?.config.nickname || fromAgentId,
      toAgentId,
      toAgentName: toAgent?.config.nickname || toAgentId,
      message: cleanAgentMessage(content),
      messageType: type,
    });
  }

  /**
   * 广播消息给所有智能体
   */
  broadcast(fromAgentId: string, content: string): void {
    const message: UnifiedMessage = {
      id: this.generateId(),
      fromAgentId,
      type: 'broadcast',
      content,
      timestamp: new Date(),
    };

    this.messageBus.send(message);
  }

  /**
    * 处理收到的消息
    */
  private handleIncomingMessage(agentId: string, message: UnifiedMessage): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn(`[UnifiedAgentSystem] 收到消息但找不到 agent: agentId=${agentId}, from=${message.fromAgentId}`);
      return;
    }

    logger.info(`[UnifiedAgentSystem] 收到消息: agentId=${agentId}, from=${message.fromAgentId}, content=${message.content?.substring(0, 50)}...`);

    agent.messages.push(message);

    // 内存优化：根据内存压力动态清理消息历史
    this.trimMessagesIfNeeded(agent);

    this.emit('agent:message', { agentId, message });

    // 自动响应：收到消息后触发 LLM 处理
    this.triggerAutoResponse(agentId, message);
  }

  /**
   * 根据内存压力动态清理消息历史
   * 不使用硬限制，而是根据实际情况智能清理
   */
  private trimMessagesIfNeeded(agent: AgentInstance): void {
    // 只在消息数量较多时检查
    if (agent.messages.length < 50) return;

    // 计算消息总大小
    let totalSize = 0;
    for (const msg of agent.messages) {
      totalSize += (msg.content?.length || 0);
    }

    // 如果总大小超过 100KB，清理旧消息
    // 这是一个合理的阈值，不会影响正常使用
    const MAX_MESSAGES_SIZE = 100 * 1024;  // 100KB
    if (totalSize > MAX_MESSAGES_SIZE) {
      // 保留最近的消息，直到总大小降到阈值以下
      while (agent.messages.length > 10 && totalSize > MAX_MESSAGES_SIZE * 0.5) {
        const removed = agent.messages.shift();
        totalSize -= (removed?.content?.length || 0);
      }
      logger.debug(`[UnifiedAgentSystem] 清理智能体 ${agent.config.id} 的旧消息，保留 ${agent.messages.length} 条`);
    }
  }

  /**
   * 触发自动响应
   * 优化：只对 task/query 类型消息触发 LLM，response/result 类型跳过
   */
  private async triggerAutoResponse(agentId: string, message: UnifiedMessage): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status === UnifiedAgentStatus.Running) {
      // 智能体忙碌时不响应
      return;
    }

    // 消息类型过滤：只对需要处理的消息类型触发 LLM
    // task: 新任务，需要处理
    // query: 查询请求，需要处理
    // response: 响应消息，不需要再响应（避免无限循环）
    // result: 结果消息，不需要再响应
    // broadcast: 广播消息，根据内容决定（暂不触发LLM）
    const shouldTriggerLLM = message.type === 'task' || message.type === 'query';
    if (!shouldTriggerLLM) {
      logger.debug(`[UnifiedAgentSystem] 跳过 ${message.type} 类型消息的 LLM 调用，来源: ${message.fromAgentId?.slice(0, 8)}`);
      return;
    }

    try {
      agent.status = UnifiedAgentStatus.Running;

      if (this.llmService) {
        await this.triggerSimpleLLMResponse(agentId, agent, message);
      } else {
        console.warn(`[UnifiedAgentSystem] No LLM service, cannot auto-respond`);
      }

      agent.status = UnifiedAgentStatus.Idle;

    } catch (error) {
      console.error(`[UnifiedAgentSystem] Auto-response failed: ${error}`);
      agent.status = UnifiedAgentStatus.Idle;
    }
  }

  /**
   * 使用简单 LLM 调用处理响应
   */
  private async triggerSimpleLLMResponse(
    agentId: string,
    agent: AgentInstance,
    message: UnifiedMessage
  ): Promise<void> {
    const agentNickname = agent.config.nickname || agentId.slice(0, 8);

    const contextMessage = `你是 ${agentNickname}，收到了来自其他智能体的消息。

【发送者】${message.fromAgentId}
【消息类型】${message.type}
【消息内容】
${message.content}

请根据消息内容做出响应。如果需要回复，使用 send_message 工具。`;

    // 构建提示词
    const systemPrompt = this.promptManager.getFullSystemPrompt(agent.config.type);

    // 调用 LLM
    const response = await this.llmService!.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextMessage }
    ], agent.config.model);

    // 发送响应事件
    this.emit('agent:auto-response', {
      agentId,
      fromMessage: message,
      response: response.content
    });

    // 自动回复发送者
    if (message.fromAgentId && response.content) {
      console.log(`[UnifiedAgentSystem] ${agentId.slice(0, 8)} 自动回复 ${message.fromAgentId.slice(0, 8)}: ${response.content.substring(0, 100)}...`);
      this.sendTo(agentId, message.fromAgentId, response.content, 'response');
    }
  }

  /**
   * 获取智能体消息历史
   */
  getMessages(agentId: string): UnifiedMessage[] {
    const agent = this.agents.get(agentId);
    return agent ? [...agent.messages] : [];
  }

  // ==================== 状态管理 ====================

  /**
   * 获取状态
   */
  getStatus(agentId: string): UnifiedAgentStatus | undefined {
    return this.agents.get(agentId)?.status;
  }

  /**
   * 设置状态
   */
  setStatus(agentId: string, status: UnifiedAgentStatus): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      this.emit('agent:status', { agentId, status });
    }
  }

  /**
   * 设置结果
   */
  setResult(agentId: string, result: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.result = result;
      agent.status = UnifiedAgentStatus.Completed;
      this.emit('agent:completed', { agentId, result });
    }
  }

  /**
   * 获取结果
   */
  getResult(agentId: string): string | undefined {
    return this.agents.get(agentId)?.result;
  }

  // ==================== 查询方法 ====================

  /**
   * 按类型获取智能体列表
   */
  getAgentsByType(type: AgentType): string[] {
    const result: string[] = [];
    for (const [id, agent] of this.agents) {
      if (agent.config.type === type) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 获取所有智能体列表
   */
  listAgents(): Array<{ id: string; type: AgentType; status: UnifiedAgentStatus; nickname?: string; model?: Partial<AgentModelConfig> }> {
    const result: Array<{ id: string; type: AgentType; status: UnifiedAgentStatus; nickname?: string; model?: Partial<AgentModelConfig> }> = [];
    for (const [id, agent] of this.agents) {
      result.push({
        id,
        type: agent.config.type,
        status: agent.status,
        nickname: agent.config.nickname,
        model: agent.config.model,  // 🆕 添加 model 字段，前端需要判断 provider 类型
      });
    }
    return result;
  }

  /**
   * 获取子智能体
   */
  getChildAgents(agentId: string): string[] {
    const agent = this.agents.get(agentId);
    return agent ? Array.from(agent.childAgents) : [];
  }

  /**
   * 获取所有智能体状态
   */
  getAllStatus(): Map<string, {
    type: AgentType;
    status: UnifiedAgentStatus;
    role?: string;
    nickname?: string;
    model?: string;
  }> {
    const result = new Map();
    for (const [id, agent] of this.agents) {
      result.set(id, {
        type: agent.config.type,
        status: agent.status,
        role: agent.config.role,
        nickname: agent.config.nickname,
        model: agent.config.model?.name,
      });
    }
    return result;
  }

  // ==================== 模型配置 ====================

  /**
   * 获取智能体模型配置
   */
  getModelConfig(agentId: string): Partial<AgentModelConfig> | undefined {
    return this.agents.get(agentId)?.config.model;
  }

  /**
   * 设置智能体模型配置
   */
  setModelConfig(agentId: string, model: Partial<AgentModelConfig>): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.config.model = {
        ...agent.config.model,
        ...model,
      };
      this.emit('agent:model-changed', {
        agentId,
        model: agent.config.model,
      });
    }
  }

  /**
   * 获取分身模型配置
   */
  getSpawnModelConfig(agentId: string): Partial<AgentModelConfig> | undefined {
    return this.agents.get(agentId)?.config.spawnModel;
  }

  /**
   * 设置分身模型配置
   */
  setSpawnModelConfig(agentId: string, spawnModel: Partial<AgentModelConfig> | undefined): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.config.spawnModel = spawnModel;
      this.emit('agent:spawn-model-changed', {
        agentId,
        spawnModel,
      });
    }
  }

  /**
   * 更新智能体配置
   * 
   * 支持更新：nickname、model、role、maxSpawns、maxDepth 等配置
   * 更新后会自动持久化
   * 
   * @param agentId 智能体 ID
   * @param config 要更新的配置
   * @returns 更新后的智能体配置，如果智能体不存在则返回 null
   */
  updateAgent(agentId: string, config: {
    nickname?: string;
    model?: Partial<AgentModelConfig>;
    role?: string;
    maxSpawns?: number;
    maxDepth?: number;
    spawnModel?: Partial<AgentModelConfig>;
  }): UnifiedAgentConfig | null {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }

    // 更新配置
    if (config.nickname !== undefined) {
      agent.config.nickname = config.nickname;
    }

    if (config.model !== undefined) {
      agent.config.model = {
        ...agent.config.model,
        ...config.model,
      };
    }

    if (config.role !== undefined) {
      agent.config.role = config.role;
    }

    if (config.maxSpawns !== undefined) {
      // AHIVE-CODER 标准：1-6
      agent.config.maxSpawns = Math.min(Math.max(1, config.maxSpawns), 6);
    }

    if (config.maxDepth !== undefined) {
      agent.config.maxDepth = Math.max(1, config.maxDepth);
    }

    if (config.spawnModel !== undefined) {
      agent.config.spawnModel = config.spawnModel;
    }

    // 发射更新事件
    this.emit('agent:updated', {
      agentId,
      config: agent.config,
    });

    // 持久化
    this.scheduleSave();

    return { ...agent.config };
  }

  /**
   * 获取最大分身数量
   */
  getMaxSpawns(agentId: string): number {
    return this.agents.get(agentId)?.config.maxSpawns || 3;
  }

  /**
   * 设置最大分身数量
   */
  setMaxSpawns(agentId: string, maxSpawns: number): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.config.maxSpawns = Math.min(Math.max(1, maxSpawns), 6);  // AHIVE-CODER 标准：1-6
    }
  }

  /**
   * 获取智能体的 LLM 调用配置
   * 
   * 返回调用 LLM Gateway 或直接调用所需的配置
   */
  getLLMCallConfig(agentId: string): {
    model: Partial<AgentModelConfig>;
    systemPrompt: string;
  } | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    return {
      model: agent.config.model,
      systemPrompt: this.promptManager.getFullSystemPrompt(agent.config.type),
    };
  }

  /**
   * 按模型分组获取智能体
   */
  getAgentsByModel(modelName: string): string[] {
    const result: string[] = [];
    for (const [id, agent] of this.agents) {
      if (agent.config.model?.name === modelName) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 获取所有使用的模型列表
   */
  getUsedModels(): string[] {
    const models = new Set<string>();
    for (const agent of this.agents.values()) {
      if (agent.config.model?.name) {
        models.add(agent.config.model.name);
      }
    }
    return Array.from(models);
  }

  // ==================== 执行方法（核心） ====================

  /**
   * 执行智能体对话
   * 
   * 所有智能体类型：直接调用 LLM Gateway
   * 
   * @param agentId 智能体 ID
   * @param message 用户消息
   * @param context 额外上下文（可选）
   */
  async executeChat(
    agentId: string,
    message: string,
    context?: {
      userId?: string;
      appKey?: string;
      additionalPrompt?: string;
      customSystemPrompt?: string;  // 完全自定义系统提示词
    }
  ): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    sessionId?: string;
    retrievalTriggered?: boolean;
    memoryUsed?: boolean;
  }> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // 更新状态
    agent.status = UnifiedAgentStatus.Running;
    this.emit('agent:executing', { agentId, message });

    try {
      let result: {
        content: string;
        toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        sessionId?: string;
        retrievalTriggered?: boolean;
        memoryUsed?: boolean;
      };

      // 使用自定义系统提示词或构建默认提示词
      const systemPrompt = context?.customSystemPrompt
        || this.buildFullSystemPrompt(agentId, context?.additionalPrompt);

      // 所有智能体类型：直接调用 LLM
      result = await this.executeLLMChat(agentId, message, systemPrompt);

      // 更新状态
      agent.status = UnifiedAgentStatus.Completed;
      this.emit('agent:completed', { agentId, result });

      return result;

    } catch (error) {
      agent.status = UnifiedAgentStatus.Error;
      this.emit('agent:error', { agentId, error });
      throw error;
    }
  }

  /**
   * 直接调用 LLM（所有智能体类型统一路径）
   */
  private async executeLLMChat(
    agentId: string,
    message: string,
    systemPrompt: string
  ): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }> {
    const agent = this.agents.get(agentId)!;

    if (!this.llmService) {
      throw new Error('LLM Service not injected. Call setLLMService() first.');
    }

    // 构建消息
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...agent.sessionMessages,
      { role: 'user', content: message },
    ];

    // 🔧 使用配置适配器转换 AgentModelConfig -> ProviderConfig
    // 解决 agents.json 和 providers.json 参数命名不一致的问题
    const providerConfig = agentConfigToProviderConfig(agent.config.model);

    // 调用 LLM（使用转换后的 ProviderConfig）
    const response = await this.llmService.chat(messages, providerConfig);

    // 记录到会话历史
    agent.sessionMessages.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response.content }
    );

    // ========== 弃用代码（2026-03-26）==========
    // 原因：硬编码条数限制与新的 token 阈值压缩逻辑冲突
    // 新的压缩逻辑在 AhiveCoderExecutor 中基于 autoCompactTokenLimit (默认 180K tokens) 触发
    // 此处条数限制会导致传入 AhiveCoderExecutor 的消息被提前截断，使其永远达不到 token 阈值
    // 保留代码仅供参考，后续可删除
    //
    // // 限制历史长度
    // if (agent.sessionMessages.length > 20) {
    //   agent.sessionMessages = agent.sessionMessages.slice(-16);
    // }
    // ========== 弃用代码结束 ==========

    return {
      content: response.content,
      toolCalls: response.toolCalls,
    };
  }

  /**
   * 构建完整系统提示（公开方法）
   */
  buildSystemPrompt(agentId: string, additionalPrompt?: string): string {
    return this.buildFullSystemPrompt(agentId, additionalPrompt);
  }

  /**
   * 构建完整系统提示（异步，包含记忆上下文）
   */
  async buildSystemPromptWithMemory(
    agentId: string,
    options?: {
      additionalPrompt?: string;
      memoryContext?: string;
    }
  ): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) return '';

    const basePrompt = this.promptManager.getFullSystemPrompt(agent.config.type);

    let parts = [basePrompt];

    // 注入记忆上下文
    if (options?.memoryContext) {
      parts.push('\n\n--- 记忆上下文 ---\n' + options.memoryContext);
    }

    // 注入额外提示
    if (options?.additionalPrompt) {
      parts.push('\n\n' + options.additionalPrompt);
    }

    return parts.join('');
  }

  /**
   * 获取会话消息历史
   */
  getSessionMessages(agentId: string): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const agent = this.agents.get(agentId);
    if (!agent) return [];
    return [...agent.sessionMessages];
  }

  /**
   * 追加会话消息
   */
  appendSessionMessages(agentId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.sessionMessages.push(...messages);

    // ========== 弃用代码（2026-03-26）==========
    // 原因：硬编码条数限制与新的 token 阈值压缩逻辑冲突
    // 新的压缩逻辑在 AhiveCoderExecutor 中基于 autoCompactTokenLimit (默认 180K tokens) 触发
    // 此处条数限制会导致传入 AhiveCoderExecutor 的消息被提前截断，使其永远达不到 token 阈值
    // 保留代码仅供参考，后续可删除
    //
    // // 限制历史长度
    // if (agent.sessionMessages.length > 20) {
    //   agent.sessionMessages = agent.sessionMessages.slice(-16);
    // }
    // ========== 弃用代码结束 ==========
  }

  /**
   * 构建完整系统提示
   */
  private buildFullSystemPrompt(agentId: string, additionalPrompt?: string): string {
    const agent = this.agents.get(agentId);
    if (!agent) return '';

    const basePrompt = this.promptManager.getFullSystemPrompt(agent.config.type);

    if (additionalPrompt) {
      return `${basePrompt}\n\n${additionalPrompt}`;
    }

    return basePrompt;
  }

  /**
   * 执行工具调用
   */
  async executeTools(
    agentId: string,
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  ): Promise<Array<{
    callId: string;
    toolName: string;
    success: boolean;
    result: string;
  }>> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (!this.toolExecutor) {
      throw new Error('Tool Executor not injected. Call setToolExecutor() first.');
    }

    // 根据智能体类型选择执行器
    // AHIVE-CODER 类型会使用沙箱执行器
    // AHIVE-WORKER 类型使用普通执行器
    return this.toolExecutor.execute(toolCalls);
  }

  /**
   * 执行完整的工具调用循环
   * 
   * 1. 调用 LLM
   * 2. 如果有工具调用，执行工具
   * 3. 将工具结果返回给 LLM
   * 4. 重复直到没有工具调用或达到最大轮数
   */
  async executeWithToolLoop(
    agentId: string,
    message: string,
    options?: {
      maxRounds?: number;
      context?: {
        userId?: string;
        appKey?: string;
        additionalPrompt?: string;
      };
    }
  ): Promise<{
    content: string;
    toolExecutions: Array<{
      round: number;
      calls: Array<{ name: string; arguments: Record<string, unknown> }>;
      results: Array<{ callId: string; toolName: string; success: boolean; result: string }>;
    }>;
  }> {
    const maxRounds = options?.maxRounds ?? 5;
    const toolExecutions: Array<{
      round: number;
      calls: Array<{ name: string; arguments: Record<string, unknown> }>;
      results: Array<{ callId: string; toolName: string; success: boolean; result: string }>;
    }> = [];

    let currentMessage = message;
    let finalContent = '';

    for (let round = 0; round < maxRounds; round++) {
      // 调用 LLM
      const response = await this.executeChat(agentId, currentMessage, options?.context);
      finalContent = response.content;

      // 检查是否有工具调用
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // 执行工具
      const results = await this.executeTools(agentId, response.toolCalls);

      toolExecutions.push({
        round,
        calls: response.toolCalls,
        results,
      });

      // 构建工具结果消息
      const toolResultsText = results.map(r =>
        `${r.success ? '✅' : '❌'} ${r.toolName}: ${r.result}`
      ).join('\n');

      // 继续对话
      currentMessage = `工具执行结果：\n${toolResultsText}\n\n请继续处理。`;
    }

    return {
      content: finalContent,
      toolExecutions,
    };
  }

  /**
   * 分身智能体独立执行任务
   * 
   * 用于 spawn 后让分身独立完成工作
   */
  async executeWorkerTask(
    workerId: string,
    task: string,
    options?: {
      context?: {
        userId?: string;
        appKey?: string;
      };
    }
  ): Promise<string> {
    const worker = this.agents.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    if (worker.config.role !== 'worker') {
      throw new Error(`Agent ${workerId} is not a worker`);
    }

    worker.status = UnifiedAgentStatus.Running;

    try {
      // 执行完整工具循环
      const result = await this.executeWithToolLoop(workerId, task, {
        maxRounds: 5,
        context: options?.context,
      });

      // 设置结果
      worker.result = result.content;
      worker.status = UnifiedAgentStatus.Completed;

      // 通知父智能体
      if (worker.config.parentId) {
        this.sendTo(workerId, worker.config.parentId, result.content, 'result');
      }

      return result.content;

    } catch (error) {
      worker.status = UnifiedAgentStatus.Error;
      throw error;
    }
  }

  /**
   * 清空智能体会话历史
   */
  clearSessionHistory(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.sessionMessages = [];
    }
  }

  // ==================== 配置 ====================

  /**
   * 设置自定义提示词
   */
  setCustomPrompts(type: AgentType, prompts: {
    system?: string;
    tools?: string;
    format?: string;
  }): void {
    this.promptManager.setPrompts(type, prompts);
  }

  /**
   * 设置默认最大深度
   */
  setDefaultMaxDepth(depth: number): void {
    this.defaultMaxDepth = depth;
  }

  // ==================== 生命周期 ====================

  /**
   * 关闭智能体
   */
  async closeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // 先关闭子智能体
    for (const childId of agent.childAgents) {
      await this.closeAgent(childId);
    }

    // 取消消息订阅
    this.messageBus.offMessage(agentId);

    agent.status = UnifiedAgentStatus.Closed;

    // 从父智能体中移除
    if (agent.config.parentId) {
      const parent = this.agents.get(agent.config.parentId);
      if (parent) {
        parent.childAgents.delete(agentId);
      }
    }

    // 从 Map 中移除
    this.agents.delete(agentId);

    // 如果关闭的是主智能体或活跃智能体，清除引用
    if (this.mainAgentId === agentId) {
      this.mainAgentId = null;
    }
    if (this.activeAgentId === agentId) {
      this.activeAgentId = null;
    }

    this.emit('agent:closed', { agentId });

    // 持久化
    this.scheduleSave();
  }

  /**
   * 终止分身智能体
   * 
   * 用于主动终止分身，释放资源
   */
  terminateAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    // 只能终止分身（worker 角色）
    if (agent.config.role === 'main') {
      console.warn(`[UnifiedAgentSystem] Cannot terminate main agent ${agentId}, use closeAgent instead`);
      return;
    }

    // 释放并发槽位
    if (this.activeSpawnCount > 0) {
      this.activeSpawnCount--;
    }

    // 从父智能体的子列表中移除
    if (agent.config.parentId) {
      const parent = this.agents.get(agent.config.parentId);
      if (parent) {
        parent.childAgents.delete(agentId);
      }
    }

    // 终止所有子分身
    for (const childId of agent.childAgents) {
      this.terminateAgent(childId);
    }

    // 取消消息订阅
    this.messageBus.offMessage(agentId);

    // 移除
    this.agents.delete(agentId);

    this.emit('agent:terminated', {
      agentId,
      parentId: agent.config.parentId
    });
  }

  /**
   * 获取当前并发状态
   */
  getConcurrencyStatus(): { active: number; max: number; available: number } {
    return {
      active: this.activeSpawnCount,
      max: this.maxThreads,
      available: Math.max(0, this.maxThreads - this.activeSpawnCount),
    };
  }

  /**
   * 销毁所有
   */
  destroy(): void {
    if (this.mainAgentId) {
      this.closeAgent(this.mainAgentId);
    }
    this.agents.clear();
    this.mainAgentId = null;
    this.messageBus.clearHistory();
    this.removeAllListeners();
  }

  // ==================== 工具方法 ====================

  /**
   * 获取主智能体 ID
   */
  getMainAgentId(): string | null {
    return this.mainAgentId;
  }

  /**
   * 获取消息总线（用于外部集成）
   */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  /**
   * 获取企业微信智能体（用于外部集成）
   */
  getWebotAgent(): WebotAgent | null {
    return this.webotAgent;
  }

  // ==================== 消息广播接口 ====================

  /**
   * 订阅消息广播（用于 3D 直播）
   */
  onMessageBroadcast(handler: (message: UnifiedMessage) => void): void {
    this.messageBus.onBroadcast(handler);
  }

  /**
   * 取消订阅消息广播
   */
  offMessageBroadcast(handler: (message: UnifiedMessage) => void): void {
    this.messageBus.off('broadcast', handler);
  }

  /**
   * 获取消息历史（用于 3D 直播历史显示）
   */
  getMessageHistory(limit: number = 100): UnifiedMessage[] {
    return this.messageBus.getHistory().slice(-limit);
  }

  /**
   * 获取智能体昵称
   */
  getNickname(agentId: string): string | undefined {
    const instance = this.agents.get(agentId);
    return instance?.config.nickname;
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ==================== 持久化方法 ====================

  /**
   * 加载持久化的智能体
   */
  private loadPersistedAgents(): void {
    try {
      // 使用 __dirname 获取当前文件所在目录，然后向上查找项目根目录
      // 编译后 JS 在 dist/agents/core/，需要向上 4 层才能到达项目根目录
      // 源码在 src/agents/core/，向上 3 层即可
      // 使用 process.cwd() 作为更可靠的项目根目录
      const projectRoot = process.cwd();
      const fullPath = path.join(projectRoot, this.persistencePath);

      console.log(`📂 [UnifiedAgentSystem] 尝试加载持久化智能体: ${fullPath}`);

      if (!fs.existsSync(fullPath)) {
        console.log(`📂 [UnifiedAgentSystem] 没有持久化文件，跳过加载`);
        return;  // 没有持久化文件，跳过
      }

      const data = fs.readFileSync(fullPath, 'utf-8');
      const persisted: PersistedAgentsData = JSON.parse(data);

      // 恢复智能体
      for (const config of persisted.agents) {
        const agentConfig: UnifiedAgentConfig = {
          ...config,
          createdAt: new Date(config.createdAt),
        };

        this.agents.set(config.id, {
          config: agentConfig,
          status: UnifiedAgentStatus.Idle,
          messages: [],
          childAgents: new Set(),
          sessionMessages: [],
        });

        // 订阅消息
        this.messageBus.onMessage(config.id, (msg) => this.handleIncomingMessage(config.id, msg));
        logger.info(`[UnifiedAgentSystem] 已加载并订阅 agent: ${config.id}`);
      }

      // 恢复主智能体 ID 和活跃智能体 ID
      this.mainAgentId = persisted.mainAgentId;
      this.activeAgentId = persisted.activeAgentId;

      console.log(`📂 [UnifiedAgentSystem] 已加载 ${persisted.agents.length} 个持久化智能体`);

    } catch (error) {
      console.warn(`[UnifiedAgentSystem] 加载持久化智能体失败: ${error}`);
    }
  }

  /**
   * 调度保存（防抖）
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveAgents();
    }, 1000);  // 1秒后保存
  }

  /**
   * 保存智能体到文件
   */
  private saveAgents(): void {
    try {
      // 转换为可序列化格式
      const agents: PersistedAgentConfig[] = [];

      for (const [id, instance] of this.agents) {
        // 只保存主智能体（不保存分身）
        if (instance.config.role === 'main') {
          agents.push({
            id: instance.config.id,
            type: instance.config.type,
            nickname: instance.config.nickname,
            role: instance.config.role,
            model: instance.config.model,
            maxDepth: instance.config.maxDepth,
            currentDepth: instance.config.currentDepth,
            parentId: instance.config.parentId,
            createdAt: instance.config.createdAt.toISOString(),
          });
        }
      }

      // 如果没有智能体，不保存空文件
      if (agents.length === 0) {
        console.log(`💾 [UnifiedAgentSystem] 没有智能体需要保存`);
        return;
      }

      const data: PersistedAgentsData = {
        version: '1.0',
        mainAgentId: this.mainAgentId,
        activeAgentId: this.activeAgentId,
        agents,
        updatedAt: new Date().toISOString(),
      };

      // 使用 __dirname 获取当前文件所在目录，然后向上查找项目根目录
      const projectRoot = path.resolve(__dirname, '..', '..', '..');
      const fullPath = path.join(projectRoot, this.persistencePath);
      const dir = path.dirname(fullPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`💾 [UnifiedAgentSystem] 已保存 ${agents.length} 个智能体配置到 ${fullPath}`);

    } catch (error) {
      console.error(`[UnifiedAgentSystem] 保存智能体失败: ${error}`);
    }
  }

  /**
   * 删除持久化的智能体
   */
  private deletePersistedAgent(agentId: string): void {
    this.scheduleSave();
  }
}

// 导出单例
export const unifiedAgentSystem = new UnifiedAgentSystem();