/**
 * AHIVECORE - 消息广播器
 * 
 * 拦截内部智能体通讯消息，广播到外部订阅者
 * 用于 3D 世界直播展示
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/index.js';

// ==================== 类型定义 ====================

/**
 * 广播消息数据结构
 */
export interface MessageBroadcastData {
  /** 消息唯一 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 发送方信息 */
  from: {
    id: string;
    type: 'ahive-worker' | 'ahive-coder';
    nickname?: string;
  };
  /** 接收方信息 */
  to: {
    id: string;
    type: 'ahive-worker' | 'ahive-coder';
    nickname?: string;
  } | null;  // null 表示广播
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type: 'task' | 'query' | 'response' | 'broadcast' | 'progress' | 'tool_call' | 'tool_result';
  /** 元数据 */
  metadata?: {
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    progress?: number;
    status?: string;
    [key: string]: unknown;
  };
}

/**
 * SSE 订阅者
 */
interface SSESubscriber {
  id: string;
  res: any;  // http.ServerResponse
  lastEventId: number;
  connectedAt: Date;
}

/**
 * 进度汇报数据
 */
export interface ProgressReport {
  agentId: string;
  agentType: 'ahive-worker' | 'ahive-coder';
  progress: number;  // 0-100
  status: string;
  currentTask?: string;
  timestamp: number;
}

/**
 * 工具调用数据
 */
export interface ToolCallBroadcast {
  agentId: string;
  agentType: 'ahive-worker' | 'ahive-coder';
  toolName: string;
  toolArgs: Record<string, unknown>;
  timestamp: number;
}

/**
 * 工具结果数据
 */
export interface ToolResultBroadcast {
  agentId: string;
  agentType: 'ahive-worker' | 'ahive-coder';
  toolName: string;
  result: string;
  success: boolean;
  timestamp: number;
}

// ==================== 消息广播器 ====================

/**
 * 消息广播器
 * 
 * 单例模式，管理所有 SSE 订阅者
 */
class MessageBroadcasterClass extends EventEmitter {
  private subscribers: Map<string, SSESubscriber> = new Map();
  private messageHistory: MessageBroadcastData[] = [];
  private maxHistory: number = 500;
  private eventCounter: number = 0;
  
  constructor() {
    super();
    logger.info('[MessageBroadcaster] 初始化消息广播器');
  }
  
  // ==================== 订阅管理 ====================
  
  /**
   * 添加 SSE 订阅者
   */
  addSubscriber(res: any): string {
    const id = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const subscriber: SSESubscriber = {
      id,
      res,
      lastEventId: 0,
      connectedAt: new Date(),
    };
    
    this.subscribers.set(id, subscriber);
    logger.info(`[MessageBroadcaster] 新订阅者: ${id}, 当前订阅者数: ${this.subscribers.size}`);
    
    // 发送连接成功消息
    this.sendToSubscriber(subscriber, {
      type: 'connected',
      subscriberId: id,
      message: '已连接到 AHIVECORE 消息广播',
    });
    
    // 发送最近的历史消息
    this.sendHistory(subscriber);
    
    return id;
  }
  
  /**
   * 移除订阅者
   */
  removeSubscriber(id: string): void {
    if (this.subscribers.has(id)) {
      this.subscribers.delete(id);
      logger.info(`[MessageBroadcaster] 订阅者断开: ${id}, 当前订阅者数: ${this.subscribers.size}`);
    }
  }
  
