/**
 * 请求上下文模块
 * 提供请求级别的上下文管理
 */

import type { AgentExecutor } from '../executor/interface.js';

/**
 * 请求上下文接口
 */
export interface RequestContext {
  /** 请求 ID */
  requestId: string;
  /** 请求时间戳 */
  timestamp: number;
  /** 执行器实例 */
  executor: AgentExecutor;
  /** 用户 ID（可选） */
  userId?: string;
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 上下文管理器
 * 管理请求级别的上下文
 */
export class ContextManager {
  private contexts: Map<string, RequestContext> = new Map();
  private executor: AgentExecutor;

  constructor(executor: AgentExecutor) {
    this.executor = executor;
  }

  /**
   * 创建新的请求上下文
   */
  createContext(options: {
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  } = {}): RequestContext {
    const requestId = this.generateRequestId();
    const context: RequestContext = {
      requestId,
      timestamp: Date.now(),
      executor: this.executor,
      userId: options.userId,
      sessionId: options.sessionId,
      metadata: options.metadata,
    };

    this.contexts.set(requestId, context);
    return context;
  }

  /**
   * 获取请求上下文
   */
  getContext(requestId: string): RequestContext | undefined {
    return this.contexts.get(requestId);
  }

  /**
   * 删除请求上下文
   */
  deleteContext(requestId: string): boolean {
    return this.contexts.delete(requestId);
  }

  /**
   * 清理过期的上下文
   * @param maxAge 最大存活时间（毫秒）
   */
  cleanup(maxAge: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [requestId, context] of this.contexts.entries()) {
      if (now - context.timestamp > maxAge) {
        this.contexts.delete(requestId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 获取当前活跃的上下文数量
   */
  get size(): number {
    return this.contexts.size;
  }
}

/**
 * 创建上下文管理器
 */
export function createContextManager(executor: AgentExecutor): ContextManager {
  return new ContextManager(executor);
}