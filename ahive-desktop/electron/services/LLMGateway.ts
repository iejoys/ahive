/**
 * LLM Gateway HTTP 服务器
 * 
 * 提供 OpenAI 兼容的 API 接口，作为大模型网关：
 * - AppKey 认证
 * - 模型路由
 * - 流量统计
 * 
 * 端口: 3004
 * 
 * 路由:
 * - POST /v1/chat/completions - 聊天完成
 * - GET /v1/models - 获取可用模型列表
 * - GET /health - 健康检查
 */

import log from 'electron-log';
import * as http from 'http';
import * as url from 'url';
import { EventEmitter } from 'events';
import { llmCenterService } from './LLMCenterService';
import { getA2AAgents, getProtocolConfig, saveProtocolConfig } from '../storage';

// ==================== 类型定义 ====================

/** AppKey 配置 */
export interface AppKeyConfig {
  /** AppKey (前缀 ahive_) */
  key: string;
  /** 关联的智能体 ID */
  agentId: string;
  /** 智能体名称 */
  agentName: string;
  /** 创建时间 */
  createdAt: string;
  /** 是否启用 */
  enabled: boolean;
  /** 权限配置 */
  permissions?: {
    /** 允许的模型列表（空表示全部允许） */
    allowedModels?: string[];
    /** 每日调用限制 */
    dailyLimit?: number;
  };
}

/** OpenAI 兼容请求 */
interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  tools?: any[];
  response_format?: { type: string };
}

/** OpenAI 兼容响应 */
interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** 模型信息 */
interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/** HTTP 服务器配置 */
interface LLMGatewayConfig {
  port?: number;
  host?: string;
}

// ==================== LLM Gateway 服务器 ====================

export class LLMGateway extends EventEmitter {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private appKeys: Map<string, AppKeyConfig> = new Map();
  private dailyUsage: Map<string, { date: string; count: number }> = new Map();

  constructor(config: LLMGatewayConfig = {}) {
    super();
    this.port = config.port || 3004;
    this.host = config.host || '127.0.0.1';
  }

