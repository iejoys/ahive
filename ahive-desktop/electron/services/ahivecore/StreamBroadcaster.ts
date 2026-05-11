/**
 * 流式广播器
 * 
 * 收集所有智能体的流式事件，统一广播到 WebSocket
 * - A2A Agent 对话
 * - AHIVECORE 母体
 * - 工具调用
 * - 思考过程
 */

import { EventEmitter } from 'events';
import type { WebSocketServer } from '../services/ahivecore/WebSocketServer';

// 流式事件类型
export type StreamEventType = 
  | 'text-delta'      // 文本片段
  | 'text-done'       // 文本完成
  | 'thinking'        // 思考中
  | 'action'          // 工具调用
  | 'result'          // 最终结果
  | 'error'           // 错误
  | 'agent-chat'      // 智能体间对话
  | 'agent-status';   // 智能体状态变化

// 流式事件
export interface StreamEvent {
  type: StreamEventType;
  agentId: string;
  agentName?: string;
  timestamp: number;
  data?: any;
}

// 活跃流信息
interface ActiveStream {
  agentId: string;
  agentName: string;
  startTime: number;
  abortController?: AbortController;
}

export class StreamBroadcaster extends EventEmitter {
  private wsServer: WebSocketServer;
  private activeStreams: Map<string, ActiveStream> = new Map();
  private messageBuffer: Map<string, string> = new Map(); // agentId -> accumulated text

  constructor(wsServer: WebSocketServer) {
    super();
    this.wsServer = wsServer;
  }

  /**
   * 注册一个流式会话
   */
  registerStream(agentId: string, agentName: string, abortController?: AbortController): void {
    this.activeStreams.set(agentId, {
      agentId,
      agentName,
      startTime: Date.now(),
      abortController,
    });
    this.messageBuffer.set(agentId, '');
    
    // 广播状态变化
    this.broadcast({
      type: 'agent-status',
      agentId,
      agentName,
      timestamp: Date.now(),
      data: { status: 'streaming', message: '开始对话' },
    });

    console.log(`[StreamBroadcaster] Registered stream: ${agentId} (${agentName})`);
  }

  /**
   * 注销一个流式会话
   */
  unregisterStream(agentId: string): void {
    const stream = this.activeStreams.get(agentId);
    if (stream) {
      // 发送最终文本
      const finalText = this.messageBuffer.get(agentId) || '';
      if (finalText) {
        this.broadcast({
          type: 'text-done',
          agentId,
          agentName: stream.agentName,
          timestamp: Date.now(),
          data: { text: finalText },
        });
      }

      // 广播状态变化
      this.broadcast({
        type: 'agent-status',
        agentId,
        agentName: stream.agentName,
        timestamp: Date.now(),
        data: { status: 'idle', message: '对话结束' },
      });

      this.activeStreams.delete(agentId);
      this.messageBuffer.delete(agentId);
      console.log(`[StreamBroadcaster] Unregistered stream: ${agentId}`);
    }
  }

  /**
   * 发送文本片段
   */
  sendTextDelta(agentId: string, delta: string, agentName?: string): void {
    const stream = this.activeStreams.get(agentId);
    const name = agentName || stream?.agentName || agentId;

    // 累积文本
    const current = this.messageBuffer.get(agentId) || '';
    this.messageBuffer.set(agentId, current + delta);

    this.broadcast({
      type: 'text-delta',
      agentId,
      agentName: name,
      timestamp: Date.now(),
      data: { delta, accumulated: current + delta },
    });
  }

  /**
   * 发送思考事件
   */
  sendThinking(agentId: string, thinking: string, agentName?: string): void {
    const stream = this.activeStreams.get(agentId);
    const name = agentName || stream?.agentName || agentId;

    this.broadcast({
      type: 'thinking',
      agentId,
      agentName: name,
      timestamp: Date.now(),
      data: { thinking },
    });
  }

  /**
   * 发送工具调用事件
   */
  sendAction(agentId: string, action: { tool: string; input?: any }, agentName?: string): void {
    const stream = this.activeStreams.get(agentId);
    const name = agentName || stream?.agentName || agentId;

    this.broadcast({
      type: 'action',
      agentId,
      agentName: name,
      timestamp: Date.now(),
      data: action,
    });
  }

  /**
   * 发送最终结果
   */
  sendResult(agentId: string, result: any, agentName?: string): void {
    const stream = this.activeStreams.get(agentId);
    const name = agentName || stream?.agentName || agentId;

    this.broadcast({
      type: 'result',
      agentId,
      agentName: name,
      timestamp: Date.now(),
      data: result,
    });

    this.unregisterStream(agentId);
  }

  /**
   * 发送错误
   */
  sendError(agentId: string, error: string, agentName?: string): void {
    const stream = this.activeStreams.get(agentId);
    const name = agentName || stream?.agentName || agentId;

    this.broadcast({
      type: 'error',
      agentId,
      agentName: name,
      timestamp: Date.now(),
      data: { error },
    });

    this.unregisterStream(agentId);
  }

  /**
   * 发送智能体间对话
   */
  sendAgentChat(fromAgentId: string, toAgentId: string, message: string, fromAgentName?: string, toAgentName?: string): void {
    this.broadcast({
      type: 'agent-chat',
      agentId: fromAgentId,
      agentName: fromAgentName || fromAgentId,
      timestamp: Date.now(),
      data: {
        toAgentId,
        toAgentName: toAgentName || toAgentId,
        message,
      },
    });
  }

  /**
   * 广播到 WebSocket
   */
  private broadcast(event: StreamEvent): void {
    const message = {
      type: 'event',
      payload: event,
    };

    // 使用 WebSocketServer 的 broadcastAll 方法
    this.wsServer.broadcastAll(event);

    // 也触发事件给本地监听者
    this.emit('event', event);
  }

  /**
   * 获取活跃流数量
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * 获取所有活跃流
   */
  getActiveStreams(): ActiveStream[] {
    return Array.from(this.activeStreams.values());
  }

  /**
   * 中止指定智能体的流
   */
  abortStream(agentId: string): boolean {
    const stream = this.activeStreams.get(agentId);
    if (stream?.abortController) {
      stream.abortController.abort();
      this.unregisterStream(agentId);
      return true;
    }
    return false;
  }

  /**
   * 清理所有流
   */
  cleanup(): void {
    for (const [agentId, stream] of this.activeStreams) {
      if (stream.abortController) {
        stream.abortController.abort();
      }
    }
    this.activeStreams.clear();
    this.messageBuffer.clear();
    console.log('[StreamBroadcaster] Cleaned up all streams');
  }
}

// 单例
let streamBroadcasterInstance: StreamBroadcaster | null = null;

export function getStreamBroadcaster(wsServer: WebSocketServer): StreamBroadcaster {
  if (!streamBroadcasterInstance) {
    streamBroadcasterInstance = new StreamBroadcaster(wsServer);
  }
  return streamBroadcasterInstance;
}

export function getStreamBroadcasterInstance(): StreamBroadcaster | null {
  return streamBroadcasterInstance;
}