/**
 * Agent 协作协议
 * 解析 Agent 输出中的协作指令，支持 Agent 间通信
 */

import type { Agent } from '../types';

// ========== 协作指令类型 ==========

/** 协作指令类型 */
export type ProtocolCommandType = 
  | 'request_agent'   // 请求其他 Agent 帮助
  | 'broadcast'       // 广播消息给所有 Agent
  | 'vote'            // 发起投票
  | 'query_peer';     // 向特定 Agent 请教

/** 请求 Agent 指令 */
export interface RequestAgentCommand {
  type: 'request_agent';
  /** 目标 Agent 名称或 ID */
  targetAgent: string;
  /** 请求内容 */
  request: string;
  /** 上下文数据 (可选) */
  context?: Record<string, unknown>;
  /** 优先级 (1-10, 默认 5) */
  priority?: number;
  /** 是否需要等待结果 */
  waitForResult: boolean;
}

/** 广播指令 */
export interface BroadcastCommand {
  type: 'broadcast';
  /** 广播频道 */
  channel: string;
  /** 事件名称 */
  event: string;
  /** 广播数据 */
  data: Record<string, unknown>;
  /** 排除的 Agent */
  excludeAgents?: string[];
}

/** 投票指令 */
export interface VoteCommand {
  type: 'vote';
  /** 投票 ID */
  voteId: string;
  /** 投票主题 */
  topic: string;
  /** 投票选项 */
  options: string[];
  /** 参与投票的 Agent (空则全部) */
  participants?: string[];
  /** 超时时间 (秒) */
  timeout?: number;
}

/** 请教指令 */
export interface QueryPeerCommand {
  type: 'query_peer';
  /** 目标 Agent 角色/技能 */
  targetRole: string;
  /** 问题 */
  question: string;
  /** 上下文 */
  context?: string;
}

/** 统一协作指令 */
export type ProtocolCommand = 
  | RequestAgentCommand 
  | BroadcastCommand 
  | VoteCommand 
  | QueryPeerCommand;

/** 协作指令解析结果 */
export interface ProtocolParseResult {
  /** 是否发现协作指令 */
  hasCommands: boolean;
  /** 解析出的指令列表 */
  commands: ProtocolCommand[];
  /** 清理后的文本 (移除指令标签) */
  cleanedText: string;
  /** 解析错误 */
  errors?: string[];
}

/** 协作协议配置 */
export interface AgentProtocolConfig {
  /** 是否启用协作协议 */
  enabled: boolean;
  /** 指令标签前缀 */
  tagPrefix: string;
  /** 最大嵌套调用深度 */
  maxRecursionDepth: number;
  /** 单次响应最大指令数 */
  maxCommandsPerResponse: number;
  /** 请求 Agent 超时 (秒) */
  requestTimeout: number;
}

// ========== 协作协议解析器 ==========

/**
 * Agent 协作协议解析器
 */
export class AgentProtocolParser {
  private config: Required<AgentProtocolConfig>;

