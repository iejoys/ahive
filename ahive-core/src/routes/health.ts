/**
 * 健康检查路由
 * 提供服务健康状态检查接口
 */

import { IncomingMessage, ServerResponse } from 'http';
import { sendJson } from './utils.js';
import { getWSClientHealth, getWSClient } from '../monitoring/index.js';
import { getMemoryMonitor } from '../monitoring/memory-monitor.js';

/**
 * 健康检查路由处理器
 * GET /health - 返回服务健康状态
 */
export function healthRoutes(req: IncomingMessage, res: ServerResponse): boolean {
  const method = req.method?.toUpperCase();
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  // GET /health - 健康检查
  if (method === 'GET' && path === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
    return true;
  }

  // GET /status - 详细状态
  if (method === 'GET' && path === '/status') {
    sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
    });
    return true;
  }

  // GET /monitor/status - 监控模块状态
  if (method === 'GET' && path === '/monitor/status') {
    try {
      const wsHealth = getWSClientHealth();
      const memoryMonitor = getMemoryMonitor();
      
      sendJson(res, 200, {
        wsClient: wsHealth,
        memoryMonitor: {
          isRunning: (memoryMonitor as any).isRunning || false,
          sampleCount: (memoryMonitor as any).history?.length || 0,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendJson(res, 500, {
        error: 'Failed to get monitor status',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;
}