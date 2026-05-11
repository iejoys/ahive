/**
 * A2A 通用协议客户端
 * 
 * 基于配置驱动，支持多种 A2A 协议
 * 新增协议只需添加配置，无需修改代码
 */

import log from 'electron-log';
import { randomUUID } from 'crypto';
import type { A2AAgentConfig, A2ATaskStatus, A2AAgentCard } from '../../storage';
import type { IA2AClient, StreamCallback, A2AStreamEvent } from './IA2AClient';
import { A2AProtocolLoader } from '../config/A2AProtocolLoader';
import { A2ARequestBuilder } from '../config/A2ARequestBuilder';
import { A2AResponseParser } from '../config/A2AResponseParser';
import type { A2AProtocolConfig, RequestContext, ParsedRequest } from '../config/A2AProtocolConfig';

export class GenericA2AClient implements IA2AClient {
  readonly protocolType: string;
  
  private protocolConfig: A2AProtocolConfig | null = null;
  private sessionId: string | null = null;
  private agentCard: A2AAgentCard | null = null;
  private tasks: Map<string, A2ATaskStatus> = new Map();
  private abortController: AbortController | null = null;

  private requestBuilder = new A2ARequestBuilder();
  private responseParser = new A2AResponseParser();

  constructor(private config: A2AAgentConfig) {
    this.protocolType = config.protocolType || 'openclaw';
    this.loadProtocolConfig();
  }

  /**
   * 加载协议配置
   */
  private loadProtocolConfig(): void {
    const loader = A2AProtocolLoader.getInstance();
    this.protocolConfig = loader.getProtocol(this.protocolType);
    
    if (!this.protocolConfig) {
      log.warn(`[GenericA2A] Protocol config not found: ${this.protocolType}, using default`);
      this.protocolConfig = loader.getDefaultProtocol();
    }
  }

  /**
   * 初始化
   */
  async initialize(): Promise<A2AAgentCard | null> {
    if (!this.protocolConfig) {
      throw new Error(`Protocol config not loaded: ${this.protocolType}`);
    }

    // 如果需要 Session，先创建
    if (this.protocolConfig.session?.create) {
      await this.ensureSession();
    }

    // 生成 Agent Card
    this.agentCard = {
      agentId: this.config.agentId,
      name: this.config.name,
      description: `${this.protocolConfig.name} Agent`,
      url: this.config.endpoint,
      capabilities: [],
      version: this.protocolConfig.version || '1.0'
    };

    log.info(`[GenericA2A] Initialized ${this.protocolType} client for ${this.config.name}`);
    return this.agentCard;
  }

  /**
   * 确保 Session 存在
   */
  private async ensureSession(): Promise<void> {
    // 使用保存的 Session ID
    if (this.config.sessionKey) {
      this.sessionId = this.config.sessionKey;
      log.info(`[GenericA2A] Using saved session: ${this.sessionId}`);
      return;
    }

    // 创建新 Session
    if (!this.protocolConfig?.session?.create) {
      return;
    }

    const context: RequestContext = {
      message: '',
      agentId: this.config.agentId,
      apiKey: this.config.apiKey
    };

    const request = this.requestBuilder.buildCreateSessionRequest(
      this.protocolConfig,
      this.config.endpoint,
      context
    );

    if (!request) {
      return;
    }

    try {
      const response = await this.executeRequest(request);
      this.sessionId = this.extractSessionId(response);
      log.info(`[GenericA2A] Created session: ${this.sessionId}`);
    } catch (error) {
      // 详细错误信息帮助用户排查问题
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.warn(`[GenericA2A] Failed to create session for "${this.config.name}":`);
      log.warn(`  - Endpoint: ${this.config.endpoint}`);
      log.warn(`  - Error: ${errorMsg}`);
      log.warn(`  - Tip: Check if the server is running and the URL is correct.`);
      // 不抛出异常，允许 Agent 在没有 session 的情况下继续工作
    }
  }

  /**
   * 提取 Session ID
   */
  private extractSessionId(response: any): string | null {
    if (!this.protocolConfig?.session?.idPath) {
      return null;
    }
    
    const idPath = this.protocolConfig.session.idPath;
    return response[idPath] || null;
  }

  /**
   * 获取 Session ID（供保存）
   */
  getSessionKey(): string | null {
    return this.sessionId;
  }