  // 指令正则表达式
  private patterns = {
    // <REQUEST_AGENT: coder, "帮我实现这个功能", waitForResult=true>
    requestAgent: /<REQUEST_AGENT:\s*([^,]+),\s*"([^"]+)"(?:,\s*(\{[^}]+\}))?(?:,\s*priority=(\d+))?(?:,\s*waitForResult=(true|false))?\s*>/gi,
    
    // <BROADCAST: "channel", "event", {"key": "value"}>
    broadcast: /<BROADCAST:\s*"([^"]+)",\s*"([^"]+)",\s*(\{[^}]+\})(?:,\s*exclude=\[([^\]]+)\])?\s*>/gi,
    
    // <VOTE: "vote-001", "选择方案", ["A", "B", "C"], participants=["agent1", "agent2"]>
    vote: /<VOTE:\s*"([^"]+)",\s*"([^"]+)",\s*(\[[^\]]+\])(?:,\s*participants=\[([^\]]+)\])?(?:,\s*timeout=(\d+))?\s*>/gi,
    
    // <QUERY_PEER: "analyzer", "这段代码有什么问题？", context="...">
    queryPeer: /<QUERY_PEER:\s*"([^"]+)",\s*"([^"]+)"(?:,\s*context="([^"]+)")?\s*>/gi,
  };

  constructor(config: AgentProtocolConfig = { enabled: true } as AgentProtocolConfig) {
    this.config = {
      enabled: config.enabled ?? true,
      tagPrefix: config.tagPrefix ?? '<',
      maxRecursionDepth: config.maxRecursionDepth ?? 5,
      maxCommandsPerResponse: config.maxCommandsPerResponse ?? 10,
      requestTimeout: config.requestTimeout ?? 120,
    };
  }

  /**
   * 解析 Agent 输出中的协作指令
   */
  parse(output: string): ProtocolParseResult {
    if (!this.config.enabled) {
      return {
        hasCommands: false,
        commands: [],
        cleanedText: output,
      };
    }

    const commands: ProtocolCommand[] = [];
    const errors: string[] = [];
    let cleanedText = output;

    try {
      // 解析 REQUEST_AGENT 指令
      cleanedText = this.parseRequestAgentCommands(cleanedText, commands, errors);
      
      // 解析 BROADCAST 指令
      cleanedText = this.parseBroadcastCommands(cleanedText, commands, errors);
      
      // 解析 VOTE 指令
      cleanedText = this.parseVoteCommands(cleanedText, commands, errors);
      
      // 解析 QUERY_PEER 指令
      cleanedText = this.parseQueryPeerCommands(cleanedText, commands, errors);

    } catch (error) {
      errors.push(`Parse error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 限制指令数量
    const limitedCommands = commands.slice(0, this.config.maxCommandsPerResponse);

    return {
      hasCommands: limitedCommands.length > 0,
      commands: limitedCommands,
      cleanedText: cleanedText.trim(),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * 解析 REQUEST_AGENT 指令
   */
  private parseRequestAgentCommands(
    text: string, 
    commands: ProtocolCommand[], 
    errors: string[]
  ): string {
    return text.replace(this.patterns.requestAgent, (match, targetAgent, request, contextJson, priority, waitForResult) => {
      try {
        const command: RequestAgentCommand = {
          type: 'request_agent',
          targetAgent: targetAgent.trim(),
          request: request.trim(),
          priority: priority ? parseInt(priority, 10) : 5,
          waitForResult: waitForResult !== 'false',
        };

        if (contextJson) {
          try {
            command.context = JSON.parse(contextJson);
          } catch {
            // 上下文解析失败不影响主流程
          }
        }

        commands.push(command);
      } catch (error) {
        errors.push(`Failed to parse REQUEST_AGENT: ${match}`);
      }
      return ''; // 移除指令标签
    });
  }

  /**
   * 解析 BROADCAST 指令
   */
  private parseBroadcastCommands(
    text: string, 
    commands: ProtocolCommand[], 
    errors: string[]
  ): string {
    return text.replace(this.patterns.broadcast, (match, channel, event, dataJson, excludeStr) => {
      try {
        const command: BroadcastCommand = {
          type: 'broadcast',
          channel: channel.trim(),
          event: event.trim(),
          data: JSON.parse(dataJson),
        };

        if (excludeStr) {
          command.excludeAgents = excludeStr.split(',').map((s: string) => s.trim().replace(/"/g, ''));
        }

        commands.push(command);
      } catch (error) {
        errors.push(`Failed to parse BROADCAST: ${match}`);
      }
      return '';
    });
  }

  /**
   * 解析 VOTE 指令
   */
  private parseVoteCommands(
    text: string, 
    commands: ProtocolCommand[], 
    errors: string[]
  ): string {
    return text.replace(this.patterns.vote, (match, voteId, topic, optionsJson, participantsStr, timeout) => {
      try {
        const command: VoteCommand = {
          type: 'vote',
          voteId: voteId.trim(),
          topic: topic.trim(),
          options: JSON.parse(optionsJson),
        };

        if (participantsStr) {
          command.participants = participantsStr.split(',').map((s: string) => s.trim().replace(/"/g, ''));
        }

        if (timeout) {
          command.timeout = parseInt(timeout, 10);
        }

        commands.push(command);
      } catch (error) {
        errors.push(`Failed to parse VOTE: ${match}`);
      }
      return '';
    });
  }

  /**
   * 解析 QUERY_PEER 指令
   */
  private parseQueryPeerCommands(
    text: string, 
    commands: ProtocolCommand[], 
    errors: string[]
  ): string {
    return text.replace(this.patterns.queryPeer, (match, targetRole, question, context) => {
      try {
        const command: QueryPeerCommand = {
          type: 'query_peer',
          targetRole: targetRole.trim(),
          question: question.trim(),
        };

        if (context) {
          command.context = context.trim();
        }

        commands.push(command);
      } catch (error) {
        errors.push(`Failed to parse QUERY_PEER: ${match}`);
      }
      return '';
    });
  }

  /**
   * 生成 Agent 列表提示
   * 注入到 Agent prompt 中，让 Agent 知道可用的队友
   */
  generateAgentListPrompt(agents: Agent[], currentAgentId: string): string {
    const teammates = agents.filter(a => a.id !== currentAgentId);
    
    if (teammates.length === 0) {
      return '';
    }

    const agentList = teammates.map(a => {
      const skills = a.skills?.slice(0, 5).join(', ') || '通用';
      return `- **${a.name}** (${a.id}): ${a.description || '无描述'} [技能: ${skills}]`;
    }).join('\n');

    return `
## 可用的协作 Agent

你可以通过以下指令请求其他 Agent 协助：

### 请求特定 Agent 帮助
\`\`\`
<REQUEST_AGENT: agent-name, "具体请求内容", waitForResult=true>
\`\`\`

### 向特定角色请教
\`\`\`
<QUERY_PEER: "角色或技能", "问题内容">
\`\`\`

### 广播消息
\`\`\`
<BROADCAST: "频道名", "事件名", {"key": "value"}>
\`\`\`

### 发起投票
\`\`\`
<VOTE: "vote-id", "投票主题", ["选项A", "选项B"]>
\`\`\`

**当前可用的 Agent 列表:**
${agentList}

**注意:** 使用协作指令时，系统会自动执行相应操作，你将在响应中收到结果。
`;
  }

  /**
   * 检查是否允许递归调用
   */
  canRecursion(currentDepth: number): boolean {
    return currentDepth < this.config.maxRecursionDepth;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<AgentProtocolConfig> {
    return this.config;
  }
}

// ========== 协作协议执行器 ==========

/** 协作指令执行结果 */
export interface ProtocolExecutionResult {
  /** 指令类型 */
  type: ProtocolCommandType;
  /** 是否成功 */
  success: boolean;
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行耗时 (ms) */
  duration?: number;
}

/** 协作协议执行回调 */
export interface ProtocolExecutorCallbacks {
  /** 执行 Agent 请求 */
  executeAgentRequest: (targetAgent: string, request: string, context?: Record<string, unknown>) => Promise<{
    success: boolean;
    output: string[];
    error?: string;
  }>;
  /** 广播消息 */
  broadcast?: (channel: string, event: string, data: Record<string, unknown>) => void;
  /** 发起投票 */
  vote?: (voteId: string, topic: string, options: string[]) => Promise<string>;
  /** 请教同僚 */
  queryPeer?: (role: string, question: string, context?: string) => Promise<string>;
}

/**
 * 协作协议执行器
 */
export class AgentProtocolExecutor {
  private parser: AgentProtocolParser;
  private callbacks: ProtocolExecutorCallbacks;
  private recursionDepth = 0;

  constructor(
    parser: AgentProtocolParser,
    callbacks: ProtocolExecutorCallbacks
  ) {
    this.parser = parser;
    this.callbacks = callbacks;
  }

  /**
   * 执行协作指令
   */
  async executeCommands(
    commands: ProtocolCommand[],
    currentDepth = 0
  ): Promise<ProtocolExecutionResult[]> {
    const results: ProtocolExecutionResult[] = [];

    for (const command of commands) {
      const startTime = Date.now();
      
      try {
        let result: ProtocolExecutionResult;

        switch (command.type) {
          case 'request_agent':
            result = await this.executeRequestAgent(command, currentDepth);
            break;
          case 'broadcast':
            result = await this.executeBroadcast(command);
            break;
          case 'vote':
            result = await this.executeVote(command);
            break;
          case 'query_peer':
            result = await this.executeQueryPeer(command);
            break;
          default: {
            // TypeScript needs explicit never check
            const _exhaustiveCheck: never = command;
            result = {
              type: _exhaustiveCheck as unknown as ProtocolCommandType,
              success: false,
              error: `Unknown command type`,
            };
          }
        }
        result.duration = Date.now() - startTime;
        results.push(result);

      } catch (error) {
        results.push({
          type: command.type,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        });
      }
    }

    return results;
  }

  /**
   * 执行 REQUEST_AGENT 指令
   */
  private async executeRequestAgent(
    command: RequestAgentCommand,
    currentDepth: number
  ): Promise<ProtocolExecutionResult> {
    // 检查递归深度
    if (!this.parser.canRecursion(currentDepth)) {
      return {
        type: 'request_agent',
        success: false,
        error: `Max recursion depth (${this.parser.getConfig().maxRecursionDepth}) exceeded`,
      };
    }

    try {
      const result = await this.callbacks.executeAgentRequest(
        command.targetAgent,
        command.request,
        command.context
      );

      return {
        type: 'request_agent',
        success: result.success,
        result: {
          output: result.output,
          targetAgent: command.targetAgent,
        },
        error: result.error,
      };
    } catch (error) {
      return {
        type: 'request_agent',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 执行 BROADCAST 指令
   */
  private async executeBroadcast(command: BroadcastCommand): Promise<ProtocolExecutionResult> {
    if (!this.callbacks.broadcast) {
      return {
        type: 'broadcast',
        success: false,
        error: 'Broadcast callback not implemented',
      };
    }

    try {
      this.callbacks.broadcast(command.channel, command.event, command.data);
      
      return {
        type: 'broadcast',
        success: true,
        result: { channel: command.channel, event: command.event },
      };
    } catch (error) {
      return {
        type: 'broadcast',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 执行 VOTE 指令
   */
  private async executeVote(command: VoteCommand): Promise<ProtocolExecutionResult> {
    if (!this.callbacks.vote) {
      return {
        type: 'vote',
        success: false,
        error: 'Vote callback not implemented',
      };
    }

    try {
      const winningOption = await this.callbacks.vote(
        command.voteId,
        command.topic,
        command.options
      );

      return {
        type: 'vote',
        success: true,
        result: { voteId: command.voteId, winner: winningOption },
      };
    } catch (error) {
      return {
        type: 'vote',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 执行 QUERY_PEER 指令
   */
  private async executeQueryPeer(command: QueryPeerCommand): Promise<ProtocolExecutionResult> {
    if (!this.callbacks.queryPeer) {
      return {
        type: 'query_peer',
        success: false,
        error: 'QueryPeer callback not implemented',
      };
    }

    try {
      const answer = await this.callbacks.queryPeer(
        command.targetRole,
        command.question,
        command.context
      );

      return {
        type: 'query_peer',
        success: true,
        result: { answer, targetRole: command.targetRole },
      };
    } catch (error) {
      return {
        type: 'query_peer',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 重置递归深度
   */
  resetRecursion(): void {
    this.recursionDepth = 0;
  }
}

// ========== 默认实例 ==========

export const agentProtocolParser = new AgentProtocolParser();

// ========== 辅助函数 ==========

/**
 * 快速解析协作指令
 */
export function parseProtocolCommands(output: string): ProtocolParseResult {
  return agentProtocolParser.parse(output);
}

/**
 * 生成 Agent 列表提示
 */
export function generateAgentListPrompt(agents: Agent[], currentAgentId: string): string {
  return agentProtocolParser.generateAgentListPrompt(agents, currentAgentId);
}