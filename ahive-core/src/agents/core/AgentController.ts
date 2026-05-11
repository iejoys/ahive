/**
 * AHIVECORE - 多智能体分身系统
 * 
 * 参考 Codex 的 multi_agents 设计，用 TypeScript 重写
 * 
 * 核心能力：
 * - spawn_agent: 生成子智能体执行并行任务
 * - wait_agent: 等待子智能体完成
 * - send_input: 向子智能体发送输入
 * - close_agent: 关闭智能体
 * 
 * 特点：
 * - 深度限制防止无限递归
 * - 配置继承与覆盖
 * - 状态监控
 */

import { EventEmitter } from 'events';

// 简单的 uuid 生成
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==================== 类型定义 ====================

/** 智能体状态 */
export enum AgentStatus {
  Idle = 'idle',
  Running = 'running',
  Waiting = 'waiting',
  Completed = 'completed',
  Error = 'error',
  Closed = 'closed',
}

/** 智能体配置 */
export interface AgentConfig {
  /** 智能体 ID */
  id: string;
  
  /** 昵称 */
  nickname?: string;
  
  /** 角色 */
  role?: string;
  
  /** 模型 */
  model?: string;
  
  /** 最大递归深度 */
  maxDepth: number;
  
  /** 当前深度 */
  currentDepth: number;
  
  /** 沙箱策略 */
  sandboxPolicy: SandboxPolicy;
  
  /** 审批策略 */
  approvalPolicy: ApprovalPolicy;
  
  /** 父智能体 ID */
  parentId?: string;
  
  /** 创建时间 */
  createdAt: Date;
  
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 沙箱策略 */
export interface SandboxPolicy {
  /** 沙箱模式 */
  mode: 'disabled' | 'read-only' | 'workspace-write' | 'full-access';
  
  /** 允许的路径 */
  allowedPaths?: string[];
  
  /** 禁止的路径 */
  deniedPaths?: string[];
  
  /** 网络访问 */
  networkAccess: boolean;
  
  /** 允许的域名 */
  allowedDomains?: string[];
}

/** 审批策略 */
export type ApprovalPolicy = 'never' | 'on-failure' | 'on-request' | 'unless-trusted';

/** 智能体消息 */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** 智能体执行结果 */
export interface AgentResult {
  /** 智能体 ID */
  agentId: string;
  
  /** 状态 */
  status: AgentStatus;
  
  /** 输出内容 */
  content?: string;
  
  /** 错误信息 */
  error?: string;
  
  /** 工具调用结果 */
  toolResults?: ToolResult[];
  
  /** 执行时间 (ms) */
  duration: number;
  
  /** Token 使用量 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** 工具结果 */
export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  success: boolean;
}

/** 生成智能体参数 */
export interface SpawnAgentOptions {
  /** 初始消息 */
  message?: string;
  
  /** 消息列表 */
  items?: AgentMessage[];
  
  /** 角色 */
  role?: string;
  
  /** 模型 */
  model?: string;
  
  /** 是否继承父智能体上下文 */
  forkContext?: boolean;
  
  /** 配置覆盖 */
  configOverrides?: Partial<AgentConfig>;
}

/** 智能体实例 */
interface AgentInstance {
  config: AgentConfig;
  status: AgentStatus;
  messages: AgentMessage[];
  result?: AgentResult;
  startTime?: Date;
  endTime?: Date;
  childAgents: Set<string>;
}

// ==================== 智能体控制器 ====================

/**
 * 智能体控制器
 * 
 * 管理多智能体分身的生命周期
 */
export class AgentController extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private mainAgentId: string | null = null;
  private defaultMaxDepth: number = 3;
  private defaultSandboxPolicy: SandboxPolicy = {
    mode: 'workspace-write',
    networkAccess: false,
  };
  private defaultApprovalPolicy: ApprovalPolicy = 'on-request';

  constructor() {
    super();
  }

  // ==================== 智能体生命周期 ====================

  /**
   * 创建主智能体
   */
  createMainAgent(config?: Partial<AgentConfig>): string {
    const id = uuidv4();
    const agentConfig: AgentConfig = {
      id,
      nickname: 'Main',
      role: 'default',
      maxDepth: this.defaultMaxDepth,
      currentDepth: 0,
      sandboxPolicy: config?.sandboxPolicy || { ...this.defaultSandboxPolicy },
      approvalPolicy: config?.approvalPolicy || this.defaultApprovalPolicy,
      createdAt: new Date(),
      ...config,
    };

    this.agents.set(id, {
      config: agentConfig,
      status: AgentStatus.Idle,
      messages: [],
      childAgents: new Set(),
    });

    this.mainAgentId = id;
    this.emit('agent:created', { agentId: id, isMain: true });
    
    return id;
  }

  /**
   * 生成子智能体
   */
  async spawnAgent(parentId: string, options: SpawnAgentOptions): Promise<string> {
    const parent = this.agents.get(parentId);
    if (!parent) {
      throw new Error(`Parent agent ${parentId} not found`);
    }

    // 检查深度限制
    const childDepth = parent.config.currentDepth + 1;
    if (childDepth >= parent.config.maxDepth) {
      throw new Error('Agent depth limit reached. Solve the task yourself.');
    }

    // 创建子智能体配置
    const id = uuidv4();
    const role = options.role || 'worker';
    const config: AgentConfig = {
      id,
      nickname: options.role ? `${role}-${id.slice(0, 4)}` : undefined,
      role,
      model: options.model || parent.config.model,
      maxDepth: parent.config.maxDepth,
      currentDepth: childDepth,
      sandboxPolicy: { ...parent.config.sandboxPolicy },
      approvalPolicy: parent.config.approvalPolicy,
      parentId,
      createdAt: new Date(),
      ...options.configOverrides,
    };

    // 创建实例
    const instance: AgentInstance = {
      config,
      status: AgentStatus.Idle,
      messages: options.items || (options.message ? [{ role: 'user', content: options.message }] : []),
      childAgents: new Set(),
    };

    // 继承父智能体上下文
    if (options.forkContext && parent.messages.length > 0) {
      instance.messages = [...parent.messages, ...instance.messages];
    }

    this.agents.set(id, instance);
    parent.childAgents.add(id);

    this.emit('agent:spawned', {
      parentAgentId: parentId,
      agentId: id,
      role,
      depth: childDepth,
    });

    return id;
  }

