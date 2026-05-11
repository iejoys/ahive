/**
 * MCP HTTP API 服务器
 * 
 * 提供 HTTP API 让 Agent 调用 MCP 工具
 * 支持原生 MCP Server 和 MCPAPI 两种服务类型
 */

import log from 'electron-log';
import * as http from 'http';
import * as url from 'url';
import { EventEmitter } from 'events';
import { capabilityManager } from './CapabilityManager';
import { keyManager } from './KeyManager';
import { getProtocolConfig, getMCPApiConfig } from '../storage';

/**
 * MCP 管理器接口（由 MCPManager 实现）
 */
interface IMCPManager {
  getServerList(): Array<{ id: string; name: string; status: string; toolCount: number; error?: string }>;
  getTools(serverId: string): Promise<Array<{ name: string; description: string }>>;
  callTool(serverId: string, toolName: string, params: Record<string, any>): Promise<any>;
}

/**
 * HTTP 服务器配置
 */
interface MCPHttpServerConfig {
  port?: number;
  host?: string;
}

/**
 * MCP HTTP API 服务器
 */
export class MCPHttpServer extends EventEmitter {
  private server: http.Server | null = null;
  private mcpManager: IMCPManager | null = null;
  private port: number;
  private host: string;
  private running: boolean = false;

  constructor(config: MCPHttpServerConfig = {}) {
    super();

    // 优先从全局配置加载端点，解析出端口
    const protocolConfig = getProtocolConfig();
    const endpoint = protocolConfig.mcpApiEndpoint || 'http://127.0.0.1:3002';

    try {
      const urlObj = new URL(endpoint);
      this.port = urlObj.port ? parseInt(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 3002);
      this.host = urlObj.hostname || '127.0.0.1';
    } catch (e) {
      this.port = config.port ?? 3002;
      this.host = config.host ?? '127.0.0.1';
    }
  }

  /**
   * 设置 MCP 管理器
   */
  setMCPManager(manager: IMCPManager): void {
    this.mcpManager = manager;
  }

