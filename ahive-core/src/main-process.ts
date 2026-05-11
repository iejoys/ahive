/**
 * AHIVECORE 主进程入口
 *
 * 进程级隔离架构：
 * - 主进程：调度器 + 监控器 + 消息路由
 * - 子进程：CODEX、OPENCLAW 各自独立运行
 *
 * 特点：
 * - 一个智能体崩溃不影响其他
 * - 自动重启崩溃的进程
 * - 进程间通过 IPC 通讯
 */

import { AgentProcessManager, AgentProcessStatus } from './process-manager/AgentProcessManager.js';
import { registerLSPHandlers } from './process-manager/lsp-ipc-handler.js';
import { getLSPClientManager } from './lsp/index.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { logger } from './utils/index.js';

// ==================== 配置 ====================

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 18790;
const HOST = process.env.HOST || '0.0.0.0';

// ==================== 主进程类 ====================

class MainProcess {
  private processManager: AgentProcessManager;
  private httpServer: any;
  private isShuttingDown = false;

  constructor() {
    this.processManager = new AgentProcessManager();
    this.setupEventHandlers();
    this.setupShutdownHandlers();
  }

  /**
   * 设置进程管理器事件处理
   */
  private setupEventHandlers(): void {
    this.processManager.on('agent:ready', (data: { id: string; type: string }) => {
      logger.info(`[MainProcess] 智能体就绪: ${data.id} (${data.type})`);
    });

    this.processManager.on('agent:exit', (data: { id: string; code: number | null; signal: string | null }) => {
      logger.warn(`[MainProcess] 智能体退出: ${data.id}, code=${data.code}, signal=${data.signal}`);
    });

    this.processManager.on('agent:restarted', (data: { id: string; count: number }) => {
      logger.info(`[MainProcess] 智能体重启成功: ${data.id}, 第 ${data.count} 次`);
    });

    this.processManager.on('agent:max_restarts', (data: { id: string; count: number }) => {
      logger.error(`[MainProcess] 智能体重启次数过多: ${data.id}, 已重启 ${data.count} 次`);
    });

    this.processManager.on('message', (data: { from: string; message: any }) => {
      logger.debug(`[MainProcess] 收到消息: from=${data.from}`);
    });
  }

  /**
   * 启动主进程
   */
  async start(): Promise<void> {
    logger.info('[MainProcess] 🚀 启动 AHIVECORE 主进程...');

    // 0. 初始化 LSP Client Manager
    await this.initializeLSP();

    // 1. 启动默认智能体
    await this.spawnDefaultAgents();

    // 2. 启动 HTTP 服务器（用于客户端通讯）
    await this.startHttpServer();

    // 3. 启动心跳检测
    this.processManager.startHeartbeat(10000);

    logger.info('[MainProcess] ✅ AHIVECORE 主进程启动完成');
    logger.info(`[MainProcess] 🌐 HTTP 服务: http://${HOST}:${PORT}`);
  }

  /**
   * 初始化 LSP Client Manager
   */
  private async initializeLSP(): Promise<void> {
    try {
      const lspManager = getLSPClientManager();
      await lspManager.initialize();

      // 设置到 ProcessManager，供子进程共享
      this.processManager.setLSPClientManager({
        handleRequest: (request) => lspManager.handleRequest(request),
        getStatus: () => lspManager.getStatus(),
        enableServer: (name) => lspManager.enableServer(name),
        disableServer: (name) => lspManager.disableServer(name),
      });

      // 注册 IPC 处理器
      registerLSPHandlers(this.processManager);

      logger.info('[MainProcess] ✅ LSP Client Manager 初始化完成');
    } catch (error: any) {
      logger.error(`[MainProcess] ⚠️ LSP Client Manager 初始化失败: ${error.message}`);
      // LSP 初始化失败不应该阻止主进程启动
    }
  }

