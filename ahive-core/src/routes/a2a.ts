/**
 * A2A (Agent-to-Agent) 路由
 * 处理智能体间通讯
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { App } from '../core/app.js';
import { parseBody, sendJson, sendError, parseUrlPath } from './utils.js';
import { logger } from '../utils/index.js';

/**
 * A2A 路由处理器
 */
export class A2ARouteHandler {
  constructor(private app: App) {}

  /**
   * 处理 POST /a2a
   * 发送消息给智能体（异步，不等待结果）
   * 保持与原来 main-process.ts 兼容的格式
   */
  async handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const { from, to, message } = body;

      if (!from || !to || !message) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(400);
        res.end(JSON.stringify({ error: '缺少 from, to 或 message' }));
        return;
      }

      // 通过 ProcessManager 发送消息
      if (this.app.processManager) {
        this.app.processManager.sendTo(from, to, message);
        
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'sent' }));
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'ProcessManager not available' }));
      }
    } catch (error) {
      console.error('[A2ARoute] Send error:', error);
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to send message' }));
    }
  }

  /**
   * 处理 POST /a2a/sync
   * 发送消息给智能体（同步，等待执行结果）
   */
  async handleSendSync(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const { from, to, message, type, timeout } = body;

      if (!to || !message) {
        sendError(res, 400, '缺少 to 或 message');
        return;
      }

      if (!this.app.processManager) {
        sendError(res, 500, 'ProcessManager not available');
        return;
      }

      const targetId = to;
      const content = message.content || message.text || message.message || message;

      logger.info(`[A2ARoute] 同步调用智能体: ${targetId}`);

      // 使用 RPC 调用执行，等待结果
      try {
        const result = await this.app.processManager.call(targetId, 'execute', {
          userMessage: content,
          systemPrompt: message.systemPrompt || '',
          message: content,
        }, timeout || 120000);

        sendJson(res, 200, {
          success: true,
          status: 'completed',
          from: from || 'client',
          to,
          result: {
            content: result.content,
            iterations: result.iterations,
            toolCallsExecuted: result.toolCallsExecuted,
          },
        });
      } catch (execError: any) {
        logger.error(`[A2ARoute] 执行失败:`, execError);
        sendJson(res, 200, {
          success: false,
          status: 'error',
          from: from || 'client',
          to,
          error: execError.message,
        });
      }
    } catch (error) {
      console.error('[A2ARoute] Sync send error:', error);
      sendError(res, 500, 'Failed to send message');
    }
  }

  /**
   * 主路由分发
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url || '';
    const method = req.method || 'GET';
    const path = parseUrlPath(rawUrl);

    if (path === '/a2a/sync' && method === 'POST') {
      return this.handleSendSync(req, res);
    }

    if (path === '/a2a' && method === 'POST') {
      return this.handleSend(req, res);
    }

    sendError(res, 404, 'Not found');
  }
}

/**
 * A2A 路由函数
 */
export async function a2aRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: any,
  app: App
): Promise<boolean> {
  const handler = new A2ARouteHandler(app);
  await handler.handle(req, res);
  return true;
}