/**
 * AHIVECORE 进程隔离模式启动入口
 *
 * 使用方式：
 *   npm run start:isolated
 *
 * 架构：
 *   主进程 (调度器)
 *     ├── CODEX 子进程 (独立)
 *     └── OPENCLAW 子进程 (独立)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AgentProcessManager } from './process-manager/AgentProcessManager.js';
import { registerLSPHandlers } from './process-manager/lsp-ipc-handler.js';
import { getLSPClientManager } from './lsp/index.js';
import { IsolatedExecutor } from './executor/isolated-executor.js';
import { registerRoutes } from './routes/index.js';
import { App } from './core/index.js';
import { logger } from './utils/index.js';
import type { Server } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==================== 配置 ====================

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 18790;
const HOST = process.env.HOST || '0.0.0.0';
const AGENTS_CONFIG_PATH = path.join(__dirname, '../config/agents.json');

// ==================== 主服务类 ====================

class IsolatedAHIVECORE {
  private processManager: AgentProcessManager;
  private executor: IsolatedExecutor;
  private httpServer: Server | null = null;
  private app: App;
  private isShuttingDown = false;

  constructor() {
    // 创建进程管理器
    this.processManager = new AgentProcessManager({
      maxRestarts: 3,
      restartWindow: 60000,
    });

    // 创建 App 实例（用于 Provider、模型管理等功能）
    this.app = new App();

    // 创建隔离执行器
    this.executor = new IsolatedExecutor(this.processManager);

    // 设置关闭处理器
    this.setupShutdownHandlers();
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    logger.info('[Isolated] 🚀 启动 AHIVECORE (进程隔离模式)...');

    // 0. 初始化 LSP Client Manager
    await this.initializeLSP();

    // 0.5 先设置 processManager 到 app（WorkflowMessageHandler 需要它）
    this.app.processManager = this.processManager;

    // 1. 初始化 App（Provider、模型等）
    await this.app.initialize();
    logger.info('[Isolated] ✅ App 初始化完成');

    // 🆕 设置 LLM Service 到 ProcessManager（让子进程可以共享主进程的 Provider）
    this.processManager.setLLMService({
      chat: async (messages, config) => {
        const response = await this.app.providerManager.chat(messages, config);
        return {
          content: response.content,
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
        };
      },
    });
    logger.info('[Isolated] ✅ 已设置 LLM Service 到 ProcessManager');

    // 为主进程中的 CORE 智能体设置 agentController
    // 这样 CORE 可以使用 list_agents、send_message 等工具
    await this.setupMainAgentController();

    // 🆕 设置 CORE 消息处理器 - 让子进程可以向 CORE 发送消息
    this.processManager.setCoreMessageHandler(async (from, message, type) => {
      try {
        logger.info(`[Isolated] 收到发给 CORE 的消息: from=${from}, type=${type || 'task'}`);

        // 调用 CORE 的 chat 方法处理消息
        const result = await this.app.ahivecore.chat(message);

        return { success: true, content: result.content };
      } catch (error: any) {
        logger.error(`[Isolated] CORE 消息处理失败:`, error);
        return { success: false, error: error.message || 'CORE 处理消息失败' };
      }
    });

    // 🆕 设置 WEBOT 消息处理器 - 让子进程可以向 ahive-webot 发送消息
    this.processManager.setWebotMessageHandler(async (from, message, type, metadata) => {
      try {
        logger.info(`[Isolated] 收到发给 WEBOT 的消息: from=${from}, type=${type || 'task'}, metadata=${JSON.stringify(metadata)}`);

        // 获取 webotAgent
        const webotAgent = this.app.unifiedAgentSystem.getWebotAgent();
        if (!webotAgent) {
          logger.warn(`[Isolated] WEBOT 智能体未初始化`);
          return { success: false, error: 'WEBOT 智能体未初始化' };
        }

        // 清理消息：去掉 AGENT COMMUNICATION PROTOCOL 提示词
        const cleanMessage = message.replace(/\[AGENT COMMUNICATION PROTOCOL\].*\[END PROTOCOL\]\s*/s, '').trim();
        logger.info(`[Isolated] 清理后的消息: ${cleanMessage.substring(0, 100)}...`);

        // 从 metadata 中提取 chatId（用于回复到正确的微信用户）
        const chatId = metadata?.chatId as string | undefined;
        logger.info(`[Isolated] 从 metadata 提取 chatId: ${chatId || '未指定'}`);

        // 调用 sendToWecom 发送消息到企业微信（传递 chatId 和 fromAgentId）
        await webotAgent.sendToWecom(chatId, cleanMessage, from);

        return { success: true, content: '消息已发送到企业微信' };
      } catch (error: any) {
        logger.error(`[Isolated] WEBOT 消息处理失败:`, error);
        return { success: false, error: error.message || 'WEBOT 处理消息失败' };
      }
    });

    // 转发 agent_chat 事件到全局事件总线
    this.processManager.on('agent_chat', (data: any) => {
      logger.info(`[Isolated] 转发 agent_chat 到 eventBus: ${data.fromAgentName} → ${data.toAgentName}`);
      this.app.eventBus.emit('agent_chat', data);
    });

    // 2. 从 agents.json 加载并启动智能体
    await this.spawnAgentsFromConfig();

    // 3. 创建 HTTP 服务器
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const handled = await registerRoutes(req, res, this.executor, this.app);
        if (!handled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        }
      } catch (error) {
        logger.error('[Isolated] 请求处理错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    });

    // 4. 启动监听
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(PORT, HOST, () => {
        resolve();
      });

      this.httpServer!.on('error', (error: Error & { code?: string }) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`[Isolated] 端口 ${PORT} 已被占用`);
        }
        reject(error);
      });
    });

    // 5. 启动心跳检测
    this.processManager.startHeartbeat(10000);

    logger.info('[Isolated] ✅ AHIVECORE 启动完成');
    logger.info(`[Isolated] 🌐 HTTP 服务: http://${HOST}:${PORT}`);
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

      logger.info('[Isolated] ✅ LSP Client Manager 初始化完成');
    } catch (error: any) {
      logger.error(`[Isolated] ⚠️ LSP Client Manager 初始化失败: ${error.message}`);
      // LSP 初始化失败不应该阻止主进程启动
    }
  }

  /**
   * 从 agents.json 加载并启动智能体
   */
  private async spawnAgentsFromConfig(): Promise<void> {
    // 读取配置文件
    let agentsConfig: any = { agents: [] };

    try {
      if (fs.existsSync(AGENTS_CONFIG_PATH)) {
        const content = fs.readFileSync(AGENTS_CONFIG_PATH, 'utf-8');
        agentsConfig = JSON.parse(content);
        logger.info(`[Isolated] 📂 从 agents.json 加载 ${agentsConfig.agents?.length || 0} 个智能体配置`);
      }
    } catch (error) {
      logger.warn('[Isolated] 读取 agents.json 失败，使用默认配置:', error);
    }

    const agents = agentsConfig.agents || [];

    // 获取当前 Provider 配置
    const providerConfig = this.app.providerManager?.getCurrentConfig();
    const defaultModelConfig = {
      provider: providerConfig?.type || 'openai',
      name: providerConfig?.config?.apiModel || providerConfig?.config?.modelName || 'gpt-4',
      temperature: providerConfig?.config?.temperature || 0.7,
      maxTokens: providerConfig?.config?.maxTokens || 4096,
      apiKey: providerConfig?.config?.apiKey,
      baseUrl: providerConfig?.config?.apiEndpoint,
    };
    //logger.info('[Isolated] key=${defaultModelConfig.apikey}');
    // 如果没有配置智能体，创建默认的
    if (agents.length === 0) {
      logger.info('[Isolated] 没有持久化的智能体，创建默认智能体...');

      try {
        await this.processManager.spawnAgent('default', 'ahive-coder', {
          modelConfig: defaultModelConfig,
        });
        logger.info('[Isolated] ✅ 默认智能体已启动 (default)');
      } catch (error) {
        logger.error('[Isolated] 默认智能体启动失败:', error);
      }
      return;
    }

    // 启动所有持久化的智能体
    for (const agent of agents) {
      try {
        // 合并模型配置
        const modelConfig = {
          ...defaultModelConfig,
          ...(agent.model || {}),
        };

        await this.processManager.spawnAgent(agent.id, agent.type || 'ahive-coder', {
          modelConfig,
          nickname: agent.nickname,
          role: agent.role,
        });

        logger.info(`[Isolated] ✅ 智能体已启动: ${agent.id} (${agent.type || 'ahive-coder'})`);
      } catch (error) {
        logger.error(`[Isolated] 智能体 ${agent.id} 启动失败:`, error);
      }
    }
  }

  /**
   * 为主进程中的智能体（如 CORE）设置 agentController
   * 这样主进程中的智能体可以使用 list_agents、send_message 等工具
   */
  private async setupMainAgentController(): Promise<void> {
    const { setAgentController } = await import('./executor/builtin-tools.js');

    const mainAgentController = {
      spawnAgent: async (parentId: string, options: any): Promise<string> => {
        // 直接调用 AgentProcessManager 的分身创建功能
        return await this.processManager.spawnChildAgent(parentId, options);
      },

      waitAgent: async (childId: string, timeout?: number): Promise<{ status: string; content?: string; error?: string }> => {
        return await this.processManager.waitChildAgent(childId, timeout);
      },

      terminateAgent: (childId: string): void => {
        this.processManager.terminateChildAgent(childId);
      },

      getMainAgentId: (): string | null => {
        return this.app.ahivecore?.getAgentId() || null;
      },

      getActiveAgent: (): string | null => {
        return this.app.ahivecore?.getAgentId() || null;
      },

      getAllStatus: async (): Promise<Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>> => {
        // 直接从 AgentProcessManager 获取所有智能体状态
        const agents = this.processManager.getAllAgentStatusArray();
        const map = new Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>();
        for (const agent of agents) {
          map.set(agent.id, {
            type: agent.type,
            status: agent.status,
            role: agent.role,
            nickname: agent.nickname,
            model: agent.model,
          });
        }
        return map;
      },

      sendTo: (fromId: string, toId: string, content: string, type?: string): void => {
        // 发送消息（不等待回复）
        this.processManager.sendTo(fromId, toId, { content, type });
      },

      sendAndWait: async (fromId: string, toId: string, content: string, type?: string, timeout?: number): Promise<{ success: boolean; content?: string; error?: string }> => {
        // 发送消息并等待回复
        return await this.processManager.sendAndWait(fromId, toId, content, type, timeout);
      },

      getConcurrencyStatus: (): { active: number; max: number; available: number } => {
        return this.processManager.getConcurrencyStatus();
      },

      getConcurrencyStatusAsync: async (): Promise<{ active: number; max: number; available: number }> => {
        return this.processManager.getConcurrencyStatus();
      },

      createMainAgent: (type?: 'ahive-worker' | 'ahive-coder'): string => {
        // CORE 智能体已存在，返回其 ID
        return this.app.ahivecore?.getAgentId() || '';
      },
    };

    setAgentController(mainAgentController);
    logger.info('[Isolated] ✅ 已为主进程智能体设置 agentController');

    // 🆕 为 WebotAgent 注入 agentController
    const webotAgent = this.app.unifiedAgentSystem.getWebotAgent();
    if (webotAgent) {
      webotAgent.setAgentController(mainAgentController);
      logger.info('[Isolated] ✅ 已为 WebotAgent 设置 agentController');
    }
  }

  /**
   * 设置关闭处理器
   */
  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      logger.info('[Isolated] 🛑 正在关闭...');

      // 关闭 HTTP 服务器
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => resolve());
        });
      }

      // 停止所有子进程
      await this.processManager.stopAll();

      // 关闭 App
      await this.app.shutdown();

      logger.info('[Isolated] 👋 已关闭');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// ==================== 启动 ====================

async function main() {
  const service = new IsolatedAHIVECORE();
  await service.start();
}

main().catch((error) => {
  logger.error('[Isolated] 启动失败:', error);
  process.exit(1);
});