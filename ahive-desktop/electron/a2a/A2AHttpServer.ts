/**
 * A2A HTTP API 服务器
 * 
 * 提供 HTTP API 让 Agent 之间进行通讯
 * 端口: 3003
 * 
 * 路由:
 * - GET/POST /a2a - 发送消息
 * - GET /a2a/messages/:agentId - 获取离线消息
 * - GET /a2a/logs - 搜索对话日志
 * - GET /a2a/logs/:logId - 获取特定对话
 * - GET /a2a/directory - 获取团队通讯录
 * - POST /a2a/directory/send - 发送团队通讯录
 * - GET /a2a/status - 获取智能体状态
 * - GET /health - 健康检查
 */

import log from 'electron-log';
import * as http from 'http';
import * as url from 'url';
import { EventEmitter } from 'events';
import { ConversationLogger, A2AMessageType, A2A_MESSAGE_DESCRIPTIONS, conversationLogger } from './ConversationLogger';
import { getA2AAgents, getMessageQueue, addQueuedMessage, clearQueuedMessages, type QueuedMessage } from '../storage';
import type { A2AManager } from './A2AManager';

// ==================== 类型定义 ====================

/** A2A 请求参数 */
interface A2ARequest {
  type: A2AMessageType;
  sender: string;
  AGENTNAME: string;
  消息: string;
  节点ID?: string;
  工作流ID?: string;
  // === 新增：任务控制参数 ===
  taskData?: {
    taskId?: string;
    taskName?: string;
    expectedDuration?: number;
    priority?: 'low' | 'normal' | 'high';
  };
  // === 新增：进度参数 ===
  progress?: number;
  // === 新增：超时参数 ===
  timeout?: number;
  // === 新增：恢复上下文 ===
  recoveryContext?: Record<string, unknown>;
}

/** A2A 响应 */
interface A2AResponse {
  success: boolean;
  type?: A2AMessageType;
  from?: string;
  to?: string;
  nodeId?: string;
  workflowId?: string;
  logId?: string;
  error?: string;
}

/** 团队通讯录 */
interface TeamDirectory {
  type: 'team_directory';
  projectId: string;
  MCP_URL: string;
  A2A_URL: string;
  agents: Array<{
    id: string;
    name: string;
    role: string;
  }>;
  messageTypes: Array<{
    type: A2AMessageType;
    description: string;
  }>;
  usage: {
    MCP调用: {
      description: string;
      format: string;
      example: string;
    };
    A2A通讯: {
      description: string;
      format: string;
      example: string;
    };
  };
}

/** HTTP 服务器配置 */
interface A2AHttpServerConfig {
  port?: number;
  host?: string;
}

// ==================== A2A HTTP 服务器 ====================

export class A2AHttpServer extends EventEmitter {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private running: boolean = false;

  // 智能体注册表
  private agentRegistry: Map<string, { id: string; name: string; endpoint: string; status: string }> = new Map();
  
  // 消息队列（离线消息缓存）
  private messageQueue: Map<string, Array<{ from: string; message: string; timestamp: string; type: string }>> = new Map();

  // MCP HTTP Server 地址
  private mcpHttpEndpoint: string = 'http://127.0.0.1:3002';

  // A2A Manager 引用（用于实际转发消息给 Agent）
  private a2aManager: A2AManager | null = null;

  constructor(config: A2AHttpServerConfig = {}) {
    super();
    this.port = config.port ?? 3003;
    this.host = config.host ?? '127.0.0.1';
    
    // 加载持久化的消息队列
    this.loadPersistedMessageQueue();
  }

  /**
   * 加载持久化的消息队列
   */
  private loadPersistedMessageQueue(): void {
    try {
      const persistedQueue = getMessageQueue();
      for (const [agentId, messages] of Object.entries(persistedQueue)) {
        this.messageQueue.set(agentId, messages);
      }
      const totalMessages = Object.values(persistedQueue).reduce((sum, msgs) => sum + msgs.length, 0);
      log.info(`[A2AHttpServer] Loaded ${totalMessages} queued messages for ${Object.keys(persistedQueue).length} agents`);
    } catch (error) {
      log.error('[A2AHttpServer] Failed to load persisted message queue:', error);
    }
  }

  /**
   * 设置 A2A Manager 引用
   * 用于实际转发消息给目标 Agent
   */
  setA2AManager(manager: A2AManager): void {
    this.a2aManager = manager;
    log.info('[A2AHttpServer] A2AManager injected');
  }

