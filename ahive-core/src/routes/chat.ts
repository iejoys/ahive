/**
 * 聊天路由
 * 处理 /chat 和 /chat/stream 相关请求
 * 
 * 支持多种消息类型：
 * - 普通聊天：{ message: "你好" }
 * - 系统消息：{ message: '{"type":"capability_update",...}' } 或 { type: "capability_update", ... }
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { AgentExecutor, ExecuteParams, ExecuteResult, StreamCallback, StreamEvent } from '../executor/interface.js';
import type { App } from '../core/app.js';
import { parseBody, sendJson, sendError, getQueryParam } from './utils.js';
import { getCapabilityManager } from '../capabilities/index.js';
import type { CapabilityUpdateMessage } from '../capabilities/types.js';
import { logger, notifyCapabilityUpdate } from '../utils/index.js';

/**
 * 尝试解析消息中的系统消息类型
 */
function parseSystemMessageType(body: any): { type: string; payload: any } | null {
  // 情况1：顶层有 type 字段
  if (body.type && body.type !== '${type}') {
    return { type: body.type, payload: body };
  }

  // 情况2：message 字段是 JSON 字符串，里面包含 type
  if (body.message && typeof body.message === 'string') {
    try {
      const parsed = JSON.parse(body.message);
      if (parsed.type) {
        return { type: parsed.type, payload: parsed };
      }
    } catch {
      // 不是 JSON，忽略
    }
  }

  return null;
}

/**
 * 处理 capability_update 消息
 * @param payload 消息负载
 * @param res HTTP 响应
 * @param app App 实例（用于通知 Agent）
 */
