/**
 * AHIVE-CODER 智能体执行器
 * 
 * 完全对齐 CODEX 官方实现 (codex-rs/core/src/codex.rs)
 * 
 * 特点：
 * - 使用 OpenAI Function Calling 格式
 * - 完整的事件流系统 (与 CODEX 官方对齐)
 * - 并行工具执行 (类似 FuturesOrdered)
 * - Windows PowerShell 命令支持
 * - Hook 系统集成
 * 
 * 参考：codex-rs/core/src/codex.rs, codex-rs/protocol/src/protocol.rs
 */

import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { logger, createLogger } from '../../utils/index.js';
import type { ToolRegistry, ToolCallRequest, AgentTool } from '../../executor/tool-system.js';
import { getWSClient } from '../../monitoring/ws-client.js';

// 创建专用日志器
const log = createLogger({ module: 'AhiveCoder' });
import { isDangerousCommand, DEFAULT_SANDBOX_POLICY } from '../../sandbox/policy.js';
import type { HookEngine } from '../../hooks/index.js';
import { HookEventName, HookToolKind, SessionStartSource, type HookToolInput } from '../../hooks/index.js';
import { approxTokenCount, approxTokenCountFromCharCount, truncateMessagesByTokenBudget } from '../../memory/core/utils.js';
import type { RolloutItem, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, COMPACTABLE_TOOLS } from '../../memory/core/types.js';
import { LAYER1_TURN_COUNT, LAYER2_TURN_COUNT, LAYER_TOKEN_LIMIT } from '../../memory/core/types.js';

// ============ 内部消息类型（支持轮次分组） ============

/** 多模态内容块 */
interface MultiModalContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

const globalProcessCwd = process.cwd();

/** 内部消息结构（带 turnId 和结构化内容） */
interface InternalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MultiModalContent[];  // 支持纯文本或多模态内容数组
  contentBlocks?: ContentBlock[];  // 结构化内容块（用于压缩处理）
  turnId?: string;  // 轮次标识
  isToolResult?: boolean;  // 是否为工具结果
  toolName?: string;  // 工具名称
}

/** LLM 消息格式（支持多模态） */
type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string | MultiModalContent[] };

// ============ 消息辅助函数 ============

/** 创建用户文本消息 */
function createUserTextMessage(turnId: string, text: string): InternalMessage {
  return {
    role: 'user',
    content: text,
    contentBlocks: [{ type: 'text', text } as TextBlock],
    turnId,
  };
}

/** 创建助手文本消息 */
function createAssistantTextMessage(turnId: string, text: string): InternalMessage {
  return {
    role: 'assistant',
    content: text,
    contentBlocks: [{ type: 'text', text } as TextBlock],
    turnId,
  };
}

/** 创建系统消息 */
function createSystemMessage(text: string): InternalMessage {
  return {
    role: 'system',
    content: text,
  };
}

/** 创建助手工具调用消息 */
function createAssistantToolUseMessage(turnId: string, text: string, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): InternalMessage {
  const blocks: ContentBlock[] = [];
  if (text) {
    blocks.push({ type: 'text', text } as TextBlock);
  }
  for (const tc of toolCalls) {
    blocks.push({
      type: 'tool_use',
      tool_use_id: tc.id,
      tool_name: tc.name,
      tool_input: tc.arguments,
    } as ToolUseBlock);
  }

  // 🔧 保持旧版格式：content 直接用原始文本，不编码 XML
  // contentBlocks 用于压缩机制（增量功能）
  return {
    role: 'assistant',
    content: text || '',
    contentBlocks: blocks,
    turnId,
  };
}

/** 工具调用统计信息 */
interface ToolCallStats {
  toolName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  lastResults: Array<{ success: boolean; timestamp: number }>;
}

/** 创建工具结果消息（带执行统计） */
function createToolResultMessage(
  turnId: string,
  toolUseId: string,
  toolName: string,
  output: string,
  isError?: boolean,
  stats?: ToolCallStats,
  images?: Array<{ data: string; mimeType: string }>
): InternalMessage {
  // 🔧 增强格式：注入执行统计信息，帮助 LLM 判断循环
  let content = `[工具结果] ${toolName}:\n${output}`;

  // 如果有统计信息，注入历史提示
  if (stats && stats.callCount > 1) {
    const recentFailures = stats.lastResults.slice(-5).filter(r => !r.success).length;
    const successRate = Math.round((stats.successCount / stats.callCount) * 100);

    // 构建统计提示
    const statsPrompt = `\n\n📊 执行统计: 第${stats.callCount}次调用此工具，成功率${successRate}%`;

    if (recentFailures >= 3) {
      // 连续失败3次以上，强提示
      content += statsPrompt + `\n⚠️ 提示: 该工具最近5次调用中失败${recentFailures}次。`;
      content += `\n💡 建议: 相同策略连续失败，请考虑更换方法或向用户报告障碍。`;
    } else if (successRate < 50 && stats.callCount >= 5) {
      // 成功率低但调用次数多，提示换策略
      content += statsPrompt + `\n⚠️ 提示: 该工具成功率较低(${successRate}%)，已尝试${stats.callCount}次。`;
      content += `\n💡 建议: 请评估是否需要换用其他方法完成任务。`;
    } else if (stats.callCount >= 10) {
      // 单个工具调用次数过多，提示可能陷入循环
      content += statsPrompt + `\n⚠️ 提示: 该工具已调用${stats.callCount}次。`;
      content += `\n💡 建议: 请检查任务进展，若停滞不前请向用户报告。`;
    } else {
      content += statsPrompt;
    }
  }

  // 构建多模态 content
  let messageContent: string | MultiModalContent[] = content;
  if (images && images.length > 0) {
    const parts: MultiModalContent[] = [
      { type: 'text', text: content },
    ];
    for (const img of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
      });
    }
    messageContent = parts;
  }

  return {
    role: 'user',
    content: messageContent,
    contentBlocks: [{
      type: 'tool_result',
      tool_use_id: toolUseId,
      tool_name: toolName,
      tool_output: output,
      is_error: isError,
    } as ToolResultBlock],
    turnId,
    isToolResult: true,
    toolName,
  };
}

/** 将内部消息转换为 LLM 格式 */
function toLLMMessages(messages: InternalMessage[]): LLMMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content }));
}

/** 获取消息内容的文本长度（兼容多模态） */
function getContentLength(content: string | MultiModalContent[]): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((sum, c) => sum + (c.text?.length || 0), 0);
}

/** 获取消息内容的纯文本（兼容多模态） */
function getContentAsText(content: string | MultiModalContent[]): string {
  if (typeof content === 'string') return content;
  return content.filter(c => c.type === 'text' && c.text).map(c => c.text!).join('\n');
}

/** 截断消息内容（兼容多模态） */
function truncateContent(content: string | MultiModalContent[], maxLen: number, suffix: string = ''): string | MultiModalContent[] {
  if (typeof content === 'string') {
    return content.length > maxLen ? content.slice(0, maxLen) + suffix : content;
  }
  // 多模态内容只截断文本部分
  const text = getContentAsText(content);
  if (text.length <= maxLen) return content;
  return [{ type: 'text', text: text.slice(0, maxLen) + suffix }];
}

/** 按轮次分组消息 */
function groupMessagesByTurn(messages: InternalMessage[]): Map<string, InternalMessage[]> {
  const turns = new Map<string, InternalMessage[]>();
  for (const msg of messages) {
    if (!msg.turnId) {
      // 系统消息没有 turnId，单独处理
      const systemTurn = turns.get('system') || [];
      systemTurn.push(msg);
      turns.set('system', systemTurn);
    } else {
      const turnMessages = turns.get(msg.turnId) || [];
      turnMessages.push(msg);
      turns.set(msg.turnId, turnMessages);
    }
  }
  return turns;
}

/** 获取最近N轮对话（排除系统消息轮次） */
function getRecentTurns(messages: InternalMessage[], n: number): InternalMessage[] {
  const turns = groupMessagesByTurn(messages);
  const turnIds = Array.from(turns.keys()).filter(id => id !== 'system');
  const recentTurnIds = turnIds.slice(-n);

  // 返回系统消息 + 最近N轮
  const result: InternalMessage[] = [];
  const systemMessages = turns.get('system') || [];
  result.push(...systemMessages);

  for (const id of recentTurnIds) {
    result.push(...(turns.get(id) || []));
  }

  return result;
}

// ============ 事件类型定义 (对齐 CODEX 官方 EventMsg) ============

/**
 * AHIVE-CODER 事件类型
 * 参考: codex-rs/protocol/src/protocol.rs:1137 EventMsg
 */
export type AhiveCoderEventType =
  | 'error'
  | 'warning'
  | 'turn_started'
  | 'turn_complete'
  | 'turn_aborted'
  | 'token_count'
  | 'agent_message'
  | 'agent_message_delta'
  | 'thinking_delta'
  | 'user_message'
  | 'user_input'
  | 'tool_start'
  | 'tool_end'
  | 'tool_error'
  | 'tool_calls_detected'
  | 'exec_command_begin'
  | 'exec_command_output_delta'
  | 'exec_command_end'
  | 'heartbeat'
  | 'iteration_start'
  | 'llm_call_start'
  | 'llm_call_end'
  | 'llm_prompt'
  | 'context_compacted'
  | 'stream_error';

export interface AhiveCoderEvent {
  type: AhiveCoderEventType;
  timestamp: number;
  turnId: string;
  [key: string]: any;
}

/** AHIVE-CODER LLM 服务接口 */
export interface AhiveCoderLLMService {
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | MultiModalContent[] }>, config?: any): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    finishReason?: string;
    reasoningContent?: string;
  }>;
  chatStream?(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | MultiModalContent[] }>, onDelta: (delta: string) => void, config?: any, onThinkingDelta?: (delta: string) => void): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    finishReason?: string;
    reasoningContent?: string;
  }>;
}

/** AHIVE-CODER 执行选项 */
export interface AhiveCoderExecuteOptions {
  systemPrompt: string;
  userMessage: string;
  sessionMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  modelConfig?: any;
  onEvent: (event: AhiveCoderEvent) => void;
  agentId?: string;
  memorySystem?: any;
  memorySpace?: string;  // 记忆空间名称（如 'ahive-coder', 'core'）
}

