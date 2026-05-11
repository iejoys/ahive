/**
 * 路由注册入口
 * 
 * 统一注册所有 API 路由
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { AgentExecutor } from '../executor/interface.js';
import type { App } from '../core/app.js';
import { agentsRoutes } from './agents.js';
import { chatRoutes } from './chat.js';
import { sessionRoutes } from './session.js';
import { modelsRoutes } from './models.js';
import { healthRoutes } from './health.js';
import { rpcRoutes } from './rpc.js';
import { staticRoutes } from './static.js';
import { providerRoutes } from './provider.js';
import { a2aRoutes } from './a2a.js';
import { rolesRoutes } from './roles.js';
import { capabilitiesRoutes } from './capabilities.js';
import { ahivecoreRoutes } from './ahivecore.js';
import { lspRoutes } from './lsp.js';
import { workflowRoutes } from './workflow.js';
import { skillsRoutes } from './skills.js';
import { memoryRoutes } from './memory.js';

import { sendJson, sendError, parseUrlPath, parseBody } from './utils.js';
import { logger } from '../utils/index.js';

/**
 * 注册所有路由
 * 
 * @param req HTTP 请求
 * @param res HTTP 响应
 * @param executor 执行器实例
 * @param app 应用实例
 * @returns 是否已处理
 */
