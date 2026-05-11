/**
 * MCP Server 管理器 (Electron 版本)
 * 负责 MCP Server 的生命周期管理 - 完全本地化
 * 
 * 移植自: agent-hive-v2/packages/server/src/mcp/MCPManager.ts
 */

import { spawn, ChildProcess } from 'child_process';
import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { getMCPServers, saveMCPServer, deleteMCPServer as deleteMCPServerFromStorage, getProtocolConfig } from '../storage';
import type { MCPServerConfig, MCPServerStatus, MCPTool } from '../storage';

// ========== 敏感信息脱敏工具 ==========

const SENSITIVE_KEYS = [
  'password', 'token', 'secret', 'key', 'apiKey', 'api_key',
  'credential', 'auth', 'authorization', 'private', 'accessToken'
];

/**
 * 脱敏对象中的敏感字段
 */
function sanitizeObject(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[Max Depth]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some(k => lowerKey.includes(k));

    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeObject(value, depth + 1);
    }
  }
  return result;
}


/**
 * MCP 协议请求
 */
interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

/**
 * MCP 协议响应
 */
interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP 执行器 - 管理单个 MCP Server 进程
 */
class MCPExecutor {
  private process: ChildProcess | null = null;
  private availableTools: MCPTool[] = [];
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private buffer = '';
  private initialized = false;

  constructor(private config: MCPServerConfig) { }

  /**
   * 启动 MCP Server 进程
   */
  async start(): Promise<MCPTool[]> {
    if (!this.config.command) {
      throw new Error('MCP server command is required');
    }

    return new Promise((resolve, reject) => {
      try {
        const isWindows = process.platform === 'win32';
        const command = isWindows && this.config.command === 'npx' ? 'npx.cmd' : this.config.command;

        // 获取用户选择的 npm 镜像源
        const registrySetting = getProtocolConfig().npmRegistry || 'auto';
        let npmRegistry: string;

        if (registrySetting === 'china') {
          npmRegistry = 'https://registry.npmmirror.com';  // 淘宝镜像
        } else if (registrySetting === 'official') {
          npmRegistry = 'https://registry.npmjs.org';  // 官方源
        } else {
          // auto: 智能选择
          const hasProxy = process.env.HTTPS_PROXY || process.env.https_proxy
            || process.env.HTTP_PROXY || process.env.http_proxy;
          npmRegistry = hasProxy
            ? 'https://registry.npmjs.org'
            : 'https://registry.npmmirror.com';
        }

        log.info(`[MCP ${this.config.name}] Using npm registry: ${npmRegistry} (setting: ${registrySetting})`);

        // 启动进程
        this.process = spawn(command, this.config.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: isWindows,
          env: {
            ...process.env,
            NPM_CONFIG_REGISTRY: npmRegistry,
            ...this.config.env
          }
        });

        // 处理 stderr
        this.process.stderr?.on('data', (data) => {
          log.error(`[MCP ${this.config.name}] stderr: ${data}`);
        });

        // 处理进程错误
        this.process.on('error', (error) => {
          log.error(`[MCP ${this.config.name}] Process error:`, sanitizeObject(error));
          this.initialized = false;
          reject(error);
        });

        // 处理进程退出
        this.process.on('exit', (code) => {
          log.info(`[MCP ${this.config.name}] Process exited with code ${code}`);
          this.initialized = false;
        });

        // 处理 stdout 响应
        this.process.stdout?.on('data', (data) => {
          this.handleResponse(data);
        });

        // 等待服务器就绪后初始化（npx 首次下载可能需要较长时间）
        // 使用重试机制，最多等待 60 秒
        let retries = 0;
        const maxRetries = 60;  // 60 次 * 1 秒 = 60 秒
        const tryInitialize = async (): Promise<MCPTool[]> => {
          try {
            await this.initializeProtocol();
            const tools = await this.listTools();
            this.initialized = true;
            return tools;
          } catch (error) {
            retries++;
            if (retries >= maxRetries) {
              throw error;
            }
            log.warn(`[MCP ${this.config.name}] Initialization attempt ${retries} failed, retrying...`);
            await new Promise(r => setTimeout(r, 1000));
            return tryInitialize();
          }
        };

        // 给进程一些启动时间
        setTimeout(async () => {
          try {
            const tools = await tryInitialize();
            resolve(tools);
          } catch (error) {
            log.error(`[MCP ${this.config.name}] All initialization attempts failed:`, sanitizeObject(error));
            reject(error);
          }
        }, 2000);  // 初始等待 2 秒

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 停止 MCP Server 进程
   */
  async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.stdin?.end();

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.process?.kill('SIGKILL');
          resolve();
        }, 5000);

        this.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    this.process = null;
    this.initialized = false;
    this.pendingRequests.clear();
  }

