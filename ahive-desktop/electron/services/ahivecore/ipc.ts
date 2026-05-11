/**
 * AHIVECORE IPC 注册
 * 注册 AHIVECORE 相关的 IPC 处理程序
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import { getAHIVECoreService } from './AHIVECoreService';
import { getWebSocketServer } from './WebSocketServer';
import { SSEBridge } from './SSEBridge';

// 模块级实例
let ahivecoreService: ReturnType<typeof getAHIVECoreService> | null = null;
let wsServer: ReturnType<typeof getWebSocketServer> | null = null;
let sseBridge: SSEBridge | null = null;

/**
 * 初始化 AHIVECORE 服务
 */
export async function initializeAHIVECORE(): Promise<void> {
  log.info('[AHIVECORE] Initializing...');

  try {
    // 初始化 AHIVECORE 服务
    ahivecoreService = getAHIVECoreService();
    await ahivecoreService.initialize();
    log.info('[AHIVECORE] Service initialized');

    // 启动 WebSocket Server
    wsServer = getWebSocketServer();
    await wsServer.start();
    log.info('[AHIVECORE] WebSocket Server started on port 3005');

    // 创建 SSE 桥接器
    sseBridge = new SSEBridge(wsServer);
    log.info('[AHIVECORE] SSE Bridge created');

    // 初始化工作流处理器（处理 workflow_task_assign 等事件）
    workflowHandler = new AHIVECoreWorkflowHandler(wsServer, ahivecoreService);
    workflowHandler.initialize();
    log.info('[AHIVECORE] Workflow handler initialized');

    // 注册 IPC 处理程序
    registerIPCHandlers();
    log.info('[AHIVECORE] IPC handlers registered');

  } catch (error) {
    log.error('[AHIVECORE] Initialization failed:', error);
    throw error;
  }
}

/**
 * 注册 IPC 处理程序
 */
