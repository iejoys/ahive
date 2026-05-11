/**
 * Agents Engine - AHIVECORE 智能体引擎核心
 * 
 * 功能：
 * - LLM API 调用封装
 * - 意图解析
 * - 任务编排
 */

import { logger } from '../utils/index.js';

// ============ 核心接口 ============

/**
 * 智能体定义
 */
export interface Agent {
  /** 智能体 ID */
  id: string;
  /** 智能体名称 */
  name: string;
  /** 智能体描述 */
  description?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 模型配置 */
  model?: ModelConfig;
  /** 工具列表 */
  tools?: string[];
  /** 权限配置 */
  permissions?: AgentPermissions;
}

/**
 * 模型配置（本地 Ollama 优先，无需 API Key）
 */
export interface ModelConfig {
  /** 模型名称（如 qwen2.5:3b） */
  name: string;
  /** 模型提供商（默认 ollama 本地） */
  provider?: 'ollama' | 'openai' | 'deepseek';
  /** API Key（仅云端需要，本地模型不需要） */
  apiKey?: string;
  /** 温度参数 */
  temperature?: number;
  /** 最大 tokens */
  maxTokens?: number;
  /** Ollama 服务地址（默认 localhost:11434） */
  ollamaHost?: string;
  /** 额外参数 */
  [key: string]: any;
}

/**
 * 智能体权限
 */
export interface AgentPermissions {
  /** 允许的命令 */
  allowedCommands?: string[];
  /** 允许的工具 */
  allowedTools?: string[];
  /** 允许的文件操作 */
  allowFileOperations?: boolean;
  /** 允许的网络访问 */
  allowNetworkAccess?: boolean;
  /** 最大 token 预算 */
  maxTokenBudget?: number;
}

/**
 * 对话消息
 */
/** 多模态内容块 */
export interface MultiModalContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  /** 角色 */
  role: 'system' | 'user' | 'assistant';
  /** 消息内容（支持纯文本或多模态内容数组） */
  content: string | MultiModalContent[];
  /** 工具调用（如果有） */
  toolCalls?: ToolCall[];
  /** 工具结果（如果有） */
  toolResults?: ToolResult[];
}

/**
 * 工具调用
 */
export interface ToolCall {
  /** 工具 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  arguments: Record<string, any>;
}

/**
 * 工具结果
 */
export interface ToolResult {
  /** 工具 ID */
  toolCallId: string;
  /** 工具结果 */
  result: any;
  /** 错误信息 */
  error?: string;
}

/**
 * LLM 响应
 */
export interface LLMResponse {
  /** 响应内容 */
  content: string;
  /** 使用的模型 */
  model: string;
  /** 使用的 tokens */
  usage: TokenUsage;
  /** 工具调用（如果有） */
  toolCalls?: ToolCall[];
  /** 完成原因 */
  finishReason?: string;
}

/**
 * Token 使用情况
 */
export interface TokenUsage {
  /** 输入 tokens */
  promptTokens: number;
  /** 输出 tokens */
  completionTokens: number;
  /** 总 tokens */
  totalTokens: number;
}

/**
 * 意图解析结果
 */
export interface IntentResult {
  /** 意图类型 */
  type: IntentType;
  /** 意图参数 */
  params: Record<string, any>;
  /** 置信度 */
  confidence: number;
  /** 原始输入 */
  rawInput: string;
}

/**
 * 意图类型
 */
export type IntentType =
  | 'CHAT'              // 闲聊
  | 'DEPLOY_AGENT'      // 部署智能体
  | 'START_AGENT'       // 启动智能体
  | 'STOP_AGENT'        // 停止智能体
  | 'LIST_AGENTS'       // 列出智能体
  | 'DIAGNOSE'          // 诊断问题
  | 'EXECUTE_COMMAND'   // 执行命令
  | 'SEARCH'            // 搜索
  | 'READ_FILE'         // 读取文件
  | 'WRITE_FILE'        // 写入文件
  | 'UNKNOWN';          // 未知

// ============ LLM 客户端 ============

/**
 * LLM 客户端接口
 */
export interface LLMClient {
  /** 聊天完成 */
  chat: (messages: ChatMessage[], config?: ModelConfig) => Promise<LLMResponse>;
  /** 流式聊天 */
  chatStream?: (messages: ChatMessage[], config?: ModelConfig) => AsyncIterable<string>;
}

/**
 * 简单 LLM 客户端（模拟实现）
 * 
 * 注：完整版本应实现 MiniMax/DeepSeek/OpenAI 等 API 调用
 */
export class SimpleLLMClient implements LLMClient {
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  /**
   * 聊天完成（模拟）
   */
  async chat(messages: ChatMessage[], config?: ModelConfig): Promise<LLMResponse> {
    const effectiveConfig = { ...this.config, ...config };
    
    // 模拟响应
    const lastMessage = messages[messages.length - 1];
    const lastContent = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);
    const responseContent = this.generateMockResponse(lastContent);