  /**
   * 设置 MCP HTTP 端点
   */
  setMcpHttpEndpoint(endpoint: string): void {
    this.mcpHttpEndpoint = endpoint;
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
        log.error('[A2AHttpServer] Server error:', error);
        this.emit('error', error);
        if (!this.running) {
          reject(error);
        }
      });

      this.server.listen(this.port, this.host, () => {
        this.running = true;
        log.info(`[A2AHttpServer] Started on http://${this.host}:${this.port}`);
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
        log.info('[A2AHttpServer] Stopped');
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
   * 注册智能体
   */
  registerAgent(agent: { id: string; name: string; endpoint: string }): void {
    this.agentRegistry.set(agent.id, { ...agent, status: 'online' });
    log.info(`[A2AHttpServer] Agent registered: ${agent.name} (${agent.id})`);
  }

  /**
   * 注销智能体
   */
  unregisterAgent(agentId: string): void {
    this.agentRegistry.delete(agentId);
    log.info(`[A2AHttpServer] Agent unregistered: ${agentId}`);
  }

  /**
   * 更新智能体状态
   */
  updateAgentStatus(agentId: string, status: string): void {
    const agent = this.agentRegistry.get(agentId);
    if (agent) {
      agent.status = status;
    }
  }

  /**
   * 发送 A2A 消息给 Agent（公共方法）
   * 供 WorkflowMonitor 等服务调用
   */
  async sendA2AMessage(params: {
    type: A2AMessageType;
    sender: string;
    AGENTNAME: string;
    消息: string;
    节点ID?: string;
    工作流ID?: string;
    taskData?: {
      taskId?: string;
      taskName?: string;
      expectedDuration?: number;
      priority?: 'low' | 'normal' | 'high';
    };
    progress?: number;
    timeout?: number;
    recoveryContext?: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string; result?: any }> {
    log.info(`[A2AHttpServer] sendA2AMessage: ${params.type} to ${params.AGENTNAME}`);
    
    // 转换参数格式
    const deliveryParams = {
      type: params.type,
      sender: params.sender,
      targetAgentId: params.AGENTNAME,
      message: params.消息,
      nodeId: params.节点ID,
      workflowId: params.工作流ID,
      taskData: params.taskData,
      progress: params.progress,
      timeout: params.timeout,
      recoveryContext: params.recoveryContext,
    };
    
    return this.deliverMessageToAgent(deliveryParams);
  }

  /**
   * 同步 A2A Agents 从存储
   */
  syncAgentsFromStorage(): void {
    const agents = getA2AAgents();
    for (const agent of agents) {
      if (agent.enabled !== false) {
        this.agentRegistry.set(agent.id, {
          id: agent.id,
          name: agent.name,
          endpoint: agent.endpoint,
          status: 'online'
        });
      }
    }
    log.info(`[A2AHttpServer] Synced ${this.agentRegistry.size} agents from storage`);
  }

  // ==================== HTTP 请求处理 ====================

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';
    const method = req.method || 'GET';
    const query = parsedUrl.query;

    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // 路由请求
      if (pathname === '/a2a' && (method === 'GET' || method === 'POST')) {
        await this.handleSendMessage(req, res, query, method);
      } else if (pathname.match(/^\/a2a\/messages\/[^/]+$/) && method === 'GET') {
        await this.handleGetMessages(req, res, pathname);
      } else if (pathname === '/a2a/logs' && method === 'GET') {
        await this.handleSearchLogs(req, res, query);
      } else if (pathname.match(/^\/a2a\/logs\/[^/]+$/) && method === 'GET') {
        await this.handleGetLog(req, res, pathname);
      } else if (pathname === '/a2a/directory' && method === 'GET') {
        await this.handleGetDirectory(req, res, query);
      } else if (pathname === '/a2a/directory/send' && method === 'POST') {
        await this.handleSendDirectory(req, res);
      } else if (pathname === '/a2a/status' && method === 'GET') {
        await this.handleGetStatus(req, res);
      } else if (pathname === '/health' && method === 'GET') {
        this.sendJson(res, 200, { status: 'ok', service: 'a2a', timestamp: new Date().toISOString() });
      } else {
        this.sendError(res, 404, 'Not Found');
      }
    } catch (error) {
      log.error('[A2AHttpServer] Request error:', error);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  // ==================== 消息转发 ====================

  /**
   * 转发消息给目标 Agent
   * 通过 A2AManager 实际发送消息给 Agent
   */
  private async deliverMessageToAgent(params: {
    type: A2AMessageType;
    sender: string;
    targetAgentId: string;
    message: string;
    nodeId?: string;
    workflowId?: string;
  }): Promise<{ success: boolean; error?: string; result?: any }> {
    // 检查 A2AManager 是否可用
    if (!this.a2aManager) {
      log.warn('[A2AHttpServer] A2AManager not set, message will only be logged');
      return { success: false, error: 'A2AManager not configured' };
    }

    try {
      // 构建发送给 Agent 的任务内容
      const taskContent = this.buildAgentTaskContent(params);
      
      log.info(`[A2AHttpServer] Delivering message to agent ${params.targetAgentId}`);
      
      // 使用流式方式发送，设置超时为 5 分钟
      const result = await this.a2aManager.sendTaskSync(
        params.targetAgentId,
        taskContent,
        300000 // 5 分钟超时
      );

      if (result.status === 'completed') {
        log.info(`[A2AHttpServer] Message delivered successfully to ${params.targetAgentId}`);
        return { 
          success: true, 
          result: {
            status: result.status,
            message: result.message,
            artifacts: result.artifacts,
          }
        };
      } else {
        log.warn(`[A2AHttpServer] Message delivery failed: ${result.error || result.status}`);
        return { 
          success: false, 
          error: result.error || `Agent returned status: ${result.status}` 
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[A2AHttpServer] Failed to deliver message to ${params.targetAgentId}:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 构建发送给 Agent 的任务内容
   * 将 A2A 消息格式化为 Agent 可理解的指令
   */
  private buildAgentTaskContent(params: {
    type: A2AMessageType;
    sender: string;
    targetAgentId: string;
    message: string;
    nodeId?: string;
    workflowId?: string;
    taskData?: {
      taskId?: string;
      taskName?: string;
      expectedDuration?: number;
      priority?: 'low' | 'normal' | 'high';
    };
    progress?: number;
    timeout?: number;
    recoveryContext?: Record<string, unknown>;
  }): string {
    const lines: string[] = [
      `【${A2A_MESSAGE_DESCRIPTIONS[params.type]}】`,
      `发送者: ${params.sender}`,
      '',
      params.message,
    ];

    if (params.nodeId) {
      lines.push(`关联节点: ${params.nodeId}`);
    }

    if (params.workflowId) {
      lines.push(`工作流: ${params.workflowId}`);
    }

    // 根据消息类型添加特定提示和上下文
    switch (params.type) {
      case 'task_assign':
        if (params.taskData) {
          lines.push('');
          lines.push('--- 任务详情 ---');
          if (params.taskData.taskId) lines.push(`任务ID: ${params.taskData.taskId}`);
          if (params.taskData.taskName) lines.push(`任务名称: ${params.taskData.taskName}`);
          if (params.taskData.expectedDuration) lines.push(`预期时长: ${params.taskData.expectedDuration} 分钟`);
          if (params.taskData.priority) lines.push(`优先级: ${params.taskData.priority}`);
        }
        lines.push('');
        lines.push('请确认接受任务并开始执行。');
        break;
      
      case 'timeout_alert':
        if (params.timeout) {
          lines.push('');
          lines.push(`⚠️ 任务已超时 ${params.timeout} 分钟，请尽快处理或请求协助。`);
        }
        break;
      
      case 'recovery_info':
        if (params.recoveryContext) {
          lines.push('');
          lines.push('--- 恢复上下文 ---');
          lines.push(JSON.stringify(params.recoveryContext, null, 2));
          lines.push('');
          lines.push('请根据上下文继续执行任务。');
        }
        break;
      
      case 'task_start':
        lines.push('');
        lines.push('任务已开始执行。');
        break;
      
      case 'task_progress':
        if (params.progress !== undefined) {
          lines.push('');
          lines.push(`当前进度: ${params.progress}%`);
        }
        break;
      
      case 'task_complete':
        lines.push('');
        lines.push('✅ 任务已完成。');
        break;
      
      case 'review_request':
        lines.push('');
        lines.push('请审核上述内容并给出反馈。');
        break;
      
      case 'handover':
        lines.push('');
        lines.push('任务已交接给你，请开始执行。');
        break;
      
      case 'question':
        lines.push('');
        lines.push('请回答上述问题。');
        break;
      
      case 'status_sync':
        lines.push('');
        lines.push('请同步当前状态。');
        break;
    }

    return lines.join('\n');
  }

  /**
   * 处理发送消息
   */
  private async handleSendMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    query: url.UrlWithParsedQuery['query'],
    method: string
  ): Promise<void> {
    let params: A2ARequest;

    if (method === 'GET') {
      params = {
        type: query.type as A2AMessageType,
        sender: query.sender as string,
        AGENTNAME: query.AGENTNAME as string,
        消息: query.消息 as string,
        节点ID: query.节点ID as string,
        工作流ID: query.工作流ID as string,
      };
    } else {
      // POST - 读取请求体
      const body = await this.readBody(req);
      params = JSON.parse(body);
    }

    // 参数验证
    if (!params.type || !params.sender || !params.AGENTNAME || !params.消息) {
      this.sendJson(res, 400, {
        success: false,
        error: '缺少必要参数: type, sender, AGENTNAME, 消息',
      });
      return;
    }

    // 验证消息类型 - 使用 A2A_MESSAGE_DESCRIPTIONS 的 key 作为有效类型列表
    const validTypes = Object.keys(A2A_MESSAGE_DESCRIPTIONS) as A2AMessageType[];
    if (!validTypes.includes(params.type as A2AMessageType)) {
      this.sendJson(res, 400, {
        success: false,
        error: `无效的消息类型: ${params.type}。有效类型: ${validTypes.join(', ')}`,
      });
      return;
    }

    // 记录对话日志
    const logResult = await conversationLogger.log({
      type: params.type as A2AMessageType,
      from: params.sender,
      to: params.AGENTNAME,
      message: params.消息,
      workflowId: params.工作流ID || 'default',
      nodeId: params.节点ID,
    });

    log.info(`[A2AHttpServer] ${params.sender} → ${params.AGENTNAME}: ${params.type}`);

    // 查找目标智能体
    const targetAgent = this.agentRegistry.get(params.AGENTNAME);

    // 转发结果
    let deliveryResult: { success: boolean; error?: string; result?: any } | null = null;

    if (targetAgent) {
      // 智能体在线，实际转发消息
      deliveryResult = await this.deliverMessageToAgent({
        type: params.type as A2AMessageType,
        sender: params.sender,
        targetAgentId: params.AGENTNAME,
        message: params.消息,
        nodeId: params.节点ID,
        workflowId: params.工作流ID,
      });

      if (deliveryResult.success) {
        log.info(`[A2AHttpServer] Message delivered to ${params.AGENTNAME}`);
      } else {
        log.warn(`[A2AHttpServer] Message delivery failed: ${deliveryResult.error}`);
      }
    } else {
      // 智能体离线，缓存消息
      const queuedMessage: QueuedMessage = {
        from: params.sender,
        message: params.消息,
        timestamp: new Date().toISOString(),
        type: params.type,
        nodeId: params.节点ID,
        workflowId: params.工作流ID,
      };
      
      if (!this.messageQueue.has(params.AGENTNAME)) {
        this.messageQueue.set(params.AGENTNAME, []);
      }
      this.messageQueue.get(params.AGENTNAME)!.push(queuedMessage);
      
      // 持久化到文件系统
      addQueuedMessage(params.AGENTNAME, queuedMessage);
      
      log.info(`[A2AHttpServer] Agent ${params.AGENTNAME} offline, message queued and persisted`);
    }

    // 返回响应
    this.sendJson(res, 200, {
      success: true,
      type: params.type,
      from: params.sender,
      to: params.AGENTNAME,
      nodeId: params.节点ID,
      workflowId: params.工作流ID,
      logId: logResult.logId,
      delivered: targetAgent ? deliveryResult?.success ?? false : false,
      deliveryError: deliveryResult?.error,
      agentResult: deliveryResult?.result,
    });
  }

  /**
   * 处理获取离线消息
   */
  private async handleGetMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    const match = pathname.match(/^\/a2a\/messages\/([^/]+)$/);
    if (!match) {
      this.sendError(res, 400, 'Invalid path');
      return;
    }

    const agentId = match[1];
    const messages = this.messageQueue.get(agentId) || [];

    // 清空内存队列和持久化队列
    this.messageQueue.delete(agentId);
    clearQueuedMessages(agentId);

    this.sendJson(res, 200, {
      success: true,
      agentId,
      messages,
      count: messages.length,
    });
  }

  /**
   * 处理搜索日志
   */
  private async handleSearchLogs(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    query: url.UrlWithParsedQuery['query']
  ): Promise<void> {
    const results = await conversationLogger.search({
      workflowId: query.workflowId as string,
      participants: query.participants ? (query.participants as string).split(',') : undefined,
      type: query.type as A2AMessageType,
      nodeId: query.nodeId as string,
      limit: query.limit ? parseInt(query.limit as string, 10) : 50,
    });

    this.sendJson(res, 200, {
      success: true,
      count: results.length,
      conversations: results,
    });
  }

  /**
   * 处理获取特定日志
   */
  private async handleGetLog(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    const match = pathname.match(/^\/a2a\/logs\/([^/]+)$/);
    if (!match) {
      this.sendError(res, 400, 'Invalid path');
      return;
    }

    const logId = match[1];
    const conversation = await conversationLogger.getConversation(logId);

    if (!conversation) {
      this.sendJson(res, 404, {
        success: false,
        error: '对话日志未找到',
      });
      return;
    }

    this.sendJson(res, 200, {
      success: true,
      conversation,
    });
  }

  /**
   * 处理获取团队通讯录
   */
  private async handleGetDirectory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    query: url.UrlWithParsedQuery['query']
  ): Promise<void> {
    const baseUrl = query.baseUrl as string || this.getAddress();

    const agents = Array.from(this.agentRegistry.values()).map(agent => ({
      id: agent.id,
      name: agent.name,
      role: agent.name,
    }));

    const directory: TeamDirectory = {
      type: 'team_directory',
      projectId: (query.projectId as string) || 'default',
      MCP_URL: `${this.mcpHttpEndpoint}/mcp`,
      A2A_URL: `${baseUrl}/a2a`,
      agents,
      messageTypes: Object.entries(A2A_MESSAGE_DESCRIPTIONS).map(([type, description]) => ({
        type: type as A2AMessageType,
        description,
      })),
      usage: {
        MCP调用: {
          description: '调用外部工具',
          format: 'MCP_URL/servers/{serverId}/{toolName}',
          example: `${this.mcpHttpEndpoint}/mcp/filesystem/writeFile`,
        },
        A2A通讯: {
          description: '与其他智能体对话',
          format: 'A2A_URL?type=类型&sender=你的ID&AGENTNAME=目标ID&消息="内容"',
          example: `${baseUrl}/a2a?type=talktoagent&sender=alice&AGENTNAME=carol&消息="请审核"`,
        },
      },
    };

    this.sendJson(res, 200, directory);
  }

  /**
   * 处理发送团队通讯录
   */
  private async handleSendDirectory(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await this.readBody(req);
    const { projectId, agents: agentIds } = JSON.parse(body);

    if (!agentIds || !Array.isArray(agentIds)) {
      this.sendJson(res, 400, {
        success: false,
        error: '缺少 agents 参数',
      });
      return;
    }

    // 生成通讯录
    const agents = agentIds.map((id: string) => {
      const agent = this.agentRegistry.get(id);
      return agent || { id, name: id, role: id };
    });

    const directory: TeamDirectory = {
      type: 'team_directory',
      projectId: projectId || 'default',
      MCP_URL: `${this.mcpHttpEndpoint}/mcp`,
      A2A_URL: `${this.getAddress()}/a2a`,
      agents,
      messageTypes: Object.entries(A2A_MESSAGE_DESCRIPTIONS).map(([type, description]) => ({
        type: type as A2AMessageType,
        description,
      })),
      usage: {
        MCP调用: {
          description: '调用外部工具',
          format: 'MCP_URL/servers/{serverId}/{toolName}',
          example: `${this.mcpHttpEndpoint}/mcp/filesystem/writeFile`,
        },
        A2A通讯: {
          description: '与其他智能体对话',
          format: 'A2A_URL?type=类型&sender=你的ID&AGENTNAME=目标ID&消息="内容"',
          example: `${this.getAddress()}/a2a?type=talktoagent&sender=alice&AGENTNAME=carol&消息="请审核"`,
        },
      },
    };

    log.info(`[A2AHttpServer] Team directory generated for ${agents.length} agents`);

    this.sendJson(res, 200, {
      success: true,
      projectId,
      agentCount: agents.length,
      directory,
    });
  }

  /**
   * 处理获取状态
   */
  private async handleGetStatus(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const agents = Array.from(this.agentRegistry.entries()).map(([id, agent]) => ({
      id,
      name: agent.name,
      status: agent.status,
      endpoint: agent.endpoint,
    }));

    this.sendJson(res, 200, {
      success: true,
      service: 'a2a-http-server',
      port: this.port,
      running: this.running,
      agentCount: agents.length,
      queuedMessages: this.messageQueue.size,
      agents,
    });
  }

  // ==================== 工具方法 ====================

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

  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    this.sendJson(res, statusCode, { success: false, error: message });
  }
}