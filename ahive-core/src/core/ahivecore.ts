/**
 * AHIVECORE - 核心智能体（指挥官）
 * 
 * 系统核心智能体，永久存在，不可删除
 * 运行在主进程内，拥有系统最高权限
 * 支持工具调用能力（通过 CodexExecutor）
 * 支持记忆持久化（存储在 data/memories/spaces/core/）
 * 
 * 提示词系统：
 * - 基础提示词始终加载
 * - SKILL 按需动态加载（根据用户消息触发词）
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/index.js';
import { UnifiedAgentSystem } from '../agents/core/UnifiedAgentSystem.js';
import { AhiveCoderExecutor, type AhiveCoderLLMService, type AhiveCoderEvent } from '../agents/ahive-coder/executor.js';
import type { ProviderManager } from '../providers/provider-manager.js';
import type { AgentModelConfig } from '../agents/core/UnifiedAgentSystem.js';
import { getMemoryManager } from '../memory/new-integration.js';
import { getWSClient } from '../monitoring/ws-client.js';
import { getConfig } from './config.js';

// 指挥官 SKILL 管理器
import { getCommanderSkillManager, type CommanderSkillManager } from '../prompts/commander/SkillManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 类型定义 ====================

/** 流式事件类型 */
export type StreamEventType =
  | 'stream-start'      // 流式开始
  | 'stream-end'        // 流式结束
  | 'stream-error'      // 流式错误
  | 'text-delta'        // 文本增量
  | 'thinking-delta'    // 思考增量
  | 'tool-start'        // 工具开始
  | 'tool-end'          // 工具结束
  | 'tool-error'        // 工具错误
  | 'llm-start'         // LLM 开始
  | 'llm-end'           // LLM 结束
  | 'llm-prompt'        // LLM 提示词（供前端展示）
  | 'turn-started'      // 轮次开始
  | 'turn-complete'     // 轮次完成
  | 'turn-aborted'      // 轮次中断
  | 'agent-message'     // 完整消息
  | 'exec-begin'        // Shell命令开始
  | 'exec-output'       // Shell命令输出增量
  | 'exec-end'          // Shell命令结束
  | 'iteration'         // 迭代进度
  | 'tools-detected'    // 检测到工具调用
  | 'context-compacted'; // 上下文压缩

/** 流式事件 */
export interface StreamEvent {
  type: StreamEventType;
  agentId: string;
  timestamp: number;
  [key: string]: any;
}

/** AHIVECORE 配置 */
export interface AHIVECoreConfig {
  /** 智能体 ID（固定） */
  id: string;
  /** 名称（固定） */
  name: string;
  /** 是否为核心智能体 */
  isCore: boolean;
  /** 是否可删除 */
  deletable: boolean;
  /** 模型配置 */
  modelConfig: AgentModelConfig;
}

/** 动态注入数据 */
export interface DynamicInjectionData {
  agentsList: string;
  systemCapabilities: string;
  mcpCapabilities: string;
}

/** AHIVECORE 初始化依赖 */
export interface AHIVECoreDependencies {
  agentSystem: UnifiedAgentSystem;
  ahiveCoderExecutor: AhiveCoderExecutor;
  providerManager: ProviderManager;
  memorySystem?: any;  // 记忆系统（可选）
}

// ==================== 默认配置 ====================

// CORE 智能体固定 ID
export const CORE_AGENT_ID = 'ahivecore';

const AHIVECORE_DEFAULT_CONFIG: AHIVECoreConfig = {
  id: CORE_AGENT_ID,
  name: 'AHIVECORE',
  isCore: true,
  deletable: false,
  modelConfig: {
    // 🔄 不再硬编码 gpt-4o，改为使用当前 Provider 的模型
    // 初始化时会从 ProviderManager 获取实际配置
    provider: 'bailian',
    name: 'qwen-plus',
    temperature: 0.7,
    maxTokens: 8192,
  },
};

// ==================== AHIVECORE 类 ====================

/**
 * AHIVECORE 核心智能体类
 */
export class AHIVECore {
  private config: AHIVECoreConfig;
  private agentSystem: UnifiedAgentSystem | null = null;
  private ahiveCoderExecutor: AhiveCoderExecutor | null = null;
  private providerManager: ProviderManager | null = null;
  private memorySystem: any = null;  // 记忆系统
  private agentId: string | null = null;
  private skillManager: CommanderSkillManager;  // SKILL 管理器

