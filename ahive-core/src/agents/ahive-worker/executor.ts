/**
 * AHIVE-WORKER 智能体执行器
 * 
 * 特点：
 * - 使用 [TOOL]...[/TOOL] 格式的工具调用
 * - 使用 executeToolLoop 执行循环
 * - Hook 系统集成
 * - 上下文窗口管理（防止超出模型限制）
 */

import { randomUUID } from 'crypto';
import { logger } from '../../utils/index.js';
import type { ToolRegistry } from '../../executor/tool-system.js';
import type { HookEngine } from '../../hooks/index.js';
import { HookEventName, HookToolKind, SessionStartSource } from '../../hooks/index.js';
import { approxTokenCount, truncateMessagesByTokenBudget } from '../../memory/core/utils.js';

/**
 * AhiveWorker 执行器配置
 */
export interface AhiveWorkerExecutorConfig {
  maxIterations: number;
  /** 模型上下文窗口大小 (默认 200000 = 200K tokens) */
  contextWindow: number;
  /** 自动压缩触发比例 (默认 0.9，即 90% contextWindow) */
  autoCompactRatio: number;
  /** 工具结果最大长度（字符），超过则截断 */
  maxToolResultLength: number;
  /** 对话历史 Token 预算 (默认 20K) */
  historyTokenBudget: number;
  /** 心跳间隔 (毫秒) */
  heartbeatIntervalMs?: number;
}

const DEFAULT_CONFIG: AhiveWorkerExecutorConfig = {
  maxIterations: 10,
  contextWindow: 200000,  // 200K tokens
  autoCompactRatio: 0.85, // 85% 时警告，预留更多空间
  maxToolResultLength: 50000, // 50K 字符 ≈ 12.5K tokens
  historyTokenBudget: 20000, // 20K tokens 历史深度
  heartbeatIntervalMs: 15000, // 15秒发送一次心跳
};

export interface AhiveWorkerExecuteOptions {
  systemPrompt: string;
  userMessage: string;
  sessionMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  modelConfig?: any;
  maxIterations?: number;
  onEvent?: (event: any) => void;
  onToolStart?: (name: string, args: any) => void;
  onToolEnd?: (name: string, result: string, success: boolean) => void;
  agentId?: string;
  memorySystem?: any;
}

export interface AhiveWorkerResult {
  content: string;
  iterations: number;
  toolCallsExecuted: number;
}

export class AhiveWorkerExecutor {
  private toolRegistry: ToolRegistry;
  private config: AhiveWorkerExecutorConfig;
  private hookEngine: HookEngine | null = null;
  private onEvent: ((event: any) => void) | null = null;
  private currentTurnId: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private abortController: AbortController | null = null;

  constructor(
    toolRegistry: ToolRegistry,
    options?: Partial<AhiveWorkerExecutorConfig>,
    hookEngine?: HookEngine
  ) {
    this.toolRegistry = toolRegistry;
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.hookEngine = hookEngine ?? null;
  }

