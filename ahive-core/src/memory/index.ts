/**
 * Memory System - 从 OpenClaw 复用的记忆系统核心
 * 
 * 原路径：openclaw-main/src/memory/
 * 
 * 功能：
 * - 记忆存储与检索
 * - 语义搜索（向量数据库）
 * - 会话历史管理
 */

// ============ 核心接口 ============

/**
 * 记忆条目
 */
export interface Memory {
  /** 记忆 ID */
  id: string;
  /** 记忆内容 */
  content: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt?: Date;
  /** 元数据 */
  metadata?: Record<string, any>;
  /** 嵌入向量（可选） */
  embedding?: number[];
}

/**
 * 记忆类型
 */
export type MemoryType = 
  | 'fact'           // 事实
  | 'event'          // 事件
  | 'preference'     // 偏好
  | 'decision'       // 决策
  | 'lesson'         // 教训
  | 'context'        // 上下文
  | 'conversation';  // 对话

/**
 * 记忆查询
 */
export interface MemoryQuery {
  /** 搜索文本 */
  text?: string;
  /** 记忆类型过滤 */
  type?: MemoryType;
  /** 时间范围 */
  timeRange?: {
    from?: Date;
    to?: Date;
  };
  /** 元数据过滤 */
  metadata?: Record<string, any>;
  /** 返回数量限制 */
  limit?: number;
  /** 是否使用语义搜索 */
  semantic?: boolean;
}

/**
 * 记忆存储接口
 */
export interface MemoryStore {
  /** 添加记忆 */
  add: (memory: Memory) => Promise<void>;
  /** 获取记忆 */
  get: (id: string) => Promise<Memory | undefined>;
  /** 更新记忆 */
  update: (id: string, memory: Partial<Memory>) => Promise<void>;
  /** 删除记忆 */
  delete: (id: string) => Promise<void>;
  /** 查询记忆 */
  query: (query: MemoryQuery) => Promise<Memory[]>;
  /** 语义搜索 */
  semanticSearch: (text: string, limit?: number) => Promise<Memory[]>;
  /** 列出所有记忆 */
  list: (limit?: number) => Promise<Memory[]>;
}

/**
 * 会话记忆
 */
export interface SessionMemory {
  /** 会话 ID */
  sessionId: string;
  /** 会话消息 */
  messages: SessionMessage[];
  /** 会话元数据 */
  metadata?: Record<string, any>;
  /** 创建时间 */
  createdAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
}

/**
 * 会话消息
 */
export interface SessionMessage {
  /** 消息 ID */
  id: string;
  /** 角色 */
  role: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: Date;
  /** 工具调用（如果有） */
  toolCalls?: ToolCall[];
  /** 工具结果（如果有） */
  toolResults?: ToolResult[];
}

/**
 * 工具调用
 */
export interface ToolCall {
  /** 工具 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, any>;
}

/**
 * 工具结果
 */
export interface ToolResult {
  /** 工具 ID */
  toolCallId: string;
  /** 工具结果 */
  result: any;
  /** 错误信息 */
  error?: string;
}

// ============ 内存记忆存储（简化版） ============

/**
 * 内存记忆存储实现
 * 
 * 注：完整版本使用 LanceDB 向量数据库
 * 这里是简化版，用于验证和测试
 */
export class MemoryStoreImpl implements MemoryStore {
  private memories: Map<string, Memory> = new Map();
  private sessions: Map<string, SessionMemory> = new Map();

  /**
   * 添加记忆
   */
  async add(memory: Memory): Promise<void> {
    if (!memory.id) {
      memory.id = this.generateId();
    }
    memory.createdAt = memory.createdAt || new Date();
    this.memories.set(memory.id, memory);
  }

  /**
   * 获取记忆
   */
  async get(id: string): Promise<Memory | undefined> {
    return this.memories.get(id);
  }

