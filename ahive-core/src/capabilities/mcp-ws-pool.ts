/**
 * MCP WebSocket 连接池
 * 
 * 独立模块，与 WSClient 完全隔离
 * 专用于 MCP 工具的 WebSocket 调用（如 Godot MCP 插件）
 * 
 * @created 2026-05-09
 */
import WebSocket from 'ws';
import { logger } from '../utils/index.js';

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface WSConnection {
  ws: WebSocket;
  pending: Map<string, PendingRequest>;
  url: string;
  serverId: string;
}

/**
 * MCP WebSocket 连接池
 * 
 * 管理多个 MCP 服务器的 WebSocket 长连接
 * 提供请求-响应匹配机制
 */
export class MCPWSPool {
  private connections: Map<string, WSConnection> = new Map();

  /**
   * 获取或创建连接
   */
  getConnection(serverId: string, url: string): WSConnection {
    const existing = this.connections.get(serverId);
    if (existing && existing.ws.readyState === WebSocket.OPEN) {
      return existing;
    }

    // 清理旧连接（如果存在但已断开）
    if (existing) {
      this.closeConnection(serverId);
    }

    logger.info(`[MCPWSPool] 创建连接: ${serverId} → ${url}`);

    const ws = new WebSocket(url);
    const conn: WSConnection = {
      ws,
      pending: new Map(),
      url,
      serverId,
    };

    ws.on('open', () => {
      logger.info(`[MCPWSPool] ✅ 已连接: ${serverId} → ${url}`);
    });

    ws.on('message', (data: Buffer) => {
      this.handleMessage(serverId, data);
    });

    ws.on('error', (error) => {
      logger.error(`[MCPWSPool] 连接错误: ${serverId}`, error.message);
    });

    ws.on('close', (code, reason) => {
      logger.warn(`[MCPWSPool] 连接断开: ${serverId} (code: ${code})`);
      // 拒绝所有 pending 请求
      for (const [cmdId, req] of conn.pending.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error(`Connection closed: ${serverId}`));
      }
      conn.pending.clear();
    });

    this.connections.set(serverId, conn);
    return conn;
  }

  /**
   * 发送命令并等待响应
   */
  sendCommand(serverId: string, url: string, toolName: string, params: any, timeout: number = 10000): Promise<any> {
    const conn = this.getConnection(serverId, url);

    // 如果连接还未建立，等待 open 事件
    if (conn.ws.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        const connectTimer = setTimeout(() => {
          cleanup();
          reject(new Error(`WebSocket connection timeout: ${serverId}`));
        }, 5000);

        const onOpen = () => {
          cleanup();
          this._sendCommandInternal(conn, serverId, toolName, params, timeout).then(resolve).catch(reject);
        };

        const onError = (error: any) => {
          cleanup();
          reject(new Error(`WebSocket connection failed: ${serverId} - ${error?.message || error}`));
        };

        const cleanup = () => {
          conn.ws.removeListener('open', onOpen);
          conn.ws.removeListener('error', onError);
          clearTimeout(connectTimer);
        };

        conn.ws.once('open', onOpen);
        conn.ws.once('error', onError);
      });
    }

    if (conn.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`WebSocket not ready: ${serverId} (state: ${conn.ws.readyState})`));
    }

    return this._sendCommandInternal(conn, serverId, toolName, params, timeout);
  }

  /**
   * 内部发送命令方法（连接已建立时调用）
   */
  private _sendCommandInternal(conn: WSConnection, serverId: string, toolName: string, params: any, timeout: number): Promise<any> {
    const commandId = `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const command = {
      type: toolName,
      params: params || {},
      commandId,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(commandId);
        reject(new Error(`MCP WS timeout: ${serverId}/${toolName} (${timeout}ms)`));
      }, timeout);

      conn.pending.set(commandId, { resolve, reject, timer });

      try {
        conn.ws.send(JSON.stringify(command));
        logger.debug(`[MCPWSPool] 发送命令: ${serverId}/${toolName} (id: ${commandId})`);
      } catch (error: any) {
        clearTimeout(timer);
        conn.pending.delete(commandId);
        reject(new Error(`Failed to send: ${error?.message || error}`));
      }
    });
  }

  /**
   * 处理收到的消息（响应匹配）
   */
  private handleMessage(serverId: string, data: Buffer): void {
    try {
      const response = JSON.parse(data.toString());
      const commandId = response.commandId;

      if (!commandId) {
        logger.debug(`[MCPWSPool] 收到无 commandId 的消息: ${serverId}`, JSON.stringify(response).substring(0, 100));
        return;
      }

      const conn = this.connections.get(serverId);
      if (!conn) {
        logger.warn(`[MCPWSPool] 收到消息但连接不存在: ${serverId}`);
        return;
      }

      const pending = conn.pending.get(commandId);
      if (!pending) {
        logger.debug(`[MCPWSPool] 收到未知 commandId: ${commandId}`);
        return;
      }

      // 匹配成功，清理并返回
      clearTimeout(pending.timer);
      conn.pending.delete(commandId);

      if (response.status === 'success') {
        pending.resolve(response.result || response);
        logger.debug(`[MCPWSPool] ✅ 命令成功: ${serverId}/${commandId}`);
      } else {
        const errorMsg = response.message || response.error || 'Unknown error';
        pending.reject(new Error(errorMsg));
        logger.warn(`[MCPWSPool] ❌ 命令失败: ${serverId}/${commandId} - ${errorMsg}`);
      }
    } catch (error) {
      logger.error(`[MCPWSPool] 消息解析失败: ${serverId}`, error);
    }
  }

  /**
   * 关闭指定连接
   */
  closeConnection(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (conn) {
      // 拒绝所有 pending 请求
      for (const [cmdId, req] of conn.pending.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error(`Connection closed: ${serverId}`));
      }
      conn.pending.clear();

      try {
        conn.ws.close();
      } catch (e) {
        // 忽略关闭错误
      }
      this.connections.delete(serverId);
      logger.info(`[MCPWSPool] 连接已关闭: ${serverId}`);
    }
  }

  /**
   * 关闭所有连接
   */
  closeAll(): void {
    logger.info(`[MCPWSPool] 关闭所有连接 (${this.connections.size})`);
    for (const serverId of Array.from(this.connections.keys())) {
      this.closeConnection(serverId);
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(): Array<{ serverId: string; url: string; readyState: number; pendingCount: number }> {
    const result = [];
    for (const [serverId, conn] of this.connections.entries()) {
      result.push({
        serverId,
        url: conn.url,
        readyState: conn.ws.readyState,
        pendingCount: conn.pending.size,
      });
    }
    return result;
  }
}