  // 动态注入数据
  private dynamicData: DynamicInjectionData = {
    agentsList: '// 暂无智能体',
    systemCapabilities: '// 暂无能力',
    mcpCapabilities: '// 暂无MCP能力',
  };

  // 🆕 项目配置提示词（从工作流心跳注入）
  private projectPrompt: string | null = null;
  private projectPromptMeta: { workflowId: string; agentId: string; version: number; mtime: number } | null = null;
  private ideWorkdir: string | null = null;

  // 🆕 中断支持
  private interrupted: boolean = false;

  private enableThinkingStream: boolean = true;

  setWorkdir(workdir: string) {
    this.ideWorkdir = workdir;
    logger.info(`[AHIVECORE] 工作目录已设置: ${workdir}`);
  }

  startNewSession(): string | null {
    if (!this.memorySystem || !this.agentId) return null;
    const threadId = this.memorySystem.startNewSession(this.agentId, 'core');
    this.ahiveCoderExecutor?.clearHistory();
    return threadId;
  }

  constructor(config: Partial<AHIVECoreConfig> = {}) {
    this.config = { ...AHIVECORE_DEFAULT_CONFIG, ...config };
    this.skillManager = getCommanderSkillManager();
    this.loadFeatureConfig();
  }

  private loadFeatureConfig(): void {
    const features = getConfig().getConfig().features;
    if (features?.enableThinkingStream === false) {
      this.enableThinkingStream = false;
      logger.info('[AHIVECORE] 思考推流已关闭 (features.enableThinkingStream = false)');
    }
  }

  /**
   * 初始化 AHIVECORE
   */
  async initialize(deps: AHIVECoreDependencies): Promise<void> {
    logger.info('[AHIVECORE] 🚀 初始化核心智能体...');

    this.agentSystem = deps.agentSystem;
    this.ahiveCoderExecutor = deps.ahiveCoderExecutor;
    this.providerManager = deps.providerManager;
    this.memorySystem = deps.memorySystem || getMemoryManager();  // 使用传入的或全局记忆系统

    // 🆕 从 ProviderManager 获取当前 Provider 的配置，而不是使用硬编码的 gpt-4o
    // 获取脱敏配置用于日志
    const currentProviderInfoForLog = this.providerManager.getCurrentConfig(false);
    // 获取完整配置用于实际 API 调用
    const currentProviderInfo = this.providerManager.getCurrentConfig(true);
    const currentProviderConfig = currentProviderInfo.config;
    const actualModelConfig: AgentModelConfig = {
      provider: currentProviderInfo.type as any || 'openai',
      name: currentProviderConfig.apiModel || currentProviderConfig.ollamaModel || currentProviderConfig.modelName || 'default',
      temperature: currentProviderConfig.temperature || 0.7,
      maxTokens: currentProviderConfig.maxTokens || 8192,
      baseUrl: currentProviderConfig.apiEndpoint || currentProviderConfig.baseUrl,
      apiKey: currentProviderConfig.apiKey,
    };

    logger.info(`[AHIVECORE] 使用当前 Provider 配置: type=${actualModelConfig.provider}, model=${actualModelConfig.name}，apikey=${(currentProviderInfoForLog.config as any).apiKey || '******'}`);


    // 1. 创建智能体实例（使用固定 ID）
    this.agentId = this.agentSystem.createMainAgent('ahive-coder', {
      fixedId: CORE_AGENT_ID,  // 使用固定 ID
      nickname: this.config.name,
      role: 'system-core',
      model: actualModelConfig,  // 🆕 使用当前 Provider 的配置
      maxDepth: 5,
    });

    // 2. 确保记忆空间存在
    if (this.memorySystem) {
      await this.ensureMemorySpace();
    }

    // 3. 输出 SKILL 管理器状态
    const skillsInfo = this.skillManager.getAllSkillsInfo();
    logger.info(`[AHIVECORE] 📚 已注册 ${skillsInfo.length} 个 SKILL:`);
    for (const skill of skillsInfo) {
      logger.info(`[AHIVECORE]   - ${skill.name}: 触发词 [${skill.trigger.join(', ')}]`);
    }

    logger.info(`[AHIVECORE] ✅ 核心智能体已创建: ${this.agentId}`);
    logger.info('[AHIVECORE] 🔧 工具调用能力已启用');
    if (this.memorySystem) {
      logger.info('[AHIVECORE] 💾 记忆系统已启用 (space: core)');
    }
  }