  // ==================== 生命周期 ====================

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.server) {
      log.warn('[LLMGateway] Already running');
      return;
    }

    // 加载 AppKeys
    this.loadAppKeys();

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    
    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, this.host, () => {
        log.info(`[LLMGateway] Server started on http://${this.host}:${this.port}`);
        resolve();
      });
      
      this.server!.on('error', (err) => {
        log.error('[LLMGateway] Server error:', err);
        reject(err);
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (!this.server) return;
    
    return new Promise((resolve) => {
      this.server!.close(() => {
        log.info('[LLMGateway] Server stopped');
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * 获取服务地址
   */
  getAddress(): string {
    return `http://${this.host}:${this.port}`;
  }

  // ==================== AppKey 管理 ====================

  /**
   * 加载 AppKeys
   */
  private loadAppKeys(): void {
    const config = getProtocolConfig();
    const appKeys = config.llmGateway?.appKeys || [];
    
    this.appKeys.clear();
    for (const keyConfig of appKeys) {
      this.appKeys.set(keyConfig.key, keyConfig);
    }
    
    log.info(`[LLMGateway] Loaded ${this.appKeys.size} AppKeys`);
  }

  /**
   * 保存 AppKeys
   */
  private saveAppKeys(): void {
    const config = getProtocolConfig();
    config.llmGateway = config.llmGateway || {};
    config.llmGateway.appKeys = Array.from(this.appKeys.values());
    saveProtocolConfig(config);
  }

  /**
   * 生成 AppKey
   */
  generateAppKey(agentId: string, agentName: string): AppKeyConfig {
    const key = `ahive_${this.generateRandomString(32)}`;
    const config: AppKeyConfig = {
      key,
      agentId,
      agentName,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    
    this.appKeys.set(key, config);
    this.saveAppKeys();
    
    log.info(`[LLMGateway] Generated AppKey for ${agentName} (${agentId})`);
    return config;
  }

  /**
   * 删除 AppKey
   */
  deleteAppKey(key: string): boolean {
    const deleted = this.appKeys.delete(key);
    if (deleted) {
      this.saveAppKeys();
      log.info(`[LLMGateway] Deleted AppKey: ${key.substring(0, 12)}...`);
    }
    return deleted;
  }

  /**
   * 启用/禁用 AppKey
   */
  setAppKeyEnabled(key: string, enabled: boolean): boolean {
    const config = this.appKeys.get(key);
    if (config) {
      config.enabled = enabled;
      this.saveAppKeys();
      log.info(`[LLMGateway] AppKey ${key.substring(0, 12)}... ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }
    return false;
  }

  /**
   * 获取所有 AppKeys
   */
  listAppKeys(): AppKeyConfig[] {
    return Array.from(this.appKeys.values());
  }

  /**
   * 验证 AppKey
   */
  private validateAppKey(authHeader: string | undefined): AppKeyConfig | null {
    if (!authHeader) return null;
    
    // 支持 Bearer token 格式
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    
    const key = match[1];
    const config = this.appKeys.get(key);
    
    if (!config || !config.enabled) return null;
    
    return config;
  }

  /**
   * 检查每日限制
   */
  private checkDailyLimit(config: AppKeyConfig): boolean {
    if (!config.permissions?.dailyLimit) return true;
    
    const today = new Date().toISOString().slice(0, 10);
    const usage = this.dailyUsage.get(config.key);
    
    if (!usage || usage.date !== today) {
      this.dailyUsage.set(config.key, { date: today, count: 0 });
      return true;
    }
    
    return usage.count < config.permissions.dailyLimit;
  }

  /**
   * 记录每日使用
   */
  private recordDailyUsage(config: AppKeyConfig): void {
    const today = new Date().toISOString().slice(0, 10);
    const usage = this.dailyUsage.get(config.key);
    
    if (usage && usage.date === today) {
      usage.count++;
    } else {
      this.dailyUsage.set(config.key, { date: today, count: 1 });
    }
  }

  /**
   * 检查模型权限
   */
  private checkModelPermission(config: AppKeyConfig, model: string): boolean {
    if (!config.permissions?.allowedModels) return true;
    return config.permissions.allowedModels.includes(model);
  }

  // ==================== HTTP 处理 ====================

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '/', true);
    const path = parsedUrl.pathname || '/';
    const method = req.method || 'GET';

    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 路由
      if (path === '/v1/chat/completions' && method === 'POST') {
        await this.handleChatCompletions(req, res);
      } else if (path === '/v1/models' && method === 'GET') {
        this.handleListModels(req, res);
      } else if (path === '/health' && method === 'GET') {
        this.handleHealth(req, res);
      } else if (path === '/v1/appkeys' && method === 'GET') {
        this.handleListAppKeys(req, res);
      } else if (path === '/v1/appkeys' && method === 'POST') {
        await this.handleCreateAppKey(req, res);
      } else if (path.startsWith('/v1/appkeys/') && method === 'DELETE') {
        this.handleDeleteAppKey(req, res, path);
      } else {
        this.sendError(res, 404, 'Not Found');
      }
    } catch (error) {
      log.error('[LLMGateway] Request error:', error);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  /**
   * 处理聊天完成请求
   */
  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 验证 AppKey
    const appKeyConfig = this.validateAppKey(req.headers.authorization);
    if (!appKeyConfig) {
      this.sendError(res, 401, 'Invalid or missing API key');
      return;
    }

    // 解析请求体
    const body = await this.parseBody(req);
    if (!body) {
      this.sendError(res, 400, 'Invalid request body');
      return;
    }

    const request = body as ChatCompletionRequest;

    // 验证模型权限
    if (!this.checkModelPermission(appKeyConfig, request.model)) {
      this.sendError(res, 403, `Model ${request.model} not allowed for this API key`);
      return;
    }

    // 检查每日限制
    if (!this.checkDailyLimit(appKeyConfig)) {
      this.sendError(res, 429, 'Daily limit exceeded');
      return;
    }

    log.info(`[LLMGateway] Chat request from ${appKeyConfig.agentName}, model: ${request.model}`);

    try {
      // 调用 LLM Center
      const response = await llmCenterService.chat(
        request.messages.map(m => ({
          role: m.role,
          content: m.content,
          name: m.name,
        })),
        {
          model: request.model,
          agentId: appKeyConfig.agentId,
          userId: appKeyConfig.agentId,
          temperature: request.temperature,
          maxTokens: request.max_tokens,
          topP: request.top_p,
          stop: request.stop as string[],
        }
      );

      // 记录每日使用
      this.recordDailyUsage(appKeyConfig);

      // 构造 OpenAI 兼容响应
      const openaiResponse: ChatCompletionResponse = {
        id: response.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: response.model || request.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.content,
          },
          finish_reason: response.finishReason || 'stop',
        }],
        usage: response.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };

      this.sendJson(res, 200, openaiResponse);
      
      log.info(`[LLMGateway] Chat response sent to ${appKeyConfig.agentName}`);
    } catch (error: any) {
      log.error('[LLMGateway] Chat error:', error);
      this.sendError(res, 500, error.message || 'LLM call failed');
    }
  }

  /**
   * 处理模型列表请求
   */
  private handleListModels(req: http.IncomingMessage, res: http.ServerResponse): void {
    const providers = llmCenterService.listProviders();
    
    // 获取可用模型列表
    const models: ModelInfo[] = [
      { id: 'gpt-4o', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'gpt-4-turbo', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'gpt-3.5-turbo', object: 'model', created: 1700000000, owned_by: 'openai' },
      { id: 'claude-3-opus', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-3-sonnet', object: 'model', created: 1700000000, owned_by: 'anthropic' },
      { id: 'claude-3-haiku', object: 'model', created: 1700000000, owned_by: 'anthropic' },
    ];

    this.sendJson(res, 200, {
      object: 'list',
      data: models,
    });
  }

  /**
   * 处理健康检查
   */
  private handleHealth(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.sendJson(res, 200, {
      status: 'ok',
      service: 'llm-gateway',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 处理列出 AppKeys
   */
  private handleListAppKeys(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 仅允许本地访问
    const appKeys = this.listAppKeys().map(k => ({
      key: k.key.substring(0, 12) + '...',
      agentId: k.agentId,
      agentName: k.agentName,
      createdAt: k.createdAt,
      enabled: k.enabled,
    }));

    this.sendJson(res, 200, { appKeys });
  }

  /**
   * 处理创建 AppKey
   */
  private async handleCreateAppKey(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.parseBody(req);
    if (!body || !body.agentId) {
      this.sendError(res, 400, 'Missing agentId');
      return;
    }

    // 检查是否已有 AppKey
    const existing = Array.from(this.appKeys.values()).find(k => k.agentId === body.agentId);
    if (existing) {
      this.sendJson(res, 200, existing);
      return;
    }

    // 获取智能体名称
    const agents = getA2AAgents();
    const agent = agents.find(a => a.id === body.agentId);
    const agentName = agent?.name || body.agentId;

    const config = this.generateAppKey(body.agentId, agentName);
    this.sendJson(res, 201, config);
  }

  /**
   * 处理删除 AppKey
   */
  private handleDeleteAppKey(req: http.IncomingMessage, res: http.ServerResponse, path: string): void {
    const key = path.replace('/v1/appkeys/', '');
    const deleted = this.deleteAppKey(key);
    
    this.sendJson(res, 200, { success: deleted });
  }

  // ==================== 辅助方法 ====================

  /**
   * 解析请求体
   */
  private parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(res: http.ServerResponse, status: number, data: any): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * 发送错误响应
   */
  private sendError(res: http.ServerResponse, status: number, message: string): void {
    this.sendJson(res, status, {
      error: {
        message,
        type: 'error',
        code: status,
      },
    });
  }

  /**
   * 生成随机字符串
   */
  private generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// 单例导出
export const llmGateway = new LLMGateway();