  setHookEngine(hookEngine: HookEngine): void {
    this.hookEngine = hookEngine;
  }

  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * 获取工具注册中心
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  private emit(type: string, data: any): void {
    if (this.onEvent) {
      this.onEvent({ type, ...data, timestamp: Date.now(), turnId: this.currentTurnId });
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.config.heartbeatIntervalMs && this.config.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        this.emit('heartbeat', {});
      }, this.config.heartbeatIntervalMs);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async execute(
    llmService: {
      chat: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, config?: any) => Promise<{
        content: string;
        toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        finishReason?: string;
        reasoningContent?: string;
      }>;
      chatStream?: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, onDelta: (delta: string) => void, config?: any, onThinkingDelta?: (delta: string) => void) => Promise<{
        content: string;
        toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        finishReason?: string;
        reasoningContent?: string;
      }>;
    },
    options: AhiveWorkerExecuteOptions
  ): Promise<AhiveWorkerResult> {
    const { systemPrompt, userMessage, sessionMessages, modelConfig, maxIterations, onEvent, agentId, memorySystem } = options;

    this.onEvent = onEvent || null;

    // 🧠 加载历史记忆
    let memoryContext = '';
    if (memorySystem && agentId) {
      try {
        // 🔧 修复：增加加载数量到 100，利用 Token 预算进行动态截断
        const memoryItems = await memorySystem.getRecentRolloutItems(agentId, 'ahive-worker', 100);
        if (memoryItems && memoryItems.length > 0) {
          // 🔧 修复：使用 historyTokenBudget 进行 token-based 截断，不再固定 500 字符
          memoryContext = this.formatMemoryAsHistory(memoryItems, this.config.historyTokenBudget);
          logger.info(`[AhiveWorker] 加载了 ${memoryItems.length} 条历史记忆 (预算: ${this.config.historyTokenBudget} tokens)`);
        }
      } catch (error) {
        logger.warn('[AhiveWorker] 加载记忆失败:', error);
      }
    }

    // 构建消息
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (memoryContext) {
      messages.push({ role: 'system', content: `## 历史对话记忆\n\n${memoryContext}` });
    }

    messages.push(...(sessionMessages || []));
    messages.push({ role: 'user', content: userMessage });

    this.currentTurnId = `turn_${randomUUID().slice(0, 8)}`;

    this.startHeartbeat();

    // ========== SessionStart Hook ==========
    if (this.hookEngine) {
      try {
        const sessionStartOutcome = await this.hookEngine.runSessionStart({
          sessionId: this.currentTurnId,
          cwd: process.cwd(),
          model: modelConfig?.model || 'unknown',
          permissionMode: 'default',
          source: SessionStartSource.Startup,
        });

        if (sessionStartOutcome.shouldStop) {
          logger.warn(`[AhiveWorker] SessionStart Hook 请求停止: ${sessionStartOutcome.stopReason}`);
          return {
            content: sessionStartOutcome.stopReason || 'Hook stopped session',
            iterations: 0,
            toolCallsExecuted: 0,
          };
        }

        if (sessionStartOutcome.additionalContext) {
          messages.push({ role: 'system', content: `Hook 注入上下文:\n${sessionStartOutcome.additionalContext}` });
        }
      } catch (hookError) {
        logger.warn('[AhiveWorker] SessionStart Hook 执行失败:', hookError);
      }
    }

    const maxIter = maxIterations || this.config.maxIterations;
    let iterations = 0;
    let totalToolCalls = 0;
    let lastContent = '';
    let accumulatedAssistantText = '';

    this.abortController = new AbortController();
    this.emit('turn_started', {});

    try {
      while (iterations < maxIter) {
        iterations++;

        // 中断检查
        if (this.abortController?.signal.aborted) {
          this.emit('turn_aborted', { reason: 'interrupted' });
          break;
        }

        this.emit('iteration_start', { iteration: iterations });
        logger.info(`[AhiveWorker] 迭代 ${iterations}/${maxIter}`);

        // 🆕 检查上下文长度，防止超出模型限制
        const estimatedTokens = this.estimateMessagesTokens(messages);
        const tokenLimit = Math.floor(this.config.contextWindow * this.config.autoCompactRatio);

        if (estimatedTokens >= tokenLimit) {
          logger.warn(`[AhiveWorker] ⚠️ 上下文接近限制: ${estimatedTokens} >= ${tokenLimit} tokens，尝试截断历史...`);
          this.truncateMessagesToFit(messages);

          const newTokens = this.estimateMessagesTokens(messages);
          logger.info(`[AhiveWorker] 截断后: ${newTokens} tokens`);

          if (newTokens >= tokenLimit) {
            logger.error(`[AhiveWorker] ❌ 上下文仍然过大，强制结束本次对话`);
            this.emit('agent_message', { content: '抱歉，上下文已超出模型处理能力。请尝试精简任务或分批处理。' });
            break;
          }
        }

        // 调用 LLM
        this.emit('llm_call_start', {});

        // 发射提示词事件，供前端展示
        const promptCategories: Record<string, Array<{ role: string; content: string }>> = {
          system: [],
          user: [],
          assistant: [],
        };
        for (const msg of messages) {
          const category = promptCategories[msg.role] || promptCategories.user;
          category.push({ role: msg.role, content: msg.content });
        }
        this.emit('llm_prompt', {
          messages,
          categories: promptCategories,
          totalMessages: messages.length,
        });

        // 🔧 Issue 3 修复：LLM 调用添加 try/catch 保护
        let response: { content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; finishReason?: string; reasoningContent?: string };
        try {
          if (llmService.chatStream) {
            const itemId = `msg_${randomUUID().slice(0, 8)}`;
            response = await llmService.chatStream(
              messages,
              (delta: string) => {
                this.emit('agent_message_delta', { itemId, delta });
              },
              modelConfig,
              (thinkingDelta: string) => {
                this.emit('thinking_delta', { itemId, delta: thinkingDelta });
              }
            );
          } else {
            response = await llmService.chat(messages, modelConfig);
            if (response.content) {
              const itemId = `msg_${randomUUID().slice(0, 8)}`;
              const chunkSize = 100;
              for (let i = 0; i < response.content.length; i += chunkSize) {
                const delta = response.content.slice(i, i + chunkSize);
                this.emit('agent_message_delta', { itemId, delta });
              }
            }
          }
        } catch (llmError) {
          const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
          logger.error(`[AhiveWorker] LLM 调用失败: ${errMsg}`);
          this.emit('error', { message: `LLM 调用失败: ${errMsg}` });

          // 优先检查中断信号——用户中断不应被视为可恢复错误
          if (this.abortController?.signal.aborted) {
            throw llmError;
          }

          // 🔧 可恢复的错误：注入错误信息让 LLM 知道，而不是直接终止
          const isRecoverable =
            errMsg.includes('429') ||
            errMsg.includes('503') ||
            errMsg.includes('502') ||
            errMsg.includes('timeout') ||
            errMsg.includes('ECONNRESET') ||
            errMsg.includes('ETIMEDOUT') ||
            errMsg.includes('ECONNREFUSED') ||
            errMsg.includes('fetch failed') ||
            errMsg.includes('socket hang up');

          if (isRecoverable && iterations < maxIter - 1) {
            messages.push({ role: 'user', content: `[系统提示] LLM 服务暂时不可用: ${errMsg}。请稍等后重试。` });
            logger.warn(`[AhiveWorker] LLM 调用失败但可恢复，继续循环 (iteration ${iterations})`);
            continue;
          }

          throw llmError;
        }

        this.emit('llm_call_end', {});
        lastContent = response.content;
        let currentFullContent = accumulatedAssistantText + lastContent;

        // 提取工具调用（支持两种格式）
        const toolCalls = this.extractToolCalls({ ...response, content: currentFullContent });

        if (toolCalls.length === 0) {
          if (response.finishReason === 'length') {
            if (accumulatedAssistantText) {
              messages.pop(); // 去掉 '请继续完成你的回答。'
              messages.pop(); // 去掉 assistant 截断文本
            }
            messages.push({ role: 'assistant', content: currentFullContent || '' });
            messages.push({ role: 'user', content: '请继续完成你的回答。' });
            accumulatedAssistantText = currentFullContent;
            logger.info(`[AhiveWorker] 输出被截断 (finish_reason=length)，提示继续`);
            continue;
          }

          if (accumulatedAssistantText) {
            messages.pop();
            messages.pop();
            lastContent = currentFullContent;
          }
          // 无工具调用，完成
          this.emit('agent_message', { content: lastContent });
          break;
        }

        this.emit('tool_calls_detected', { count: toolCalls.length });
        totalToolCalls += toolCalls.length;

        if (accumulatedAssistantText) {
          messages.pop(); // 去掉用户提示的 '请继续完成你的回答。'
          messages.pop(); // 去掉之前的部分 assistant 回复
        }
        messages.push({ role: 'assistant', content: currentFullContent });
        accumulatedAssistantText = '';

        // 执行工具
        for (const call of toolCalls) {
          const tool = this.toolRegistry.get(call.name);

          if (!tool) {
            logger.warn(`[AhiveWorker] 工具不存在: ${call.name}`);
            this.emit('tool_error', { toolName: call.name, error: '工具不存在' });
            messages.push({
              role: 'user',
              content: `[工具结果] ${call.name}: 错误 - 工具不存在`,
            });
            continue;
          }

          try {
            this.emit('tool_start', { toolName: call.name, args: call.arguments });
            logger.info(`[AhiveWorker] 🔧 执行工具: ${call.name}`);

            const result = await tool.execute(call.id, call.arguments);
            const success = result && typeof result === 'object' && 'success' in result ? (result as any).success !== false : true;
            let content = this.extractResultContent(result);

            // 🆕 截断过长的工具结果
            if (content.length > this.config.maxToolResultLength) {
              const truncated = content.length - this.config.maxToolResultLength;
              content = content.slice(0, this.config.maxToolResultLength) + `\n\n... (已截断 ${truncated} 字符)`;
              logger.info(`[AhiveWorker] 工具结果已截断: ${call.name}`);
            }

            this.emit('tool_end', { toolName: call.name, success, result: content });
            logger.info(`[AhiveWorker] ${success ? '✅' : '❌'} 工具完成: ${call.name}`);

            // ========== AfterToolUse Hook ==========
            if (this.hookEngine && this.currentTurnId) {
              try {
                await this.hookEngine.runAfterToolUse({
                  sessionId: this.currentTurnId,
                  turnId: this.currentTurnId,
                  callId: call.id || `tc_${randomUUID().slice(0, 8)}`,
                  toolName: call.name,
                  toolKind: HookToolKind.Function,
                  toolInput: { inputType: 'function', arguments: JSON.stringify(call.arguments) },
                  executed: true,
                  success,
                  durationMs: 0,
                  mutating: ['exec', 'write_file', 'delete', 'edit_file'].includes(call.name),
                  sandbox: 'none',
                  sandboxPolicy: 'default',
                  outputPreview: content.slice(0, 200),
                }, process.cwd());
              } catch (hookError) {
                logger.warn('[AhiveWorker] AfterToolUse Hook 执行失败:', hookError);
              }
            }

            messages.push({
              role: 'user',
              content: `[工具结果] ${call.name}:\n${content}`,
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.emit('tool_error', { toolName: call.name, error: errorMsg });
            logger.error(`[AhiveWorker] 工具错误: ${call.name} - ${errorMsg}`);
            messages.push({
              role: 'user',
              content: `[工具结果] ${call.name}: 错误 - ${errorMsg}`,
            });
          }
        }
      }
    } catch (error) {
      // 🔧 Issue 3 修复：捕获未预期的异常，记录日志后重新抛出
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[AhiveWorker] 执行异常: ${errorMsg}`);
      this.emit('turn_aborted', { reason: errorMsg });
      throw error;
    } finally {
      // 🔧 确保清理定时器和状态
      this.stopHeartbeat();
      this.abortController = null;
      this.currentTurnId = null;
    }

    this.emit('turn_complete', { iterations, toolCallsExecuted: totalToolCalls });

    // 🧠 记录对话到记忆系统
    if (memorySystem && agentId) {
      try {
        await memorySystem.recordMessage(agentId, 'ahive-worker', 'user', userMessage);
        if (lastContent) {
          await memorySystem.recordMessage(agentId, 'ahive-worker', 'assistant', lastContent);
        }
        logger.info(`[AhiveWorker] 对话已记录到记忆系统`);
      } catch (error) {
        logger.warn('[AhiveWorker] 记录记忆失败:', error);
      }
    }

    // ========== Stop Hook ==========
    if (this.hookEngine && this.currentTurnId) {
      try {
        await this.hookEngine.runStop({
          sessionId: this.currentTurnId,
          turnId: this.currentTurnId,
          cwd: process.cwd(),
          model: modelConfig?.model || 'unknown',
          permissionMode: 'default',
          stopHookActive: false,
          lastAssistantMessage: lastContent,
        });
      } catch (hookError) {
        logger.warn('[AhiveWorker] Stop Hook 执行失败:', hookError);
      }
    }

    // ========== AfterAgent Hook ==========
    if (this.hookEngine && agentId && this.currentTurnId) {
      try {
        await this.hookEngine.runAfterAgent({
          sessionId: this.currentTurnId,
          threadId: agentId,
          turnId: this.currentTurnId,
          inputMessages: [userMessage],
          lastAssistantMessage: lastContent,
        }, process.cwd());
      } catch (hookError) {
        logger.warn('[AhiveWorker] AfterAgent Hook 执行失败:', hookError);
      }
    }

    return {
      content: lastContent,
      iterations,
      toolCallsExecuted: totalToolCalls,
    };
  }

  /**
   * 格式化记忆为历史对话
   * 🔧 修复：使用 Token 预算动态截断，不再强制每条 500 字符
   */
  private formatMemoryAsHistory(items: any[], tokenBudget: number = 10000): string {
    if (!items || items.length === 0) return '';

    // 将 items 转换为通用消息格式进行预算截断
    const genericMessages = items.map(item => {
      if (item.type === 'compacted' && item.summary) {
        return { role: 'system', content: `[摘要] ${item.summary}` };
      }
      return { role: item.role, content: item.content || '' };
    }).filter(m => m.role && m.content);

    // 使用工具函数进行预算截断（保留最近消息）
    const truncated = truncateMessagesByTokenBudget(genericMessages as any, tokenBudget);

    const lines: string[] = [];
    for (const msg of truncated) {
      const role = msg.role === 'user' ? '用户' : (msg.role === 'system' ? '系统' : '助手');
      lines.push(`[${role}] ${msg.content}`);
    }

    return lines.join('\n\n');
  }

  /**
   * 提取工具调用（支持 Function Calling 和文本格式）
   */
  private extractToolCalls(response: {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

    // 1. 优先检查 Function Calling 格式
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        toolCalls.push({
          id: tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.name,
          arguments: tc.arguments || {},
        });
      }
      logger.info(`[AhiveWorker] 从 Function Calling 提取 ${toolCalls.length} 个工具调用`);
      return toolCalls;
    }

    // 2. 从文本中提取 [TOOL]...[/TOOL] 格式
    const content = response.content || '';
    const pattern = /\[TOOL\]([\s\S]*?)\[\/TOOL\]/g;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name && typeof parsed.name === 'string') {
          toolCalls.push({
            id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: parsed.name,
            arguments: parsed.arguments || parsed.params || {},
          });
        }
      } catch (e) {
        // JSON 解析失败，忽略
      }
    }

    if (toolCalls.length > 0) {
      logger.info(`[AhiveWorker] 从文本格式提取 ${toolCalls.length} 个工具调用`);
    }

    return toolCalls;
  }

  private extractResultContent(result: any): string {
    if (!result) return '(无输出)';

    if (typeof result === 'string') return result;

    if (typeof result === 'object') {
      if ('content' in result) {
        const content = result.content;
        if (Array.isArray(content)) {
          return content.map((c: any) => {
            if (c.type === 'image' && c.data && c.mimeType) return `[图片: ${c.mimeType}, ${Math.round(c.data.length * 0.75 / 1024)}KB]`;
            return c.text || '';
          }).join('\n');
        }
        return String(content);
      }
      return JSON.stringify(result, null, 2);
    }

    return String(result);
  }

  /**
   * 估算消息列表的总 token 数
   * 🔧 修复：使用正确的 approxTokenCount 处理中英文
   */
  private estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
    const allContent = messages.map(msg => msg.content || '').join('');
    // 每条消息有约 4 个 token 的格式开销
    return approxTokenCount(allContent) + (messages.length * 4);
  }

  /**
   * 截断消息列表以适应上下文窗口
   * 策略：保留系统消息和最近的对话，删除中间的历史消息
   */
  private truncateMessagesToFit(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): void {
    const targetTokens = Math.floor(this.config.contextWindow * 0.7); // 目标 70%

    // 分离系统消息和对话消息
    const systemMessages = messages.filter(m => m.role === 'system');
    const dialogMessages = messages.filter(m => m.role !== 'system');

    // 计算系统消息的 token
    const systemTokens = this.estimateMessagesTokens(systemMessages);
    const availableTokens = targetTokens - systemTokens;

    // 从最新的消息开始保留
    const preservedDialog: typeof dialogMessages = [];
    let currentTokens = 0;

    for (let i = dialogMessages.length - 1; i >= 0; i--) {
      const msg = dialogMessages[i];
      const msgTokens = approxTokenCount(msg.content || '') + 4;

      if (currentTokens + msgTokens <= availableTokens) {
        preservedDialog.unshift(msg);
        currentTokens += msgTokens;
      } else {
        // 空间不足，停止添加
        break;
      }
    }

    // 如果删除了一些消息，添加提示
    const removedCount = dialogMessages.length - preservedDialog.length;
    if (removedCount > 0) {
      logger.info(`[AhiveWorker] 截断了 ${removedCount} 条历史消息`);
    }

    // 重建消息列表
    messages.length = 0;
    messages.push(...systemMessages, ...preservedDialog);
  }
}

export function createAhiveWorkerExecutor(toolRegistry: ToolRegistry, options?: Partial<AhiveWorkerExecutorConfig>): AhiveWorkerExecutor {
  return new AhiveWorkerExecutor(toolRegistry, options);
}