  /**
   * 关闭智能体
   */
  async closeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    // 先关闭所有子智能体
    for (const childId of agent.childAgents) {
      await this.closeAgent(childId);
    }

    agent.status = AgentStatus.Closed;
    agent.endTime = new Date();

    // 从父智能体中移除
    if (agent.config.parentId) {
      const parent = this.agents.get(agent.config.parentId);
      if (parent) {
        parent.childAgents.delete(agentId);
      }
    }

    this.emit('agent:closed', { agentId });
  }

  // ==================== 智能体交互 ====================

  /**
   * 向智能体发送输入
   */
  async sendInput(agentId: string, message: string | AgentMessage[]): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status === AgentStatus.Closed) {
      throw new Error(`Agent ${agentId} is closed`);
    }

    const messages = typeof message === 'string' 
      ? [{ role: 'user' as const, content: message }]
      : message;

    agent.messages.push(...messages);
    agent.status = AgentStatus.Running;

    this.emit('agent:input', { agentId, messages });
  }

  /**
   * 等待智能体完成
   */
  async waitAgent(agentId: string, timeout: number = 30000): Promise<AgentResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Agent ${agentId} wait timeout`));
      }, timeout);

      const onCompleted = (result: AgentResult) => {
        if (result.agentId === agentId) {
          cleanup();
          resolve(result);
        }
      };

      const onError = (data: { agentId: string; error: string }) => {
        if (data.agentId === agentId) {
          cleanup();
          reject(new Error(data.error));
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off('agent:completed', onCompleted);
        this.off('agent:error', onError);
      };

      this.on('agent:completed', onCompleted);
      this.on('agent:error', onError);

      // 如果已经完成，直接返回
      if (agent.status === AgentStatus.Completed) {
        cleanup();
        resolve(agent.result!);
      }
    });
  }

  /**
   * 等待多个智能体完成
   */
  async waitAgents(agentIds: string[], timeout: number = 60000): Promise<AgentResult[]> {
    const results = await Promise.all(
      agentIds.map(id => this.waitAgent(id, timeout))
    );
    return results;
  }

  // ==================== 状态管理 ====================

  /**
   * 获取智能体状态
   */
  getStatus(agentId: string): AgentStatus | undefined {
    return this.agents.get(agentId)?.status;
  }

  /**
   * 获取所有智能体状态
   */
  getAllStatus(): Map<string, { status: AgentStatus; role?: string; nickname?: string }> {
    const result = new Map();
    for (const [id, agent] of this.agents) {
      result.set(id, {
        status: agent.status,
        role: agent.config.role,
        nickname: agent.config.nickname,
      });
    }
    return result;
  }

  /**
   * 获取智能体配置
   */
  getConfig(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId)?.config;
  }

  /**
   * 获取子智能体列表
   */
  getChildAgents(agentId: string): string[] {
    const agent = this.agents.get(agentId);
    return agent ? Array.from(agent.childAgents) : [];
  }

  /**
   * 获取智能体消息历史
   */
  getMessages(agentId: string): AgentMessage[] {
    const agent = this.agents.get(agentId);
    return agent ? [...agent.messages] : [];
  }

  /**
   * 设置智能体结果
   */
  setResult(agentId: string, result: Partial<AgentResult>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.result = {
      agentId,
      status: result.status || AgentStatus.Completed,
      content: result.content,
      error: result.error,
      toolResults: result.toolResults,
      duration: result.duration || 0,
      usage: result.usage,
    };

    agent.status = agent.result.status;
    agent.endTime = new Date();

    if (agent.status === AgentStatus.Completed) {
      this.emit('agent:completed', agent.result);
    } else if (agent.status === AgentStatus.Error) {
      this.emit('agent:error', { agentId, error: agent.result.error });
    }
  }

  // ==================== 配置 ====================

  /**
   * 设置默认最大深度
   */
  setDefaultMaxDepth(depth: number): void {
    this.defaultMaxDepth = depth;
  }

  /**
   * 设置默认沙箱策略
   */
  setDefaultSandboxPolicy(policy: SandboxPolicy): void {
    this.defaultSandboxPolicy = policy;
  }

  // ==================== 工具方法 ====================

  /**
   * 获取主智能体 ID
   */
  getMainAgentId(): string | null {
    return this.mainAgentId;
  }

  /**
   * 获取活跃智能体数量
   */
  getActiveCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.status === AgentStatus.Running || agent.status === AgentStatus.Waiting) {
        count++;
      }
    }
    return count;
  }

  /**
   * 销毁所有智能体
   */
  destroy(): void {
    if (this.mainAgentId) {
      this.closeAgent(this.mainAgentId);
    }
    this.agents.clear();
    this.mainAgentId = null;
    this.removeAllListeners();
  }
}

// 导出单例
export const agentController = new AgentController();