  /**
   * 确保记忆空间存在
   */
  private async ensureMemorySpace(): Promise<void> {
    try {
      const memoryRoot = './data/memories';
      const coreSpacePath = path.join(memoryRoot, 'spaces', 'core');
      const rolloutsPath = path.join(coreSpacePath, 'rollouts');

      // 创建目录
      await fs.promises.mkdir(rolloutsPath, { recursive: true });
      logger.info(`[AHIVECORE] 记忆空间已准备: ${rolloutsPath}`);
    } catch (error) {
      logger.warn('[AHIVECORE] 创建记忆空间失败:', error);
    }
  }

  /**
   * 构建系统提示词
   * 根据用户消息动态加载相关 SKILL
   */
  private buildSystemPrompt(userMessage: string): string {
    // 使用 SKILL 管理器构建提示词（自动根据触发词加载 SKILL）
    let prompt = this.skillManager.buildSystemPrompt(userMessage);

    // 注入动态数据
    prompt = this.injectDynamicData(prompt);

    // 注入工具调用说明
    prompt = this.injectToolInstructions(prompt);

    // 🆕 注入项目配置提示词（如果有）
    if (this.projectPrompt) {
      prompt = `${prompt}\n\n---\n\n# 项目配置信息\n\n${this.projectPrompt}`;
      logger.debug(`[AHIVECORE] 已注入项目配置提示词: version=${this.projectPromptMeta?.version}`);
    }

    // 注入IDE工作目录
    if (this.ideWorkdir) {
      prompt = `${prompt}\n\n当前工作目录: ${this.ideWorkdir}`;
    }

    return prompt;
  }

  /**
   * 注入工具调用说明
   */
  private injectToolInstructions(prompt: string): string {
    // 从 AhiveCoderExecutor 获取工具注册表
    const tools = this.ahiveCoderExecutor?.getToolRegistry?.()?.getAll?.() || [];

    if (tools.length === 0) {
      logger.warn('[AHIVECORE] ⚠️ 没有注册的工具，跳过工具说明注入');
      return prompt;
    }

    // 生成工具说明
    const toolDescriptions = tools.map(tool => {
      const params = tool.parameters;
      let paramList = '';

      // 尝试提取参数信息
      if (params && typeof params === 'object' && 'shape' in params) {
        const shape = (params as any).shape;
        paramList = Object.entries(shape || {})
          .map(([name, schema]: [string, any]) => {
            const desc = schema?._def?.description || '';
            const isOptional = schema?._def?.typeName === 'ZodOptional';
            return `  - ${name}: ${desc} ${isOptional ? '(可选)' : '(必填)'}`;
          })
          .join('\n');
      }

      return `### ${tool.name}
${tool.description}
参数:
${paramList || '  无'}`;
    }).join('\n\n');

    // 工具调用说明
    const toolSection = `

---

## 🔧 工具调用能力

你可以使用以下工具来执行操作。当你需要调用工具时，请使用以下格式：

\`\`\`tool
{
  "name": "工具名称",
  "arguments": {
    "参数名": "参数值"
  }
}
\`\`\`

或者使用简化格式：

[TOOL]{"name": "工具名称", "arguments": {"参数名": "参数值"}}[/TOOL]

### 可用工具

${toolDescriptions}

## 工具使用规则

1. **只有需要执行操作时才调用工具**，普通对话不需要
2. **一次可以调用多个工具**，每个工具调用单独一个代码块
3. **调用工具后，我会告诉你执行结果**，你可以继续对话
4. **确保参数类型正确**，字符串用引号，数字不加引号
5. **路径使用绝对路径**，所有文件路径使用完整的绝对路径

## 重要提示

当用户要求你创建文件、保存内容时，**必须使用 write_file 工具**，不要只是输出内容。

示例：
\`\`\`tool
{
  "name": "write_file",
  "arguments": {
    "path": "F:/codex_space/test.txt",
    "content": "文件内容",
    "mkdir": true,
    "encoding": "utf-8"
  }
}
\`\`\`
`;

    // 在提示词末尾添加工具说明
    return prompt + toolSection;
  }