  /**
   * 启动默认智能体
   */
  private async spawnDefaultAgents(): Promise<void> {
    try {
      // 启动 AHIVE-CODER 智能体
      await this.processManager.spawnAgent('ahive-coder-default', 'ahive-coder', {
        modelConfig: {
          provider: 'openai',
          name: 'gpt-4',
        },
      });
      logger.info('[MainProcess] AHIVE-CODER 智能体已启动');
    } catch (error: any) {
      logger.error(`[MainProcess] AHIVE-CODER 智能体启动失败: ${error.message}`);
    }

    try {
      // 启动 AHIVE-WORKER 智能体
      await this.processManager.spawnAgent('ahive-worker-default', 'ahive-worker', {
        modelConfig: {
          provider: 'openai',
          name: 'gpt-4',
        },
      });
      logger.info('[MainProcess] AHIVE-WORKER 智能体已启动');
    } catch (error: any) {
      logger.error(`[MainProcess] AHIVE-WORKER 智能体启动失败: ${error.message}`);
    }
  }

  /**
   * 启动 HTTP 服务器
   */
  private async startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        // CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // 路由处理
        try {
          await this.handleRequest(req, res);
        } catch (error: any) {
          logger.error('[MainProcess] HTTP 请求处理错误:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });

      this.httpServer.listen(PORT, HOST, () => {
        resolve();
      });

      this.httpServer.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`[MainProcess] 端口 ${PORT} 已被占用`);
        }
        reject(error);
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // 健康检查
    if (url === '/health' && method === 'GET') {
      const status = this.processManager.getStatus();
      const processes: any = {};
      status.forEach((info, id) => {
        processes[id] = {
          type: info.type,
          status: info.status,
          restartCount: info.restartCount,
          uptime: Date.now() - info.startTime,
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        processes,
      }));
      return;
    }

    // 状态检查
    if (url === '/status' && method === 'GET') {
      const status = this.processManager.getStatus();
      const processes: any[] = [];
      status.forEach((info, id) => {
        processes.push({
          id,
          type: info.type,
          status: info.status,
          restartCount: info.restartCount,
          uptime: Date.now() - info.startTime,
        });
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processes }));
      return;
    }

    // 聊天接口
    if (url === '/chat' && method === 'POST') {
      const body = await this.readBody(req);
      const result = await this.handleChat(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 发送消息给智能体
    if (url.startsWith('/agent/') && method === 'POST') {
      const parts = url.split('/');
      const agentId = parts[2];
      const action = parts[3] || 'message';
      
      const body = await this.readBody(req);
      
      try {
        const result = await this.processManager.call(agentId, action, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    // 智能体间通讯
    if (url === '/a2a' && method === 'POST') {
      const body = await this.readBody(req);
      const { from, to, message } = body;
      
      if (!from || !to || !message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '缺少 from, to 或 message' }));
        return;
      }
      
      this.processManager.sendTo(from, to, message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'sent' }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  /**
   * 处理聊天请求
   */
  private async handleChat(body: any): Promise<any> {
    const { agentId, agentType, message, systemPrompt, sessionMessages, modelConfig } = body;

    // 确定目标智能体
    let targetId = agentId;
    if (!targetId) {
      targetId = agentType === 'ahive-worker' ? 'ahive-worker-default' : 'ahive-coder-default';
    }

    // 检查智能体是否存在
    const status = this.processManager.getAgentStatus(targetId);
    if (!status) {
      // 如果不存在，尝试启动
      const type = agentType || 'ahive-coder';
      await this.processManager.spawnAgent(targetId, type, { modelConfig });
    }

    // 调用智能体
    try {
      const result = await this.processManager.call(targetId, 'execute', {
        userMessage: message,
        systemPrompt: systemPrompt || '你是一个有用的AI助手。',
        sessionMessages,
        modelConfig,
      });
      
      return {
        success: true,
        agentId: targetId,
        ...result,
      };
    } catch (error: any) {
      return {
        success: false,
        agentId: targetId,
        error: error.message,
      };
    }
  }

  /**
   * 读取请求体
   */
  private readBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * 设置关闭处理器
   */
  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      logger.info('[MainProcess] 🛑 正在关闭...');
      
      // 关闭 HTTP 服务器
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer.close(() => resolve());
        });
      }
      
      // 关闭所有子进程
      await this.processManager.stopAll();
      
      logger.info('[MainProcess] 👋 已关闭');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (error) => {
      logger.error('[MainProcess] 未捕获的异常:', error);
      shutdown();
    });
  }
}

// ==================== 启动 ====================

async function main() {
  const mainProcess = new MainProcess();
  await mainProcess.start();
}

main().catch((error) => {
  logger.error('[MainProcess] 启动失败:', error);
  process.exit(1);
});