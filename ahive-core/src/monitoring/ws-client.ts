/**
 * AHIVECORE WebSocket 通讯模块
 * 
 * 功能：
 * - 内存监控数据推送
 * - 智能体工作直播（预留）
 * - A2A 通讯（预留）
 * - 系统状态广播
 * 
 * 架构：
 * ┌──────────────────┐
 * │  AHIVE 客户端     │
 * │  WS Server (3005) │ ◄─── 已有
 * └────────▲─────────┘
 *          │ WebSocket
 * ┌────────┴─────────┐
 * │  AHIVECORE        │
 * │  WS Client        │ ◄─── 本模块
 * └──────────────────┘
 */

import { logger } from '../utils/index.js';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { getConfig } from '../core/config.js';
import { join } from 'path';

// ==================== 类型定义 ====================

/**
 * 消息类型枚举
 */
export enum MessageType {
  // 系统消息
  MEMORY_UPDATE = 'memory_update',
  SYSTEM_STATUS = 'system_status',
  HEARTBEAT = 'heartbeat',
  
  // 智能体工作直播（预留）
  AGENT_THINKING = 'agent_thinking',
  AGENT_ACTION = 'agent_action',
  AGENT_RESULT = 'agent_result',
  AGENT_ERROR = 'agent_error',
  
  // A2A 通讯（预留）
  AGENT_MESSAGE = 'agent_message',
  AGENT_SPAWN = 'agent_spawn',
  AGENT_STATUS = 'agent_status',
  
  // 工作流直播（预留）
  WORKFLOW_NODE = 'workflow_node',
  WORKFLOW_PROGRESS = 'workflow_progress',
}

/**
 * WebSocket 消息基类（匹配客户端 StreamEvent）
 */
export interface WSMessage {
  type: 'event';
  payload: {
    type: string;
    agentId: string;
    agentName?: string;
    timestamp: number;
    data: any;
  };
}

/**
 * 内存更新消息
 */
export interface MemoryUpdateData {
  category: 'memory';
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  heapUsedPercent: number;
  peakHeapUsedMB: number;
  averageHeapUsedMB: number;
  uptimeSeconds: number;
  isWarning: boolean;
  warningMessage?: string;
  // 系统内存信息
  systemTotalMB: number;
  systemUsedMB: number;
  systemMemoryPercent: number;
}

/**
 * 智能体工作消息（预留）
 */
export interface AgentWorkData {
  category: 'agent_work';
  agentId: string;
  phase: 'thinking' | 'executing' | 'waiting' | 'completed';
  task?: string;
  progress?: number;
  output?: string;
  duration?: number;
}

/**
 * A2A 通讯消息（预留）
 */
export interface A2AMessageData {
  category: 'a2a';
  fromAgent: string;
  toAgent: string;
  content: string;
  messageType: 'task' | 'query' | 'response' | 'notification';
}

/**
 * WebSocket 客户端配置
 */