  /**
   * 注入动态数据到提示词
   */
  private injectDynamicData(prompt: string): string {
    return prompt
      .replace('{{DYNAMIC_AGENTS_LIST}}', this.dynamicData.agentsList)
      .replace('{{DYNAMIC_SYSTEM_CAPABILITIES}}', this.dynamicData.systemCapabilities)
      .replace('{{DYNAMIC_MCP_CAPABILITIES}}', this.dynamicData.mcpCapabilities);
  }

  /**
   * 更新动态数据
   */
  updateDynamicData(data: Partial<DynamicInjectionData>): void {
    this.dynamicData = { ...this.dynamicData, ...data };
    logger.info('[AHIVECORE] 动态数据已更新');
  }

  /**
   * 🆕 设置项目配置提示词
   */
  setProjectPrompt(prompt: string, meta: { workflowId: string; agentId: string; version: number; mtime: number }): void {
    this.projectPrompt = prompt;
    this.projectPromptMeta = meta;
    logger.info(`[AHIVECORE] 项目配置已更新: workflowId=${meta.workflowId}, agentId=${meta.agentId}, version=${meta.version}`);
  }

  /**
   * 获取系统提示词（基础版本，无用户消息上下文）
   */
  getSystemPrompt(): string {
    return this.buildSystemPrompt('');
  }

  /**
   * 获取智能体 ID
   */
  getAgentId(): string | null {
    return this.agentId;
  }

  /**
   * 设置中断标志
   */
  setInterrupted(interrupted: boolean): void {
    this.interrupted = interrupted;
    if (interrupted) {
      logger.info('[AHIVECORE] ⚠️ 任务已标记为中断');
      
      // 调用executor的interrupt方法
      if (this.ahiveCoderExecutor) {
        this.ahiveCoderExecutor.interrupt();
      }
    }
  }

  /**
   * 检查是否已中断
   */
  isInterrupted(): boolean {
    return this.interrupted;
  }

  /**
   * 添加用户插话
   */
  addUserInput(message: string): void {
    logger.info(`[AHIVECORE] 💬 用户插话: ${message.substring(0, 50)}...`);
    
    // 直接调用executor的submitUserInput方法
    if (this.ahiveCoderExecutor) {
      this.ahiveCoderExecutor.submitUserInput(message);
    }
    
    // 通过WebSocket推送插话事件
    const wsClient = getWSClient();
    if (wsClient && wsClient.isConnected()) {
      wsClient.send({
        type: 'event',
        payload: {
          type: 'user-interrupt',
          agentId: this.agentId,
          data: { message },
          timestamp: Date.now(),
        },
      });
    }
  }

  /**
   * 获取用户插话队列
   */
  getUserInputQueue(): string[] {
    // 返回executor的pendingUserInputs
    return [];
  }

  /**
   * 清空用户插话队列
   */
  clearUserInputQueue(): void {
    // executor会自动清空
  }

  /**
   * 执行对话（支持工具调用）
   */
  async chat(message: string): Promise<{ content: string; toolCallsExecuted: number }> {
    if (!this.agentSystem || !this.agentId) {
      throw new Error('AHIVECORE 未初始化');
    }

    if (!this.ahiveCoderExecutor || !this.providerManager) {
      throw new Error('AHIVECORE 执行器未配置');
    }

    this.interrupted = false;

    // 根据用户消息构建系统提示词（动态加载 SKILL）
    const systemPrompt = this.buildSystemPrompt(message);

    // 输出加载的 SKILL 信息
    const loadedSkills = this.skillManager.getLoadedSkills();
    if (loadedSkills.length > 0) {
      logger.info(`[AHIVECORE] 📚 本次加载的 SKILL: ${loadedSkills.join(', ')}`);
    }

    // 获取模型配置
    const modelConfig = this.agentSystem.getModelConfig(this.agentId);

    // 创建 LLM 服务适配器
    const llmService: AhiveCoderLLMService = {
      chat: async (messages, config) => {
        const response = await this.providerManager!.chat(messages, config || modelConfig);
        return {
          content: response.content,
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
          reasoningContent: response.reasoningContent,
        };
      },
    };

    // 使用 AhiveCoderExecutor 执行（支持工具调用循环）
    const result = await this.ahiveCoderExecutor.execute(llmService, {
      systemPrompt,
      userMessage: message,
      sessionMessages: [],
      modelConfig,
      onEvent: (event) => {
        // 可以在这里处理事件，如日志记录
        if (event.type === 'tool_start') {
          logger.info(`[AHIVECORE] 工具调用: ${event.toolName}`);
        }
      },
      agentId: this.agentId,           // 传递 agentId 用于记忆
      memorySystem: this.memorySystem, // 传递 memorySystem 用于记忆持久化
      memorySpace: 'core',             // 使用 'core' 记忆空间
    });

    return {
      content: result.content,
      toolCallsExecuted: result.toolCallsExecuted,
    };
  }

