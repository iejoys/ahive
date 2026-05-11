/**
 * AHIVE 应用核心类
 * 
 * 统一管理全局状态和依赖
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { createConfigManager } from '../config/index.js';
import { getProviderManager, type ProviderManager } from '../providers/index.js';
import { OpenAIProvider } from '../providers/openai-provider.js';
import { createMemoryStore } from '../memory/index.js';
import {
  initializeNewMemorySystem,
  getMemoryManager,
  closeNewMemorySystem,
  setMemoryLLMService,
} from '../memory/new-integration.js';
import { configStore } from '../storage/config-store.js';
import { logger, Logger } from '../utils/index.js';
import {
  UnifiedAgentSystem,
  unifiedAgentSystem,
} from '../agents/core/UnifiedAgentSystem.js';
import { AhiveCoderExecutor, createAhiveCoderExecutor } from '../agents/ahive-coder/index.js';
import { getSessionMemory, SessionMemory } from '../memory/session-memory.js';
import { ToolRegistry, ToolLoopExecutor, getGlobalToolRegistry } from '../executor/tool-system.js';
import { createBuiltinTools, createAhiveCoderTools, createAhivecoreTools } from '../executor/builtin-tools.js';
import type { GGUFClient, OllamaClient } from '../agents/index.js';
import { AHIVECore, initializeAHIVECore } from './ahivecore.js';
import { HookEngine } from '../hooks/index.js';
import { startWSClient, startMemoryMonitor, stopWSClient, stopMemoryMonitor, getWSClient } from '../monitoring/index.js';
import { initializeSandboxConfig } from '../sandbox/SandboxExecutor.js';
import { WorkflowContextManager, getWorkflowContextManager } from '../services/WorkflowContextManager.js';
import { WorkflowMessageHandler, getWorkflowMessageHandler } from '../services/WorkflowMessageHandler.js';

import { createServer, type Server } from 'http';
import type { AgentExecutor } from '../executor/interface.js';
import type { AppConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * AHIVE 应用核心
 */
export class App {
  // 配置
  public config: AppConfig;

  // 执行器
  private executor: AgentExecutor | null = null;

  // 核心组件
  public providerManager!: ProviderManager;
  public unifiedAgentSystem!: UnifiedAgentSystem;
  public ahiveCoderExecutor!: AhiveCoderExecutor;
  public sessionMemory!: SessionMemory;
  public toolRegistry!: ToolRegistry;
  public toolLoopExecutor!: ToolLoopExecutor;
  public processManager: any = null; // 进程管理器（隔离模式使用）
  public hookEngine!: HookEngine; // Hook 引擎
  
  // AHIVECORE 核心智能体
  public ahivecore!: AHIVECore;
  
  // 工作流上下文管理器
  public workflowContextManager!: WorkflowContextManager;
  
  // 全局事件总线（用于广播 agent_chat 等事件）
  public eventBus: EventEmitter;

  // 模型客户端
  public ggufClient: GGUFClient | null = null;
  public ollamaClient: OllamaClient | null = null;

  // 状态
  private initialized = false;

  constructor(config: AppConfig = {}) {
    this.config = {
      port: parseInt(process.env.AHIVE_PORT || '18790'),
      host: process.env.AHIVE_HOST || '127.0.0.1',
      modelMode: (process.env.MODEL_MODE as 'embedded' | 'ollama') || 'embedded',
      ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
      ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
      ...config,
    };
    // 初始化全局事件总线
    this.eventBus = new EventEmitter();
  }

  /**
   * 设置执行器
   */
  setExecutor(executor: AgentExecutor): void {
    this.executor = executor;
  }

  /**
   * 获取执行器
   */
  getExecutor(): AgentExecutor {
    if (!this.executor) {
      throw new Error('[App] 执行器未设置，请先调用 setExecutor()');
    }
    return this.executor;
  }

  /**
   * 创建 HTTP 服务器
   */
  createHttpServer(): Server {
    return createServer();
  }

