/**
 * 会话管理路由
 * 处理 /api/session 相关请求
 */

import type { IncomingMessage, ServerResponse } from 'http';
  import type { AgentExecutor } from '../executor/interface.js';
  import { parseBody, sendJson, sendError, getQueryParam, parseUrlPath } from './utils.js';
  import { getSessionMemory, type ChatMessage } from '../memory/session-memory.js';

/**
 * 会话路由处理器
 */
export class SessionRouteHandler {
  constructor(private executor: AgentExecutor) {}
  
  /**
   * 处理 GET /api/session
   * 获取当前会话信息
   */
  async handleGetSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = getQueryParam(req.url || '', 'sessionId') || 'default';
      const sessionMemory = getSessionMemory();
      const stats = sessionMemory.getStats(sessionId);
      
      sendJson(res, 200, {
        success: true,
        sessionId,
        stats,
        message: 'Session active'
      });
    } catch (error) {
      console.error('[SessionRoute] Get session error:', error);
      sendError(res, 500, 'Failed to get session');
    }
  }
  
  /**
   * 处理 GET /api/session/status
   * 获取会话状态
   */
  async handleGetStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = getQueryParam(req.url || '', 'sessionId') || 'default';
      const sessionMemory = getSessionMemory();
      const stats = sessionMemory.getStats(sessionId);
      
      sendJson(res, 200, {
        success: true,
        sessionId,
        status: 'active',
        messageCount: stats.messageCount,
        lastActivity: stats.newestMessage,
        created: stats.oldestMessage
      });
    } catch (error) {
      console.error('[SessionRoute] Get status error:', error);
      sendError(res, 500, 'Failed to get session status');
    }
  }
  
  /**
   * 处理 POST /api/session
   * 创建新会话
   */
  async handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const sessionId = body.sessionId || `session_${Date.now()}`;
      
      sendJson(res, 201, {
        success: true,
        sessionId,
        message: 'Session created'
      });
    } catch (error) {
      console.error('[SessionRoute] Create session error:', error);
      sendError(res, 500, 'Failed to create session');
    }
  }
  
  /**
   * 处理 DELETE /api/session
   * 删除会话
   */
  async handleDeleteSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = getQueryParam(req.url || '', 'sessionId');
      
      if (!sessionId) {
        sendError(res, 400, 'sessionId is required');
        return;
      }
      
      const sessionMemory = getSessionMemory();
      sessionMemory.clear(sessionId);
      
      sendJson(res, 200, {
        success: true,
        message: 'Session deleted'
      });
    } catch (error) {
      console.error('[SessionRoute] Delete session error:', error);
      sendError(res, 500, 'Failed to delete session');
    }
  }
  
  /**
   * 处理 GET /api/session/list
   * 列出所有会话
   */
  async handleListSessions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // 注意：当前 SessionMemory 实现不支持列出所有会话
      // 返回空列表，后续可以扩展
      sendJson(res, 200, {
        success: true,
        sessions: [],
        message: 'Session listing not implemented yet'
      });
    } catch (error) {
      console.error('[SessionRoute] List sessions error:', error);
      sendError(res, 500, 'Failed to list sessions');
    }
  }
  
  /**
   * 处理 GET /api/session/history
   * 获取会话历史
   */
  async handleGetHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = getQueryParam(req.url || '', 'sessionId') || 'default';
      const maxMessages = parseInt(getQueryParam(req.url || '', 'maxMessages') || '100');
      const sessionMemory = getSessionMemory();
      let history = sessionMemory.getHistory(sessionId);
      
      // 限制返回的消息数量
      if (maxMessages > 0 && history.length > maxMessages) {
        history = history.slice(-maxMessages);
      }
      
      sendJson(res, 200, {
        success: true,
        sessionId,
        history,
        count: history.length
      });
    } catch (error) {
      console.error('[SessionRoute] Get history error:', error);
      sendError(res, 500, 'Failed to get session history');
    }
  }
  
  /**
   * 处理 POST /api/session/message
   * 添加消息到会话
   */
  async handleAddMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const sessionId = body.sessionId || 'default';
      const role = body.role || 'user';
      const content = body.content;
      
      if (!content) {
        sendError(res, 400, 'content is required');
        return;
      }
      
      if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        sendError(res, 400, 'role must be user, assistant, or system');
        return;
      }
      
      const sessionMemory = getSessionMemory();
      
      if (role === 'user') {
        sessionMemory.addUserMessage(sessionId, content);
      } else if (role === 'assistant') {
        sessionMemory.addAssistantMessage(sessionId, content);
      } else {
        // system message - 直接添加
        sessionMemory.getHistory(sessionId); // 触发初始化
      }
      
      sendJson(res, 200, {
        success: true,
        message: 'Message added to session'
      });
    } catch (error) {
      console.error('[SessionRoute] Add message error:', error);
      sendError(res, 500, 'Failed to add message');
    }
  }
  
  /**
   * 处理 DELETE /api/session/history
   * 清空会话历史
   */
  async handleClearHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = getQueryParam(req.url || '', 'sessionId');
      
      if (!sessionId) {
        sendError(res, 400, 'sessionId is required');
        return;
      }
      
      const sessionMemory = getSessionMemory();
      sessionMemory.clear(sessionId);
      
      sendJson(res, 200, {
        success: true,
        message: 'Session history cleared'
      });
    } catch (error) {
      console.error('[SessionRoute] Clear history error:', error);
      sendError(res, 500, 'Failed to clear session history');
    }
  }
  
/**
    * 主路由分发
    */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url || '';
    const method = req.method || 'GET';
    
    // 解析路径（去除查询字符串）
    const path = parseUrlPath(rawUrl);
    const pathParts = path.split('/').filter(Boolean);
    
    // /api/session
    if (pathParts.length === 2) {
      if (method === 'GET') {
        return this.handleGetSession(req, res);
      } else if (method === 'POST') {
        return this.handleCreateSession(req, res);
      } else if (method === 'DELETE') {
        return this.handleDeleteSession(req, res);
      }
    }
    
    // /api/session/status
    if (pathParts.length === 3 && pathParts[2] === 'status') {
      if (method === 'GET') {
        return this.handleGetStatus(req, res);
      }
    }
    
    // /api/session/list
    if (pathParts.length === 3 && pathParts[2] === 'list') {
      if (method === 'GET') {
        return this.handleListSessions(req, res);
      }
    }
    
    // /api/session/history
    if (pathParts.length === 3 && pathParts[2] === 'history') {
      if (method === 'GET') {
        return this.handleGetHistory(req, res);
      } else if (method === 'DELETE') {
        return this.handleClearHistory(req, res);
      }
    }
    
    // /api/session/message
    if (pathParts.length === 3 && pathParts[2] === 'message') {
      if (method === 'POST') {
        return this.handleAddMessage(req, res);
      }
    }
    
    sendError(res, 404, 'Not found');
  }
}

/**
 * 创建会话路由处理器
 */
export function createSessionHandler(executor: AgentExecutor): SessionRouteHandler {
  return new SessionRouteHandler(executor);
}

/**
 * 会话路由函数（用于路由注册）
 */
export async function sessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: AgentExecutor,
  app?: any
): Promise<boolean> {
  const handler = new SessionRouteHandler(executor);
  await handler.handle(req, res);
  return true;
}