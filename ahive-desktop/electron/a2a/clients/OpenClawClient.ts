/**
 * OpenClaw OpenResponses 协议客户端
 * 实现 OpenClaw 的 OpenResponses API
 * 
 * 文档: https://docs.openclaw.ai/gateway/openresponses-http-api.md
 * 
 * 特点：
 * - 端点: /v1/responses
 * - SSE 事件类型: response.output_text.delta, response.completed 等
 * - 支持 stream: true 参数启用流式输出
 */

import log from 'electron-log';
import type { A2AAgentConfig, A2AAgentCard, A2ATaskStatus } from '../../storage';
import { BaseA2AClient } from './BaseA2AClient';
import type { StreamCallback, A2AStreamEvent, TextDelta, TaskStatusUpdate } from './IA2AClient';

/**
 * OpenResponses 请求
 */
interface OpenResponsesRequest {
  model: string;
  input: string | MessageInput[];
  stream?: boolean;
  context_id?: string;
  user?: string;  // 会话标识符，用于维持 session
}

/**
 * 消息输入
 */
interface MessageInput {
  type: 'message';
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

/**
 * 内容部分
 */
interface ContentPart {
  type: 'input_text' | 'output_text';
  text: string;
}

/**
 * OpenResponses SSE 事件
 */
interface OpenResponsesEvent {
  type: string;
  response_id?: string;
  item_id?: string;
  output_index?: number;
  content_index?: number;
  text?: string;
  status?: string;
  message?: string;
}

/**
 * 内容部分
 */
interface ContentPart {
  type: 'input_text' | 'output_text';
  text: string;
}

/**
 * 输出消息
 */
interface OutputMessage {
  type: 'message';
  id: string;
  role: 'assistant';
  content: ContentPart[];
  status: string;
}

/**
 * OpenResponses 同步响应
 */
interface OpenResponsesSyncResponse {
  id: string;
  context_id?: string;
  output?: OutputMessage[];  // 实际是消息数组
  status?: string;
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenClaw 客户端配置
 */
interface OpenClawConfig extends A2AAgentConfig {
  apiKey?: string;
  model?: string;
}

/**
 * OpenClaw OpenResponses 客户端
 */
export class OpenClawClient extends BaseA2AClient {
  readonly protocolType = 'openclaw';
  
  private contextId: string | null = null;
  private openClawConfig: OpenClawConfig;
  private sessionKey: string | null = null;

  constructor(config: A2AAgentConfig) {
    super(config);
    this.openClawConfig = {
      ...config,
      model: (config as OpenClawConfig).model || 'openclaw'
    };
    // 从配置中恢复 sessionKey
    this.sessionKey = config.sessionKey || null;
  }

  /**
   * 获取当前 sessionKey（供外部保存）
   */
  getSessionKey(): string | null {
    return this.sessionKey;
  }

  /**
   * 生成新的 sessionKey
   */
  private generateSessionKey(): string {
    return `ahive-${this.config.id}-${Date.now()}`;
  }

  async initialize(): Promise<A2AAgentCard | null> {
    // OpenClaw 使用 Gateway，尝试获取 Agent 信息
    this.agentCard = await this.fetchOpenClawAgentCard();
    if (this.agentCard) {
      log.info(`[OpenClaw] Connected to agent: ${this.agentCard.name}`);
    }
    return this.agentCard;
  }

  async sendTaskSync(task: string, timeout = 300000): Promise<A2ATaskStatus> {
    // 如果没有 sessionKey，生成一个新的
    if (!this.sessionKey) {
      this.sessionKey = this.generateSessionKey();
      log.info(`[OpenClaw] Generated new session key: ${this.sessionKey}`);
    }

    const request: OpenResponsesRequest = {
      model: this.openClawConfig.model || 'openclaw',
      input: task,
      stream: false,
      user: this.sessionKey  // 使用 user 字段维持 session
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.openClawConfig.apiKey) {
      headers['Authorization'] = `Bearer ${this.openClawConfig.apiKey}`;
    }

    headers['x-openclaw-agent-id'] = this.config.agentId;

    const url = `${this.config.endpoint}/v1/responses`;

    try {
      const response = await this.sendRequest<OpenResponsesSyncResponse>(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(request)
        },
        timeout
      );
      // 对话成功，sessionKey 有效
      log.info(`[OpenClaw] Session maintained: ${this.sessionKey}`);

      const status: A2ATaskStatus = {
        id: response.id || this.generateTaskId(),
        status: 'completed',
        message: {
          role: 'agent',
          content: this.extractOutputText(response)
        }
      };


      this.updateTaskStatus(status.id, status);
      return status;

    } catch (err) {
      const error = err as Error;
      
      // 如果是 session 无效错误，清除 sessionKey 下次重新创建
      if (error.message.includes('session') || error.message.includes('not found') || error.message.includes('invalid')) {
        log.warn(`[OpenClaw] Session invalid, clearing: ${this.sessionKey}`);
        this.sessionKey = null;
      }
      
      return {
        id: this.generateTaskId(),
        status: 'failed',
        error: error.message
      };
    }
  }

  async sendTaskAsync(task: string, webhookUrl?: string): Promise<string> {
    // OpenClaw 不直接支持异步 webhook，使用流式模式模拟
    // 如果需要异步，可以让调用方自己管理
    throw new Error('OpenClaw does not support async mode with webhook. Use sendTaskStream instead.');
  }

