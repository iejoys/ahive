/**
 * 标准 A2A 协议客户端
 * 实现标准 A2A 协议 (https://a2a-protocol.org/)
 * 
 * 支持的 Agent 类型：
 * - OpenCode
 * - 其他标准 A2A 实现
 */

import log from 'electron-log';
import type { A2AAgentConfig, A2AAgentCard, A2ATaskStatus, A2AArtifact } from '../../storage';
import { BaseA2AClient } from './BaseA2AClient';
import type { StreamCallback, A2AStreamEvent, TaskStatusUpdate, TaskArtifactUpdate, TextDelta } from './IA2AClient';

/**
 * JSON-RPC 请求
 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}

/**
 * JSON-RPC 响应
 */
interface JSONRPCResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * A2A 消息
 */
interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
}

/**
 * A2A 消息部分
 */
interface A2APart {
  type: 'text' | 'image' | 'file';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * A2A 任务
 */
interface A2ATask {
  id: string;
  status: {
    state: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
    message?: A2AMessage;
  };
  artifacts?: A2AArtifact[];
}

/**
 * 标准 A2A 协议客户端
 */
export class A2AStandardClient extends BaseA2AClient {
  readonly protocolType = 'a2a-standard';

  async initialize(): Promise<A2AAgentCard | null> {
    this.agentCard = await this.fetchAgentCard();
    if (this.agentCard) {
      log.info(`[A2AStandard] Connected to agent: ${this.agentCard.name}`);
    }
    return this.agentCard;
  }

