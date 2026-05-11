/**
 * AHIVE-WORKER 智能体 Worker 入口
 * 
 * 作为独立进程运行，通过 IPC 与主进程通讯
 */

import { logger } from '../../utils/index.js';
import { AhiveWorkerExecutor } from './executor.js';
import type { ToolRegistry } from '../../executor/tool-system.js';
import {
  AgentStatus,
  WorkerMessage,
  WorkerResponse,
  ExecuteRequest,
  AgentConfig,
} from '../../process-manager/types.js';

// ==================== 类型定义 ====================

interface LLMService {
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, config?: any): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    finishReason?: string;
  }>;
}

// ==================== Worker 类 ====================

class AhiveWorkerWorker {
  private config: AgentConfig | null = null;
  private executor: AhiveWorkerExecutor | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private llmService: LLMService | null = null;
  private status: AgentStatus = AgentStatus.Idle;
  private startTime: number = Date.now();

  constructor() {
    this.setupIPC();
  }

  /**
   * 设置 IPC 通讯
   */
  private setupIPC(): void {
    process.on('message', async (message: WorkerMessage) => {
      try {
        const response = await this.handleMessage(message);
        if (response) {
          this.send(response);
        }
      } catch (error: any) {
        logger.error(`[AhiveWorkerWorker] 处理消息失败: ${error.message}`);
        this.send({
          type: 'error',
          error: error.message,
          stack: error.stack,
        });
      }
    });

    // 通知主进程已准备好
    this.send({
      type: 'ready',
      agentType: 'ahive-worker',
    });

    logger.info('[AhiveWorkerWorker] Worker 已启动，等待配置...');
  }

  /**
   * 发送消息
   */
  private send(message: WorkerResponse): void {
    if (process.send) {
      process.send(message);
    }
  }

  /**
   * 处理消息
   */
  private async handleMessage(message: WorkerMessage): Promise<WorkerResponse | void> {
    switch (message.type) {
      case 'init':
        return await this.handleInit(message as WorkerMessage & AgentConfig);

      case 'execute':
      case 'activate':
        return await this.handleExecute(message as ExecuteRequest);

      case 'interrupt':
        return await this.handleInterrupt();

      case 'health_check':
        return this.handleHealthCheck();

      case 'stop':
        return await this.handleStop();

      case 'handleMessage':
        return await this.handleAgentMessage(message as WorkerMessage & { from: string; message: string });

      default:
        throw new Error(`未知消息类型: ${(message as any).type}`);
    }
  }

  /**
   * 初始化
   */
  private async handleInit(payload: WorkerMessage & AgentConfig): Promise<WorkerResponse> {
    this.config = {
      agentId: payload.agentId,
      agentType: 'ahive-worker',
      modelConfig: payload.modelConfig,
    };
    
    logger.info(`[AhiveWorkerWorker] 初始化完成: ${this.config.agentId}`);
    
    this.status = AgentStatus.Idle;
    
    return {
      type: 'response',
      success: true,
      agentId: this.config.agentId,
    };
  }

  /**
   * 执行任务
   */
  private async handleExecute(payload: ExecuteRequest): Promise<WorkerResponse> {
    if (!this.executor || !this.llmService) {
      throw new Error('Worker 未初始化完成');
    }

    if (this.status === AgentStatus.Running) {
      throw new Error('Worker 正在执行任务');
    }

    this.status = AgentStatus.Running;
    logger.info(`[AhiveWorkerWorker] 开始执行任务`);

    try {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      
      if (payload.systemPrompt) {
        messages.push({ role: 'system', content: payload.systemPrompt });
      }
      
      if (payload.sessionMessages && payload.sessionMessages.length > 0) {
        for (const msg of payload.sessionMessages) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      
      messages.push({ role: 'user', content: payload.prompt });

      // AHIVE-WORKER sessionMessages 只支持 user 和 assistant
      const sessionMessages = payload.sessionMessages 
        ? payload.sessionMessages
            .filter(msg => msg.role === 'user' || msg.role === 'assistant')
            .map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content }))
        : undefined;

      const result = await this.executor.execute(this.llmService, {
        systemPrompt: payload.systemPrompt || '',
        userMessage: payload.prompt,
        sessionMessages,
        modelConfig: payload.modelConfig || this.config?.modelConfig,
        onToolStart: (name, args) => {
          this.send({
            type: 'stream_event',
            eventType: 'tool_start',
            data: { name, args },
          });
        },
        onToolEnd: (name, result, success) => {
          this.send({
            type: 'stream_event',
            eventType: 'tool_end',
            data: { name, result, success },
          });
        },
      });

      this.status = AgentStatus.Idle;
      logger.info(`[AhiveWorkerWorker] 任务完成，迭代 ${result.iterations} 次`);