    return {
      content: responseContent,
      model: effectiveConfig.name || 'mock-model',
      usage: {
        promptTokens: messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length) / 4, 0),
        completionTokens: responseContent.length / 4,
        totalTokens: 0,
      },
      finishReason: 'stop',
    };
  }

  /**
   * 生成模拟响应
   */
  private generateMockResponse(input: string): string {
    const lowerInput = input.toLowerCase();
    
    if (lowerInput.includes('你好') || lowerInput.includes('hello')) {
      return '你好！我是 AHIVE 母体智能体，有什么可以帮你的吗？';
    }
    
    if (lowerInput.includes('部署') || lowerInput.includes('安装')) {
      return '我可以帮你部署智能体。请告诉我你想部署哪个智能体？';
    }
    
    if (lowerInput.includes('列表') || lowerInput.includes('所有')) {
      return '当前已接入的智能体：\n1. OpenClaw (在线)\n2. Pi Agent (离线)\n3. Claude Code (在线)';
    }
    
    return '收到你的消息了。本地模型未加载，请检查模型文件。';
  }
}

// 导出 Ollama 客户端（备选）
export { OllamaClient, createOllamaClient, RECOMMENDED_MODELS } from './ollama-client.js';
export type { OllamaConfig } from './ollama-client.js';

// 导出 GGUF 客户端（默认，开箱即用）
export { 
  GGUFClient, 
  createGGUFClient, 
  getDefaultModelPath, 
  hasEmbeddedModel,
  registerExecutorTools
} from './gguf-client.js';
export type { GGUFConfig } from './gguf-client.js';

// ============ 意图解析器 ============

/**
 * 意图解析器
 */
