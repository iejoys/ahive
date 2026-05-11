/**
 * AHIVE-CODER 智能体 Worker 入口
 * 
 * 作为独立进程运行，通过 IPC 与主进程通讯
 */

import { logger } from '../../utils/index.js';
import { AhiveCoderExecutor } from './executor.js';
import type { ToolRegistry } from '../../executor/tool-system.js';
import type { AhiveCoderLLMService } from './executor.js';
import { AgentStatus, WorkerMessage, WorkerResponse, AgentConfig } from '../../process-manager/types.js';

// ==================== 类型定义 ====================

interface AhiveCoderWorkerConfig {
  agentId: string;
  agentType: 'ahive-coder';
  modelConfig?: AgentConfig['modelConfig'];
}

// ==================== AHIVE-CODER Worker ====================

class AhiveCoderWorker {
  private config: AhiveCoderWorkerConfig | null = null;
  private executor: AhiveCoderExecutor | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private llmService: AhiveCoderLLMService | null = null;
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
        logger.error(`[AhiveCoderWorker] 处理消息失败: ${error.message}`);
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
      agentType: 'ahive-coder',
    });

    logger.info('[AhiveCoderWorker] Worker 已启动，等待配置...');
  }

  /**
   * 处理消息
   */
  private async handleMessage(message: WorkerMessage): Promise<WorkerResponse | null> {
    switch (message.type) {
      case 'init':
        return await this.handleInit(message as WorkerMessage & { agentId: string; agentType: 'ahive-coder'; modelConfig?: AgentConfig['modelConfig'] });

      case 'execute':
      case 'activate':
        return await this.handleExecute(message as any);

      case 'interrupt':
        return await this.handleInterrupt();

      case 'health_check':
        return this.handleHealthCheck();

      case 'stop':
        return await this.handleStop();

      case 'user_input':
        return this.handleUserInput(message as any);

      case 'handleMessage':
        return this.handleAgentMessage(message as any);

      default:
        throw new Error(`未知消息类型: ${(message as any).type}`);
    }
  }

  /**
   * 初始化
   */
  private async handleInit(payload: WorkerMessage & { agentId: string; agentType: 'ahive-coder'; modelConfig?: AgentConfig['modelConfig'] }): Promise<WorkerResponse> {
    this.config = {
      agentId: payload.agentId,
      agentType: 'ahive-coder',
      modelConfig: payload.modelConfig,
    };
    
    logger.info(`[AhiveCoderWorker] 初始化完成: ${this.config.agentId}`);
    
    this.status = AgentStatus.Idle;
    
    return {
      type: 'response',
      status: this.status,
      agentId: this.config.agentId,
    };
  }

  /**
   * 执行任务
   */
  private async handleExecute(payload: { prompt: string; systemPrompt?: string; sessionMessages?: Array<{ role: string; content: string }>; modelConfig?: any }): Promise<WorkerResponse> {
    if (!this.executor || !this.llmService) {
      throw new Error('Worker 未初始化完成');
    }

    if (this.status === AgentStatus.Running) {
      throw new Error('Worker 正在执行任务');
    }

    this.status = AgentStatus.Running;
    logger.info(`[AhiveCoderWorker] 开始执行任务`);

    try {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      
      if (payload.systemPrompt) {
        messages.push({ role: 'system', content: payload.systemPrompt });
      }
      
      if (payload.sessionMessages && payload.sessionMessages.length > 0) {
        for (const msg of payload.sessionMessages) {
          messages.push({ role: msg.role as 'system' | 'user' | 'assistant', content: msg.content });
        }
      }
      
      messages.push({ role: 'user', content: payload.prompt });

      const result = await this.executor.execute(this.llmService, {
        systemPrompt: payload.systemPrompt || '',
        userMessage: payload.prompt,
        sessionMessages: messages,
        modelConfig: payload.modelConfig || this.config?.modelConfig,
        onEvent: (event) => {
          this.send({
            type: 'stream_event',
            eventType: event.type,
            data: event,
          });
        },
      });

      this.status = AgentStatus.Idle;
      logger.info(`[AhiveCoderWorker] 任务完成`);

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
    if (this.executor) {
      this.executor.interrupt();
    }
    this.status = AgentStatus.Idle;
    logger.info(`[AhiveCoderWorker] 已中断`);
    
    return {
      type: 'response',
      status: this.status,
    };
  }

  /**
   * 健康检查
   */
  private handleHealthCheck(): WorkerResponse {
    return {
      type: 'health_response',
      status: this.status,
    };
  }

  /**
   * 停止
   */
  private async handleStop(): Promise<WorkerResponse> {
    logger.info(`[AhiveCoderWorker] 正在关闭...`);
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
    };
  }

  /**
   * 用户输入
   */
  private handleUserInput(payload: { input: string }): WorkerResponse {
    if (this.executor && this.status === AgentStatus.Running) {
      this.executor.submitUserInput(payload.input);
      logger.info(`[AhiveCoderWorker] 用户输入已提交`);
    }
    return { type: 'response', success: true };
  }

  /**
   * 智能体间消息
   */
  private handleAgentMessage(payload: { from: string; message: string }): WorkerResponse {
    logger.info(`[AhiveCoderWorker] 收到来自 ${payload.from} 的消息: ${payload.message}`);
    // 可以触发智能体的响应逻辑
    return { type: 'response', success: true };
  }

  /**
   * 发送消息
   */
  private send(response: WorkerResponse): void {
    if (process.send) {
      process.send(response);
    }
  }

  /**
   * 注入工具注册表
   */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    this.executor = new AhiveCoderExecutor(registry, {
      approvalPolicy: 'never',
      dangerousTools: ['exec', 'delete', 'apply_patch'],
      heartbeatIntervalMs: 15000,
    });
    logger.info(`[AhiveCoderWorker] 工具注册表已注入`);
  }

  /**
   * 注入 LLM 服务
   */
  setLLMService(service: AhiveCoderLLMService): void {
    this.llmService = service;
    logger.info(`[AhiveCoderWorker] LLM 服务已注入`);
  }
}

// ==================== 启动 Worker ====================

const worker = new AhiveCoderWorker();

// 导出用于测试
export { AhiveCoderWorker, worker };