  /**
   * 发送同步消息
   */
  async sendTaskSync(task: string, timeout?: number): Promise<A2ATaskStatus> {
    if (!this.protocolConfig) {
      throw new Error('Protocol not initialized');
    }

    const taskId = this.generateTaskId();
    
    const context: RequestContext = {
      message: task,
      agentId: this.config.agentId,
      sessionId: this.sessionId || undefined,
      apiKey: this.config.apiKey,
      stream: false,
      // 从 customFields 读取用户输入值，优先级高于默认值
      provider: this.config.customFields?.provider || this.protocolConfig.defaults?.provider || this.protocolConfig.defaultProvider,
      model: this.config.customFields?.model || this.protocolConfig.defaults?.model || this.protocolConfig.defaultModel,
      // 传递所有 customFields 到 context
      custom: this.config.customFields || {}
    };

    const request = this.requestBuilder.buildSendMessageRequest(
      this.protocolConfig,
      this.config.endpoint,
      context
    );

if (timeout) {
      request.timeout = timeout;
    }

    // 调试日志：打印模板内容
    log.info(`[GenericA2A] Template: ${JSON.stringify(this.protocolConfig.sendMessage?.request?.template)}`);
    log.info(`[GenericA2A] Context agentId: ${context.agentId}`);
    log.info(`[GenericA2A] Context custom: ${JSON.stringify(context.custom)}`);

    this.updateTaskStatus(taskId, { status: 'working' });

    try {
      const response = await this.executeRequest(request);
      const parsed = this.responseParser.parseMessageResponse(this.protocolConfig, response);

      return {
        id: parsed.messageId || taskId,
        status: parsed.status,
        message: parsed.text ? { role: 'agent', content: parsed.text } : undefined,
        error: parsed.error
      };
    } catch (error) {
      return {
        id: taskId,
        status: 'failed',
        error: (error as Error).message
      };
    }
  }

  /**
   * 发送异步消息
   */
  async sendTaskAsync(task: string, webhookUrl?: string): Promise<string> {
    if (!this.protocolConfig?.asyncTask?.create) {
      throw new Error('Async task not supported by this protocol');
    }

    const taskId = this.generateTaskId();
    
    const context: RequestContext = {
      message: task,
      agentId: this.config.agentId,
      sessionId: this.sessionId || undefined,
      apiKey: this.config.apiKey,
      webhookUrl
    };

    const request = this.requestBuilder.buildSendMessageRequest(
      this.protocolConfig,
      this.config.endpoint,
      context
    );

    const response = await this.executeRequest(request);
    
    this.updateTaskStatus(taskId, { status: 'working' });
    return taskId;
  }

