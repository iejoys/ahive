/**
 * 智能体子进程入口
 * 
 * 每个智能体（CODEX / OPENCLAW）运行在独立的子进程中
 * 通过 IPC 与主进程通讯
 */

import { logger } from '../utils/index.js';
import path from 'path';
import { AhiveCoderExecutor } from '../agents/ahive-coder/executor.js';
import { AhiveWorkerExecutor } from '../agents/ahive-worker/executor.js';
import { ToolRegistry, getGlobalToolRegistry, registerMCPTools } from '../executor/tool-system.js';
import { getProviderManager } from '../providers/provider-manager.js';
import { getCapabilityManager } from '../capabilities/index.js';
import { SkillManager, createSkillManager } from '../memory/skills/manager.js';
import type { AhiveCoderLLMService } from '../agents/ahive-coder/executor.js';
import { AHIVE_CODER_SYSTEM_PROMPT, AHIVE_CODER_TOOLS_PROMPT, AHIVE_CODER_FORMAT_PROMPT } from '../agents/ahive-coder/prompts.js';
import { getSystemPrompt } from '../core/role-prompts.js';
import type { CapabilityUpdateMessage } from '../capabilities/types.js';
import {
  AgentStatus,
  WorkerMessage,
  WorkerResponse,
  ExecuteRequest,
  AgentConfig as AgentConfigType,
  InitRequest,
  HandleMessageRequest,
  RPCCallRequest,
} from './types.js';

// ==================== 类型定义 ====================

interface AgentConfig {
  agentId: string;
  agentType: 'ahive-coder' | 'ahive-worker';
  toolRegistry: ToolRegistry;
  llmService: AhiveCoderLLMService;
  modelConfig?: any;
  memorySystem?: any;  // AHIVE-CODER 记忆系统
  roleId?: string;  // 角色ID（仅适用于 AHIVE-WORKER 类型）
  nickname?: string;  // 智能体昵称
  providerManager?: any;  // Provider 管理器（用于动态创建 Provider）
}

// ==================== 智能体工作进程 ====================

// 默认系统提示词（AHIVE-WORKER 类型）
const AHIVE_WORKER_SYSTEM_PROMPT = `你是 AHIVE-WORKER 智能体，一个强大的 AI 助手。

能力：
- 对话和问答
- 代码编写和修改
- 文件操作
- Shell 命令执行
- 与其他智能体通讯

工具调用格式：
\`\`\`tool
{
  "name": "工具名称",
  "arguments": { ... }
}
\`\`\`

跨智能体通讯：
- 可以向其他智能体发送消息：send_message({ to_agent: 'ahive-coder-main', message: '请帮我写个API' })
- 收到消息时会自动响应

注意：谨慎执行危险命令，确保操作安全。`;

const AHIVE_WORKER_TOOLS_PROMPT = `可用工具：
- send_message: 向其他智能体发送消息
- exec: 执行 Shell 命令
- read_file: 读取文件
- write_file: 写入文件
- list_dir: 列出目录
- delete: 删除文件
- get_time: 获取当前时间
- get_system_info: 获取系统信息

### 企业微信集成

当收到企业微信用户消息时，消息格式为：
[REQID: xxx]
用户消息内容

回复方式：
1. 使用 send_message 工具发送给 ahive-webot
2. 消息内容必须包含 REQID 标记

示例：
send_message({
  to_agent: "ahive-webot",
  message: "[REQID: xxx]\\n回复内容..."
})

注意：ahive-webot 会自动清理技术标记，用户只会看到干净的回复内容。`;

const AHIVE_WORKER_FORMAT_PROMPT = '使用 Markdown 格式回复，代码块注明语言。';

class AgentWorker {
  private config: AgentConfig;
  private executor: AhiveCoderExecutor | AhiveWorkerExecutor | null = null;
  private status: AgentStatus = AgentStatus.Idle;
  private startTime: number = Date.now();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastResult: { content: string; iterations: number; toolCallsExecuted: number } | null = null;
  private abortController: AbortController | null = null;
  private pendingReply: { from: string; replyTo: string } | null = null;
  // 死循环检测：消息历史记录（只需要 content 和 timestamp）
  private messageHistory: Array<{ content: string; timestamp: number }> = [];
  private static readonly MAX_HISTORY = 10;
  private static readonly SIMILARITY_THRESHOLD = 0.85;
  // 智能体专用 Provider（根据 modelConfig 创建）
  private provider: any = null;
  // SKILL 管理器（ahive-coder/ahive-worker 通用）
  private skillManager: SkillManager | null = null;
  // IDE 传入的工作目录
  private ideWorkdir: string | null = null;

  // 🆕 项目配置提示词（从工作流心跳注入）
  private projectPrompt: string | null = null;
  private projectPromptMeta: { workflowId: string; agentId: string; version: number; mtime: number } | null = null;

  public getProvider(): any {
    return this.provider;
  }

  /**
   * 设置项目配置提示词
   */
  setProjectPrompt(prompt: string, meta: { workflowId: string; agentId: string; version: number; mtime: number }): void {
    this.projectPrompt = prompt;
    this.projectPromptMeta = meta;
    logger.info(`[AgentWorker] 项目配置已更新: workflowId=${meta.workflowId}, agentId=${meta.agentId}, version=${meta.version}`);
  }

  constructor(config: AgentConfig) {
    this.config = config;
    this.setupIPC();
    this.initExecutor();
    this.startHeartbeat();
  }

  /**
   * 获取默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    let basePrompt = '';

    if (this.config.agentType === 'ahive-coder') {
      // AHIVE-CODER 类型始终使用原版提示词
      basePrompt = `${AHIVE_CODER_SYSTEM_PROMPT}\n\n${AHIVE_CODER_TOOLS_PROMPT}\n\n${AHIVE_CODER_FORMAT_PROMPT}`;
    } else {
      // AHIVE-WORKER 类型：根据 roleId 获取对应的角色提示词
      if (this.config.roleId) {
        try {
          basePrompt = getSystemPrompt(this.config.roleId);
          logger.info(`[AgentWorker] AHIVE-WORKER 使用角色提示词: ${this.config.roleId}`);
        } catch (error) {
          logger.warn(`[AgentWorker] 获取角色提示词失败，使用默认: ${error}`);
          basePrompt = `${AHIVE_WORKER_SYSTEM_PROMPT}\n\n${AHIVE_WORKER_TOOLS_PROMPT}\n\n${AHIVE_WORKER_FORMAT_PROMPT}`;
        }
      } else {
        // 默认 AHIVE-WORKER 提示词
        basePrompt = `${AHIVE_WORKER_SYSTEM_PROMPT}\n\n${AHIVE_WORKER_TOOLS_PROMPT}\n\n${AHIVE_WORKER_FORMAT_PROMPT}`;
      }
    }

    // 注入当前工作目录（优先使用IDE传入的，否则用process.cwd()）
    const cwd = this.ideWorkdir || process.cwd();
    
    if (cwd) {
      basePrompt = `${basePrompt}\n\n当前工作目录: ${cwd}`;
    }
logger.debug(`[AgentWorker]====当前工作目录:${cwd}`);
    // 注入项目配置提示词（如果有）
    if (this.projectPrompt) {
      basePrompt = `${basePrompt}\n\n---\n\n# 项目配置信息\n\n${this.projectPrompt}`;
      logger.debug(`[AgentWorker] 已注入项目配置提示词: version=${this.projectPromptMeta?.version}`);
    }

    // 注入能力摘要（MCP 工具和技能）
    try {
      const capabilityManager = getCapabilityManager();
      const capabilitiesSummary = capabilityManager.getCapabilitiesSummary(this.config.agentId);
      if (capabilitiesSummary) {
        basePrompt = `${basePrompt}\n\n---\n\n${capabilitiesSummary}`;
      }
    } catch (error) {
      // 能力管理器可能未初始化，忽略
    }

    // 注入 SKILL 元数据摘要（始终注入）
    if (this.skillManager && this.skillManager.getAll().length > 0) {
      const skillsSummary = this.skillManager.generateSkillsSummary();
      if (skillsSummary) {
        basePrompt = `${basePrompt}\n\n---\n\n${skillsSummary}`;
      }
    }

    return basePrompt;
  }

  /**
   * 启动心跳发送
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 30000); // 每 30 秒发送一次健康检查心跳
  }

  /**
      * 更新状态并立即通知主进程
      * 参考 CODEX: deliver_event_raw -> agent_status.send_replace(status)
      */
  private updateStatus(newStatus: AgentStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;

    // 参考 CODEX: 状态变化时发送 status_changed 消息
    // 同时发送 lastResult，供 waitChildAgent 获取
    process.send?.({
      type: 'status_changed',
      agentId: this.config.agentId,
      status: this.status,
      lastResult: this.lastResult,
      timestamp: Date.now(),
    });

    // 同时发送心跳（保持兼容）
    this.sendHeartbeat();
  }