  /**
   * 流式对话（支持实时输出）
   * 
   * @param message 用户消息
   * @param onEvent 事件回调
   */
  async chatStream(
    message: string,
    onEvent: (event: StreamEvent) => void
  ): Promise<{ content: string; toolCallsExecuted: number }> {
    if (!this.agentSystem || !this.agentId) {
      throw new Error('AHIVECORE 未初始化');
    }

    if (!this.ahiveCoderExecutor || !this.providerManager) {
      throw new Error('AHIVECORE 执行器未配置');
    }

    // 重置中断标志
    this.interrupted = false;

    // 发送流式开始事件
    onEvent({
      type: 'stream-start',
      agentId: this.agentId,
      timestamp: Date.now(),
    });

    // 根据用户消息构建系统提示词（动态加载 SKILL）
    const systemPrompt = this.buildSystemPrompt(message);

    // 输出加载的 SKILL 信息
    const loadedSkills = this.skillManager.getLoadedSkills();
    if (loadedSkills.length > 0) {
      logger.info(`[AHIVECORE] 📚 本次加载的 SKILL: ${loadedSkills.join(', ')}`);
    }

    // 获取模型配置
    const modelConfig = this.agentSystem.getModelConfig(this.agentId);

    // 创建 LLM 服务适配器（支持流式）
    const llmService: AhiveCoderLLMService = {
      chat: async (messages, config) => {
        const response = await this.providerManager!.chat(messages, config || modelConfig);
        return {
          content: response.content,
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
          reasoningContent: response.reasoningContent,
        };
      },
      chatStream: async (messages, onDelta, config, onThinkingDelta) => {
        const response = await this.providerManager!.chatStream(
          messages,
          (delta) => {
            onDelta(delta);
          },
          config || modelConfig,
          onThinkingDelta
        );
        return {
          content: response.content,
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
          reasoningContent: response.reasoningContent,
        };
      },
    };

    // 使用 AhiveCoderExecutor 执行（支持工具调用循环）
    const result = await this.ahiveCoderExecutor.execute(llmService, {
      systemPrompt,
      userMessage: message,
      sessionMessages: [],
      modelConfig,
      onEvent: (event) => {
        // 转换事件类型并转发
        this.handleExecutorEvent(event, onEvent);
      },
      agentId: this.agentId,
      memorySystem: this.memorySystem,
      memorySpace: 'core',
    });

    // 发送流式结束事件
    onEvent({
      type: 'stream-end',
      agentId: this.agentId,
      timestamp: Date.now(),
    });

    return {
      content: result.content,
      toolCallsExecuted: result.toolCallsExecuted,
    };
  }