function registerIPCHandlers(): void {
  // 获取 AHIVECORE 连接状态
  ipcMain.handle('ahivecore-get-status', () => {
    if (!ahivecoreService) {
      return { connected: false, state: 'disconnected', config: null };
    }
    return {
      connected: ahivecoreService.getConnectionState() === 'connected',
      state: ahivecoreService.getConnectionState(),
      config: ahivecoreService.getConfig()
    };
  });

  // 获取 AHIVECORE 智能体列表
  ipcMain.handle('ahivecore-get-agents', async () => {
    if (!ahivecoreService) {
      return { success: false, error: 'Service not initialized' };
    }
    try {
      const agents = await ahivecoreService.getAgents();
      return { success: true, agents };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 激活 AHIVECORE 智能体
  ipcMain.handle('ahivecore-activate-agent', async (_event, agentId: string) => {
    if (!ahivecoreService) {
      return { success: false, error: 'Service not initialized' };
    }
    try {
      const success = await ahivecoreService.activateAgent(agentId);
      return { success };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 获取 WebSocket 服务器状态
  ipcMain.handle('ahivecore-get-ws-status', () => {
    if (!wsServer) {
      return { running: false, clients: 0, clientIds: [] };
    }
    return {
      running: wsServer.getConnectionState() === 'connected',
      clients: wsServer.getClientCount(),
      clientIds: wsServer.getClientIds()
    };
  });

  // 启动 SSE 流式对话
  ipcMain.handle('ahivecore-start-stream', async (_event, agentId: string, message: string, sessionId?: string) => {
    if (!sseBridge) {
      return { success: false, error: 'SSE Bridge not initialized' };
    }
    try {
      await sseBridge.startStream(agentId, message, sessionId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 停止 SSE 流
  ipcMain.handle('ahivecore-stop-stream', async (_event, agentId: string) => {
    if (!sseBridge) {
      return { success: false, error: 'SSE Bridge not initialized' };
    }
    try {
      await sseBridge.stopStream(agentId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 发送用户输入
  ipcMain.handle('ahivecore-send-input', async (_event, agentId: string, input: string) => {
    if (!sseBridge) {
      return { success: false, error: 'SSE Bridge not initialized' };
    }
    try {
      await sseBridge.sendUserInput(agentId, input);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 中断对话
  ipcMain.handle('ahivecore-interrupt', async (_event, agentId: string) => {
    if (!sseBridge) {
      return { success: false, error: 'SSE Bridge not initialized' };
    }
    try {
      await sseBridge.interrupt(agentId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // 获取活跃流数量
  ipcMain.handle('ahivecore-get-active-streams', () => {
    if (!sseBridge) {
      return { count: 0 };
    }
    return { count: sseBridge.getActiveStreamCount() };
  });

  // 获取智能体状态
  ipcMain.handle('ahivecore-get-agent-state', (_event, agentId: string) => {
    if (!sseBridge) {
      return { state: null };
    }
    return { state: sseBridge.getAgentState(agentId) || null };
  });

  // ==================== 智能体管理 IPC ====================

  // 创建 AHIVECORE 智能体
  ipcMain.handle('ahivecore-create-agent', async (_event, config: {
    type: 'ahive-coder' | 'ahive-worker';
    nickname?: string;
    model?: {
      provider?: string;
      name?: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      baseUrl?: string;
    };
  }) => {
    if (!ahivecoreService) {
      return { success: false, error: 'Service not initialized' };
    }
    try {
      log.info('[AHIVECORE] Creating agent:', config.type, config.nickname);
      
      // 调用 AHIVECORE API 创建智能体
      const response = await ahivecoreService.createAgent(config);
      
      if (response.success && response.agent) {
        log.info('[AHIVECORE] Agent created:', response.agent.id);
        
        // 同步保存到 protocol-config.json (A2A 配置)
        const { saveA2AAgent } = require('../../storage');
        const a2aConfig = {
          id: `ahivecore-${response.agent.id}`,
          name: config.nickname || `${config.type}-${response.agent.id.slice(0, 4)}`,
          endpoint: ahivecoreService.getConfig()?.endpoint || 'http://127.0.0.1:18790',
          agentId: response.agent.id,
          protocolType: 'ahivecore',
          enabled: true,
          customFields: {
            endpoint: ahivecoreService.getConfig()?.endpoint || 'http://127.0.0.1:18790',
            agentId: response.agent.id,
            provider: config.model?.provider,
            model: config.model?.name,
          },
        };
        saveA2AAgent(a2aConfig);
        log.info('[AHIVECORE] A2A config saved for agent:', response.agent.id);
        
        return { success: true, agent: response.agent };
      }
      
      return { success: false, error: response.error || 'Failed to create agent' };
    } catch (error: any) {
      log.error('[AHIVECORE] Create agent error:', error);
      return { success: false, error: error.message };
    }
  });

  // 更新 AHIVECORE 智能体
  ipcMain.handle('ahivecore-update-agent', async (_event, agentId: string, config: {
    nickname?: string;
    model?: {
      provider?: string;
      name?: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      baseUrl?: string;
    };
  }) => {
    if (!ahivecoreService) {
      return { success: false, error: 'Service not initialized' };
    }
    try {
      log.info('[AHIVECORE] Updating agent:', agentId);
      
      // 调用 AHIVECORE API 更新智能体
      const response = await ahivecoreService.updateAgent(agentId, config);
      
      if (response.success) {
        log.info('[AHIVECORE] Agent updated:', agentId);
        
        // 同步更新 protocol-config.json (A2A 配置)
        const { getA2AAgent, saveA2AAgent } = require('../../storage');
        const existingA2A = getA2AAgent(`ahivecore-${agentId}`);
        
        if (existingA2A) {
          const updatedA2A = {
            ...existingA2A,
            name: config.nickname || existingA2A.name,
            customFields: {
              ...existingA2A.customFields,
              provider: config.model?.provider || existingA2A.customFields?.provider,
              model: config.model?.name || existingA2A.customFields?.model,
            },
          };
          saveA2AAgent(updatedA2A);
          log.info('[AHIVECORE] A2A config updated for agent:', agentId);
        }
        
        return { success: true, agent: response.agent };
      }
      
      return { success: false, error: response.error || 'Failed to update agent' };
    } catch (error: any) {
      log.error('[AHIVECORE] Update agent error:', error);
      return { success: false, error: error.message };
    }
  });

  // 删除 AHIVECORE 智能体
  ipcMain.handle('ahivecore-delete-agent', async (_event, agentId: string) => {
    if (!ahivecoreService) {
      return { success: false, error: 'Service not initialized' };
    }
    try {
      log.info('[AHIVECORE] Deleting agent:', agentId);
      
      // 调用 AHIVECORE API 删除智能体
      const response = await ahivecoreService.deleteAgent(agentId);
      
      if (response.success) {
        log.info('[AHIVECORE] Agent deleted:', agentId);
        
        // 同步删除 protocol-config.json (A2A 配置)
        const { deleteA2AAgent } = require('../../storage');
        deleteA2AAgent(`ahivecore-${agentId}`);
        log.info('[AHIVECORE] A2A config deleted for agent:', agentId);
        
        return { success: true };
      }
      
      return { success: false, error: response.error || 'Failed to delete agent' };
    } catch (error: any) {
      log.error('[AHIVECORE] Delete agent error:', error);
      return { success: false, error: error.message };
    }
  });
}

/**
 * 停止 AHIVECORE 服务
 */
export async function stopAHIVECORE(): Promise<void> {
  log.info('[AHIVECORE] Stopping...');

  if (workflowHandler) {
    workflowHandler.destroy();
    workflowHandler = null;
  }

  if (sseBridge) {
    await sseBridge.stopAll();
    sseBridge = null;
  }

  if (wsServer) {
    await wsServer.stop();
    wsServer = null;
  }

  if (ahivecoreService) {
    await ahivecoreService.stop();
    ahivecoreService = null;
  }

  log.info('[AHIVECORE] Stopped');
}

/**
 * 获取服务实例（供其他模块使用）
 */
export function getAHIVECOREServiceInstance() {
  return ahivecoreService;
}

export function getWebSocketServerInstance() {
  return wsServer;
}

export function getSSEBridgeInstance() {
  return sseBridge;
}