  /**
   * 发送心跳
   */
  private sendHeartbeat(): void {
    process.send?.({
      type: 'heartbeat',
      agentId: this.config.agentId,
      status: this.status,
      agentStatus: this.status,  // 智能体内部状态
      nickname: this.config.nickname,
      timestamp: Date.now(),
    });
  }

  /**
   * 初始化执行器
   */
  private initExecutor(): void {
    this.executor = new AhiveCoderExecutor(this.config.toolRegistry, {
      approvalPolicy: 'never',
      dangerousTools: ['exec', 'delete', 'apply_patch'],
      heartbeatIntervalMs: 15000,
      contextWindow: (this.config.modelConfig as any)?.contextWindow || 200000,
      autoCompactTokenLimit: (this.config.modelConfig as any)?.autoCompactTokenLimit,
      autoCompactRatio: (this.config.modelConfig as any)?.autoCompactRatio || 0.9,
    });

    // 初始化 SKILL 管理器
    try {
      const skillsDir = path.join(process.cwd(), 'skills');
      this.skillManager = createSkillManager(skillsDir);
      this.skillManager.initialize().then(() => {
        logger.info(`[AgentWorker] SKILL 管理器初始化完成，${this.skillManager?.getAll().length || 0} 个技能可用`);
      }).catch((err: any) => {
        logger.warn(`[AgentWorker] SKILL 管理器初始化失败: ${err?.message}`);
      });
    } catch (err: any) {
      logger.warn(`[AgentWorker] SKILL 管理器创建失败: ${err?.message}`);
    }

    logger.info(`[AgentWorker] ${this.config.agentType} 执行器初始化完成 (AhiveCoderExecutor)`);

    // 注册该智能体可用的初始 MCP 工具
    this.registerInitialMCPTools().catch(err => logger.error(`[AgentWorker] 初始 MCP 工具注册失败:`, err));
  }

  /**
   * 注册该智能体可用的初始 MCP 工具
   */
  private async registerInitialMCPTools(): Promise<void> {
    if (!this.executor) return;
    try {
      const capabilityManager = getCapabilityManager();
      await capabilityManager.initialize();
      const mcpManager = capabilityManager.getMCPManager();
      const registry = this.executor.getToolRegistry();

      const allTools = mcpManager.getAllTools(this.config.agentId);
      const toolsByServer = new Map<string, any[]>();

      for (const item of allTools) {
        if (!toolsByServer.has(item.serverId)) {
          toolsByServer.set(item.serverId, []);
        }
        toolsByServer.get(item.serverId)!.push(item.tool);
      }

      for (const [serverId, tools] of toolsByServer) {
        registerMCPTools(serverId, tools, registry, mcpManager);
      }
      logger.info(`[AgentWorker] 已完成智能体 ${this.config.agentId} 的初始 MCP 工具注册, toolRegistry总数=${registry.getAll().length}`);

      // MCP 工具注册后刷新 Provider 的工具列表，解决与 handleInit 的时序竞态
      this._refreshProviderTools();
    } catch (error) {
      logger.error(`[AgentWorker] 初始 MCP 工具注册失败:`, error);
    }
  }

  private _refreshProviderTools(): void {
    try {
      const toolDefinitions = this.config.toolRegistry.toOpenAITools();
      if (toolDefinitions.length > 0) {
        if (this.provider && 'setTools' in this.provider) {
          this.provider.setTools(toolDefinitions);
          logger.info(`[AgentWorker] ✅ MCP 注册后刷新 Provider 工具列表: ${toolDefinitions.length} 个工具`);
        }
      }
    } catch (error) {
      logger.warn(`[AgentWorker] 刷新 Provider 工具列表失败:`, error);
    }
  }

  /**
   * 设置 IPC 通讯
   */
  private setupIPC(): void {
    process.on('message', async (msg: WorkerMessage) => {
      try {
        await this.handleMessage(msg);
      } catch (error: any) {
        logger.error(`[AgentWorker] 处理消息失败:`, error);
        this.sendError(error.message);
      }
    });

    process.on('uncaughtException', (error) => {
      logger.error(`[AgentWorker] 未捕获异常:`, error);
      this.sendEvent('error', { message: error.message, stack: error.stack });
    });

    process.on('unhandledRejection', (reason) => {
      logger.error(`[AgentWorker] 未处理的 Promise 拒绝:`, reason);
      this.sendEvent('error', { message: String(reason) });
    });
  }

  /**
      * 处理接收到的消息
      */
  private async handleMessage(msg: WorkerMessage): Promise<void> {
    switch (msg.type) {
      case 'init':
        await this.handleInit(msg as InitRequest);
        break;

      case 'execute':
        await this.handleExecute(msg as ExecuteRequest);
        break;

      case 'interrupt':
        this.handleInterrupt();
        break;

      case 'user_input':
        this.handleUserInput(msg as any);
        break;

      case 'handleMessage':
        await this.handleAgentMessage(msg as HandleMessageRequest);
        break;

      case 'agent_message':
        // 智能体间消息（MCP 技能消息等）
        await this.handleIncomingAgentMessage(msg as any);
        break;

      case 'capability_update':
        // MCP 能力更新消息
        await this.handleIncomingAgentMessage(msg as any);
        break;

      case 'health_check':
        this.handleHealthCheck();
        break;

      case 'stop':
        this.handleStop();
        break;

      case 'rpc_call':
        await this.handleRPCCall(msg as any);
        break;

      case 'message':
        await this.handleGenericMessage(msg as any);
        break;

      case 'project_prompt_update':
        this.handleProjectPromptUpdate(msg as any);
        break;

      case 'set_workdir':
        this.ideWorkdir = (msg as any).workdir;
        if (this.executor && 'workdir' in this.executor) {
          (this.executor as any).workdir = (msg as any).workdir;
        }
        logger.info(`[AgentWorker] 工作目录已设置: ${this.ideWorkdir}`);
        break;

      default:
        logger.warn(`[AgentWorker] 未知消息类型: ${(msg as any).type}`);
    }
  }

  /**
   * 从消息中提取实际内容（去掉提示词部分）
   */
  private extractActualContent(message: string): string {
    // 提示词格式: [AGENT COMMUNICATION PROTOCOL]...[END PROTOCOL]\n实际内容
    const protocolEnd = message.indexOf('[END PROTOCOL]');
    if (protocolEnd !== -1) {
      return message.substring(protocolEnd + 14).trim();
    }
    return message.trim();
  }

