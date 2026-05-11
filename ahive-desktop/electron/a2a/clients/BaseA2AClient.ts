/**
 * A2A 客户端基类
 * 提供通用功能实现
 */

import log from 'electron-log';
import { randomUUID } from 'crypto';
import type { A2AAgentConfig, A2AAgentCard, A2ATaskStatus } from '../../storage';
import type { IA2AClient, StreamCallback, A2AStreamEvent } from './IA2AClient';

/**
 * A2A 客户端抽象基类
 */
export abstract class BaseA2AClient implements IA2AClient {
  abstract readonly protocolType: string;
  
  protected agentCard: A2AAgentCard | null = null;
  protected tasks: Map<string, A2ATaskStatus> = new Map();
  protected abortController: AbortController | null = null;

  constructor(protected config: A2AAgentConfig) {}

  abstract initialize(): Promise<A2AAgentCard | null>;
  abstract sendTaskSync(task: string, timeout?: number): Promise<A2ATaskStatus>;
  abstract sendTaskAsync(task: string, webhookUrl?: string): Promise<string>;
  abstract sendTaskStream(task: string, onEvent: StreamCallback, signal?: AbortSignal): Promise<A2ATaskStatus>;
  abstract cancelTask(taskId: string): Promise<boolean>;
  abstract healthCheck(): Promise<boolean>;

  getAgentCard(): A2AAgentCard | null {
    return this.agentCard;
  }

  async getTaskStatus(taskId: string): Promise<A2ATaskStatus | null> {
    return this.tasks.get(taskId) || null;
  }

  async cleanup(): Promise<void> {
    this.tasks.clear();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 发送 HTTP 请求
   */
  protected async sendRequest<T>(
    url: string, 
    options: RequestInit = {},
    timeout?: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * 解析 SSE 流
   */
  protected async parseSSEStream(
    response: Response,
    onEvent: StreamCallback,
    transformEvent: (data: string) => A2AStreamEvent | null,
    signal?: AbortSignal
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // 保留最后一个可能不完整的行
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = transformEvent(data);
              if (event) onEvent(event);
            } catch (err) {
              log.warn('[A2A] Failed to parse SSE event:', data, err);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 创建任务 ID
   */
  protected generateTaskId(): string {
    return randomUUID();
  }

  /**
   * 更新本地任务状态
   */
  protected updateTaskStatus(taskId: string, status: Partial<A2ATaskStatus>): void {
    const existing = this.tasks.get(taskId);
    if (existing) {
      this.tasks.set(taskId, { ...existing, ...status });
    } else {
      this.tasks.set(taskId, { id: taskId, status: status.status || 'pending', ...status });
    }
  }
}