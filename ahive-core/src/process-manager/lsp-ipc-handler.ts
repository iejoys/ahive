/**
 * LSP IPC 处理器
 *
 * 处理子进程的 LSP 请求
 */

import { getLSPClientManager } from '../lsp/index.js';
import type { LSPRequest, LSPIPCMessage } from '../lsp/types.js';
import { logger } from '../utils/index.js';

/**
 * 注册 LSP IPC 处理器
 *
 * @param processManager - Agent Process Manager 实例
 */
export function registerLSPHandlers(processManager: any): void {
  const lspManager = getLSPClientManager();

  // 监听子进程消息
  processManager.on('message', async (msg: any, agentId: string) => {
    const msgType = msg?.type;

    // LSP 请求
    if (msgType === 'lsp_request') {
      logger.debug(`[LSP-IPC] Request from ${agentId}: ${msg.operation} ${msg.filePath}`);

      try {
        const result = await lspManager.handleRequest({
          operation: msg.operation,
          filePath: msg.filePath,
          line: msg.line,
          character: msg.character,
        });

        processManager.sendToAgent(agentId, {
          type: 'lsp_response',
          id: msg.id,
          success: result.success,
          data: result.data,
          error: result.error,
          durationMs: result.durationMs,
        });

      } catch (error) {
        processManager.sendToAgent(agentId, {
          type: 'lsp_response',
          id: msg.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // LSP 状态查询
    if (msgType === 'lsp_status') {
      const status = lspManager.getStatus();
      processManager.sendToAgent(agentId, {
        type: 'lsp_status_response',
        id: msg.id,
        status,
      });
    }

    // 启用 LSP 服务器
    if (msgType === 'lsp_enable') {
      try {
        await lspManager.enableServer(msg.serverName);
        processManager.sendToAgent(agentId, {
          type: 'lsp_enable_response',
          id: msg.id,
          success: true,
        });
        logger.info(`[LSP-IPC] Enabled ${msg.serverName} by ${agentId}`);
      } catch (error) {
        processManager.sendToAgent(agentId, {
          type: 'lsp_enable_response',
          id: msg.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // 禁用 LSP 服务器
    if (msgType === 'lsp_disable') {
      try {
        await lspManager.disableServer(msg.serverName);
        processManager.sendToAgent(agentId, {
          type: 'lsp_disable_response',
          id: msg.id,
          success: true,
        });
        logger.info(`[LSP-IPC] Disabled ${msg.serverName} by ${agentId}`);
      } catch (error) {
        processManager.sendToAgent(agentId, {
          type: 'lsp_disable_response',
          id: msg.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  });

  logger.info('[LSP-IPC] Handlers registered');
}

/**
 * 取消注册 LSP IPC 处理器
 */
export function unregisterLSPHandlers(processManager: any): void {
  // 移除所有 LSP 相关的监听器
  processManager.removeAllListeners?.('message');
  logger.info('[LSP-IPC] Handlers unregistered');
}