  /**
   * 初始化应用
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('[App] 应用已初始化，跳过');
      return;
    }

    logger.info('[App] 🚀 初始化 AHIVE Core...');

    try {
      // 1. 初始化配置管理器
      logger.info('[App] 初始化配置管理器...');
      const configManager = await createConfigManager();

      // 2. 初始化 Provider Manager
      logger.info('[App] 初始化 Provider Manager...');
      this.providerManager = getProviderManager();
      await this.providerManager.initialize();

      // 3. 初始化记忆系统
      logger.info('[App] 初始化记忆系统...');
      await initializeNewMemorySystem();
      const memoryStore = createMemoryStore();

      // 3.1 初始化压缩专用 LLM（从 providers.json 读取 compactorLLM 配置）
      try {
        const providersJson = JSON.parse(await fs.promises.readFile('./config/providers.json', 'utf-8'));
        const compactorLLMConfig = providersJson?.compactorLLM;
        if (compactorLLMConfig && compactorLLMConfig.apiEndpoint && compactorLLMConfig.apiKey && compactorLLMConfig.apiModel) {
          const compactorProvider = new OpenAIProvider({
            type: 'openai',
            apiEndpoint: compactorLLMConfig.apiEndpoint,
            apiKey: compactorLLMConfig.apiKey,
            apiModel: compactorLLMConfig.apiModel,
            temperature: compactorLLMConfig.temperature ?? 0.3,
            maxTokens: compactorLLMConfig.maxTokens ?? 4096,
            timeout: compactorLLMConfig.timeout ?? 60000,
          });
          setMemoryLLMService(compactorProvider);
          logger.info(`[App] 压缩专用 LLM 已配置: ${compactorLLMConfig.apiModel} @ ${compactorLLMConfig.apiEndpoint}`);
        } else {
          logger.info('[App] 未配置 compactorLLM，压缩将使用简单摘要（不调用 LLM）');
        }
      } catch (err: any) {
        logger.warn(`[App] 压缩 LLM 配置读取失败，将使用简单摘要: ${err?.message}`);
      }

      // 4. 初始化会话记忆
      logger.info('[App] 初始化会话记忆...');
      this.sessionMemory = getSessionMemory();

      // 5. 初始化工具系统
      logger.info('[App] 初始化工具系统...');
      this.toolRegistry = getGlobalToolRegistry();
      // 注册内置工具（AHIVECORE 核心智能体需要）
      const builtinTools = createBuiltinTools();
      this.toolRegistry.registerAll(builtinTools);
      logger.info(`[App] 已注册 ${builtinTools.length} 个内置工具`);
      this.toolLoopExecutor = new ToolLoopExecutor(this.toolRegistry);

      // 5.1 设置工具到 Provider（支持 Function Calling）
      const toolDefinitions = builtinTools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: this.zodToJsonSchema(tool.parameters),
        },
      }));
      this.providerManager.setTools(toolDefinitions);
      logger.info(`[App] 已设置 ${toolDefinitions.length} 个工具到 Provider`);

      // 6. 初始化统一智能体系统
      logger.info('[App] 初始化统一智能体系统...');
      this.unifiedAgentSystem = unifiedAgentSystem;
      
      // 🆕 注入 LLM 服务到 UnifiedAgentSystem
      this.unifiedAgentSystem.setLLMService({
        chat: async (messages, config) => {
          const response = await this.providerManager.chat(messages, config);
          return {
            content: response.content,
            toolCalls: response.toolCalls,
            finishReason: response.finishReason,
          };
        },
      });
      logger.info('[App] 已注入 LLM 服务到 UnifiedAgentSystem');

      // 7. 初始化 Hook 引擎（先于执行器）
      logger.info('[App] 初始化 Hook 引擎...');
      this.hookEngine = new HookEngine();
      const hookDiscoveryResult = await this.hookEngine.discover(process.cwd());
      if (hookDiscoveryResult.handlers.length > 0) {
        logger.info(`[App] 已发现 ${hookDiscoveryResult.handlers.length} 个 Hook 处理器`);
      } else {
        logger.info('[App] 未发现 Hook 配置 (hooks.json)');
      }

      // 8. 初始化 CODEX 执行器（传入 Hook 引擎）
      logger.info('[App] 初始化 CODEX 执行器...');
      
      // 从配置文件读取压缩参数
      const providersConfig = JSON.parse(await fs.promises.readFile('./config/providers.json', 'utf-8'));
      const currentConfig = providersConfig?.currentConfig || {};
      
      const executorConfig = {
        contextWindow: currentConfig.contextWindow || currentConfig.maxTokens || 200000,
        autoCompactRatio: currentConfig.autoCompactRatio || 0.9,
        autoCompactTokenLimit: currentConfig.autoCompactTokenLimit,
      };
      
      // 🔍 调试日志：显示配置加载详情
      logger.debug('执行器配置加载:', {
        currentConfig,
        contextWindow: executorConfig.contextWindow,
        autoCompactRatio: executorConfig.autoCompactRatio,
        autoCompactTokenLimit: executorConfig.autoCompactTokenLimit,
        calculatedCompactLimit: Math.floor(executorConfig.contextWindow * executorConfig.autoCompactRatio),
      });
      
      // 8.0 同步压缩参数到 MemoryCompactor，确保两套系统阈值一致
      const memoryManagerForCompactor = getMemoryManager();
      if (memoryManagerForCompactor) {
        memoryManagerForCompactor.getCompactor().updateConfig({
          contextWindow: executorConfig.contextWindow,
          compactRatio: executorConfig.autoCompactRatio,
        });
        logger.info(`[App] MemoryCompactor 参数已同步: contextWindow=${executorConfig.contextWindow}, compactRatio=${executorConfig.autoCompactRatio}`);
      }
      
      // 8.1 为 AHIVE-CODER 创建专用工具注册表
      const ahiveCoderToolRegistry = new ToolRegistry();
      const ahiveCoderTools = await createAhiveCoderTools();
      ahiveCoderToolRegistry.registerAll(ahiveCoderTools);
      logger.info(`[App] AHIVE-CODER 专用工具注册表: ${ahiveCoderTools.length} 个工具`);
      
      this.ahiveCoderExecutor = createAhiveCoderExecutor(ahiveCoderToolRegistry, executorConfig, this.hookEngine);
      logger.info(`[App] AHIVE-CODER 执行器配置: contextWindow=${executorConfig.contextWindow}, autoCompactRatio=${executorConfig.autoCompactRatio}`);

      // 8.2 为 AHIVECORE 创建专用工具注册表（包含页面控制、工作流编排等指挥官专用工具）
      const { createAhivecoreTools } = await import('../executor/builtin-tools.js');
      const ahivecoreToolRegistry = new ToolRegistry();
      const ahivecoreTools = createAhivecoreTools();
      ahivecoreToolRegistry.registerAll(ahivecoreTools);
      logger.info(`[App] AHIVECORE 专用工具注册表: ${ahivecoreTools.length} 个工具（含页面控制、工作流编排）`);
      
      // 8.2.1 将 AHIVECORE 工具设置到 Provider（支持 Function Calling）
      const ahivecoreToolDefinitions = ahivecoreTools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: this.zodToJsonSchema(tool.parameters),
        },
      }));
      this.providerManager.setTools(ahivecoreToolDefinitions);
      logger.info(`[App] 已设置 ${ahivecoreToolDefinitions.length} 个 AHIVECORE 工具到 Provider（含 page_navigate）`);
      
      // 8.3 创建 AHIVECORE 专用执行器
      const ahivecoreExecutor = createAhiveCoderExecutor(ahivecoreToolRegistry, executorConfig, this.hookEngine);

      // 9. 初始化 AHIVECORE 核心智能体（使用专用执行器）
      logger.info('[App] 初始化 AHIVECORE 核心智能体...');
      this.ahivecore = await initializeAHIVECore({
        agentSystem: this.unifiedAgentSystem,
        ahiveCoderExecutor: ahivecoreExecutor,  // 使用 AHIVECORE 专用执行器
        providerManager: this.providerManager,
      });

      // 9.1 初始化 WorkflowOrchestrator（设置工作流保存目录）
      logger.info('[App] 初始化 WorkflowOrchestrator...');
      const { initializeWorkflowOrchestrator } = await import('../orchestrator/WorkflowOrchestrator.js');
      // 工作流保存到 ahive-electron 的数据目录（前端通过 Electron IPC 加载）
      const workflowFolder = path.resolve('../ahive-electron/data/workflows');
      initializeWorkflowOrchestrator(this.providerManager, workflowFolder);
      logger.info(`[App] WorkflowOrchestrator 已初始化，工作流目录: ${workflowFolder}`);

      this.initialized = true;
      logger.info('[App] ✅ AHIVE Core 初始化完成');
      logger.info('[App] 🎯 AHIVECORE 智能体ID: ' + this.ahivecore.getAgentId());

      // 10. 启动监控模块
      logger.info('[App] 启动监控模块...');
      startWSClient();
      startMemoryMonitor();
      logger.info('[App] ✅ 监控模块已启动 (WebSocket + MemoryMonitor)');

      // 10.5 初始化工作流消息处理器（复用 WSClient 连接）
      const workflowHandler = getWorkflowMessageHandler(this.processManager);
      workflowHandler.initialize();
      logger.info('[App] ✅ 工作流消息处理器已启动');

      // 11. 建立全局事件总线 → WebSocket 桥接
      this.setupEventBusBridge();

      // 12. 建立工作流上下文 → Agent 项目配置注入桥接
      this.setupWorkflowContextBridge();

    } catch (error) {
      logger.error('[App] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 建立事件总线到 WebSocket 的全局桥接
   * 监听 eventBus 上的事件并推送到 WebSocket 服务器
   */
  private setupEventBusBridge(): void {
    const wsClient = getWSClient();

    // 监听 agent_chat 事件并推送到 WebSocket
    this.eventBus.on('agent_chat', (data: any) => {
      logger.info(`[App] eventBus agent_chat → WSClient: ${data.fromAgentName} → ${data.toAgentName}`);
      wsClient.sendAgentChat(data);
    });

    logger.info('[App] ✅ 事件总线 → WebSocket 桥接已建立');
  }

