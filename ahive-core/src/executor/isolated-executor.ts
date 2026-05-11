/**
 * 隔离执行器 - 通过 IPC 调用子进程中的智能体
 * 
 * 用于进程隔离模式，智能体运行在独立子进程中
 */

import type { AgentExecutor, ExecuteParams, ExecuteResult, StreamCallback, StreamEvent } from './interface.js';
import type { AgentProcessManager } from '../process-manager/AgentProcessManager.js';
import { logger } from '../utils/index.js';

/**
 * 将 AhiveCoderEvent 转换为 StreamEvent
 * 大部分事件类型直接透传，让前端 SSEBridge 处理
 */
function convertAhiveCoderEvent(event: any): StreamEvent {
  // 直接透传的事件类型（前端 SSEBridge 会处理）
  // 注意：agent_message_delta 需要转换为 text_delta，不要透传
  const passthroughTypes = [
    'tool_start', 'tool_end', 'tool_error', 'tool_calls_detected',
    'iteration_start', 'llm_call_start', 'llm_call_end', 'llm_prompt',
    'exec_command_begin', 'exec_command_end',
    'turn_started', 'turn_complete',
    'agent_message'
  ];

  if (passthroughTypes.includes(event.type)) {
    return { ...event } as StreamEvent;
  }

  // 需要特殊处理的事件类型
  switch (event.type) {
    // 文本流式输出 - 转换为 text_delta
    case 'agent_message_delta':
      return { type: 'text_delta' as const, delta: event.delta || '', itemId: event.itemId };

    case 'thinking_delta':
      return { type: 'thinking-delta' as const, delta: event.delta || '', itemId: event.itemId };

    // Shell 命令输出
    case 'exec_command_output_delta':
      return { type: 'exec_output' as const, callId: event.callId || '', output: event.delta || '' };

    // 完成事件
    case 'turn_complete':
      return { type: 'done' as const, content: event.lastAgentMessage || '', toolCallsExecuted: event.toolCallsExecuted || 0, iterations: event.iterations || 0 };

    // 错误和心跳
    case 'error':
      return { type: 'error' as const, error: event.message || 'Unknown error' };
    case 'heartbeat':
      return { type: 'heartbeat' as const, timestamp: event.timestamp || Date.now() };

    // 默认处理：转换为 status 事件
    default:
      return { type: 'status' as const, status: 'info', message: event.type || 'processing' };
  }
}

/**
 * 隔离执行器
 * 
 * 通过 AgentProcessManager 与子进程通信，实现进程隔离的智能体执行
 */
export class IsolatedExecutor implements AgentExecutor {
  private processManager: AgentProcessManager;
  private defaultTimeout: number = 300000; // 5 分钟，与 streamCall 默认值一致

  constructor(processManager: AgentProcessManager) {
    this.processManager = processManager;
  }

/**
    * 执行智能体（非流式）
    */
  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const { agentId, message, userId, appKey, sessionId, systemPrompt, sessionMessages, modelConfig } = params;
    
    logger.info(`[IsolatedExecutor] 执行智能体: ${agentId}`);

    try {
      // 通过 RPC 调用子进程，传递完整参数
      const response = await this.processManager.call(
        agentId,
        'execute',
        { 
          message, 
          userMessage: message,
          userId, 
          appKey,
          sessionId,
          systemPrompt,
          sessionMessages,
          modelConfig,
        },
        this.defaultTimeout
      );

      return {
        content: response.content || '',
        toolCallsExecuted: response.toolCallsExecuted || 0,
        iterations: response.iterations || 0,
        sessionId: response.sessionId,
      };
    } catch (error) {
      logger.error(`[IsolatedExecutor] 执行失败: ${agentId}`, error);
      return {
        content: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
        toolCallsExecuted: 0,
        iterations: 0,
      };
    }
  }

/**
    * 执行智能体（流式）
   * 
   * 使用 streamCall 实现真正的流式 IPC 传输
   */
  async executeStream(
    params: ExecuteParams,
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<ExecuteResult> {
    const { agentId, message, userId, appKey, sessionId, systemPrompt, sessionMessages, modelConfig } = params;
    
    logger.info(`[IsolatedExecutor] 流式执行智能体: ${agentId}`);
    logger.info(`[IsolatedExecutor] 消息: ${message?.substring(0, 50)}...`);

    // 发送详细状态事件
    logger.info(`[IsolatedExecutor] 发送 status 事件...`);
    onEvent({ type: 'status', status: 'thinking', message: '调用模型... (Esc 停止)' });

    try {
      logger.info(`[IsolatedExecutor] 调用 processManager.streamCall...`);
      
      // 使用 streamCall 实现真正的流式传输，传递完整参数
      const response = await this.processManager.streamCall(
        agentId,
        'execute_stream',
        { 
          message, 
          userMessage: message,
          userId, 
          appKey,
          sessionId,
          systemPrompt,
          sessionMessages,
          modelConfig,
        },
        (event) => {
          // 将 IPC 流式事件转换为 StreamEvent 并回调
          // event 格式: { type: eventType, data: actualEventData }
          // 需要合并 type 和 data 得到完整事件对象
          const actualEvent = { type: event.type, ...event.data };
          // 过滤心跳日志，避免刷屏
          if (actualEvent.type !== 'heartbeat') {
            logger.info(`[IsolatedExecutor] 收到流式事件: ${actualEvent.type}`);
          }

          // 转换 AhiveCoderEvent 为 StreamEvent
          const converted = convertAhiveCoderEvent(actualEvent);
          onEvent(converted);
        },
        this.defaultTimeout
      );

      logger.info(`[IsolatedExecutor] streamCall 完成，返回结果`);

      // 响应已通过 onEvent 发送 done 事件，这里返回结果
      return {
        content: response.content || '',
        toolCallsExecuted: response.toolCallsExecuted || 0,
        iterations: response.iterations || 0,
        sessionId: response.sessionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      onEvent({ type: 'error', error: errorMessage });
      
      return {
        content: `执行失败: ${errorMessage}`,
        toolCallsExecuted: 0,
        iterations: 0,
      };
    }
  }
}