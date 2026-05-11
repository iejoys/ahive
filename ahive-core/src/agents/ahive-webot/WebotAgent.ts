/**
 * ahive-webot 智能体
 * 
 * 特殊智能体，不连接 LLM，只做企业微信消息转发
 * 利用现有 send_message 工具与其他智能体通讯
 * 支持审核卡片功能：双消息模式（卡片摘要 + 文件内容）
 */

import AiBot from '@wecom/aibot-node-sdk';
import type { WsFrame, TemplateCard, EventMessage, TemplateCardEventData } from '@wecom/aibot-node-sdk';
import { EventEmitter } from 'events';
import { basename } from 'path';
import { logger } from '../../utils/index.js';
import { SessionTracker } from './SessionTracker.js';
import { AuditTracker } from './AuditTracker.js';
import type { WebotConfig, WecomSession, AgentMessage, AuditTask } from './types.js';

/**
 * 审核卡片数据结构
 */
interface AuditCardData {
  /** 文件类型 */
  fileType: string;
  /** 文件路径 */
  filePath: string;
  /** 修改描述 */
  description?: string;
  /** 文件内容 */
  content?: string;
  /** 发起审核的智能体 ID */
  fromAgentId: string;
}

// WEBOT 固定 ID
export const WEBOT_AGENT_ID = 'ahive-webot';

/**
 * 清理消息内容，移除技术性标记和 JSON 包装
 * 让用户看到干净的消息
 */
function cleanMessageForWecom(content: string): string {
  if (!content) return '';
  
  let cleaned = content;
  
  // 0. 尝试解析 JSON 格式的消息
  // 如果消息是 {"content": "...", "type": "..."} 格式，提取 content 字段
  try {
    if (cleaned.trim().startsWith('{') && cleaned.trim().endsWith('}')) {
      const parsed = JSON.parse(cleaned);
      if (parsed.content) {
        cleaned = parsed.content;
      }
    }
  } catch (e) {
    // 不是 JSON 格式，继续处理
  }
  
  // 1. 处理转义符：将字符串形式的 \n \t 转换为真正的换行和制表符
  cleaned = cleaned.replace(/\\n/g, '\n');
  cleaned = cleaned.replace(/\\t/g, '\t');
  cleaned = cleaned.replace(/\\r/g, '\r');
  
  // 2. 移除 WEBOT_METADATA 块
  cleaned = cleaned.replace(/\[WEBOT_METADATA\][\s\S]*?\[END_WEBOT_METADATA\]\n?/g, '');
  
  // 3. 移除回复指令块
  cleaned = cleaned.replace(/\[回复指令\][\s\S]*?\[END 回复指令\]\n?/g, '');
  
  // 4. 移除 REQID 标记
  cleaned = cleaned.replace(/\[REQID:\s*[^\]]+\]\n?/g, '');
  
  // 5. 移除 FROM_AGENT 标记
  cleaned = cleaned.replace(/\[FROM_AGENT:\s*[^\]]+\]\n?/g, '');
  
  // 6. 移除 AGENT COMMUNICATION PROTOCOL 块
  cleaned = cleaned.replace(/\[AGENT COMMUNICATION PROTOCOL\][\s\S]*?\[END PROTOCOL\]\n?/g, '');
  
  // 7. 移除 METADATA 标记
  cleaned = cleaned.replace(/\[METADATA:\s*\{[\s\S]*?\}\s*\]\n?/g, '');
  
  // 8. 移除多余的空行（超过2个连续空行变成2个）
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // 9. 移除开头的空行
  cleaned = cleaned.trimStart();
  
  // 10. 移除结尾的空行
  cleaned = cleaned.trimEnd();
  
  return cleaned;
}

export class WebotAgent extends EventEmitter {
  readonly id = WEBOT_AGENT_ID;
  readonly type = 'ahive-webot';
  readonly nickname = '企业微信智能体';
  
