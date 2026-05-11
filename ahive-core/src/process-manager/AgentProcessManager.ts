/**
 * AHIVECORE - 智能体进程管理器
 *
 * 实现进程级隔离：
 * - 每个智能体运行在独立子进程中
 * - 一个崩溃不影响其他
 * - 主进程负责调度、监控、重启
 *
 * 通讯方式：Node.js IPC (process.send / process.on('message'))
 */

import { fork, spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { logger, cleanAgentMessage } from '../utils/index.js';
import type { LSPOperation } from '../lsp/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 类型定义 ====================

/** 智能体类型 */
export type AgentType = 'ahive-coder' | 'ahive-worker';

/** 智能体进程状态 */
export enum AgentProcessStatus {
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Crashed = 'crashed',
  Restarting = 'restarting',
}

/** 智能体进程信息 */
export interface AgentProcessInfo {
  id: string;
  type: AgentType;
  status: AgentProcessStatus;
  process: ChildProcess | null;
  startTime: number;
  restartCount: number;
  lastHeartbeat: number;
  config: Record<string, any>;
  /** 智能体内部状态（来自心跳） */
  agentStatus?: string;
  /** 智能体昵称 */
  nickname?: string;
}

/** IPC 消息格式 */
export interface IPCMessage {
  type: string;
  id?: string;
  from?: string;
  to?: string;
  payload?: any;
  timestamp?: number;
}

/** RPC 调用消息 */
export interface RPCCallMessage extends IPCMessage {
  type: 'rpc_call';
  id: string;
  method: string;
  args: any;
}

/** RPC 响应消息 */
export interface RPCResponseMessage extends IPCMessage {
  type: 'rpc_response';
  id: string;
  result?: any;
  error?: string;
}

/** 智能体间消息 */
export interface AgentMessage extends IPCMessage {
  type: 'agent_message';
  from: string;
  to: string;
  message: any;
  /** 元数据（用于企业微信会话追踪等） */
  metadata?: Record<string, unknown>;
}

/** 心跳消息 */
export interface HeartbeatMessage extends IPCMessage {
  type: 'heartbeat';
  id: string;
  status: AgentProcessStatus;
  /** 智能体内部状态 (idle/running/waiting/error) */
  agentStatus?: string;
  /** 智能体昵称 */
  nickname?: string;
  memory?: number;
}

// ==================== 进程管理器 ====================

export class AgentProcessManager extends EventEmitter {
  private processes: Map<string, AgentProcessInfo> = new Map();
  private pendingCalls: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout; agentId?: string }> = new Map();
  private streamListeners: Map<string, { listener: (event: { type: string; data: any }) => void; agentId?: string }> = new Map();
  // IDE传入的工作目录，新启动的Agent会自动收到
  private currentWorkdir: string | null = null;

  // 参考 CODEX: watch 机制 - 状态订阅者
  // 等价于 Rust 的 watch::Receiver<AgentStatus>
  private statusWatchers: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }[]> = new Map();

  // 🆕 消息追踪 - 用于智能体间双向通信
  // 存储 pending 的消息回复 Promise
  private pendingMessageReplies: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();

  // 缓存智能体最终状态 - 解决 spawn_agent/wait_agent 竞态条件
  // 子智能体可能在 wait_agent 注册订阅者之前就已完成，此时通知丢失
  // 缓存最终状态，让 waitChildAgent 注册时能立即获取
  private finalStatusCache: Map<string, { status: string; lastResult?: any }> = new Map();

  // 🆕 事件监听器管理 - 用于正确移除监听器
  private processHandlers: Map<string, {
    message: (msg: IPCMessage) => void;
    exit: (code: number | null, signal: string | null) => void;
    error: (error: Error) => void;
  }> = new Map();

  private maxRestarts: number = 3;
  private restartWindow: number = 60000; // 1分钟内最多重启3次
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: number = 30000; // 30秒无心跳视为异常

  // 内存优化：定期清理
  private cleanupInterval: NodeJS.Timeout | null = null;

  // 🆕 CORE 智能体消息处理器 - 用于将消息路由到主进程中的 CORE 智能体
  // 🆕 增加 metadata 参数，用于企业微信会话追踪
  private coreMessageHandler: ((from: string, message: string, type?: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; content?: string; error?: string; metadata?: Record<string, unknown> }>) | null = null;

  // 🆕 WEBOT 智能体消息处理器 - 用于将消息路由到主进程中的 ahive-webot
  // 🆕 增加 metadata 参数，用于企业微信会话追踪
  private webotMessageHandler: ((from: string, message: string, type?: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; content?: string; error?: string }>) | null = null;

  // 🆕 LLM Service - 用于子进程共享主进程的 LLM Provider
  private llmService: {
    chat: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, config?: any) => Promise<{
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      finishReason?: string;
    }>;
  } | null = null;

  // 🆕 LSP Client Manager - 用于子进程共享主进程的 LSP 服务
  private lspClientManager: {
    handleRequest: (request: { operation: string; filePath: string; line: number; character: number }) => Promise<{ success: boolean; data?: any; error?: string; durationMs: number }>;
    getStatus: () => Array<{ name: string; status: string; extensions: string[] }>;
    enableServer: (name: string) => Promise<void>;
    disableServer: (name: string) => Promise<void>;
  } | null = null;

  constructor(options?: { maxRestarts?: number; restartWindow?: number }) {
    super();
    if (options?.maxRestarts) this.maxRestarts = options.maxRestarts;
    if (options?.restartWindow) this.restartWindow = options.restartWindow;

    // 启动定期清理
    this.startCleanupInterval();
  }

  /**
   * 设置 CORE 智能体消息处理器
   * 用于将发给 CORE 的消息路由到主进程中的 CORE 智能体
   * 
   * 🆕 增加 metadata 参数，用于传递企业微信等外部渠道的会话信息
   */
  setCoreMessageHandler(handler: (from: string, message: string, type?: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; content?: string; error?: string; metadata?: Record<string, unknown> }>): void {
    this.coreMessageHandler = handler;
    logger.info('[ProcessManager] ✅ 已设置 CORE 智能体消息处理器（支持 metadata）');
  }

  /**
   * 设置 WEBOT 智能体消息处理器
   * 用于将发给 ahive-webot 的消息路由到主进程中的企业微信智能体
   * 
   * 🆕 增加 metadata 参数，用于传递企业微信等外部渠道的会话信息
   */
  setWebotMessageHandler(handler: (from: string, message: string, type?: string, metadata?: Record<string, unknown>) => Promise<{ success: boolean; content?: string; error?: string }>): void {
    this.webotMessageHandler = handler;
    logger.info('[ProcessManager] ✅ 已设置 WEBOT 智能体消息处理器（支持 metadata）');
  }

  /**
   * 设置 LLM Service
   * 用于子进程共享主进程的 LLM Provider（避免重复加载 GGUF 模型）
   */
  setLLMService(service: {
    chat: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, config?: any) => Promise<{
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      finishReason?: string;
    }>;
  }): void {
    this.llmService = service;
    logger.info('[ProcessManager] ✅ 已设置 LLM Service（子进程共享）');
  }

  /**
   * 设置 LSP Client Manager
   * 用于子进程共享主进程的 LSP 服务
   */
  setLSPClientManager(manager: {
    handleRequest: (request: { operation: LSPOperation; filePath: string; line: number; character: number }) => Promise<{ success: boolean; data?: any; error?: string; durationMs: number }>;
    getStatus: () => Array<{ name: string; status: string; extensions: string[] }>;
    enableServer: (name: string) => Promise<void>;
    disableServer: (name: string) => Promise<void>;
  }): void {
    this.lspClientManager = manager;
    logger.info('[ProcessManager] ✅ 已设置 LSP Client Manager（子进程共享）');
  }

  /**
   * 启动定期清理
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePendingCalls();
    }, 60000);  // 每分钟清理一次
  }

  /**
   * 清理过期的 Pending 条目
   */
  private cleanupStalePendingCalls(): void {
    const now = Date.now();
    const maxAge = 120000;  // 2分钟

    // 清理 pendingCalls - 移除超时但未被回调清理的条目
    for (const [id, pending] of this.pendingCalls) {
      // pending 结构: { resolve, reject, timeout }
      // 通过 timeout 是否已被清除来判断是否过期
      if (pending.timeout === null || pending.timeout === undefined) {
        this.pendingCalls.delete(id);
      }
    }

    // 清理 streamListeners - 移除超时的监听器
    for (const [callId] of this.streamListeners) {
      // streamListeners 在 rpc_response 时清理，这里不做额外处理
    }

    // 清理 statusWatchers - 检查是否有已完成的 watcher
    for (const [agentId, watchers] of this.statusWatchers) {
      const activeWatchers = watchers.filter(w => w.timeout !== null);

      if (activeWatchers.length === 0) {
        this.statusWatchers.delete(agentId);
      } else if (activeWatchers.length !== watchers.length) {
        this.statusWatchers.set(agentId, activeWatchers);
      }
    }

    // 清理 pendingMessageReplies - 移除超时的回复等待
    for (const [replyId, pending] of this.pendingMessageReplies) {
      // pending 结构: { resolve, reject, timeout }
      if (pending.timeout === null || pending.timeout === undefined) {
        this.pendingMessageReplies.delete(replyId);
      }
    }

    // 记录清理后的状态
    if (this.pendingCalls.size > 0 || this.streamListeners.size > 0 || this.statusWatchers.size > 0) {
      logger.debug(`[ProcessManager] 清理后: pendingCalls=${this.pendingCalls.size}, streamListeners=${this.streamListeners.size}, statusWatchers=${this.statusWatchers.size}`);
    }
  }

  /**
   * 启动智能体进程
   */
  async spawnAgent(id: string, type: AgentType, config: Record<string, any> = {}): Promise<string> {
    if (this.processes.has(id)) {
      throw new Error(`智能体 ${id} 已存在`);
    }

    logger.info(`[ProcessManager] 启动智能体进程: ${id} (${type})`);

    const info: AgentProcessInfo = {
      id,
      type,
      status: AgentProcessStatus.Starting,
      process: null,
      startTime: Date.now(),
      restartCount: 0,
      lastHeartbeat: Date.now(),
      config,
    };

    this.processes.set(id, info);

    try {
      await this._startProcess(id);
      return id;
    } catch (error) {
      this.processes.delete(id);
      throw error;
    }
  }

  /**
      * 内部启动进程
      */
  private async _startProcess(id: string): Promise<void> {
    const info = this.processes.get(id);
    if (!info) return;

    // 确定正确的 worker 路径
    // tsx 运行时 __dirname 指向 src/，编译后指向 dist/
    const tsWorkerPath = path.join(__dirname, 'agent-worker.ts');
    const jsWorkerPath = path.join(__dirname, 'agent-worker.js');
    const distWorkerPath = path.join(__dirname, '..', '..', 'dist', 'process-manager', 'agent-worker.js');

    let workerPath: string;
    let useTsx = false;

    if (fs.existsSync(jsWorkerPath)) {
      workerPath = jsWorkerPath;
    } else if (fs.existsSync(distWorkerPath)) {
      workerPath = distWorkerPath;
    } else if (fs.existsSync(tsWorkerPath)) {
      // 使用 tsx 运行 .ts 文件
      workerPath = tsWorkerPath;
      useTsx = true;
    } else {
      logger.error(`[ProcessManager] 找不到 agent-worker: 尝试过 ${jsWorkerPath}, ${distWorkerPath}, ${tsWorkerPath}`);
      throw new Error(`找不到 agent-worker`);
    }

    logger.debug(`[ProcessManager] Worker 路径: ${workerPath}, 使用 tsx: ${useTsx}`);

    // 启动子进程
    let proc: ChildProcess;
    if (useTsx) {
      // ESM 模式下使用 node --import tsx 方式
      proc = spawn('node', ['--import', 'tsx', workerPath, info.type, id], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: {
          ...process.env,
          AGENT_ID: id,
          AGENT_TYPE: info.type,
        },
      }) as ChildProcess;
    } else {
      proc = fork(workerPath, [info.type, id], {
        silent: false,
        env: {
          ...process.env,
          AGENT_ID: id,
          AGENT_TYPE: info.type,
        },
      });
    }

    info.process = proc;
    info.status = AgentProcessStatus.Starting;

    // 创建并保存事件处理器（用于后续移除）
    const handlers = {
      message: (msg: IPCMessage) => {
        this._handleMessage(id, msg);
      },
      exit: (code: number | null, signal: string | null) => {
        this._handleExit(id, code, signal);
      },
      error: (error: Error) => {
        logger.error(`[ProcessManager] 智能体 ${id} 进程错误:`, error);
        this.emit('error', { id, error });
      },
    };

    // 保存处理器引用
    this.processHandlers.set(id, handlers);

    // 绑定事件监听器
    proc.on('message', handlers.message);
    proc.on('exit', handlers.exit);
    proc.on('error', handlers.error);

    // 等待进程就绪
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`智能体 ${id} 启动超时 (30秒)`));
      }, 30000);  // 30 秒超时，与子进程 RPC 超时匹配

      const readyHandler = (msg: IPCMessage) => {
        // 支持两种消息格式：
        // 1. type: 'ready', id: string (旧格式)
        // 2. type: 'stream_event', eventType: 'ready', agentId: string (新格式)
        const isReady = (msg.type === 'ready' && (msg as any).id === id) ||
          (msg.type === 'stream_event' && (msg as any).eventType === 'ready' && (msg as any).agentId === id);
        if (isReady) {
          clearTimeout(timeout);
          proc.off('message', readyHandler);
          info.status = AgentProcessStatus.Running;
          info.lastHeartbeat = Date.now();
          logger.info(`[ProcessManager] 智能体 ${id} 已就绪`);

          // 发送初始化配置（包括 roleId）
          const initMsg: any = {
            type: 'init',
            agentId: id,
            agentType: info.type,
          };
          if (info.config?.modelConfig) {
            initMsg.modelConfig = info.config.modelConfig;
          }
          if (info.config?.roleId && info.type === 'ahive-worker') {
            initMsg.roleId = info.config.roleId;
          }
          proc.send(initMsg);

          // Agent就绪后立即发送工作目录
          if (this.currentWorkdir) {
            proc.send({ type: 'set_workdir', workdir: this.currentWorkdir });
          }

          this.emit('agent:ready', { id, type: info.type });
          resolve();
        }
      };
      proc.on('message', readyHandler);
    });
  }

  /**
      * 处理子进程消息
      */
  private _handleMessage(fromId: string, msg: IPCMessage): void {
    const info = this.processes.get(fromId);
    if (!info) return;

    switch (msg.type) {
      case 'heartbeat':
        info.lastHeartbeat = Date.now();
        // 更新智能体内部状态
        const heartbeatMsg = msg as HeartbeatMessage;
        if (heartbeatMsg.agentStatus) {
          info.agentStatus = heartbeatMsg.agentStatus;
        }
        if (heartbeatMsg.nickname) {
          info.nickname = heartbeatMsg.nickname;
        }
        break;

      // 参考 CODEX: deliver_event_raw -> agent_status.send_replace(status)
      // 状态变化时通知所有订阅者
      case 'status_changed':
        this._handleStatusChanged(fromId, msg as any);
        break;

      case 'rpc_response':
        this._handleRPCResponse(msg as RPCResponseMessage);
        break;

      case 'stream_event':
        this._handleStreamEvent(msg as any);
        break;

      case 'agent_message':
        this._forwardMessage(msg as AgentMessage);
        break;

      case 'agent_reply':
        // 处理智能体回复
        this._handleAgentReply(msg as any);
        break;

      case 'rpc_call':
        // 子进程发起的 RPC 调用（分身管理等）
        this._handleChildRPCCall(fromId, msg as any);
        break;

      case 'log':
        logger.info(`[${fromId}] ${msg.payload}`);
        break;

      // 🆕 LSP 相关消息
      case 'lsp_request':
        this._handleLSPRequest(fromId, msg as any);
        break;

      case 'lsp_status':
        this._handleLSPStatus(fromId, msg as any);
        break;

      case 'lsp_enable':
        this._handleLSPEnable(fromId, msg as any);
        break;

      case 'lsp_disable':
        this._handleLSPDisable(fromId, msg as any);
        break;

      default:
        this.emit('message', { from: fromId, message: msg });
    }
  }

  /**
   * 处理智能体回复
   */
  private _handleAgentReply(msg: { from: string; to: string; replyTo: string; message?: string; error?: string }): void {
    const pending = this.pendingMessageReplies.get(msg.replyTo);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMessageReplies.delete(msg.replyTo);

      if (msg.error) {
        pending.resolve({ success: false, error: msg.error });
      } else {
        pending.resolve({ success: true, content: msg.message });

        // 发射 agent_chat 事件（回复方向：接收方 → 发送方）
        const fromInfo = this.processes.get(msg.from);
        const toInfo = this.processes.get(msg.to);
        if (msg.message) {
          const replyEventData = {
            fromAgentId: msg.from,
            fromAgentName: fromInfo?.nickname || msg.from,
            toAgentId: msg.to,
            toAgentName: toInfo?.nickname || msg.to,
            message: cleanAgentMessage(msg.message),
            messageType: 'response',
          };
          this.emit('agent_chat', replyEventData);
        }
      }

      logger.debug(`[ProcessManager] 收到回复: ${msg.from} -> ${msg.to}`);
    } else {
      logger.warn(`[ProcessManager] 收到未知回复: replyTo=${msg.replyTo}`);
    }
  }

  /**
   * 处理状态变化消息
   * 参考 CODEX: agent_status.send_replace(status) -> 通知所有订阅者
   */
  private _handleStatusChanged(agentId: string, msg: { status: string; lastResult?: any }): void {
    const info = this.processes.get(agentId);
    if (info) {
      info.agentStatus = msg.status;
    }

    // 调试日志
    logger.info(`[ProcessManager] 收到 status_changed: ${agentId} -> ${msg.status}, lastResult=${msg.lastResult ? '有' : '无'}, content=${msg.lastResult?.content ? '有' : '无'}`);

    // 详细诊断日志
    if (msg.lastResult) {
      logger.info(`[ProcessManager] lastResult 详情: iterations=${msg.lastResult.iterations}, toolCallsExecuted=${msg.lastResult.toolCallsExecuted}, content长度=${msg.lastResult.content?.length || 0}`);
    }

    // 参考 CODEX: is_final - 只有最终状态才通知订阅者
    // 注意：状态值是小写的 (idle, error, stopped)
    const isFinal = (status: string): boolean => {
      const normalizedStatus = status.toLowerCase();
      // idle 且有结果 = 执行完成（即使 content 为空或错误，只要有 lastResult 就算完成）
      if (normalizedStatus === 'idle' && msg.lastResult) return true;
      // error = 出错
      if (normalizedStatus === 'error') return true;
      // stopped = 已停止
      if (normalizedStatus === 'stopped') return true;
      return false;
    };

    const final = isFinal(msg.status);
    logger.info(`[ProcessManager] isFinal 判断结果: ${final}`);

    // 只有最终状态才通知订阅者
    if (!final) {
      logger.debug(`[ProcessManager] 状态变化: ${agentId} -> ${msg.status} (非最终状态，继续等待)`);
      return;
    }

    // 缓存最终状态，解决 spawn_agent/wait_agent 竞态条件
    // 子智能体可能在 wait_agent 注册订阅者之前就已完成，此时通知丢失
    // 缓存后，waitChildAgent 注册订阅者时可以立即获取
    this.finalStatusCache.set(agentId, { status: msg.status, lastResult: msg.lastResult });
    logger.info(`[ProcessManager] 缓存最终状态: ${agentId} -> ${msg.status}`);

    // 通知所有等待该智能体状态的订阅者
    // 参考 CODEX: status_rx.changed() -> 解除阻塞
    const watchers = this.statusWatchers.get(agentId);
    if (watchers && watchers.length > 0) {
      logger.info(`[ProcessManager] 状态变化: ${agentId} -> ${msg.status}, 通知 ${watchers.length} 个订阅者`);

      for (const watcher of watchers) {
        clearTimeout(watcher.timeout);
        watcher.resolve({
          status: msg.status,
          lastResult: msg.lastResult,
        });
      }

      this.statusWatchers.delete(agentId);
      // 订阅者已通知，清除缓存
      this.finalStatusCache.delete(agentId);
    } else {
      logger.warn(`[ProcessManager] 状态变化: ${agentId} -> ${msg.status}, 但没有订阅者 (已缓存，wait_agent可获取)`);
    }
  }

  /**
   * 处理子进程发起的 RPC 调用（分身管理）
   */
  private async _handleChildRPCCall(fromId: string, msg: any): Promise<void> {
    const { id: callId, method, args } = msg;

    try {
      let result: any;

      switch (method) {
        case 'spawn_child':
          result = await this.spawnChildAgent(args.parentId, args.options);
          break;

        case 'wait_child':
          result = await this.waitChildAgent(args.childId, args.timeout);
          break;

        case 'terminate_child':
          this.terminateChildAgent(args.childId);
          result = { success: true };
          break;

        case 'get_all_agent_status':
          // 返回所有智能体状态
          result = this.getAllAgentStatusArray();
          break;

        case 'send_and_wait':
          // 发送消息并等待回复
          // 注意：参数名映射 (fromId->from, toId->to, content->message)
          result = await this.sendAndWait(
            args.fromId || args.from,
            args.toId || args.to,
            args.content || args.message,
            args.type,
            args.timeout
          );
          break;

        case 'llm_chat':
          // 🆕 子进程请求调用主进程的 LLM Service
          // 用于共享主进程已加载的 LOCAL 模型，避免重复加载
          // 🔧 修复：工具定义通过 config.tools 传递，Provider 会从 config 中读取
          if (!this.llmService) {
            throw new Error('主进程 LLM Service 未初始化');
          }

          // 调用 LLM Service，传递工具定义到 config
          // OpenAIProvider.chatInternal 会从 config.tools 获取工具定义
          result = await this.llmService.chat(args.messages, {
            ...args.config,
            tools: args.tools,  // 🔧 传递工具定义到 config
          });

          if (args.tools && args.tools.length > 0) {
            logger.info(`[ProcessManager] Worker ${fromId} LLM 调用完成，使用了 ${args.tools.length} 个工具`);
          }
          break;

        case 'get_concurrency_status':
          // 获取并发状态（子分身数量限制）
          result = this.getConcurrencyStatus();
          break;

        default:
          throw new Error(`未知的子进程 RPC 方法: ${method}`);
      }

      // 发送响应
      const info = this.processes.get(fromId);
      if (info?.process) {
        info.process.send({
          type: 'rpc_response',
          id: callId,
          result,
        });
      }
    } catch (error: any) {
      const info = this.processes.get(fromId);
      if (info?.process) {
        info.process.send({
          type: 'rpc_response',
          id: callId,
          error: error.message,
        });
      }
    }
  }

  /**
      * 处理流式事件
      */
  private _handleStreamEvent(msg: any): void {
    const { callId, eventType, data } = msg;

    // 过滤心跳日志，避免刷屏
    if (eventType !== 'heartbeat') {
      logger.info(`[ProcessManager] _handleStreamEvent: callId=${callId}, eventType=${eventType}`);
    }

    // 如果没有 callId，这是非流式 RPC 的事件，直接触发全局事件
    if (!callId) {
      this.emit('stream_event', { eventType, data });
      if (eventType !== 'heartbeat') {
        logger.debug(`[ProcessManager] 收到无 callId 的流式事件: type=${eventType}`);
      }
      return;
    }

    const listenerObj = this.streamListeners.get(callId);

    if (listenerObj) {
      if (eventType !== 'heartbeat') {
        logger.info(`[ProcessManager] _handleStreamEvent: 找到监听器，调用回调`);
      }
      listenerObj.listener({ type: eventType, data });
    } else {
      // 这是正常情况：rpc_response 已处理，监听器已清理，但还有延迟事件到达
      logger.warn(`[ProcessManager] _handleStreamEvent: 未找到监听器: callId=${callId}`);
    }
  }

  /**
   * 处理进程退出
   */
  private _handleExit(id: string, code: number | null, signal: string | null): void {
    const info = this.processes.get(id);
    if (!info) return;

    logger.warn(`[ProcessManager] 智能体 ${id} 退出: code=${code}, signal=${signal}`);

    const wasRunning = info.status === AgentProcessStatus.Running;
    info.status = code === 0 ? AgentProcessStatus.Stopped : AgentProcessStatus.Crashed;
    info.process = null;

    this.emit('agent:exit', { id, code, signal, wasRunning });

    // 🆕 错误核心修复：进程退出（比如内存爆炸）时，必须中断相关的所有幽灵连接
    this._cleanupAgentConnections(id);

    // 如果是非正常退出，尝试重启
    if (code !== 0 && wasRunning) {
      this._tryRestart(id);
    }
  }

  /**
   * 尝试重启
   */
  private async _tryRestart(id: string): Promise<void> {
    const info = this.processes.get(id);
    if (!info) return;

    // 检查重启次数
    const recentRestarts = this._getRecentRestarts(id);
    if (recentRestarts >= this.maxRestarts) {
      logger.error(`[ProcessManager] 智能体 ${id} 重启次数过多，停止重启`);
      this.emit('agent:max_restarts', { id, count: recentRestarts });
      return;
    }

    info.status = AgentProcessStatus.Restarting;
    info.restartCount++;
    logger.info(`[ProcessManager] 重启智能体 ${id} (第 ${info.restartCount} 次)`);

    try {
      await this._startProcess(id);
      logger.info(`[ProcessManager] 智能体 ${id} 重启成功`);
      this.emit('agent:restarted', { id, count: info.restartCount });
    } catch (error) {
      logger.error(`[ProcessManager] 智能体 ${id} 重启失败:`, error);
      this.emit('agent:restart_failed', { id, error });
    }
  }

  /**
   * 获取最近重启次数
   */
  private _getRecentRestarts(id: string): number {
    // 简化实现：直接返回当前重启计数
    // 实际应该记录时间窗口内的重启
    const info = this.processes.get(id);
    return info?.restartCount || 0;
  }

  /**
   * 处理 RPC 响应
   */
  private _handleRPCResponse(msg: RPCResponseMessage): void {
    logger.info(`[ProcessManager] 收到 rpc_response: id=${msg.id}, hasError=${!!msg.error}, hasResult=${!!msg.result}`);

    const pending = this.pendingCalls.get(msg.id);
    if (!pending) {
      logger.warn(`[ProcessManager] rpc_response 未找到对应的 pending call: id=${msg.id}, 当前 pendingCalls 数量: ${this.pendingCalls.size}`);
      // 打印当前的 pending calls
      const currentCallIds = Array.from(this.pendingCalls.keys());
      logger.warn(`[ProcessManager] 当前 pending calls: ${currentCallIds.join(', ')}`);
      return;
    }

    logger.info(`[ProcessManager] 找到 pending call: id=${msg.id}, 正在处理响应`);
    clearTimeout(pending.timeout);
    this.pendingCalls.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  // ==================== LSP 消息处理 ====================

  /**
   * 处理 LSP 请求
   */
  private async _handleLSPRequest(fromId: string, msg: { id: string; operation: string; filePath: string; line: number; character: number }): Promise<void> {
    const info = this.processes.get(fromId);
    if (!info?.process) return;

    if (!this.lspClientManager) {
      info.process.send({
        type: 'lsp_response',
        id: msg.id,
        success: false,
        error: 'LSP Client Manager not initialized',
      });
      return;
    }

    try {
      const result = await this.lspClientManager.handleRequest({
        operation: msg.operation,
        filePath: msg.filePath,
        line: msg.line,
        character: msg.character,
      });

      info.process.send({
        type: 'lsp_response',
        id: msg.id,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: result.durationMs,
      });

      logger.debug(`[ProcessManager] LSP ${msg.operation} from ${fromId}: ${result.durationMs}ms`);

    } catch (error: any) {
      info.process.send({
        type: 'lsp_response',
        id: msg.id,
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 处理 LSP 状态查询
   */
  private _handleLSPStatus(fromId: string, msg: { id: string }): void {
    const info = this.processes.get(fromId);
    if (!info?.process) return;

    const status = this.lspClientManager?.getStatus() || [];

    info.process.send({
      type: 'lsp_status_response',
      id: msg.id,
      status,
    });
  }

  /**
   * 处理启用 LSP Server
   */
  private async _handleLSPEnable(fromId: string, msg: { id: string; serverName: string }): Promise<void> {
    const info = this.processes.get(fromId);
    if (!info?.process) return;

    if (!this.lspClientManager) {
      info.process.send({
        type: 'lsp_enable_response',
        id: msg.id,
        success: false,
        error: 'LSP Client Manager not initialized',
      });
      return;
    }

    try {
      await this.lspClientManager.enableServer(msg.serverName);
      info.process.send({
        type: 'lsp_enable_response',
        id: msg.id,
        success: true,
      });
      logger.info(`[ProcessManager] LSP ${msg.serverName} enabled by ${fromId}`);
    } catch (error: any) {
      info.process.send({
        type: 'lsp_enable_response',
        id: msg.id,
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * 处理禁用 LSP Server
   */
  private async _handleLSPDisable(fromId: string, msg: { id: string; serverName: string }): Promise<void> {
    const info = this.processes.get(fromId);
    if (!info?.process) return;

    if (!this.lspClientManager) {
      info.process.send({
        type: 'lsp_disable_response',
        id: msg.id,
        success: false,
        error: 'LSP Client Manager not initialized',
      });
      return;
    }

    try {
      await this.lspClientManager.disableServer(msg.serverName);
      info.process.send({
        type: 'lsp_disable_response',
        id: msg.id,
        success: true,
      });
      logger.info(`[ProcessManager] LSP ${msg.serverName} disabled by ${fromId}`);
    } catch (error: any) {
      info.process.send({
        type: 'lsp_disable_response',
        id: msg.id,
        success: false,
        error: error.message,
      });
    }
  }

  /**
      * 转发智能体间消息
      */
  private _forwardMessage(msg: AgentMessage): void {
    // 🆕 特殊处理：目标为 CORE 智能体
    if (msg.to === 'ahivecore') {
      if (this.coreMessageHandler) {
        // 异步调用，不等待回复
        // 🆕 传递 metadata（用于企业微信会话追踪）
        const metadata = msg.message?.metadata || {};
        this.coreMessageHandler(msg.from, typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message), msg.message?.type, metadata)
          .catch(err => logger.error(`[ProcessManager] CORE 消息处理失败:`, err));

        // 发射 agent_chat 事件
        const fromInfo = this.processes.get(msg.from);
        this.emit('agent_chat', {
          fromAgentId: msg.from,
          fromAgentName: fromInfo?.nickname || msg.from,
          toAgentId: 'ahivecore',
          toAgentName: 'AHIVECORE',
          message: cleanAgentMessage(typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message)),
          messageType: msg.message?.type || 'task',
        });
        return;
      } else {
        logger.warn(`[ProcessManager] CORE 智能体未初始化，无法转发消息`);
        return;
      }
    }

    // 🆕 特殊处理：目标为 WEBOT 智能体
    if (msg.to === 'ahive-webot') {
      if (this.webotMessageHandler) {
        // 异步调用，不等待回复
        // 🆕 传递 metadata（用于企业微信会话追踪）
        const metadata = msg.metadata || {};
        this.webotMessageHandler(msg.from, typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message), msg.message?.type, metadata)
          .catch(err => logger.error(`[ProcessManager] WEBOT 消息处理失败:`, err));

        // 发射 agent_chat 事件
        const fromInfo = this.processes.get(msg.from);
        this.emit('agent_chat', {
          fromAgentId: msg.from,
          fromAgentName: fromInfo?.nickname || msg.from,
          toAgentId: 'ahive-webot',
          toAgentName: '企业微信智能体',
          message: cleanAgentMessage(typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message)),
          messageType: msg.message?.type || 'task',
          metadata,
        });
        return;
      } else {
        logger.warn(`[ProcessManager] WEBOT 智能体未初始化，无法转发消息`);
        return;
      }
    }

    const targetInfo = this.processes.get(msg.to);
    if (!targetInfo || !targetInfo.process) {
      logger.warn(`[ProcessManager] 目标智能体不存在: ${msg.to}`);
      return;
    }

    // 🆕 发射 agent_chat 事件（普通智能体间通讯）
    const fromInfo = this.processes.get(msg.from);
    this.emit('agent_chat', {
      fromAgentId: msg.from,
      fromAgentName: fromInfo?.nickname || msg.from,
      toAgentId: msg.to,
      toAgentName: targetInfo.nickname || msg.to,
      message: cleanAgentMessage(typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message)),
      messageType: msg.message?.type || 'task',
      metadata: msg.metadata,
    });

    // 🆕 转发消息给子进程时，传递 metadata
    // 子进程的 handleMessage 方法需要能够接收 metadata
    const forwardMsg = {
      ...msg,
      metadata: msg.metadata,  // 确保 metadata 被传递
    };
    targetInfo.process.send(forwardMsg);
    logger.info(`[ProcessManager] 消息转发: ${msg.from} -> ${msg.to}, metadata: ${JSON.stringify(msg.metadata)}`);
  }

  // ==================== 公共 API ====================

  /**
   * RPC 调用
   */
  async call<T = any>(agentId: string, method: string, args: any, timeout = 600000): Promise<T> {
    const info = this.processes.get(agentId);
    if (!info || !info.process) {
      throw new Error(`智能体 ${agentId} 不存在或未运行`);
    }

    const callId = randomUUID();
    const msg: RPCCallMessage = {
      type: 'rpc_call',
      id: callId,
      method,
      args,
    };

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error(`RPC 调用超时: ${method}`));
      }, timeout);

      this.pendingCalls.set(callId, { resolve, reject, timeout: timeoutHandle, agentId });
      info.process!.send(msg);
    });
  }

  /**
   * 流式 RPC 调用
     * 
      * 通过 IPC 实现真正的流式传输：
      * 1. 发送 rpc_call 请求 (method = 'execute_stream')
      * 2. 实时接收 stream_event 事件并调用 onEvent 回调
      * 3. 等待最终的 rpc_response 响应
      * 
      * 参考 CODEX: 使用空闲超时（idle timeout）而非总超时
      * 每次收到事件时重置超时计时器
      * 
      * @param agentId 智能体 ID
      * @param method RPC 方法名
      * @param args 调用参数
      * @param onEvent 流式事件回调
      * @param idleTimeout 空闲超时时间（毫秒），默认 60 秒
      */
  async streamCall<T = any>(
    agentId: string,
    method: string,
    args: any,
    onEvent: (event: { type: string; data: any }) => void,
    idleTimeout = 60000
  ): Promise<T> {
    const info = this.processes.get(agentId);
    if (!info || !info.process) {
      logger.error(`[ProcessManager] streamCall: 智能体 ${agentId} 不存在或未运行`);
      throw new Error(`智能体 ${agentId} 不存在或未运行`);
    }

    logger.info(`[ProcessManager] streamCall: ${method} for ${agentId}, process PID=${info.process.pid}`);

    const callId = randomUUID();
    logger.info(`[ProcessManager] streamCall: 创建 callId=${callId}`);

    const msg: RPCCallMessage = {
      type: 'rpc_call',
      id: callId,
      method,
      args,
    };

    return new Promise((resolve, reject) => {
      // 空闲超时：每次收到事件时重置
      let idleTimer = setTimeout(() => {
        // 清理事件监听器
        logger.warn(`[ProcessManager] streamCall 空闲超时: callId=${callId}, method=${method}`);
        this.streamListeners.delete(callId);
        this.pendingCalls.delete(callId);
        reject(new Error(`流式 RPC 调用空闲超时: ${method} (${idleTimeout}ms 无事件)`));
      }, idleTimeout);

      // 重置空闲计时器的函数
      const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          logger.warn(`[ProcessManager] streamCall 空闲超时(重置后): callId=${callId}, method=${method}`);
          this.streamListeners.delete(callId);
          this.pendingCalls.delete(callId);
          reject(new Error(`流式 RPC 调用空闲超时: ${method} (${idleTimeout}ms 无事件)`));
        }, idleTimeout);
      };

      // 设置流式事件监听器（每次收到事件时重置空闲计时器）
      this.streamListeners.set(callId, {
        listener: (event) => {
          if (event.type !== 'heartbeat') {
            logger.debug(`[ProcessManager] streamCall 收到事件: callId=${callId}, eventType=${event.type}`);
          }
          resetIdleTimer();  // 重置空闲超时
          onEvent(event);
        },
        agentId,
      });

      // 设置最终响应处理器
      logger.info(`[ProcessManager] streamCall: 设置 pendingCalls[${callId}]`);
      this.pendingCalls.set(callId, {
        resolve: (result: T) => {
          clearTimeout(idleTimer);
          this.streamListeners.delete(callId);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(idleTimer);
          this.streamListeners.delete(callId);
          reject(error);
        },
        timeout: idleTimer,
        agentId,
      });

      info.process!.send(msg);
      logger.info(`[ProcessManager] streamCall: 已发送 rpc_call, callId=${callId}, 等待响应...`);
    });
  }

  /**
     * 发送消息到智能体
     * 注意：消息会被包装成 { type: 'message', payload: message }
     */
  send(agentId: string, message: any): void {
    const info = this.processes.get(agentId);
    if (!info || !info.process) {
      throw new Error(`智能体 ${agentId} 不存在或未运行`);
    }

    info.process.send({
      type: 'message',
      payload: message,
    });
  }

  /**
   * 直接发送原始消息到智能体进程（不包装）
   * 用于中断、插话等需要直接传递的场景
   */
  sendRaw(agentId: string, message: any): void {
    const info = this.processes.get(agentId);
    if (!info || !info.process) {
      throw new Error(`智能体 ${agentId} 不存在或未运行`);
    }

    info.process.send(message);
  }

  /**
   * 智能体间通讯
   * @param from 发送者 ID
   * @param to 接收者 ID
   * @param message 消息内容
   * @param type 消息类型（可选）
   * @param metadata 元数据（用于企业微信会话追踪等）
   */
  sendTo(from: string, to: string, message: any, type?: string, metadata?: Record<string, unknown>): void {
    const msg: AgentMessage = {
      type: 'agent_message',
      from,
      to,
      message,
      metadata,
      timestamp: Date.now(),
    };
    this._forwardMessage(msg);
  }

  /**
   * 智能体间通讯（带回复追踪）
   * 发送消息并等待回复
   * @param from 发送者 ID
   * @param to 接收者 ID
   * @param message 消息内容
   * @param type 消息类型
   * @param timeout 超时时间
   * @param metadata 元数据（用于企业微信会话追踪等）
   */
  sendAndWait(from: string, to: string, message: any, type?: string, timeout = 60000, metadata?: Record<string, unknown>): Promise<{ success: boolean; content?: string; error?: string; metadata?: Record<string, unknown> }> {
    return new Promise(async (resolve, reject) => {
      // 🆕 特殊处理：目标为 CORE 智能体
      if (to === 'ahivecore') {
        if (this.coreMessageHandler) {
          try {
            // 发射 agent_chat 事件
            const fromInfo = this.processes.get(from);
            const chatEventData = {
              fromAgentId: from,
              fromAgentName: fromInfo?.nickname || from,
              toAgentId: 'ahivecore',
              toAgentName: 'AHIVECORE',
              message: cleanAgentMessage(typeof message === 'string' ? message : JSON.stringify(message)),
              messageType: type || 'task',
              metadata,
            };
            logger.info(`[ProcessManager] 发射 agent_chat 事件 (CORE): ${chatEventData.fromAgentName} → AHIVECORE`);
            this.emit('agent_chat', chatEventData);

            // 调用 CORE 消息处理器（传递 metadata）
            const result = await this.coreMessageHandler(from, typeof message === 'string' ? message : JSON.stringify(message), type, metadata);

            // 🆕 发射 agent_chat 事件（回复方向：CORE → 发送者）
            if (result.success && result.content) {
              const replyEventData = {
                fromAgentId: 'ahivecore',
                fromAgentName: 'AHIVECORE',
                toAgentId: from,
                toAgentName: fromInfo?.nickname || from,
                message: cleanAgentMessage(result.content),
                messageType: 'response',
              };
              logger.info(`[ProcessManager] 发射 agent_chat 事件 (CORE 回复): AHIVECORE → ${replyEventData.toAgentName}`);
              this.emit('agent_chat', replyEventData);
            }

            resolve(result);
            return;
          } catch (error: any) {
            resolve({ success: false, error: error.message || 'CORE 消息处理失败' });
            return;
          }
        } else {
          resolve({ success: false, error: 'CORE 智能体未初始化' });
          return;
        }
      }

      // 🆕 特殊处理：目标为 ahive-webot（企业微信智能体）
      if (to === 'ahive-webot') {
        if (this.webotMessageHandler) {
          try {
            // 发射 agent_chat 事件
            const fromInfo = this.processes.get(from);
            const chatEventData = {
              fromAgentId: from,
              fromAgentName: fromInfo?.nickname || from,
              toAgentId: 'ahive-webot',
              toAgentName: '企业微信智能体',
              message: cleanAgentMessage(typeof message === 'string' ? message : JSON.stringify(message)),
              messageType: type || 'task',
              metadata,
            };
            logger.info(`[ProcessManager] 发射 agent_chat 事件 (WEBOT): ${chatEventData.fromAgentName} → 企业微信智能体`);
            this.emit('agent_chat', chatEventData);

            // 调用 WEBOT 消息处理器（传递 metadata）
            const result = await this.webotMessageHandler(from, typeof message === 'string' ? message : JSON.stringify(message), type, metadata);

            resolve(result);
            return;
          } catch (error: any) {
            resolve({ success: false, error: error.message || 'WEBOT 消息处理失败' });
            return;
          }
        } else {
          resolve({ success: false, error: 'WEBOT 智能体未初始化' });
          return;
        }
      }

      const replyTo = randomUUID();

      // 设置超时
      const timeoutHandle = setTimeout(() => {
        this.pendingMessageReplies.delete(replyTo);
        resolve({ success: false, error: `等待回复超时 (${timeout}ms)` });
      }, timeout);

      // 存储待回复的 Promise
      this.pendingMessageReplies.set(replyTo, {
        resolve: (result: { success: boolean; content?: string; error?: string }) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutHandle);
          resolve({ success: false, error: error.message });
        },
        timeout: timeoutHandle,
      });

      // 发送带追踪 ID 的消息
      const msg: AgentMessage & { replyTo: string } = {
        type: 'agent_message',
        from,
        to,
        message,
        replyTo,
        timestamp: Date.now(),
      };

      const targetInfo = this.processes.get(to);
      if (!targetInfo || !targetInfo.process) {
        clearTimeout(timeoutHandle);
        this.pendingMessageReplies.delete(replyTo);
        resolve({ success: false, error: `目标智能体 ${to} 不存在` });
        return;
      }

      // 发射 agent_chat 事件，用于广播到前端 3D 世界
      const fromInfo = this.processes.get(from);
      const chatEventData = {
        fromAgentId: from,
        fromAgentName: fromInfo?.nickname || from,
        toAgentId: to,
        toAgentName: targetInfo.nickname || to,
        message: cleanAgentMessage(typeof message === 'string' ? message : JSON.stringify(message)),
        messageType: type || 'task',
      };
      logger.info(`[ProcessManager] 发射 agent_chat 事件: ${chatEventData.fromAgentName} → ${chatEventData.toAgentName}`);
      this.emit('agent_chat', chatEventData);

      targetInfo.process.send(msg);
      logger.debug(`[ProcessManager] 发送消息并等待回复: ${from} -> ${to}, replyTo=${replyTo}`);
    });
  }

  /**
   * 停止智能体
   */
  async stopAgent(id: string): Promise<void> {
    const info = this.processes.get(id);
    if (!info) return;

    logger.info(`[ProcessManager] 停止智能体: ${id}`);
    info.status = AgentProcessStatus.Stopping;

    if (info.process) {
      // 🆕 移除事件监听器
      const handlers = this.processHandlers.get(id);
      if (handlers) {
        info.process.off('message', handlers.message);
        info.process.off('exit', handlers.exit);
        info.process.off('error', handlers.error);
        this.processHandlers.delete(id);
      }

      // 🆕 关闭流
      if (info.process.stdin) {
        info.process.stdin.destroy();
      }
      if (info.process.stdout) {
        info.process.stdout.destroy();
      }
      if (info.process.stderr) {
        info.process.stderr.destroy();
      }

      // 发送关闭信号
      info.process.send({ type: 'shutdown' });

      // 等待进程退出
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          info.process?.kill('SIGKILL');
          resolve();
        }, 5000);

        // 使用一次性监听器，避免内存泄漏
        const exitHandler = () => {
          clearTimeout(timeout);
          resolve();
        };
        info.process?.once('exit', exitHandler);
      });
    }

    info.status = AgentProcessStatus.Stopped;
    info.process = null;
    this.processes.delete(id);

    // 🆕 清理相关的 pending 条目
    this._cleanupAgentConnections(id);
    this.statusWatchers.delete(id);
    this.pendingMessageReplies.delete(id);

    this.emit('agent:stopped', { id });
  }

  /**
   * 彻底清理智能体相关的所有挂起（Pending）连接（Stream、RPC等）
   * 修复 300000ms 闲置超时导致的主进程报错
   */
  private _cleanupAgentConnections(agentId: string): void {
    logger.info(`[ProcessManager] 清理智能体幽灵连接: ${agentId}`);

    // 清理 pendingCalls
    for (const [callId, pending] of this.pendingCalls.entries()) {
      if (pending.agentId === agentId) {
        logger.info(`[ProcessManager] 取消挂起的 RPC: callId=${callId}`);
        clearTimeout(pending.timeout);
        pending.reject(new Error(`智能体 ${agentId} 异常退出或被强行停止，挂起的调用已被取消`));
        this.pendingCalls.delete(callId);
      }
    }

    // 清理 streamListeners
    for (const [callId, obj] of this.streamListeners.entries()) {
      if (obj.agentId === agentId) {
        logger.info(`[ProcessManager] 清除流监听器: callId=${callId}`);
        this.streamListeners.delete(callId);
      }
    }
  }

  /**
   * 获取所有智能体状态
   */
  getStatus(): Map<string, AgentProcessInfo> {
    return new Map(this.processes);
  }

  /**
   * 获取单个智能体状态
   */
  getAgentStatus(id: string): AgentProcessInfo | undefined {
    return this.processes.get(id);
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat(interval = 10000): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [id, info] of this.processes) {
        if (info.status === AgentProcessStatus.Running) {
          // 检查心跳超时
          if (Date.now() - info.lastHeartbeat > this.heartbeatTimeout) {
            logger.warn(`[ProcessManager] 智能体 ${id} 心跳超时`);
            this.emit('agent:timeout', { id });
          }
        }
      }
    }, interval);
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 停止所有智能体
   */
  async stopAll(): Promise<void> {
    logger.info('[ProcessManager] 停止所有智能体');
    this.stopHeartbeat();

    const stops = Array.from(this.processes.keys()).map(id => this.stopAgent(id));
    await Promise.all(stops);
  }

  /**
   * 获取所有智能体列表（用于 API）
   */
  listAgents(): Array<{ id: string; type: AgentType; status: string; model?: any }> {
    const agents: Array<{ id: string; type: AgentType; status: string; model?: any }> = [];

    for (const [id, info] of this.processes) {
      agents.push({
        id,
        type: info.type,
        status: info.status === AgentProcessStatus.Running ? 'active' : 'inactive',
        model: info.config?.modelConfig || { name: 'default' },
      });
    }

    return agents;
  }

  // ==================== 分身管理功能 ====================

  /**
   * 创建分身智能体
   * @param parentId 父智能体 ID
   * @param options 分身配置
   * 
   * 参考 CODEX 官方实现：
   * - forkHistory = false (默认): 子分身全新创建，无历史
   * - forkHistory = true: 复制父级 rollout 历史作为初始上下文
   */
  async spawnChildAgent(parentId: string, options: {
    message?: string;
    role?: string;
    model?: Partial<{ name: string; provider: string }>;
    forkHistory?: boolean;
  }): Promise<string> {
    const parentInfo = this.processes.get(parentId);
    if (!parentInfo) {
      throw new Error(`父智能体 ${parentId} 不存在`);
    }

    // 生成分身 ID
    const childId = `${parentId}-child-${Date.now().toString(36)}`;

    // 继承父级配置
    // 🔧 强制子智能体继承父智能体的模型配置，忽略 LLM 传入的 model 参数
    // 原因：LLM 经常幻觉出不存在的模型名（如 "nano"、"mini"），
    // 即使做白名单/跨 provider 检测也无法完全防范，直接强制继承最可靠
    const effectiveModelConfig = parentInfo.config.modelConfig;
    if (options.model && options.model.name) {
      logger.warn(`[ProcessManager] 忽略 LLM 指定的 model: "${options.model.name}"，子智能体强制继承父级模型: ${parentInfo.config.modelConfig?.name}`);
    }

    const childConfig = {
      ...parentInfo.config,
      modelConfig: effectiveModelConfig,
    };

    // 启动分身进程
    await this.spawnAgent(childId, parentInfo.type, childConfig);

    logger.info(`[ProcessManager] 创建分身: ${childId} (父: ${parentId}, forkHistory: ${options.forkHistory || false})`);

    // 如果 forkHistory = true，复制父级 rollout 历史给子分身
    // 参考 CODEX: spawn_agent_with_options 中的 fork_parent_spawn_call_id 逻辑
    if (options.forkHistory) {
      try {
        const forkedHistory = await this.call(parentId, 'get_rollout_history', {});
        if (forkedHistory && forkedHistory.items && forkedHistory.items.length > 0) {
          // 发送 forked 历史给子分身
          await this.call(childId, 'init_with_history', {
            history: forkedHistory.items,
            source: 'forked',
            parentAgentId: parentId,
          });
          logger.info(`[ProcessManager] 分身 ${childId} 已继承父级历史 (${forkedHistory.items.length} 条)`);
        }
      } catch (error) {
        logger.warn(`[ProcessManager] 复制父级历史失败: ${error}`);
        // 不阻塞分身创建，继续执行
      }
    }

    // 如果有初始消息，异步发送给分身（不等待执行完成）
    // 参考 CODEX 官方：spawn_agent 立即返回，wait_agent 获取结果
    if (options.message) {
      // 使用 streamCall 而不是 call，这样可以：
      // 1. 不阻塞当前流程
      // 2. 实时接收事件
      // 3. 最终获得结果
      logger.info(`[ProcessManager] 向分身 ${childId} 发送初始消息: ${options.message.substring(0, 100)}...`);

      // 异步执行，不等待完成
      this.streamCall(childId, 'execute_stream', {
        userMessage: options.message,
        prompt: options.message,
        role: options.role || 'worker',
      }, (event) => {
        // 可以在这里处理流式事件
        logger.debug(`[ProcessManager] 分身 ${childId} 事件: ${event.type}`);
      }, 180000).then(result => {
        logger.info(`[ProcessManager] 分身 ${childId} 执行完成: content=${result?.content?.substring(0, 100)}...`);
        // 执行完成后，主动通知等待者
        if (result) {
          this._handleStatusChanged(childId, {
            status: 'idle',
            lastResult: result
          });
        }
      }).catch(error => {
        logger.error(`[ProcessManager] 发送初始消息到分身 ${childId} 失败:`, error);
        // 错误也通知等待者
        this._handleStatusChanged(childId, {
          status: 'error',
          lastResult: { content: `错误: ${error.message}` }
        });
      });
    } else {
      logger.warn(`[ProcessManager] 分身 ${childId} 没有初始消息`);
    }

    return childId;
  }

  /**
   * 等待分身完成
   * 参考 CODEX: wait_for_final_status - 使用 watch 机制等待状态变化
   */
  async waitChildAgent(childId: string, timeout = 120000): Promise<{ status: string; content?: string; error?: string }> {
    const info = this.processes.get(childId);
    if (!info) {
      return { status: 'error', error: `分身 ${childId} 不存在` };
    }

    logger.info(`[ProcessManager] waitChildAgent 开始等待: ${childId}, 当前状态: ${info.agentStatus}`);

    // 先添加订阅者（防止竞态条件：在查询状态和添加订阅者之间，子分身可能已完成）
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        // 超时时移除订阅者
        const watchers = this.statusWatchers.get(childId);
        if (watchers) {
          const idx = watchers.findIndex(w => w.timeout === timeoutId);
          if (idx >= 0) watchers.splice(idx, 1);
          if (watchers.length === 0) this.statusWatchers.delete(childId);
        }
        logger.warn(`[ProcessManager] 等待分身 ${childId} 超时 (${timeout}ms)`);
        resolve({ status: 'timeout', error: `等待分身完成超时 (${timeout}ms)` });
      }, timeout);

      // 立即添加订阅者
      if (!this.statusWatchers.has(childId)) {
        this.statusWatchers.set(childId, []);
      }

      this.statusWatchers.get(childId)!.push({
        resolve: (result: { status: string; lastResult?: any }) => {
          clearTimeout(timeoutId);
          logger.info(`[ProcessManager] waitChildAgent 收到结果: ${childId}, status=${result.status}, hasContent=${!!result.lastResult?.content}`);
          const normalizedStatus = result.status?.toLowerCase();
          if (normalizedStatus === 'idle' && result.lastResult?.content) {
            resolve({ status: 'completed', content: result.lastResult.content });
          } else if (normalizedStatus === 'error') {
            resolve({ status: 'error', error: result.lastResult?.content || '分身执行出错' });
          } else if (result.lastResult?.content) {
            resolve({ status: 'completed', content: result.lastResult.content });
          } else {
            resolve({ status: 'error', error: '分身已停止' });
          }
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          resolve({ status: 'error', error: error.message });
        },
        timeout: timeoutId,
      });

      logger.info(`[ProcessManager] 已订阅分身 ${childId} 状态变化, 订阅者数: ${this.statusWatchers.get(childId)!.length}`);

      // 优先检查缓存：如果子分身已在 wait_agent 之前完成，最终状态已缓存
      const cachedFinal = this.finalStatusCache.get(childId);
      if (cachedFinal) {
        logger.info(`[ProcessManager] waitChildAgent 发现缓存最终状态: ${childId}, status=${cachedFinal.status}`);
        // 直接通知订阅者（不再走 _handleStatusChanged，避免重复判断）
        const watchers = this.statusWatchers.get(childId);
        if (watchers && watchers.length > 0) {
          for (const watcher of watchers) {
            clearTimeout(watcher.timeout);
            watcher.resolve({
              status: cachedFinal.status,
              lastResult: cachedFinal.lastResult,
            });
          }
          this.statusWatchers.delete(childId);
          this.finalStatusCache.delete(childId);
        }
        return; // 缓存命中，不需要再查询
      }

      // 缓存未命中，查询子进程状态（如果已完成会触发 _handleStatusChanged 通知订阅者）
      this.call(childId, 'status', {}, 30000).then(statusResult => {
        logger.info(`[ProcessManager] waitChildAgent 状态查询结果: ${JSON.stringify(statusResult?.lastResult ? '有结果' : '无结果')}`);

        // 如果已经有结果，主动触发通知
        if (statusResult && statusResult.lastResult) {
          logger.info(`[ProcessManager] waitChildAgent 分身已完成，主动触发通知: ${childId}`);
          this._handleStatusChanged(childId, {
            status: statusResult.status,
            lastResult: statusResult.lastResult
          });
        }
      }).catch(e => {
        logger.warn(`[ProcessManager] waitChildAgent 状态查询失败: ${e}`);
      });
    });
  }

  /**
   * 终止分身
   */
  terminateChildAgent(childId: string): void {
    this.stopAgent(childId);
    logger.info(`[ProcessManager] 终止分身: ${childId}`);
  }

  /**
   * 获取并发状态
   */
  getConcurrencyStatus(): { active: number; max: number; available: number } {
    const maxChildren = 6; // CODEX 标准最大分身数
    let activeChildren = 0;

    for (const [id] of this.processes) {
      if (id.includes('-child-')) {
        activeChildren++;
      }
    }

    return {
      active: activeChildren,
      max: maxChildren,
      available: Math.max(0, maxChildren - activeChildren),
    };
  }

  /**
   * 获取所有智能体状态（用于分身管理）
   */
  getAllAgentStatus(): Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }> {
    const result = new Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>();

    for (const [id, info] of this.processes) {
      const isChild = id.includes('-child-');
      result.set(id, {
        type: info.type,
        status: this._mapAgentStatus(info.status, info.agentStatus),
        role: isChild ? 'worker' : 'main',
        nickname: info.nickname,
        model: info.config?.modelConfig?.name || 'default',
      });
    }

    return result;
  }

  /**
   * 获取所有智能体状态（数组格式，用于 IPC 传输）
   */
  getAllAgentStatusArray(): Array<{ id: string; type: string; status: string; role?: string; nickname?: string; model?: string; roleName?: string; roleDescription?: string; isCore?: boolean }> {
    const result: Array<{ id: string; type: string; status: string; role?: string; nickname?: string; model?: string; roleName?: string; roleDescription?: string; isCore?: boolean }> = [];

    // 首先添加 CORE 智能体（系统指挥官），始终在第一位
    result.push({
      id: 'ahivecore',
      type: 'core',
      status: 'idle',
      role: 'system-core',
      nickname: 'AHIVECORE',
      model: 'default',
      roleName: '系统指挥官',
      roleDescription: '系统核心智能体，负责工作流编排和智能体协调',
      isCore: true,
    });

    // 添加子进程智能体
    for (const [id, info] of this.processes) {
      const isChild = id.includes('-child-');
      result.push({
        id,
        type: info.type,
        status: this._mapAgentStatus(info.status, info.agentStatus),
        role: isChild ? 'worker' : 'main',
        nickname: info.nickname,
        model: info.config?.modelConfig?.name || 'default',
        roleName: isChild ? '工作智能体' : '主智能体',
        isCore: false,
      });
    }

    return result;
  }

  /**
   * 映射智能体状态为统一格式
   * @param processStatus 进程状态
   * @param agentStatus 智能体内部状态（可选，来自心跳）
   * @returns 统一状态: 'idle' | 'busy' | 'error' | 'offline'
   */
  private _mapAgentStatus(processStatus: AgentProcessStatus, agentStatus?: string): 'idle' | 'busy' | 'error' | 'offline' {
    // 进程崩溃或停止
    if (processStatus === AgentProcessStatus.Crashed) return 'error';
    if (processStatus === AgentProcessStatus.Stopped) return 'offline';
    if (processStatus !== AgentProcessStatus.Running) return 'offline';

    // 进程运行中，根据智能体内部状态判断
    if (agentStatus === 'running' || agentStatus === 'waiting') return 'busy';
    if (agentStatus === 'error') return 'error';

    // 默认空闲
    return 'idle';
  }

  /**
   * 获取主智能体 ID
   */
  getMainAgentId(): string | null {
    for (const [id, info] of this.processes) {
      if (!id.includes('-child-') && info.status === AgentProcessStatus.Running) {
        return id;
      }
    }
    return null;
  }

  /**
   * 获取活跃智能体
   */
  getActiveAgent(): string | null {
    return this.getMainAgentId();
  }

  /**
   * 关闭进程管理器，释放资源
   */
  close(): void {
    // 停止清理定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // 停止心跳检测
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // 清理所有 pending 条目
    this.pendingCalls.clear();
    this.streamListeners.clear();
    this.statusWatchers.clear();
    this.pendingMessageReplies.clear();
    this.finalStatusCache.clear();

    // 终止所有智能体进程
    for (const [id, info] of this.processes) {
      if (info.process) {
        try {
          info.process.kill();
        } catch (e) {
          // 忽略终止错误
        }
      }
    }
    this.processes.clear();

    logger.info('[ProcessManager] 进程管理器已关闭');
  }
}

// ==================== 导出 ====================

export default AgentProcessManager;