  /**
   * 建立工作流上下文 → Agent 项目配置注入桥接
   * 监听 WorkflowContextManager 的 context-update 事件
   * 将项目配置提示词注入到对应的 Agent
   */
  private setupWorkflowContextBridge(): void {
    const workflowContextManager = getWorkflowContextManager();

    // 监听项目配置更新事件
    // 使用 EventEmitter 的 on 方法
    (workflowContextManager as any).on('context-update', (data: {
      workflowId: string;
      agentId: string;
      type: 'public' | 'private';
      content: string;
      version: number;
      mtime: number;
    }) => {
      logger.info(`[App] 工作流上下文更新: workflowId=${data.workflowId}, agentId=${data.agentId}, version=${data.version}`);

      // 发送项目配置到对应的 Agent
      this.sendProjectPromptToAgent(data);
    });

    logger.info('[App] ✅ 工作流上下文 → Agent 项目配置注入桥接已建立');
  }

  /**
   * 发送项目配置提示词到 Agent
   * 通过 ProcessManager 发送 project_prompt_update 消息
   */
  private sendProjectPromptToAgent(data: {
    workflowId: string;
    agentId: string;
    type: 'public' | 'private';
    content: string;
    version: number;
    mtime: number;
  }): void {
    const workflowContextManager = getWorkflowContextManager();
    const context = workflowContextManager.getWorkflowContext(data.workflowId);
    
    // 如果 agentId 是 'public'，发送给参与工作流的活跃 Agent
    if (data.agentId === 'public') {
      if (this.processManager) {
        const agents = this.processManager.listAgents();
        for (const agent of agents) {
          // 只发送给参与工作流的活跃 Agent
          if (agent.status === 'active' && context?.participatingAgents.has(agent.id)) {
            try {
              this.processManager.sendRaw(agent.id, {
                type: 'project_prompt_update',
                workflowId: data.workflowId,
                agentId: 'public',
                content: data.content,
                version: data.version,
                mtime: data.mtime,
              });
              logger.info(`[App] 已发送公共项目配置到 Agent: ${agent.id}`);
            } catch (error) {
              logger.warn(`[App] 发送公共项目配置到 Agent ${agent.id} 失败:`, error);
            }
          }
        }
        
        // 🆕 同时发送给指挥官 ahivecore（公共配置）
        // 指挥官始终接收公共项目配置，不依赖 participatingAgents
        try {
          if (this.ahivecore) {
            this.ahivecore.setProjectPrompt(data.content, {
              workflowId: data.workflowId,
              agentId: 'public',
              version: data.version,
              mtime: data.mtime,
            });
            logger.info(`[App] 已发送公共项目配置到指挥官: ahivecore`);
          }
        } catch (error) {
          logger.warn(`[App] 发送公共项目配置到指挥官 ahivecore 失败:`, error);
        }
      }
    } else {
      // 专用配置：直接发送给指定的 Agent（不需要检查 participatingAgents）
      // 因为专用配置的 agentId 本身就是参与工作流的 Agent ID
      
      // 🆕 如果是指挥官的专用配置，直接调用指挥官的方法
      if (data.agentId === 'ahivecore') {
        try {
          if (this.ahivecore) {
            this.ahivecore.setProjectPrompt(data.content, {
              workflowId: data.workflowId,
              agentId: 'ahivecore',
              version: data.version,
              mtime: data.mtime,
            });
            logger.info(`[App] 已发送专用工作流配置到指挥官: ahivecore`);
          }
        } catch (error) {
          logger.warn(`[App] 发送专用工作流配置到指挥官 ahivecore 失败:`, error);
        }
      } else {
        // 其他Agent通过 processManager 发送
        if (this.processManager) {
          try {
            this.processManager.sendRaw(data.agentId, {
              type: 'project_prompt_update',
              workflowId: data.workflowId,
              agentId: data.agentId,
              content: data.content,
              version: data.version,
              mtime: data.mtime,
            });
            logger.info(`[App] 已发送专用项目配置到 Agent: ${data.agentId}`);
          } catch (error) {
            // Agent 可能已退出或不在进程中，记录警告但不阻断心跳流程
            logger.warn(`[App] 发送专用项目配置到 Agent ${data.agentId} 失败（Agent 可能已退出）:`, error);
          }
        }
      }
    }
  }

