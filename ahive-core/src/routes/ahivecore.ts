/**
 * AHIVECORE 核心智能体路由
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { App } from '../core/app.js';
import { sendJson, parseBody, parseUrlPath } from './utils.js';
import { logger, notifyCapabilityUpdate } from '../utils/index.js';
import { getWSClient } from '../monitoring/ws-client.js';

/**
 * AHIVECORE 路由
 * POST /api/ahivecore/chat - 与 AHIVECORE 对话
 * GET /api/ahivecore/status - 获取 AHIVECORE 状态
 * GET /api/ahivecore/prompt - 获取系统提示词（用于调试）
 */
export async function ahivecoreRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  const method = req.method || 'GET';
  const path = parseUrlPath(req.url || '');

  // 只处理 /api/ahivecore 路径
  if (!path.startsWith('/api/ahivecore')) {
    return false;
  }

  // POST /api/ahivecore/chat - 与 AHIVECORE 对话
  if (path === '/api/ahivecore/chat' && method === 'POST') {
    return await handleChat(req, res, app);
  }

  // GET /api/ahivecore/status - 获取状态
  if (path === '/api/ahivecore/status' && method === 'GET') {
    return handleStatus(req, res, app);
  }

  // GET /api/ahivecore/prompt - 获取提示词
  if (path === '/api/ahivecore/prompt' && method === 'GET') {
    return handleGetPrompt(req, res, app);
  }

  // POST /api/ahivecore/refresh - 刷新动态数据
  if (path === '/api/ahivecore/refresh' && method === 'POST') {
    return await handleRefresh(req, res, app);
  }

  // POST /api/ahivecore/interrupt - 终止任务
  if (path === '/api/ahivecore/interrupt' && method === 'POST') {
    return await handleInterrupt(req, res, app);
  }

  // POST /api/ahivecore/user-input - 插话
  if (path === '/api/ahivecore/user-input' && method === 'POST') {
    return await handleUserInput(req, res, app);
  }

  return false;
}

/**
 * 处理与 AHIVECORE 的对话
 */
async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  try {
    const body = await parseBody(req);
    const { message, stream = true } = body;  // 默认启用流式

    if (!message) {
      sendJson(res, 400, { success: false, error: 'message is required' });
      return true;
    }

    const ahivecore = app.ahivecore;

    if (!ahivecore) {
      sendJson(res, 500, { success: false, error: 'AHIVECORE not initialized' });
      return true;
    }

    if (stream) {
      // 流式模式
      // 设置 SSE 响应头
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 调用流式方法
      const result = await ahivecore.chatStream(message, (event) => {
        const wsClient = getWSClient();
        if (wsClient && wsClient.isConnected()) {
          wsClient.send({
            type: 'event',
            payload: {
              type: event.type,
              agentId: event.agentId,
              timestamp: event.timestamp,
              data: event,
            },
          });
        }
        
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // 发送最终结果
      res.write(`data: ${JSON.stringify({
        type: 'done',
        agentId: ahivecore.getAgentId(),
        response: result.content,
        toolCallsExecuted: result.toolCallsExecuted,
      })}\n\n`);

      res.end();

    } else {
      // 非流式模式（兼容）
      const result = await ahivecore.chat(message);

      sendJson(res, 200, {
        success: true,
        agentId: ahivecore.getAgentId(),
        response: result.content,
        toolCallsExecuted: result.toolCallsExecuted,
      });
    }

  } catch (error) {
    logger.error('[AHIVECORE] Chat error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}

/**
 * 获取 AHIVECORE 状态
 */
function handleStatus(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): boolean {
  const ahivecore = app.ahivecore;

  if (!ahivecore) {
    sendJson(res, 200, {
      status: 'not_initialized',
      message: 'AHIVECORE 未初始化',
    });
    return true;
  }

  sendJson(res, 200, {
    status: 'running',
    agentId: ahivecore.getAgentId(),
    config: {
      id: ahivecore.getConfig().id,
      name: ahivecore.getConfig().name,
      isCore: ahivecore.isCoreAgent(),
      deletable: ahivecore.isDeletable(),
    },
    promptLength: ahivecore.getSystemPrompt().length,
  });

  return true;
}

/**
 * 终止任务
 */
async function handleInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  try {
    const ahivecore = app.ahivecore;

    if (!ahivecore) {
      sendJson(res, 500, { success: false, error: 'AHIVECORE not initialized' });
      return true;
    }

    // 设置中断标志
    ahivecore.setInterrupted(true);
    
    logger.info('[AHIVECORE] 任务已终止');

    sendJson(res, 200, {
      success: true,
      message: 'Task interrupted',
    });

  } catch (error) {
    logger.error('[AHIVECORE] Interrupt error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return true;
}

/**
 * 用户插话
 */
async function handleUserInput(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  try {
    const body = await parseBody(req);
    const message = body.message || body.input;

    if (!message) {
      sendJson(res, 400, { success: false, error: 'message is required' });
      return true;
    }

    const ahivecore = app.ahivecore;

    if (!ahivecore) {
      sendJson(res, 500, { success: false, error: 'AHIVECORE not initialized' });
      return true;
    }

    // 添加用户插话到消息队列
    ahivecore.addUserInput(message);
    
    logger.info(`[AHIVECORE] 用户插话: ${message}`);

    sendJson(res, 200, {
      success: true,
      message: 'User input added',
    });

  } catch (error) {
    logger.error('[AHIVECORE] User input error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return true;
}

/**
 * 获取系统提示词
 */
function handleGetPrompt(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): boolean {
  const ahivecore = app.ahivecore;

  if (!ahivecore) {
    sendJson(res, 500, { error: 'AHIVECORE not initialized' });
    return true;
  }

  // 返回提示词（前1000字符预览）
  const prompt = ahivecore.getSystemPrompt();

  sendJson(res, 200, {
    length: prompt.length,
    preview: prompt.substring(0, 1000) + '...',
    full: prompt,  // 完整提示词
  });

  return true;
}

/**
 * 刷新动态数据
 */
async function handleRefresh(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  try {
    const body = await parseBody(req);
    const ahivecore = app.ahivecore;

    if (!ahivecore) {
      sendJson(res, 500, { error: 'AHIVECORE not initialized' });
      return true;
    }

    // 更新动态数据
    ahivecore.updateDynamicData({
      agentsList: body.agentsList || '',
      systemCapabilities: body.systemCapabilities || '',
      mcpCapabilities: body.mcpCapabilities || '',
    });

    // 如果包含 MCP 能力字符串更新，通知所有 Agent 刷新（可能包含工具变化）
    if (body.mcpCapabilities || body.systemCapabilities) {
      notifyCapabilityUpdate(app, 'ahivecore', 'refresh', {
        mcpCapabilities: body.mcpCapabilities,
        systemCapabilities: body.systemCapabilities
      });
    }

    sendJson(res, 200, {
      success: true,
      message: 'Dynamic data refreshed',
    });

  } catch (error) {
    logger.error('[AHIVECORE] Refresh error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}