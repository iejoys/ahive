/**
 * AHIVECORE 协议客户端
 * 
 * 连接 AHIVECORE 智能体核心引擎
 * 
 * 特点：
 * - 端点: http://127.0.0.1:18790
 * - SSE 流式输出: GET /chat/stream
 * - 支持智能体切换、中断、用户插话
 * - 完整的工具调用事件流
 * 
 * SSE 事件类型：
 * - status: 状态更新 (thinking/executing/success/error/complete)
 * - text_delta: 文本增量输出
 * - exec_output: 命令执行输出
 * - error: 错误信息
 * - done: 完成
 * - heartbeat: 心跳
 * - approval_request: 审批请求
 */

import log from 'electron-log';
import type { A2AAgentConfig, A2AAgentCard, A2ATaskStatus } from '../../storage';
import { BaseA2AClient } from './BaseA2AClient';
import type { StreamCallback, A2AStreamEvent, TextDelta, TaskStatusUpdate } from './IA2AClient';

/**
 * AHIVECORE 配置
 */
interface AHIVECoreConfig extends A2AAgentConfig {
  agentId?: string;  // 智能体 ID（可选，用于指定活跃智能体）
}

/**
 * AHIVECORE SSE 事件
 */
interface AHIVECoreEvent {
  type: string;
  message?: string;
  delta?: string;
  itemId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  command?: string;
  callId?: string;
  output?: string;
  stream?: string;
  exitCode?: number;
  content?: string;
  toolCallsExecuted?: number;
  iterations?: number;
  timestamp?: number;
}

/**
 * AHIVECORE 智能体状态
 */
interface AHIVECoreAgentStatus {
  id: string;
  type: 'openclaw' | 'codex';
  status: 'idle' | 'busy' | 'error';
  model?: {
    provider: string;
    name: string;
  };
  nickname?: string;
}

/**
 * AHIVECORE 客户端
 * 
 * 实现 A2A 协议接口，连接 AHIVECORE 智能体核心引擎
 */
export class AHIVECoreClient extends BaseA2AClient {
  readonly protocolType = 'ahivecore';
  
  private ahiveConfig: AHIVECoreConfig;
  private activeAgentId: string | null = null;
  private sessionMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  
  // SSE 连接管理
  private currentAbortController: AbortController | null = null;
  private isStreaming: boolean = false;

  constructor(config: A2AAgentConfig) {
    super(config);
    this.ahiveConfig = {
      ...config,
      endpoint: config.endpoint || 'http://127.0.0.1:18790'
    };
  }

  async initialize(): Promise<A2AAgentCard | null> {
    try {
      // 获取 AHIVECORE 健康状态
      const health = await this.healthCheck();
      if (!health) {
        log.warn('[AHIVECore] 无法连接到 AHIVECORE 服务');
        return null;
      }

      // 获取活跃智能体
      const activeAgent = await this.getActiveAgent();
      if (activeAgent) {
        this.activeAgentId = activeAgent.id;
        log.info(`[AHIVECore] 活跃智能体: ${activeAgent.id} (${activeAgent.type})`);
      }

      // 构建 Agent Card
      this.agentCard = {
        agentId: this.activeAgentId || this.config.agentId || 'ahivecore',
        name: this.config.name || 'AHIVECORE Agent',
        description: 'AHIVECORE 智能体核心引擎',
        url: this.ahiveConfig.endpoint!,
        capabilities: [
          { name: 'chat', description: '对话能力' },
          { name: 'tools', description: '工具调用' },
          { name: 'streaming', description: '流式输出' },
          { name: 'interrupt', description: '中断执行' },
          { name: 'user-input', description: '用户插话' },
        ],
        version: '1.0.0'
      };

      return this.agentCard;
    } catch (error) {
      log.error('[AHIVECore] 初始化失败:', error);
      return null;
    }
  }