  /**
   * 关闭应用
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    logger.info('[App] 🛑 关闭 AHIVE Core...');

    try {
      // 关闭监控模块
      stopMemoryMonitor();
      stopWSClient();
      logger.info('[App] 监控模块已关闭');

      // 🆕 关闭进程管理器
      if (this.processManager && typeof this.processManager.close === 'function') {
        this.processManager.close();
      }
      
      // 关闭记忆系统
      await closeNewMemorySystem();

      // 🆕 关闭 Provider
      if (this.providerManager && typeof this.providerManager.dispose === 'function') {
        await this.providerManager.dispose();
      }
      
      // 🆕 清理会话记忆
      if (this.sessionMemory && typeof this.sessionMemory.clearAll === 'function') {
        this.sessionMemory.clearAll();
      }

      // 关闭其他资源
      if (this.ggufClient) {
        // GGUF 客户端清理
      }

      this.initialized = false;
      logger.info('[App] ✅ AHIVE Core 已关闭');

    } catch (error) {
      logger.error('[App] 关闭失败:', error);
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 将 Zod Schema 转换为 JSON Schema
   */
  private zodToJsonSchema(zodSchema: any): Record<string, any> {
    const result: Record<string, any> = {
      type: 'object',
      properties: {},
      required: [],
    };

    if (!zodSchema || typeof zodSchema !== 'object') {
      return result;
    }

    // 处理 ZodObject
    if (zodSchema._def?.typeName === 'ZodObject') {
      const shape = zodSchema._def.shape() || zodSchema._def.shape || {};
      
      for (const [key, value] of Object.entries(shape)) {
        const prop: Record<string, any> = {};
        const def = (value as any)?._def;
        
        if (def) {
          // 处理可选字段
          if (def.typeName === 'ZodOptional') {
            prop.description = def.innerType?._def?.description || '';
            this.parseZodType(prop, def.innerType?._def);
          } else {
            prop.description = def.description || '';
            this.parseZodType(prop, def);
            result.required.push(key);
          }
        }
        
        result.properties[key] = prop;
      }
    }

    return result;
  }

  private parseZodType(prop: Record<string, any>, def: any): void {
    if (!def) return;
    
    switch (def.typeName) {
      case 'ZodString':
        prop.type = 'string';
        break;
      case 'ZodNumber':
        prop.type = 'number';
        break;
      case 'ZodBoolean':
        prop.type = 'boolean';
        break;
      case 'ZodArray':
        prop.type = 'array';
        break;
      case 'ZodObject':
        prop.type = 'object';
        break;
      default:
        prop.type = 'string';
    }
  }
}