  /**
   * 发送流式消息
   */
  async sendTaskStream(
    task: string,
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<A2ATaskStatus> {
    if (!this.protocolConfig?.sse) {
      // 不支持 SSE，回退到同步
      log.warn('[GenericA2A] SSE not supported, falling back to sync');
      return this.sendTaskSync(task);
    }

    const taskId = this.generateTaskId();
    this.abortController = new AbortController();
    const abortSignal = signal || this.abortController.signal;

    const context: RequestContext = {
      message: task,
      agentId: this.config.agentId,
      sessionId: this.sessionId || undefined,
      apiKey: this.config.apiKey,
      stream: true,
      // 从 customFields 读取用户输入值，优先级高于默认值
      provider: this.config.customFields?.provider || this.protocolConfig.defaults?.provider || this.protocolConfig.defaultProvider,
      model: this.config.customFields?.model || this.protocolConfig.defaults?.model || this.protocolConfig.defaultModel,
      // 传递所有 customFields 到 context
      custom: this.config.customFields || {}
    };
    this.updateTaskStatus(taskId, { status: 'working' });

    let fullText = '';
    let lastStatus = 'working';

    try {
      // 如果是 POST 请求，先发送消息
      if (this.protocolConfig.sse.endpoint.method === 'POST') {
        const sendRequest = this.requestBuilder.buildSendMessageRequest(
          this.protocolConfig,
          this.config.endpoint,
          { ...context, stream: true }
        );
        await this.executeRequest(sendRequest);
      }

      // 连接 SSE
      const sseRequest = this.requestBuilder.buildSSERequest(
        this.protocolConfig,
        this.config.endpoint,
        context
      );

      await this.consumeSSEStream(
        sseRequest,
        (event) => {
          if (abortSignal.aborted) return;

          const parsed = this.responseParser.parseSSEEvent(
            this.protocolConfig!,
            event.event,
            event.data
          );

          switch (parsed.type) {
            case 'text_delta':
              if (parsed.text) {
                fullText += parsed.text;
                onEvent({ type: 'text_delta', text: parsed.text });
              }
              break;
            case 'text_done':
              if (parsed.text) {
                fullText = parsed.text;
                onEvent({ type: 'text_done', text: parsed.text });
              }
              break;
            case 'complete':
              lastStatus = 'completed';
              onEvent({ type: 'complete' });
              break;
            case 'error':
              lastStatus = 'failed';
              onEvent({ type: 'error', error: parsed.error });
              break;
          }
        },
        abortSignal
      );

      return {
        id: taskId,
        status: lastStatus as A2ATaskStatus['status'],
        message: fullText ? { role: 'agent', content: fullText } : undefined
      };
    } catch (error) {
      return {
        id: taskId,
        status: 'failed',
        error: (error as Error).message
      };
    }
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    if (this.abortController) {
      this.abortController.abort();
    }
    return true;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      // 优先使用协议配置中的健康检查端点
      if (this.protocolConfig?.healthCheck) {
        const healthPath = this.protocolConfig.healthCheck.path || '/health';
        const healthMethod = this.protocolConfig.healthCheck.method || 'GET';
        const url = `${this.config.endpoint}${healthPath}`;
        
        log.info(`[GenericA2A] Health check: ${healthMethod} ${url}`);
        
        const response = await fetch(url, {
          method: healthMethod,
          signal: AbortSignal.timeout(10000)
        });
        
        const isHealthy = response.ok;
        log.info(`[GenericA2A] Health check result for ${this.config.name}: ${isHealthy}`);
        return isHealthy;
      }
      
      // 回退到检查根端点
      const response = await fetch(this.config.endpoint, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok || response.status === 401;
    } catch (error) {
      log.warn(`[GenericA2A] Health check failed for ${this.config.name}:`, error);
      return false;
    }
  }

  /**
   * 获取 Agent Card
   */
  getAgentCard(): A2AAgentCard | null {
    return this.agentCard;
  }

  /**
   * 获取任务状态
   */
  async getTaskStatus(taskId: string): Promise<A2ATaskStatus | null> {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 清理
   */
  async cleanup(): Promise<void> {
    this.tasks.clear();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 执行 HTTP 请求
   */
  private async executeRequest(request: ParsedRequest): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      request.timeout || 30000
    );

    try {
      log.info(`[GenericA2A] Sending request to ${request.url}`);
      log.info(`[GenericA2A] Request method: ${request.method}`);
      log.info(`[GenericA2A] Request headers: ${JSON.stringify(request.headers)}`);
      log.info(`[GenericA2A] Request body: ${request.body ? JSON.stringify(request.body) : 'none'}`);
      
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal
      });

      log.info(`[GenericA2A] Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        log.error(`[GenericA2A] HTTP ${response.status}: ${errorText.slice(0, 500)}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseText = await response.text();
      log.info(`[GenericA2A] Response text (${responseText.length} chars): ${responseText.slice(0, 500)}`);
      
      if (!responseText || responseText.trim() === '') {
        log.error(`[GenericA2A] Empty response from server`);
        throw new Error('Empty response from server');
      }
      
      try {
        return JSON.parse(responseText);
      } catch (parseError) {
        log.error(`[GenericA2A] JSON parse error. Response: ${responseText.slice(0, 500)}`);
        throw new Error(`JSON parse error: ${parseError instanceof Error ? parseError.message : 'Unknown'}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 消费 SSE 流
   */
  private async consumeSSEStream(
    request: ParsedRequest,
    onEvent: (event: { event: string; data: any }) => void,
    signal: AbortSignal
  ): Promise<void> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const data = JSON.parse(dataStr);
              // 提取事件类型
              const eventType = data.type || data.payload?.type || 'message';
              onEvent({ event: eventType, data });
            } catch {
              // 非JSON数据
              onEvent({ event: 'message', data: dataStr });
            }
          } else if (line.startsWith('event: ')) {
            // 存储事件类型，等待 data 行
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    return randomUUID();
  }

  /**
   * 更新任务状态
   */
  private updateTaskStatus(taskId: string, status: Partial<A2ATaskStatus>): void {
    const existing = this.tasks.get(taskId);
    if (existing) {
      this.tasks.set(taskId, { ...existing, ...status });
    } else {
      this.tasks.set(taskId, { id: taskId, status: 'pending', ...status });
    }
  }
}