export interface WSClientConfig {
  /** WebSocket 服务器地址 */
  url: string;
  /** 重连间隔（毫秒） */
  reconnectInterval: number;
  /** 最大重连间隔（毫秒） */
  maxReconnectInterval: number;
  /** 心跳间隔（毫秒） */
  heartbeatInterval: number;
  /** 心跳超时（毫秒） */
  heartbeatTimeout: number;
  /** 是否自动重连 */
  autoReconnect: boolean;
  /** 最大重连次数（0 表示无限） */
  maxReconnectAttempts: number;
  /** 连接超时（毫秒） */
  connectionTimeout: number;
  /** 是否启用 */
  enabled: boolean;
  /** 降级模式：连接失败时不影响主程序 */
  gracefulDegradation: boolean;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: WSClientConfig = {
  url: 'ws://127.0.0.1:3005',
  reconnectInterval: 5000,
  maxReconnectInterval: 60000,  // 最大 60 秒
  heartbeatInterval: 30000,
  heartbeatTimeout: 10000,      // 10 秒无响应则断开
  autoReconnect: true,
  maxReconnectAttempts: 0,      // 0 表示无限重连
  connectionTimeout: 10000,     // 10 秒连接超时
  enabled: true,
  gracefulDegradation: true,    // 默认启用降级模式
};

/**
 * 从配置文件加载 WebSocket 配置
 */
function loadConfigFromFile(): Partial<WSClientConfig> {
  try {
    const config = getConfig().getConfig();
    
    if (config.websocket) {
      logger.info('[WSClient] 从全局配置缓存加载 WebSocket 配置');
      return {
        enabled: config.websocket.enabled ?? DEFAULT_CONFIG.enabled,
        url: config.websocket.url ?? DEFAULT_CONFIG.url,
        autoReconnect: config.websocket.autoReconnect ?? DEFAULT_CONFIG.autoReconnect,
        reconnectInterval: config.websocket.reconnectInterval ?? DEFAULT_CONFIG.reconnectInterval,
        maxReconnectInterval: config.websocket.maxReconnectInterval ?? DEFAULT_CONFIG.maxReconnectInterval,
        heartbeatInterval: config.websocket.heartbeatInterval ?? DEFAULT_CONFIG.heartbeatInterval,
        heartbeatTimeout: config.websocket.heartbeatTimeout ?? DEFAULT_CONFIG.heartbeatTimeout,
        connectionTimeout: config.websocket.connectionTimeout ?? DEFAULT_CONFIG.connectionTimeout,
        maxReconnectAttempts: config.websocket.maxReconnectAttempts ?? DEFAULT_CONFIG.maxReconnectAttempts,
        gracefulDegradation: config.websocket.gracefulDegradation ?? DEFAULT_CONFIG.gracefulDegradation,
      };
    }
  } catch (error) {
    logger.warn('[WSClient] 加载配置失败，使用默认配置:', error);
  }
  
  return {};
}

// ==================== WebSocket 客户端 ====================

/**
 * WebSocket 客户端类
 * 
 * 提供统一的通讯通道，支持：
 * - 内存监控推送
 * - 智能体工作直播（预留）
 * - A2A 通讯（预留）
 */
export class WSClient extends EventEmitter {
  private config: WSClientConfig;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatTimeoutTimer: NodeJS.Timeout | null = null;
  private connectionTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private messageQueue: WSMessage[] = [];
  
  // 健康状态跟踪
  private reconnectAttempts: number = 0;
  private currentReconnectInterval: number = 5000;
  private lastConnectedTime: number = 0;
  private lastHeartbeatResponse: number = 0;
  private isConnecting: boolean = false;
  private connectionDropped: boolean = false;

  // 请求-响应机制
  private pendingRequests: Map<string, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = new Map();

  constructor(config?: Partial<WSClientConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentReconnectInterval = this.config.reconnectInterval;
    
    // 设置最大监听器数量，避免内存泄漏警告
    this.setMaxListeners(50);
    
    // 捕获未处理的错误
    this.on('error', (error) => {
      logger.error('[WSClient] 未处理的错误:', error);
    });
  }

  /**
   * 启动客户端
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('[WSClient] WebSocket 客户端已禁用');
      return;
    }

    if (this.isRunning) {
      logger.warn('[WSClient] 客户端已在运行中');
      return;
    }

    this.isRunning = true;
    this.connect();
    logger.info(`[WSClient] 🚀 WebSocket 客户端启动: ${this.config.url}`);
  }

  /**
   * 停止客户端
   */
  stop(): void {
    this.isRunning = false;
    this.disconnect();
    logger.info('[WSClient] WebSocket 客户端已停止');
  }

  /**
   * 发送消息
   */
  send(message: WSMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // 连接断开时缓存消息
      this.messageQueue.push(message);
      if (this.messageQueue.length > 100) {
        this.messageQueue.shift(); // 限制队列大小
      }
    }
  }