export interface AhiveCoderExecutorConfig {
  approvalPolicy: 'never' | 'on_request' | 'on_dangerous';
  dangerousTools: string[];
  heartbeatIntervalMs: number;
  execTimeoutMs: number;
  /** 工具结果最大长度（字符），超过则截断 */
  maxToolResultLength: number;
  /** 是否并行执行工具 */
  parallelToolExecution: boolean;
  /** 自动压缩触发 token 阈值（绝对值，优先使用） */
  autoCompactTokenLimit?: number;
  /** 自动压缩触发比例 (默认 0.9，即 90% contextWindow) */
  autoCompactRatio: number;
  /** 模型上下文窗口大小 (默认 200000 = 200K tokens) */
  contextWindow: number;
  /** 压缩时保留最近用户消息的 token 预算 */
  compactUserMessageMaxTokens: number;
  /** 对话历史 Token 预算 (默认 50K) */
  historyTokenBudget: number;
  /** 初始上下文注入策略 */
  initialContextInjection?: 'none' | 'before_summary' | 'after_summary';
}

const DEFAULT_CONFIG: AhiveCoderExecutorConfig = {
  approvalPolicy: 'never',
  dangerousTools: ['exec', 'delete', 'apply_patch'],
  heartbeatIntervalMs: 15000,
  execTimeoutMs: 120000,
  maxToolResultLength: 50000,
  parallelToolExecution: true,  // 默认并行执行
  autoCompactTokenLimit: undefined,  // 未设置时使用 autoCompactRatio 计算
  autoCompactRatio: 0.9,  // 90% 时触发压缩
  contextWindow: 200000,  // 200K tokens
  compactUserMessageMaxTokens: 20000,  // 20K tokens
  historyTokenBudget: 50000,  // 50K tokens 历史深度
  initialContextInjection: 'after_summary',  // 默认摘要后重注入
};

// ============ 工具执行结果类型 ============

interface ToolExecutionResult {
  callId: string;
  toolName: string;
  content: string;
  success: boolean;
  images?: Array<{ data: string; mimeType: string }>;
  _taskCompleted?: boolean;
  _waitingForUser?: boolean;
}

// ============ CODEX 执行器 ============

export class AhiveCoderExecutor {
  private config: AhiveCoderExecutorConfig;
  private toolRegistry: ToolRegistry;
  private hookEngine: HookEngine | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private currentTurnId: string | null = null;
  private onEvent: ((event: AhiveCoderEvent) => void) | null = null;
  private abortController: AbortController | null = null;
  private pendingUserInputs: string[] = [];
  /** E-7: 防止同一 turn 多次压缩 */
  private compactedThisTurn: boolean = false;
  /** 任务完成状态跟踪 */
  private taskCompletionState = {
    consecutiveNoToolCalls: 0,
    lastResponseContent: '',
    detectedComplete: false,
  };
  /** 🔧 新增：记忆系统引用，用于运行时压缩持久化 */
  private memorySystem: any = null;
  /** 🔧 新增：智能体 ID，用于持久化 */
  private agentId: string | null = null;
  /** 🔧 新增：记忆空间，用于持久化 */
  private memorySpace: string = 'ahive-coder';
  /** 内存中的对话历史，跨execute()复用（参照CODEX SessionState.history） */
  private conversationHistory: InternalMessage[] = [];
  /** history是否已初始化（冷启动从文件读，热续从内存复用） */
  private historyInitialized: boolean = false;
  /** 🔧 新增：工具调用历史统计，用于循环检测提示 */
  private toolCallHistory: Map<string, ToolCallStats> = new Map();
  /** IDE 传入的工作目录 */
  private _workdir: string | null = null;

  set workdir(val: string | null) { this._workdir = val; }
  get workdir(): string { return this._workdir || globalProcessCwd; }

  clearHistory(): void {
    this.conversationHistory = [];
    this.historyInitialized = false;
    log.info('[AhiveCoderExecutor] 内存上下文已清空');
  }

  constructor(
    toolRegistry: ToolRegistry,
    config?: Partial<AhiveCoderExecutorConfig>,
    hookEngine?: HookEngine
  ) {
    this.toolRegistry = toolRegistry;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hookEngine = hookEngine ?? null;
  }

  /**
   * 设置 Hook 引擎
   */
  setHookEngine(hookEngine: HookEngine): void {
    this.hookEngine = hookEngine;
  }