  /**
   * 计算两个字符串的相似度（基于实际内容）
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const content1 = this.extractActualContent(str1);
    const content2 = this.extractActualContent(str2);

    if (!content1 || !content2) return 0;
    if (content1 === content2) return 1;

    const len1 = content1.length;
    const len2 = content2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1;

    // 计算编辑距离
    const dp: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    for (let i = 0; i <= len1; i++) dp[i][0] = i;
    for (let j = 0; j <= len2; j++) dp[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (content1[i - 1] === content2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
        }
      }
    }

    const distance = dp[len1][len2];
    return 1 - distance / maxLen;
  }

  /**
   * 检测是否陷入死循环
   */
  private detectLoop(content: string): boolean {
    // 添加到历史
    this.messageHistory.push({
      content,
      timestamp: Date.now(),
    });

    // 只保留最近 10 条消息
    if (this.messageHistory.length > 10) {
      this.messageHistory.shift();
    }

    // 至少需要 4 条消息才能检测循环
    if (this.messageHistory.length < 4) {
      return false;
    }

    // 检测最近 4 条消息是否高度相似
    const recent = this.messageHistory.slice(-4);
    let similarCount = 0;

    for (let i = 1; i < recent.length; i++) {
      const similarity = this.calculateSimilarity(recent[i - 1].content, recent[i].content);
      if (similarity > 0.85) {
        similarCount++;
      }
    }

    // 如果连续 3 次相似度 > 85%，判定为死循环
    if (similarCount >= 3) {
      logger.warn(`[AgentWorker] 检测到死循环：最近 ${recent.length} 条消息高度相似`);
      return true;
    }

    return false;
  }

  /**
   * 处理来自其他智能体/客户端的消息（A2A/MCP）
   * 支持回复功能：如果消息包含 replyTo 字段，执行完成后会发送回复
   */
  private async handleIncomingAgentMessage(msg: any): Promise<void> {
    const { from, to, message, replyTo } = msg;
    logger.info(`[AgentWorker] 收到 A2A 消息: from=${from}, to=${to}, replyTo=${replyTo || '无'}`);

    // 提取消息内容用于死循环检测
    let contentForCheck: string | null = null;
    if (message) {
      if (message.content) {
        contentForCheck = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      } else if (message.text) {
        contentForCheck = message.text;
      } else if (message.message) {
        contentForCheck = typeof message.message === 'string' ? message.message : JSON.stringify(message.message);
      } else {
        contentForCheck = JSON.stringify(message);
      }
    }

    // 🆕 死循环检测
    if (contentForCheck && this.detectLoop(contentForCheck)) {
      logger.warn(`[AgentWorker] 检测到对话死循环，终止对话`);
      if (replyTo && from) {
        process.send?.({
          type: 'agent_reply',
          from: this.config.agentId,
          to: from,
          replyTo: replyTo,
          message: '[LOOP DETECTED] 对话陷入死循环，已自动终止。请重新开始对话或更换话题。',
          timestamp: Date.now(),
        });
      }
      return;
    }

    // 处理 capability_update 消息
    if (message?.type === 'capability_update') {
      try {
        const capabilityManager = getCapabilityManager();
        await capabilityManager.initialize();
        const capMessage = message as CapabilityUpdateMessage;
        capabilityManager.handleCapabilityUpdate(
          capMessage.agentId,
          capMessage.action,
          capMessage.payload,
          true  // skipSave: 子进程不写磁盘，由主进程统一持久化
        );

        // 动态注册工具到执行器
        if (this.executor) {
          const registry = this.executor.getToolRegistry();
          const mcpManager = capabilityManager.getMCPManager();

          // 处理批量更新
          if (capMessage.payload.capabilities && Array.isArray(capMessage.payload.capabilities)) {
            for (const cap of capMessage.payload.capabilities) {
              registerMCPTools(
                cap.server || cap.serverId,
                cap.tools,
                registry,
                mcpManager
              );
            }
          }
          // 处理单个服务器更新 (来自 /api/capabilities/mcp)
          else if (capMessage.payload.serverId && capMessage.payload.tools) {
            registerMCPTools(
              capMessage.payload.serverId,
              capMessage.payload.tools,
              registry,
              mcpManager
            );
          }
          // 兜底：如果 payload 本身就是服务器对象
          else if (capMessage.payload.tools && Array.isArray(capMessage.payload.tools)) {
            registerMCPTools(
              capMessage.payload.serverId || capMessage.payload.name || 'unknown',
              capMessage.payload.tools,
              registry,
              mcpManager
            );
          }
        }

        logger.info(`[AgentWorker] MCP 能力已更新并同步工具注册表 (Action: ${capMessage.action})`);

        // 动态注册后刷新 Provider 工具列表
        this._refreshProviderTools();
        this.sendEvent('capability_updated', {
          agentId: this.config.agentId,
          stats: capabilityManager.getStats(this.config.agentId),
        });
        return;
      } catch (error) {
        logger.error(`[AgentWorker] 处理 capability_update 失败:`, error);
        return;
      }
    }

    // 处理 skill_register 消息
    if (message?.type === 'skill_register') {
      try {
        const capabilityManager = getCapabilityManager();
        await capabilityManager.initialize();
        capabilityManager.registerSkill(message.skill, this.config.agentId);
        logger.info(`[AgentWorker] 技能已注册: ${message.skill.name} (Agent: ${this.config.agentId})`);
        return;
      } catch (error) {
        logger.error(`[AgentWorker] 注册技能失败:`, error);
        return;
      }
    }

    // 提取消息内容
    let content: string | null = null;

    if (message) {
      // 1. 尝试提取 content/text/message 字段
      if (message.content) {
        content = typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);
      } else if (message.text) {
        content = message.text;
      } else if (message.message) {
        content = typeof message.message === 'string'
          ? message.message
          : JSON.stringify(message.message);
      } else {
        // 2. 如果没有这些字段，将整个 message 对象转为 JSON
        content = JSON.stringify(message, null, 2);
        logger.info(`[AgentWorker] 消息无 content/text/message 字段，使用完整 JSON: ${content.substring(0, 100)}...`);
      }
    }

    if (!content) {
      logger.warn(`[AgentWorker] A2A 消息无有效内容，跳过`);
      return;
    }

    // 作为用户消息执行
    // 🔧 Issue 4 修复：添加状态管理，防止并发执行
    if (this.status === AgentStatus.Running) {
      logger.warn(`[AgentWorker] A2A 消息被拒绝：智能体正在执行任务 (status=${this.status})`);
      if (replyTo && from) {
        process.send?.({
          type: 'agent_reply',
          from: this.config.agentId,
          to: from,
          replyTo: replyTo,
          error: '智能体正忙，请稍后重试',
          timestamp: Date.now(),
        });
      }
      return;
    }

    this.updateStatus(AgentStatus.Running);

