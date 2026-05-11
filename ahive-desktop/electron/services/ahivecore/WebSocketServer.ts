/**
 * WebSocket 服务器
 * 为 3D 界面提供实时双向通信
 */

import { EventEmitter } from 'events';
import WebSocket, { WebSocketServer as WSServer } from 'ws';
import { StreamEvent, AgentCommand, ConnectionState, WebSocketMessage, WorkflowEvent } from './types';
import { AHIVECoreConfig, defaultConfig } from './config';
import { 
  getAgentAnimationManager, 
  updateAnimationFromWorkflowEvent,
  type AgentAnimationState 
} from '../../workflow/animation/AgentAnimation';

// 导入 WorkflowScheduler 类型（用于工作流控制）
import type { WorkflowScheduler } from '../../workflow/core/WorkflowScheduler';

export interface WebSocketClient {
  id: string;
  socket: WebSocket;
  subscriptions: Set<string>; // 订阅的 agentId
  lastPing: number;
}

export class WebSocketServer extends EventEmitter {
  private config: AHIVECoreConfig;
  private wss: WSServer | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private connectionState: ConnectionState = 'disconnected';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private workflowScheduler: WorkflowScheduler | null = null;

  constructor(config?: Partial<AHIVECoreConfig>) {
    super();
    this.config = { ...defaultConfig, ...config };
    
    // 初始化动画管理器并设置广播回调
    const animationManager = getAgentAnimationManager();
    animationManager.setBroadcastCallback((event) => {
      // 将动画事件广播给所有订阅的客户端
      this.broadcastAnimationEvent(event);
    });
    console.log('[WebSocketServer] Animation manager initialized');
  }

  /**
   * 启动 WebSocket 服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // 如果已经启动，先停止
        if (this.wss) {
          console.log('[WebSocketServer] Already running, stopping first...');
          this.wss.close();
          this.wss = null;
        }

        this.connectionState = 'connecting';
        
        this.wss = new WSServer({
          port: this.config.websocketPort,
          perMessageDeflate: false, // 禁用压缩以提高性能
          clientTracking: true,
        });

        this.wss.on('listening', () => {
          console.log(`[WebSocketServer] Listening on port ${this.config.websocketPort}`);
          this.connectionState = 'connected';
          this.emit('started');
          resolve();
        });

        this.wss.on('connection', (socket, request) => {
          try {
            this.handleConnection(socket, request);
          } catch (error) {
            console.error('[WebSocketServer] Error handling connection:', error);
          }
        });

        this.wss.on('error', (error) => {
          console.error('[WebSocketServer] Server error:', error);
          this.connectionState = 'error';
          this.emit('error', error);
          
          // 如果是端口占用错误，尝试重启
          if ((error as any).code === 'EADDRINUSE') {
            console.log('[WebSocketServer] Port in use, will retry...');
          }
          
          reject(error);
        });

        this.wss.on('close', () => {
          console.log('[WebSocketServer] Server closed unexpectedly');
          this.connectionState = 'disconnected';
          this.emit('stopped');
        });

        // 启动心跳检测
        this.startHeartbeat();
        
      } catch (error) {
        console.error('[WebSocketServer] Failed to start:', error);
        this.connectionState = 'error';
        reject(error);
      }
    });
  }

  /**
   * 处理新连接
   */
  private handleConnection(socket: WebSocket, request: any): void {
    const clientId = this.generateClientId();
    const client: WebSocketClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);
    console.log(`[WebSocketServer] Client connected: ${clientId}`);

    socket.on('message', (data: Buffer) => {
      this.handleMessage(client, data);
    });

    socket.on('close', () => {
      this.handleDisconnect(clientId);
    });

    socket.on('error', (error) => {
      console.error(`[WebSocketServer] Client ${clientId} error:`, error);
      this.handleDisconnect(clientId);
    });

    // 发送欢迎消息
    this.sendToClient(client, {
      type: 'event',
      payload: {
        type: 'status',
        agentId: 'system',
        timestamp: Date.now(),
        data: {
          state: 'connected',
          message: `Welcome! Your client ID is ${clientId}`,
        },
      } as StreamEvent,
    });

    this.emit('client-connected', clientId);
  }