  /**
   * 更新记忆
   */
  async update(id: string, memory: Partial<Memory>): Promise<void> {
    const existing = this.memories.get(id);
    if (!existing) {
      throw new Error(`Memory not found: ${id}`);
    }
    Object.assign(existing, memory, { updatedAt: new Date() });
  }

  /**
   * 删除记忆
   */
  async delete(id: string): Promise<void> {
    this.memories.delete(id);
  }

  /**
   * 查询记忆
   */
  async query(query: MemoryQuery): Promise<Memory[]> {
    let results = Array.from(this.memories.values());

    // 类型过滤
    if (query.type) {
      results = results.filter(m => m.type === query.type);
    }

    // 时间范围过滤
    if (query.timeRange) {
      if (query.timeRange.from) {
        results = results.filter(m => m.createdAt >= query.timeRange!.from!);
      }
      if (query.timeRange.to) {
        results = results.filter(m => m.createdAt <= query.timeRange!.to!);
      }
    }

    // 文本搜索（简单关键字匹配）
    if (query.text) {
      const searchText = query.text.toLowerCase();
      results = results.filter(m => 
        m.content.toLowerCase().includes(searchText)
      );
    }

    // 限制数量
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * 语义搜索（简化版 - 实际应使用向量相似度）
   */
  async semanticSearch(text: string, limit: number = 10): Promise<Memory[]> {
    // 简化实现：使用关键字匹配
    // 完整版本应使用 LanceDB 向量相似度搜索
    return this.query({ text, limit, semantic: true });
  }

  /**
   * 列出所有记忆
   */
  async list(limit: number = 100): Promise<Memory[]> {
    const results = Array.from(this.memories.values());
    return results.slice(0, limit);
  }

  /**
   * 创建会话
   */
  async createSession(sessionId: string): Promise<SessionMemory> {
    const session: SessionMemory = {
      sessionId,
      messages: [],
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<SessionMemory | undefined> {
    return this.sessions.get(sessionId);
  }

  /**
   * 添加会话消息
   */
  async addSessionMessage(
    sessionId: string, 
    message: SessionMessage
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.messages.push(message);
    session.lastActiveAt = new Date();
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============ 辅助函数 ============

/**
 * 创建记忆存储实例
 */
export function createMemoryStore(): MemoryStore {
  return new MemoryStoreImpl();
}

/**
 * 创建会话记忆
 */
export function createSessionMessage(
  role: 'user' | 'assistant' | 'system',
  content: string
): SessionMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role,
    content,
    timestamp: new Date(),
  };
}

// CODEX 两阶段记忆系统（新增）
export * from './codex-memory/index.js';

// CODEX 记忆集成
export * from './codex-integration.js';

// ============ 新核心模块：SQLite + Compaction ============

// 核心组件
export { MemoryDatabase } from './core/MemoryDatabase.js';
export { MemoryRouter } from './core/MemoryRouter.js';
export { MemoryManager } from './core/MemoryManager.js';
export { MemoryCompactor } from './core/MemoryCompactor.js';
export { createMemoryManager } from './core/index.js';

// 核心类型
export type {
  IsolationStrategy,
  AgentType as MemoryAgentType,
  MemorySpace,
  MemorySpaceRecord,
  Stage1OutputRecord,
  ThreadRecord,
  MemoryJobRecord,
  Stage1Output,
  RolloutItem,
  RolloutStats,
  CompactionConfig,
  PhaseConfig,
  CleanupConfig,
  MemorySystemConfig,
  LLMService as MemoryLLMService,
  MemoryEvent,
} from './core/types.js';

export { DEFAULT_MEMORY_CONFIG } from './core/types.js';

// 工具函数
export {
  approxTokenCount,
  truncateWithTokenBudget,
  truncateWithByteBudget,
  getRolloutsDir,
  getRolloutFilePath,
  daysToMs,
} from './core/utils.js';

// 默认导出
export default {
  MemoryStoreImpl,
  createMemoryStore,
  createSessionMessage,
};
