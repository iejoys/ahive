/**
 * Provider 管理路由
 * 处理 /api/provider 相关请求
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { App } from '../core/app.js';
import { parseBody, sendJson, sendError, getQueryParam, parseUrlPath } from './utils.js';

/**
 * Provider 路由处理器
 */
export class ProviderRouteHandler {
  constructor(private app: App) {}
  
  /**
   * 处理 GET /api/provider
   * 获取当前 Provider 信息
   */
  async handleGetProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const providerManager = this.app.providerManager;
      
      if (!providerManager) {
        sendJson(res, 200, {
          success: true,
          current: null,
          health: { available: false, error: 'Provider not initialized' }
        });
        return;
      }
      
      const currentConfig = providerManager.getCurrentConfig();
      const presets = providerManager.getAPIPresets();
      
      // 查找预设名称
      const preset = presets.find((p: any) => p.id === currentConfig.config.presetId);
      const providerName = preset?.name || currentConfig.type;
      
      // 简单健康检查
      let health = { available: true, error: null };
      try {
        await providerManager.healthCheck();
      } catch (e: any) {
        health = { available: false, error: e.message };
      }
      
      sendJson(res, 200, {
        success: true,
        current: {
          type: currentConfig.type,
          name: providerName,
          config: currentConfig.config
        },
        health
      });
    } catch (error) {
      console.error('[ProviderRoute] Get provider error:', error);
      sendError(res, 500, 'Failed to get provider');
    }
  }
  
  /**
   * 处理 GET /api/provider/presets
   * 获取 API 预设列表
   */
  async handleGetPresets(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const providerManager = this.app.providerManager;
      
      if (!providerManager) {
        sendJson(res, 200, {
          success: true,
          presets: []
        });
        return;
      }
      
      const presets = providerManager.getAPIPresets();
      const savedProviders = providerManager.getSavedProviders();
      
      sendJson(res, 200, {
        success: true,
        presets,
        savedProviders
      });
    } catch (error) {
      console.error('[ProviderRoute] Get presets error:', error);
      sendError(res, 500, 'Failed to get presets');
    }
  }
  
  /**
   * 处理 POST /api/provider/switch
   * 切换 Provider
   */
  async handleSwitchProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const providerManager = this.app.providerManager;
      
      if (!providerManager) {
        sendError(res, 500, 'Provider not initialized');
        return;
      }
      
      // 前端发送的数据结构：{ type, gpuLayers, threads, ... }
      // 需要把 type 提取出来，其余作为 config
      const { type, ...config } = body;
      
      if (!type) {
        sendError(res, 400, 'type is required');
        return;
      }
      
      console.log('[ProviderRoute] Switch provider:', type, 'config:', config);
      
      const result = await providerManager.switchProvider(type, config);
      
      if (result.success) {
        sendJson(res, 200, {
          success: true,
          message: 'Provider switched successfully',
          provider: {
            type,
            config: providerManager.getCurrentConfig().config
          }
        });
      } else {
        sendJson(res, 400, {
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error('[ProviderRoute] Switch provider error:', error);
      sendError(res, 500, 'Failed to switch provider');
    }
  }
  
  /**
   * 处理 POST /api/provider/test
   * 测试 Provider 配置是否可用
   */
  async handleTestProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);
      const providerManager = this.app.providerManager;
      
      if (!providerManager) {
        sendError(res, 500, 'Provider not initialized');
        return;
      }
      
      const { type, config } = body;
      
      if (!config?.apiEndpoint || !config?.apiKey || !config?.apiModel) {
        sendJson(res, 400, {
          success: false,
          error: 'Missing required fields: apiEndpoint, apiKey, apiModel'
        });
        return;
      }
      
      // 创建临时 Provider 进行测试
      const testResult = await providerManager.testProvider(type || 'openai', {
        apiEndpoint: config.apiEndpoint,
        apiKey: config.apiKey,
        apiModel: config.apiModel,
        presetId: config.presetId || 'custom',
      });
      
      if (testResult.success) {
        sendJson(res, 200, {
          success: true,
          message: 'Connection successful',
          model: config.apiModel
        });
      } else {
        sendJson(res, 400, {
          success: false,
          error: testResult.error || 'Connection failed'
        });
      }
    } catch (error: any) {
      console.error('[ProviderRoute] Test provider error:', error);
      sendJson(res, 500, {
        success: false,
        error: error.message || 'Test failed'
      });
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
    
    // /api/provider
    if (pathParts.length === 2) {
      if (method === 'GET') {
        return this.handleGetProvider(req, res);
      }
    }
    
    // /api/provider/presets
    if (pathParts.length === 3 && pathParts[2] === 'presets') {
      if (method === 'GET') {
        return this.handleGetPresets(req, res);
      }
    }
    
    // /api/provider/switch
    if (pathParts.length === 3 && pathParts[2] === 'switch') {
      if (method === 'POST') {
        return this.handleSwitchProvider(req, res);
      }
    }
    
    // /api/provider/test
    if (pathParts.length === 3 && pathParts[2] === 'test') {
      if (method === 'POST') {
        return this.handleTestProvider(req, res);
      }
    }
    
    sendError(res, 404, 'Not found');
  }
}

/**
 * Provider 路由函数
 */
export async function providerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: any,
  app: App
): Promise<boolean> {
  const handler = new ProviderRouteHandler(app);
  await handler.handle(req, res);
  return true;
}