export class IntentParser {
  private llmClient?: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient;
  }

  /**
   * 解析用户输入（混合方案：规则优先，LLM 兜底）
   */
  async parse(input: string): Promise<IntentResult> {
    // 1. 先用规则匹配（快、免费）
    const ruleResult = this.parseWithRules(input);
    
    // 规则置信度高（>= 0.8），直接返回
    if (ruleResult.confidence >= 0.8) {
      logger.debug(`📋 规则匹配成功：${ruleResult.type} (${ruleResult.confidence})`);
      return ruleResult;
    }
    
    // 2. 对于 CHAT 类型（默认闲聊），直接返回，不需要 LLM 二次判断
    // 因为 CHAT 会直接调用 LLM 生成回复，这里不需要浪费一次调用
    if (ruleResult.type === 'CHAT') {
      logger.debug(`💬 识别为闲聊，直接返回 (${ruleResult.confidence})`);
      return ruleResult;
    }
    
    // 3. 只有操作类意图且置信度低时，才用 LLM 二次判断
    if (this.llmClient && ruleResult.confidence < 0.8) {
      logger.debug(`🤔 操作意图置信度低 (${ruleResult.confidence})，使用 LLM 解析...`);
      const llmResult = await this.parseWithLLM(input);
      
      // LLM 置信度也低，回退到规则
      if (llmResult.confidence < 0.6) {
        logger.warn(`⚠️ LLM 置信度也低 (${llmResult.confidence})，回退到规则匹配`);
        return ruleResult;
      }
      
      logger.info(`✅ LLM 解析成功：${llmResult.type} (${llmResult.confidence})`);
      return llmResult;
    }
    
    // 4. 没有 LLM，只能用规则
    return ruleResult;
  }

  /**
   * 使用 LLM 解析
   */
  private async parseWithLLM(input: string): Promise<IntentResult> {
    const systemPrompt = `你是 AHIVE 母体智能体的意图解析器。

支持的操作：
- DEPLOY_AGENT: 部署新智能体（如"安装 OpenClaw"、"部署 Pi"）
- START_AGENT: 启动智能体服务（如"启动 OpenClaw"、"开始运行"）
- STOP_AGENT: 停止智能体服务（如"停止 OpenClaw"、"关闭 Pi"）
- LIST_AGENTS: 列出已接入的智能体（如"列出所有智能体"、"有哪些智能体"）
- DIAGNOSE: 诊断智能体问题（如"OpenClaw 启动失败"、"出问题了"）
- CHAT: 闲聊对话（如"你好"、"你是谁"）

⚠️ 重要：只返回 JSON，不要任何其他文字！
返回格式：{"type": "意图类型", "params": {"agentName": "智能体名称"}, "confidence": 0.5}

示例：
用户："帮我装个 AHIVE-Worker" → {"type": "DEPLOY_AGENT", "params": {"agentName": "ahive-worker"}, "confidence": 0.9}
用户："启动 AHIVE-Coder" → {"type": "START_AGENT", "params": {"agentName": "ahive-coder"}, "confidence": 0.95}
用户："你好" → {"type": "CHAT", "params": {}, "confidence": 0.8}`;

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ];

      const response = await this.llmClient!.chat(messages);
      
      // 尝试解析 JSON
      let parsed: any;
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(response.content);
      }
      
      return {
        type: (parsed.type as IntentType) || 'CHAT',
        params: parsed.params || {},
        confidence: parsed.confidence || 0.7,
        rawInput: input,
      };
    } catch (error) {
      logger.warn(`LLM 意图解析失败：${error}，回退到规则匹配`);
      return this.parseWithRules(input);
    }
  }

  /**
   * 使用规则匹配（已简化，所有意图由 LLM 判断）
   */
  private parseWithRules(input: string): IntentResult {
    // 不再硬编码规则，所有意图由 LLM 判断
    // 避免误判如 "如何安装 OpenClaw" 被当作部署命令
    return {
      type: 'CHAT',
      params: { message: input },
      confidence: 0.5,
      rawInput: input,
    };
  }

  /**
   * 提取智能体名称
   */
  private extractAgentName(input: string): string {
    const agents = ['ahive-worker', 'ahive-coder', 'pi', 'claude', 'gemini'];
    const lowerInput = input.toLowerCase();
    
    for (const agent of agents) {
      if (lowerInput.includes(agent)) {
        return agent;
      }
    }
    
    return 'unknown';
  }
}

// ============ 任务编排器 ============

/**
 * 任务步骤
 */
export interface TaskStep {
  /** 步骤 ID */
  id: string;
  /** 步骤描述 */
  description: string;
  /** 步骤类型 */
  type: 'llm' | 'tool' | 'command' | 'wait';
  /** 步骤配置 */
  config: any;
  /** 是否完成 */
  completed: boolean;
  /** 步骤结果 */
  result?: any;
  /** 错误信息 */
  error?: string;
}

/**
 * 任务定义
 */
export interface Task {
  /** 任务 ID */
  id: string;
  /** 任务描述 */
  description: string;
  /** 任务步骤 */
  steps: TaskStep[];
  /** 任务状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 创建时间 */
  createdAt: Date;
  /** 完成时间 */
  completedAt?: Date;
}

/**
 * 任务编排器
 */
export class TaskOrchestrator {
  private tasks: Map<string, Task> = new Map();
  private llmClient?: LLMClient;

  constructor(llmClient?: LLMClient) {
    this.llmClient = llmClient;
  }

