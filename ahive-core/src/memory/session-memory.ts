/**
 * AHIVECORE 会话记忆管理
 * 
 * 功能：
 * - 短期记忆：最近 N 轮对话历史
 * - 不做语义缓存，避免智商下降
 * - 简单高效，无外部依赖
 */

// ============ 类型定义 ============

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface SessionConfig {
  /** 最大保留轮数（用户+助手算一轮） */
  maxTurns: number;
  /** 是否启用 */
  enabled: boolean;
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: SessionConfig = {
  maxTurns: 10,  // 最近 10 轮 = 20 条消息
  enabled: true,
};

// ============ 会话管理器 ============

/**
 * 会话记忆管理器
 * 
 * 特点：
 * - 纯内存，无持久化
 * - 简单数组，无语义匹配
 * - FIFO 淘汰，保留最近 N 轮
 */
export class SessionMemory {
  private sessions: Map<string, ChatMessage[]> = new Map();
  private config: SessionConfig;

  constructor(config?: Partial<SessionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 添加用户消息
   */
  addUserMessage(sessionId: string, content: string): void {
    if (!this.config.enabled) return;
    
    this.addMessage(sessionId, {
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(sessionId: string, content: string): void {
    if (!this.config.enabled) return;
    
    this.addMessage(sessionId, {
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * 获取会话历史
   * 返回最近 N 轮的消息数组，可直接传给 LLM
   */
  getHistory(sessionId: string): ChatMessage[] {
    if (!this.config.enabled) return [];
    
    const messages = this.sessions.get(sessionId) || [];
    return [...messages];  // 返回副本，避免外部修改
  }

  /**
   * 清空会话历史
   */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * 清空所有会话
   */
  clearAll(): void {
    this.sessions.clear();
  }

  /**
   * 获取会话统计
   */
  getStats(sessionId: string): {
    messageCount: number;
    turnCount: number;
    oldestMessage?: Date;
    newestMessage?: Date;
  } {
    const messages = this.sessions.get(sessionId) || [];
    
    return {
      messageCount: messages.length,
      turnCount: Math.floor(messages.length / 2),
      oldestMessage: messages[0] ? new Date(messages[0].timestamp) : undefined,
      newestMessage: messages.length > 0 
        ? new Date(messages[messages.length - 1].timestamp) 
        : undefined,
    };
  }

  // ============ 私有方法 ============

  private addMessage(sessionId: string, message: ChatMessage): void {
    let messages = this.sessions.get(sessionId) || [];
    
    // 添加新消息
    messages.push(message);
    
    // 限制历史长度（保留最近 N 轮 = N * 2 条消息）
    const maxMessages = this.config.maxTurns * 2;
    if (messages.length > maxMessages) {
      messages = messages.slice(-maxMessages);
    }
    
    this.sessions.set(sessionId, messages);
  }
}

// ============ 全局实例 ============

let globalSessionMemory: SessionMemory | null = null;

/**
 * 获取全局会话记忆实例
 */
export function getSessionMemory(config?: Partial<SessionConfig>): SessionMemory {
  if (!globalSessionMemory) {
    globalSessionMemory = new SessionMemory(config);
  }
  return globalSessionMemory;
}

/**
 * 创建新的会话记忆实例
 */
export function createSessionMemory(config?: Partial<SessionConfig>): SessionMemory {
  return new SessionMemory(config);
}