async function handleCapabilityUpdate(payload: any, res: ServerResponse, app?: App): Promise<void> {
  try {
    const capabilityManager = getCapabilityManager();
    await capabilityManager.initialize();
    // handleCapabilityUpdate 需要 3 个参数: agentId, action, payload
    // 注意：payload 可能是嵌套结构 { type, agentId, action, payload: {...} }
    // 真正的 capabilities 在 payload.payload 里
    const agentId = payload.agentId || 'unknown';
    const action = payload.action || 'update';
    const actualPayload = payload.payload || payload;
    capabilityManager.handleCapabilityUpdate(agentId, action, actualPayload);

    const stats = capabilityManager.getStats();
    logger.info(`[ChatRoute] MCP 能力已更新: ${stats.mcpServers} 服务器, ${stats.mcpTools} 工具`);

    // 使用统一通知工具通知相关 Agent
    let notifiedAgents: string[] = [];
    if (app) {
      notifiedAgents = notifyCapabilityUpdate(app, agentId, action, actualPayload);
    }

    sendJson(res, 200, {
      success: true,
      type: 'capability_update',
      message: 'MCP 能力已保存',
      stats,
      notifiedAgents,
    });
  } catch (error) {
    logger.error('[ChatRoute] capability_update 处理失败:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 处理 skill_register 消息
 * @param payload 消息负载
 * @param res HTTP 响应
 * @param app App 实例（用于通知 Agent）
 */
async function handleSkillRegister(payload: any, res: ServerResponse, app?: App): Promise<void> {
  try {
    const capabilityManager = getCapabilityManager();
    await capabilityManager.initialize();

    const skill = capabilityManager.registerSkill(payload.skill || payload);

    logger.info(`[ChatRoute] 技能已注册: ${skill.name}`);

    // 使用统一通知工具通知相关 Agent
    let notifiedAgents: string[] = [];
    if (app) {
      notifiedAgents = notifyCapabilityUpdate(app, 'system', 'register', skill);
    }

    sendJson(res, 200, {
      success: true,
      type: 'skill_register',
      message: `技能已注册: ${skill.name}`,
      skill,
      notifiedAgents,
    });
  } catch (error) {
    logger.error('[ChatRoute] skill_register 处理失败:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 聊天路由处理器
 */
export class ChatRouteHandler {
  constructor(private executor: AgentExecutor, private app?: App) { }

  /**
   * 处理 POST /chat
   */
  async handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);

      // 检测是否是系统消息
      const systemMessage = parseSystemMessageType(body);

      if (systemMessage) {
        if (systemMessage.type === 'capability_update') {
          return await handleCapabilityUpdate(systemMessage.payload, res, this.app);
        }
        if (systemMessage.type === 'skill_register') {
          return await handleSkillRegister(systemMessage.payload, res, this.app);
        }
      }

      // 普通聊天
      if (!body.message) {
        sendError(res, 400, 'message is required');
        return;
      }

      // 必须明确指定 agentId
      const agentId = body.agentId;
      if (!agentId || agentId === 'default') {
        sendError(res, 400, 'agentId is required (cannot be empty or "default")');
        return;
      }

      // 记录用户消息
      logger.info(`[ChatRoute] 用户消息: agentId=${agentId}, message=${body.message.substring(0, 100)}${body.message.length > 100 ? '...' : ''}`);

      const params: ExecuteParams = {
        agentId,
        message: body.message,
        userId: body.userId,
        appKey: body.appKey,
        sessionId: body.sessionId,
      };

      const result = await this.executor.execute(params);

      sendJson(res, 200, {
        success: true,
        content: result.content,
        toolCallsExecuted: result.toolCallsExecuted,
        iterations: result.iterations,
        sessionId: result.sessionId,
      });
    } catch (error) {
      console.error('[ChatRoute] Chat error:', error);
      sendError(res, 500, 'Chat failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
      * 处理 GET/POST /chat/stream
      * 流式聊天 (GET 用于 EventSource，POST 用于 fetch)
      */
  async handleStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method || 'GET';
      let message: string | null = null;
      let agentId: string = 'default';
      let userId: string | undefined;
      let appKey: string | undefined;
      let sessionId: string | undefined;

      // 根据请求方法解析参数
      if (method === 'GET') {
        // GET 请求从查询参数获取
        message = getQueryParam(req.url || '', 'message');
        agentId = getQueryParam(req.url || '', 'agentId') || 'default';
        userId = getQueryParam(req.url || '', 'userId') || undefined;
        appKey = getQueryParam(req.url || '', 'appKey') || undefined;
        sessionId = getQueryParam(req.url || '', 'sessionId') || undefined;
      } else {
        // POST 请求从 body 获取
        const body = await parseBody(req);
        message = body.message;
        agentId = body.agentId || 'default';
        userId = body.userId;
        appKey = body.appKey;
        sessionId = body.sessionId;
      }

      if (!message) {
        sendError(res, 400, 'message is required');
        return;
      }

      // 必须明确指定 agentId
      if (!agentId || agentId === 'default') {
        sendError(res, 400, 'agentId is required (cannot be empty or "default")');
        return;
      }

      // 记录用户消息
      logger.info(`[ChatRoute] 流式消息: agentId=${agentId}, message=${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

      const params: ExecuteParams = {
        agentId,
        message,
        userId,
        appKey,
        sessionId,
      };

      // 设置 SSE 响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      // 发送 SSE 事件的辅助函数
      const sendEvent = (event: StreamEvent) => {
        // 过滤心跳日志，避免刷屏
        if (event.type !== 'heartbeat') {
          logger.info(`[ChatRoute] SSE sendEvent: type=${event.type}`);
        }
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // 心跳保持连接
      const heartbeatInterval = setInterval(() => {
        sendEvent({ type: 'heartbeat', timestamp: Date.now() });
      }, 15000);

      // 监听智能体间对话事件，广播到前端
      const onAgentChat = (data: { fromAgentId: string; fromAgentName?: string; toAgentId: string; toAgentName?: string; message: string; messageType?: string }) => {
        logger.info(`[ChatRoute] 收到 agent_chat 事件: ${data.fromAgentName || data.fromAgentId} → ${data.toAgentName || data.toAgentId}`);
        logger.info(`[ChatRoute] agent_chat 数据:`, JSON.stringify(data).substring(0, 200));
        sendEvent({
          type: 'agent_chat',
          fromAgentId: data.fromAgentId,
          fromAgentName: data.fromAgentName,
          toAgentId: data.toAgentId,
          toAgentName: data.toAgentName,
          message: data.message,
          timestamp: Date.now(),
        });
        logger.info(`[ChatRoute] SSE sendEvent: type=agent_chat 已发送`);
      };

      // 注册监听器
      // 优先监听全局事件总线（更可靠）
      if (this.app?.eventBus) {
        this.app.eventBus.on('agent_chat', onAgentChat);
        logger.info('[ChatRoute] 已注册 eventBus agent_chat 监听器');
      }
      // 兼容：也监听 processManager
      if (this.app?.processManager) {
        this.app.processManager.on('agent_chat', onAgentChat);
        logger.info('[ChatRoute] 已注册 processManager agent_chat 监听器');
      }
      // 兼容：也监听 unifiedAgentSystem
      if (this.app?.unifiedAgentSystem) {
        this.app.unifiedAgentSystem.on('agent_chat', onAgentChat);
        logger.info('[ChatRoute] 已注册 unifiedAgentSystem agent_chat 监听器');
      }

      try {
        // 执行流式请求
        const result = await this.executor.executeStream(
          params,
          (event: StreamEvent) => {
            sendEvent(event);
          }
        );

        // 发送完成事件
        sendEvent({
          type: 'done',
          content: result.content,
          toolCallsExecuted: result.toolCallsExecuted,
          iterations: result.iterations,
        });
      } catch (streamError) {
        console.error('[ChatRoute] Stream error:', streamError);
        sendEvent({
          type: 'error',
          error: streamError instanceof Error ? streamError.message : String(streamError),
        });
      } finally {
        clearInterval(heartbeatInterval);
        // 移除智能体对话监听器
        if (this.app?.eventBus) {
          this.app.eventBus.off('agent_chat', onAgentChat);
        }
        if (this.app?.processManager) {
          this.app.processManager.off('agent_chat', onAgentChat);
        }
        if (this.app?.unifiedAgentSystem) {
          this.app.unifiedAgentSystem.off('agent_chat', onAgentChat);
        }
      }

      res.end();
    } catch (error) {
      console.error('[ChatRoute] Stream setup error:', error);
      sendError(res, 500, 'Stream failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 主路由分发
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '';
    const method = req.method || 'GET';

    // 解析路径
    const pathOnly = url.split('?')[0];

    if (pathOnly === '/chat' && method === 'POST') {
      return this.handleChat(req, res);
    }

    if (pathOnly === '/chat/stream' && method === 'POST') {
      return this.handleStream(req, res);
    }

    sendError(res, 404, 'Not found');
  }
}

/**
 * 创建聊天路由处理器
 */
export function createChatHandler(executor: AgentExecutor): ChatRouteHandler {
  return new ChatRouteHandler(executor);
}

/**
 * 创建聊天路由
 */
export function createChatRoutes(executor: AgentExecutor, app?: any): {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} {
  return {
    path: '/chat',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const handler = new ChatRouteHandler(executor, app);
      return handler.handle(req, res);
    }
  };
}

/**
  * 聊天路由函数（兼容路由注册）
  */
export async function chatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: AgentExecutor,
  app?: any
): Promise<boolean> {
  const handler = new ChatRouteHandler(executor, app);
  const url = req.url || '';
  const method = req.method || 'GET';
  const pathOnly = url.split('?')[0];

  if (pathOnly === '/chat' && method === 'POST') {
    await handler.handleChat(req, res);
    return true;
  }

  // /chat/stream 支持 GET (EventSource) 和 POST (fetch)
  if (pathOnly === '/chat/stream' && (method === 'GET' || method === 'POST')) {
    await handler.handleStream(req, res);
    return true;
  }

  return false;
}