  /**
   * 获取可用工具
   */
  getTools(): MCPTool[] {
    return this.availableTools;
  }

  /**
   * 获取工具数量
   */
  getToolCount(): number {
    return this.availableTools.length;
  }

  /**
   * 调用工具
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.initialized || !this.process) {
      throw new Error('MCP server not initialized');
    }

    return this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    });
  }

  /**
   * 健康检查
   */
  isRunning(): boolean {
    return this.initialized && this.process !== null && !this.process.killed;
  }

  // ===== 私有方法 =====

  private async initializeProtocol(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'ahive-electron', version: '1.0.0' }
    }, 3000); // 使用 3 秒短超时，因为 npx 启动时可能会吞掉第一次输入

    log.info(`[MCP ${this.config.name}] Initialized:`, sanitizeObject(result));
    this.sendNotification('notifications/initialized', {});
  }

  private async listTools(): Promise<MCPTool[]> {
    try {
      const response = await this.sendRequest('tools/list', {}) as { tools: MCPTool[] };
      this.availableTools = response.tools || [];

      // 应用工具过滤
      if (this.config.enabledTools && this.config.enabledTools.length > 0) {
        this.availableTools = this.availableTools.filter(
          tool => this.config.enabledTools!.includes(tool.name)
        );
      }

      if (this.config.disabledTools && this.config.disabledTools.length > 0) {
        this.availableTools = this.availableTools.filter(
          tool => !this.config.disabledTools!.includes(tool.name)
        );
      }

      log.info(`[MCP ${this.config.name}] Found ${this.availableTools.length} tools`);
      return this.availableTools;
    } catch (error) {
      log.error(`[MCP ${this.config.name}] Failed to list tools:`, sanitizeObject(error));
      return [];
    }
  }

  private sendRequest(method: string, params: unknown, timeoutMs = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      const request: MCPRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });

      const requestStr = JSON.stringify(request) + '\n';
      this.process?.stdin?.write(requestStr);

      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for ${method}`));
        }
      }, timeoutMs);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };

    this.process?.stdin?.write(JSON.stringify(notification) + '\n');
  }

  private handleResponse(data: Buffer): void {
    this.buffer += data.toString();

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response: MCPResponse = JSON.parse(line);

        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (e) {
        console.debug(`[MCP ${this.config.name}] Parse error:`, line);
      }
    }
  }
}

/**
 * MCP 管理器 - 管理所有 MCP Server
 */
export class MCPManager {
  private executors: Map<string, MCPExecutor> = new Map();
  private statuses: Map<string, MCPServerStatus> = new Map();
  private initialized = false;

  private notifyTimeout: NodeJS.Timeout | null = null;

  /**
   * 通知渲染进程 MCP 状态变化 (带节流)
   */
  private notifyStatusChanged(): void {
    if (this.notifyTimeout) return;

    this.notifyTimeout = setTimeout(() => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0) {
        log.warn('[MCPManager] No windows available to notify');
      }
      windows.forEach(window => {
        window.webContents.send('mcp-status-changed');
      });
      log.info(`[MCPManager] Notified status change to ${windows.length} window(s)`);
      this.notifyTimeout = null;
    }, 100);
  }

  /**
   * 初始化 - 从本地存储加载并启动已启用的服务器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const savedServers = getMCPServers();
    log.info(`[MCPManager] Loading ${savedServers.length} saved servers...`);

    for (const config of savedServers) {
      if (config.enabled) {
        this.startServer(config.id).catch(error => {
          log.error(`[MCPManager] Failed to start server ${config.name}:`, error);
        });
      }
    }

    this.initialized = true;
    log.info('[MCPManager] Initialization complete');
  }

  /**
   * 启动 MCP Server
   */
  async startServer(serverId: string): Promise<MCPServerStatus> {
    const existingStatus = this.statuses.get(serverId);
    if (existingStatus && (existingStatus.status === 'starting' || existingStatus.status === 'running')) {
      log.info(`[MCPManager] Server ${serverId} is already ${existingStatus.status}, skipping start`);
      return existingStatus;
    }

    const servers = getMCPServers();
    const config = servers.find(s => s.id === serverId);

    if (!config) {
      return {
        id: serverId,
        status: 'error',
        availableTools: [],
        error: 'Server config not found',
        lastHeartbeat: new Date().toISOString()
      };
    }

    const status: MCPServerStatus = {
      id: config.id,
      status: 'starting',
      availableTools: [],
      lastHeartbeat: new Date().toISOString()
    };

    this.statuses.set(config.id, status);

    // 立即通知前端：正在启动
    this.notifyStatusChanged();

    try {
      const executor = new MCPExecutor(config);
      const tools = await executor.start();

      this.executors.set(config.id, executor);

      status.status = 'running';
      status.availableTools = tools;
      status.lastHeartbeat = new Date().toISOString();

      this.statuses.set(config.id, status);

      log.info(`[MCPManager] Server ${config.name} started with ${tools.length} tools`);

      // 通知渲染进程状态变化
      this.notifyStatusChanged();

      return status;
    } catch (error) {
      status.status = 'error';
      status.error = error instanceof Error ? error.message : String(error);
      status.lastHeartbeat = new Date().toISOString();

      this.statuses.set(config.id, status);

      log.error(`[MCPManager] Failed to start server ${config.name}:`, error);

      // 通知渲染进程状态变化（失败也要通知）
      this.notifyStatusChanged();

      return status;
    }
  }

  /**
   * 停止 MCP Server
   */
  async stopServer(serverId: string): Promise<void> {
    const executor = this.executors.get(serverId);
    if (executor) {
      await executor.stop();
      this.executors.delete(serverId);
    }

    const status = this.statuses.get(serverId);
    if (status) {
      status.status = 'stopped';
      status.lastHeartbeat = new Date().toISOString();
      this.statuses.set(serverId, status);
    }

    // 通知渲染进程状态变化
    this.notifyStatusChanged();
  }

  /**
   * 添加并启动 MCP Server
   */
  async addServer(config: MCPServerConfig): Promise<MCPServerStatus> {
    // 保存到本地存储
    saveMCPServer(config);

    if (config.enabled) {
      return this.startServer(config.id);
    }

    return {
      id: config.id,
      status: 'stopped',
      availableTools: [],
      lastHeartbeat: new Date().toISOString()
    };
  }

  /**
   * 删除 MCP Server
   */
  async removeServer(serverId: string): Promise<void> {
    await this.stopServer(serverId);
    deleteMCPServerFromStorage(serverId);
    this.statuses.delete(serverId);
    log.info(`[MCPManager] Server ${serverId} removed`);
  }

  /**
   * 获取所有 MCP Servers 配置
   */
  getAllServers(): MCPServerConfig[] {
    return getMCPServers();
  }

  /**
   * 获取 Server 状态
   */
  getStatus(serverId: string): MCPServerStatus | undefined {
    return this.statuses.get(serverId);
  }

  /**
   * 获取所有状态
   */
  getAllStatuses(): MCPServerStatus[] {
    return Array.from(this.statuses.values());
  }

  /**
   * 获取 Server 列表（带状态和工具数量）
   */
  getServerList(): Array<MCPServerConfig & { status: string; toolCount: number; error?: string }> {
    const servers = getMCPServers();
    return servers.map(server => {
      const status = this.statuses.get(server.id);
      const executor = this.executors.get(server.id);
      return {
        ...server,
        status: status?.status || 'stopped',
        toolCount: executor?.getToolCount() || 0,
        error: status?.error
      };
    });
  }

  /**
   * 获取 Server 实例（用于获取工具 schema）
   */
  getServer(serverId: string): { getTools(): MCPTool[] } | null {
    const executor = this.executors.get(serverId);
    if (!executor) return null;
    return {
      getTools: () => executor.getTools()
    };
  }

  /**
   * 获取工具列表
   */
  async getTools(serverId: string): Promise<MCPTool[]> {
    const executor = this.executors.get(serverId);
    return executor?.getTools() || [];
  }

  /**
   * 调用工具
   */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const executor = this.executors.get(serverId);
    if (!executor) {
      throw new Error(`MCP server ${serverId} not running`);
    }
    return executor.callTool(toolName, args);
  }

  /**
   * 启用/禁用 Server
   */
  async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
    const servers = getMCPServers();
    const config = servers.find(s => s.id === serverId);

    if (config) {
      config.enabled = enabled;
      saveMCPServer(config);

      if (!enabled) {
        await this.stopServer(serverId);
      } else {
        await this.startServer(serverId);
      }
    }
  }

  /**
   * 重启 Server
   */
  async restartServer(serverId: string): Promise<MCPServerStatus | null> {
    await this.stopServer(serverId);
    return this.startServer(serverId);
  }

  /**
   * 清理所有
   */
  async cleanup(): Promise<void> {
    for (const [serverId, executor] of Array.from(this.executors.entries())) {
      try {
        await executor.stop();
      } catch (error) {
        log.error(`[MCPManager] Failed to cleanup server ${serverId}:`, error);
      }
    }

    this.executors.clear();
    this.statuses.clear();
  }
}

// 单例导出
export const mcpManager = new MCPManager();