  /**
   * 中断当前执行
   */
  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
      log.info(`收到中断信号`);
    }
  }

  /**
   * 🔧 更新工具调用统计（用于循环检测提示）
   */
  private updateToolCallStats(toolName: string, success: boolean): ToolCallStats {
    let stats = this.toolCallHistory.get(toolName);

    if (!stats) {
      stats = {
        toolName,
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        lastResults: [],
      };
      this.toolCallHistory.set(toolName, stats);
    }

    stats.callCount++;
    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    // 记录最近10次结果（用于检测连续失败）
    stats.lastResults.push({ success, timestamp: Date.now() });
    if (stats.lastResults.length > 10) {
      stats.lastResults.shift();
    }

    return stats;
  }

  /**
   * 获取最近 N 轮中工具调用失败的次数
   * 用于判断 LLM 是否因工具反复失败而"放弃"调用工具
   */
  private getRecentToolFailureCount(recentRounds: number): number {
    let totalFailures = 0;
    for (const [, stats] of this.toolCallHistory) {
      const recentResults = stats.lastResults.slice(-recentRounds);
      totalFailures += recentResults.filter(r => !r.success).length;
    }
    return totalFailures;
  }

  /**
   * 清理所有资源
   */
  dispose(): void {
    // 清理心跳定时器
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 中止当前执行
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // 清理待处理的用户输入
    this.pendingUserInputs = [];

    // 清理当前 turn ID
    this.currentTurnId = null;
    this.onEvent = null;

    log.info(`资源已清理`);
  }

  submitUserInput(message: string): void {
    this.pendingUserInputs.push(message);
    log.info(`收到用户插话: ${message.substring(0, 50)}...`);
  }

  private consumeUserInputs(): string[] {
    const inputs = [...this.pendingUserInputs];
    this.pendingUserInputs = [];
    return inputs;
  }

  setConfig(config: Partial<AhiveCoderExecutorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取工具注册表
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  private emit(type: AhiveCoderEventType, data: Record<string, any> = {}): void {
    if (!this.onEvent || !this.currentTurnId) return;

    this.onEvent({
      type,
      timestamp: Date.now(),
      turnId: this.currentTurnId,
      ...data,
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeat', {});
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 检查是否有待处理的用户输入
   * 参考: codex-rs/core/src/codex.rs:7164
   */
  private hasPendingInput(): boolean {
    return this.pendingUserInputs.length > 0;
  }

  /**
   * 检查客观未完成证据（替代信号词匹配）
   */
  private checkObjectiveIncompleteEvidence(messages: any[], lastContent: string): string[] {
    const reasons: string[] = [];

    const planMessages = messages.filter(
      (m: any) => typeof m.content === 'string' && m.content.includes('update_plan') && m.content.includes('in_progress')
    );
    if (planMessages.length > 0) {
      reasons.push('计划中还有未完成的步骤');
    }

    const recentMessages = messages.slice(-3);
    const failedToolResults = recentMessages.filter(
      (m: any) => typeof m.content === 'string' && (m.content.includes('tool_result') || m.content.includes('ToolResult')) && m.content.includes('错误')
    );
    if (failedToolResults.length > 0) {
      reasons.push('最近的工具调用失败了');
    }

    if (lastContent.length < 50 && this.taskCompletionState.consecutiveNoToolCalls === 0) {
      reasons.push('回复过短，可能未充分执行');
    }

    const taskCompletedInHistory = messages.some(
      (m: any) => Array.isArray(m.content)
        && m.content.some((block: any) =>
          (block.type === 'tool_use' || block.type === 'tool_call')
          && block.name === 'task_complete'
        )
    );
    const completionSignals = ['已完成所有', '全部完成', '任务完成', '执行完毕', 'all done', 'task complete'];
    const hasCompletionSignal = completionSignals.some(s => lastContent.toLowerCase().includes(s));
    if (hasCompletionSignal && !taskCompletedInHistory) {
      reasons.push('回复声称完成但未调用 task_complete 工具');
    }

    const recentToolCallMessages = messages.slice(-6).filter(
      (m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_use' || b.type === 'tool_call')
    );
    if (recentToolCallMessages.length >= 2 && this.taskCompletionState.consecutiveNoToolCalls === 0) {
      reasons.push('之前一直在调用工具，突然停止可能非预期');
    }

    return reasons;
  }

  /**
   * 检查任务是否完成
   * 关键修复：区分"等待用户"和"真正完成"
   */
  private checkTaskCompletion(responseContent: string, hasToolCalls: boolean): {
    isComplete: boolean;
    reason?: string;
    isWaitingForUser?: boolean;
  } {
    // 有工具调用 → 任务未完成
    if (hasToolCalls) {
      this.taskCompletionState.consecutiveNoToolCalls = 0;
      this.taskCompletionState.detectedComplete = false;
      return { isComplete: false };
    }

    // 更新状态（保留 lastResponseContent 用于信号词检测）
    this.taskCompletionState.lastResponseContent = responseContent;

    // 🆕 优先检测"等待用户输入"信号词（智能体在等待用户反馈，应该暂停）
    // 参考 CODEX: 用户意图检测 - 等待用户输入时不应继续执行
    const waitingForUserSignals = [
      '等待审核',
      '等待确认',
      '等待批准',
      '等待用户',
      '等待您的',
      '请确认',
      '请审核',
      '请审批',
      '请选择',
      '请决定',
      '需要您确认',
      '需要您审核',
      '需要您批准',
      '需要您选择',
      '等待您的确认',
      '等待您的审核',
      '等待您的批准',
      '等待您的选择',
      // 🔧 Issue 6 修复：英文信号词收窄为强意图表达，移除了容易误判的 'wait for', 'waiting for', 'please review', 'awaiting'
      'please confirm before proceeding',
      'awaiting your approval',
      'awaiting your confirmation',
    ];

    const hasWaitingSignal = waitingForUserSignals.some(signal =>
      responseContent.toLowerCase().includes(signal.toLowerCase())
    );

    // 🔧 关键修复：检测到"等待用户"信号时，暂停执行，等待用户输入
    if (hasWaitingSignal) {
      log.info(`检测到等待用户信号，暂停执行等待用户输入`);
      return {
        isComplete: true,
        reason: '智能体等待用户确认/审核，暂停执行',
        isWaitingForUser: true,
      };
    }

    // 检测真正的完成信号词（任务真正完成，不需要用户输入）
    // 注意：不包含"等待审核"等信号词
    // 使用更严格的正则匹配，避免 "the file is complete" 等误判
    const completionPatterns = [
      // /任务[已经]?完成/,
      // /工作[已经]?完成/,
      // /问题[已经]?解决/,
      // /已成功完成/,
      // /已完成任务/,
      // /task (is )?complete/i,
      // /task (is )?done/i,
      // /all tasks? (are )?done/i,
      // /work (is )?complete/i,
      // /mission accomplished/i,
    ];

    const hasCompletionSignal = completionPatterns.some(p => p.test(responseContent));

    if (hasCompletionSignal) {
      this.taskCompletionState.detectedComplete = true;
      return {
        isComplete: true,
        reason: '检测到完成信号词',
        isWaitingForUser: false,
      };
    }

    // ========== 对齐 CODEX: 不使用 consecutiveNoToolCalls 阈值 ==========
    // CODEX 完全依赖 needs_follow_up 布尔值，不使用计数器
    // 循环退出由 executor 主循环的 needs_follow_up=false 决定
    // 此方法仅做信号词检测（完成信号、等待用户信号）

    return { isComplete: false };
  }

  async execute(llmService: AhiveCoderLLMService, options: AhiveCoderExecuteOptions): Promise<{
    content: string;
    iterations: number;
    toolCallsExecuted: number;
  }> {
    const { systemPrompt, userMessage, sessionMessages, modelConfig, onEvent, agentId, memorySystem, memorySpace } = options;

    // 记忆空间：默认 'ahive-coder'，CORE 智能体使用 'core'
    const space = memorySpace || 'ahive-coder';

    // 🔍 调试日志：检查memorySystem和agentId
    log.info(`[AhiveCoderExecutor] execute调用: agentId=${agentId}, memorySystem=${memorySystem ? '存在' : '不存在'}, memorySpace=${space}`);

    // 🔧 新增：存储记忆系统引用，用于运行时压缩持久化
    this.memorySystem = memorySystem;
    this.agentId = agentId || null;
    this.memorySpace = space;

    this.onEvent = onEvent;
    this.currentTurnId = `turn_${randomUUID().slice(0, 8)}`;
    this.abortController = new AbortController();
    this.compactedThisTurn = false;  // E-7: 重置压缩标志
    this.toolCallHistory.clear();    // 🔧 重置工具调用统计（每 turn 重新统计）

    // 构建消息列表：冷启动从文件读，热续从内存复用
    if (!this.historyInitialized || this.conversationHistory.length === 0) {
      // 冷启动：首次execute()或clearHistory()后，从持久化加载
      this.conversationHistory = [
        createSystemMessage(systemPrompt),
      ];

      // 加载历史记忆上下文（双重来源）
      if (memorySystem && agentId) {
        try {
          // 1. 从 SQLite 加载压缩摘要（历史上下文）
          const memoryContext = await memorySystem.getMemoryContext(agentId, space, 4000);
          if (memoryContext) {
            this.conversationHistory.push(createSystemMessage(memoryContext));
            log.info(`加载了历史压缩摘要 (space: ${space})`);
          }

          // 2. 从 rollout 文件加载最近对话（当前会话上下文）
          const recentItems = await memorySystem.getRecentRolloutItems(agentId, space, 100);
          if (recentItems && recentItems.length > 0) {
            const historyText = this.formatMemoryAsHistory(recentItems, this.config.historyTokenBudget);
            if (historyText) {
              this.conversationHistory.push(createSystemMessage(`## 最近对话\n\n${historyText}`));
              log.info(`加载了 ${recentItems.length} 条最近对话 (space: ${space}, 预算: ${this.config.historyTokenBudget} tokens)`);
            }
          }
        } catch (error) {
          log.warn('加载记忆失败:', error);
        }
      }
      this.historyInitialized = true;
      log.info(`[AhiveCoderExecutor] 冷启动: 从持久化加载 ${this.conversationHistory.length} 条消息`);
    } else {
      // 热续：复用内存中已有的history，只更新systemPrompt
      this.conversationHistory[0] = createSystemMessage(systemPrompt);
      log.info(`[AhiveCoderExecutor] 热续: 复用内存中 ${this.conversationHistory.length} 条消息`);
    }

    // 添加会话消息（转换为 InternalMessage 格式）
    if (sessionMessages && sessionMessages.length > 0) {
      for (const sm of sessionMessages) {
        this.conversationHistory.push({
          role: sm.role,
          content: sm.content,
          turnId: this.currentTurnId || undefined,
        });
      }
    }

    // 添加用户消息（带 turnId）
    this.conversationHistory.push(createUserTextMessage(this.currentTurnId!, userMessage));

    // 局部引用，后续代码无需改动
    let messages = this.conversationHistory;

    this.startHeartbeat();

    // ========== SessionStart Hook ==========
    // 参考: codex-rs/hooks/src/events/session_start.rs
    let hookAdditionalContext: string | undefined;
    if (this.hookEngine) {
      try {
        const sessionStartOutcome = await this.hookEngine.runSessionStart({
          sessionId: this.currentTurnId,
          cwd: this.workdir,
          model: modelConfig?.model || 'unknown',
          permissionMode: 'default',
          source: SessionStartSource.Startup,
        });

        if (sessionStartOutcome.shouldStop) {
          log.warn(`SessionStart Hook 请求停止: ${sessionStartOutcome.stopReason}`);
          return {
            content: sessionStartOutcome.stopReason || 'Hook stopped session',
            iterations: 0,
            toolCallsExecuted: 0,
          };
        }

        if (sessionStartOutcome.additionalContext) {
          hookAdditionalContext = sessionStartOutcome.additionalContext;
          messages.push(createSystemMessage(`Hook 注入上下文:\n${hookAdditionalContext}`));
          log.info(`SessionStart Hook 注入上下文: ${hookAdditionalContext.slice(0, 100)}...`);
        }
      } catch (hookError) {
        log.warn('SessionStart Hook 执行失败:', hookError);
      }
    }

    /** 🔧 跟踪已持久化的消息位置，防止重复保存 */
    let persistedUpToIndex = 0;

    try {
      // ========== TurnStarted 事件 ==========
      // 参考: codex-rs/protocol/src/protocol.rs:1166
      this.emit('turn_started', { turnId: this.currentTurnId });

      let iterations = 0;
      let totalToolCalls = 0;
      let lastContent = '';
      let accumulatedAssistantText = '';
      // 🔧 Fix A: 连续 LLM 失败计数器（替代 iterations < 5 的硬阈值）
      let consecutiveLLMFailures = 0;

      // ========== CODEX 官方循环控制逻辑 ==========
      // 参考: codex-rs/core/src/codex.rs:6979, 7068, 7164-7168
      // needsFollowUp 初始值为 false
      let needsFollowUp = false;

      // 安全限制：最大迭代次数（防止无限循环）
      const MAX_ITERATIONS = 100;

      // 参考: codex-rs/core/src/codex.rs:5538 loop
      while (true) {
        // 检查中断
        if (this.abortController?.signal.aborted) {
          log.info(`执行被用户中断`);
          this.emit('turn_aborted', { reason: 'interrupted' });
          break;
        }

        // 安全限制检查，该代码不很合理，暂时注释掉，
        // if (iterations >= MAX_ITERATIONS) {
        //   log.warn(`达到安全迭代上限 (${MAX_ITERATIONS})，强制退出循环`);
        //   this.emit('turn_aborted', { reason: `达到安全迭代上限 ${MAX_ITERATIONS}` });
        //   break;
        // }

        // ========== 关键修复：每轮循环开始时重置 needsFollowUp = false ==========
        // 参考: codex-rs/core/src/codex.rs:6979
        // CODEX 的逻辑是每轮循环开始时 needs_follow_up = false
        // 然后根据本轮的情况（工具调用、pending_input）设置 needs_follow_up = true
        needsFollowUp = false;

        const userInputs = this.consumeUserInputs();
        if (userInputs.length > 0) {
          for (const input of userInputs) {
            messages.push(createUserTextMessage(this.currentTurnId!, input));
            log.info(`用户插话已加入上下文`);
            // 🔧 修复：await持久化，成功后才更新索引
            if (this.memorySystem && this.agentId) {
              try {
                await this.memorySystem.recordMessage(this.agentId, this.memorySpace as any, 'user', input);
                persistedUpToIndex = messages.length;
              } catch (err) {
                log.warn('记录用户插话失败:', err);
              }
            }
            needsFollowUp = true; // 有新消息，继续循环
          }
          this.emit('user_input', { inputs: userInputs });
        }

        iterations++;

        // 计算上下文大小（使用改进的 token 估算，考虑中文字符）
        // 🔧 修复：统一使用 approxTokenCount 进行估算，避免与 estimateMessagesTokens 不一致
        const totalChars = messages.reduce((sum, m) => sum + getContentLength(m.content), 0);
        const allContent = messages.map(m => getContentAsText(m.content)).join('');
        const estimatedTokens = approxTokenCount(allContent);

        // 🔍 DEBUG: 详细上下文分析（仅在debug级别输出，避免性能影响）
        if (process.env.LOG_LEVEL === 'debug' || process.env.DEBUG) {
          log.debug(`========== 迭代 ${iterations} ==========`);
          for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            const msgTokens = approxTokenCount(getContentAsText(m.content) || '');
            log.debug(`消息[${i}] ${m.role}: ${getContentLength(m.content)} 字符 ≈ ${msgTokens} tokens`);
          }
          log.debug(`上下文汇总:`, {
            totalChars,
            estimatedTokens,
            messageCount: messages.length,
            messageRoles: messages.map(m => m.role).join(', ')
          });
        }

        log.info(`迭代 ${iterations}: ${totalChars} 字符 ≈ ${estimatedTokens} tokens (${messages.length} 条消息)`);

        this.emit('iteration_start', { iteration: iterations });

        // ========== 动态压缩检查 (参考 CODEX auto_compact) ==========
        // 参考: codex-rs/core/src/codex.rs:5654-5682
        // E-7: 同一 turn 最多压缩一次，避免压缩-重估-再压缩循环
        if (this.needsAutoCompact(estimatedTokens)) {
          const autoCompactLimit = this.getAutoCompactLimit();
          const stillOverLimit = this.compactedThisTurn && estimatedTokens >= autoCompactLimit * 1.1;
          if (!this.compactedThisTurn || stillOverLimit) {
            log.warn(`⚠️ 上下文超过阈值 (${estimatedTokens} >= ${autoCompactLimit})${stillOverLimit ? ' (压缩后仍超110%，再次压缩)' : ''}，触发动态压缩`);

            try {
              const fs = await import('fs');
              const path = await import('path');
              const logDir = path.join(process.cwd(), 'logs');
              if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
              fs.appendFileSync(path.join(logDir, 'memory-compact.log'), `[${new Date().toISOString()}] 触发: ${estimatedTokens} >= ${autoCompactLimit} (agent=${this.agentId||'?'}, stillOver=${stillOverLimit})\n`, 'utf-8');
            } catch {}

            this.compactedThisTurn = true;
            try {
              const { tokensBefore, tokensAfter } = await this.autoCompactContext(messages, llmService);

              const newTotalChars = messages.reduce((sum, m) => sum + getContentLength(m.content), 0);
              const newEstimatedTokens = this.estimateMessagesTokens(messages);
              log.info(`压缩后: ${newTotalChars} 字符 ≈ ${newEstimatedTokens} tokens (压缩率: ${Math.round((1 - tokensAfter / tokensBefore) * 100)}%)`);

              persistedUpToIndex = messages.length;
              log.info(`[AhiveCoderExecutor] 压缩后重置 persistedUpToIndex = ${persistedUpToIndex}`);
            } catch (compactError) {
              // 🔧 核心修复：压缩失败不应断开任务，仅记录警告并继续
              const compactErrMsg = compactError instanceof Error ? compactError.message : String(compactError);
              log.error(`动态压缩失败，继续使用未压缩上下文: ${compactErrMsg}`);
              this.compactedThisTurn = false; // 重置，允许下次重试
            }
          }
        }

        // ========== 调用 LLM ==========
        let response;
        try {
          response = await this.callLLM(llmService, messages, modelConfig);
          log.info(`LLM 响应: 内容长度=${response.content?.length || 0}, 工具调用=${response.toolCalls?.length || 0}, finishReason=${response.finishReason}`);
          // 🔧 Fix A: LLM 调用成功，重置连续失败计数器
          consecutiveLLMFailures = 0;
        } catch (llmError) {
          const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
          log.error(`LLM 调用失败: ${errMsg}`);
          this.emit('error', { message: `LLM 调用失败: ${errMsg}` });

          // 用户主动中断——立即终止，不重试
          if (this.abortController?.signal.aborted) {
            log.info(`LLM 调用期间用户中断，直接抛出`);
            throw llmError;
          }

          // 🔧 核心修复：所有 LLM 错误都应注入给 LLM 让其调整策略，而非直接 throw 断开任务
          // 原问题：400/404 等错误不在 isRecoverable 列表中，直接 throw → turn_aborted → 任务断开
          // 修复后：所有错误都注入错误信息让 LLM 知道，只有连续5次失败才终止
          const MAX_CONSECUTIVE_LLM_FAILURES = 5;
          consecutiveLLMFailures++;

          // 判断是否为瞬时性错误（需要等待退避）还是参数性错误（可立即重试）
          const isTransientError =
            errMsg.includes('429') ||
            errMsg.includes('503') ||
            errMsg.includes('502') ||
            errMsg.includes('timeout') ||
            errMsg.includes('ECONNRESET') ||
            errMsg.includes('ETIMEDOUT') ||
            errMsg.includes('ECONNREFUSED') ||
            errMsg.includes('fetch failed') ||
            errMsg.includes('socket hang up');

          // 判断是否为参数/格式错误（LLM 可以通过调整请求来恢复）
          const isParameterError =
            errMsg.includes('400') ||
            errMsg.includes('404') ||
            errMsg.includes('422') ||
            errMsg.includes('context_length_exceeded') ||
            errMsg.includes('max context') ||
            errMsg.includes('image') ||
            errMsg.includes('multimodal');

          if (consecutiveLLMFailures <= MAX_CONSECUTIVE_LLM_FAILURES) {
            if (isTransientError) {
              // 瞬时性错误：指数退避等待
              const waitMs = Math.min(2000 * Math.pow(2, consecutiveLLMFailures - 1), 30000);
              log.warn(`LLM 瞬时错误 (连续第 ${consecutiveLLMFailures} 次)，${waitMs / 1000}s 后重试: ${errMsg}`);
              await new Promise(resolve => setTimeout(resolve, waitMs));
              messages.push(createUserTextMessage(this.currentTurnId!,
                `[系统提示] LLM 服务暂时不可用 (第${consecutiveLLMFailures}次): ${errMsg}。已等待 ${waitMs / 1000}s，请调整后继续。`));
            } else if (isParameterError) {
              // 参数性错误：不等待，直接注入错误让 LLM 调整
              log.warn(`LLM 参数错误 (连续第 ${consecutiveLLMFailures} 次)，注入错误让 LLM 调整: ${errMsg}`);
              messages.push(createUserTextMessage(this.currentTurnId!,
                `[系统提示] LLM 调用失败 (第${consecutiveLLMFailures}次): ${errMsg}。请调整请求参数（如移除图片、减少工具调用、简化消息）后继续。如果无法恢复，请调用 task_complete 工具报告错误。`));
            } else {
              // 未知错误：注入错误，短暂等待
              log.warn(`LLM 未知错误 (连续第 ${consecutiveLLMFailures} 次): ${errMsg}`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              messages.push(createUserTextMessage(this.currentTurnId!,
                `[系统提示] LLM 调用异常 (第${consecutiveLLMFailures}次): ${errMsg}。请尝试继续任务，如果无法恢复，请调用 task_complete 工具报告错误。`));
            }
            continue;
          }

          // 连续失败超过上限，终止任务（但仍通过 turn_aborted 正常通知）
          log.error(`LLM 连续失败 ${consecutiveLLMFailures} 次，超过上限 ${MAX_CONSECUTIVE_LLM_FAILURES}，终止任务`);
          throw llmError;
        }

        lastContent = response.content;

        let currentFullContent = accumulatedAssistantText + lastContent;

        // ========== 提取工具调用 ==========
        const toolCalls = this.collectToolCalls({ ...response, content: currentFullContent });
        log.info(`提取到 ${toolCalls.length} 个工具调用`);

        // ========== CODEX 官方 needs_follow_up 逻辑 ==========
        // 参考: codex-rs/core/src/codex.rs:7068, 7164
        // 关键修复: needs_follow_up 应该使用累积逻辑 (|=)，而非每次重置
        // needs_follow_up |= output.needs_follow_up
        // needs_follow_up |= sess.has_pending_input().await

        if (toolCalls.length > 0) {
          // 有工具调用 → needs_follow_up = true（累积）
          totalToolCalls += toolCalls.length;
          this.taskCompletionState.consecutiveNoToolCalls = 0;  // 有工具调用时重置计数
          this.emit('tool_calls_detected', { count: toolCalls.length, tools: toolCalls.map(t => t.name) });

          // 修复历史消息（如果之前有累积的截断输出）
          if (accumulatedAssistantText) {
            messages.pop(); // 弹出上一轮的用户提示: '请继续完成你的回答。'
            messages.pop(); // 弹出上一轮由于截断只保留了一部分的 assistant 消息
          }

          // 添加 assistant 消息（带工具调用）
          messages.push(createAssistantToolUseMessage(this.currentTurnId!, currentFullContent, toolCalls));
          accumulatedAssistantText = '';

          log.info(`开始执行 ${toolCalls.length} 个工具调用...`);

          // ========== 并行执行工具调用 ==========
          // 参考: codex-rs/core/src/codex.rs:6977-7063 FuturesOrdered
          const toolResults = await this.executeToolCallsParallel(toolCalls);

          // 将工具结果添加到消息（使用新的结构化格式，带统计信息）
          for (const result of toolResults) {
            // 🔧 更新工具调用统计
            const stats = this.updateToolCallStats(result.toolName, result.success);

            messages.push(createToolResultMessage(
              this.currentTurnId!,
              result.callId,
              result.toolName,
              result.content,
              !result.success,
              stats,  // 传入统计信息，帮助 LLM 判断循环
              result.images  // 传入图片数据，支持多模态
            ));
          }

          // 检查 task_complete 工具是否被调用
          const taskCompletedResult = toolResults.find((r: any) => r._taskCompleted);
          if (taskCompletedResult) {
            this.emit('agent_message', {
              content: lastContent,
              completionReason: (taskCompletedResult as any)._waitingForUser ? '等待审核' : '任务完成',
              waitingForUser: !!(taskCompletedResult as any)._waitingForUser,
            });
            log.info(`task_complete 工具被调用，任务结束 (status=${(taskCompletedResult as any)._waitingForUser ? 'needs_review' : 'completed'})`);
            break;
          }

          log.info(`工具调用执行完成，设置 needsFollowUp=true 继续循环`);

          // 🔧 修复：提前持久化工具结果，防止超时/崩溃时丢失
          // 持久化本轮的 assistant 消息（带工具调用）和工具结果
          if (this.memorySystem && this.agentId) {
            try {
              // 持久化 assistant 消息（带工具调用）
              const lastMsg = messages[messages.length - toolResults.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                await this.memorySystem.recordMessage(this.agentId, this.memorySpace as any, 'assistant', lastMsg.content);
              }
              // 持久化工具结果（使用recordToolOutput而非recordMessage，确保rollout中type为tool_output）
              for (const result of toolResults) {
                if (this.memorySystem.recordToolOutput) {
                  await this.memorySystem.recordToolOutput(this.agentId, this.memorySpace as any, result.toolName, result.content);
                } else {
                  await this.memorySystem.recordMessage(this.agentId, this.memorySpace as any, 'user', result.content);
                }
              }
              persistedUpToIndex = messages.length;
            } catch (err) {
              log.warn('提前持久化工具结果失败:', err);
              // 失败时不更新索引，最终路径会重试
            }
          } else {
            persistedUpToIndex = messages.length;
          }

        
          // 关键修复: 使用累积逻辑，而非直接赋值
          // 🔧 Fix D: 直接赋值，needsFollowUp || true 恒为 true 是误导性写法
          needsFollowUp = true;
          continue; // 继续下一轮循环，让 LLM 处理工具结果
        } else {
          // 无工具调用
          // 参考: codex-rs/core/src/codex.rs:5684-5802
          const finishReason = response.finishReason;
          log.info(`无工具调用, finishReason=${finishReason}`);

          if (finishReason === 'length') {
            // 输出被截断，需要继续
            if (accumulatedAssistantText) {
              messages.pop(); // 去掉上一轮的 '请继续完成你的回答。'
              messages.pop(); // 去掉上一轮由于截断保留的 assistant 消息
            }
            // 添加截断的 assistant 消息（不持久化，因为内容不完整）
            messages.push(createAssistantTextMessage(this.currentTurnId!, currentFullContent || ''));
            messages.push(createUserTextMessage(this.currentTurnId!, '请继续完成你的回答。'));

            log.info(`输出被截断 (finish_reason=length)，提示继续`);
            accumulatedAssistantText = currentFullContent;
            // 🔧 Fix D: 直接赋值
            needsFollowUp = true;
          } else {
            

            //以下用户插话代码段与上边的有所重复，暂时注释掉，不要起用，也不要删除，暂时保留即可。
          //   if (this.hasPendingInput()) {
          //     // 有用户插话：先添加并持久化 assistant 消息，再添加用户插话
          //     messages.push(createAssistantTextMessage(this.currentTurnId!, lastContent));
          //     if (this.memorySystem && this.agentId) {
          //       try {
          //         await this.memorySystem.recordMessage(this.agentId, this.memorySpace as any, 'assistant', lastContent);
          //         persistedUpToIndex = messages.length;
          //       } catch (err) {
          //         log.warn('记录 assistant 消息（插话前）失败:', err);
          //       }
          //     }

          //     const userInputs = this.consumeUserInputs();
          //     for (const input of userInputs) {
          //       messages.push(createUserTextMessage(this.currentTurnId!, input));
          //       log.info(`用户输入已加入上下文 (pending input)`);
          //       if (this.memorySystem && this.agentId) {
          //         try {
          //           await this.memorySystem.recordMessage(this.agentId, this.memorySpace as any, 'user', input);
          //           persistedUpToIndex = messages.length;
          //         } catch (err) {
          //           log.warn('记录用户输入失败:', err);
          //         }
          //       }
          //     }
          //     needsFollowUp = true;
          //   } else {
          //     // 无用户插话

          //  }
          
              messages.push(createAssistantTextMessage(this.currentTurnId!, lastContent));
           

            // 清理累积截断文本
            if (accumulatedAssistantText) {
              messages.pop();
              messages.pop();
              lastContent = currentFullContent;
            }

            // Stop Hook：收集续行提示（如有），但不作为退出决策
            let hookPrompt: string | undefined;
            if (this.hookEngine) {
              try {
                const stopOutcome = await this.hookEngine.runStop({
                  sessionId: this.currentTurnId || 'unknown',
                  turnId: this.currentTurnId || 'unknown',
                  cwd: this.workdir,
                  model: modelConfig?.model || 'unknown',
                  permissionMode: 'default',
                  stopHookActive: false,
                  lastAssistantMessage: lastContent,
                });
                if (stopOutcome.shouldBlock && stopOutcome.continuationPrompt) {
                  hookPrompt = stopOutcome.continuationPrompt;
                  log.info(`Stop Hook 注入续行提示: ${hookPrompt.substring(0, 100)}`);
                }
              } catch (hookError) {
                log.warn('Stop Hook 执行失败:', hookError);
              }
            }

            // 有用户插话时直接继续循环（用户消息已注入）
            if (this.hasPendingInput() || needsFollowUp) {
              continue;
            }

            // 无工具调用 + 无用户插话 → 分级续行提示，永不退出
            this.taskCompletionState.consecutiveNoToolCalls++;
            const noToolCount = this.taskCompletionState.consecutiveNoToolCalls;

            let prompt: string;
            if (noToolCount >= 5) {
              prompt = `[System] INSTRUCTION: You must either call a tool to proceed, or call task_complete tool to end the task. Text-only output is forbidden. Choose NOW.`;
              log.warn(`LLM 连续${noToolCount}轮未调用工具，注入强干预提示`);
            } else if (noToolCount >= 3) {
              prompt = `[System] You have not called any tool for ${noToolCount} rounds. To end the task, call task_complete tool. To continue working, call a tool. Text-only responses are not allowed.`;
              log.info(`LLM 连续${noToolCount}轮未调用工具，注入中等提示`);
            } else {
              prompt = `[System] To end the task, call task_complete tool. Do not end with text-only responses.`;
              log.info(`LLM 未调用工具 (第${noToolCount}次)，注入续行提示`);
            }
            if (hookPrompt) prompt += `\n${hookPrompt}`;

            messages.push(createUserTextMessage(this.currentTurnId!, prompt));
            needsFollowUp = true;
            continue;
          }
        }
      }

      log.info(`循环退出: iterations=${iterations}`);

      // ========== TurnComplete 事件 ==========
      // 参考: codex-rs/protocol/src/protocol.rs:1171
      this.emit('turn_complete', {
        iterations,
        toolCallsExecuted: totalToolCalls,
        lastAgentMessage: lastContent
      });

      // 记录对话到记忆系统（异步持久化，不阻塞主流程）
      if (memorySystem && agentId) {
        const newMsgStart = persistedUpToIndex;
        const newMsgEnd = messages.length;
        const skipSystem = messages.slice(newMsgStart).filter(m => m.role !== 'system').length;
        log.info(`[AhiveCoderExecutor] 异步持久化 ${skipSystem} 条新消息 (总消息: ${messages.length}, 已持久化: ${persistedUpToIndex})`);
        persistedUpToIndex = messages.length;

        // 异步写入，不await
        Promise.resolve().then(async () => {
          try {
            for (let i = newMsgStart; i < newMsgEnd; i++) {
              const msg = messages[i];
              if (msg.role === 'system') continue;
              if ((msg as any).isToolResult && (msg as any).toolName && memorySystem.recordToolOutput) {
                await memorySystem.recordToolOutput(agentId, space, (msg as any).toolName, typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
              } else if (memorySystem.recordStructuredMessage) {
                await memorySystem.recordStructuredMessage(agentId, space, {
                  role: msg.role as 'user' | 'assistant',
                  content: msg.content,
                  turnId: msg.turnId,
                  contentBlocks: msg.contentBlocks,
                });
              } else {
                await memorySystem.recordMessage(agentId, space, msg.role, msg.content);
              }
            }
          } catch (error) {
            log.warn('异步持久化失败:', error);
          }
        });
      }

      // ========== AfterAgent Hook ==========
      // 参考: codex-rs/hooks/src/types.rs AfterAgent
      let finalContent = lastContent;
      if (this.hookEngine && agentId) {
        try {
          await this.hookEngine.runAfterAgent({
            sessionId: this.currentTurnId || 'unknown',
            threadId: agentId,
            turnId: this.currentTurnId || 'unknown',
            inputMessages: [userMessage],
            lastAssistantMessage: lastContent,
          }, this.workdir);
        } catch (hookError) {
          log.warn('AfterAgent Hook 执行失败:', hookError);
        }
      }

      return {
        content: finalContent,
        iterations,
        toolCallsExecuted: totalToolCalls,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      log.error(`[AhiveCoderExecutor] 任务异常退出: ${errorMsg}${errorStack ? '\n堆栈:' + errorStack : ''}`);
      this.emit('turn_aborted', { reason: errorMsg });

      // 🔧 异常持久化：即使LLM超时/异常，也将已累积的消息保存到记忆系统，防止对话丢失
      // 只保存尚未持久化的消息（从 persistedUpToIndex 开始）
      if (memorySystem && agentId && messages.length > persistedUpToIndex) {
        try {
          const newCount = messages.length - persistedUpToIndex;
          log.info(`[AhiveCoderExecutor] 异常路径：准备保存 ${newCount} 条未持久化消息 (从索引 ${persistedUpToIndex} 开始)`);
          for (let i = persistedUpToIndex; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'system') continue;
            if (memorySystem.recordStructuredMessage) {
              await memorySystem.recordStructuredMessage(agentId, space, {
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
                turnId: msg.turnId,
                contentBlocks: msg.contentBlocks,
              });
            } else {
              await memorySystem.recordMessage(agentId, space, msg.role, msg.content);
            }
          }
          log.info(`[AhiveCoderExecutor] 异常路径：累积消息已保存 (space: ${space}, 新增 ${newCount} 条)`);
        } catch (persistError) {
          log.warn('[AhiveCoderExecutor] 异常路径：保存累积消息失败:', persistError);
        }
      }

      throw error;
    } finally {
      this.stopHeartbeat();
      this.onEvent = null;
      this.currentTurnId = null;
      this.abortController = null;
    }
  }

  private async callLLM(
    llmService: AhiveCoderLLMService,
    messages: InternalMessage[],
    config?: any
  ): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; finishReason?: string }> {
    const startTime = Date.now();
    this.emit('llm_call_start', {});
    log.info(`调用 LLM, 消息数=${messages.length}`);

    // 转换为 LLM 格式
    const llmMessages = toLLMMessages(messages);

    // 发射提示词事件，供前端展示
    const promptCategories: Record<string, Array<{ role: string; content: string | MultiModalContent[] }>> = {
      system: [],
      user: [],
      assistant: [],
    };
    for (const msg of llmMessages) {
      const category = promptCategories[msg.role] || promptCategories.user;
      category.push({ role: msg.role, content: msg.content });
    }
    this.emit('llm_prompt', {
      messages: llmMessages,
      categories: promptCategories,
      totalMessages: llmMessages.length,
    });

    // 生成消息 ID（用于流式输出）
    const itemId = `msg_${randomUUID().slice(0, 8)}`;

    // 修复：移除 Executor 层的重试循环，避免与 Provider 层重试叠加（3×3=9次）
    // Provider 层（OpenAIProvider.chat / chatStream）已有完整的重试+退避机制
    // Executor 层只负责调用和事件发射，不重复重试
    try {
      let response: { content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; finishReason?: string };

      // 检查是否支持流式调用
      if (llmService.chatStream) {
        log.info(`使用流式调用 (chatStream)`);

        // 真正的流式输出 - 实时发送 delta
        // 工具调用标记缓冲器：过滤 [TOOL]...[/TOOL] 标记不发送到前端
        let toolTagBuffer = '';
        let insideToolTag = false;
        response = await llmService.chatStream(
          llmMessages,
          (delta: string) => {
            toolTagBuffer += delta;
            // 检测 [TOOL] 开始标记
            if (!insideToolTag && toolTagBuffer.includes('[TOOL]')) {
              const idx = toolTagBuffer.indexOf('[TOOL]');
              // 发送 [TOOL] 之前的纯文本
              const before = toolTagBuffer.substring(0, idx);
              if (before) this.emit('agent_message_delta', { itemId, delta: before });
              insideToolTag = true;
              toolTagBuffer = toolTagBuffer.substring(idx);
            }
            // 检测 [/TOOL] 结束标记
            if (insideToolTag && toolTagBuffer.includes('[/TOOL]')) {
              const idx = toolTagBuffer.indexOf('[/TOOL]');
              toolTagBuffer = toolTagBuffer.substring(idx + 7); // '[/TOOL]'.length = 7
              insideToolTag = false;
              // 继续处理缓冲区中可能存在的后续内容
              if (toolTagBuffer.includes('[TOOL]')) {
                // 递归处理：还有新的 [TOOL] 标记
                const nextIdx = toolTagBuffer.indexOf('[TOOL]');
                const before = toolTagBuffer.substring(0, nextIdx);
                if (before) this.emit('agent_message_delta', { itemId, delta: before });
                insideToolTag = true;
                toolTagBuffer = toolTagBuffer.substring(nextIdx);
              } else if (toolTagBuffer) {
                this.emit('agent_message_delta', { itemId, delta: toolTagBuffer });
                toolTagBuffer = '';
              }
              return;
            }
            // 在标记外时，发送纯文本delta（保留一定缓冲以避免截断 [TOOL]）
            if (!insideToolTag) {
              // 如果缓冲区末尾可能是 [TOOL] 的前缀，保留不发送
              const safeLength = toolTagBuffer.length - 5; // '[TOOL]'.length - 1 = 5
              if (safeLength > 0) {
                const toSend = toolTagBuffer.substring(0, safeLength);
                this.emit('agent_message_delta', { itemId, delta: toSend });
                toolTagBuffer = toolTagBuffer.substring(safeLength);
              }
            }
          },
          config,
          (thinkingDelta: string) => {
            this.emit('thinking_delta', { itemId, delta: thinkingDelta });
          }
        );
      } else {
        log.info(`使用非流式调用 (chat)`);

        // 非流式调用
        response = await llmService.chat(llmMessages, config);

        // 模拟流式输出（分块发送）
        if (response.content) {
          const chunkSize = 100;
          for (let i = 0; i < response.content.length; i += chunkSize) {
            const delta = response.content.slice(i, i + chunkSize);
            this.emit('agent_message_delta', { itemId, delta });
          }
        }
      }

      const duration = Date.now() - startTime;

      log.info(`LLM 响应耗时: ${duration}ms`);

      // 发送 TokenCount 事件
      // 参考: codex-rs/protocol/src/protocol.rs:1175
      this.emit('token_count', {
        estimatedTokens: Math.ceil((response.content?.length || 0) / 4)
      });

      this.emit('llm_call_end', {});
      return response;

    } catch (error) {
      const lastError = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;
      log.error(`LLM 调用失败 (${duration}ms): ${lastError.message}\n消息数=${messages.length}, 堆栈=${lastError.stack?.substring(0, 500) || '无'}`);
      this.emit('error', { message: lastError.message, phase: 'llm_call', duration });
      throw lastError;
    }
  }

  private collectToolCalls(response: {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }): ToolCallRequest[] {
    const toolCalls: ToolCallRequest[] = [];

    // 从 API toolCalls 提取
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        toolCalls.push({
          id: tc.id || `tc_${randomUUID().slice(0, 8)}`,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    }

    // 从文本提取 [TOOL]...[/TOOL]
    const textToolCalls = this.extractToolCallsFromText(response.content);
    toolCalls.push(...textToolCalls);

    return toolCalls;
  }

  private extractToolCallsFromText(content: string): ToolCallRequest[] {
    const toolCalls: ToolCallRequest[] = [];

    // 格式1: [TOOL]...[/TOOL]
    const pattern1 = /\[TOOL\]([\s\S]*?)\[\/TOOL\]/g;
    let match;

    while ((match = pattern1.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name) {
          toolCalls.push({
            id: `tc_${randomUUID().slice(0, 8)}`,
            name: parsed.name,
            arguments: parsed.arguments || {},
          });
        }
      } catch { }
    }

    // 格式2: ```tool...```
    const pattern2 = /```tool\s*\n?([\s\S]*?)\n?```/g;
    while ((match = pattern2.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name) {
          toolCalls.push({
            id: `tc_${randomUUID().slice(0, 8)}`,
            name: parsed.name,
            arguments: parsed.arguments || {},
          });
        }
      } catch { }
    }

    return toolCalls;
  }

  /**
   * 并行执行工具调用
   * 参考: codex-rs/core/src/codex.rs:6977-7063 FuturesOrdered
   */
  private async executeToolCallsParallel(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]> {
    if (!this.config.parallelToolExecution || toolCalls.length === 1) {
      // 串行执行
      const results: ToolExecutionResult[] = [];
      for (const call of toolCalls) {
        const result = await this.executeSingleTool(call);
        results.push(result);
      }
      return results;
    }

    // 并行执行
    // 参考: codex-rs/core/src/codex.rs:7062-7063
    // in_flight.push_back(tool_future)
    log.info(`并行执行 ${toolCalls.length} 个工具调用`);

    const promises = toolCalls.map(call => this.executeSingleTool(call));
    const results = await Promise.all(promises);

    return results;
  }

  /**
   * 执行单个工具调用
   */
  private async executeSingleTool(call: ToolCallRequest): Promise<ToolExecutionResult> {
    const callId = call.id || `tc_${randomUUID().slice(0, 8)}`;
    const toolName = call.name;

    log.info(`执行工具: ${toolName}`);

    const tool = this.toolRegistry.get(toolName);

    if (!tool) {
      log.warn(`工具不存在: ${toolName}`);
      this.emit('tool_error', { toolName, error: '工具不存在' });
      return {
        callId,
        toolName,
        content: `错误 - 工具不存在。可用工具: ${this.toolRegistry.getNames().join(', ')}`,
        success: false,
      };
    }

    const toolStartTime = Date.now();
    try {
      // 发送 ToolStart 事件
      this.emit('tool_start', {
        toolCallId: call.id,  // 添加toolCallId
        toolName,
        arguments: call.arguments  // 改名为arguments
      });
      log.info(`🔧 执行工具: ${toolName}, 参数: ${JSON.stringify(call.arguments).slice(0, 100)}...`);

      let result: { content: string; success: boolean; images?: Array<{ data: string; mimeType: string }> };

      if (toolName === 'task_complete') {
        result = await this.executeTool(tool, call);
        (result as any)._taskCompleted = true;
        (result as any)._waitingForUser = call.arguments?.status === 'needs_review';
      } else if (toolName === 'exec') {
        // Shell 命令执行
        // 发送 ExecCommandBegin 事件
        // 参考: codex-rs/protocol/src/protocol.rs:1225
        this.emit('exec_command_begin', { command: call.arguments.command });
        result = await this.executeShell(call);
        this.emit('exec_command_end', {
          command: call.arguments.command,
          success: result.success,
          exitCode: result.success ? 0 : 1
        });
      } else {
        result = await this.executeTool(tool, call);
      }

      const toolDuration = Date.now() - toolStartTime;
      log.info(`工具 ${toolName} 完成: success=${result.success}, 耗时=${toolDuration}ms`);

      // 发送 ToolEnd 事件
      this.emit('tool_end', {
        toolCallId: call.id,  // 添加toolCallId
        toolName,
        success: result.success,
        duration: toolDuration
      });

      // 截断过长的结果
      let resultContent = result.content;
      if (resultContent && resultContent.length > this.config.maxToolResultLength) {
        resultContent = resultContent.slice(0, this.config.maxToolResultLength) + '\n... (结果已截断)';
        log.warn(`工具结果已截断: ${toolName}, 原始长度: ${result.content.length}`);
      }

      // ========== AfterToolUse Hook ==========
      // 参考: codex-rs/hooks/src/types.rs AfterToolUse
      if (this.hookEngine && this.currentTurnId) {
        try {
          await this.hookEngine.runAfterToolUse({
            sessionId: this.currentTurnId,
            turnId: this.currentTurnId,
            callId,
            toolName,
            toolKind: toolName === 'exec' ? HookToolKind.LocalShell : HookToolKind.Function,
            toolInput: toolName === 'exec'
              ? { inputType: 'local_shell', params: { command: [String(call.arguments.command || '')] } }
              : { inputType: 'function', arguments: JSON.stringify(call.arguments) },
            executed: true,
            success: result.success,
            durationMs: toolDuration,
            mutating: ['exec', 'write_file', 'delete', 'edit_file', 'apply_patch'].includes(toolName),
            sandbox: 'none',
            sandboxPolicy: 'default',
            outputPreview: resultContent.slice(0, 200),
          }, this.workdir);
        } catch (hookError) {
          log.warn('AfterToolUse Hook 执行失败:', hookError);
        }
      }

      return {
        callId,
        toolName,
        content: resultContent,
        success: result.success,
        images: result.images,
        _taskCompleted: (result as any)._taskCompleted,
        _waitingForUser: (result as any)._waitingForUser,
      };

    } catch (error) {
      const toolDuration = Date.now() - toolStartTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`工具 ${toolName} 异常 (${toolDuration}ms): ${errorMsg}`);
      this.emit('tool_error', { toolName, error: errorMsg });

      return {
        callId,
        toolName,
        content: `错误 - ${errorMsg}`,
        success: false,
      };
    }
  }

  private async executeTool(tool: AgentTool, call: ToolCallRequest): Promise<{ content: string; success: boolean; images?: Array<{ data: string; mimeType: string }> }> {
    const startTime = Date.now();

    try {
      const result = await tool.execute(call.id, call.arguments);
      const duration = Date.now() - startTime;

      log.info(`工具 ${call.name} 返回: 耗时=${duration}ms`);

      if (result && typeof result === 'object' && 'content' in result) {
        const content = (result as any).content;
        const success = (result as any).success !== false;

        if (Array.isArray(content)) {
          const textParts: string[] = [];
          const images: Array<{ data: string; mimeType: string }> = [];
          for (const c of content) {
            if (c.type === 'image' && c.data && c.mimeType) {
              images.push({ data: c.data, mimeType: c.mimeType });
              textParts.push(`[图片: ${c.mimeType}, ${Math.round(c.data.length * 0.75 / 1024)}KB]`);
            } else if (c.text) {
              textParts.push(c.text);
            }
          }
          return { content: textParts.join('\n') || '(空结果)', success, images: images.length > 0 ? images : undefined };
        }

        if (content === undefined || content === null) {
          return { content: '(工具返回空内容)', success: false };
        }

        return { content: String(content), success };
      }

      if (result === undefined || result === null) {
        return { content: '(工具返回空结果)', success: false };
      }

      return {
        content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        success: true,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`工具 ${call.name} 异常: ${errorMsg}`);
      return { content: `执行错误: ${errorMsg}`, success: false };
    }
  }

  /**
   * 执行 Shell 命令
   * 
   * 🔧 修复: 监听取消信号 (参考 CODEX exec.rs)
   * - 问题3: executeShell 不监听取消信号
   * - 问题4: 取消信号传递缺失
   * 
   * 参考: codex-rs/core/src/exec.rs, codex-rs/unified_exec/src/process.rs
   */
  private async executeShell(call: ToolCallRequest): Promise<{ content: string; success: boolean }> {
    const command = call.arguments.command as string;
    const cwd = call.arguments.cwd as string | undefined;
    const timeoutMs = this.config.execTimeoutMs;
    const signal = this.abortController?.signal;  // 获取取消信号

    if (!command) {
      return { content: '错误: 缺少 command 参数', success: false };
    }

    // 沙箱检查
    if (isDangerousCommand(command, DEFAULT_SANDBOX_POLICY)) {
      const msg = `⛔ 沙箱拦截: 危险命令被禁止\n\n命令: ${command}`;
      log.warn(`沙箱拦截危险命令: ${command.substring(0, 50)}...`);
      return { content: msg, success: false };
    }

    // 检查取消信号（执行前）
    if (signal?.aborted) {
      log.info(`命令执行前检测到取消信号，跳过: ${command.substring(0, 50)}...`);
      return { content: '⏹️ 任务已取消', success: false };
    }

    log.info(`执行命令: ${command.substring(0, 100)}...`);

    return new Promise((resolve) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        cwd: cwd || this.workdir,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      // ========== 取消信号监听 (问题3修复) ==========
      // 参考: codex-rs/unified_exec/src/process.rs CancellationToken
      const cancelHandler = () => {
        if (!resolved && proc.pid) {
          resolved = true;
          log.info(`收到取消信号，终止进程 PID=${proc.pid}`);
          spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
          resolve({ content: `${stdout || stderr}\n⏹️ 任务已取消`, success: false });
        }
      };

      if (signal) {
        signal.addEventListener('abort', cancelHandler);
      }

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
          resolve({ content: `${stdout || stderr}\n⏱️ 超时`, success: false });
        }
      }, timeoutMs);

      proc.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        // 发送实时输出事件
        // 参考: codex-rs/protocol/src/protocol.rs:1228
        this.emit('exec_command_output_delta', { delta: chunk });
      });

      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          // 清理取消监听器
          if (signal) {
            signal.removeEventListener('abort', cancelHandler);
          }
          const output = stdout || stderr || '(无输出)';
          const success = code === 0;
          log.info(`命令完成: 退出码=${code}`);
          resolve({ content: `${output}\n退出码: ${code}`, success });
        }
      });

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          // 清理取消监听器
          if (signal) {
            signal.removeEventListener('abort', cancelHandler);
          }
          const errorMsg = err?.message || '命令执行失败';
          log.error(`命令执行异常: ${errorMsg}`);
          resolve({ content: `执行错误: ${errorMsg}`, success: false });
        }
      });
    });
  }

  // ==================== 动态压缩上下文 (参考 CODEX compact.rs) ====================

  /**
   * 检查是否需要动态压缩
   * 参考: codex-rs/core/src/codex.rs:5341, 5654
   * 
   * 支持两种配置方式（优先级从高到低）：
   * 1. autoCompactTokenLimit - 绝对值（如 180000）
   * 2. contextWindow × autoCompactRatio - 比例计算（如 200000 × 0.9 = 180000）
   */
  private needsAutoCompact(estimatedTokens: number): boolean {
    const autoCompactLimit = this.getAutoCompactLimit();

    // 🔍 调试日志：显示压缩检查的详细参数
    log.debug('动态压缩检查', {
      estimatedTokens,
      autoCompactLimit,
      contextWindow: this.config.contextWindow,
      autoCompactRatio: this.config.autoCompactRatio,
      autoCompactTokenLimit: this.config.autoCompactTokenLimit,
      needsCompact: estimatedTokens >= autoCompactLimit,
    });

    // 优先使用绝对值配置
    if (this.config.autoCompactTokenLimit !== undefined) {
      return estimatedTokens >= this.config.autoCompactTokenLimit;
    }
    // 否则使用比例计算
    return estimatedTokens >= autoCompactLimit;
  }

  /**
   * 获取当前压缩阈值
   */
  getAutoCompactLimit(): number {
    if (this.config.autoCompactTokenLimit !== undefined) {
      return this.config.autoCompactTokenLimit;
    }
    return Math.floor(this.config.contextWindow * this.config.autoCompactRatio);
  }

  /**
   * 动态压缩上下文（按轮次三层压缩）
   *
   * 三层压缩策略：
   * - Layer 1: 最近5轮 - 完整保留（检查50K阈值）
   * - Layer 2: 第6-20轮 - 工具结果用占位符替换
   * - Layer 3: 第20轮以外 - 工具结果丢弃
   *
   * 每层独立检查 50K token 上限
   */
  private async autoCompactContext(
    messages: InternalMessage[],
    llmService: AhiveCoderLLMService
  ): Promise<{ tokensBefore: number; tokensAfter: number }> {
    const tokensBefore = this.estimateMessagesTokens(messages);

    log.info(`开始动态压缩: ${tokensBefore} tokens`);
    log.debug(`压缩前消息数: ${messages.length}`);
    this.emit('context_compacted', { tokensBefore, tokensAfter: 0, status: 'started' });

    // E-3: 先备份，失败时可恢复
    const backup = [...messages];

    try {
      // E-6: 检查中断信号
      if (this.abortController?.signal.aborted) {
        log.info('压缩前检测到中断信号，跳过');
        return { tokensBefore, tokensAfter: tokensBefore };
      }

      // ========== 新逻辑：按轮次分组 ==========
      const turns = groupMessagesByTurn(messages);
      const turnIds = Array.from(turns.keys()).filter(id => id !== 'system');
      const totalTurns = turnIds.length;

      log.info(`按轮次分组: 共 ${totalTurns} 轮对话`);

      if (totalTurns <= LAYER1_TURN_COUNT) {
        log.warn(`轮次太少 (${totalTurns} ≤ ${LAYER1_TURN_COUNT})，跳过压缩`);
        return { tokensBefore, tokensAfter: tokensBefore };
      }

      // 获取系统消息
      const systemMessages = turns.get('system') || [];

      // 分层处理
      const layer1Turns = turnIds.slice(-LAYER1_TURN_COUNT);  // 最近5轮
      const layer2Turns = turnIds.slice(-LAYER1_TURN_COUNT - LAYER2_TURN_COUNT, -LAYER1_TURN_COUNT);  // 第6-20轮
      const layer3Turns = turnIds.slice(0, -LAYER1_TURN_COUNT - LAYER2_TURN_COUNT);  // 第20轮以外

      log.debug(`分层: Layer1=${layer1Turns.length}轮, Layer2=${layer2Turns.length}轮, Layer3=${layer3Turns.length}轮`);

      const compactedMessages: InternalMessage[] = [];

      // 保留系统消息
      compactedMessages.push(...systemMessages);

      // Layer 3: 丢弃工具结果，只保留用户/助手文本
      for (const turnId of layer3Turns) {
        const turnMessages = turns.get(turnId) || [];
        for (const msg of turnMessages) {
          if (msg.isToolResult) continue;  // 丢弃工具结果
          // 丢弃工具调用信息，只保留文本
          const textBlocks = msg.contentBlocks?.filter(b => b.type === 'text') || [];
          if (textBlocks.length > 0) {
            compactedMessages.push({
              ...msg,
              content: (textBlocks as TextBlock[]).map(b => b.text).join('\n'),
              contentBlocks: textBlocks,
            });
          }
        }
      }

      // Layer 2: 工具结果用占位符替换
      for (const turnId of layer2Turns) {
        const turnMessages = turns.get(turnId) || [];
        for (const msg of turnMessages) {
          if (msg.isToolResult && msg.toolName) {
            // 用占位符替换
            compactedMessages.push({
              ...msg,
              content: this.createToolResultPlaceholder(msg.toolName, msg.content),
            });
          } else {
            compactedMessages.push(msg);
          }
        }
      }

      // Layer 1: 完整保留
      for (const turnId of layer1Turns) {
        const turnMessages = turns.get(turnId) || [];
        compactedMessages.push(...turnMessages);
      }

      // 检查 Layer 1 是否超过 50K 阈值，超则截断工具结果
      const layer1Messages = layer1Turns.flatMap(id => turns.get(id) || []);
      let layer1Tokens = layer1Messages.reduce((sum, m) => sum + approxTokenCount(getContentAsText(m.content)), 0);

      if (layer1Tokens > LAYER_TOKEN_LIMIT) {
        log.warn(`Layer 1 (${layer1Tokens} tokens) 超过 ${LAYER_TOKEN_LIMIT} 阈值，截断工具结果`);
        // 截断 Layer 1 中的长工具结果
        const truncationIndex = compactedMessages.length - layer1Turns.flatMap(id => turns.get(id) || []).length;
        for (let i = truncationIndex; i < compactedMessages.length; i++) {
          const msg = compactedMessages[i];
          if (msg.isToolResult && msg.toolName && getContentLength(msg.content) > 2000) {
            const truncated = truncateContent(msg.content, 2000, '\n... [内容已截断，如需完整内容请重新执行]');
            compactedMessages[i] = {
              ...msg,
              content: truncated,
            };
          }
        }
      }

      // E-3: 安全替换
      messages.length = 0;
      messages.push(...compactedMessages);

      const tokensAfter = this.estimateMessagesTokens(messages);

      log.info(`动态压缩完成: ${tokensBefore} → ${tokensAfter} tokens (节省 ${tokensBefore - tokensAfter} tokens)`);
      this.emit('context_compacted', { tokensBefore, tokensAfter, status: 'completed' });

      try {
        const fs = await import('fs');
        const path = await import('path');
        const logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logEntry = [
          `[${new Date().toISOString()}] 完成: ${tokensBefore} → ${tokensAfter} tokens (节省 ${tokensBefore - tokensAfter}, ${Math.round((1 - tokensAfter / tokensBefore) * 100)}%)`,
          `  turns=${totalTurns} L1=${layer1Turns.length} L2=${layer2Turns.length} L3=${layer3Turns.length} msgs=${compactedMessages.length} agent=${this.agentId || '?'}`,
        ].join('\n');
        fs.appendFileSync(path.join(logDir, 'memory-compact.log'), logEntry + '\n', 'utf-8');
      } catch {}

      // 持久化压缩结果
      if (this.memorySystem && this.agentId) {
        try {
          const replacementHistory: RolloutItem[] = compactedMessages.map(msg => ({
            type: 'message' as const,
            timestamp: new Date().toISOString(),
            role: msg.role,
            content: getContentAsText(msg.content),
          }));

          await this.memorySystem.recordRuntimeCompaction(
            this.agentId,
            this.memorySpace as any,
            {
              summary: `压缩: ${totalTurns}轮 → 保留最近${LAYER1_TURN_COUNT}轮完整 + ${LAYER2_TURN_COUNT}轮占位符`,
              replacementHistory,
              preservedCount: layer1Turns.length,
              originalCount: totalTurns,
            }
          );
          log.info(`动态压缩结果已持久化到 rollout 文件`);
        } catch (persistError) {
          log.warn(`持久化压缩结果失败:`, persistError);
        }
      }

      return { tokensBefore, tokensAfter };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`动态压缩失败: ${errorMsg}`);

      // E-3: 恢复备份
      messages.length = 0;
      messages.push(...backup);
      log.info('已恢复压缩前的消息状态');

      this.emit('context_compacted', { tokensBefore, tokensAfter: tokensBefore, status: 'failed', error: errorMsg });
      return { tokensBefore, tokensAfter: tokensBefore };
    }
  }

  /**
   * 创建工具结果占位符
   */
  private createToolResultPlaceholder(toolName: string, originalContent: string | MultiModalContent[]): string {
    // 提取关键信息
    const COMPACTABLE_TOOLS_SET = new Set(['read_file', 'exec', 'grep', 'glob', 'web_search', 'web_fetch']);
    const contentStr = typeof originalContent === 'string' ? originalContent : getContentAsText(originalContent);

    if (!COMPACTABLE_TOOLS_SET.has(toolName)) {
      return contentStr;  // 非特定工具，保留原内容
    }

    switch (toolName) {
      case 'read_file':
        // 尝试提取文件路径
        const filePathMatch = contentStr.match(/文件[:：]\s*(\S+)/);
        const filePath = filePathMatch ? filePathMatch[1] : '未知文件';
        return `[已读取文件: ${filePath}，如需完整内容请重新读取]`;

      case 'exec':
        const cmdMatch = contentStr.match(/命令[:：]\s*(.+)/);
        const cmd = cmdMatch ? cmdMatch[1].slice(0, 50) : '未知命令';
        return `[已执行命令: ${cmd}，如需完整输出请重新执行]`;

      case 'grep':
        const patternMatch = contentStr.match(/模式[:：]\s*(\S+)/);
        const pattern = patternMatch ? patternMatch[1] : '未知模式';
        const countMatch = contentStr.match(/(\d+)\s*(个|条)/);
        const count = countMatch ? countMatch[1] : '?';
        return `[已搜索: ${pattern}，找到 ${count} 个结果，如需完整结果请重新搜索]`;

      case 'glob':
        const globMatch = contentStr.match(/模式[:：]\s*(\S+)/);
        const globPattern = globMatch ? globMatch[1] : '未知模式';
        return `[已匹配: ${globPattern}，如需完整结果请重新匹配]`;

      case 'web_search':
        const queryMatch = contentStr.match(/查询[:：]\s*(.+)/);
        const query = queryMatch ? queryMatch[1].slice(0, 50) : '未知查询';
        return `[已搜索网页: ${query}，如需完整结果请重新搜索]`;

      case 'web_fetch':
        const urlMatch = contentStr.match(/https?:\/\/\S+/);
        const url = urlMatch ? urlMatch[0].slice(0, 60) : '未知URL';
        return `[已抓取网页: ${url}，如需完整内容请重新抓取]`;

      default:
        return `[已执行 ${toolName}，如需完整结果请重新执行]`;
    }
  }

  /**
   * 生成压缩摘要
   * 参考: codex-rs/core/src/compact.rs drain_to_completed
   */
  private async generateCompactionSummary(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    llmService: AhiveCoderLLMService
  ): Promise<string> {
    // 构建对话文本
    const conversationText = messages
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
      .join('\n\n');

    // 截断输入（参考 CODEX COMPACT_USER_MESSAGE_MAX_TOKENS）
    const maxInputTokens = this.config.compactUserMessageMaxTokens * 2;
    const truncatedText = this.truncateToTokenBudget(conversationText, maxInputTokens);

    // 调用 LLM 生成摘要
    // 参考: codex-rs/core/templates/compact/prompt.md
    try {
      const response = await llmService.chat([
        {
          role: 'system',
          content: `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`
        },
        {
          role: 'user',
          content: `Please generate a summary for the following conversation:\n\n${truncatedText}`
        }
      ]);

      const summary = response.content || '(Unable to generate summary)';
      return this.truncateToTokenBudget(summary, 4000); // 摘要最大 4K tokens
    } catch (error) {
      log.warn('LLM 摘要生成失败，使用简单摘要');
      return this.generateSimpleSummary(messages);
    }
  }

  /**
   * 生成简单摘要（无 LLM 时使用）
   * 参考: codex-rs/core/templates/compact/prompt.md
   */
  private generateSimpleSummary(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  ): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    const recentTopics = userMessages
      .slice(-5)
      .map((m, i) => `${i + 1}. ${m.content.slice(0, 100)}...`)
      .join('\n');

    return `## Progress
- Conversation rounds: ${userMessages.length}
- User messages: ${userMessages.length}
- Assistant responses: ${assistantMessages.length}

## Key Context
Recent topics discussed:
${recentTopics}

## Next Steps
[Continue from where the conversation left off]`;
  }

  /**
   * 构建压缩后的历史
   * 参考: codex-rs/core/src/compact.rs build_compacted_history
   * 
   * 🔧 修复记录:
   * - E-2: 确保 user/assistant 交替（合并连续同 role 消息）
   * - E-8: 不再重复添加旧用户消息（摘要已包含关键信息）
   */
  private buildCompactedHistory(
    _userMessages: string[],
    summary: string,
    preservedMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    initialSystemPrompt?: string
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const raw: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    // 1. 构建环境刷新块 (Environment Refresher) - 防止上下文腐化
    const refresherBlock = `
> [!IMPORTANT]
> **Environment Refresher & Critical Context**
> - **Current Working Directory (CWD)**: \`${this.workdir}\`
> - **Active Mission**: Continue assisting the user based on the summary provided below.
> - **System Constraints**: Adhere to all previous safety guidelines and tool usage rules.
`.trim();

    // 2. 注入策略处理 (参考 CODEX InitialContextInjection)
    const injectionStrategy = this.config.initialContextInjection || 'after_summary';
    const hasInitialContext = !!initialSystemPrompt;

    // 前置注入
    if (hasInitialContext && injectionStrategy === 'before_summary') {
      raw.push({ role: 'system', content: `[Initial Context Reinjection]\n${initialSystemPrompt}` });
    }

    // 3. 添加摘要消息
    const SUMMARY_PREFIX = `Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:`;
    const summaryText = `${SUMMARY_PREFIX}\n\n${summary}`;
    raw.push({ role: 'user', content: summaryText });

    // 4. 后置注入 (包含环境刷新)
    if (injectionStrategy === 'after_summary') {
      if (hasInitialContext) {
        raw.push({ role: 'system', content: `[Initial Context Reinjection]\n${initialSystemPrompt}` });
      }
      raw.push({ role: 'system', content: refresherBlock });
    }

    // 5. 添加确认与保留消息
    raw.push({ role: 'assistant', content: '[Acknowledged summary and system refresher, continuing from preserved context]' });
    raw.push(...preservedMessages as any);

    // E-2: 合并连续相同 role 的消息，确保 user/assistant 严格交替
    const result: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    for (const msg of raw) {
      const last = result[result.length - 1];
      if (last && last.role === msg.role) {
        // 合并到上一条消息
        last.content += '\n\n' + msg.content;
      } else {
        result.push({ ...msg } as any);
      }
    }

    return result;
  }

  /**
   * 估算消息列表的 token 数
   *
   * 🔧 修复：使用 approxTokenCount 考虑中文字符，而不是固定比例
   */
  private estimateMessagesTokens(
    messages: InternalMessage[]
  ): number {
    let totalChars = 0;
    for (const m of messages) {
      totalChars += getContentLength(m.content);
      if (m.contentBlocks) {
        for (const cb of m.contentBlocks) {
          if (cb.type === 'text') {
            totalChars += (cb as TextBlock).text.length;
          } else if (cb.type === 'tool_use') {
            const inp = (cb as ToolUseBlock).tool_input;
            totalChars += JSON.stringify(inp).length;
          } else if (cb.type === 'tool_result') {
            const out = (cb as ToolResultBlock).tool_output;
            totalChars += typeof out === 'string' ? out.length : JSON.stringify(out).length;
          }
        }
      }
    }
    return approxTokenCountFromCharCount(totalChars);
  }

  /**
   * 估算文本 token 数
   */
  private estimateTokens(text: string): number {
    return approxTokenCount(text);
  }

  /**
   * 按 token 预算截断文本
   * 
   * 🔧 E-5 修复：使用与 approxTokenCount 一致的估算逻辑
   */
  private truncateToTokenBudget(text: string, maxTokens: number): string {
    const currentTokens = approxTokenCount(text);
    if (currentTokens <= maxTokens) return text;

    // 按比例计算应保留的字符数
    const ratio = maxTokens / currentTokens;
    const maxChars = Math.floor(text.length * ratio);

    // 保留头尾
    const headChars = Math.floor(maxChars * 0.6);
    const tailChars = maxChars - headChars;

    const head = text.slice(0, headChars);
    const tail = text.slice(-tailChars);

    const omittedTokens = approxTokenCount(text.slice(headChars, text.length - tailChars));
    return `${head}\n\n... 省略 ${omittedTokens} tokens ...\n\n${tail}`;
  }

  /**
   * 格式化记忆为历史对话格式
   * 🔧 修复：使用 Token 预算动态截断，不再强制每条 500 字符
   */
  private formatMemoryAsHistory(items: any[], tokenBudget: number = 20000): string {
    if (!items || items.length === 0) return '';

    // 将 items 转换为 GenericMessage 格式进行预算截断
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
}

export function createAhiveCoderExecutor(
  toolRegistry: ToolRegistry,
  config?: Partial<AhiveCoderExecutorConfig>,
  hookEngine?: HookEngine
): AhiveCoderExecutor {
  return new AhiveCoderExecutor(toolRegistry, config, hookEngine);
}