      return {
        type: 'response',
        content: result.content,
        iterations: result.iterations,
        toolCallsExecuted: result.toolCallsExecuted,
      };
    } catch (error: any) {
      this.status = AgentStatus.Error;
      throw error;
    }
  }

  /**
   * 中断执行
   */
  private async handleInterrupt(): Promise<WorkerResponse> {
    // AHIVE-WORKER 执行器目前不支持中断
    this.status = AgentStatus.Idle;
    logger.info(`[AhiveWorkerWorker] 中断请求`);
    
    return {
      type: 'response',
      success: true,
    };
  }

  /**
   * 健康检查
   */
  private handleHealthCheck(): WorkerResponse {
    return {
      type: 'health_response',
      status: this.status,
      result: {
        uptime: Date.now() - this.startTime,
        memoryUsage: process.memoryUsage(),
      },
    };
  }

  /**
   * 停止
   */
  private async handleStop(): Promise<WorkerResponse> {
    logger.info(`[AhiveWorkerWorker] 正在关闭...`);
    this.status = AgentStatus.Stopped;
    
    // 清理资源
    this.executor = null;
    this.toolRegistry = null;
    this.llmService = null;
    
    // 退出进程
    setTimeout(() => {
      process.exit(0);
    }, 100);

    return {
      type: 'stopped',
      success: true,
    };
  }

  /**
   * 处理智能体间消息
   * 
   * 🆕 支持接收 metadata，用于企业微信会话追踪
   * metadata 包含：chatId, fromUser, source 等信息
   * 
   * 消息格式：
   * - 如果有 metadata，会在消息内容中添加回复路由标记
   * - 智能体回复时，需要保留这些标记，以便 send_message 工具能提取 metadata
   */
  private async handleAgentMessage(payload: WorkerMessage & { from: string; message: string; metadata?: Record<string, unknown> }): Promise<WorkerResponse> {
    logger.info(`[AhiveWorkerWorker] 收到来自 ${payload.from} 的消息: ${payload.message}`);
    logger.info(`[AhiveWorkerWorker] metadata: ${JSON.stringify(payload.metadata)}`);
    
    // 🆕 如果有 metadata，注入回复路由标记到消息内容中
    let enhancedMessage = payload.message;
    
    if (payload.metadata) {
      const { chatId, fromUser, source } = payload.metadata;
      
      // 如果来源是企业微信，添加回复路由标记
      if (source === 'wecom' && chatId && fromUser) {
        enhancedMessage = `${payload.message}

---
[回复路由信息]
来源: 企业微信
用户: ${fromUser}
会话ID: ${chatId}

⚠️ 重要：回复时请使用 send_message 工具发送给 ahive-webot，并在消息内容末尾保留以下标记：
[REPLY_TO: ${chatId}]
---
`;
        logger.info(`[AhiveWorkerWorker] 已注入回复路由标记，chatId=${chatId}, fromUser=${fromUser}`);
      }
    }
    
    // 🆕 如果有 executor，执行智能体处理逻辑
    if (this.executor && this.llmService) {
      try {
        this.status = AgentStatus.Running;
        logger.info(`[AhiveWorkerWorker] 开始处理智能体消息`);
        
        const result = await this.executor.execute(this.llmService, {
          systemPrompt: '', // 智能体间消息不需要系统提示词
          userMessage: enhancedMessage,
          modelConfig: this.config?.modelConfig,
          onToolStart: (name, args) => {
            this.send({
              type: 'stream_event',
              eventType: 'tool_start',
              data: { name, args },
            });
          },
          onToolEnd: (name, result, success) => {
            this.send({
              type: 'stream_event',
              eventType: 'tool_end',
              data: { name, result, success },
            });
          },
        });
        
        this.status = AgentStatus.Idle;
        logger.info(`[AhiveWorkerWorker] 消息处理完成，迭代 ${result.iterations} 次`);
        
        return {
          type: 'response',
          content: result.content,
          iterations: result.iterations,
          toolCallsExecuted: result.toolCallsExecuted,
        };
      } catch (error: any) {
        this.status = AgentStatus.Error;
        logger.error(`[AhiveWorkerWorker] 处理消息失败: ${error.message}`);
        return {
          type: 'response',
          success: false,
          error: error.message,
        };
      }
    }
    
    // 兜底：如果没有 executor，返回简单确认
    return {
      type: 'response',
      success: true,
      content: `收到来自 ${payload.from} 的消息`,
    };
  }

  /**
   * 注入工具注册表
   */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    this.executor = new AhiveWorkerExecutor(registry);
    logger.info(`[AhiveWorkerWorker] 工具注册表已注入`);
  }

  /**
   * 注入 LLM 服务
   */
  setLLMService(service: LLMService): void {
    this.llmService = service;
    logger.info(`[AhiveWorkerWorker] LLM 服务已注入`);
  }
}

// ==================== 启动 Worker ====================

const worker = new AhiveWorkerWorker();

// 导出用于测试
export { AhiveWorkerWorker, worker };