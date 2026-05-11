/**
 * AHIVECORE 统一智能体管理器
 * 
 * 管理 ahive-worker 和 ahive-coder 两种智能体：
 * - ahive-worker: 使用 [TOOL] 格式，支持本地小模型
 * - ahive-coder: 使用 Function Calling，专注编程任务
 * 
 * 两者通过统一 API 通讯
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/index.js';
import { AhiveWorkerExecutor, createAhiveWorkerExecutor, type AhiveWorkerResult } from './ahive-worker/executor.js';
import { AhiveCoderExecutor, createAhiveCoderExecutor, type AhiveCoderEvent, type AhiveCoderLLMService } from './ahive-coder/executor.js';
import { getAhiveWorkerPrompt } from './ahive-worker/prompts.js';
import { getAhiveCoderPrompt } from './ahive-coder/prompts.js';
import type { ToolRegistry } from '../executor/tool-system.js';

// ============ 类型定义 ============

export type AgentType = 'ahive-worker' | 'ahive-coder';

export interface AgentInfo {
  id: string;
  type: AgentType;
  name: string;
  model?: string;
  createdAt: Date;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

// ============ 智能体基类 ============

abstract class BaseAgent {
  id: string;
  type: AgentType;
  name: string;
  model?: string;
  sessionMessages: Message[];
  createdAt: Date;

  constructor(type: AgentType, name: string, model?: string) {
    this.id = `${type}_${randomUUID().slice(0, 8)}`;
    this.type = type;
    this.name = name;
    this.model = model;
    this.sessionMessages = [];
    this.createdAt = new Date();
  }

  abstract execute(
    llmService: any,
    toolRegistry: ToolRegistry,
    message: string,
    onEvent?: (event: any) => void
  ): Promise<{ content: string; iterations: number; toolCallsExecuted: number }>;

  getSystemPrompt(): string {
    return '';
  }

  getSessionMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.sessionMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }

  appendMessages(messages: Array<{ role: 'user' | 'assistant'; content: string }>): void {
    for (const m of messages) {
      this.sessionMessages.push({ ...m, timestamp: new Date() });
    }
  }

  clearSession(): void {
    this.sessionMessages = [];
  }
}

// ============ AHIVE-WORKER 智能体 ============

class AhiveWorkerAgent extends BaseAgent {
  private executor: AhiveWorkerExecutor | null = null;

  constructor(name: string, model?: string) {
    super('ahive-worker', name, model);
  }

  getSystemPrompt(): string {
    const prompts = getAhiveWorkerPrompt();
    return `${prompts.system}\n\n${prompts.tools}`;
  }

  async execute(
    llmService: any,
    toolRegistry: ToolRegistry,
    message: string,
    onEvent?: (event: any) => void
  ): Promise<{ content: string; iterations: number; toolCallsExecuted: number }> {
    if (!this.executor) {
      this.executor = createAhiveWorkerExecutor(toolRegistry);
    }

    const result = await this.executor.execute(llmService, {
      systemPrompt: this.getSystemPrompt(),
      userMessage: message,
      sessionMessages: this.getSessionMessages(),
      onToolStart: (name, args) => {
        if (onEvent) onEvent({ type: 'tool_start', toolName: name, args });
      },
      onToolEnd: (name, result, success) => {
        if (onEvent) onEvent({ type: 'tool_end', toolName: name, success });
      },
    });

    this.appendMessages([
      { role: 'user', content: message },
      { role: 'assistant', content: result.content },
    ]);

    return result;
  }
}

// ============ AHIVE-CODER 智能体 ============

class AhiveCoderAgent extends BaseAgent {
  private executor: AhiveCoderExecutor | null = null;

  constructor(name: string, model?: string) {
    super('ahive-coder', name, model);
  }

  getSystemPrompt(): string {
    const prompts = getAhiveCoderPrompt();
    return `${prompts.system}\n\n${prompts.tools}`;
  }

  async execute(
    llmService: any,
    toolRegistry: ToolRegistry,
    message: string,
    onEvent?: (event: any) => void
  ): Promise<{ content: string; iterations: number; toolCallsExecuted: number }> {
    if (!this.executor) {
      this.executor = createAhiveCoderExecutor(toolRegistry, {
        approvalPolicy: 'never',
        execTimeoutMs: 10000,
      });
    }

    const ahiveCoderLLMService: AhiveCoderLLMService = {
      chat: async (messages, config) => {
        const result = await llmService.chat(messages, config);
        return {
          content: result.content,
          toolCalls: result.toolCalls,
          finishReason: result.finishReason,
        };
      },
    };

    const result = await this.executor.execute(ahiveCoderLLMService, {
      systemPrompt: this.getSystemPrompt(),
      userMessage: message,
      sessionMessages: this.getSessionMessages(),
      onEvent: onEvent || (() => {}),
    });

    this.appendMessages([
      { role: 'user', content: message },
      { role: 'assistant', content: result.content },
    ]);

    return result;
  }
}

// ============ 统一管理器 ============

export class AgentManager {
  private agents: Map<string, BaseAgent> = new Map();
  private activeAgentId: string | null = null;
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  createAgent(type: AgentType, name?: string, model?: string): AgentInfo {
    const agentName = name || `${type}_${Date.now()}`;
    
    const agent = type === 'ahive-worker' 
      ? new AhiveWorkerAgent(agentName, model)
      : new AhiveCoderAgent(agentName, model);
    
    this.agents.set(agent.id, agent);
    
    if (!this.activeAgentId) {
      this.activeAgentId = agent.id;
    }
    
    logger.info(`[AgentManager] 创建智能体: ${agent.id} (${type})`);
    
    return {
      id: agent.id,
      type: agent.type,
      name: agent.name,
      model: agent.model,
      createdAt: agent.createdAt,
    };
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getActiveAgent(): string | null {
    return this.activeAgentId;
  }

  setActiveAgent(id: string): boolean {
    if (this.agents.has(id)) {
      this.activeAgentId = id;
      logger.info(`[AgentManager] 激活智能体: ${id}`);
      return true;
    }
    return false;
  }

  getType(id: string): AgentType | null {
    const agent = this.agents.get(id);
    return agent?.type || null;
  }

  listAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).map(a => ({
      id: a.id,
      type: a.type,
      name: a.name,
      model: a.model,
      createdAt: a.createdAt,
    }));
  }

  deleteAgent(id: string): boolean {
    if (id === this.activeAgentId) {
      this.activeAgentId = null;
    }
    return this.agents.delete(id);
  }

  async sendMessage(
    fromAgentId: string,
    toAgentId: string,
    message: string,
    llmService: any
  ): Promise<{ content: string }> {
    const toAgent = this.agents.get(toAgentId);
    if (!toAgent) {
      throw new Error(`目标智能体不存在: ${toAgentId}`);
    }

    const result = await toAgent.execute(llmService, this.toolRegistry, message);
    return { content: result.content };
  }

  async execute(
    message: string,
    llmService: any,
    onEvent?: (event: any) => void
  ): Promise<{ content: string; iterations: number; toolCallsExecuted: number }> {
    if (!this.activeAgentId) {
      // 默认创建 AHIVE-WORKER 智能体
      this.createAgent('ahive-worker', 'default');
    }

    const agent = this.agents.get(this.activeAgentId!);
    if (!agent) {
      throw new Error('智能体不存在');
    }

    logger.info(`[AgentManager] 执行智能体: ${agent.id} (${agent.type})`);
    
    return agent.execute(llmService, this.toolRegistry, message, onEvent);
  }
}

export function createAgentManager(toolRegistry: ToolRegistry): AgentManager {
  return new AgentManager(toolRegistry);
}