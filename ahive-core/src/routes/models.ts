/**
 * 模型管理路由
 * 处理 /api/models 相关请求
 * 支持本地 GGUF 模型管理
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { ProviderManager } from '../providers/index.js';
import type { AgentExecutor } from '../executor/interface.js';
import { parseBody, sendJson, sendError, getQueryParam } from './utils.js';
import { getModelManager } from '../services/model-manager.js';

/**
 * 模型路由处理器
 */
export class ModelsRouteHandler {
  constructor(private providerManager: ProviderManager) {}
  
  /**
   * 处理 GET /api/models
   * 获取所有本地 GGUF 模型列表
   */
  async handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const modelManager = getModelManager();
      const models = await modelManager.listModels();
      const currentModel = await modelManager.getCurrentModel();
      const settings = await modelManager.getSettings();
      
      sendJson(res, 200, {
        success: true,
        currentModel: currentModel?.id || '',
        models,
        settings,
      });
    } catch (error) {
      console.error('[ModelsRoute] List models error:', error);
      sendError(res, 500, 'Failed to list models');
    }
  }
  
  /**
   * 处理 GET /api/models/available
   * 获取可用模型列表（兼容旧 API）
   */
  async handleAvailable(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const modelManager = getModelManager();
      const models = await modelManager.listModels();
      
      const availableModels = models.map(m => ({
        id: m.id,
        name: m.name,
        type: 'local',
        downloaded: m.downloaded,
        size: m.size,
      }));
      
      sendJson(res, 200, {
        success: true,
        models: availableModels
      });
    } catch (error) {
      console.error('[ModelsRoute] Available models error:', error);
      sendError(res, 500, 'Failed to get available models');
    }
  }
  
  /**
   * 处理 GET /api/models/current
   * 获取当前模型信息
   */
  async handleGetCurrent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const modelManager = getModelManager();
      const current = await modelManager.getCurrentModel();
      const settings = await modelManager.getSettings();
      
      sendJson(res, 200, {
        success: true,
        current,
        settings,
      });
    } catch (error) {
      console.error('[ModelsRoute] Get current model error:', error);
      sendError(res, 500, 'Failed to get current model');
    }
  }
  
  /**
   * 处理 POST /api/models/switch
   * 切换模型
   */
  async handleSwitch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      
      // 支持两种参数：modelId（本地模型）或 type（Provider）
      const modelId = body.modelId || body.type;
      
      if (!modelId) {
        sendError(res, 400, 'modelId is required');
        return;
      }
      
      const modelManager = getModelManager();
      const result = await modelManager.switchModel(modelId);
      
      if (result.success) {
        sendJson(res, 200, {
          success: true,
          message: 'Model switched successfully',
        });
      } else {
        sendError(res, 400, result.error || 'Failed to switch model');
      }
    } catch (error) {
      console.error('[ModelsRoute] Switch model error:', error);
      sendError(res, 500, 'Failed to switch model');
    }
  }
  
  /**
   * 处理 POST /api/models/download
   * 下载模型（SSE 流式响应）
   */
  async handleDownload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const modelId = body.modelId;
      
      if (!modelId) {
        sendError(res, 400, 'modelId is required');
        return;
      }
      
      // 设置 SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      const modelManager = getModelManager();
      
      const result = await modelManager.downloadModel(modelId, (progress) => {
        // 发送进度事件
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
      });
      
      // 发送完成事件
      res.write(`data: ${JSON.stringify({ done: true, success: result.success, error: result.error })}\n\n`);
      res.end();
      
    } catch (error) {
      console.error('[ModelsRoute] Download model error:', error);
      // 如果响应头还没发送，发送错误响应
      if (!res.headersSent) {
        sendError(res, 500, 'Failed to download model');
      } else {
        res.write(`data: ${JSON.stringify({ done: true, success: false, error: (error as Error).message })}\n\n`);
        res.end();
      }
    }
  }
  
  /**
   * 处理 DELETE /api/models/:id
   * 删除模型
   */
  async handleDelete(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    try {
      const modelManager = getModelManager();
      const result = await modelManager.deleteModel(id);
      
      if (result.success) {
        sendJson(res, 200, {
          success: true,
          message: 'Model deleted',
        });
      } else {
        sendError(res, 400, result.error || 'Failed to delete model');
      }
    } catch (error) {
      console.error('[ModelsRoute] Delete model error:', error);
      sendError(res, 500, 'Failed to delete model');
    }
  }
  
  /**
   * 处理 POST /api/models/cancel-download
   * 取消下载
   */
  async handleCancelDownload(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const modelId = body.modelId;
      
      if (!modelId) {
        sendError(res, 400, 'modelId is required');
        return;
      }
      
      const modelManager = getModelManager();
      modelManager.cancelDownload(modelId);
      
      sendJson(res, 200, {
        success: true,
        message: 'Download cancelled',
      });
    } catch (error) {
      console.error('[ModelsRoute] Cancel download error:', error);
      sendError(res, 500, 'Failed to cancel download');
    }
  }
  
  /**
   * 处理 GET/POST /api/models/settings
   * 获取或更新设置
   */
  async handleSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const modelManager = getModelManager();
      
      if (req.method === 'GET') {
        const settings = await modelManager.getSettings();
        sendJson(res, 200, { success: true, settings });
      } else {
        const body = await parseBody(req);
        await modelManager.updateSettings(body);
        sendJson(res, 200, { success: true, message: 'Settings updated' });
      }
    } catch (error) {
      console.error('[ModelsRoute] Settings error:', error);
      sendError(res, 500, 'Failed to handle settings');
    }
  }
  
  /**
   * 主路由分发
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '';
    const method = req.method || 'GET';
    
    // 解析路径
    const pathParts = url.split('/').filter(Boolean);
    
    // /api/models
    if (pathParts.length === 2) {
      if (method === 'GET') {
        return this.handleList(req, res);
      }
    }
    
    // /api/models/available
    if (pathParts.length === 3 && pathParts[2] === 'available') {
      if (method === 'GET') {
        return this.handleAvailable(req, res);
      }
    }
    
    // /api/models/current
    if (pathParts.length === 3 && pathParts[2] === 'current') {
      if (method === 'GET') {
        return this.handleGetCurrent(req, res);
      }
    }
    
    // /api/models/switch
    if (pathParts.length === 3 && pathParts[2] === 'switch') {
      if (method === 'POST') {
        return this.handleSwitch(req, res);
      }
    }
    
    // /api/models/download
    if (pathParts.length === 3 && pathParts[2] === 'download') {
      if (method === 'POST') {
        return this.handleDownload(req, res);
      }
    }
    
    // /api/models/cancel-download
    if (pathParts.length === 3 && pathParts[2] === 'cancel-download') {
      if (method === 'POST') {
        return this.handleCancelDownload(req, res);
      }
    }
    
    // /api/models/settings
    if (pathParts.length === 3 && pathParts[2] === 'settings') {
      if (method === 'GET' || method === 'POST') {
        return this.handleSettings(req, res);
      }
    }
    
    // /api/models/:id (DELETE)
    if (pathParts.length === 3 && method === 'DELETE') {
      const id = pathParts[2];
      return this.handleDelete(req, res, id);
    }
    
    sendError(res, 404, 'Not found');
  }
}

/**
 * 创建模型路由处理器
 */
export function createModelsHandler(providerManager: ProviderManager): ModelsRouteHandler {
  return new ModelsRouteHandler(providerManager);
}

/**
 * 模型路由函数（用于路由注册）
 */
export async function modelsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: AgentExecutor,
  app?: any
): Promise<boolean> {
  const providerManager = app?.providerManager;
  if (!providerManager) {
    sendError(res, 500, 'ProviderManager not available');
    return true;
  }
  const handler = new ModelsRouteHandler(providerManager);
  await handler.handle(req, res);
  return true;
}