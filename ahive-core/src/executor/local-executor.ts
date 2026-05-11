/**
 * 本地执行器 - 在同一进程中执行智能体
 * 封装 UnifiedAgentSystem，实现 AgentExecutor 接口
 */

import type { AgentExecutor, ExecuteParams, ExecuteResult, StreamCallback, StreamEvent } from './interface.js';
import type { ProviderManager } from '../providers/provider-manager.js';
import type { AhiveCoderLLMService } from '../agents/ahive-coder/executor.js';
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
 * 本地执行器实现
 * 在主进程中直接调用 UnifiedAgentSystem
 */
export class LocalExecutor implements AgentExecutor {
  private unifiedAgentSystem: any;
  private ahiveCoderExecutor: any;
  private providerManager: ProviderManager | null = null;

  constructor(unifiedAgentSystem?: any, ahiveCoderExecutor?: any, providerManager?: ProviderManager) {
    this.unifiedAgentSystem = unifiedAgentSystem;
    this.ahiveCoderExecutor = ahiveCoderExecutor;
    this.providerManager = providerManager || null;
  }

  /**
   * 设置 ProviderManager
   */
  setProviderManager(providerManager: ProviderManager): void {
    this.providerManager = providerManager;
    logger.info('[LocalExecutor] ProviderManager 已设置');
  }

  /**
   * 执行智能体（非流式）
   */
  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const { agentId, message, userId, appKey } = params;
    
    try {
      if (!this.unifiedAgentSystem) {
        throw new Error('UnifiedAgentSystem not initialized');
      }
      
      const result = await this.unifiedAgentSystem.executeChat(agentId, message, {
        userId,
        appKey,
      });
      
      return {
        content: result.content,
        toolCallsExecuted: result.toolCalls?.length || 0,
        iterations: 1,
        sessionId: result.sessionId,
      };
    } catch (error) {
      logger.error(`执行失败: ${agentId}`, error);
      return {
        content: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
        toolCallsExecuted: 0,
        iterations: 0,
      };
    }
  }

  /**
   * 执行智能体（流式）
   */
  async executeStream(
    params: ExecuteParams,
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<ExecuteResult> {
    const { agentId, message, userId, appKey } = params;
    
    try {
      if (!this.unifiedAgentSystem) {
        throw new Error('UnifiedAgentSystem not initialized');
      }

      onEvent({ type: 'status', status: 'thinking', message: '开始处理...' });

      // 获取智能体类型
      const agentType = this.unifiedAgentSystem.getType(agentId);
      
      // 获取会话消息和模型配置
      const sessionMessages = this.unifiedAgentSystem.getSessionMessages(agentId);
      const modelConfig = this.unifiedAgentSystem.getModelConfig(agentId);
      const systemPrompt = await this.unifiedAgentSystem.buildSystemPromptWithMemory(agentId);

      let result: ExecuteResult;

if ((agentType === 'ahive-coder' || agentType === 'ahive-worker') && this.ahiveCoderExecutor) {
      // AHIVE-CODER / AHIVE-WORKER 类型：统一使用 AhiveCoderExecutor
        onEvent({ type: 'status', status: 'thinking', message: `使用 ${agentType} 执行器` });
        
        if (!this.providerManager) {
          throw new Error('ProviderManager not configured - call setProviderManager() first');
        }

      const llmService: AhiveCoderLLMService = {
          chat: async (messages, config) => {
            const response = await this.providerManager!.chat(messages, config);
            return {
              content: response.content,
              toolCalls: response.toolCalls,
              finishReason: response.finishReason,
              reasoningContent: response.reasoningContent,
            };
          },
          chatStream: async (messages, onDelta, config, onThinkingDelta) => {
            const response = await this.providerManager!.chatStream(messages, onDelta, config, onThinkingDelta);
            return {
              content: response.content,
              toolCalls: response.toolCalls,
              finishReason: response.finishReason,
              reasoningContent: response.reasoningContent,
            };
          },
        };

      const loopResult = await this.ahiveCoderExecutor.execute(
          llmService,
          {
            systemPrompt,
            userMessage: message,
            sessionMessages,
            modelConfig,
            onEvent: (event: any) => {
              const converted = convertAhiveCoderEvent(event);
              onEvent(converted);
            },
          }
        );

        result = {
          content: loopResult.content,
          toolCallsExecuted: loopResult.toolCallsExecuted,
          iterations: loopResult.iterations,
        };
      } else {
        // 其他类型：使用 UnifiedAgentSystem
        onEvent({ type: 'status', status: 'thinking', message: '使用统一智能体系统' });
        
        const chatResult = await this.unifiedAgentSystem.executeChat(agentId, message, {
          userId,
          appKey,
        });

        result = {
          content: chatResult.content,
          toolCallsExecuted: chatResult.toolCalls?.length || 0,
          iterations: 1,
          sessionId: chatResult.sessionId,
        };
      }

      // 更新会话历史
      this.unifiedAgentSystem.appendSessionMessages(agentId, [
        { role: 'user', content: message },
        { role: 'assistant', content: result.content },
      ]);

      onEvent({
        type: 'done',
        content: result.content,
        toolCallsExecuted: result.toolCallsExecuted,
        iterations: result.iterations,
      });

      return result;

    } catch (error) {
      logger.error(`流式执行失败: ${agentId}`, error);
      onEvent({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        content: '',
        toolCallsExecuted: 0,
        iterations: 0,
      };
    }
  }
}