  async sendTaskStream(
    task: string,
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<A2ATaskStatus> {
    const taskId = this.generateTaskId();
    
    // 如果没有 sessionKey，生成一个新的
    if (!this.sessionKey) {
      this.sessionKey = this.generateSessionKey();
      log.info(`[OpenClaw] Generated new session key for stream: ${this.sessionKey}`);
    }

    const request: OpenResponsesRequest = {
      model: this.openClawConfig.model || 'openclaw',
      input: task,
      stream: true,
      user: this.sessionKey  // 使用 user 字段维持 session
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.openClawConfig.apiKey) {
      headers['Authorization'] = `Bearer ${this.openClawConfig.apiKey}`;
    }

    headers['x-openclaw-agent-id'] = this.config.agentId;

    const url = `${this.config.endpoint}/v1/responses`;
    let fullText = '';
    let responseId = taskId;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal
      });

      if (!response.ok) {
        throw new Error(`OpenClaw request failed: ${response.statusText}`);
      }

      await this.parseSSEStream(
        response,
        onEvent,
        (data) => {
          const event = this.transformSSEEvent(data);
          if (event) {
            // 收集完整文本
            if (event.type === 'delta') {
              fullText += (event.data as TextDelta).text;
            }
            if (event.type === 'status_update') {
              const statusData = event.data as TaskStatusUpdate;
              if (statusData.taskId) {
                responseId = statusData.taskId;
              }
            }
          }
          return event;
        },
        signal
      );

      const finalStatus: A2ATaskStatus = {
        id: responseId,
        status: 'completed',
        message: { role: 'agent', content: fullText }
      };

      this.updateTaskStatus(responseId, finalStatus);
      return finalStatus;

    } catch (err) {
      const error = err as Error;
      const status: A2ATaskStatus = {
        id: taskId,
        status: 'failed',
        error: error.message
      };
      this.updateTaskStatus(taskId, status);
      return status;
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    // OpenClaw 通过中止请求来取消
    if (this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      // 尝试连接到 Gateway
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET'
      });
      return response.ok;
    } catch {
      try {
        // 尝试其他健康检查端点
        const response = await fetch(`${this.config.endpoint}/v1/models`, {
          method: 'GET'
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  }

  async cleanup(): Promise<void> {
    await super.cleanup();
    this.contextId = null;
  }

  /**
   * 获取 OpenClaw Agent Card
   */
  private async fetchOpenClawAgentCard(): Promise<A2AAgentCard | null> {
    // OpenClaw 的 Agent 信息可能来自不同的端点
    try {
      // 尝试从 Gateway 获取 agent 列表
      const response = await fetch(`${this.config.endpoint}/v1/agents`);
      
      if (response.ok) {
        const data = await response.json();
        const agents = data.data || data.agents || [];
        const agent = agents.find((a: { id: string }) => a.id === this.config.agentId);
        
        if (agent) {
          return {
            agentId: agent.id,
            name: agent.name || this.config.name,
            description: agent.description || 'OpenClaw Agent',
            url: this.config.endpoint,
            capabilities: (agent.skills || []).map((s: string) => ({
              name: s,
              description: ''
            })),
            version: agent.version || '1.0.0'
          };
        }
      }

      // 如果没有找到具体 Agent，返回默认信息
      return {
        agentId: this.config.agentId,
        name: this.config.name || 'OpenClaw Agent',
        description: 'OpenClaw AI Agent via OpenResponses API',
        url: this.config.endpoint,
        capabilities: [],
        version: '1.0.0'
      };

    } catch (err) {
      log.debug('[OpenClaw] Failed to fetch agent card:', err);
      
      // 返回默认 Agent Card
      return {
        agentId: this.config.agentId,
        name: this.config.name || 'OpenClaw Agent',
        description: 'OpenClaw AI Agent via OpenResponses API',
        url: this.config.endpoint,
        capabilities: [],
        version: '1.0.0'
      };
    }
  }

  /**
   * 转换 SSE 事件
   */
  private transformSSEEvent(data: string): A2AStreamEvent | null {
    try {
      const event = JSON.parse(data) as OpenResponsesEvent;
      
      switch (event.type) {
        case 'response.output_text.delta':
          return {
            type: 'delta',
            data: {
              taskId: event.response_id || '',
              text: event.text || ''
            } as TextDelta
          };

        case 'response.completed':
          return {
            type: 'status_update',
            data: {
              taskId: event.response_id || '',
              status: 'completed'
            } as TaskStatusUpdate
          };

        case 'response.failed':
          return {
            type: 'error',
            data: {
              code: 'FAILED',
              message: event.message || 'Response failed'
            }
          };

        case 'error':
          return {
            type: 'error',
            data: {
              code: 'ERROR',
              message: event.message || 'Unknown error'
            }
          };

        default:
          return null;
      }
    } catch (err) {
      log.debug('[OpenClaw] Failed to transform SSE event:', err);
      return null;
    }
  }

  /**
   * 从响应中提取输出文本
   */
  private extractOutputText(response: OpenResponsesSyncResponse): string {
    // output 是消息数组
    if (response.output && Array.isArray(response.output) && response.output.length > 0) {
      const messages = response.output;
      const texts: string[] = [];
      
      for (const msg of messages) {
        if (msg.type === 'message' && Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'output_text' && part.text) {
              texts.push(part.text);
            }
          }
        }
      }
      
      if (texts.length > 0) {
        return texts.join('\n');
      }
    }

    return '';
  }
}
