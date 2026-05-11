/**
 * SSE 到 WebSocket 桥接器
 * 将 AHIVECORE 的 SSE 流式事件转换为 WebSocket 事件
 */

import { EventEmitter } from 'events';
import { AHIVECoreConfig, defaultConfig } from './config';
import {
  StreamEvent,
  ThinkingEvent,
  ActionEvent,
  StatusEvent,
  ResultEvent,
  ErrorEvent,
  WorkflowEvent,
  AHIVECoreEvent,
} from './types';
import { WebSocketServer } from './WebSocketServer';

export class SSEBridge extends EventEmitter {
  private config: AHIVECoreConfig;
  private wsServer: WebSocketServer;
  private activeStreams: Map<string, AbortController> = new Map();
  private agentStates: Map<string, string> = new Map(); // agentId -> state

  constructor(wsServer: WebSocketServer, config?: Partial<AHIVECoreConfig>) {
    super();
    this.wsServer = wsServer;
    this.config = { ...defaultConfig, ...config };
    
    // 防止未处理的错误导致进程崩溃
    this.on('error', (error) => {
      console.error('[SSEBridge] Error event (handled):', error);
    });
  }

  /**
   * 启动 SSE 流式对话
   */
  async startStream(agentId: string, message: string, sessionId?: string): Promise<void> {
    console.log(`[SSEBridge] Starting stream for agent ${agentId}`);

    // 如果已有活跃流，先中断
    if (this.activeStreams.has(agentId)) {
      await this.stopStream(agentId);
    }

    const abortController = new AbortController();
    this.activeStreams.set(agentId, abortController);

    // 更新状态
    this.agentStates.set(agentId, 'thinking');
    this.broadcastStatus(agentId, 'thinking', 'Starting conversation');

    try {
      const url = new URL(`${this.config.endpoint}/chat/stream`);
      url.searchParams.set('message', message);
      // 传递 agentId 给 AHIVECORE，让指定的智能体处理
      if (agentId) {
        url.searchParams.set('agentId', agentId);
      }
      if (sessionId) {
        url.searchParams.set('sessionId', sessionId);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: abortController.signal,
        headers: {
          Accept: 'text/event-stream',
        },
      });

      if (!response.ok) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // 处理 SSE 流
      await this.processSSEStream(agentId, response.body);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(`[SSEBridge] Stream aborted for agent ${agentId}`);
      } else {
        console.error(`[SSEBridge] Stream error for agent ${agentId}:`, error);
        this.broadcastError(agentId, 'STREAM_ERROR', error.message);
      }
    } finally {
      this.activeStreams.delete(agentId);
      this.agentStates.delete(agentId);
    }
  }

  /**
   * 处理 SSE 流
   */
  private async processSSEStream(agentId: string, body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log(`[SSEBridge] Stream completed for agent ${agentId}`);
          this.broadcastStatus(agentId, 'idle', 'Stream completed');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // 解析 SSE 事件
        const events = this.parseSSEEvents(buffer);
        buffer = events.remaining;

        // 处理每个事件
        for (const event of events.parsed) {
          console.log(`[SSEBridge] Parsed event:`, event.type, event.content?.substring?.(0, 30) || event.delta?.substring?.(0, 30) || '');
          this.handleAHIVECoreEvent(agentId, event);
        }
      }
    } catch (error) {
      console.error(`[SSEBridge] Error reading stream for agent ${agentId}:`, error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 解析 SSE 事件
   */
  private parseSSEEvents(buffer: string): { parsed: AHIVECoreEvent[]; remaining: string } {
    const events: AHIVECoreEvent[] = [];
    const lines = buffer.split('\n');
    let remaining = '';
    let currentEvent: Partial<AHIVECoreEvent> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === '') {
        // 空行表示事件结束
        if (currentEvent.type) {
          events.push(currentEvent as AHIVECoreEvent);
        }
        currentEvent = {};
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          currentEvent = { ...currentEvent, ...parsed };
        } catch {
          // 如果不是 JSON，作为普通文本处理
          if (!currentEvent.message) {
            currentEvent.message = data;
          }
        }
      } else if (line.startsWith('event: ')) {
        currentEvent.type = line.slice(7);
      } else if (i === lines.length - 1) {
        // 最后一行可能不完整
        remaining = line;
      }
    }

    return { parsed: events, remaining };
  }

  /**
   * 处理 AHIVECORE 事件并转换为 WebSocket 事件
   */
  private handleAHIVECoreEvent(agentId: string, event: AHIVECoreEvent): void {
    console.log(`[SSEBridge] Event for ${agentId}:`, event.type);

    switch (event.type) {
      // 流式文本事件 (转换后的 StreamEvent)
      case 'text_delta':
        this.handleStreamTextDelta(agentId, event);
        break;

      // AhiveCoder 原始流式文本事件
      case 'agent_message_delta':
        this.handleTextDeltaEvent(agentId, event);
        break;

      // 思考/内容事件
      case 'thinking':
      case 'assistant':
      case 'content':
        this.handleThinkingEvent(agentId, event);
        break;

      // 工具事件
      case 'tool_start':
      case 'tool_call':
        this.handleToolStartEvent(agentId, event);
        break;

      case 'tool_result':
      case 'tool_output':
        this.handleToolResultEvent(agentId, event);
        break;

      // 状态事件
      case 'status':
        this.handleStatusEvent(agentId, event);
        break;

      // 完成事件
      case 'result':
      case 'complete':
      case 'done':
        this.handleResultEvent(agentId, event);
        break;

      // 错误事件
      case 'error':
        this.handleErrorEvent(agentId, event);
        break;

      // 智能体间对话事件
      case 'agent_chat':
        this.handleAgentChatEvent(agentId, event);
        break;

      default:
        // 未知事件类型，作为通用状态事件广播
        console.log(`[SSEBridge] Unknown event type: ${event.type}, data:`, event);
        this.broadcastStatus(agentId, 'working', event.message || event.delta || JSON.stringify(event));
    }
  }

  /**
   * 处理文本增量事件 (AhiveCoder 发送)
   */
  private handleTextDeltaEvent(agentId: string, event: any): void {
    console.log(`[SSEBridge] Broadcasting text-delta: ${event.delta?.substring(0, 30)}...`);
    
    // 发送 text-delta 事件（前端 wsManager 订阅的是 'text-delta'）
    const textEvent = {
      type: 'text-delta',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        delta: event.delta || '',
        content: event.delta || '',  // 兼容旧逻辑
        itemId: event.itemId,
      },
    };

    this.wsServer.broadcastEvent(textEvent);
    this.emit('text-delta', textEvent);
  }

  /**
   * 处理流式文本增量事件 (转换后的 StreamEvent)
   */
  private handleStreamTextDelta(agentId: string, event: any): void {
    console.log(`[SSEBridge] Broadcasting text_delta: ${event.delta?.substring(0, 30)}...`);
    
    // 发送 text-delta 事件（前端 wsManager 订阅的是 'text-delta'）
    const textEvent = {
      type: 'text-delta',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        delta: event.delta || '',
        content: event.delta || '',  // 兼容旧逻辑
        itemId: event.itemId,
      },
    };

    this.wsServer.broadcastEvent(textEvent);
    this.emit('text-delta', textEvent);
  }

  /**
   * 处理思考事件
   */
  private handleThinkingEvent(agentId: string, event: AHIVECoreEvent): void {
    const thinkingEvent: ThinkingEvent = {
      type: 'thinking',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        content: event.delta || event.content || event.message || '',
        phase: this.determineThinkingPhase(event),
        progress: undefined,
      },
    };

    console.log(`[SSEBridge] Broadcasting thinking event for ${agentId}:`, thinkingEvent.data.content?.substring(0, 50));
    this.wsServer.broadcastEvent(thinkingEvent);
    this.emit('thinking', thinkingEvent);
  }

