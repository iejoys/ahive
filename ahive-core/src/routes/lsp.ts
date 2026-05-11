/**
 * LSP 路由
 *
 * HTTP API for LSP functionality
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { App } from '../core/app.js';
import { sendJson, parseBody, parseUrlPath } from './utils.js';
import { getLSPClientManager } from '../lsp/index.js';
import { logger } from '../utils/index.js';

/**
 * LSP 路由处理
 */
export async function lspRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  const method = req.method || 'GET';
  const path = parseUrlPath(req.url || '/');
  const lspManager = getLSPClientManager();

  // POST /api/lsp/request - LSP 请求
  if (path === '/api/lsp/request' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { filePath, operation, line, character } = body;

      if (!filePath || !operation) {
        sendJson(res, 400, { success: false, error: 'filePath and operation are required' });
        return true;
      }

      // 验证操作类型
      const validOperations = ['definition', 'references', 'hover', 'documentSymbol', 'workspaceSymbol', 'implementation', 'typeDefinition'];
      if (!validOperations.includes(operation)) {
        sendJson(res, 400, { success: false, error: `Invalid operation: ${operation}. Valid: ${validOperations.join(', ')}` });
        return true;
      }

      logger.info(`[LSP Route] Request: ${operation} on ${filePath}`);

      const result = await lspManager.handleRequest({
        operation,
        filePath,
        line: line || 1,
        character: character || 1,
      });

      sendJson(res, 200, result);
      return true;

    } catch (error) {
      logger.error('[LSP Route] Request error:', error);
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  // GET /api/lsp/status - LSP 状态
  if (path === '/api/lsp/status' && method === 'GET') {
    try {
      const status = lspManager.getStatus();
      sendJson(res, 200, { success: true, servers: status });
      return true;
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  // POST /api/lsp/enable - 启用 LSP 服务器
  if (path === '/api/lsp/enable' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { serverName } = body;

      if (!serverName) {
        sendJson(res, 400, { success: false, error: 'serverName is required' });
        return true;
      }

      await lspManager.enableServer(serverName);
      sendJson(res, 200, { success: true, message: `Server ${serverName} enabled` });
      return true;

    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  // POST /api/lsp/disable - 禁用 LSP 服务器
  if (path === '/api/lsp/disable' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { serverName } = body;

      if (!serverName) {
        sendJson(res, 400, { success: false, error: 'serverName is required' });
        return true;
      }

      await lspManager.disableServer(serverName);
      sendJson(res, 200, { success: true, message: `Server ${serverName} disabled` });
      return true;

    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  // POST /api/lsp/open - 打开文件
  if (path === '/api/lsp/open' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { filePath } = body;

      if (!filePath) {
        sendJson(res, 400, { success: false, error: 'filePath is required' });
        return true;
      }

      // 读取文件内容
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      await lspManager.openFile(filePath, content);

      sendJson(res, 200, { success: true, message: `File opened: ${filePath}` });
      return true;

    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  return false;
}