export async function registerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: AgentExecutor,
  app: App
): Promise<boolean> {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const path = parseUrlPath(url);

  // CORS 预检请求
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.writeHead(204);
    res.end();
    return true;
  }

  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 健康检查路由
  if (healthRoutes(req, res)) {
    return true;
  }

  // 智能体路由 /api/unified-agents
  if (path.startsWith('/api/unified-agents')) {
    return await agentsRoutes(req, res, executor, app, app?.processManager);
  }

  // 聊天路由 /chat
  if (path.startsWith('/chat')) {
    return await chatRoutes(req, res, executor, app);
  }

  // 会话路由 /api/session
  if (path.startsWith('/api/session')) {
    return await sessionRoutes(req, res, executor, app);
  }

  // 模型路由 /api/models
  if (path.startsWith('/api/models')) {
    return await modelsRoutes(req, res, executor, app);
  }

  // Provider 路由 /api/provider
  if (path.startsWith('/api/provider')) {
    return await providerRoutes(req, res, executor, app);
  }

  // RPC 路由 /rpc
  if (path.startsWith('/rpc')) {
    return await rpcRoutes(req, res, executor, app);
  }

  // A2A 路由 /a2a
  if (path.startsWith('/a2a')) {
    return await a2aRoutes(req, res, executor, app);
  }

  // 角色管理路由 /api/roles
  if (path.startsWith('/api/roles')) {
    try {
      return await rolesRoutes(req, res);
    } catch (error) {
      logger.error(`[Routes] 角色路由错误: ${error}`);
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  // 能力管理路由 /api/capabilities
  if (path.startsWith('/api/capabilities')) {
    try {
      return await capabilitiesRoutes(req, res, app);
    } catch (error) {
      logger.error(`[Routes] 能力路由错误: ${error}`);
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  // AHIVECORE 核心智能体路由 /api/ahivecore
  if (path.startsWith('/api/ahivecore')) {
    return await ahivecoreRoutes(req, res, app);
  }

  // LSP 路由 /api/lsp
  if (path.startsWith('/api/lsp')) {
    return await lspRoutes(req, res, app);
  }

  // 工作流路由 /api/workflow
  if (path.startsWith('/api/workflow')) {
    return await workflowRoutes(req, res, app);
  }

  // 技能路由 /api/skills
  if (path.startsWith('/api/skills')) {
    return await skillsRoutes(req, res);
  }

  // 记忆路由 /api/memory
  if (path.startsWith('/api/memory')) {
    return await memoryRoutes(req, res, app);
  }

  // ========== 中断和插话 API ==========

  // 中断执行 POST /api/interrupt
  if (path === '/api/interrupt' && method === 'POST') {
    return await handleInterrupt(req, res, app);
  }

  // 用户插话 POST /api/user-input
  if (path === '/api/user-input' && method === 'POST') {
    return await handleUserInput(req, res, app);
  }

  // 设置工作目录 POST /api/agents/set-workdir
  if (path === '/api/agents/set-workdir' && method === 'POST') {
    try {
      const body = await parseBody(req) as { workdir?: string; agentId?: string };
      if (!body.workdir) {
        logger.error(`[workdir] :`+body.workdir);
        sendError(res, 400, 'Missing workdir');
        return true;
      }
      const pm = app?.processManager;
      // 设置指挥官的工作目录
      if (app?.ahivecore && typeof (app.ahivecore as any).setWorkdir === 'function') {
        (app.ahivecore as any).setWorkdir(body.workdir);
      }
      if (pm) {
        // 记住workdir，新启动的Agent也会收到
        (pm as any).currentWorkdir = body.workdir;
        const msg = { type: 'set_workdir', workdir: body.workdir };
        if (body.agentId) {
          try { pm.sendRaw(body.agentId, msg); } catch {}
        } else {
          for (const aid of (pm as any).processes?.keys() || []) {
            try { pm.sendRaw(aid, msg); } catch {}
          }
        }
      }
      sendJson(res, 200, { success: true });
      return true;
    } catch (error) {
      logger.error(`[Routes] 能力路由错误:`+error);
      sendError(res, 500, 'Failed to set workdir');
      return true;
    }
  }

  // 静态文件路由
  const handled = await staticRoutes(req, res);
  if (handled) {
    return true;
  }

  // 根路径 - 返回欢迎信息（仅当没有 index.html 时）
  if (path === '/') {
    sendJson(res, 200, {
      name: 'AHIVE Core',
      version: '0.1.0',
      description: 'Agent Hive Core API Server',
      endpoints: [
        'GET  /health - 健康检查',
        'GET  /api/unified-agents - 获取智能体列表',
        'POST /api/unified-agents - 创建智能体',
        'GET  /api/unified-agents/:id - 获取智能体详情',
        'POST /chat - 非流式聊天',
        'POST /chat/stream - 流式聊天',
        'GET  /api/session - 获取会话列表',
        'POST /api/session - 创建会话',
        'GET  /api/models - 获取模型列表',
        'POST /rpc - RPC 调用',
        'POST /api/lsp/request - LSP 请求',
        'GET  /api/lsp/status - LSP 状态',
        'GET  /public/* - 静态文件',
      ],
    });
    return true;
  }

  return false;
}

/**
 * 导出所有路由模块
 */
export { agentsRoutes } from './agents.js';
export { chatRoutes } from './chat.js';
export { sessionRoutes } from './session.js';
export { modelsRoutes } from './models.js';
export { healthRoutes } from './health.js';
export { rpcRoutes } from './rpc.js';
export { staticRoutes } from './static.js';

// ==================== 中断和插话处理函数 ====================

/**
 * 处理中断请求
 * POST /api/interrupt
 */
async function handleInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  try {
    const processManager = app?.processManager;

    if (!processManager) {
      sendJson(res, 200, { success: false, error: 'ProcessManager not available' });
      return true;
    }

    // 解析请求体
    const body = await parseBody(req);
    const agentId = body.agentId as string | undefined;

    // 必须明确指定 agentId
    if (!agentId) {
      sendJson(res, 400, { success: false, error: 'agentId is required' });
      return true;
    }

    // 发送中断消息到子进程（使用 sendRaw 直接发送，不包装）
    processManager.sendRaw(agentId, { type: 'interrupt' });

    logger.info(`[Routes] 已发送中断信号到智能体: ${agentId}`);

    sendJson(res, 200, {
      success: true,
      message: 'Interrupt signal sent',
      agentId
    });

  } catch (error) {
    logger.error('[Routes] Interrupt error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return true;
}

/**
 * 处理用户插话
 * POST /api/user-input
 */
async function handleUserInput(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  try {
    const body = await parseBody(req);
    // 兼容 message 和 input 两种字段名
    const message = body.message || body.input;

    if (!message) {
      sendJson(res, 400, { success: false, error: 'message is required' });
      return true;
    }

    // 必须明确指定 agentId
    const agentId = body.agentId as string | undefined;
    if (!agentId) {
      sendJson(res, 400, { success: false, error: 'agentId is required' });
      return true;
    }

    const processManager = app?.processManager;

    if (!processManager) {
      sendJson(res, 200, { success: false, error: 'ProcessManager not available' });
      return true;
    }

    // 发送用户插话到子进程（使用 sendRaw 直接发送，不包装）
    processManager.sendRaw(agentId, {
      type: 'user_input',
      input: message
    });

    logger.info(`[Routes] 已发送用户插话到智能体: ${agentId}`);

    sendJson(res, 200, {
      success: true,
      message: 'User input sent',
      agentId
    });

  } catch (error) {
    logger.error('[Routes] User input error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return true;
}