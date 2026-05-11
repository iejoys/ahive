/**
 * MCP 能力管理器
 * 
 * 管理 MCP 服务器的注册、工具调用和持久化
 * 
 * @created 2026-03-21
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/index.js';
import type { MCPServer, MCPTool, CapabilityUpdatePayload, MCPServersStore } from './types.js';
import { MCPWSPool } from './mcp-ws-pool.js';

/**
 * MCP 能力管理器
 */
export class MCPManager {
  private servers: Map<string, MCPServer> = new Map();
  private storePath: string;
  private initialized: boolean = false;
  private wsPool: MCPWSPool = new MCPWSPool();

  constructor(storePath: string) {
    this.storePath = storePath;
  }

  /**
   * 初始化：从文件加载
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 确保目录存在
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 加载已有数据
    this.load();
    this.initialized = true;

    logger.info(`[MCPManager] 初始化完成，已加载 ${this.servers.size} 个 MCP 服务器`);
  }

  /**
   * 从文件加载
   */
  load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const content = fs.readFileSync(this.storePath, 'utf-8');
        const store: MCPServersStore = JSON.parse(content);

        if (store.servers && Array.isArray(store.servers)) {
          for (const server of store.servers) {
            this.servers.set(server.serverId, server);
          }
        }

        logger.info(`[MCPManager] 从 ${this.storePath} 加载 ${this.servers.size} 个服务器`);
      }
    } catch (error) {
      logger.warn(`[MCPManager] 加载失败: ${error}`);
    }
  }

  /**
   * 保存到文件
   */
  save(): void {
    try {
      const store: MCPServersStore = {
        version: '1.0',
        servers: Array.from(this.servers.values()),
      };

      // 确保目录存在
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.storePath, JSON.stringify(store, null, 2), 'utf-8');
      logger.debug(`[MCPManager] 已保存 ${this.servers.size} 个服务器到 ${this.storePath}`);
    } catch (error) {
      logger.error(`[MCPManager] 保存失败: ${error}`);
    }
  }

  /**
   * 处理 capability_update 消息
   */
  handleCapabilityUpdate(agentId: string, action: string, payload: CapabilityUpdatePayload, skipSave: boolean = false): void {
    if (action === 'remove') {
      if (payload.capabilities) {
        for (const cap of payload.capabilities) {
          this.removeCapability(cap.server);
        }
      }
      if (!skipSave) this.save();
      return;
    }

    if (payload.changes?.removed && Array.isArray(payload.changes.removed)) {
      for (const removed of payload.changes.removed) {
        const serverId = removed.server;
        if (serverId) {
          this.removeCapability(serverId);
          logger.info(`[MCPManager] 从 changes.removed 移除 MCP 服务器: ${serverId}`);
        }
      }
    }

    if (!payload.capabilities || payload.capabilities.length === 0) {
      if (payload.changes?.removed && payload.changes.removed.length > 0) {
        if (!skipSave) this.save();
      }
      return;
    }

    for (const cap of payload.capabilities) {
      const serverId = cap.server;
      const existing = this.servers.get(serverId);

      const agentIds = existing?.agentIds || [];
      const idsToMerge: string[] = payload.agentIds || (agentId ? [agentId] : []);
      for (const id of idsToMerge) {
        if (id && !agentIds.includes(id)) {
          agentIds.push(id);
        }
      }

      const server: MCPServer = {
        serverId,
        serverType: cap.serverType,
        apiEndpoint: payload.apiEndpoint || existing?.apiEndpoint || '',
        agentKey: payload.agentKey || existing?.agentKey || '',
        urlPattern: payload.instruction?.url_pattern || existing?.urlPattern || '',
        tools: cap.tools,
        agentIds,
        instruction: payload.instruction,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString(),
      };

      this.servers.set(serverId, server);
      logger.info(`[MCPManager] ${existing ? '更新' : '添加'} MCP 服务器: ${serverId} (${cap.tools.length} 个工具), 关联智能体: ${agentId}`);
    }

    if (!skipSave) this.save();
  }

  /**
   * 保存/更新 MCP 服务器能力
   */
  saveCapability(server: Partial<MCPServer> & { serverId: string }, agentId?: string): void {
    const existing = this.servers.get(server.serverId);

    // 处理 agentIds
    const agentIds = server.agentIds || existing?.agentIds || [];
    if (agentId && !agentIds.includes(agentId)) {
      agentIds.push(agentId);
    }

    const fullServer: MCPServer = {
      serverId: server.serverId,
      serverType: server.serverType || existing?.serverType || 'mcp-server',
      apiEndpoint: server.apiEndpoint || existing?.apiEndpoint || '',
      agentKey: server.agentKey || existing?.agentKey || '',
      urlPattern: server.urlPattern || existing?.urlPattern || '',
      tools: server.tools || existing?.tools || [],
      agentIds,
      instruction: server.instruction || existing?.instruction,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    this.servers.set(server.serverId, fullServer);
    this.save();

    logger.info(`[MCPManager] 保存 MCP 服务器: ${server.serverId}${agentId ? ` (关联: ${agentId})` : ''}`);
  }

  /**
   * 移除 MCP 服务器
   */
  removeCapability(serverId: string): boolean {
    const removed = this.servers.delete(serverId);
    if (removed) {
      this.save();
      logger.info(`[MCPManager] 移除 MCP 服务器: ${serverId}`);
    }
    return removed;
  }

  /**
   * 获取所有 MCP 服务器
   */
  getAllServers(agentId?: string): MCPServer[] {
    const all = Array.from(this.servers.values());
    if (!agentId) return all;

    return all.filter(s => s.agentIds?.includes(agentId));
  }

  /**
   * 获取指定服务器
   */
  getServer(serverId: string): MCPServer | undefined {
    return this.servers.get(serverId);
  }

  /**
   * 获取所有 MCP 工具
   */
  getAllTools(agentId?: string): Array<{ serverId: string; tool: MCPTool }> {
    const result: Array<{ serverId: string; tool: MCPTool }> = [];

    const scopeServers = agentId ? this.getAllServers(agentId) : Array.from(this.servers.values());

    for (const server of scopeServers) {
      for (const tool of server.tools) {
        result.push({ serverId: server.serverId, tool });
      }
    }

    return result;
  }

  /**
   * 获取指定服务器的工具
   */
  getServerTools(serverId: string): MCPTool[] {
    const server = this.servers.get(serverId);
    return server ? server.tools : [];
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(serverId: string, toolName: string, params: Record<string, any>): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`MCP 服务器不存在: ${serverId}`);
    }

    // WebSocket 传输路由：按 endpoint scheme 判断，兼容所有 ws:// 开头的服务器类型
    const endpoint = server.urlPattern || server.apiEndpoint || '';
    if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) {
      logger.debug(`[MCPManager] WS 调用: ${serverId}/${toolName}`);
      return this.wsPool.sendCommand(serverId, endpoint, toolName, params);
    }

    // 构建请求 URL
    let url = server.urlPattern || server.apiEndpoint;
    if (url.includes('{serverId}')) {
      url = url.replace('{serverId}', serverId);
    }
    if (url.includes('{toolName}')) {
      url = url.replace('{toolName}', toolName);
    } else {
      // 默认 URL 格式
      url = `${server.apiEndpoint}/mcp/${serverId}/${toolName}`;
    }

    logger.debug(`[MCPManager] 调用 MCP 工具: ${serverId}/${toolName}`);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // 添加认证头
      if (server.agentKey) {
        headers['X-Agent-Key'] = server.agentKey;
      }

      // 添加自定义头
      if (server.instruction?.headers) {
        Object.assign(headers, server.instruction.headers);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`MCP 调用失败 (${response.status}): ${error}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`[MCPManager] 调用失败: ${error}`);
      throw error;
    }
  }

  /**
   * 检查服务器是否存在
   */
  hasServer(serverId: string, agentId?: string): boolean {
    const server = this.servers.get(serverId);
    if (!server) return false;
    if (!agentId) return true;
    return server.agentIds?.includes(agentId) || false;
  }

  /**
   * 获取服务器数量
   */
  getServerCount(agentId?: string): number {
    if (!agentId) return this.servers.size;
    return this.getAllServers(agentId).length;
  }

  /**
   * 获取工具总数
   */
  getToolCount(agentId?: string): number {
    let count = 0;
    const scopeServers = agentId ? this.getAllServers(agentId) : Array.from(this.servers.values());
    for (const server of scopeServers) {
      count += server.tools.length;
    }
    return count;
  }
}

/**
 * 创建 MCP 管理器
 */
export function createMCPManager(storePath: string): MCPManager {
  return new MCPManager(storePath);
}