  /**
   * 获取订阅者数量
   */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }
  
  // ==================== 消息广播 ====================
  
  /**
   * 广播智能体消息
   */
  broadcastMessage(data: Omit<MessageBroadcastData, 'id' | 'timestamp'>): void {
    const message: MessageBroadcastData = {
      ...data,
      id: `msg_${++this.eventCounter}`,
      timestamp: Date.now(),
    };
    
    // 保存到历史
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
    
    // 广播给所有订阅者
    this.broadcast('message', message);
    
    logger.debug(`[MessageBroadcaster] 广播消息: ${message.id} from ${data.from.id.slice(0, 8)}...`);
  }
  
  /**
   * 广播进度汇报
   */
  broadcastProgress(data: ProgressReport): void {
    const message: MessageBroadcastData = {
      id: `prog_${++this.eventCounter}`,
      timestamp: Date.now(),
      from: {
        id: data.agentId,
        type: data.agentType,
      },
      to: null,
      content: data.status,
      type: 'progress',
      metadata: {
        progress: data.progress,
        status: data.status,
        currentTask: data.currentTask,
      },
    };
    
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
    
    this.broadcast('progress', message);
    logger.debug(`[MessageBroadcaster] 广播进度: ${data.agentId.slice(0, 8)}... ${data.progress}%`);
  }
  
  /**
   * 广播工具调用
   */
  broadcastToolCall(data: ToolCallBroadcast): void {
    const message: MessageBroadcastData = {
      id: `tool_${++this.eventCounter}`,
      timestamp: Date.now(),
      from: {
        id: data.agentId,
        type: data.agentType,
      },
      to: null,
      content: `调用工具: ${data.toolName}`,
      type: 'tool_call',
      metadata: {
        toolName: data.toolName,
        toolArgs: data.toolArgs,
      },
    };
    
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
    
    this.broadcast('tool_call', message);
    logger.debug(`[MessageBroadcaster] 广播工具调用: ${data.toolName}`);
  }
  
  /**
   * 广播工具结果
   */
  broadcastToolResult(data: ToolResultBroadcast): void {
    const message: MessageBroadcastData = {
      id: `result_${++this.eventCounter}`,
      timestamp: Date.now(),
      from: {
        id: data.agentId,
        type: data.agentType,
      },
      to: null,
      content: data.success ? `工具执行成功: ${data.toolName}` : `工具执行失败: ${data.toolName}`,
      type: 'tool_result',
      metadata: {
        toolName: data.toolName,
        toolResult: data.result.substring(0, 500),  // 限制长度
      },
    };
    
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
    
    this.broadcast('tool_result', message);
    logger.debug(`[MessageBroadcaster] 广播工具结果: ${data.toolName} ${data.success ? '成功' : '失败'}`);
  }
  
  // ==================== 内部方法 ====================
  
  /**
   * 广播给所有订阅者
   */
  private broadcast(eventType: string, data: any): void {
    const event = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    
    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.res.write(event);
        subscriber.lastEventId = this.eventCounter;
      } catch (error) {
        logger.warn(`[MessageBroadcaster] 发送失败，移除订阅者: ${subscriber.id}`);
        this.subscribers.delete(subscriber.id);
      }
    }
  }
  
  /**
   * 发送给单个订阅者
   */
  private sendToSubscriber(subscriber: SSESubscriber, data: any): void {
    try {
      const event = `event: system\ndata: ${JSON.stringify(data)}\n\n`;
      subscriber.res.write(event);
    } catch (error) {
      logger.warn(`[MessageBroadcaster] 发送失败: ${subscriber.id}`);
    }
  }
  
  /**
   * 发送历史消息
   */
  private sendHistory(subscriber: SSESubscriber): void {
    // 发送最近 50 条消息
    const recentMessages = this.messageHistory.slice(-50);
    
    for (const message of recentMessages) {
      try {
        const event = `event: history\ndata: ${JSON.stringify(message)}\n\n`;
        subscriber.res.write(event);
      } catch (error) {
        // 忽略错误，继续发送
      }
    }
  }
  
  /**
   * 获取历史消息
   */
  getHistory(limit: number = 100): MessageBroadcastData[] {
    return this.messageHistory.slice(-limit);
  }
  
  /**
   * 清空历史
   */
  clearHistory(): void {
    this.messageHistory = [];
    logger.info('[MessageBroadcaster] 历史消息已清空');
  }
}

// 导出单例
export const MessageBroadcaster = new MessageBroadcasterClass();

// ==================== 便捷函数 ====================

/**
 * 广播智能体消息（便捷函数）
 */
export function broadcastAgentMessage(
  fromId: string,
  fromType: 'ahive-worker' | 'ahive-coder',
  fromNickname: string | undefined,
  toId: string | null,
  toType: 'ahive-worker' | 'ahive-coder' | null,
  toNickname: string | undefined,
  content: string,
  type: MessageBroadcastData['type'] = 'task'
): void {
  MessageBroadcaster.broadcastMessage({
    from: {
      id: fromId,
      type: fromType,
      nickname: fromNickname,
    },
    to: toId ? {
      id: toId,
      type: toType as 'ahive-worker' | 'ahive-coder',
      nickname: toNickname,
    } : null,
    content,
    type,
  });
}

/**
 * 广播进度（便捷函数）
 */
export function broadcastProgress(
  agentId: string,
  agentType: 'ahive-worker' | 'ahive-coder',
  progress: number,
  status: string,
  currentTask?: string
): void {
  MessageBroadcaster.broadcastProgress({
    agentId,
    agentType,
    progress,
    status,
    currentTask,
    timestamp: Date.now(),
  });
}

/**
 * 广播工具调用（便捷函数）
 */
export function broadcastToolCall(
  agentId: string,
  agentType: 'ahive-worker' | 'ahive-coder',
  toolName: string,
  toolArgs: Record<string, unknown>
): void {
  MessageBroadcaster.broadcastToolCall({
    agentId,
    agentType,
    toolName,
    toolArgs,
    timestamp: Date.now(),
  });
}

/**
 * 广播工具结果（便捷函数）
 */
export function broadcastToolResult(
  agentId: string,
  agentType: 'ahive-worker' | 'ahive-coder',
  toolName: string,
  result: string,
  success: boolean
): void {
  MessageBroadcaster.broadcastToolResult({
    agentId,
    agentType,
    toolName,
    result,
    success,
    timestamp: Date.now(),
  });
}