  private wsClient: InstanceType<typeof AiBot.WSClient>;
  private config: WebotConfig;
  private connected: boolean = false;
  private sessionTracker: SessionTracker;
  private auditTracker: AuditTracker;
  
  // 消息总线（用于接收其他智能体的消息）
  private messageBus: EventEmitter;
  
  // 智能体控制器（用于发送消息给其他智能体）
  private agentController: {
    sendTo: (fromId: string, toId: string, content: string, type?: string, metadata?: Record<string, unknown>) => void;
    sendAndWait: (fromId: string, toId: string, content: string, type?: string, timeout?: number, metadata?: Record<string, unknown>) => Promise<{ success: boolean; content?: string; error?: string; metadata?: Record<string, unknown> }>;
  } | null = null;

  constructor(config: WebotConfig, messageBus: EventEmitter) {
    super();
    this.config = config;
    this.sessionTracker = new SessionTracker();
    this.auditTracker = new AuditTracker();
    this.messageBus = messageBus;

    // 创建企业微信 WebSocket 客户端
    this.wsClient = new AiBot.WSClient({
      botId: config.botId,
      secret: config.secret,
      reconnectInterval: 1000,
      maxReconnectAttempts: -1, // 无限重连
      heartbeatInterval: 30000,
    });

    this.setupEventHandlers();
    this.setupMessageBusHandler();
  }

  /**
   * 设置智能体控制器（由外部注入）
   * 用于发送消息给其他智能体
   */
  setAgentController(controller: {
    sendTo: (fromId: string, toId: string, content: string, type?: string, metadata?: Record<string, unknown>) => void;
    sendAndWait: (fromId: string, toId: string, content: string, type?: string, timeout?: number, metadata?: Record<string, unknown>) => Promise<{ success: boolean; content?: string; error?: string; metadata?: Record<string, unknown> }>;
  }): void {
    this.agentController = controller;
    logger.info('[ahive-webot] ✅ 已设置 agentController（支持 metadata）');
  }

  /**
   * 设置企业微信 WebSocket 事件处理器
   */
  private setupEventHandlers(): void {
    // 认证成功
    this.wsClient.on('authenticated', () => {
      this.connected = true;
      logger.info('[ahive-webot] 🔐 认证成功，已连接企业微信');
      this.emit('connected');
    });

    // 连接断开
    this.wsClient.on('disconnected', (reason: string) => {
      this.connected = false;
      logger.warn('[ahive-webot] 连接断开:', reason);
      this.emit('disconnected', reason);
    });

    // 收到文本消息
    this.wsClient.on('message.text', async (frame: WsFrame) => {
      await this.handleIncomingMessage(frame);
    });

    // 进入会话事件
    this.wsClient.on('event.enter_chat', async (frame: WsFrame) => {
      await this.handleEnterChat(frame);
    });

    // 模板卡片事件（审核按钮点击）
    this.wsClient.on('event.template_card_event', async (frame: WsFrame<EventMessage>) => {
      await this.handleTemplateCardEvent(frame);
    });

    // 错误处理
    this.wsClient.on('error', (error: Error) => {
      logger.error('[ahive-webot] 错误:', error);
      this.emit('error', error);
    });
  }

  /**
   * 设置消息总线处理器（接收其他智能体的 send_message）
   */
  private setupMessageBusHandler(): void {
    // 监听其他智能体发来的消息
    this.messageBus.on(`message:${this.id}`, (message: AgentMessage) => {
      this.handleAgentReply(message);
    });

    logger.info('[ahive-webot] 已订阅消息总线: message:ahive-webot');
  }

  /**
   * 处理企业微信入向消息
   */
  private async handleIncomingMessage(frame: WsFrame): Promise<void> {
    const body = frame.body;
    if (!body) return;

    const content = body.text?.content?.trim() || '';
    const fromUser = body.from?.userid || 'unknown';
    const reqId = frame.headers?.req_id || '';

    logger.info(`[ahive-webot] 收到企业微信消息: from=${fromUser}, content=${content.substring(0, 50)}...`);

    // 解析目标智能体（优先级：FROM_AGENT 标记 > @agentId 提及 > 默认指挥官）
    const fromAgentMatch = content.match(/\[FROM_AGENT:\s*([^\]]+)\]/);
    const targetAgentId = fromAgentMatch ? fromAgentMatch[1].trim() : 
                          this.parseAgentMention(content).agentId || 'ahivecore';
    