  /**
   * 启动服务器
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.running) {
        resolve();
        return;
      }

      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error: Error) => {
        log.error('[MCPHttpServer] Server error:', error);
        this.emit('error', error);
        if (!this.running) {
          reject(error);  // 启动失败时 reject
        }
      });

      this.server.listen(this.port, this.host, () => {
        this.running = true;
        log.info(`[MCPHttpServer] Started on http://${this.host}:${this.port}`);
        this.emit('started', { port: this.port, host: this.host });
        resolve();
      });
    });
  }


  /**
   * 停止服务器
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server || !this.running) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.running = false;
        log.info('[MCPHttpServer] Stopped');
        this.emit('stopped');
        resolve();
      });
    });
  }

  /**
   * 获取服务器地址
   */
  getAddress(): string {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * 检查是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';
    const method = req.method || 'GET';

    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Key');

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 路由请求
      if (pathname === '/mcp/servers' && method === 'GET') {
        await this.handleListServers(req, res);
      } else if (pathname.match(/^\/mcp\/[^/]+\/tools$/) && method === 'GET') {
        await this.handleListTools(req, res, pathname);
      } else if (pathname.match(/^\/mcp\/[^/]+\/[^/]+$/) && method === 'POST') {
        await this.handleCallTool(req, res, pathname);
      } else if (pathname === '/health' && method === 'GET') {
        this.sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
      } else {
        this.sendError(res, 404, 'Not Found');
      }
    } catch (error) {
      log.error('[MCPHttpServer] Request error:', error);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * 处理列出服务器
   */
  private async handleListServers(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.mcpManager) {
      this.sendError(res, 503, 'MCP Manager not available');
      return;
    }

    const servers = this.mcpManager.getServerList();
    this.sendJson(res, 200, {
      servers: servers.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        toolsCount: s.toolCount,
      })),
    });
  }

  /**
   * 处理列出工具
   */
  private async handleListTools(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    if (!this.mcpManager) {
      this.sendError(res, 503, 'MCP Manager not available');
      return;
    }

    // 提取服务器 ID
    const match = pathname.match(/^\/mcp\/([^/]+)\/tools$/);
    if (!match) {
      this.sendError(res, 400, 'Invalid path');
      return;
    }

    const serverId = match[1];
    const tools = await this.mcpManager.getTools(serverId);

    this.sendJson(res, 200, {
      serverId,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
      })),
    });
  }

  /**
   * 处理调用工具
   */
  private async handleCallTool(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    // 提取服务器和工具名称
    const match = pathname.match(/^\/mcp\/([^/]+)\/([^/]+)$/);
    if (!match) {
      this.sendError(res, 400, 'Invalid path');
      return;
    }

    const serverId = match[1];
    const toolName = decodeURIComponent(match[2]);  // 解码工具名称

    // 获取并验证 Agent Key
    const agentKey = req.headers['x-agent-key'] as string;
    if (!agentKey) {
      this.sendError(res, 401, 'Missing X-Agent-Key header');
      return;
    }

    // 验证密钥并获取 agentId
    const verification = keyManager.verifyKey(agentKey);
    if (!verification.valid || !verification.agentId) {
      this.sendError(res, 401, verification.error || 'Invalid or expired agent key');
      return;
    }
    const agentId = verification.agentId;

    // 验证权限
    const permission = capabilityManager.hasPermission(agentId, serverId, toolName);
    if (!permission) {
      this.sendError(res, 403, `Agent ${agentId} has no permission to call ${serverId}.${toolName}`);
      return;
    }

    // 读取请求体
    const body = await this.readBody(req);
    const params = body ? JSON.parse(body) : {};

    // 获取能力绑定信息以确定 serverType
    const binding = capabilityManager.getBinding(agentId);
    const capability = binding?.capabilities.find(c => c.server === serverId);
    const serverType = capability?.serverType || 'mcp-server';

    // 调用工具（根据 serverType 路由）
    try {
      let result;
      
      if (serverType === 'mcp-api') {
        // MCPAPI 调用
        result = await this.callMCPApiTool(serverId, toolName, params);
      } else {
        // 原生 MCP 调用
        if (!this.mcpManager) {
          throw new Error('MCP Manager not available');
        }
        result = await this.mcpManager.callTool(serverId, toolName, params);
      }
      
      this.sendJson(res, 200, {
        success: true,
        serverId,
        toolName,
        result,
        serverType,  // 返回服务类型便于调试
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`[MCPHttpServer] Tool call error:`, error);
      this.sendJson(res, 500, {
        success: false,
        serverId,
        toolName,
        error: errorMessage,
      });
    }
  }

  /**

  /**
   * 调用 MCPAPI 工具
   * 
   * MCPAPI 是平台桥接服务，根据平台类型使用不同的调用方式：
   * - 百炼(bailian): 使用 Responses API，AI 模型决定调用工具
   * - OpenAI/其他: 使用传统 MCP 协议
   */
  private async callMCPApiTool(
    configId: string,
    toolName: string,
    params: Record<string, any>
  ): Promise<any> {
    log.info(`[MCPHttpServer] Calling MCPAPI tool: ${configId}/${toolName}`);

    // 1. 获取 MCPAPI 配置
    const mcpApiConfig = getMCPApiConfig(configId);
    if (!mcpApiConfig) {
      throw new Error(`MCPAPI config not found: ${configId}`);
    }

    if (!mcpApiConfig.enabled) {
      throw new Error(`MCPAPI config is disabled: ${configId}`);
    }

    const platformType = mcpApiConfig.platformType || 'bailian';

    // 2. 根据平台类型选择调用方式
    if (platformType === 'bailian' || platformType === 'openai-compatible') {
      // 百炼/OpenAI 兼容平台：使用 Responses API
      log.info(`[MCPHttpServer] Using Responses API for platform: ${platformType}`);
      return await this.callBailianResponsesAPI(mcpApiConfig, params);
    } else {
      // 其他平台：使用传统 MCP 协议
      log.info(`[MCPHttpServer] Using MCP protocol for platform: ${platformType}`);
      return await this.callExternalMCPServerLegacy(mcpApiConfig, toolName, params);
    }
  }

  /**
   * 传统 MCP 协议调用（用于非百炼平台）
   */
  private async callExternalMCPServerLegacy(
    mcpApiConfig: any,
    toolName: string,
    params: Record<string, any>
  ): Promise<any> {
    const mcpServers = mcpApiConfig.mcpServers || [];
    const fieldValues = mcpApiConfig.fieldValues || {};

    if (mcpServers.length === 0) {
      throw new Error(`No MCP servers configured`);
    }

    // 解析工具名称
    let targetServerLabel: string;
    let actualToolName: string;

    if (toolName.includes('/')) {
      const parts = toolName.split('/');
      targetServerLabel = parts[0];
      actualToolName = parts.slice(1).join('/');
    } else {
      targetServerLabel = mcpServers[0].label;
      actualToolName = toolName;
    }

    const targetServer = mcpServers.find((s: any) => s.label === targetServerLabel);
    if (!targetServer) {
      throw new Error(`MCP server not found: ${targetServerLabel}`);
    }

    // 构建请求头
    const requestHeaders: Record<string, string> = {
      ...targetServer.headers
    };

    if (fieldValues.apiKey) {
      requestHeaders['Authorization'] = `Bearer ${fieldValues.apiKey}`;
    }

    // 调用外部 MCP Server
    const mcpRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: actualToolName,
        arguments: params
      }
    };

    try {
      const response = await fetch(targetServer.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...requestHeaders
        },
        body: JSON.stringify(mcpRequest),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'MCP error');
      }

      return data.result || { content: data.content || [] };
    } catch (error) {
      log.error(`[MCPHttpServer] External MCP call failed:`, error);
      throw error;
    }
  }

  /**
   * 通过 Responses API 调用百炼 MCP 服务
   * 
   * 百炼 MCP 不支持传统的 tools/call MCP 协议
   * 必须使用 Responses API，让 AI 模型决定调用哪个工具
   */
  private async callBailianResponsesAPI(
    mcpApiConfig: any,
    params: Record<string, any>
  ): Promise<any> {
    const fieldValues = mcpApiConfig.fieldValues || {};
    const mcpServers = mcpApiConfig.mcpServers || [];

    // 构建 MCP 工具配置
    const tools = mcpServers.map((server: any) => ({
      type: 'mcp',
      server_protocol: 'sse',
      server_label: server.label,
      server_description: server.description || `MCP Server: ${server.label}`,
      server_url: server.url,
      headers: {
        Authorization: `Bearer ${fieldValues.apiKey}`
      }
    }));

    // 构建 Responses API 请求
    const endpoint = fieldValues.endpoint || 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1';
    const url = `${endpoint}/responses`;

    // 从 params 中提取用户输入
    // 智能体可能传入不同的参数格式，需要适配
    let input: string;
    if (typeof params === 'string') {
      input = params;
    } else if (params.input || params.query || params.message || params.question) {
      input = params.input || params.query || params.message || params.question;
    } else if (params.prompt) {
      input = params.prompt;
    } else {
      // 如果没有明确的输入字段，将整个 params 转为 JSON 字符串
      input = JSON.stringify(params);
    }

    const requestBody = {
      model: fieldValues.model || 'qwen3.5-plus',
      input,
      tools
    };

    log.info(`[MCPHttpServer] Calling Bailian Responses API: ${url}`);
    log.debug('[MCPHttpServer] Request:', JSON.stringify(requestBody, null, 2));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${fieldValues.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000) // 2分钟超时
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      log.debug('[MCPHttpServer] Bailian response:', JSON.stringify(data, null, 2));

      // 解析 Responses API 响应
      // 返回格式: { output_text: "...", usage: {...} }
      return {
        output_text: data.output_text || data.output || '',
        usage: data.usage,
        raw: data
      };
    } catch (error) {
      log.error(`[MCPHttpServer] Bailian Responses API call failed:`, error);
      throw error;
    }
  }

  /**
   * 读取请求体
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', reject);
    });
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * 发送错误响应
   */
  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    this.sendJson(res, statusCode, {
      error: true,
      status: statusCode,
      message,
    });
  }
}

// 单例导出
export const mcpHttpServer = new MCPHttpServer();