  /**
   * 处理执行器事件，转换为流式事件
   */
  private handleExecutorEvent(
    event: AhiveCoderEvent,
    onEvent: (event: StreamEvent) => void
  ): void {
    switch (event.type) {
      case 'agent_message_delta':
        onEvent({
          type: 'text-delta',
          agentId: this.agentId!,
          delta: event.delta || '',
          timestamp: event.timestamp,
        });
        break;

      case 'thinking_delta':
        if (!this.enableThinkingStream) break;
        onEvent({
          type: 'thinking-delta',
          agentId: this.agentId!,
          delta: event.delta || '',
          timestamp: event.timestamp,
        });
        break;

      case 'tool_start':
        onEvent({
          type: 'tool-start',
          agentId: this.agentId!,
          toolCallId: event.toolCallId || '',
          toolName: event.toolName || '',
          arguments: event.arguments || {},
          timestamp: event.timestamp,
        });
        break;

      case 'tool_end':
        onEvent({
          type: 'tool-end',
          agentId: this.agentId!,
          toolCallId: event.toolCallId || '',
          success: event.success !== false,
          duration: event.duration || 0,
          timestamp: event.timestamp,
        });
        break;

      case 'tool_error':
        onEvent({
          type: 'tool-error',
          agentId: this.agentId!,
          toolCallId: event.toolCallId || '',
          error: event.error || 'Unknown error',
          timestamp: event.timestamp,
        });
        break;

      case 'llm_call_start':
        onEvent({
          type: 'llm-start',
          agentId: this.agentId!,
          timestamp: event.timestamp,
        });
        break;

      case 'llm_call_end':
        onEvent({
          type: 'llm-end',
          agentId: this.agentId!,
          timestamp: event.timestamp,
        });
        break;

      case 'llm_prompt':
        onEvent({
          type: 'llm-prompt',
          agentId: this.agentId!,
          timestamp: event.timestamp,
          messages: event.messages || [],
          categories: event.categories || {},
          totalMessages: event.totalMessages || 0,
        });
        break;

      case 'error':
        onEvent({
          type: 'stream-error',
          agentId: this.agentId!,
          error: event.message || 'Unknown error',
          timestamp: event.timestamp,
        });
        break;

      case 'turn_started':
        onEvent({ type: 'turn-started', agentId: this.agentId!, timestamp: event.timestamp });
        break;

      case 'turn_complete':
        onEvent({
          type: 'turn-complete',
          agentId: this.agentId!,
          content: event.content,
          completionReason: event.completionReason,
          timestamp: event.timestamp,
        });
        break;

      case 'turn_aborted':
        onEvent({ type: 'turn-aborted', agentId: this.agentId!, reason: event.reason || 'unknown', timestamp: event.timestamp });
        break;

      case 'agent_message':
        onEvent({
          type: 'agent-message',
          agentId: this.agentId!,
          content: event.content,
          completionReason: event.completionReason,
          waitingForUser: event.waitingForUser,
          timestamp: event.timestamp,
        });
        break;

      case 'exec_command_begin':
        onEvent({ type: 'exec-begin', agentId: this.agentId!, command: event.command || '', timestamp: event.timestamp });
        break;

      case 'exec_command_output_delta':
        onEvent({ type: 'exec-output', agentId: this.agentId!, delta: event.delta || '', timestamp: event.timestamp });
        break;

      case 'exec_command_end':
        onEvent({ type: 'exec-end', agentId: this.agentId!, success: event.success !== false, timestamp: event.timestamp });
        break;

      case 'iteration_start':
        onEvent({ type: 'iteration', agentId: this.agentId!, iteration: event.iteration || 0, timestamp: event.timestamp });
        break;

      case 'tool_calls_detected':
        onEvent({ type: 'tools-detected', agentId: this.agentId!, count: event.count || 0, timestamp: event.timestamp });
        break;

      case 'context_compacted':
        onEvent({ type: 'context-compacted', agentId: this.agentId!, status: event.status || 'unknown', timestamp: event.timestamp });
        break;
    }
  }

  /**
   * 获取配置
   */
  getConfig(): AHIVECoreConfig {
    return { ...this.config };
  }

  /**
   * 检查是否为核心智能体（永远返回 true）
   */
  isCoreAgent(): boolean {
    return true;
  }

  /**
   * 检查是否可删除（永远返回 false）
   */
  isDeletable(): boolean {
    return false;
  }

  /**
   * 获取 SKILL 管理器
   */
  getSkillManager(): CommanderSkillManager {
    return this.skillManager;
  }

  /**
   * 获取执行器
   */
  getExecutor(): AhiveCoderExecutor | null {
    return this.ahiveCoderExecutor;
  }
}

// ==================== 单例 ====================

let ahivecoreInstance: AHIVECore | null = null;

/**
 * 获取 AHIVECORE 实例
 */
export function getAHIVECore(config?: Partial<AHIVECoreConfig>): AHIVECore {
  if (!ahivecoreInstance) {
    ahivecoreInstance = new AHIVECore(config);
  }
  return ahivecoreInstance;
}

/**
 * 初始化 AHIVECORE
 */
export async function initializeAHIVECore(
  deps: AHIVECoreDependencies,
  config?: Partial<AHIVECoreConfig>
): Promise<AHIVECore> {
  const instance = getAHIVECore(config);
  await instance.initialize(deps);
  return instance;
}