  /**
   * 创建任务
   */
  async createTask(description: string): Promise<Task> {
    const task: Task = {
      id: `task_${Date.now()}`,
      description,
      steps: [],
      status: 'pending',
      createdAt: new Date(),
    };

    // 使用 LLM 规划任务步骤
    if (this.llmClient) {
      task.steps = await this.planTaskSteps(description);
    }

    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * 规划任务步骤（使用 LLM）
   */
  private async planTaskSteps(description: string): Promise<TaskStep[]> {
    // 简化实现：返回单步骤
    return [
      {
        id: 'step_1',
        description: '处理任务',
        type: 'llm',
        config: { prompt: description },
        completed: false,
      },
    ];
  }

  /**
   * 执行任务
   */
  async executeTask(taskId: string): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = 'running';

    for (const step of task.steps) {
      try {
        step.result = await this.executeStep(step);
        step.completed = true;
      } catch (error) {
        step.error = error instanceof Error ? error.message : String(error);
        task.status = 'failed';
        break;
      }
    }

    if (task.status !== 'failed') {
      task.status = 'completed';
      task.completedAt = new Date();
    }

    return task;
  }

  /**
   * 执行步骤
   */
  private async executeStep(step: TaskStep): Promise<any> {
    switch (step.type) {
      case 'llm':
        if (this.llmClient) {
          const response = await this.llmClient.chat([
            { role: 'user', content: step.config.prompt },
          ]);
          return response.content;
        }
        return 'LLM not configured';
      
      case 'wait':
        await new Promise(resolve => setTimeout(resolve, step.config.duration || 1000));
        return 'waited';
      
      default:
        return 'executed';
    }
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 列出任务
   */
  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}

/**
 * 创建 LLM 客户端（默认使用内嵌 GGUF 模型，开箱即用）
 */
export function createLLMClient(config?: ModelConfig): LLMClient {
  // 默认使用 GGUF 内嵌模型（开箱即用）
  const { createGGUFClient, hasEmbeddedModel } = require('./gguf-client.js');
  const { createOllamaClient } = require('./ollama-client.js');
  
  // 如果有内嵌模型，优先使用
  if (hasEmbeddedModel()) {
    return createGGUFClient({
      modelName: config?.name,
      temperature: config?.temperature,
      maxTokens: config?.maxTokens,
    });
  }
  
  // 否则尝试 Ollama
  return createOllamaClient({
    model: config?.name,
    baseUrl: config?.baseUrl || config?.ollamaHost,
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
  });
}

/**
 * 创建意图解析器
 */
export function createIntentParser(llmClient?: LLMClient): IntentParser {
  return new IntentParser(llmClient);
}

/**
 * 创建任务编排器
 */
export function createTaskOrchestrator(llmClient?: LLMClient): TaskOrchestrator {
  return new TaskOrchestrator(llmClient);
}

// ============ 多智能体分身系统 (新) ============

export { 
  AgentController, 
  agentController,
  AgentStatus as MultiAgentStatus,
  type AgentConfig as MultiAgentConfig,
  type AgentMessage as MultiAgentMessage,
  type AgentResult as MultiAgentResult,
  type SpawnAgentOptions,
  type SandboxPolicy,
  type ApprovalPolicy,
  type ToolCall as MultiToolCall,
  type ToolResult as MultiToolResult,
} from './core/AgentController.js';

// 智能体调度器（自动分身）
export {
  AgentDispatcher,
  agentDispatcher,
  type TaskComplexity,
  type TaskAnalysis,
  type DispatchResult,
} from './core/AgentDispatcher.js';

// 默认导出
export default {
  SimpleLLMClient,
  IntentParser,
  TaskOrchestrator,
  createLLMClient,
  createIntentParser,
  createTaskOrchestrator,
};

// ============ 新智能体系统（OpenClaw + Codex 分离） ============

// 智能体管理器（统一管理 AHIVE-WORKER 和 AHIVE-CODER）
export { AgentManager, createAgentManager, type AgentType, type AgentInfo, type Message } from './manager.js';

// AHIVE-WORKER 智能体（独立模块）
export * from './ahive-worker/index.js';

// AHIVE-CODER 智能体（独立模块）
export * from './ahive-coder/index.js';