/**
    * 处理工具开始事件
    */
  private handleToolStartEvent(agentId: string, event: AHIVECoreEvent): void {
    const actionEvent: ActionEvent = {
      type: 'action',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        tool: event.tool || event.toolName || event.command || 'unknown',
        params: event.args || event.params || {},
        status: 'start',
        progress: 0,
      },
    };

    this.wsServer.broadcastEvent(actionEvent);
    this.emit('action', actionEvent);
  }

  /**
    * 处理工具结果事件
    */
  private handleToolResultEvent(agentId: string, event: AHIVECoreEvent): void {
    const actionEvent: ActionEvent = {
      type: 'action',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        tool: event.tool || event.toolName || event.command || 'unknown',
        params: event.args || event.params || {},
        status: event.success === false ? 'error' : 'complete',
        output: event.output || event.message,
        duration: undefined,
      },
    };

    this.wsServer.broadcastEvent(actionEvent);
    this.emit('action', actionEvent);
  }

  /**
   * 处理状态事件
   */
  private handleStatusEvent(agentId: string, event: AHIVECoreEvent): void {
    const statusEvent: StatusEvent = {
      type: 'status',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        state: this.mapStatusState(event.message || ''),
        task: event.message,
        progress: undefined,
        metrics: event.toolCallsExecuted ? {
          tokens: 0,
          duration: 0,
          actions: event.toolCallsExecuted,
        } : undefined,
      },
    };

    this.agentStates.set(agentId, statusEvent.data.state);
    this.wsServer.broadcastEvent(statusEvent);
    this.emit('status', statusEvent);
  }

  /**
   * 处理结果事件
   */
  private handleResultEvent(agentId: string, event: AHIVECoreEvent): void {
    console.log(`[SSEBridge] Broadcasting done event for ${agentId}`);
    
    // 发送 done 事件（前端订阅的是 'done'）
    const doneEvent = {
      type: 'done',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        content: event.content || event.message || '',
        toolCallsExecuted: event.toolCallsExecuted || 0,
        iterations: event.iterations || 0,
      },
    };

    this.wsServer.broadcastEvent(doneEvent);
    this.emit('done', doneEvent);
  }

  /**
   * 处理错误事件
   */
  private handleErrorEvent(agentId: string, event: AHIVECoreEvent): void {
    const errorEvent: ErrorEvent = {
      type: 'error',
      agentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        code: 'AHIVECORE_ERROR',
        message: event.message || 'Unknown error',
        details: event,
        recoverable: true,
      },
    };

    this.wsServer.broadcastEvent(errorEvent);
    this.emit('error', errorEvent);
  }

  /**
   * 处理智能体间对话事件
   */
  private handleAgentChatEvent(agentId: string, event: any): void {
    console.log(`[SSEBridge] Agent chat: ${event.fromAgentName || event.fromAgentId} → ${event.toAgentName || event.toAgentId}`);
    
    const agentChatEvent = {
      type: 'agent-chat',
      agentId: event.fromAgentId,
      agentName: event.fromAgentName || event.fromAgentId,
      timestamp: event.timestamp || Date.now(),
      data: {
        toAgentId: event.toAgentId,
        toAgentName: event.toAgentName || event.toAgentId,
        message: event.message,
        messageType: event.messageType,
      },
    };

    this.wsServer.broadcastEvent(agentChatEvent);
    this.emit('agent-chat', agentChatEvent);
  }

  /**
   * 广播状态事件
   */
  private broadcastStatus(agentId: string, state: StatusEvent['data']['state'], task?: string): void {
    const statusEvent: StatusEvent = {
      type: 'status',
      agentId,
      timestamp: Date.now(),
      data: {
        state,
        task,
        progress: undefined,
      },
    };

    this.wsServer.broadcastEvent(statusEvent);
  }

  /**
   * 广播错误事件
   */
  private broadcastError(agentId: string, code: string, message: string): void {
    const errorEvent: ErrorEvent = {
      type: 'error',
      agentId,
      timestamp: Date.now(),
      data: {
        code,
        message,
        recoverable: true,
      },
    };

    this.wsServer.broadcastEvent(errorEvent);
  }

  /**
   * 确定思考阶段
   */
  private determineThinkingPhase(event: AHIVECoreEvent): ThinkingEvent['data']['phase'] {
    const content = (event.delta || event.content || event.message || '').toLowerCase();
    
    if (content.includes('analyzing') || content.includes('分析')) {
      return 'analyzing';
    } else if (content.includes('planning') || content.includes('规划')) {
      return 'planning';
    } else if (content.includes('executing') || content.includes('执行')) {
      return 'executing';
    } else if (content.includes('reflecting') || content.includes('反思')) {
      return 'reflecting';
    }
    
    return 'analyzing';
  }

  /**
   * 映射状态
   */
  private mapStatusState(message: string): StatusEvent['data']['state'] {
    const lower = message.toLowerCase();
    
    if (lower.includes('idle') || lower.includes('空闲')) {
      return 'idle';
    } else if (lower.includes('thinking') || lower.includes('思考')) {
      return 'thinking';
    } else if (lower.includes('working') || lower.includes('工作')) {
      return 'working';
    } else if (lower.includes('waiting') || lower.includes('等待')) {
      return 'waiting';
    } else if (lower.includes('error') || lower.includes('错误')) {
      return 'error';
    }
    
    return 'working';
  }

  /**
   * 停止流
   */
  async stopStream(agentId: string): Promise<void> {
    const abortController = this.activeStreams.get(agentId);
    if (abortController) {
      console.log(`[SSEBridge] Stopping stream for agent ${agentId}`);
      abortController.abort();
      this.activeStreams.delete(agentId);
    }
  }

  /**
   * 发送用户输入
   */
  async sendUserInput(agentId: string, input: string): Promise<void> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/user-input`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId,
          input,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send user input: ${response.status}`);
      }

      console.log(`[SSEBridge] User input sent for agent ${agentId}`);
    } catch (error) {
      console.error(`[SSEBridge] Failed to send user input for agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * 中断对话
   * 注意：不主动中断 SSE 流，让 AHIVECORE 优雅停止并发送 done 事件
   */
  async interrupt(agentId: string): Promise<void> {
    try {
      // 发送中断请求到 AHIVECORE
      const response = await fetch(`${this.config.endpoint}/api/interrupt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentId }),
      });

      if (!response.ok) {
        // 如果中断请求失败，才强制停止 SSE 流
        console.warn(`[SSEBridge] Interrupt request failed, forcing stream stop for ${agentId}`);
        await this.stopStream(agentId);
        throw new Error(`Failed to interrupt: ${response.status}`);
      }

      console.log(`[SSEBridge] Interrupt signal sent to agent ${agentId}`);
      // 不主动中断 SSE 流，等待 AHIVECORE 发送 done 事件
      // SSE 流会在收到 done 事件后自然结束
    } catch (error) {
      console.error(`[SSEBridge] Failed to interrupt agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * 获取活跃流数量
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * 获取智能体状态
   */
  getAgentState(agentId: string): string | undefined {
    return this.agentStates.get(agentId);
  }

  /**
   * 停止所有流
   */
  async stopAll(): Promise<void> {
    console.log('[SSEBridge] Stopping all streams...');
    
    const agentIds = Array.from(this.activeStreams.keys());
    await Promise.all(agentIds.map((agentId) => this.stopStream(agentId)));
    
    this.agentStates.clear();
  }
}

// 单例实例
let bridgeInstance: SSEBridge | null = null;

export function getSSEBridge(wsServer: WebSocketServer, config?: Partial<AHIVECoreConfig>): SSEBridge {
  if (!bridgeInstance) {
    bridgeInstance = new SSEBridge(wsServer, config);
  }
  return bridgeInstance;
}