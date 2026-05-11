/**
 * 工作流上下文路由
 * 处理工作流心跳和上下文管理
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { App } from '../core/app.js';
import { sendJson, parseUrlPath, parseBody } from './utils.js';
import { logger } from '../utils/index.js';
import { getWorkflowContextManager } from '../services/WorkflowContextManager.js';

/**
 * 工作流路由处理器
 */
export async function workflowRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  const method = req.method?.toUpperCase();
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  // 获取 WorkflowContextManager
  const contextManager = getWorkflowContextManager();

  // POST /api/workflow/heartbeat - 接收工作流心跳
  if (method === 'POST' && path === '/api/workflow/heartbeat') {
    return await handleHeartbeat(req, res, contextManager);
  }

  // GET /api/workflow/:workflowId/context - 获取工作流上下文
  const contextMatch = path.match(/^\/api\/workflow\/([^/]+)\/context$/);
  if (contextMatch && method === 'GET') {
    const workflowId = contextMatch[1];
    return await handleGetContext(req, res, workflowId, contextManager);
  }

  // DELETE /api/workflow/:workflowId/context - 清理工作流上下文
  if (contextMatch && method === 'DELETE') {
    const workflowId = contextMatch[1];
    return await handleClearContext(req, res, workflowId, contextManager);
  }

  // GET /api/workflow/active - 获取所有活跃工作流
  if (method === 'GET' && path === '/api/workflow/active') {
    return await handleGetActive(req, res, contextManager);
  }

  // GET /api/workflow/:workflowId/prompts/:agentId - 获取智能体的项目配置提示词
  const promptMatch = path.match(/^\/api\/workflow\/([^/]+)\/prompts\/([^/]+)$/);
  if (promptMatch && method === 'GET') {
    const workflowId = promptMatch[1];
    const agentId = promptMatch[2];
    return await handleGetPrompt(req, res, workflowId, agentId, contextManager);
  }

  return false;
}

/**
 * 处理心跳请求
 * POST /api/workflow/heartbeat
 */
async function handleHeartbeat(
  req: IncomingMessage,
  res: ServerResponse,
  contextManager: ReturnType<typeof getWorkflowContextManager>
): Promise<boolean> {
  try {
    const body = await parseBody(req);
    
    // 验证必要字段
    if (!body.workflowId) {
      sendJson(res, 400, { success: false, error: 'workflowId is required' });
      return true;
    }

    if (!body.timestamp) {
      sendJson(res, 400, { success: false, error: 'timestamp is required' });
      return true;
    }

    // 处理心跳
    const result = await contextManager.handleHeartbeat(body);

    // 返回智能体状态
    sendJson(res, 200, {
      success: true,
      timestamp: Date.now(),
      agents: result.agents,
    });

    logger.info(`[WorkflowRoutes] Heartbeat received: ${body.workflowId}, status: ${body.status}`);

  } catch (error) {
    logger.error('[WorkflowRoutes] Heartbeat error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}

/**
 * 获取工作流上下文
 * GET /api/workflow/:workflowId/context
 */
async function handleGetContext(
  req: IncomingMessage,
  res: ServerResponse,
  workflowId: string,
  contextManager: ReturnType<typeof getWorkflowContextManager>
): Promise<boolean> {
  try {
    const context = contextManager.getWorkflowContext(workflowId);

    if (!context) {
      sendJson(res, 404, { success: false, error: 'Workflow context not found' });
      return true;
    }

    sendJson(res, 200, { success: true, data: context });

  } catch (error) {
    logger.error('[WorkflowRoutes] Get context error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}

/**
 * 清理工作流上下文
 * DELETE /api/workflow/:workflowId/context
 */
async function handleClearContext(
  req: IncomingMessage,
  res: ServerResponse,
  workflowId: string,
  contextManager: ReturnType<typeof getWorkflowContextManager>
): Promise<boolean> {
  try {
    contextManager.clearWorkflowContext(workflowId);

    sendJson(res, 200, { success: true, message: 'Workflow context cleared' });

    logger.info(`[WorkflowRoutes] Context cleared: ${workflowId}`);

  } catch (error) {
    logger.error('[WorkflowRoutes] Clear context error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}

/**
 * 获取所有活跃工作流
 * GET /api/workflow/active
 */
async function handleGetActive(
  req: IncomingMessage,
  res: ServerResponse,
  contextManager: ReturnType<typeof getWorkflowContextManager>
): Promise<boolean> {
  try {
    const workflows = contextManager.getActiveWorkflows();

    sendJson(res, 200, { success: true, data: workflows });

  } catch (error) {
    logger.error('[WorkflowRoutes] Get active workflows error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}

/**
 * 获取智能体的项目配置提示词
 * GET /api/workflow/:workflowId/prompts/:agentId
 */
async function handleGetPrompt(
  req: IncomingMessage,
  res: ServerResponse,
  workflowId: string,
  agentId: string,
  contextManager: ReturnType<typeof getWorkflowContextManager>
): Promise<boolean> {
  try {
    const prompt = contextManager.getProjectPrompt(workflowId, agentId);

    if (!prompt) {
      sendJson(res, 404, { success: false, error: 'Project prompt not found' });
      return true;
    }

    sendJson(res, 200, { success: true, data: { prompt } });

  } catch (error) {
    logger.error('[WorkflowRoutes] Get prompt error:', error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}