    try {
      let result: { content: string; iterations: number; toolCallsExecuted: number };

      if (this.config.agentType === 'ahive-coder') {
        const executor = this.executor as AhiveCoderExecutor;
        result = await executor.execute(this.config.llmService, {
          systemPrompt: this.getDefaultSystemPrompt(),
          userMessage: content,
          onEvent: (event: any) => {
            logger.debug(`[A2A AhiveCoder] event: ${event.type}`);
          },
          agentId: this.config.agentId,
          memorySystem: this.config.memorySystem,
        });
      } else {
        const executor = this.executor as AhiveWorkerExecutor;
        result = await executor.execute(this.config.llmService, {
          systemPrompt: this.getDefaultSystemPrompt(),
          userMessage: content,
          onEvent: (event: any) => {
            logger.debug(`[A2A AhiveWorker] event: ${event.type}`);
          },
          agentId: this.config.agentId,
          memorySystem: this.config.memorySystem,
        });
      }

      // 🔧 执行成功，恢复 Idle 状态
      this.updateStatus(AgentStatus.Idle);

      // 🆕 如果有 replyTo，发送回复
      if (replyTo && from) {
        process.send?.({
          type: 'agent_reply',
          from: this.config.agentId,
          to: from,
          replyTo: replyTo,
          message: result.content,
          timestamp: Date.now(),
        });
        logger.info(`[AgentWorker] 已发送回复: to=${from}, replyTo=${replyTo}`);
      }
    } catch (error: any) {
      logger.error(`[AgentWorker] A2A 消息执行失败:`, error);
      // 🔧 Issue 4 修复：错误后恢复为 Idle（A2A 消息的错误不应让 agent 永久挂起）
      this.updateStatus(AgentStatus.Idle);

      // 🆕 发送错误回复
      if (replyTo && from) {
        process.send?.({
          type: 'agent_reply',
          from: this.config.agentId,
          to: from,
          replyTo: replyTo,
          error: error.message,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
      * 处理初始化
      */
  private async handleInit(msg: InitRequest): Promise<void> {
    // 更新配置
    if (msg.modelConfig) {
      this.config.modelConfig = msg.modelConfig;

      // 🆕 根据 modelConfig 动态创建 Provider
      try {
        this.provider = await this.createProviderFromConfig(msg.modelConfig);
        logger.info(`[AgentWorker] 已创建智能体专用 Provider: ${msg.modelConfig.provider}`);

        // 🔧 修复：创建 Provider 后立即设置工具定义
        const toolDefinitions = this.config.toolRegistry.toOpenAITools();
        if (toolDefinitions.length > 0 && this.provider && 'setTools' in this.provider) {
          this.provider.setTools(toolDefinitions);
          logger.info(`[AgentWorker] ✅ 已设置 ${toolDefinitions.length} 个工具到智能体专用 Provider`);
        } else {
          logger.warn(`[AgentWorker] ⚠️ 无法设置工具: tools=${toolDefinitions.length}, provider=${this.provider ? 'exists' : 'null'}, hasSetTools=${this.provider && 'setTools' in this.provider}`);
        }
      } catch (error: any) {
        logger.error(`[AgentWorker] 创建 Provider 失败: ${error.message}`);
        // 使用全局 Provider 作为后备
        const providerManager = getProviderManager();
        this.provider = providerManager.getCurrentProvider();

        // 🔧 后备 Provider 也需要设置工具
        const toolDefinitions = this.config.toolRegistry.toOpenAITools();
        if (toolDefinitions.length > 0) {
          providerManager.setTools(toolDefinitions);
          logger.info(`[AgentWorker] ✅ 已设置 ${toolDefinitions.length} 个工具到全局 Provider（后备）`);
        }
      }
    }

    // 更新角色ID（仅 AHIVE-WORKER 类型）
    if (msg.roleId && this.config.agentType === 'ahive-worker') {
      this.config.roleId = msg.roleId;
      logger.info(`[AgentWorker] AHIVE-WORKER 角色设置为: ${msg.roleId}`);
    }

    this.updateStatus(AgentStatus.Idle);

    this.sendResponse({
      type: 'response',
      agentId: this.config.agentId,
      result: {
        status: 'initialized',
        agentId: this.config.agentId,
        agentType: this.config.agentType,
        pid: process.pid,
        roleId: this.config.roleId,
        modelConfig: this.config.modelConfig,
      },
    });

    // 注意：不再发送 stream_event ready，避免重复
    // main() 函数已经发送了 type: 'ready' 信号
  }

  /**
   * 根据 modelConfig 动态创建 Provider
   */
  private async createProviderFromConfig(modelConfig: any): Promise<any> {
    const providerType = modelConfig.provider || 'local';

    logger.info(`[AgentWorker] 创建 Provider: type=${providerType}, name=${modelConfig.name}, baseUrl=${modelConfig.baseUrl}`);

    switch (providerType) {
      case 'ollama':
        // 动态导入 OllamaProvider
        const { OllamaProvider } = await import('../providers/ollama-provider.js');
        const ollamaHost = modelConfig.baseUrl || modelConfig.ollamaHost || 'http://localhost:11434';
        const ollamaProvider = new OllamaProvider({
          type: 'ollama',
          ollamaHost: ollamaHost,
          ollamaModel: modelConfig.name || 'qwen2.5:7b',
        });
        await ollamaProvider.initialize();
        logger.info(`[AgentWorker] Ollama Provider 已初始化: host=${ollamaHost}, model=${modelConfig.name}`);
        return ollamaProvider;

      case 'local':
        // 创建 LocalProvider 实例（延迟初始化，避免重复加载 GGUF）
        // 注意：Worker 子进程是独立进程，不能共享主进程的 Provider 实例
        const { LocalProvider } = await import('../providers/local-provider.js');
        const localProvider = new LocalProvider({
          type: 'local',
          modelPath: modelConfig.modelPath,
          modelName: modelConfig.name,
          gpuLayers: modelConfig.gpuLayers,
          threads: modelConfig.threads,
          contextSize: modelConfig.contextSize,
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        });
        // 不立即初始化，让 Agent 在第一次使用时才初始化
        // 这样可以避免在 Worker 启动时重复加载 GGUF 模型
        logger.info(`[AgentWorker] LocalProvider 已创建（延迟初始化）: ${modelConfig.name || 'default'}`);
        return localProvider;

      // OpenAI 兼容 API（包括 bailian、deepseek、qwen、moonshot、zhipu、custom 等）
      case 'openai':
      case 'bailian':
      case 'deepseek':
      case 'qwen':
      case 'moonshot':
      case 'zhipu':
      case 'anthropic':
      case 'custom':
        // 动态导入 OpenAIProvider（兼容 OpenAI API 格式）
        const { OpenAIProvider } = await import('../providers/openai-provider.js');
        const openaiCompatibleProvider = new OpenAIProvider({
          type: 'openai',
          apiKey: modelConfig.apiKey,
          apiEndpoint: modelConfig.baseUrl,  // 使用 Agent 配置的 baseUrl
          apiModel: modelConfig.name,
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        });
        await openaiCompatibleProvider.initialize();
        logger.info(`[AgentWorker] OpenAI 兼容 Provider 已初始化: type=${providerType}, endpoint=${modelConfig.baseUrl}, model=${modelConfig.name}`);
        return openaiCompatibleProvider;

      default:
        // 未知类型，尝试作为 OpenAI 兼容 API 处理
        logger.warn(`[AgentWorker] 未知 Provider 类型: ${providerType}, 尝试作为 OpenAI 兼容 API 处理`);
        const { OpenAIProvider: DefaultOpenAIProvider } = await import('../providers/openai-provider.js');
        const defaultOpenAIProvider = new DefaultOpenAIProvider({
          type: 'openai',
          apiKey: modelConfig.apiKey,
          apiEndpoint: modelConfig.baseUrl,
          apiModel: modelConfig.name,
        });
        await defaultOpenAIProvider.initialize();
        logger.info(`[AgentWorker] 默认 OpenAI 兼容 Provider 已初始化: endpoint=${modelConfig.baseUrl}, model=${modelConfig.name}`);
        return defaultOpenAIProvider;
    }
  }

  /**
      * 执行智能体任务
      */
  private async handleExecute(msg: ExecuteRequest): Promise<void> {
    if (this.status === AgentStatus.Running) {
      this.sendError('智能体正在执行任务');
      return;
    }

    // 重置 abortController（可能被上次中断设置为 null）
    this.abortController = new AbortController();
    this.updateStatus(AgentStatus.Running);

    try {
      if (this.config.agentType === 'ahive-coder') {
        await this.executeAhiveCoder(msg);
      } else {
        await this.executeAhiveWorker(msg);
      }
      // 执行成功后重置状态为 Idle
      this.updateStatus(AgentStatus.Idle);
    } catch (error: any) {
      // 设置 lastResult，包含错误信息
      // 这样主进程的 isFinal 判断能正确识别错误状态
      this.lastResult = {
        content: `错误: ${error.message}`,
        iterations: 0,
        toolCallsExecuted: 0,
      };
      this.updateStatus(AgentStatus.Error);
      this.sendError(error.message);
      // 注意：Error 状态是最终状态，不需要再改为 Idle
    }
  }

  /**
   * AHIVE-CODER 执行
   */
  private async executeAhiveCoder(msg: ExecuteRequest): Promise<void> {
    const executor = this.executor as AhiveCoderExecutor;

    const sessionMessages = msg.sessionMessages?.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    // 使用传入的系统提示词或默认提示词
    const systemPrompt = msg.systemPrompt || this.getDefaultSystemPrompt();

    // 检测用户消息中触发的 SKILL，注入全文
    let userMessage = msg.prompt;
    if (this.skillManager) {
      const triggeredIds = this.skillManager.detectTriggeredSkills(msg.prompt);
      if (triggeredIds.length > 0) {
        const skillsPrompt = this.skillManager.generateTriggeredSkillsPrompt(triggeredIds);
        userMessage = `${skillsPrompt}\n\n${msg.prompt}`;
        logger.info(`[AgentWorker] 触发技能: ${triggeredIds.join(', ')}`);
      }
    }

    const result = await executor.execute(this.config.llmService, {
      systemPrompt,
      userMessage,
      sessionMessages,
      modelConfig: msg.modelConfig || this.config.modelConfig,
      onEvent: (event) => {
        // 实时发送事件到主进程
        this.sendEvent('execute_event', event);
      },
    });

    // 参考 AHIVE-CODER: 保存结果供 status RPC 返回
    this.lastResult = {
      content: result.content,
      iterations: result.iterations,
      toolCallsExecuted: result.toolCallsExecuted,
    };

    this.sendResponse({
      type: 'response',
      agentId: this.config.agentId,
      result: this.lastResult,
    });
  }

  /**
   * AHIVE-WORKER 执行
   */
  private async executeAhiveWorker(msg: ExecuteRequest): Promise<void> {
    const executor = this.executor as AhiveWorkerExecutor;

    const sessionMessages = msg.sessionMessages?.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 使用传入的系统提示词或默认提示词
    const systemPrompt = msg.systemPrompt || this.getDefaultSystemPrompt();

    const result = await executor.execute(this.config.llmService, {
      systemPrompt,
      userMessage: msg.prompt,
      sessionMessages,
      modelConfig: msg.modelConfig || this.config.modelConfig,
      maxIterations: (msg as any).maxIterations,
      onToolStart: (name, args) => {
        this.sendEvent('tool_start', { name, args });
      },
      onToolEnd: (name, result, success) => {
        this.sendEvent('tool_end', { name, result, success });
      },
    });

    // 参考 AHIVE-CODER: 保存结果供 status RPC 返回
    this.lastResult = {
      content: result.content,
      iterations: result.iterations,
      toolCallsExecuted: result.toolCallsExecuted,
    };

    this.sendResponse({
      type: 'response',
      agentId: this.config.agentId,
      result: this.lastResult,
    });
  }

  /**
   * 中断执行
   */
  private handleInterrupt(): void {
    logger.info(`[AgentWorker] 收到中断信号, 当前状态: ${this.status}`);

    if (this.executor instanceof AhiveCoderExecutor) {
      this.executor.interrupt();
    }

    // 中断后立即重置状态，允许新的执行
    this.status = AgentStatus.Idle;
    this.lastResult = null;  // 清除旧结果

    this.sendEvent('interrupted', {});
    logger.info(`[AgentWorker] 中断处理完成, 状态已重置为 Idle`);
  }

  /**
      * 处理用户插话
      */
  private handleUserInput(msg: { type: string; input: string }): void {
    const userInput = msg.input;
    logger.info(`[AgentWorker] 收到用户插话: ${userInput?.substring(0, 50)}...`);

    if (this.executor instanceof AhiveCoderExecutor) {
      this.executor.submitUserInput(userInput);
      this.sendEvent('user_input_received', { message: userInput });
    } else if (this.executor instanceof AhiveWorkerExecutor) {
      // AHIVE-WORKER 暂不支持插话，记录日志
      logger.warn('[AgentWorker] AHIVE-WORKER 暂不支持用户插话');
    }
  }

  /**
   * 处理智能体间消息（支持回复）
   */
  private async handleAgentMessage(msg: HandleMessageRequest): Promise<void> {
    logger.info(`[AgentWorker] 收到来自 ${msg.from} 的消息: ${msg.message}`);

    // 如果有 replyTo，说明需要回复
    if (msg.replyTo) {
      // 存储回复 Promise 的 resolve 函数
      // 这样后续执行完成后可以调用 resolve 来回复
      this.pendingReply = {
        from: msg.from,
        replyTo: msg.replyTo,
      };
    }

    // 触发智能体响应逻辑
    // 将消息作为用户输入执行
    try {
      if (this.config.agentType === 'ahive-coder') {
        const executor = this.executor as AhiveCoderExecutor;
        const result = await executor.execute(this.config.llmService, {
          systemPrompt: this.getDefaultSystemPrompt(),
          userMessage: `[来自 ${msg.from} 的消息]\n${msg.message}`,
          onEvent: (event: any) => {
            logger.debug(`[A2A AhiveCoder] event: ${event.type}`);
          },
          agentId: this.config.agentId,
          memorySystem: this.config.memorySystem,
        });

        // 发送回复
        if (msg.replyTo && this.pendingReply) {
          process.send?.({
            type: 'agent_reply',
            from: this.config.agentId,
            to: msg.from,
            replyTo: msg.replyTo,
            message: result.content,
            timestamp: Date.now(),
          });
          this.pendingReply = null;
        }
      } else {
        const executor = this.executor as AhiveWorkerExecutor;
        const result = await executor.execute(this.config.llmService, {
          systemPrompt: this.getDefaultSystemPrompt(),
          userMessage: `[来自 ${msg.from} 的消息]\n${msg.message}`,
          onEvent: (event: any) => {
            logger.debug(`[A2A AhiveWorker] event: ${event.type}`);
          },
          agentId: this.config.agentId,
          memorySystem: this.config.memorySystem,
        });

        // 发送回复
        if (msg.replyTo && this.pendingReply) {
          process.send?.({
            type: 'agent_reply',
            from: this.config.agentId,
            to: msg.from,
            replyTo: msg.replyTo,
            message: result.content,
            timestamp: Date.now(),
          });
          this.pendingReply = null;
        }
      }
    } catch (error: any) {
      logger.error(`[AgentWorker] A2A 消息执行失败:`, error);

      // 发送错误回复
      if (msg.replyTo) {
        process.send?.({
          type: 'agent_reply',
          from: this.config.agentId,
          to: msg.from,
          replyTo: msg.replyTo,
          error: error.message,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * 处理健康检查
   */
  private handleHealthCheck(): void {
    this.sendResponse({
      type: 'health_response',
      agentId: this.config.agentId,
      result: {
        status: this.status,
        uptime: Date.now() - this.startTime,
        memoryUsage: process.memoryUsage(),
      },
    });
  }

  /**
      * 处理 RPC 调用
      */
  private async handleRPCCall(msg: any): Promise<void> {
    const { id, method, args } = msg;

    try {
      let result: any;

      switch (method) {
        case 'execute':
          result = await this.handleExecuteAsRPC(args);
          break;

        case 'execute_stream':
          // 流式执行：不使用 await，让执行在后台运行
          // 这样可以在执行期间响应其他 RPC 调用（如 status）
          this.handleExecuteStreamRPC(id, args).catch((error) => {
            logger.error(`[AgentWorker] execute_stream 执行出错:`, error);
            // 错误时发送响应
            process.send?.({
              type: 'rpc_response',
              id,
              error: error.message,
            });
          });
          return; // 立即返回，不阻塞消息处理

        case 'health':
          result = {
            status: this.status,
            uptime: Date.now() - this.startTime,
            pid: process.pid,
          };
          break;

        case 'status':
          result = {
            agentId: this.config.agentId,
            agentType: this.config.agentType,
            status: this.status,
            pid: process.pid,
            // 返回执行结果
            lastResult: this.lastResult,
          };
          break;

        case 'get_rollout_history':
          // 获取 rollout 历史（用于 forkHistory 功能）
          result = await this.handleGetRolloutHistory(args);
          break;

        case 'init_with_history':
          // 使用 forked 历史初始化（用于 forkHistory 功能）
          result = await this.handleInitWithHistory(args);
          break;

        default:
          throw new Error(`未知的 RPC 方法: ${method}`);
      }

      process.send?.({
        type: 'rpc_response',
        id,
        result,
      });
    } catch (error: any) {
      process.send?.({
        type: 'rpc_response',
        id,
        error: error.message,
      });
    }
  }

  /**
   * 流式执行 RPC - 实时发送事件，最后发送响应
   */
  private async handleExecuteStreamRPC(callId: string, args: any): Promise<void> {
    // 检查当前状态
    if (this.status === AgentStatus.Running) {
      logger.warn(`[AgentWorker] 拒绝执行: 智能体正在执行任务, callId=${callId}`);
      process.send?.({
        type: 'rpc_response',
        id: callId,
        error: '智能体正在执行任务',
      });
      return;
    }

    // 重置 abortController（可能被上次中断设置为 null）
    this.abortController = new AbortController();
    this.updateStatus(AgentStatus.Running);
    logger.info(`[AgentWorker] 开始流式执行, callId=${callId}`);

    try {
      if (this.config.agentType === 'ahive-coder') {
        await this.executeAhiveCoderStreamRPC(callId, args);
      } else {
        await this.executeAhiveWorkerStreamRPC(callId, args);
      }
      // 执行成功后重置状态为 Idle
      this.updateStatus(AgentStatus.Idle);
    } catch (error: any) {
      // 设置 lastResult，包含错误信息
      this.lastResult = {
        content: `错误: ${error.message}`,
        iterations: 0,
        toolCallsExecuted: 0,
      };

      // 检查是否是中断导致的错误
      if (error.message?.includes('abort') || error.message?.includes('interrupt')) {
        logger.info(`[AgentWorker] 执行被中断: ${error.message}`);
        process.send?.({
          type: 'stream_event',
          agentId: this.config.agentId,
          callId,
          eventType: 'interrupted',
          data: { message: '执行已被用户中断' },
        });
      } else {
        // 发送错误事件
        process.send?.({
          type: 'stream_event',
          agentId: this.config.agentId,
          callId,
          eventType: 'error',
          data: { error: error.message },
        });
      }
      // 发送响应
      process.send?.({
        type: 'rpc_response',
        id: callId,
        error: error.message,
      });

      // 设置错误状态（不再改为 Idle）
      this.updateStatus(AgentStatus.Error);
      logger.info(`[AgentWorker] 流式执行出错, callId=${callId}`);
    }
  }

  /**
   * AHIVE-CODER 流式执行 (RPC)
   */
  private async executeAhiveCoderStreamRPC(callId: string, args: any): Promise<void> {
    const executor = this.executor as AhiveCoderExecutor;

    const sessionMessages = args.sessionMessages?.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    // 使用传入的系统提示词或默认提示词
    const systemPrompt = args.systemPrompt || this.getDefaultSystemPrompt();

    const result = await executor.execute(this.config.llmService, {
      systemPrompt,
      userMessage: args.userMessage || args.message || '',
      sessionMessages,
      modelConfig: args.modelConfig || this.config.modelConfig,
      onEvent: (event: any) => {
        // 实时发送流式事件到主进程
        process.send?.({
          type: 'stream_event',
          agentId: this.config.agentId,
          callId,
          eventType: event.type,
          data: event,
        });
      },
      // 🧠 传递智能体 ID 和记忆系统
      agentId: this.config.agentId,
      memorySystem: this.config.memorySystem,
    });

    // 参考 AHIVE-CODER: 保存结果供 status RPC 返回
    this.lastResult = {
      content: result.content,
      iterations: result.iterations,
      toolCallsExecuted: result.toolCallsExecuted,
    };

    // 发送最终响应
    logger.info(`[AgentWorker] executeAhiveCoderStreamRPC 完成，发送 rpc_response: callId=${callId}`);
    process.send?.({
      type: 'rpc_response',
      id: callId,
      result: this.lastResult,
    });
  }

  /**
   * AHIVE-WORKER 流式执行 (RPC)
   */
  private async executeAhiveWorkerStreamRPC(callId: string, args: any): Promise<void> {
    const executor = this.executor as AhiveCoderExecutor;

    const sessionMessages = args.sessionMessages?.map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 使用传入的系统提示词或默认提示词
    const systemPrompt = args.systemPrompt || this.getDefaultSystemPrompt();

    const result = await executor.execute(this.config.llmService, {
      systemPrompt,
      userMessage: args.userMessage || args.message || '',
      sessionMessages,
      modelConfig: args.modelConfig || this.config.modelConfig,
      onEvent: (event: any) => {
        // 实时发送流式事件到主进程
        process.send?.({
          type: 'stream_event',
          agentId: this.config.agentId,
          callId,
          eventType: event.type,
          data: event,
        });
      },
      // 🧠 传递智能体 ID 和记忆系统
      agentId: this.config.agentId,
      memorySystem: this.config.memorySystem,
    });

    // 参考 AHIVE-CODER: 保存结果供 status RPC 返回
    this.lastResult = {
      content: result.content,
      iterations: result.iterations,
      toolCallsExecuted: result.toolCallsExecuted,
    };

    // 发送最终响应
    logger.info(`[AgentWorker] executeAhiveWorkerStreamRPC 完成，发送 rpc_response: callId=${callId}, content=${result.content?.substring(0, 100)}...`);
    process.send?.({
      type: 'rpc_response',
      id: callId,
      result: this.lastResult,
    });
  }

  /**
   * RPC 方式执行任务
   */
  private async handleExecuteAsRPC(args: any): Promise<any> {
    if (this.status === AgentStatus.Running) {
      throw new Error('智能体正在执行任务');
    }

    // 参数验证：检查是否有有效的用户消息
    const userMessage = args?.userMessage || args?.prompt || args?.message;
    if (!userMessage) {
      logger.warn('[AgentWorker] execute RPC 调用缺少用户消息');
    }

    // 重置 abortController（可能被上次中断设置为 null）
    this.abortController = new AbortController();
    this.updateStatus(AgentStatus.Running);

    try {
      let result: { content: string; iterations: number; toolCallsExecuted: number };

      if (this.config.agentType === 'ahive-coder') {
        result = await this.executeAhiveCoderAsRPC(args);
      } else {
        result = await this.executeAhiveWorkerAsRPC(args);
      }

      // 存储结果，供 status RPC 返回
      this.lastResult = result;

      return result;
    } finally {
      this.updateStatus(AgentStatus.Idle);
    }
  }

  /**
   * AHIVE-CODER 执行 (RPC)
   */
  private async executeAhiveCoderAsRPC(args: any): Promise<any> {
    const executor = this.executor as AhiveCoderExecutor;

    const sessionMessages = args.sessionMessages?.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const result = await executor.execute(this.config.llmService, {
      systemPrompt: args.systemPrompt || '',
      userMessage: args.userMessage || args.prompt || args.message || '',  // 兼容 message 字段
      sessionMessages,
      modelConfig: args.modelConfig || this.config.modelConfig,
      // 非流式调用：不发送事件到主进程，只做本地日志
      onEvent: (event) => {
        logger.debug(`[AhiveCoder RPC] event: ${event.type}`);
      },
      // 🧠 传递智能体 ID 和记忆系统
      agentId: this.config.agentId,
      memorySystem: this.config.memorySystem,
    });

    return {
      content: result.content,
      iterations: result.iterations,
      toolCallsExecuted: result.toolCallsExecuted,
    };
  }

  /**
   * AHIVE-WORKER 执行 (RPC)
   */
  private async executeAhiveWorkerAsRPC(args: any): Promise<any> {
    const executor = this.executor as AhiveCoderExecutor;

    const sessionMessages = args.sessionMessages?.map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const result = await executor.execute(this.config.llmService, {
      systemPrompt: args.systemPrompt || '',
      userMessage: args.userMessage || args.prompt || args.message || '',  // 兼容 message 字段
      sessionMessages,
      modelConfig: args.modelConfig || this.config.modelConfig,
      // 非流式调用：不发送事件到主进程，只做本地日志
      onEvent: (event) => {
        logger.debug(`[AhiveWorker RPC] event: ${event.type}`);
      },
      // 🧠 传递智能体 ID 和记忆系统
      agentId: this.config.agentId,
      memorySystem: this.config.memorySystem,
    });

    return {
      content: result.content,
      iterations: result.iterations,
      toolCallsExecuted: result.toolCallsExecuted,
    };
  }

  /**
   * 获取 rollout 历史（用于 forkHistory 功能）
   * 参考 CODEX: RolloutRecorder::get_rollout_history
   */
  private async handleGetRolloutHistory(args: any): Promise<{ items: any[] }> {
    const memorySystem = this.config.memorySystem;
    if (!memorySystem) {
      logger.warn('[AgentWorker] 记忆系统未初始化，无法获取 rollout 历史');
      return { items: [] };
    }

    try {
      // 从记忆系统获取当前智能体的 rollout 历史
      const history = await memorySystem.getRolloutHistory(this.config.agentId);
      logger.info(`[AgentWorker] 获取 rollout 历史: ${history.length} 条`);
      return { items: history };
    } catch (error) {
      logger.error(`[AgentWorker] 获取 rollout 历史失败:`, error);
      return { items: [] };
    }
  }

  /**
   * 使用 forked 历史初始化（用于 forkHistory 功能）
   * 参考 CODEX: InitialHistory::Forked
   */
  private async handleInitWithHistory(args: any): Promise<{ success: boolean }> {
    const { history, source, parentAgentId } = args;

    if (!history || !Array.isArray(history) || history.length === 0) {
      logger.warn('[AgentWorker] handleInitWithHistory: 无效的历史数据');
      return { success: false };
    }

    const memorySystem = this.config.memorySystem;
    if (!memorySystem) {
      logger.warn('[AgentWorker] 记忆系统未初始化，无法初始化 forked 历史');
      return { success: false };
    }

    try {
      // 将 forked 历史注入到当前智能体的记忆系统
      await memorySystem.initWithForkedHistory(this.config.agentId, history, {
        source,
        parentAgentId,
      });

      logger.info(`[AgentWorker] 已初始化 forked 历史: ${history.length} 条 (来源: ${parentAgentId})`);
      return { success: true };
    } catch (error) {
      logger.error(`[AgentWorker] 初始化 forked 历史失败:`, error);
      return { success: false };
    }
  }

  /**
   * 处理通用消息
   */
  private async handleGenericMessage(msg: any): Promise<void> {
    logger.info(`[AgentWorker] 收到通用消息: ${JSON.stringify(msg).substring(0, 100)}`);
    this.sendResponse({
      type: 'response',
      agentId: this.config.agentId,
      result: { received: true },
    });
  }

  /**
   * 处理项目配置更新
   * 从 WorkflowContextManager 接收项目配置提示词
   */
  private handleProjectPromptUpdate(msg: { type: 'project_prompt_update'; workflowId: string; agentId: string; content: string; version: number; mtime: number }): void {
    const { workflowId, agentId, content, version, mtime } = msg;

    // 检查是否是发给当前智能体的（或公共配置）
    if (agentId !== 'public' && agentId !== this.config.agentId) {
      logger.debug(`[AgentWorker] 项目配置不是发给当前智能体的，跳过: target=${agentId}, current=${this.config.agentId}`);
      return;
    }

    // 更新项目配置
    this.setProjectPrompt(content, { workflowId, agentId, version, mtime });

    logger.info(`[AgentWorker] 项目配置已注入到系统提示词: workflowId=${workflowId}, agentId=${agentId}, version=${version}, contentLength=${content.length}`);
  }

  /**
      * 处理停止
      */
  private handleStop(): void {
    logger.info(`[AgentWorker] 收到停止信号`);

    // 停止心跳
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.updateStatus(AgentStatus.Stopped);

    this.sendResponse({
      type: 'stopped',
      agentId: this.config.agentId,
      result: { reason: 'shutdown' },
    });

    // 延迟退出，确保消息发送
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }

  /**
   * 发送响应
   */
  private sendResponse(response: WorkerResponse): void {
    process.send?.(response);
  }

  /**
   * 发送错误响应
   */
  private sendError(error: string): void {
    this.sendResponse({
      type: 'error',
      agentId: this.config.agentId,
      error,
    });
  }

  /**
   * 发送事件
   */
  private sendEvent(event: string, data: any): void {
    process.send?.({
      type: 'stream_event',
      agentId: this.config.agentId,
      eventType: event,
      data,
    });
  }
}

// ==================== 启动入口 ====================

async function main() {
  const mainStartTime = Date.now();

  // 从命令行参数获取配置
  const args = process.argv.slice(2);

  if (args.length < 2) {
    logger.error('[AgentWorker] 缺少必要参数: agentType agentId');
    process.exit(1);
  }

  const agentType = args[0] as 'ahive-coder' | 'ahive-worker';
  const agentId = args[1];

  logger.info(`[AgentWorker] 🚀 启动智能体子进程: ${agentType} (${agentId})`);

  // 步骤1: 动态导入服务模块
  const step1Start = Date.now();
  logger.info(`[AgentWorker] 📦 步骤1/5: 导入模块...`);
  const { ToolRegistry } = await import('../executor/tool-system.js');
  const { getProviderManager } = await import('../providers/index.js');
  const { createBuiltinTools } = await import('../executor/index.js');

  // 导入 SQLite + Compaction 记忆系统
  const { MemoryManager, createMemoryManager } = await import('../memory/core/index.js');
  logger.info(`[AgentWorker] 📦 步骤1/5 完成 (${Date.now() - step1Start}ms)`);

  // 步骤2: 创建工具注册中心
  const step2Start = Date.now();
  logger.info(`[AgentWorker] 🔧 步骤2/5: 注册工具...`);
  const toolRegistry = new ToolRegistry();
  const builtinTools = createBuiltinTools();
  toolRegistry.registerAll(builtinTools);
  logger.info(`[AgentWorker] 🔧 步骤2/5 完成: ${builtinTools.length} 个工具 (${Date.now() - step2Start}ms)`);

  // 工具定义不再在此处静态快照，改为 IPC 闭包内动态获取
  // 原因：MCP 工具在步骤5之后异步注册，静态快照会丢失 MCP 工具的参数定义

  // 步骤3: 跳过全局 Provider 初始化
  // Worker 子进程不需要全局 Provider，每个 Agent 会根据配置创建自己的 Provider
  // 这样避免重复加载 GGUF 模型（每个 Worker 进程都加载会占用大量内存）
  const step3Start = Date.now();
  logger.info(`[AgentWorker] 🤖 步骤3/5: 跳过全局 Provider 初始化（Agent 将使用独立配置）`);
  logger.info(`[AgentWorker] 🤖 步骤3/5 完成 (${Date.now() - step3Start}ms)`);

  // 步骤4: 初始化记忆系统
  const step4Start = Date.now();
  logger.info(`[AgentWorker] 🧠 步骤4/5: 初始化记忆系统...`);
  const memoryManager = createMemoryManager({
    memoryRoot: './data/memories',
    isolationStrategy: 'type',  // 按类型隔离
  });
  logger.info(`[AgentWorker] 🧠 步骤4/5 完成: SQLite + Compaction (${Date.now() - step4Start}ms)`);

  // 🎭 设置智能体控制器（用于分身功能）
  // 通过 IPC 与主进程的 AgentProcessManager 通信
  const { setAgentController } = await import('../executor/builtin-tools.js');

  const agentController = {
    spawnAgent: async (parentId: string, options: any): Promise<string> => {
      // 通过 IPC 请求主进程创建分身
      return new Promise((resolve, reject) => {
        // 使用随机数确保 callId 唯一，避免并行调用时冲突
        const callId = `spawn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const handler = (msg: any) => {
          if (msg.type === 'rpc_response' && msg.id === callId) {
            process.off('message', handler);
            if (msg.error) {
              reject(new Error(msg.error));
            } else {
              resolve(msg.result?.childId || msg.result || '');
            }
          }
        };

        process.on('message', handler);
        process.send?.({
          type: 'rpc_call',
          id: callId,
          method: 'spawn_child',
          args: { parentId, options },
        });

        // 超时
        setTimeout(() => {
          process.off('message', handler);
          reject(new Error('创建分身超时'));
        }, 30000);
      });
    },

    waitAgent: async (childId: string, timeout?: number): Promise<{ status: string; content?: string; error?: string }> => {
      return new Promise((resolve) => {
        // 使用随机数确保 callId 唯一
        const callId = `wait_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const handler = (msg: any) => {
          if (msg.type === 'rpc_response' && msg.id === callId) {
            process.off('message', handler);
            resolve(msg.result || { status: 'unknown' });
          }
        };

        process.on('message', handler);
        process.send?.({
          type: 'rpc_call',
          id: callId,
          method: 'wait_child',
          args: { childId, timeout },
        });

        // 超时时间与主进程一致，默认 120 秒
        const actualTimeout = timeout || 120000;
        setTimeout(() => {
          process.off('message', handler);
          resolve({ status: 'timeout', error: `等待分身超时 (${actualTimeout}ms)` });
        }, actualTimeout);
      });
    },

    terminateAgent: (childId: string): void => {
      process.send?.({
        type: 'rpc_call',
        id: `terminate_${Date.now()}`,
        method: 'terminate_child',
        args: { childId },
      });
    },

    getMainAgentId: (): string | null => agentId,

    getActiveAgent: (): string | null => agentId,

    getAllStatus: async (): Promise<Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>> => {
      // 通过 IPC 调用主进程获取所有智能体状态
      return new Promise((resolve, reject) => {
        const callId = `get_all_status_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timeout = setTimeout(() => {
          process.off('message', handler);
          // 超时时返回至少自己的状态
          const fallbackMap = new Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>();
          fallbackMap.set(agentId, { type: agentType, status: 'idle', role: 'main' });
          resolve(fallbackMap);
        }, 5000);

        const handler = (msg: any) => {
          if (msg.type === 'rpc_response' && msg.id === callId) {
            clearTimeout(timeout);
            process.off('message', handler);
            logger.info(`[AgentWorker] 收到 get_all_status 响应, result=${Array.isArray(msg.result) ? msg.result.length + '个智能体' : 'error'}`);

            if (msg.error) {
              // 出错时返回至少自己的状态
              const fallbackMap = new Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>();
              fallbackMap.set(agentId, { type: agentType, status: 'idle', role: 'main' });
              resolve(fallbackMap);
            } else {
              // 将返回的数组转为 Map
              const map = new Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>();
              if (Array.isArray(msg.result)) {
                for (const agent of msg.result) {
                  map.set(agent.id, {
                    type: agent.type,
                    status: agent.status,
                    role: agent.role,
                    nickname: agent.nickname,
                    model: agent.model,
                  });
                }
              }
              resolve(map);
            }
          }
        };

        process.on('message', handler);
        process.send?.({ type: 'rpc_call', id: callId, method: 'get_all_agent_status', args: {} });
      });
    },

    sendTo: (fromId: string, toId: string, content: string, type?: string): void => {
      process.send?.({
        type: 'agent_message',
        from: fromId,
        to: toId,
        message: { content, type },
      });
    },

    /**
     * 发送消息并等待回复
     * 通过 IPC 调用主进程的 sendAndWaitForReply
     */
    sendAndWait: async (
      fromId: string,
      toId: string,
      content: string,
      type?: string,
      timeout?: number
    ): Promise<{ success: boolean; content?: string; error?: string }> => {
      return new Promise((resolve) => {
        const callId = `send_wait_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timeoutId = setTimeout(() => {
          process.off('message', handler);
          resolve({ success: false, error: `等待回复超时 (${timeout || 60000}ms)` });
        }, timeout || 60000);

        const handler = (msg: any) => {
          if (msg.type === 'rpc_response' && msg.id === callId) {
            clearTimeout(timeoutId);
            process.off('message', handler);

            if (msg.error) {
              resolve({ success: false, error: msg.error });
            } else {
              resolve({
                success: true,
                content: msg.result?.content,
              });
            }
          }
        };

        process.on('message', handler);
        process.send?.({
          type: 'rpc_call',
          id: callId,
          method: 'send_and_wait',
          args: { fromId, toId, content, type, timeout },
        });
      });
    },

    getConcurrencyStatus: (): { active: number; max: number; available: number } => {
      // 🔧 修复：通过 RPC 获取真实的并发状态，而不是硬编码返回
      // 由于这是同步调用场景，使用缓存值或默认值
      // 实际限制检查在 spawn_agent 工具中会重新调用
      // 这里返回默认值，spawn_agent 工具会通过 RPC 获取最新状态
      return { active: 0, max: 6, available: 6 };
    },

    // 🆕 异步获取并发状态（真实值）
    getConcurrencyStatusAsync: async (): Promise<{ active: number; max: number; available: number }> => {
      const callId = `concurrency_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          process.off('message', handler);
          // 超时返回默认值
          resolve({ active: 0, max: 6, available: 6 });
        }, 5000);

        const handler = (msg: any) => {
          if (msg.type === 'rpc_response' && msg.id === callId) {
            clearTimeout(timeoutId);
            process.off('message', handler);
            resolve(msg.result || { active: 0, max: 6, available: 6 });
          }
        };

        process.on('message', handler);
        process.send?.({
          type: 'rpc_call',
          id: callId,
          method: 'get_concurrency_status',
          args: {},
        });
      });
    },

    createMainAgent: (type?: 'ahive-worker' | 'ahive-coder'): string => agentId,
  };

  setAgentController(agentController);
  logger.info(`[AgentWorker] 🎭 步骤5/5: 设置智能体控制器（支持分身功能）`);

  // 创建 LLM 服务适配器（通过 IPC 调用主进程的 LLM Service）
  // 🆕 共享主进程的 Provider，避免子进程重复加载 GGUF 模型
  // 🔧 修复：传递工具定义，确保 LLM 能调用正确的工具
  const llmService: AhiveCoderLLMService = {
    chat: async (messages, config) => {
      // 动态获取最新工具定义（含异步注册的 MCP 工具），不使用早期快照
      const currentToolDefinitions = toolRegistry.toOpenAITools();
      logger.info(`[AgentWorker] LLM chat 动态获取工具: ${currentToolDefinitions.length} 个 (MCP已注册=${currentToolDefinitions.some(t => t.function.name.startsWith('mcp_'))})`);
      // 通过 IPC 调用主进程的 LLM Service
      return new Promise((resolve, reject) => {
        const callId = `llm_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timeout = config?.timeout || 600000;

        const timeoutId = setTimeout(() => {
          process.off('message', handler);
          reject(new Error(`LLM chat 调用超时 (${timeout}ms)`));
        }, timeout);

        const handler = (msg: any) => {
          if (msg.type === 'rpc_response' && msg.id === callId) {
            clearTimeout(timeoutId);
            process.off('message', handler);

            if (msg.error) {
              reject(new Error(msg.error));
            } else {
              resolve({
                content: msg.result?.content || '',
                toolCalls: msg.result?.toolCalls,
                finishReason: msg.result?.finishReason,
              });
            }
          }
        };

        process.on('message', handler);
        process.send?.({
          type: 'rpc_call',
          id: callId,
          method: 'llm_chat',
          args: {
            messages,
            config,
            tools: currentToolDefinitions,
          },
        });

        logger.debug(`[AgentWorker] LLM chat IPC 调用已发送: callId=${callId}, tools=${currentToolDefinitions.length}`);
      });
    },
  };

  // 创建配置
  const config: AgentConfig = {
    agentId,
    agentType,
    toolRegistry,
    llmService,
    memorySystem: memoryManager,  // 传入记忆系统
    providerManager: getProviderManager(),  // 传入 ProviderManager（用于动态创建 Provider）
  };

  // 创建工作进程实例
  const worker = new AgentWorker(config);

  const totalTime = Date.now() - mainStartTime;
  logger.info(`[AgentWorker] ✅ 步骤5/5 完成: Worker 实例已创建 (${totalTime}ms)`);

  // 通知主进程已就绪
  process.send?.({
    type: 'ready',
    id: agentId,
    agentType,
    pid: process.pid,
  });

  logger.info(`[AgentWorker] 🎉 初始化完成，已发送 ready 信号 (总耗时: ${totalTime}ms)`);
}

// 🆕 进程退出清理
process.on('SIGTERM', () => {
  logger.info('[AgentWorker] 收到 SIGTERM 信号，准备退出...');
  // 清理资源
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('[AgentWorker] 收到 SIGINT 信号，准备退出...');
  process.exit(0);
});

// 🆕 未处理的 Promise rejection 捕获
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[AgentWorker] 未处理的 Promise rejection:', reason);
});

main().catch((error) => {
  logger.error('[AgentWorker] 启动失败:', error);
  process.exit(1);
});