/**
    * 处理客户端消息
    */
  private handleMessage(client: WebSocketClient, data: Buffer): void {
    // 收到任何消息都更新 lastPing（不仅限于 ping）
    client.lastPing = Date.now();
    
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      
      // 🔍 DEBUG: 打印所有收到的消息
      console.log(`[WebSocketServer] 📨 收到消息 from ${client.id}:`, JSON.stringify(message, null, 2));
      
      switch (message.type) {
        case 'ping':
          this.sendToClient(client, { type: 'pong', payload: null });
          break;

        case 'command':
          if (message.payload) {
            this.handleCommand(client, message.payload as AgentCommand);
          }
          break;

        case 'event':
          // 客户端发送的事件，转发给订阅者
          if (message.payload) {
            const event = message.payload as StreamEvent;
            console.log(`[WebSocketServer] 🔄 转发事件: type=${event.type}, agentId=${event.agentId}`);
            
            // 检查工作流相关事件类型
            if (event.type === 'workflow_task_assign' || 
                event.type === 'workflow_task_query' || 
                event.type === 'workflow_agent_wakeup' ||
                event.type === 'workflow_node_complete' ||
                event.type === 'task_complete' ||
                event.type === 'task_failed' ||
                event.type === 'status_report') {
              this.handleWorkflowEvent(client, event as WorkflowEvent);
            } else if (event.type === 'workflow-control') {
              // 工作流控制命令（来自 AHIVECORE 指挥官）
              this.handleWorkflowControl(event, client);
            } else {
              this.broadcastEvent(event, client.id);
            }
          }
          break;

        default:
          console.warn(`[WebSocketServer] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[WebSocketServer] Failed to parse message:', error);
    }
  }

  /**
   * 处理工作流事件
   */
  private handleWorkflowEvent(client: WebSocketClient, event: WorkflowEvent): void {
    console.log(`[WebSocketServer] Workflow event received: ${event.type} from ${client.id}`);
    
    // 转发给外部处理器（如 AHIVECoreWSClient）
    this.emit('workflow-event', event, client.id);
  }

  /**
   * 处理工作流控制命令（来自 AHIVECORE 指挥官）
   * 支持 execute、pause、resume、stop、list-active 等操作
   */
  private async handleWorkflowControl(event: StreamEvent, sourceClient?: WebSocketClient): Promise<void> {
    console.log(`[WebSocketServer] Workflow control command received:`, event);
    
    // 提取 requestId（用于请求-响应匹配）
    const requestId = (event as any).requestId;
    
    const data = event.data as {
      action: 'execute' | 'pause' | 'resume' | 'stop' | 'list-active';
      workflowId?: string;
      instanceId?: string;
      variables?: Record<string, unknown>;
      reason?: string;
    };
    
    if (!data || !data.action) {
      console.warn('[WebSocketServer] Invalid workflow control command: missing action');
      return;
    }
    
    // 如果有 workflowScheduler，直接执行控制操作
    if (this.workflowScheduler) {
      try {
        let result: { success: boolean; message?: string; data?: any } = { success: false };
        
        switch (data.action) {
          case 'execute':
            if (data.workflowId) {
              // ✅ 先执行启动检测（不弹出界面，直接在后端检测）
              console.log(`[WebSocketServer] Performing startup checks for ${data.workflowId}...`);
              
              // 获取工作流名称
              const workflow = this.workflowScheduler.getWorkflow?.(data.workflowId);
              const workflowName = workflow?.name || data.workflowId;
              
              // 广播检测开始状态给前端（让按钮显示"检测中"）
              this.broadcastAll({
                type: 'workflow-startup-check-started',
                agentId: 'workflow-scheduler',
                timestamp: Date.now(),
                data: {
                  workflowId: data.workflowId,
                  workflowName,
                  status: 'checking',
                },
              });
              
              // 执行启动检测
              const startupCheck = await this.workflowScheduler.performStartupChecks(data.workflowId, {
                projectId: data.projectId,
                skipChecks: data.skipChecks,
              });
              
              // 广播检测结果给前端
              this.broadcastAll({
                type: 'workflow-startup-check-result',
                agentId: 'workflow-scheduler',
                timestamp: Date.now(),
                data: {
                  workflowId: data.workflowId,
                  workflowName,
                  canProceed: startupCheck.canProceed,
                  steps: startupCheck.steps,
                  checkResult: startupCheck,
                },
              });
              
              if (!startupCheck.canProceed) {
                // ✅ 检测未通过，返回详细原因给指挥官
                const failedSteps = startupCheck.steps.filter(s => s.status === 'failed');
                const failedReasons = failedSteps.map(s => `${s.name}: ${s.error || '检测失败'}`).join('\n');
                
                result = { 
                  success: false, 
                  message: `启动检测未通过:\n${failedReasons}`,
                  data: { 
                    startupCheck,
                    failedSteps: failedSteps.map(s => ({
                      id: s.id,
                      name: s.name,
                      error: s.error,
                      details: s.details,
                    })),
                  },
                };
                console.log(`[WebSocketServer] Startup checks failed for ${data.workflowId}: ${failedReasons}`);
              } else {
                // ✅ 检测通过，执行工作流
                const executeResult = await this.workflowScheduler.execute(data.workflowId, data.variables, {
                  projectId: data.projectId,
                  triggeredBy: data.triggeredBy || 'commander',
                  skipChecks: true, // 已经检测过了，跳过重复检测
                });
                
                if (executeResult.success) {
                  result = { 
                    success: true, 
                    message: `工作流已启动（检测通过）`, 
                    data: { 
                      instanceId: executeResult.instanceId,
                      startupCheck,
                    },
                  };
                  console.log(`[WebSocketServer] Workflow executed: ${data.workflowId} -> ${executeResult.instanceId}`);
                  
                  // 广播工作流启动成功事件
                  this.broadcastAll({
                    type: 'workflow-started',
                    agentId: 'workflow-scheduler',
                    timestamp: Date.now(),
                    data: {
                      workflowId: data.workflowId,
                      workflowName,
                      instanceId: executeResult.instanceId,
                      status: 'running',
                    },
                  });
                } else {
                  result = { 
                    success: false, 
                    message: executeResult.error || '工作流启动失败',
                    data: { startupCheck },
                  };
                }
              }
            } else {
              result = { success: false, message: '缺少 workflowId 参数' };
            }
            break;
            
          case 'pause':
            if (data.instanceId) {
              await this.workflowScheduler.pause(data.instanceId, data.reason);
              result = { success: true, message: `工作流已暂停: ${data.instanceId}` };
              console.log(`[WebSocketServer] Workflow paused: ${data.instanceId}`);
            } else {
              result = { success: false, message: '缺少 instanceId 参数' };
            }
            break;
            
          case 'resume':
            if (data.instanceId) {
              await this.workflowScheduler.resume(data.instanceId);
              result = { success: true, message: `工作流已恢复: ${data.instanceId}` };
              console.log(`[WebSocketServer] Workflow resumed: ${data.instanceId}`);
            } else {
              result = { success: false, message: '缺少 instanceId 参数' };
            }
            break;
            
          case 'stop':
            if (data.instanceId) {
              const stopped = await this.workflowScheduler.stopWorkflow(data.instanceId);
              if (stopped) {
                result = { success: true, message: `工作流已停止: ${data.instanceId}` };
                console.log(`[WebSocketServer] Workflow stopped: ${data.instanceId}`);
              } else {
                result = { success: false, message: `工作流实例不存在: ${data.instanceId}` };
                console.warn(`[WebSocketServer] Workflow stop failed, instance not found: ${data.instanceId}`);
              }
            } else {
              result = { success: false, message: '缺少 instanceId 参数' };
            }
            break;
            
          case 'list-active':
            const activeInstances = this.workflowScheduler.getActiveInstances();
            result = { 
              success: true, 
              message: `当前有 ${activeInstances.length} 个活跃工作流`,
              data: { instances: activeInstances }
            };
            console.log(`[WebSocketServer] Active workflows: ${activeInstances.length}`);
            break;
            
          default:
            result = { success: false, message: `未知的控制操作: ${data.action}` };
        }
        
        // 构造响应事件
        const responseEvent: StreamEvent = {
          type: 'workflow-control-response',
          agentId: 'ahivecore',
          timestamp: Date.now(),
          data: {
            action: data.action,
            workflowId: data.workflowId,
            instanceId: data.instanceId,
            status: result.success ? 'completed' : 'failed',
            message: result.message,
            result: result.data,
          },
        };
        
        // 如果有 requestId，回传给请求方以支持请求-响应模式
        if (requestId) {
          (responseEvent as any).requestId = requestId;
        }
        
        // 广播结果给所有客户端
        this.broadcastAll(responseEvent);
        
      } catch (error) {
        console.error(`[WebSocketServer] Workflow control error:`, error);
        const errorEvent: StreamEvent = {
          type: 'workflow-control-response',
          agentId: 'ahivecore',
          timestamp: Date.now(),
          data: {
            action: data.action,
            instanceId: data.instanceId,
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        };
        if (requestId) {
          (errorEvent as any).requestId = requestId;
        }
        this.broadcastAll(errorEvent);
      }
    } else {
      // 没有 workflowScheduler，发射事件让外部处理器处理
      console.warn('[WebSocketServer] No workflowScheduler set, emitting event for external handler');
      this.emit('workflow-control', event.data);
      
      // 广播处理中状态
      const processingEvent: StreamEvent = {
        type: 'workflow-control-response',
        agentId: 'ahivecore',
        timestamp: Date.now(),
        data: {
          action: data.action,
          instanceId: data.instanceId,
          status: 'processing',
        },
      };
      if (requestId) {
        (processingEvent as any).requestId = requestId;
      }
      this.broadcastAll(processingEvent);
    }
  }

  /**
   * 处理智能体指令
   */
  private handleCommand(client: WebSocketClient, command: AgentCommand): void {
    console.log(`[WebSocketServer] Command received: ${command.type} for agent ${command.agentId}`);
    
    // 根据指令类型处理订阅
    switch (command.type) {
      case 'subscribe':
        if (command.agentId) {
          client.subscriptions.add(command.agentId);
          console.log(`[WebSocketServer] Client ${client.id} subscribed to agent ${command.agentId}`);
        }
        break;

      case 'unsubscribe':
        if (command.agentId) {
          client.subscriptions.delete(command.agentId);
          console.log(`[WebSocketServer] Client ${client.id} unsubscribed from agent ${command.agentId}`);
        }
        break;

      default:
        // 转发给其他处理器
        this.emit('command', command, client.id);
    }
  }

  /**
   * 处理工作流事件广播（从客户端广播的 workflow_task_assign 等）
   */
  private handleWorkflowEventBroadcast(event: StreamEvent, excludeClientId?: string): void {
    console.log(`[WebSocketServer] Workflow event broadcast: ${event.type}`);
    
    // 发射事件供 AHIVECORE 内部处理
    this.emit('workflow-event', event);
    
    // 同时广播给其他客户端（如果需要）
    this.broadcastEvent(event, excludeClientId);
  }

  /**
   * 处理客户端断开连接
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      console.log(`[WebSocketServer] Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
      this.emit('client-disconnected', clientId);
    }
  }

  /**
   * 发送消息给客户端
   */
  private sendToClient(client: WebSocketClient, message: WebSocketMessage): void {
    try {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error(`[WebSocketServer] Failed to send to client ${client.id}:`, error);
    }
  }

  /**
   * 广播事件给订阅的客户端
   */
  broadcastEvent(event: StreamEvent, excludeClientId?: string): void {
    const message: WebSocketMessage = {
      type: 'event',
      payload: event,
    };

    console.log(`[WebSocketServer] broadcastEvent called: type=${event.type}, agentId=${event.agentId}, clients=${this.clients.size}`);

    // 根据事件类型自动更新动画状态
    // 工作流事件可能没有 agentId，需要从事件数据中提取
    const agentIds = this.extractAgentIdsFromEvent(event);
    if (agentIds.length > 0 && event.type) {
      agentIds.forEach(agentId => {
        updateAnimationFromWorkflowEvent(agentId, event.type, event);
      });
    }

    let sentCount = 0;
    this.clients.forEach((client, clientId) => {
      if (excludeClientId && clientId === excludeClientId) return;
      
      console.log(`[WebSocketServer] Client ${clientId}: subscriptions=${Array.from(client.subscriptions)}`);
      
      // 检查是否订阅了该智能体
      if (client.subscriptions.has(event.agentId) || client.subscriptions.has('*')) {
        this.sendToClient(client, message);
        sentCount++;
        console.log(`[WebSocketServer] Sent to client ${clientId}`);
      }
    });
    
    console.log(`[WebSocketServer] broadcastEvent(${event.type}, agentId=${event.agentId}) sent to ${sentCount} clients`);
  }

  /**
   * 广播给所有客户端
   */
  broadcastAll(event: StreamEvent): void {
    const message: WebSocketMessage = {
      type: 'event',
      payload: event,
    };

    this.clients.forEach((client) => {
      this.sendToClient(client, message);
    });
  }

  /**
   * 广播动画事件
   */
  broadcastAnimationEvent(event: any): void {
    const animationEvent: StreamEvent = {
      type: `animation-${event.type}`,
      agentId: event.agentId,
      timestamp: event.timestamp,
      ...event.data,
    };
    
    this.broadcastAll(animationEvent);
    console.log(`[WebSocketServer] Animation event broadcast: type=${event.type}, agentId=${event.agentId}`);
  }

  /**
   * 更新智能体动画状态（供外部调用）
   */
  updateAgentAnimationState(agentId: string, state: AgentAnimationState): void {
    const animationManager = getAgentAnimationManager();
    animationManager.updateState(agentId, state);
  }

  /**
   * 从事件中提取智能体ID列表
   * 工作流事件可能没有直接的 agentId，需要从不同字段提取
   */
  private extractAgentIdsFromEvent(event: StreamEvent): string[] {
    const agentIds: string[] = [];
    
    // 1. 直接的 agentId（排除 workflow-engine 这种特殊值）
    if (event.agentId && event.agentId !== 'workflow-engine' && event.agentId !== 'workflow-scheduler') {
      agentIds.push(event.agentId);
    }
    
    // 2. toAgentId 字段（agent-chat 事件的接收者，在顶层）
    if ((event as any).toAgentId) {
      agentIds.push((event as any).toAgentId);
    }
    
    // 3. 从 data 中提取
    if (event.data) {
      // data.agentId 字段（workflow_task_start 等事件）
      if (event.data.agentId) {
        agentIds.push(event.data.agentId);
      }
      // data.toAgentId 字段（agent-chat 事件的接收者）
      if (event.data.toAgentId) {
        agentIds.push(event.data.toAgentId);
      }
      // participatingAgents 数组
      if (Array.isArray(event.data.participatingAgents)) {
        agentIds.push(...event.data.participatingAgents);
      }
      // executors 数组（节点执行者）
      if (Array.isArray(event.data.executors)) {
        event.data.executors.forEach((exec: any) => {
          if (exec.type === 'agent' && exec.id) {
            agentIds.push(exec.id);
          }
        });
      }
    }
    
    // 去重
    return [...new Set(agentIds)];
  }

  /**
   * 发送指令给特定客户端
   */
  sendCommand(clientId: string, command: AgentCommand): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      this.sendToClient(client, {
        type: 'command',
        payload: command,
      });
      return true;
    }
    return false;
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval * 2;

      this.clients.forEach((client, clientId) => {
        if (now - client.lastPing > timeout) {
          console.log(`[WebSocketServer] Client ${clientId} timeout, closing`);
          client.socket.close();
          this.handleDisconnect(clientId);
        }
      });
    }, this.config.heartbeatInterval);
  }

  /**
   * 生成客户端 ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 设置 WorkflowScheduler（用于处理 workflow-control 命令）
   */
  setWorkflowScheduler(scheduler: WorkflowScheduler): void {
    this.workflowScheduler = scheduler;
    console.log('[WebSocketServer] WorkflowScheduler set');
  }

  /**
   * 获取连接状态
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * 获取客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 获取所有客户端 ID
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    console.log('[WebSocketServer] Stopping...');

    this.stopHeartbeat();

    // 关闭所有客户端连接
    this.clients.forEach((client) => {
      try {
        client.socket.close();
      } catch (e) {
        // 忽略关闭错误
      }
    });
    this.clients.clear();

    // 关闭服务器
    if (this.wss) {
      await new Promise<void>((resolve) => {
        try {
          this.wss!.close(() => {
            console.log('[WebSocketServer] Server closed');
            resolve();
          });
        } catch (e) {
          console.error('[WebSocketServer] Error closing server:', e);
          resolve();
        }
      });
      this.wss = null;
    }

    this.connectionState = 'disconnected';
    this.emit('stopped');
    console.log('[WebSocketServer] Stopped');
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 重启服务器
   */
  async restart(): Promise<void> {
    console.log('[WebSocketServer] Restarting...');
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000)); // 等待端口释放
    await this.start();
    console.log('[WebSocketServer] Restarted');
  }

  /**
   * 获取服务器健康状态
   */
  getHealth(): {
    state: ConnectionState;
    clientCount: number;
    uptime: number;
    port: number;
  } {
    return {
      state: this.connectionState,
      clientCount: this.clients.size,
      uptime: this.wss ? Date.now() : 0,
      port: this.config.websocketPort,
    };
  }
}

// 单例实例
let serverInstance: WebSocketServer | null = null;

export function getWebSocketServer(config?: Partial<AHIVECoreConfig>): WebSocketServer {
  if (!serverInstance) {
    serverInstance = new WebSocketServer(config);
  }
  return serverInstance;
}

/**
 * 重置 WebSocket 服务器（用于完全重建）
 */
export function resetWebSocketServer(): void {
  if (serverInstance) {
    serverInstance.stop().catch(console.error);
    serverInstance.removeAllListeners();
    serverInstance = null;
  }
}