    // 提取实际消息内容（去掉 FROM_AGENT 标记）
    const actualContent = fromAgentMatch ? 
                          content.replace(/\[FROM_AGENT:\s*[^\]]+\]\s*/, '').trim() : 
                          this.parseAgentMention(content).message;

    // 创建会话追踪记录（使用 targetAgentId 作为 key，同一 Agent 复用会话）
    const session: WecomSession = {
      reqId,
      fromUser,
      chatType: body.chattype || 'single',
      chatId: body.chatid || fromUser,
      targetAgentId,
      timestamp: Date.now(),
    };
    this.sessionTracker.track(targetAgentId, session);

    // 构建消息内容（带上 metadata 信息，方便目标 Agent 回复）
    // 🆕 使用特殊标记格式，让智能体能够识别并传递 metadata
    // 🆕 添加明确的回复指令，确保智能体知道需要通过 ahive-webot 回复
    const metadataMarker = `[WEBOT_METADATA]
chatId: ${session.chatId}
fromUser: ${fromUser}
chatType: ${session.chatType}
reqId: ${reqId}
[END_WEBOT_METADATA]

[回复指令]
⚠️ 这是企业微信用户的消息，请务必通过 ahive-webot 回复！
回复方法：使用 send_message 工具发送给 ahive-webot
示例：send_message({ to_agent: "ahive-webot", message: "你的回复内容", type: "response" })
回复时请在消息开头保留: [REQID: ${reqId}]
[END 回复指令]

用户消息：
${actualContent}`;

    // 通过消息总线转发给目标智能体
    const agentMessage: AgentMessage = {
      id: `wecom-${Date.now()}`,
      fromAgentId: this.id,
      toAgentId: targetAgentId,
      type: 'task',
      content: metadataMarker,
      timestamp: new Date(),
      metadata: {
        source: 'wecom',
        reqId,
        fromUser,
        chatType: session.chatType,
        chatId: session.chatId,
      },
    };

    // 使用 agentController 发送消息（如果可用）
    if (this.agentController) {
      // 传递 metadata，让目标智能体知道回复给哪个微信用户
      this.agentController.sendTo(this.id, targetAgentId, metadataMarker, 'task', agentMessage.metadata);
      logger.info(`[ahive-webot] 已通过 agentController 转发消息给智能体: ${targetAgentId}, metadata: ${JSON.stringify(agentMessage.metadata)}`);
    } else {
      // 兜底：使用 messageBus
      this.messageBus.emit(`message:${targetAgentId}`, agentMessage);
      logger.info(`[ahive-webot] 已通过 messageBus 转发消息给智能体: ${targetAgentId}`);
    }
  }

  /**
   * 解析 @agentId 提及
   */
  private parseAgentMention(content: string): { agentId: string | null; message: string } {
    // 格式: @agentId 消息内容
    const match = content.match(/^@(\S+)\s*/);
    
    if (!match) {
      // 没有 @agentId，返回 null，由指挥官处理
      return { agentId: null, message: content };
    }

    const agentId = match[1];
    const message = content.substring(match[0].length);

    return { agentId, message };
  }

  /**
   * 处理其他智能体的回复（通过 send_message 发来的）
   */
  private async handleAgentReply(message: AgentMessage): Promise<void> {
    logger.info(`[ahive-webot] 收到智能体回复: from=${message.fromAgentId}, content=${message.content?.substring(0, 50)}...`);

    // 优先从消息元数据中获取 chatId
    let chatId = message.metadata?.chatId;

    // 如果 metadata 中没有 chatId，从 SessionTracker 获取
    if (!chatId && message.fromAgentId) {
      const session = this.sessionTracker.get(message.fromAgentId);
      if (session) {
        chatId = session.chatId;
        logger.info(`[ahive-webot] 从 SessionTracker 获取 chatId: ${chatId}`);
      }
    }

    if (chatId) {
      // 有 chatId，直接发送给对应用户
      // 🆕 清理消息内容，移除技术性标记
      const originalContent = message.content || '';
      const cleanContent = cleanMessageForWecom(originalContent);
      
      // 调试日志：查看清理前后的内容
      logger.info(`[ahive-webot] 清理前内容长度: ${originalContent.length}, 清理后长度: ${cleanContent.length}`);
      logger.info(`[ahive-webot] 清理后内容预览: ${cleanContent.substring(0, 100)}...`);
      
      try {
        await this.wsClient.sendMessage(chatId, {
          msgtype: 'markdown',
          markdown: { content: cleanContent },
        });

        logger.info(`[ahive-webot] 已发送回复到企业微信: chatId=${chatId}, from=${message.fromAgentId}`);

      } catch (error) {
        logger.error('[ahive-webot] 发送回复失败:', error);
      }
    } else {
      // 没有 chatId，检查是否包含审核标记
      const auditMatch = message.content?.match(/\[AUDIT:\s*([^\]]+)\]/);

      if (auditMatch) {
        // 包含审核标记，解析审核数据并发送审核卡片
        logger.info('[ahive-webot] 解析到审核标记，发送审核卡片');
        await this.handleAuditRequest(message, auditMatch[1]);
      } else {
        // 没有 chatId 和审核标记，主动推送到默认用户
        logger.info('[ahive-webot] 没有 chatId，使用主动推送模式');
        try {
          await this.sendToWecom(undefined, message.content);
        } catch (error: any) {
          logger.error('[ahive-webot] 主动推送失败:', error.message);
        }
      }
    }
  }

  /**
   * 处理审核请求
   * 
   * 解析消息中的审核数据，发送审核卡片到企业微信
   * 
   * @param message 智能体消息
   * @param auditData 审核标记中的数据（JSON 格式）
   */
  private async handleAuditRequest(message: AgentMessage, auditData: string): Promise<void> {
    try {
      // 解析审核数据（格式: fileType|filePath|description）
      // 示例: [AUDIT: code|src/app.ts|修复登录bug]
      const parts = auditData.split('|');
      
      if (parts.length < 2) {
        logger.warn(`[ahive-webot] 审核数据格式错误: ${auditData}`);
        await this.sendToWecom(undefined, `审核数据格式错误，请使用格式: [AUDIT: fileType|filePath|description]`);
        return;
      }

      const fileType = parts[0].trim();
      const filePath = parts[1].trim();
      const description = parts.length > 2 ? parts[2].trim() : undefined;

      // 提取文件内容（审核标记之后的内容）
      const contentMatch = message.content?.match(/\[AUDIT:[^\]]+\]\s*\n?\s*([\s\S]*)$/);
      const fileContent = contentMatch ? contentMatch[1].trim() : undefined;

      // 构建审核卡片数据
      const cardData: AuditCardData = {
        fileType,
        filePath,
        description,
        content: fileContent,
        fromAgentId: message.fromAgentId,
      };

      // 发送审核卡片到默认用户
      const chatId = message.metadata?.chatId || this.config.defaultChatIds?.split(',')[0].trim();
      
      if (!chatId) {
        logger.warn('[ahive-webot] 无法确定审核卡片发送目标');
        return;
      }

      const taskId = await this.sendAuditCard(chatId, cardData);
      
      // 发送确认消息给发起者
      this.messageBus.emit(`message:${message.fromAgentId}`, {
        id: `audit-confirm-${Date.now()}`,
        fromAgentId: this.id,
        toAgentId: message.fromAgentId,
        type: 'response',
        content: `[AUDIT_SENT:${taskId}] 审核卡片已发送到企业微信，等待用户审核...`,
        timestamp: new Date(),
        metadata: {
          source: 'wecom_audit',
          auditTaskId: taskId,
          fileInfo: cardData,
        },
      });

    } catch (error: any) {
      logger.error(`[ahive-webot] 处理审核请求失败: ${error.message}`);
      
      // 发送错误消息给发起者
      this.messageBus.emit(`message:${message.fromAgentId}`, {
        id: `audit-error-${Date.now()}`,
        fromAgentId: this.id,
        toAgentId: message.fromAgentId,
        type: 'response',
        content: `[AUDIT_ERROR] 处理审核请求失败: ${error.message}`,
        timestamp: new Date(),
      });
    }
  }

  /**
   * 处理进入会话事件
   */
  private async handleEnterChat(frame: WsFrame): Promise<void> {
    const body = frame.body;
    const fromUser = body?.from?.userid || 'unknown';
    const reqId = frame.headers?.req_id || '';

    logger.info(`[ahive-webot] 用户进入会话: ${fromUser}`);

    // 发送欢迎语
    await this.wsClient.replyWelcome(frame, {
      msgtype: 'text',
      text: {
        content: `👋 您好！我是 AHIVE 智能助手。

💡 **使用方法**：
• 直接发送消息 → 由指挥官 ahivecore 处理
• \`@智能体ID 消息内容\` → 由指定智能体处理

**示例**：
• 你好（指挥官处理）
• @coder-abc123 帮我写个函数（指定智能体处理）`,
      },
    });
  }

  /**
   * 主动发送消息到企业微信
   * 
   * 用于智能体主动推送消息（不依赖会话追踪）
   * 支持向多个用户发送（逗号分隔）
   * 
   * @param chatId 目标用户/群 ID，不传则使用配置中的 defaultChatId（可多个）
   * @param content 消息内容
   * @param fromAgentId 发送者智能体 ID（用于回复路由）
   */
  async sendToWecom(chatId?: string, content?: string, fromAgentId?: string): Promise<void> {
    logger.info(`[ahive-webot] sendToWecom 被调用: chatId=${chatId}, fromAgentId=${fromAgentId}, content=${content?.substring(0, 50)}...`);
    logger.info(`[ahive-webot] 当前连接状态: connected=${this.connected}`);
    logger.info(`[ahive-webot] 配置中的 defaultChatIds: ${this.config.defaultChatIds}`);

    if (!this.connected) {
      logger.warn('[ahive-webot] 未连接企业微信，无法发送消息');
      return;
    }

    // 使用传入的 chatId 或配置中的默认值
    const targetChatIds = (chatId || this.config.defaultChatIds || '')
      .split(',')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    logger.info(`[ahive-webot] 解析后的目标 chatIds: ${JSON.stringify(targetChatIds)}`);

    if (targetChatIds.length === 0) {
      logger.warn('[ahive-webot] 未指定 chatId，且配置中没有 defaultChatIds');
      throw new Error('未指定 chatId，且配置中没有 defaultChatIds');
    }

    // 格式化消息：添加发送者和时间信息
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    
    // 构建消息内容（使用简单符号，企业微信不支持某些 emoji）
    // 🆕 先清理消息内容，移除技术性标记
    let messageContent = cleanMessageForWecom(content || '');
    
    // 如果有发送者 ID，添加署名（不再添加 FROM_AGENT 标记，用户直接回复即可）
    if (fromAgentId) {
      messageContent = `${messageContent}

---
发送者: ${fromAgentId} | ${timeStr}`;
    }
    
    // 向所有目标用户发送消息
    for (const targetChatId of targetChatIds) {
      try {
        logger.info(`[ahive-webot] 正在发送消息到: ${targetChatId}`);
        const result = await this.wsClient.sendMessage(targetChatId, {
          msgtype: 'markdown',
          markdown: { content: messageContent },
        });
        logger.info(`[ahive-webot] 发送结果: ${JSON.stringify(result)}`);
        logger.info(`[ahive-webot] 主动发送消息到企业微信成功: chatId=${targetChatId}`);
      } catch (error: any) {
        logger.error(`[ahive-webot] 发送消息失败: chatId=${targetChatId}, error=${error.message}`);
        throw error;
      }
    }

    logger.info(`[ahive-webot] 已向 ${targetChatIds.length} 个用户发送消息`);
  }

  /**
   * 启动连接
   */
  async start(): Promise<void> {
    logger.info('[ahive-webot] 正在连接企业微信...');
    this.wsClient.connect();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, 10000);

      this.once('connected', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.once('error', (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * 停止连接
   */
  async stop(): Promise<void> {
    this.wsClient.disconnect();
    this.connected = false;
    this.sessionTracker.destroy();
    this.auditTracker.destroy();
    logger.info('[ahive-webot] 已断开企业微信连接');
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 获取会话追踪器
   */
  getSessionTracker(): SessionTracker {
    return this.sessionTracker;
  }

  /**
   * 获取配置
   */
  getConfig(): WebotConfig {
    return this.config;
  }

  /**
   * 获取审核追踪器
   */
  getAuditTracker(): AuditTracker {
    return this.auditTracker;
  }

  // ==================== 审核卡片功能 ====================

  /**
   * 发送审核卡片（双消息模式）
   * 
   * 发送两条消息：
   * 1. 审核卡片（button_interaction）- 包含摘要和审核按钮
   * 2. 文件内容（markdown）- 包含完整文件内容
   * 
   * @param chatId 目标用户 ID
   * @param data 审核卡片数据
   */
  async sendAuditCard(chatId: string, data: AuditCardData): Promise<string> {
    if (!this.connected) {
      logger.warn('[ahive-webot] 未连接企业微信，无法发送审核卡片');
      throw new Error('未连接企业微信');
    }

    // 生成唯一的任务 ID
    const taskId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    logger.info(`[ahive-webot] 发送审核卡片: taskId=${taskId}, file=${data.filePath}, to=${chatId}`);

    // 1. 构建审核卡片
    const card = this.buildAuditCard(taskId, data);

    // 2. 追踪审核任务
    const auditTask: AuditTask = {
      taskId,
      fromAgentId: data.fromAgentId,
      chatId,
      fileInfo: {
        type: data.fileType,
        path: data.filePath,
        content: data.content,
        description: data.description,
      },
      timestamp: Date.now(),
    };
    this.auditTracker.track(taskId, auditTask);

    // 3. 发送审核卡片
    try {
      await this.wsClient.sendMessage(chatId, {
        msgtype: 'template_card',
        template_card: card,
      });
      logger.info(`[ahive-webot] 审核卡片已发送: taskId=${taskId}`);
    } catch (error: any) {
      logger.error(`[ahive-webot] 发送审核卡片失败: ${error.message}`);
      this.auditTracker.remove(taskId);
      throw error;
    }

    // 4. 发送文件内容（第二条消息）
    if (data.content) {
      const fileMessage = this.buildFileContentMessage(data);
      try {
        await this.wsClient.sendMessage(chatId, {
          msgtype: 'markdown',
          markdown: { content: fileMessage },
        });
        logger.info(`[ahive-webot] 文件内容已发送: file=${data.filePath}`);
      } catch (error: any) {
        logger.error(`[ahive-webot] 发送文件内容失败: ${error.message}`);
        // 卡片已发送，不抛出错误，只记录日志
      }
    }

    return taskId;
  }

  /**
   * 构建审核卡片
   */
  private buildAuditCard(taskId: string, data: AuditCardData): TemplateCard {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      card_type: 'button_interaction',
      task_id: taskId,
      source: {
        desc: 'AHIVE 审核系统',
      },
      main_title: {
        title: '文件审核请求',
        desc: `来自 ${data.fromAgentId} 的文件修改请求`,
      },
      emphasis_content: {
        title: data.fileType,
        desc: basename(data.filePath),
      },
      horizontal_content_list: [
        { keyname: '文件路径', value: data.filePath },
        { keyname: '发起时间', value: timeStr },
      ],
      button_list: [
        { text: '通过', key: 'approve', style: 1 },  // 绿色
        { text: '拒绝', key: 'reject', style: 4 },   // 红色
      ],
    };
  }

  /**
   * 构建文件内容消息
   */
  private buildFileContentMessage(data: AuditCardData): string {
    const header = `**文件内容** (${data.filePath})`;
    const description = data.description ? `\n\n> ${data.description}` : '';
    const contentPreview = data.content 
      ? `\n\n\`\`\`\n${data.content.substring(0, 2000)}${data.content.length > 2000 ? '\n... (内容过长，已截断)' : ''}\n\`\`\``
      : '';
    
    return `${header}${description}${contentPreview}`;
  }

  /**
   * 处理模板卡片事件（审核按钮点击）
   */
  private async handleTemplateCardEvent(frame: WsFrame<EventMessage>): Promise<void> {
    const body = frame.body;
    const event = body?.event;
    
    if (!event || event.eventtype !== 'template_card_event') {
      return;
    }

    const eventData = event as TemplateCardEventData;
    const taskId = eventData.task_id;
    const eventKey = eventData.event_key;
    const fromUser = body?.from?.userid || 'unknown';

    logger.info(`[ahive-webot] 收到模板卡片事件: taskId=${taskId}, eventKey=${eventKey}, from=${fromUser}`);

    if (!taskId || !eventKey) {
      logger.warn('[ahive-webot] 模板卡片事件缺少 task_id 或 event_key');
      return;
    }

    // 查找审核任务
    const task = this.auditTracker.get(taskId);
    if (!task) {
      logger.warn(`[ahive-webot] 审核任务不存在或已过期: taskId=${taskId}`);
      // 发送提示消息
      await this.wsClient.sendMessage(body?.chatid || fromUser, {
        msgtype: 'markdown',
        markdown: { content: '该审核任务已过期或不存在，请重新发起审核。' },
      });
      return;
    }

    // 验证事件类型
    if (eventKey !== 'approve' && eventKey !== 'reject') {
      logger.warn(`[ahive-webot] 未知的审核动作: ${eventKey}`);
      return;
    }

    const action = eventKey as 'approve' | 'reject';
    const actionText = action === 'approve' ? '已通过' : '已拒绝';

    logger.info(`[ahive-webot] 审核结果: taskId=${taskId}, action=${action}, auditor=${fromUser}`);

    // 发送审核结果给原智能体
    const resultMessage: AgentMessage = {
      id: `audit-result-${Date.now()}`,
      fromAgentId: this.id,
      toAgentId: task.fromAgentId,
      type: 'response',
      content: `[AUDIT_RESULT:${taskId}] ${actionText}\n\n审核者: ${fromUser}\n文件: ${task.fileInfo.path}`,
      timestamp: new Date(),
      metadata: {
        source: 'wecom_audit',
        auditTaskId: taskId,
        auditAction: action,
        fromUser,
        chatId: task.chatId,
        fileInfo: task.fileInfo,
      },
    };

    this.messageBus.emit(`message:${task.fromAgentId}`, resultMessage);
    logger.info(`[ahive-webot] 已发送审核结果给智能体: ${task.fromAgentId}`);

    // 清理审核任务
    this.auditTracker.remove(taskId);

    // 发送确认消息给审核者
    try {
      await this.wsClient.sendMessage(body?.chatid || fromUser, {
        msgtype: 'markdown',
        markdown: { content: `审核结果已提交：**${actionText}**\n\n文件: ${task.fileInfo.path}\n结果已通知发起者 ${task.fromAgentId}` },
      });
    } catch (error: any) {
      logger.error(`[ahive-webot] 发送确认消息失败: ${error.message}`);
    }
  }
}