  /**
   * 发送请求并等待响应（请求-响应模式）
   * 
   * 在消息 payload 中注入 requestId，对方需要在响应中回传该 requestId
   * 匹配到响应后 resolve Promise
   * 
   * @param message 请求消息
   * @param timeout 超时时间（毫秒），默认 10000
   * @returns 响应的 payload.data
   */
  sendRequest(message: WSMessage, timeout: number = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 注入 requestId 到 payload
      if (message.payload) {
        (message.payload as any).requestId = requestId;
      }

      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${timeout}ms (requestId: ${requestId})`));
      }, timeout);

      // 注册 pending request
      this.pendingRequests.set(requestId, { resolve, reject, timer });

      // 发送消息
      this.send(message);
      logger.info(`[WSClient] sendRequest: requestId=${requestId}, type=${message.payload?.type}`);
    });
  }

  /**
   * 发送内存更新消息
   */
  sendMemoryUpdate(data: MemoryUpdateData): void {
    this.send({
      type: 'event',
      payload: {
        type: 'status',
        agentId: 'system',
        timestamp: Date.now(),
        data,
      },
    });
  }

  /**
   * 发送智能体工作消息（预留）
   */
  sendAgentWork(data: AgentWorkData): void {
    this.send({
      type: 'event',
      payload: {
        type: 'status',
        agentId: data.agentId,
        timestamp: Date.now(),
        data,
      },
    });
  }

  /**
   * 发送 A2A 消息（预留）
   */
  sendA2AMessage(data: A2AMessageData): void {
    this.send({
      type: 'event',
      payload: {
        type: 'status',
        agentId: data.fromAgent,
        timestamp: Date.now(),
        data,
      },
    });
  }

  /**
   * 发送智能体间对话消息（agent_chat 直播）
   */
  sendAgentChat(data: {
    fromAgentId: string;
    fromAgentName?: string;
    toAgentId: string;
    toAgentName?: string;
    message: string;
    messageType?: string;
  }): void {
    this.send({
      type: 'event',
      payload: {
        type: 'agent-chat',
        agentId: data.fromAgentId,
        agentName: data.fromAgentName || data.fromAgentId,
        timestamp: Date.now(),
        data: {
          toAgentId: data.toAgentId,
          toAgentName: data.toAgentName || data.toAgentId,
          message: data.message,
          messageType: data.messageType || 'task',
        },
      },
    });
    logger.info(`[WSClient] 发送 agent_chat: ${data.fromAgentName} → ${data.toAgentName}`);
  }

  /**
   * 发送页面控制指令
   * 用于指挥官控制 Web 端页面切换
   */
  sendPageControl(command: {
    action: 'navigate' | 'open-dialog' | 'close-dialog' | 'toggle-panel' | 'highlight' | 'scroll-to' | 'update-state';
    target?: string;
    params?: Record<string, unknown>;
  }): void {
    this.send({
      type: 'event',
      payload: {
        type: 'page-control',
        agentId: 'ahivecore',
        agentName: 'AHIVECORE',
        timestamp: Date.now(),
        data: {
          action: command.action,
          target: command.target,
          params: command.params,
          source: 'ahivecore',
        },
      },
    });
    logger.info(`[WSClient] 发送 page_control: ${command.action} → ${command.target || 'default'}`);
  }

  /**
   * 发送工作流生成事件
   * 用于实时通知前端工作流生成进度
   */
  sendWorkflowGeneration(event: {
    event: 'layer-start' | 'layer-complete' | 'node-refining' | 'node-refined' | 'workflow-update' | 'workflow-ready';
    data: Record<string, unknown>;
  }): void {
    this.send({
      type: 'event',
      payload: {
        type: 'workflow-generation',
        agentId: 'ahivecore',
        agentName: 'AHIVECORE',
        timestamp: Date.now(),
        data: event,
      },
    });
    logger.info(`[WSClient] 发送 workflow_generation: ${event.event}`);
  }

  /**
   * 发送工作流创建完成事件
   * 用于通知前端刷新工作流列表
   */
  sendWorkflowCreated(workflow: {
    id: string;
    name: string;
    description?: string;
    filePath: string;
  }): void {
    this.send({
      type: 'event',
      payload: {
        type: 'workflow-created',
        agentId: 'ahivecore',
        agentName: 'AHIVECORE',
        timestamp: Date.now(),
        data: workflow,
      },
    });
    logger.info(`[WSClient] 发送 workflow_created: ${workflow.name} (${workflow.id})`);
  }

  /**
   * 发送配置同步事件
   * 用于实时通知前端配置变更
   */
  sendConfigSync(event: {
    action: 'get' | 'set' | 'save' | 'reset';
    key?: string;
    value?: unknown;
    config?: Record<string, unknown>;
  }): void {
    this.send({
      type: 'event',
      payload: {
        type: 'config-sync',
        agentId: 'ahivecore',
        agentName: 'AHIVECORE',
        timestamp: Date.now(),
        data: event,
      },
    });
    logger.info(`[WSClient] 发送 config_sync: ${event.action}`);
  }

  /**
   * 广播智能体状态（预留）
   */
  broadcastAgentStatus(agentId: string, status: string, details?: any): void {
    this.send({
      type: 'event',
      payload: {
        type: 'status',
        agentId,
        timestamp: Date.now(),
        data: {
          category: 'agent_status',
          status,
          ...details,
        },
      },
    });
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 获取队列中的消息数量
   */
  getQueueSize(): number {
    return this.messageQueue.length;
  }

  // ==================== 私有方法 ====================

  /**
   * 连接 WebSocket
   */
  private connect(): void {
    // 防止重复连接
    if (this.ws || this.isConnecting) {
      return;
    }

    // 检查最大重连次数
    if (this.config.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error(`[WSClient] 达到最大重连次数 ${this.config.maxReconnectAttempts}，停止重连`);
      this.isRunning = false;
      return;
    }

    this.isConnecting = true;
    this.reconnectAttempts++;

    try {
      logger.info(`[WSClient] 正在连接... (尝试 ${this.reconnectAttempts})`);
      this.ws = new WebSocket(this.config.url);

      // 设置连接超时
      this.connectionTimer = setTimeout(() => {
        if (this.isConnecting && !this.isConnected()) {
          logger.warn('[WSClient] 连接超时');
          this.handleConnectionFailure('Connection timeout');
        }
      }, this.config.connectionTimeout);

      this.ws.on('open', () => {
        this.isConnecting = false;
        this.clearConnectionTimer();
        this.reconnectAttempts = 0;
        this.currentReconnectInterval = this.config.reconnectInterval;
        this.lastConnectedTime = Date.now();
        this.connectionDropped = false;
        
        logger.info('[WSClient] ✅ 已连接');
        this.emit('connected');
        this.startHeartbeat();
        this.flushQueue();
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(`[WSClient] 连接断开 (code: ${code}, reason: ${reason || 'none'})`);
        this.handleDisconnection();
      });

      this.ws.on('error', (error) => {
        logger.error('[WSClient] 连接错误:', error.message);
        this.handleConnectionFailure(error.message);
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          this.handleMessage(data);
        } catch (error) {
          logger.error('[WSClient] 消息处理错误:', error);
        }
      });

      // 意外关闭处理
      this.ws.on('unexpected-response', (request, response) => {
        logger.error(`[WSClient] 意外响应: ${response.statusCode}`);
        this.handleConnectionFailure(`Unexpected response: ${response.statusCode}`);
      });

    } catch (error: any) {
      logger.error('[WSClient] 连接异常:', error?.message || error);
      this.handleConnectionFailure(error?.message || 'Unknown error');
    }
  }

  /**
   * 处理连接失败
   */
  private handleConnectionFailure(reason: string): void {
    this.isConnecting = false;
    this.clearConnectionTimer();
    
    // 清理 WebSocket
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (e) {
        // 忽略终止错误
      }
      this.ws = null;
    }

    this.emit('disconnected');
    
    // 降级模式：不影响主程序
    if (this.config.gracefulDegradation) {
      logger.warn(`[WSClient] 连接失败 (${reason})，进入降级模式，主程序继续运行`);
    }

    // 自动重连
    if (this.config.autoReconnect && this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /**
   * 处理断开连接
   */
  private handleDisconnection(): void {
    this.isConnecting = false;
    this.stopHeartbeat();
    this.clearConnectionTimer();
    this.connectionDropped = true;
    
    this.emit('disconnected');
    this.ws = null;
    
    if (this.config.autoReconnect && this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /**
   * 断开连接
   */
  private disconnect(): void {
    this.isRunning = false;
    this.stopHeartbeat();
    this.cancelReconnect();
    this.clearConnectionTimer();
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // 忽略关闭错误
      }
      this.ws = null;
    }
  }

  /**
   * 安排重连（指数退避）
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    // 指数退避：每次重连增加间隔，最大不超过 maxReconnectInterval
    const delay = Math.min(this.currentReconnectInterval, this.config.maxReconnectInterval);
    this.currentReconnectInterval = Math.min(this.currentReconnectInterval * 2, this.config.maxReconnectInterval);

    logger.info(`[WSClient] ${delay / 1000}秒后重连... (下次间隔: ${this.currentReconnectInterval / 1000}秒)`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRunning) {
        this.connect();
      }
    }, delay);
  }

  /**
   * 取消重连
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // 重置退避间隔
    this.currentReconnectInterval = this.config.reconnectInterval;
    this.reconnectAttempts = 0;
  }

  /**
   * 清除连接超时计时器
   */
  private clearConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeartbeatResponse = Date.now();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          
          // 设置心跳超时
          this.heartbeatTimeoutTimer = setTimeout(() => {
            const elapsed = Date.now() - this.lastHeartbeatResponse;
            if (elapsed > this.config.heartbeatTimeout) {
              logger.warn(`[WSClient] 心跳超时 (${elapsed}ms)，断开连接`);
              this.handleDisconnection();
            }
          }, this.config.heartbeatTimeout);
        } catch (error) {
          logger.error('[WSClient] 发送心跳失败:', error);
          this.handleDisconnection();
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      // 处理 pong 响应
      if (message.type === 'pong') {
        this.lastHeartbeatResponse = Date.now();
        // 清除心跳超时计时器
        if (this.heartbeatTimeoutTimer) {
          clearTimeout(this.heartbeatTimeoutTimer);
          this.heartbeatTimeoutTimer = null;
        }
        // 心跳响应使用 DEBUG 级别，避免刷屏
        logger.debug(`[WSClient] 💓 心跳响应 (pong)`);
        return;
      }

      // 🔍 DEBUG: 打印其他消息
      logger.info(`[WSClient] 📨 收到消息: type=${message.type}, payload.type=${message.payload?.type}`);

      // 处理请求-响应匹配
      if (message.type === 'event' && message.payload) {
        const requestId = (message.payload as any).requestId;
        if (requestId && this.pendingRequests.has(requestId)) {
          const pending = this.pendingRequests.get(requestId)!;
          clearTimeout(pending.timer);
          this.pendingRequests.delete(requestId);
          pending.resolve(message.payload);
          logger.info(`[WSClient] ✅ 请求响应匹配: requestId=${requestId}`);
          return;
        }
      }

      // 发送事件
      logger.info(`[WSClient] 🔄 转发消息给监听器 (监听器数量: ${this.listenerCount('message')})`);
      this.emit('message', message);
      
    } catch (error) {
      logger.error('[WSClient] 消息解析失败:', error);
    }
  }

  /**
   * 发送队列中的缓存消息
   */
  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }
}

// ==================== 全局实例 ====================

let globalWSClient: WSClient | null = null;

/**
 * 获取全局 WebSocket 客户端实例
 * 会自动从配置文件加载 WebSocket 配置
 */
export function getWSClient(config?: Partial<WSClientConfig>): WSClient {
  if (!globalWSClient) {
    // 先从配置文件加载，再应用传入的配置（传入的配置优先级更高）
    const fileConfig = loadConfigFromFile();
    globalWSClient = new WSClient({ ...fileConfig, ...config });
  }
  return globalWSClient;
}

/**
 * 启动全局 WebSocket 客户端
 * 会自动从配置文件加载 WebSocket 配置
 */
export function startWSClient(config?: Partial<WSClientConfig>): WSClient {
  const client = getWSClient(config);
  client.start();
  return client;
}

/**
 * 停止全局 WebSocket 客户端
 */
export function stopWSClient(): void {
  if (globalWSClient) {
    globalWSClient.stop();
  }
}

/**
 * 重置全局 WebSocket 客户端（用于完全重建连接）
 */
export function resetWSClient(): void {
  if (globalWSClient) {
    globalWSClient.stop();
    globalWSClient.removeAllListeners();
    globalWSClient = null;
  }
}

/**
 * 获取 WebSocket 健康状态
 */
export function getWSClientHealth(): {
  connected: boolean;
  reconnectAttempts: number;
  lastConnectedTime: number;
  queueSize: number;
  isRunning: boolean;
} {
  if (!globalWSClient) {
    return {
      connected: false,
      reconnectAttempts: 0,
      lastConnectedTime: 0,
      queueSize: 0,
      isRunning: false,
    };
  }
  
  return {
    connected: globalWSClient.isConnected(),
    reconnectAttempts: (globalWSClient as any).reconnectAttempts || 0,
    lastConnectedTime: (globalWSClient as any).lastConnectedTime || 0,
    queueSize: globalWSClient.getQueueSize(),
    isRunning: (globalWSClient as any).isRunning || false,
  };
}