  async sendTaskSync(task: string, timeout = 300000): Promise<A2ATaskStatus> {
    const taskId = this.generateTaskId();
    
    try {
      const url = `${this.ahiveConfig.endpoint}/chat`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // 检测是否是系统消息（包含 type 字段的 JSON）
      let body: any;
      try {
        const parsed = JSON.parse(task);
        if (parsed.type) {
          // 系统消息（capability_update, skill_register 等）直接发送
          body = parsed;
        } else {
          // 普通消息包装，添加 agentId
          body = { 
            message: task,
            agentId: this.config.agentId || this.activeAgentId
          };
        }
      } catch {
        // 非JSON，包装成普通消息，添加 agentId
        body = { 
          message: task,
          agentId: this.config.agentId || this.activeAgentId
        };
      }

      const response = await this.sendRequest<{ 
        id: string; 
        reply: string;
        content?: string;
        success?: boolean;
        type?: string;
        stats?: any;
        toolCallsExecuted?: number;
        iterations?: number;
      }>(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        },
        timeout
      );

      // 系统消息响应（如 capability_update）
      if (body.type && response.success !== undefined) {
        const status: A2ATaskStatus = {
          id: taskId,
          status: response.success ? 'completed' : 'failed',
          message: {
            role: 'agent',
            content: response.success ? '操作成功' : '操作失败'
          }
        };
        this.updateTaskStatus(status.id, status);
        return status;
      }

      // 普通聊天响应
      const replyContent = response.reply || response.content || '';
      
      // 记录到会话历史
      this.sessionMessages.push(
        { role: 'user', content: body.message || task },
        { role: 'assistant', content: replyContent }
      );

      const status: A2ATaskStatus = {
        id: response.id || taskId,
        status: 'completed',
        message: {
          role: 'agent',
          content: replyContent
        }
      };

      this.updateTaskStatus(status.id, status);
      return status;

    } catch (error) {
      const err = error as Error;
      return {
        id: taskId,
        status: 'failed',
        error: err.message
      };
    }
  }

  async sendTaskAsync(task: string, webhookUrl?: string): Promise<string> {
    // AHIVECORE 不支持异步 webhook，使用流式模式
    throw new Error('AHIVECORE does not support async mode. Use sendTaskStream instead.');
  }

  async sendTaskStream(
    task: string,
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<A2ATaskStatus> {
    const taskId = this.generateTaskId();
    let fullContent = '';
    let toolCallsExecuted = 0;
    let iterations = 0;

    // ========== SSE 连接管理 ==========
    // 如果有正在进行的流式请求，先中断它
    if (this.isStreaming && this.currentAbortController) {
      log.info('[AHIVECore] 中断之前的 SSE 连接');
      this.currentAbortController.abort();
      this.currentAbortController = null;
      this.isStreaming = false;
    }

    // 创建新的 AbortController
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.isStreaming = true;

    // 如果外部传入了 signal，监听它的中断事件
    if (signal) {
      signal.addEventListener('abort', () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      });
    }

    try {
      // 构建 SSE URL
      const params = new URLSearchParams({
        message: task
      });
      
      // 传递 agentId（优先使用 config.agentId，其次使用 activeAgentId）
      const targetAgentId = this.config.agentId || this.activeAgentId;
      if (targetAgentId) {
        params.set('agentId', targetAgentId);
      }

      const url = `${this.ahiveConfig.endpoint}/chat/stream?${params.toString()}`;
      
      log.info(`[AHIVECore] SSE 连接: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`AHIVECORE request failed: ${response.statusText}`);
      }

      // 解析 SSE 流
      await this.parseAHIVECORESSE(response, onEvent, (event) => {
        // 收集完整内容
        if (event.type === 'text_delta' && event.text) {
          fullContent += event.text;
        }
        if (event.type === 'done') {
          fullContent = event.data?.content || fullContent;
          toolCallsExecuted = event.data?.toolCallsExecuted || 0;
          iterations = event.data?.iterations || 0;
        }
        return event;
      });

      // 记录到会话历史
      this.sessionMessages.push(
        { role: 'user', content: task },
        { role: 'assistant', content: fullContent }
      );

      const status: A2ATaskStatus = {
        id: taskId,
        status: 'completed',
        message: {
          role: 'agent',
          content: fullContent
        }
      };

      this.updateTaskStatus(taskId, status);
      return status;

    } catch (error) {
      const err = error as Error;
      
      // 如果是中断，返回 canceled 状态
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        log.info('[AHIVECore] SSE 连接被中断');
        return {
          id: taskId,
          status: 'canceled',
          error: 'Execution interrupted'
        };
      }

      const status: A2ATaskStatus = {
        id: taskId,
        status: 'failed',
        error: err.message
      };
      this.updateTaskStatus(taskId, status);
      return status;
    } finally {
      // 清理连接状态
      this.isStreaming = false;
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null;
      }
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const url = `${this.ahiveConfig.endpoint}/api/interrupt`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      return response.ok;
    } catch (error) {
      log.error('[AHIVECore] 中断失败:', error);
      return false;
    }
  }

  async getTaskStatus(taskId: string): Promise<A2ATaskStatus | null> {
    // AHIVECORE 不支持任务状态查询，返回本地缓存
    return this.taskStatusCache.get(taskId) || null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.ahiveConfig.endpoint}/health`;
      const response = await fetch(url, { 
        method: 'GET',
        signal: AbortSignal.timeout(10000) // 10秒超时
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async cleanup(): Promise<void> {
    await super.cleanup();
    this.sessionMessages = [];
  }

  // ==================== AHIVECORE 特有方法 ====================

  /**
   * 获取活跃智能体
   */
  async getActiveAgent(): Promise<AHIVECoreAgentStatus | null> {
    try {
      const url = `${this.ahiveConfig.endpoint}/api/unified-agents/active`;
      const response = await fetch(url);
      
      if (!response.ok) return null;
      
      const data = await response.json();
      
      if (data.active) {
        return {
          id: data.agent_id,
          type: data.type,
          status: data.status,
          model: data.model
        };
      }
      
      return null;
    } catch (error) {
      log.error('[AHIVECore] 获取活跃智能体失败:', error);
      return null;
    }
  }

  /**
   * 激活智能体
   */
  async activateAgent(agentId: string): Promise<boolean> {
    try {
      const url = `${this.ahiveConfig.endpoint}/api/unified-agents/${agentId}/activate`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        this.activeAgentId = agentId;
        log.info(`[AHIVECore] 已激活智能体: ${agentId}`);
        return true;
      }
      
      return false;
    } catch (error) {
      log.error('[AHIVECore] 激活智能体失败:', error);
      return false;
    }
  }

  /**
   * 获取所有智能体列表
   */
  async listAgents(): Promise<AHIVECoreAgentStatus[]> {
    try {
      const url = `${this.ahiveConfig.endpoint}/api/unified-agents`;
      const response = await fetch(url);
      
      if (!response.ok) return [];
      
      const data = await response.json();
      return data.agents || [];
    } catch (error) {
      log.error('[AHIVECore] 获取智能体列表失败:', error);
      return [];
    }
  }

  /**
   * 提交用户插话
   */
  async submitUserInput(message: string): Promise<boolean> {
    try {
      const url = `${this.ahiveConfig.endpoint}/api/user-input`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });

      return response.ok;
    } catch (error) {
      log.error('[AHIVECore] 提交用户输入失败:', error);
      return false;
    }
  }

  /**
   * 获取会话历史
   */
  getSessionMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.sessionMessages];
  }

  /**
   * 清空会话历史
   */
  clearSessionMessages(): void {
    this.sessionMessages = [];
  }

  // ==================== 私有方法 ====================

  /**
   * 解析 AHIVECORE SSE 流
   */
  private async parseAHIVECORESSE(
    response: Response,
    onEvent: StreamCallback,
    transform: (event: A2AStreamEvent) => A2AStreamEvent | null
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith('data:')) {
            const dataStr = line.substring(5).trim();
            
            try {
              const data = JSON.parse(dataStr) as AHIVECoreEvent;
              const event = this.transformAHIVECOREEvent(currentEvent, data);
              
              if (event) {
                const transformed = transform(event);
                if (transformed) {
                  onEvent(transformed);
                }
              }
            } catch (parseError) {
              log.debug('[AHIVECore] 解析 SSE 数据失败:', parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 转换 AHIVECORE SSE 事件为 A2A 事件
   */
  private transformAHIVECOREEvent(eventType: string, data: AHIVECoreEvent): A2AStreamEvent | null {
    switch (eventType) {
      case 'status':
        return {
          type: 'status_update',
          data: {
            taskId: '',
            status: this.mapStatusType(data.type),
            message: data.message ? { role: 'agent', content: data.message } : undefined,
          } as TaskStatusUpdate
        };

      case 'text_delta':
        return {
          type: 'delta',
          data: { text: data.delta || '' } as TextDelta,
          text: data.delta
        };

      case 'exec_output':
        return {
          type: 'delta',
          data: { text: data.output || '' } as TextDelta,
          text: data.output
        };

      case 'error':
        return {
          type: 'error',
          error: data.message || 'Unknown error'
        };

      case 'done':
        return {
          type: 'complete',
          data: {
            content: data.content,
            toolCallsExecuted: data.toolCallsExecuted,
            iterations: data.iterations
          }
        };

      case 'heartbeat':
        return {
          type: 'heartbeat',
          data: { timestamp: data.timestamp }
        };

      case 'approval_request':
        return {
          type: 'status_update',
          data: {
            taskId: data.callId || '',
            status: 'input-required',
            message: data.toolName ? { role: 'agent', content: `需要审批: ${data.toolName}` } : undefined,
          } as TaskStatusUpdate
        };

      default:
        return null;
    }
  }

  /**
   * 映射状态类型
   */
  private mapStatusType(type?: string): 'working' | 'completed' | 'failed' | 'input-required' {
    switch (type) {
      case 'thinking':
      case 'executing':
        return 'working';
      case 'success':
      case 'complete':
        return 'completed';
      case 'error':
        return 'failed';
      case 'input-required':
        return 'input-required';
      default:
        return 'working';
    }
  }
}