  async sendTaskSync(task: string, timeout = 300000): Promise<A2ATaskStatus> {
    if (!this.agentCard) {
      throw new Error('Agent not initialized');
    }

    const taskId = this.generateTaskId();
    const rpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: taskId,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: task }]
        }
      }
    };

    const response = await this.sendRequest<JSONRPCResponse<A2ATask>>(
      this.config.endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcRequest)
      },
      timeout
    );

    if (response.error) {
      throw new Error(response.error.message);
    }

    // 同步模式：轮询直到完成
    return this.pollUntilComplete(response.result?.id || taskId, timeout);
  }

  async sendTaskAsync(task: string, webhookUrl?: string): Promise<string> {
    if (!this.agentCard) {
      throw new Error('Agent not initialized');
    }

    const taskId = this.generateTaskId();
    const rpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: taskId,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: task }]
        },
        pushNotification: webhookUrl ? { url: webhookUrl } : undefined
      }
    };

    const response = await this.sendRequest<JSONRPCResponse<{ taskId: string }>>(
      this.config.endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcRequest)
      }
    );

    if (response.error) {
      throw new Error(response.error.message);
    }

    const resultTaskId = response.result?.taskId || taskId;
    this.updateTaskStatus(resultTaskId, { status: 'submitted' });

    return resultTaskId;
  }

  async sendTaskStream(
    task: string, 
    onEvent: StreamCallback, 
    signal?: AbortSignal
  ): Promise<A2ATaskStatus> {
    if (!this.agentCard) {
      throw new Error('Agent not initialized');
    }

    const taskId = this.generateTaskId();
    const rpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: taskId,
      method: 'message/stream',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: task }]
        }
      }
    };

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpcRequest),
      signal
    });

    if (!response.ok) {
      throw new Error(`Stream request failed: ${response.statusText}`);
    }

    let finalStatus: A2ATaskStatus = { id: taskId, status: 'working' };

    await this.parseSSEStream(
      response,
      onEvent,
      (data) => this.transformSSEEvent(taskId, data),
      signal
    );

    // 获取最终状态
    finalStatus = this.tasks.get(taskId) || finalStatus;
    return finalStatus;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const rpcRequest: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: this.generateTaskId(),
        method: 'tasks/cancel',
        params: { taskId }
      };

      const response = await this.sendRequest<JSONRPCResponse>(
        this.config.endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rpcRequest)
        }
      );

      return !response.error;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // 尝试获取 Agent Card 作为健康检查
      const card = await this.fetchAgentCard();
      return !!card;
    } catch {
      return false;
    }
  }

  /**
   * 获取 Agent Card
   */
  private async fetchAgentCard(): Promise<A2AAgentCard | null> {
    const cardPaths = [
      '/.well-known/a2a/agent-card',
      '/.well-known/agent.json',
      '/agentCard'
    ];

    for (const path of cardPaths) {
      try {
        const url = `${this.config.endpoint}${path}`;
        const response = await fetch(url);
        
        if (response.ok) {
          const card = await response.json();
          log.info(`[A2AStandard] Fetched agent card from ${path}`);
          return this.normalizeAgentCard(card);
        }
      } catch (err) {
        log.debug(`[A2AStandard] Failed to fetch from ${path}:`, err);
      }
    }

    return null;
  }

  /**
   * 标准化 Agent Card
   */
  private normalizeAgentCard(card: Record<string, unknown>): A2AAgentCard {
    return {
      agentId: card.agentId as string || card.id as string || this.config.agentId,
      name: card.name as string || 'Unknown Agent',
      description: card.description as string || '',
      url: card.url as string || this.config.endpoint,
      capabilities: (card.capabilities as Array<{ name: string; description?: string }>) || [],
      version: card.version as string || '1.0.0'
    };
  }

  /**
   * 转换 SSE 事件
   */
  private transformSSEEvent(taskId: string, data: string): A2AStreamEvent | null {
    try {
      const response = JSON.parse(data) as JSONRPCResponse;
      
      if (response.error) {
        return {
          type: 'error',
          data: {
            code: String(response.error.code),
            message: response.error.message,
            details: response.error.data
          }
        };
      }

      const result = response.result as Record<string, unknown>;
      
      // 检查是否是状态更新
      if (result.status && typeof result.status === 'object') {
        const statusObj = result.status as Record<string, unknown>;
        const statusUpdate: TaskStatusUpdate = {
          taskId: (result.id as string) || taskId,
          status: statusObj.state as TaskStatusUpdate['status'],
          message: statusObj.message ? {
            role: 'agent',
            content: this.extractTextFromMessage(statusObj.message as A2AMessage)
          } : undefined
        };

        this.updateTaskStatus(statusUpdate.taskId, {
          status: statusUpdate.status,
          message: statusUpdate.message
        });

        return { type: 'status_update', data: statusUpdate };
      }

      // 检查是否是产物更新
      if (result.artifact) {
        const artifactUpdate: TaskArtifactUpdate = {
          taskId: (result.taskId as string) || taskId,
          artifact: result.artifact as A2AArtifact,
          append: result.append as boolean,
          lastChunk: result.lastChunk as boolean
        };

        return { type: 'artifact_update', data: artifactUpdate };
      }

      // 检查是否是文本增量
      if (result.delta || result.text) {
        const delta: TextDelta = {
          taskId: taskId,
          text: (result.delta as string) || (result.text as string) || ''
        };

        return { type: 'delta', data: delta };
      }

      return null;
    } catch (err) {
      log.debug('[A2AStandard] Failed to transform SSE event:', err);
      return null;
    }
  }

  /**
   * 从消息中提取文本
   */
  private extractTextFromMessage(message: A2AMessage): string {
    if (!message.parts) return '';
    return message.parts
      .filter(part => part.type === 'text' && part.text)
      .map(part => part.text)
      .join('\n');
  }

  /**
   * 轮询直到完成
   */
  private async pollUntilComplete(taskId: string, timeout: number): Promise<A2ATaskStatus> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeout) {
      try {
        const rpcRequest: JSONRPCRequest = {
          jsonrpc: '2.0',
          id: this.generateTaskId(),
          method: 'tasks/get',
          params: { taskId }
        };

        const response = await this.sendRequest<JSONRPCResponse<A2ATask>>(
          this.config.endpoint,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rpcRequest)
          }
        );

        if (response.result) {
          const task = response.result;
          const status: TaskStatusUpdate['status'] = task.status.state as TaskStatusUpdate['status'];
          
          if (['completed', 'failed', 'canceled'].includes(status)) {
            const finalStatus: A2ATaskStatus = {
              id: taskId,
              status,
              message: task.status.message ? {
                role: 'agent',
                content: this.extractTextFromMessage(task.status.message)
              } : undefined
            };
            this.updateTaskStatus(taskId, finalStatus);
            return finalStatus;
          }
        }
      } catch (err) {
        log.debug('[A2AStandard] Poll error:', err);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return {
      id: taskId,
      status: 'failed',
      error: 'Timeout waiting for task completion'
    };
  }
}