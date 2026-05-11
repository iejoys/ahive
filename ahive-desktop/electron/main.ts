import { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage, dialog } from 'electron';
import { join } from 'path';
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync, watch } from 'fs';
import log from 'electron-log';
import { spawn, exec, ChildProcess } from 'child_process';
import {
  getOpenClawAgents,
  getOpenClawPathInfo,
  sendMessageToAgent,
  checkGatewayStatus,
  executeCLISafe,
  executeCLI,
  validateAgentName,
  validateMessage,
  getOpenClawPath
} from './cli-bridge';

import {
  loadData,
  saveData,
  getScheduledTasks,
  saveScheduledTask,
  deleteScheduledTask,
  toggleScheduledTask,
  addTaskRun,
  getTaskRuns,
  getDataDirectory,
  // 工作流
  getWorkflows,
  getWorkflow,
  saveWorkflow,
  deleteWorkflow,
  workflowNameExists,
  importWorkflowFromContent,
  listWorkflowFiles,
  renameWorkflow,
  // 黑板（旧 API）
  getBlackboardState,
  saveBlackboardState,
  updateBlackboardVariable,
  deleteBlackboardVariable,
  addBlackboardEvent,
  // 黑板（新 API - 分文件存储）
  getGlobalVariables,
  saveGlobalVariables,
  updateGlobalVariable,
  deleteGlobalVariable,
  getWorkflowVariables,
  saveWorkflowVariables,
  updateWorkflowVariable,
  deleteWorkflowVariable,
  clearWorkflowVariables,
  deleteWorkflowDataDir,
  getAllWorkflowVariables,
  // 部门
  getDepartments,
  getDepartment,
  saveDepartment,
  saveDepartments,
  deleteDepartment,
  addDepartmentMember,
  removeDepartmentMember,
  // 中断记录
  getInterruptions,
  getUnrecoveredInterruptions,
  saveInterruption,
  markInterruptionRecovered,
  deleteInterruption,
  cleanupOldInterruptions,
  // 执行状态
  getExecutionState,
  getAllExecutionStates,
  saveExecutionState,
  deleteExecutionState,
  cleanupExecutionStates,
  // 工作流执行日志
  saveWorkflowExecutionLog,
  getWorkflowExecutionLog,
  getWorkflowExecutionLogs,
  deleteWorkflowExecutionLog,
  cleanupWorkflowExecutionLogs,
  getWorkflowLogStats,
  rebuildWorkflowLogIndex,
  // MCP/A2A 协议存储
  getMCPServers,
  getMCPServer,
  saveMCPServer,
  deleteMCPServer,
  toggleMCPServer,
  getA2AAgents,
  getA2AAgent,
  saveA2AAgent,
  toggleA2AAgent,
  // MCP API 配置
  getMCPApiConfigs,
  getMCPApiConfig,
  saveMCPApiConfig,
  deleteMCPApiConfig,
  toggleMCPApiConfig,
  getProtocolConfig,
  saveProtocolConfig,
  // Agent 技能持久化
  getAgents,
  getAgent,
  saveAgent,
  updateAgentSkills,
  deleteAgent,
  saveAgents,
  // 工作流模板
  getWorkflowTemplates,
  getWorkflowTemplate,
  saveWorkflowTemplate,
  deleteWorkflowTemplate
} from './storage';

// MCP/A2A 协议管理器
import { mcpManager } from './mcp/MCPManager';
import { a2aManager } from './a2a/A2AManager';

// MCP API 协议加载器
import { mcpApiProtocolLoader } from './mcp-api/config/MCPApiProtocolLoader';

// MCP HTTP API 服务
import { mcpHttpServer } from './mcp/MCPHttpServer';
import { capabilityManager } from './mcp/CapabilityManager';
import { keyManager } from './mcp/KeyManager';

// A2A HTTP API 服务
import { A2AHttpServer } from './a2a/A2AHttpServer';

// 工作流监控服务
import { workflowMonitor } from './services/WorkflowMonitor';

// LLM Center 服务
import { llmCenterService } from './services/LLMCenterService';

// LLM Gateway 服务
import { llmGateway } from './services/LLMGateway';

// MCP 能力推送服务
import { capabilityPusher } from './mcp/CapabilityPusher';
import { gatewayMessenger } from './mcp/GatewayMessengerImpl';

// AHIVECORE 集成服务
import { 
  AHIVECoreService, 
  getAHIVECoreService 
} from './services/ahivecore/AHIVECoreService';
import { 
  WebSocketServer, 
  getWebSocketServer 
} from './services/ahivecore/WebSocketServer';
import { SSEBridge } from './services/ahivecore/SSEBridge';
import { StreamBroadcaster, getStreamBroadcaster } from './services/ahivecore/StreamBroadcaster';

// 工作流执行引擎
import { WorkflowScheduler, type WorkflowSchedulerConfig } from './workflow';
import type { Agent, Workflow, WorkflowEvent } from './workflow/types';

const configPath = app.isPackaged
  ? join(process.resourcesPath, 'config.json')
  : join(__dirname, '..', 'config.json');

interface WorkflowConfig {
  heartbeatInterval?: number;  // 心跳间隔（毫秒），默认 3 分钟
  pollInterval?: number;       // 任务询问间隔（毫秒），默认 30 分钟
}

interface AppConfig {
  webUrl: string;
  apiUrl: string;
  workflow?: WorkflowConfig;
}

let appConfig: AppConfig = { 
  webUrl: 'http://localhost:5173', 
  apiUrl: 'http://localhost:3001',
  workflow: {
    heartbeatInterval: 180000,  // 3 分钟
    pollInterval: 1800000,      // 30 分钟
  }
};

if (existsSync(configPath)) {
  try {
    appConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    log.info('Loaded config from:', configPath);
  } catch (e) {
    log.warn('Failed to load config, using defaults');
  }
} else {
  log.warn('Config file not found, using defaults:', configPath);
}

const WEB_URL = appConfig.webUrl;
const API_URL = appConfig.apiUrl;

// 自定义日志路径到项目目录
const logDir = join(process.cwd(), 'logs');

// 确保日志目录存在
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// 按日期分割日志文件：main-2026-03-10.log
log.transports.file.resolvePathFn = (vars) => {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(logDir, `main-${date}.log`);
};

// 日志配置
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 单文件最大 10MB
log.info('AHIVE Desktop starting...');
log.info('Web URL:', WEB_URL);
log.info('API URL:', API_URL);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let gatewayProcess: ChildProcess | null = null;
let gatewayStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
let gatewayErrorMsg = '';
let capabilityPusherInitialized = false; // 防止重复初始化
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// A2A HTTP Server 实例
let a2aHttpServer: InstanceType<typeof import('./a2a/A2AHttpServer').A2AHttpServer> | null = null;

// AHIVECORE 服务实例
let ahivecoreService: AHIVECoreService;
let wsServer: WebSocketServer;
let sseBridge: SSEBridge;

// 工作流调度器实例
let workflowScheduler: WorkflowScheduler | null = null;
let workflowStateDB: WorkflowStateDB | null = null;


// ==================== 网关管理 ====================

/**
 * 启动 OpenClaw 网关
 */
async function startGateway(): Promise<{ success: boolean; error?: string }> {
  if (gatewayStatus === 'running') {
    return { success: true };
  }

  // 检查是否已有网关在运行
  log.info('Checking existing gateway...');

  // 使用安全的参数化执行
  const { program: checkProgram, scriptPath: checkScriptPath } = getOpenClawPathInfo();
  const checkArgs = checkScriptPath
    ? [checkScriptPath, 'gateway', 'status']
    : ['gateway', 'status'];
  const checkResult = await executeCLISafe(checkProgram, checkArgs);

  if (checkResult.success && checkResult.stdout.includes('Listening:')) {
    // 提取现有网关端口
    const portMatch = checkResult.stdout.match(/Listening:[\s\S]*?:(\d+)/);
    if (portMatch) {
      log.info('Found existing gateway on port:', portMatch[1]);
      gatewayStatus = 'running';
      notifyGatewayStatus();
      return { success: true };
    }
  }

  log.info('Starting OpenClaw Gateway...');
  gatewayStatus = 'starting';
  notifyGatewayStatus();

  // 使用 getOpenClawPathInfo 获取结构化路径信息
  const { program, scriptPath } = getOpenClawPathInfo();

  // 构建正确的参数数组
  const args = scriptPath
    ? [scriptPath, 'gateway', 'start']
    : ['gateway', 'start'];

  return new Promise((resolve) => {
    try {
      log.info(`[Gateway] Spawning: ${program} ${args.join(' ')}`);

      gatewayProcess = spawn(program, args, {
        shell: false,  // 安全：禁用 shell，防止命令注入
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      let startupOutput = '';
      let errorOutput = '';

      gatewayProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        startupOutput += text;
        log.info('[Gateway stdout]', text);

        // 检测启动成功
        if (text.includes('Gateway started') || text.includes('http://') || text.includes('WebSocket')) {
          gatewayStatus = 'running';
          notifyGatewayStatus();
          log.info('Gateway started successfully');
        }
      });

      gatewayProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        log.warn('[Gateway stderr]', text);
      });

      gatewayProcess.on('error', (err) => {
        log.error('Gateway process error:', err);
        gatewayStatus = 'error';
        gatewayErrorMsg = err.message;
        notifyGatewayStatus();
        resolve({ success: false, error: err.message });
      });

      gatewayProcess.on('exit', (code) => {
        log.info('Gateway exited with code:', code);
        if (code !== 0 && gatewayStatus !== 'stopped') {
          gatewayStatus = 'error';
          gatewayErrorMsg = errorOutput || `进程退出，错误码: ${code}`;
          notifyGatewayStatus();
        }
      });

      // 等待几秒检测启动状态
      setTimeout(() => {
        if (gatewayStatus === 'starting') {
          // 检查进程是否还在运行
          if (gatewayProcess && !gatewayProcess.killed) {
            gatewayStatus = 'running';
            notifyGatewayStatus();
            resolve({ success: true });
          } else {
            gatewayStatus = 'error';
            gatewayErrorMsg = errorOutput || '启动超时';
            notifyGatewayStatus();
            resolve({ success: false, error: gatewayErrorMsg });
          }
        }
      }, 5000);

    } catch (err: any) {
      log.error('Failed to start gateway:', err);
      gatewayStatus = 'error';
      gatewayErrorMsg = err.message;
      notifyGatewayStatus();
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * 停止 OpenClaw 网关
 */
async function stopGateway(): Promise<{ success: boolean; error?: string }> {
  if (!gatewayProcess || gatewayStatus === 'stopped') {
    return { success: true };
  }

  log.info('Stopping OpenClaw Gateway...');

  return new Promise((resolve) => {
    try {
      gatewayProcess?.kill();

      setTimeout(() => {
        if (!gatewayProcess?.killed) {
          gatewayProcess?.kill('SIGTERM');
        }
      }, 2000);

      gatewayProcess?.on('exit', () => {
        log.info('Gateway stopped');
        gatewayStatus = 'stopped';
        gatewayProcess = null;
        notifyGatewayStatus();
        resolve({ success: true });
      });

      // 超时强制终止
      setTimeout(() => {
        if (gatewayProcess && !gatewayProcess.killed) {
          gatewayProcess.kill('SIGKILL');
        }
        gatewayStatus = 'stopped';
        gatewayProcess = null;
        notifyGatewayStatus();
        resolve({ success: true });
      }, 5000);

    } catch (err: any) {
      log.error('Failed to stop gateway:', err);
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * 通知渲染进程网关状态变化
 */
function notifyGatewayStatus() {
  mainWindow?.webContents.send('gateway-status', {
    status: gatewayStatus,
    error: gatewayErrorMsg
  });
}

// ==================== 窗口管理 ====================

function createWindow() {
  log.info('Creating main window...');

  // 清理缓存（使用 Electron API 而不是直接删除文件）
  try {
    const userDataPath = app.getPath('userData');
    const codeCachePath = join(userDataPath, 'Code Cache');

    const fs = require('fs');
    // 只清理 Code Cache（非 GPU 缓存）
    if (fs.existsSync(codeCachePath)) {
      try {
        fs.rmSync(codeCachePath, { recursive: true, force: true });
        log.info('[MainWindow] Cleaned Code Cache');
      } catch (e) {
        log.warn('[MainWindow] Could not clean Code Cache:', e);
      }
    }
  } catch (err) {
    log.warn('[MainWindow] Cache cleanup failed:', err);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'AHIVE - 智能体集群管理器',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,    // 启用上下文隔离
      nodeIntegration: false,    // 禁用 Node.js 集成
      sandbox: false,            // 禁用沙箱
      webSecurity: false,        // 禁用同源策略
      allowRunningInsecureContent: true,  // 允许加载所有内容
      devTools: true,            // 强制启用开发者工具
    },
    show: true,  // 直接显示窗口
    frame: true,
    useContentSize: true,  // 确保内容尺寸不包括窗口边框
  });

  // 完全禁用 CSP（内容安全策略）以允许 Vite HMR 和 React 正常工作
  // 暂时注释，避免导致渲染进程崩溃
  // mainWindow.webContents.session.webRequest.onHeadersReceived({
  //   urls: ['*://*/*']
  // }, (details, callback) => {
  //   const responseHeaders = Object.assign({}, details.responseHeaders);
  //   // 删除所有 CSP 相关的头（包括大小写变体）
  //   delete responseHeaders['content-security-policy'];
  //   delete responseHeaders['Content-Security-Policy'];
  //   delete responseHeaders['CONTENT-SECURITY-POLICY'];
  //   // 确保回调被调用
  //   try {
  //     callback({ responseHeaders });
  //   } catch (e) {
  //     console.error('[CSP] Callback error:', e);
  //   }
  // });

  // 监听渲染进程错误
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error('[MainWindow] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('[MainWindow] Render process gone:', details.reason, details.exitCode);
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.error('[MainWindow] Renderer unresponsive');
  });

  // 捕获渲染进程的 console 消息（包括错误）
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level === 3) { // error
      log.error('[Renderer Error]', message, `at ${sourceId}:${line}`);
    } else if (level === 2) { // warning
      log.warn('[Renderer Warning]', message, `at ${sourceId}:${line}`);
    } else {
      log.info('[Renderer]', message);
    }
  });

  // 禁用 DevTools 自动打开（避免 locale 错误导致的问题）
  // 注意：DevTools 可能导致渲染进程崩溃，暂时禁用
  // mainWindow.webContents.openDevTools({ mode: 'right' });
  mainWindow.webContents.on('did-finish-load', () => {
    log.info('[MainWindow] did-finish-load event fired');
    // 延迟打开 DevTools，等待页面完全加载
    setTimeout(() => {
      mainWindow?.webContents.openDevTools({ mode: 'right' });
      log.info('[MainWindow] DevTools opened after delay');
    }, 1000);
  });

  // 加载页面

  // 加载页面 - 通过URL参数传递agents
  const loadUrl = async () => {
    // 注释原因：CLI 类型智能体已放弃，openclaw agents list 命令因 Node 版本要求过高而失败
    // 2026-03-18: 暂时注释，保留代码以备将来恢复
    // const agents = await getOpenClawAgents();
    const agents: any[] = [];
    let agentsParam = '';

    if (agents.length > 0) {
      const names = agents.map(a => a.name).join(',');
      agentsParam = `?agents=${encodeURIComponent(names)}`;
      log.info('Found agents:', agents.map(a => a.name));
    }

    const url = isDev
      ? `${WEB_URL}${agentsParam}`
      : `file://${join(__dirname, '../dist/index.html')}`;
    log.info('Loading:', url);
    
    // 清理缓存以避免 ERR_CACHE_READ_FAILURE
    try {
      await mainWindow?.webContents.session.clearCache();
      log.info('[MainWindow] Cache cleared');
    } catch (err) {
      log.warn('[MainWindow] Failed to clear cache:', err);
    }
    
    mainWindow?.loadURL(url);
  };

  loadUrl();

  // F12 或 Ctrl+Shift+I 打开开发者工具
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
    // Ctrl+Shift+I (Windows/Linux) 或 Cmd+Shift+I (Mac)
    if (input.key === 'I' && input.control && input.shift) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
    // Ctrl+Shift+J 打开开发者工具（控制台）
    if (input.key === 'J' && input.control && input.shift) {
      event.preventDefault();
      mainWindow?.webContents.openDevTools({ mode: 'bottom' });
    }
  });
  log.info('[MainWindow] DevTools shortcuts registered');

  // 注册全局快捷键（即使窗口失去焦点也能工作）
  const { globalShortcut } = require('electron');

  // 注册 F12 全局快捷键
  const f12Registered = globalShortcut.register('F12', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });
  log.info('[MainWindow] F12 Global shortcut registered:', f12Registered);

  // 注册 Ctrl+Shift+I 全局快捷键
  const csiRegistered = globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });
  log.info('[MainWindow] Ctrl+Shift+I Global shortcut registered:', csiRegistered);

  // 保留原有的 Ctrl+Shift+L 快捷键
  const cslRegistered = globalShortcut.register('CommandOrControl+Shift+L', () => {
    if (mainWindow) {
      mainWindow.webContents.toggleDevTools();
    }
  });
  log.info('[MainWindow] Ctrl+Shift+L Global shortcut registered:', cslRegistered);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
  log.info('Main window created');
}

/**
 * 初始化能力推送服务
 */
async function initializeCapabilityPusher(): Promise<void> {
  log.info('[CapabilityPusher] Initializing...');
  try {
    // 初始化 Gateway 消息发送器
    log.info('[CapabilityPusher] Step 1: Initializing gateway messenger...');
    await gatewayMessenger.initialize();
    log.info('[CapabilityPusher] Step 1: Done');

    // 设置推送服务的消息发送器和 API 端点
    log.info('[CapabilityPusher] Step 2: Setting up pusher...');
    capabilityPusher.setGatewayMessenger(gatewayMessenger);
    capabilityPusher.setApiEndpoint(mcpHttpServer.getAddress());
    capabilityPusher.setMCPManager(mcpManager);  // 设置 MCPManager 以获取工具 schema
    log.info('[CapabilityPusher] Step 2: Done');



    // CapabilityPusher 已经使用全局单例 capabilityManager，自动监听事件

    log.info('[CapabilityPusher] Initialized successfully');
  } catch (error) {
    log.error('[CapabilityPusher] Failed to initialize:', error);
  }
}

/**
 * 集中初始化所有后台服务
 */
async function initializeServices() {
  log.info('[Services] Starting initialization...');

  // 1. 初始化存储路径
  const dataPath = app.getPath('userData');
  keyManager.setStoragePath(dataPath);
  capabilityManager.setStoragePath(dataPath);

  // 2. 初始化 MCP Manager & HTTP Server
  try {
    await mcpManager.initialize();
    mcpHttpServer.setMCPManager(mcpManager);
    await mcpHttpServer.start();
  } catch (err) {
    log.error('[Services] MCP initialization failed:', err);
  }

  // 3. 启动 A2A HTTP Server（端口 3003）
  a2aHttpServer = new A2AHttpServer({ port: 3003 });
  try {
    a2aHttpServer.setMcpHttpEndpoint(mcpHttpServer.getAddress());
    a2aHttpServer.syncAgentsFromStorage();
    await a2aHttpServer.start();
    log.info('[Services] A2A HTTP Server started on port 3003');
  } catch (err) {
    log.error('[Services] A2A HTTP Server initialization failed:', err);
  }

  // 4. 初始化能力推送服务
  try {
    await initializeCapabilityPusher();
  } catch (err) {
    log.error('[Services] CapabilityPusher initialization failed:', err);
  }

  // 5. 初始化 A2A Agents
  try {
    const agents = getA2AAgents();
    for (const agent of agents) {
      if (agent.enabled) {
        await a2aManager.addAgent(agent);
      }
    }
// 将 A2AManager 注入到 A2AHttpServer，实现消息转发
  a2aHttpServer.setA2AManager(a2aManager);
  log.info('[Services] A2AManager injected into A2AHttpServer');
  
  // 监听 WorkflowMonitor 超时事件，通过 A2A 发送提醒
  workflowMonitor.on('timeout_warning', async (data: any) => {
    log.info('[WorkflowMonitor] Timeout warning:', data.data?.nodeId);
    if (data.data?.executor && a2aHttpServer) {
      try {
        // 通过 A2A 发送超时提醒
        await a2aHttpServer.sendA2AMessage({
          type: 'timeout_alert',
          sender: 'AHIVE',
          AGENTNAME: data.data.executor,
          消息: `任务 "${data.data.nodeName}" 已超过预期时长的 50%，当前已执行 ${data.data.elapsed} 分钟。`,
          节点ID: data.data.nodeId,
          工作流ID: data.data.workflowId,
          timeout: Math.floor(data.data.elapsed - data.data.expected * 0.5),
        });
        log.info(`[WorkflowMonitor] Sent timeout_alert to ${data.data.executor}`);
      } catch (err) {
        log.error('[WorkflowMonitor] Failed to send timeout_alert:', err);
      }
    }
  });
  
  workflowMonitor.on('timeout_critical', async (data: any) => {
    log.warn('[WorkflowMonitor] Timeout critical:', data.data?.nodeId);
    if (data.data?.executor && a2aHttpServer) {
      try {
        // 通过 A2A 发送严重超时提醒
        await a2aHttpServer.sendA2AMessage({
          type: 'timeout_alert',
          sender: 'AHIVE',
          AGENTNAME: data.data.executor,
          消息: `⚠️ 任务 "${data.data.nodeName}" 已严重超时！当前已执行 ${data.data.overdue} 分钟。请尽快处理或请求协助。`,
          节点ID: data.data.nodeId,
          工作流ID: data.data.workflowId,
          timeout: data.data.overdue,
        });
        log.info(`[WorkflowMonitor] Sent critical timeout_alert to ${data.data.executor}`);
      } catch (err) {
        log.error('[WorkflowMonitor] Failed to send critical timeout_alert:', err);
      }
    }
  });
  
  workflowMonitor.on('recovery', async (data: any) => {
    log.info('[WorkflowMonitor] Recovery:', data.data?.agentId);
    if (data.data?.agentId && a2aHttpServer) {
      try {
        // 通过 A2A 发送恢复信息
        await a2aHttpServer.sendA2AMessage({
          type: 'recovery_info',
          sender: 'AHIVE',
          AGENTNAME: data.data.agentId,
          消息: '你之前的中断任务已恢复，以下是恢复上下文：',
          节点ID: data.data.nodeId,
          工作流ID: data.data.workflowId,
          recoveryContext: data.data.taskState,
        });
        log.info(`[WorkflowMonitor] Sent recovery_info to ${data.data.agentId}`);
      } catch (err) {
        log.error('[WorkflowMonitor] Failed to send recovery_info:', err);
      }
    }
  });
  
  log.info('[Services] A2AManager injected into A2AHttpServer');
  } catch (err) {
    log.error('[Services] A2A initialization failed:', err);
  }

  // 6. 初始化 LLM Center 服务
  try {
    await llmCenterService.initialize();
    log.info('[Services] LLM Center initialized');
  } catch (err) {
    log.error('[Services] LLM Center initialization failed:', err);
  }

  // 6.5 启动 LLM Gateway (端口 3004)
  try {
    await llmGateway.start();
    log.info(`[Services] LLM Gateway started on ${llmGateway.getAddress()}`);
  } catch (err) {
    log.error('[Services] LLM Gateway initialization failed:', err);
  }

  // 7. 启动工作流监控
  try {
    workflowMonitor.start();
    // 注册所有 A2A Agents 到监控器
    const agents = getA2AAgents();
    for (const agent of agents) {
      if (agent.enabled) {
        workflowMonitor.registerAgent({
          agentId: agent.id,
          agentName: agent.name,
        });
      }
    }
    log.info('[Services] WorkflowMonitor started');
  } catch (err) {
    log.error('[Services] WorkflowMonitor initialization failed:', err);
  }

  log.info('[Services] All services initialized');
}


// ==================== 菜单 ====================

/**
 * 创建菜单 - 隐藏默认菜单栏
 * 网关和服务管理功能已移至设置面板-通用界面
 */
function createMenu() {
  // 设置为 null 以隐藏菜单栏
  Menu.setApplicationMenu(null);
  log.info('[Menu] Application menu hidden - controls moved to Settings > General');
}

// ==================== IPC 通信 ====================

/**
 * 敏感操作列表 - 需要额外验证的IPC通道
 */
const SENSITIVE_CHANNELS = new Set([
  'run-command',
  'send-message-to-agent',
  'start-gateway',
  'stop-gateway',
  'start-mcp-server',
  'stop-mcp-server',
  'call-mcp-tool',
  'save-app-data',
  'delete-scheduled-task',
  'delete-workflow',
  'delete-mcp-server',
  'delete-a2a-agent',
  'delete-agent'
]);

/**
 * 验证IPC调用来源
 * 确保请求来自应用的主窗口
 */
function validateIPCSource(event: Electron.IpcMainInvokeEvent): boolean {
  const senderId = event.sender.id;

  // 检查是否来自主窗口
  if (mainWindow) {
    const mainWebContentsId = mainWindow.webContents.id;
    if (senderId === mainWebContentsId) {
      return true;
    }
  }

  // 开发模式下允许来自任何来源的调用（方便调试）
  if (isDev) {
    log.warn(`[IPC Security] Dev mode: allowing request from webContents ${senderId}`);
    return true;
  }

  // 拒绝非主窗口的请求
  log.warn(`[IPC Security] Rejected request from unauthorized webContents: ${senderId}`);
  return false;
}

/**
 * 创建安全的IPC处理器
 */
function secureHandle(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    // 对敏感通道进行来源验证
    if (SENSITIVE_CHANNELS.has(channel)) {
      if (!validateIPCSource(event)) {
        const error = 'Unauthorized IPC access attempt';
        log.error(`[IPC Security] ${error} on channel: ${channel}`);
        return { success: false, error };
      }
    }

    try {
      return await handler(event, ...args);
    } catch (error) {
      log.error(`[IPC] Error in ${channel}:`, error);
      throw error;
    }
  });
}

// ==================== 基础 IPC ====================

ipcMain.handle('get-config', () => {
  return appConfig;
});

// 打开外部链接
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    // 验证 URL 格式
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { success: false, error: 'Invalid protocol' };
    }
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    log.error('[IPC] open-external error:', error);
    return { success: false, error: String(error) };
  }
});

// 获取应用版本
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 运行本地命令 (受限制)
ipcMain.handle('run-command', async (event, command: string) => {
  // 安全验证
  if (!validateIPCSource(event)) {
    return { success: false, error: 'Unauthorized' };
  }
  
  // 命令白名单检查 (仅允许特定命令)
  const allowedCommands = ['node --version', 'npm --version', 'git --version'];
  if (!allowedCommands.includes(command)) {
    return { success: false, error: 'Command not allowed' };
  }
  
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const result = await execAsync(command, { timeout: 5000 });
    return { success: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});



ipcMain.handle('get-gateway-status', () => {
  return { status: gatewayStatus, error: gatewayErrorMsg };
});

ipcMain.handle('start-gateway', async (event) => {
  if (!validateIPCSource(event)) {
    return { success: false, error: 'Unauthorized' };
  }
  return await startGateway();
});

ipcMain.handle('stop-gateway', async (event) => {
  if (!validateIPCSource(event)) {
    return { success: false, error: 'Unauthorized' };
  }
  return await stopGateway();
});

// 注释原因：CLI 类型智能体已放弃，openclaw agents list 命令因 Node 版本要求过高而失败
// 2026-03-18: 暂时注释，保留代码以备将来恢复
// ipcMain.handle('get-agents', async () => {
//   return await getOpenClawAgents();
// });

// 向智能体发送消息 (CLI模式) - 安全版本
ipcMain.handle('send-message-to-agent', async (_event, agentName: string, message: string) => {
  // 输入验证
  if (!validateAgentName(agentName)) {
    log.warn('Invalid agent name rejected:', agentName);
    return {
      success: false,
      error: `无效的智能体名称: ${agentName}`
    };
  }

  if (!validateMessage(message)) {
    log.warn('Invalid message rejected, length:', message?.length);
    return {
      success: false,
      error: '消息内容无效或过长'
    };
  }

  log.info('Sending message to agent:', agentName);

  // 使用安全的参数化执行
  const result = await sendMessageToAgent(agentName, message);

  if (!result.success) {
    log.error('Agent message error:', result.error, 'stderr:', result.stderr);
    return {
      success: false,
      error: result.error,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  log.info('Agent message response:', result.stdout.substring(0, 500));

  // 尝试解析JSON
  let parsed = null;
  try {
    parsed = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
  } catch (e) {
    log.warn('Failed to parse JSON response, using raw output');
  }

  return {
    success: true,
    data: parsed,
    raw: result.stdout,
    stderr: result.stderr
  };
});

// ==================== 数据存储 IPC ====================

// 获取数据目录路径
ipcMain.handle('get-data-directory', () => {
  return getDataDirectory();
});

// 获取所有数据
ipcMain.handle('get-app-data', () => {
  return loadData();
});

// 保存所有数据
ipcMain.handle('save-app-data', (_event, data) => {
  return saveData(data);
});

// 获取定时任务列表
ipcMain.handle('get-scheduled-tasks', () => {
  return getScheduledTasks();
});

// 保存定时任务
ipcMain.handle('save-scheduled-task', (_event, task) => {
  return saveScheduledTask(task);
});

// 删除定时任务
ipcMain.handle('delete-scheduled-task', (_event, taskId: string) => {
  return deleteScheduledTask(taskId);
});

// 切换定时任务状态
ipcMain.handle('toggle-scheduled-task', (_event, taskId: string, enabled: boolean) => {
  return toggleScheduledTask(taskId, enabled);
});

// 添加执行记录
ipcMain.handle('add-task-run', (_event, run) => {
  return addTaskRun(run);
});

// 获取执行记录
ipcMain.handle('get-task-runs', (_event, taskId: string) => {
  return getTaskRuns(taskId);
});

// 获取所有执行记录
ipcMain.handle('get-all-task-runs', () => {
  const data = loadData();
  return data.scheduledTaskRuns;
});

// ==================== 工作流 IPC ====================

// 获取所有工作流
ipcMain.handle('get-workflows', () => {
  return getWorkflows();
});

// 获取单个工作流
ipcMain.handle('get-workflow', (_event, workflowId: string) => {
  return getWorkflow(workflowId);
});

// 保存工作流
ipcMain.handle('save-workflow', (_event, workflow) => {
  log.info('[IPC] save-workflow called, workflow id:', workflow?.id);
  const result = saveWorkflow(workflow);
  log.info('[IPC] save-workflow result:', result);
  return result;
});

// 删除工作流
ipcMain.handle('delete-workflow', (_event, workflowId: string) => {
  return deleteWorkflow(workflowId);
});

// 检查工作流名称是否存在
ipcMain.handle('workflow-name-exists', (_event, name: string, excludeId?: string) => {
  return workflowNameExists(name, excludeId);
});

// 导入工作流
ipcMain.handle('import-workflow', (_event, content: string, customName?: string) => {
  return importWorkflowFromContent(content, customName);
});

// 获取工作流文件列表
ipcMain.handle('list-workflow-files', () => {
  return listWorkflowFiles();
});

// 重命名工作流
ipcMain.handle('rename-workflow', (_event, oldName: string, newName: string) => {
  return renameWorkflow(oldName, newName);
});

// ==================== 工作流模板 IPC ====================

// 获取所有工作流模板
ipcMain.handle('get-workflow-templates', () => {
  return getWorkflowTemplates();
});

// 获取单个工作流模板
ipcMain.handle('get-workflow-template', (_event, templateId: string) => {
  return getWorkflowTemplate(templateId);
});

// 保存工作流模板
ipcMain.handle('save-workflow-template', (_event, template) => {
  log.info('[IPC] save-workflow-template called:', template?.id);
  return saveWorkflowTemplate(template);
});

// 删除工作流模板
ipcMain.handle('delete-workflow-template', (_event, templateId: string) => {
  log.info('[IPC] delete-workflow-template called:', templateId);
  return deleteWorkflowTemplate(templateId);
});

// ==================== 项目配置模板 IPC ====================

import {
  getProjectConfigTemplateService,
  initializeProjectConfigTemplateService,
} from './services/ProjectConfigTemplateService';

// 初始化项目配置模板服务
const projectConfigTemplatesDir = join(getDataDirectory(), 'project-config-templates');
initializeProjectConfigTemplateService(projectConfigTemplatesDir);

// 获取所有项目配置模板
ipcMain.handle('get-project-config-templates', async (_event, language: 'zh' | 'en' = 'zh') => {
  const service = getProjectConfigTemplateService();
  const templates = await service.loadTemplates();
  const result = service.getAllTemplatesForDisplay(language);
  // 把调试信息附加到返回结果中（临时调试）
  return result.map((t, i) => ({
    ...t,
    _debug: `index=${i}, total=${result.length}, loaded=${templates.length}`
  }));
});

// 获取单个项目配置模板
ipcMain.handle('get-project-config-template', async (_event, templateId: string, language: 'zh' | 'en' = 'zh') => {
  const service = getProjectConfigTemplateService();
  await service.loadTemplates();
  return service.getTemplateForDisplay(templateId, language);
});

// 重新加载项目配置模板
ipcMain.handle('reload-project-config-templates', async () => {
  const service = getProjectConfigTemplateService();
  return service.reload();
});

// ==================== 黑板 IPC ====================

// 获取黑板状态
ipcMain.handle('get-blackboard-state', () => {
  return getBlackboardState();
});

// 保存黑板状态
ipcMain.handle('save-blackboard-state', (_event, state) => {
  return saveBlackboardState(state);
});

// 更新黑板变量
ipcMain.handle('update-blackboard-variable', (_event, entry) => {
  return updateBlackboardVariable(entry);
});

// 删除黑板变量
ipcMain.handle('delete-blackboard-variable', (_event, key: string) => {
  return deleteBlackboardVariable(key);
});

// 添加黑板事件
ipcMain.handle('add-blackboard-event', (_event, event) => {
  return addBlackboardEvent(event);
});

// ==================== 黑板 IPC（V2 - 分文件存储） ====================

// 获取全局变量
ipcMain.handle('get-global-variables', () => {
  return getGlobalVariables();
});

// 保存全局变量
ipcMain.handle('save-global-variables', (_event, state) => {
  return saveGlobalVariables(state);
});

// 更新全局变量
ipcMain.handle('update-global-variable', (_event, entry) => {
  return updateGlobalVariable(entry);
});

// 删除全局变量
ipcMain.handle('delete-global-variable', (_event, key: string) => {
  return deleteGlobalVariable(key);
});

// 获取工作流变量
ipcMain.handle('get-workflow-variables', (_event, workflowId: string) => {
  return getWorkflowVariables(workflowId);
});

// 保存工作流变量
ipcMain.handle('save-workflow-variables', (_event, state) => {
  return saveWorkflowVariables(state);
});

// 更新工作流变量
ipcMain.handle('update-workflow-variable', (_event, workflowId: string, entry) => {
  return updateWorkflowVariable(workflowId, entry);
});

// 删除工作流变量
ipcMain.handle('delete-workflow-variable', (_event, workflowId: string, key: string) => {
  return deleteWorkflowVariable(workflowId, key);
});

// 清空工作流变量
ipcMain.handle('clear-workflow-variables', (_event, workflowId: string) => {
  return clearWorkflowVariables(workflowId);
});

// 删除工作流数据目录
ipcMain.handle('delete-workflow-data-dir', (_event, workflowId: string) => {
  return deleteWorkflowDataDir(workflowId);
});

// 获取所有工作流变量
ipcMain.handle('get-all-workflow-variables', () => {
  return getAllWorkflowVariables();
});

// ==================== 部门数据 IPC ====================

// 获取所有部门
ipcMain.handle('get-departments', () => {
  return getDepartments();
});

// 获取单个部门
ipcMain.handle('get-department', (_event, departmentId: string) => {
  return getDepartment(departmentId);
});

// 保存部门
ipcMain.handle('save-department', (_event, department) => {
  return saveDepartment(department);
});

// 批量保存部门
ipcMain.handle('save-departments', (_event, departments) => {
  return saveDepartments(departments);
});

// 删除部门
ipcMain.handle('delete-department', (_event, departmentId: string) => {
  return deleteDepartment(departmentId);
});

// 添加部门成员
ipcMain.handle('add-department-member', (_event, departmentId: string, member) => {
  return addDepartmentMember(departmentId, member);
});

// 移除部门成员
ipcMain.handle('remove-department-member', (_event, departmentId: string, agentId: string) => {
  return removeDepartmentMember(departmentId, agentId);
});

// ==================== 中断记录 IPC ====================

// 获取所有中断记录
ipcMain.handle('get-interruptions', () => {
  return getInterruptions();
});

// 获取未恢复的中断记录
ipcMain.handle('get-unrecovered-interruptions', () => {
  return getUnrecoveredInterruptions();
});

// 保存中断记录
ipcMain.handle('save-interruption', (_event, interruption) => {
  return saveInterruption(interruption);
});

// 标记中断已恢复
ipcMain.handle('mark-interruption-recovered', (_event, id: string) => {
  return markInterruptionRecovered(id);
});

// 删除中断记录
ipcMain.handle('delete-interruption', (_event, id: string) => {
  return deleteInterruption(id);
});

// 清理旧中断记录
ipcMain.handle('cleanup-old-interruptions', (_event, daysToKeep?: number) => {
  return cleanupOldInterruptions(daysToKeep);
});

// ==================== 邮件服务 IPC ====================

// 发送邮件
ipcMain.handle('send-email', async (_event, params: {
  to: string[];
  subject: string;
  message: string;
}) => {
  log.info(`[Email] Sending email to: ${params.to.join(', ')}`);
  log.info(`[Email] Subject: ${params.subject}`);
  
  // 从存储中获取邮件服务配置
  const protocolConfig = getProtocolConfig();
  const emailConfig = protocolConfig.email || {};
  
  if (!emailConfig.serviceUrl) {
    log.warn('[Email] No email service configured');
    return { 
      success: false, 
      error: 'Email service not configured. Please set email_service_url in settings.' 
    };
  }
  
  try {
    const response = await fetch(emailConfig.serviceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(emailConfig.apiKey ? { 'Authorization': `Bearer ${emailConfig.apiKey}` } : {}),
      },
      body: JSON.stringify({
        from: emailConfig.from || 'noreply@ahive.local',
        to: params.to,
        subject: params.subject,
        text: params.message,
      }),
    });
    
    if (response.ok) {
      log.info('[Email] Email sent successfully');
      return { success: true };
    } else {
      const errorText = await response.text();
      log.error('[Email] Email service error:', errorText);
      return { success: false, error: errorText };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('[Email] Failed to send email:', errorMessage);
    return { success: false, error: errorMessage };
  }
});

// ==================== 执行状态 IPC ====================

// 获取执行状态
ipcMain.handle('get-execution-state', (_event, instanceId: string) => {
  return getExecutionState(instanceId);
});

// 获取所有执行状态
ipcMain.handle('get-all-execution-states', () => {
  return getAllExecutionStates();
});

// 保存执行状态
ipcMain.handle('save-execution-state', (_event, state) => {
  return saveExecutionState(state);
});

// 删除执行状态
ipcMain.handle('delete-execution-state', (_event, instanceId: string) => {
  return deleteExecutionState(instanceId);
});

// 清理过期执行状态
ipcMain.handle('cleanup-execution-states', () => {
  return cleanupExecutionStates();
});

// ==================== 工作流执行日志 ====================

// 保存工作流执行日志
ipcMain.handle('save-workflow-execution-log', (_event, log) => {
  return saveWorkflowExecutionLog(log);
});

// 获取工作流执行日志
ipcMain.handle('get-workflow-execution-log', (_event, logId: string) => {
  return getWorkflowExecutionLog(logId);
});

// 获取工作流执行日志列表
ipcMain.handle('get-workflow-execution-logs', (_event, options?) => {
  return getWorkflowExecutionLogs(options);
});

// 删除工作流执行日志
ipcMain.handle('delete-workflow-execution-log', (_event, logId: string) => {
  return deleteWorkflowExecutionLog(logId);
});

// 清理过期日志
ipcMain.handle('cleanup-workflow-execution-logs', (_event, retentionDays?: number) => {
  return cleanupWorkflowExecutionLogs(retentionDays);
});

// 获取日志统计
ipcMain.handle('get-workflow-log-stats', () => {
  return getWorkflowLogStats();
});

// 重建日志索引
ipcMain.handle('rebuild-workflow-log-index', () => {
  return rebuildWorkflowLogIndex();
});

// ==================== 工作流执行控制 ====================

/**
 * 执行工作流启动检测
 * 在工作流正式执行前进行各项检测
 */
ipcMain.handle('workflow:startup-check', async (_event, workflowId: string) => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:startup-check - WorkflowScheduler not initialized');
    return { 
      success: false, 
      canProceed: false,
      steps: [],
      error: 'WorkflowScheduler not initialized' 
    };
  }
  
  try {
    log.info(`[IPC] workflow:startup-check - Checking workflow: ${workflowId}`);
    const result = await workflowScheduler.performStartupChecks(workflowId);
    log.info(`[IPC] workflow:startup-check - Result: canProceed=${result.canProceed}`);
    // ✅ 直接返回 result，包含 steps 字段
    return {
      success: true,
      ...result
    };
  } catch (error: any) {
    log.error(`[IPC] workflow:startup-check - Error:`, error);
    return { 
      success: false, 
      canProceed: false,
      steps: [],
      error: error.message 
    };
  }
});

/**
 * 执行工作流（带启动检测）
 */
ipcMain.handle('workflow:execute', async (_event, workflowId: string, variables?: Record<string, unknown>) => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:execute - WorkflowScheduler not initialized');
    return { instanceId: '', success: false, error: 'WorkflowScheduler not initialized' };
  }
  
  try {
    log.info(`[IPC] workflow:execute - Starting workflow: ${workflowId}`);
    const result = await workflowScheduler.execute(workflowId, variables);
    log.info(`[IPC] workflow:execute - Started: ${result.instanceId}`);
    return result;
  } catch (error: any) {
    log.error(`[IPC] workflow:execute - Error:`, error);
    return { instanceId: '', success: false, error: error.message };
  }
});

/**
 * 暂停工作流
 */
ipcMain.handle('workflow:pause', async (_event, instanceId: string) => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:pause - WorkflowScheduler not initialized');
    return false;
  }
  
  try {
    log.info(`[IPC] workflow:pause - Pausing: ${instanceId}`);
    return workflowScheduler.pause(instanceId);
  } catch (error: any) {
    log.error(`[IPC] workflow:pause - Error:`, error);
    return false;
  }
});

/**
 * 恢复工作流
 */
ipcMain.handle('workflow:resume', async (_event, instanceId: string) => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:resume - WorkflowScheduler not initialized');
    return false;
  }
  
  try {
    log.info(`[IPC] workflow:resume - Resuming: ${instanceId}`);
    return workflowScheduler.resume(instanceId);
  } catch (error: any) {
    log.error(`[IPC] workflow:resume - Error:`, error);
    return false;
  }
});

/**
 * 停止工作流
 * 如果实例在 scheduler 中运行，则停止执行
 * 如果实例不在 scheduler 中（僵尸实例），则直接更新数据库状态
 */
ipcMain.handle('workflow:stop', async (_event, instanceId: string) => {
  log.info(`[IPC] workflow:stop - Stopping: ${instanceId}`);
  
  try {
    // 1. 尝试通过 WorkflowScheduler 停止（如果实例还在运行）
    let schedulerStopped = false;
    if (workflowScheduler) {
      const state = workflowScheduler.getState(instanceId);
      if (state) {
        log.info(`[IPC] workflow:stop - Instance found in scheduler, stopping...`);
        schedulerStopped = await workflowScheduler.stopWorkflow(instanceId);
      } else {
        log.info(`[IPC] workflow:stop - Instance not in scheduler (zombie instance)`);
      }
    }
    
    // 2. 如果实例不在 scheduler 中，或者 scheduler 停止失败，更新数据库状态
    if (!schedulerStopped && workflowStateDB) {
      log.info(`[IPC] workflow:stop - Updating database status for ${instanceId}`);
      
      // 更新实例状态为 failed
      workflowStateDB.completeInstance(
        instanceId,
        false,
        '强制关闭：用户手动停止',
        'Stopped by user'
      );
      
      // 更新当前节点的状态为 failed
      const instance = workflowStateDB.getInstance(instanceId);
      if (instance && instance.currentNodeId) {
        workflowStateDB.updateNodeStatus(
          instanceId,
          instance.currentNodeId,
          'failed',
          { error: '强制关闭：用户手动停止' }
        );
      }
      
      log.info(`[IPC] workflow:stop - Instance ${instanceId} marked as failed in database`);
      return true;
    }
    
    return schedulerStopped;
  } catch (error: any) {
    log.error(`[IPC] workflow:stop - Error:`, error);
    return false;
  }
});

/**
 * 强制关闭工作流实例（用于处理僵尸实例）
 * 将状态为 running 但实际已停止的实例标记为 failed
 */
ipcMain.handle('workflow:force-stop', async (_event, instanceId: string, reason?: string) => {
  log.info(`[IPC] workflow:force-stop - Force stopping: ${instanceId}`);
  
  if (!workflowStateDB) {
    log.error('[IPC] workflow:force-stop - WorkflowStateDB not initialized');
    return { success: false, error: 'Database not initialized' };
  }
  
  try {
    // 1. 尝试通过 WorkflowScheduler 停止（如果实例还在运行）
    if (workflowScheduler) {
      const state = workflowScheduler.getState(instanceId);
      if (state) {
        log.info(`[IPC] workflow:force-stop - Instance found in scheduler, stopping...`);
        await workflowScheduler.stopWorkflow(instanceId);
      }
    }
    
    // 2. 直接更新数据库状态
    const now = new Date().toISOString();
    workflowStateDB.completeInstance(
      instanceId,
      false,
      reason || '强制关闭：实例非正常退出',
      'Force stopped by user'
    );
    
    // 3. 更新当前节点的状态为 failed
    const instance = workflowStateDB.getInstance(instanceId);
    if (instance && instance.currentNodeId) {
      workflowStateDB.failNode(
        instanceId,
        instance.currentNodeId,
        reason || '强制关闭：实例非正常退出'
      );
    }
    
    log.info(`[IPC] workflow:force-stop - Instance ${instanceId} marked as failed`);
    return { success: true };
  } catch (error: any) {
    log.error(`[IPC] workflow:force-stop - Error:`, error);
    return { success: false, error: error.message };
  }
});

/**
 * 获取工作流执行状态
 */
ipcMain.handle('workflow:get-state', async (_event, instanceId: string) => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:get-state - WorkflowScheduler not initialized');
    return null;
  }
  
  try {
    return workflowScheduler.getState(instanceId);
  } catch (error: any) {
    log.error(`[IPC] workflow:get-state - Error:`, error);
    return null;
  }
});

/**
 * 获取工作流黑板变量
 */
ipcMain.handle('workflow:get-variables', async (_event, instanceId: string) => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:get-variables - WorkflowScheduler not initialized');
    return null;
  }
  
  try {
    return workflowScheduler.getVariables(instanceId);
  } catch (error: any) {
    log.error(`[IPC] workflow:get-variables - Error:`, error);
    return null;
  }
});

/**
 * 获取所有活跃的工作流实例
 */
ipcMain.handle('workflow:list-instances', async () => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:list-instances - WorkflowScheduler not initialized');
    return [];
  }
  
  try {
    return workflowScheduler.getActiveInstances();
  } catch (error: any) {
    log.error(`[IPC] workflow:list-instances - Error:`, error);
    return [];
  }
});

/**
 * 获取未完成的实例（从数据库）
 */
ipcMain.handle('workflow:get-incomplete-instances', async () => {
  log.info('[IPC] workflow:get-incomplete-instances called');
  
  if (!workflowStateDB) {
    log.error('[IPC] workflow:get-incomplete-instances - WorkflowStateDB not initialized');
    return [];
  }
  
  try {
    const instances = workflowStateDB.getIncompleteInstances();
    log.info('[IPC] workflow:get-incomplete-instances - Found', instances.length, 'instances');
    return instances;
  } catch (error: any) {
    log.error(`[IPC] workflow:get-incomplete-instances - Error:`, error);
    return [];
  }
});

/**
 * 获取所有工作流实例
 */
ipcMain.handle('workflow:get-all-instances', async () => {
  log.info('[IPC] workflow:get-all-instances called');
  
  if (!workflowStateDB) {
    log.error('[IPC] workflow:get-all-instances - WorkflowStateDB not initialized');
    return [];
  }
  
  try {
    const instances = workflowStateDB.getAllInstances();
    log.info('[IPC] workflow:get-all-instances - Found', instances.length, 'instances');
    return instances;
  } catch (error: any) {
    log.error(`[IPC] workflow:get-all-instances - Error:`, error);
    return [];
  }
});

/**
 * 删除单个工作流实例
 */
ipcMain.handle('workflow:delete-instance', async (_event, instanceId: string) => {
  log.info('[IPC] workflow:delete-instance called for', instanceId);
  
  if (!workflowStateDB) {
    log.error('[IPC] workflow:delete-instance - WorkflowStateDB not initialized');
    return { success: false, error: 'Database not initialized' };
  }
  
  try {
    workflowStateDB.deleteInstance(instanceId);
    log.info('[IPC] workflow:delete-instance - Deleted', instanceId);
    return { success: true };
  } catch (error: any) {
    log.error(`[IPC] workflow:delete-instance - Error:`, error);
    return { success: false, error: error.message };
  }
});

/**
 * 删除工作流的所有实例
 */
ipcMain.handle('workflow:delete-all-instances', async (_event, workflowId: string) => {
  log.info('[IPC] workflow:delete-all-instances called for workflow', workflowId);
  
  if (!workflowStateDB) {
    log.error('[IPC] workflow:delete-all-instances - WorkflowStateDB not initialized');
    return { success: false, error: 'Database not initialized' };
  }
  
  try {
    const count = workflowStateDB.deleteAllInstances(workflowId);
    log.info('[IPC] workflow:delete-all-instances - Deleted', count, 'instances');
    return { success: true, count };
  } catch (error: any) {
    log.error(`[IPC] workflow:delete-all-instances - Error:`, error);
    return { success: false, error: error.message };
  }
});

/**
 * 获取实例详情（包括节点状态）
 */
ipcMain.handle('workflow:get-instance-details', async (_event, instanceId: string) => {
  if (!workflowStateDB) {
    log.error('[IPC] workflow:get-instance-details - WorkflowStateDB not initialized');
    return null;
  }
  
  try {
    const instance = workflowStateDB.getInstance(instanceId);
    if (!instance) {
      return null;
    }
    
    // 获取节点状态
    const nodeStates = workflowStateDB.getAllNodes(instanceId);
    
    return {
      ...instance,
      nodeStates,
    };
  } catch (error: any) {
    log.error(`[IPC] workflow:get-instance-details - Error:`, error);
    return null;
  }
});

/**
 * 提交审核结果
 */
ipcMain.handle('workflow:submit-review', async (_event, instanceId: string, nodeId: string, result: { score?: number; stars?: number; feedback?: string; approved: boolean }) => {
  if (!workflowScheduler) {
    log.error('[IPC] workflow:submit-review - WorkflowScheduler not initialized');
    return false;
  }
  
  try {
    log.info(`[IPC] workflow:submit-review - Instance: ${instanceId}, Node: ${nodeId}`);
    return workflowScheduler.submitReview(instanceId, nodeId, result);
  } catch (error: any) {
    log.error(`[IPC] workflow:submit-review - Error:`, error);
    return false;
  }
});

/**
 * 获取实例的产出物
 */
ipcMain.handle('workflow:get-outputs', async (_event, instanceId: string) => {
  if (!workflowStateDB) {
    log.error('[IPC] workflow:get-outputs - WorkflowStateDB not initialized');
    return [];
  }
  
  try {
    const outputs = workflowStateDB.getOutputs(instanceId);
    return outputs;
  } catch (error: any) {
    log.error(`[IPC] workflow:get-outputs - Error:`, error);
    return [];
  }
});

/**
 * 获取节点的产出物
 */
ipcMain.handle('workflow:get-node-outputs', async (_event, instanceId: string, nodeId: string) => {
  if (!workflowStateDB) {
    log.error('[IPC] workflow:get-node-outputs - WorkflowStateDB not initialized');
    return [];
  }
  
  try {
    const outputs = workflowStateDB.getNodeOutputs(instanceId, nodeId);
    return outputs;
  } catch (error: any) {
    log.error(`[IPC] workflow:get-node-outputs - Error:`, error);
    return [];
  }
});

/**
 * 获取产出物统计
 */
ipcMain.handle('workflow:get-output-stats', async (_event, instanceId: string) => {
  if (!workflowStateDB) {
    log.error('[IPC] workflow:get-output-stats - WorkflowStateDB not initialized');
    return {};
  }
  
  try {
    const stats = workflowStateDB.getOutputStats(instanceId);
    return stats;
  } catch (error: any) {
    log.error(`[IPC] workflow:get-output-stats - Error:`, error);
    return {};
  }
});

/**
 * 获取工作流的所有实例
 */
ipcMain.handle('workflow:get-instances-by-workflow', async (_event, workflowId: string) => {
  if (!workflowStateDB) {
    log.error('[IPC] workflow:get-instances-by-workflow - WorkflowStateDB not initialized');
    return [];
  }
  
  try {
    const instances = workflowStateDB.getExecutionHistory(workflowId, 100);
    return instances;
  } catch (error: any) {
    log.error(`[IPC] workflow:get-instances-by-workflow - Error:`, error);
    return [];
  }
});

// ==================== 系统日志管理 ====================

// 格式化文件大小
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 获取系统日志文件列表
ipcMain.handle('get-system-log-files', () => {
  try {
    const logsDir = logDir;
    if (!existsSync(logsDir)) {
      return [];
    }
    
    const files = readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .map(filename => {
        const filePath = join(logsDir, filename);
        const stats = statSync(filePath);
        return {
          name: filename,
          path: filePath,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          modifiedAt: stats.mtime.toISOString(),
          createdAt: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    
    return files;
  } catch (error) {
    log.error('[IPC] get-system-log-files failed:', error);
    return [];
  }
});

// 读取系统日志内容
ipcMain.handle('read-system-log', (_event, filename: string, options?: { lines?: number; level?: string; search?: string }) => {
  try {
    const filePath = join(logDir, filename);
    if (!existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }
    
    let content = readFileSync(filePath, 'utf-8');
    let lines = content.split('\n');
    
    // 按级别过滤
    if (options?.level && options.level !== 'all') {
      const levelPattern = new RegExp(`\\[${options.level.toUpperCase()}\\]`, 'i');
      lines = lines.filter(line => levelPattern.test(line));
    }
    
    // 搜索关键字
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      lines = lines.filter(line => line.toLowerCase().includes(searchLower));
    }
    
    // 限制行数
    if (options?.lines && options.lines > 0) {
      lines = lines.slice(-options.lines);
    }
    
    return {
      success: true,
      filename,
      totalLines: lines.length,
      content: lines.join('\n'),
      lines: lines
    };
  } catch (error) {
    log.error('[IPC] read-system-log failed:', error);
    return { success: false, error: String(error) };
  }
});

// 删除单个系统日志
ipcMain.handle('delete-system-log', (_event, filename: string) => {
  try {
    const filePath = join(logDir, filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      log.info('[IPC] Deleted system log:', filename);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (error) {
    log.error('[IPC] delete-system-log failed:', error);
    return { success: false, error: String(error) };
  }
});

// 批量删除系统日志
ipcMain.handle('delete-system-logs', (_event, filenames: string[]) => {
  try {
    let deleted = 0;
    let failed = 0;
    
    for (const filename of filenames) {
      const filePath = join(logDir, filename);
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath);
          deleted++;
        } catch {
          failed++;
        }
      }
    }
    
    log.info(`[IPC] Batch deleted ${deleted} logs, failed: ${failed}`);
    return { success: true, deleted, failed };
  } catch (error) {
    log.error('[IPC] delete-system-logs failed:', error);
    return { success: false, error: String(error) };
  }
});

// 获取系统日志统计
ipcMain.handle('get-system-log-stats', () => {
  try {
    const logsDir = logDir;
    if (!existsSync(logsDir)) {
      return { totalFiles: 0, totalSize: 0, totalSizeFormatted: '0 B' };
    }
    
    const files = readdirSync(logsDir).filter(f => f.endsWith('.log'));
    let totalSize = 0;
    
    for (const filename of files) {
      const filePath = join(logsDir, filename);
      const stats = statSync(filePath);
      totalSize += stats.size;
    }
    
    return {
      totalFiles: files.length,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      oldestFile: files.length > 0 ? files[files.length - 1] : null,
      newestFile: files.length > 0 ? files[0] : null
    };
  } catch (error) {
    log.error('[IPC] get-system-log-stats failed:', error);
    return { totalFiles: 0, totalSize: 0, totalSizeFormatted: '0 B' };
  }
});

// 清理旧日志（保留最近 N 天）
ipcMain.handle('cleanup-system-logs', (_event, retentionDays: number) => {
  try {
    const logsDir = logDir;
    if (!existsSync(logsDir)) {
      return { success: true, deleted: 0 };
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const files = readdirSync(logsDir).filter(f => f.endsWith('.log'));
    let deleted = 0;
    
    for (const filename of files) {
      const filePath = join(logsDir, filename);
      const stats = statSync(filePath);
      
      if (stats.mtime < cutoffDate) {
        try {
          unlinkSync(filePath);
          deleted++;
        } catch (e) {
          log.warn('[IPC] Failed to delete old log:', filename, e);
        }
      }
    }
    
    log.info(`[IPC] Cleaned up ${deleted} old logs (retention: ${retentionDays} days)`);
    return { success: true, deleted };
  } catch (error) {
    log.error('[IPC] cleanup-system-logs failed:', error);
    return { success: false, error: String(error) };
  }
});

// ==================== MCP/A2A 协议 IPC ====================

// 获取协议配置
ipcMain.handle('get-protocol-config', () => {
  return getProtocolConfig();
});

// 获取所有 MCP Server
ipcMain.handle('get-mcp-servers', () => {
  return getMCPServers();
});

// 获取单个 MCP Server
ipcMain.handle('get-mcp-server', (_event, id: string) => {
  return getMCPServer(id);
});

// 保存 MCP Server
ipcMain.handle('save-mcp-server', (_event, server: any) => {
  log.info('[IPC] save-mcp-server called:', server?.name);
  return mcpManager.addServer(server);
});

// 删除 MCP Server
ipcMain.handle('delete-mcp-server', (_event, id: string) => {
  log.info('[IPC] delete-mcp-server called:', id);
  return mcpManager.removeServer(id);
});

// 切换 MCP Server 状态
ipcMain.handle('toggle-mcp-server', (_event, id: string, enabled: boolean) => {
  log.info('[IPC] toggle-mcp-server called:', id, enabled);
  return mcpManager.setServerEnabled(id, enabled);
});

// 获取所有 A2A Agent
ipcMain.handle('get-a2a-agents', () => {
  return getA2AAgents();
});

// 获取单个 A2A Agent
ipcMain.handle('get-a2a-agent', (_event, id: string) => {
  return getA2AAgent(id);
});

// 保存 A2A Agent
ipcMain.handle('save-a2a-agent', async (_event, agent: any) => {
  log.info('[IPC] save-a2a-agent called:', agent?.name);
  saveA2AAgent(agent);
  // 初始化 A2A 客户端
  await a2aManager.addAgent(agent);
  return true;
});

// 删除 A2A Agent
ipcMain.handle('delete-a2a-agent', (_event, id: string) => {
  log.info('[IPC] delete-a2a-agent called:', id);
  return a2aManager.removeAgent(id);
});

// 切换 A2A Agent 状态
ipcMain.handle('toggle-a2a-agent', async (_event, id: string, enabled: boolean) => {
  log.info('[IPC] toggle-a2a-agent called:', id, enabled);
  await toggleA2AAgent(id, enabled);
  return a2aManager.setAgentEnabled(id, enabled);
});


// ==================== MCP API 配置 IPC ====================

// 获取所有 MCP API 配置
ipcMain.handle('get-mcp-api-configs', () => {
  return getMCPApiConfigs();
});

// 获取单个 MCP API 配置
ipcMain.handle('get-mcp-api-config', (_event, id: string) => {
  return getMCPApiConfig(id);
});

// 保存 MCP API 配置
ipcMain.handle('save-mcp-api-config', (_event, config: any) => {
  log.info('[IPC] save-mcp-api-config called:', config?.name);
  return saveMCPApiConfig(config);
});

// 删除 MCP API 配置
ipcMain.handle('delete-mcp-api-config', (_event, id: string) => {
  log.info('[IPC] delete-mcp-api-config called:', id);
  return deleteMCPApiConfig(id);
});

// 切换 MCP API 配置状态
ipcMain.handle('toggle-mcp-api-config', (_event, id: string, enabled: boolean) => {
  log.info('[IPC] toggle-mcp-api-config called:', id, enabled);
  const result = toggleMCPApiConfig(id, enabled);
  // 通知渲染进程状态变化，让技能树刷新
  if (mainWindow) {
    mainWindow.webContents.send('mcp-status-changed');
  }
  return result;
});

// 获取 MCP API 平台列表
ipcMain.handle('get-mcp-api-platforms', () => {
  return mcpApiProtocolLoader.getPlatformList();
});

// 获取 MCP API 平台输入字段
ipcMain.handle('get-mcp-api-platform-input-fields', (_event, platformId: string) => {
  return mcpApiProtocolLoader.getInputFields(platformId);
});

// 获取 MCP API 配置的工具列表
ipcMain.handle('get-mcp-api-tools', async (_event, configId: string) => {
  log.info('[IPC] get-mcp-api-tools called:', configId);
  try {
    const config = getMCPApiConfig(configId);
    if (!config || !config.enabled) {
      return [];
    }
    
    // MCPAPI 的工具列表：每个 MCP Server 作为一个可选能力
    // 工具名称格式: "{serverLabel}" 或 "{serverLabel}/{actualToolName}"
    // 由于外部 MCP Server 的工具需要动态发现，这里先返回 Server 作为能力入口
    const tools = (config.mcpServers || []).map((server: any) => ({
      name: server.label || server.name || 'unknown',
      description: server.description || `MCP Server: ${server.label || server.name}`,
      inputSchema: {
        type: 'object',
        properties: {
          tool: { 
            type: 'string', 
            description: '要调用的工具名称（可选，如果不指定则直接与 MCP Server 通信）' 
          },
          arguments: { 
            type: 'object', 
            description: '工具调用参数' 
          }
        }
      }
    }));
    
    log.info(`[IPC] get-mcp-api-tools returned ${tools.length} tools for ${configId}`);
    return tools;
  } catch (error) {
    log.error('[IPC] get-mcp-api-tools error:', error);
    return [];
  }
});


// ==================== MCP 协议执行 IPC ====================

// ==================== MCP 协议执行 IPC ====================

// 启动 MCP Server
ipcMain.handle('start-mcp-server', async (_event, serverId: string) => {
  log.info('[IPC] start-mcp-server called:', serverId);
  return mcpManager.startServer(serverId);
});

// 停止 MCP Server
ipcMain.handle('stop-mcp-server', async (_event, serverId: string) => {
  log.info('[IPC] stop-mcp-server called:', serverId);
  return mcpManager.stopServer(serverId);
});

// 获取 MCP Server 工具列表
ipcMain.handle('get-mcp-server-tools', async (_event, serverId: string) => {
  return mcpManager.getTools(serverId);
});

// 调用 MCP 工具
ipcMain.handle('call-mcp-tool', async (_event, serverId: string, toolName: string, args: any) => {
  log.info('[IPC] call-mcp-tool called:', serverId, toolName);
  try {
    const result = await mcpManager.callTool(serverId, toolName, args);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// 获取 MCP Server 列表（带状态）
ipcMain.handle('get-mcp-server-list', () => {
  return mcpManager.getServerList();
});

// ==================== MCP 能力绑定 IPC ====================

// 绑定 Agent 能力
ipcMain.handle('bind-agent-capabilities', async (_event, agentId: string, capabilities: any[]) => {
  log.info('[IPC] bind-agent-capabilities called:', agentId);
  try {
    const binding = capabilityManager.bindCapabilities(agentId, capabilities);
    return { success: true, binding };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// 解绑 Agent 能力
ipcMain.handle('unbind-agent-capabilities', async (_event, agentId: string, capabilities: any[]) => {
  log.info('[IPC] unbind-agent-capabilities called:', agentId);
  try {
    const binding = capabilityManager.unbindCapabilities(agentId, capabilities);
    return { success: true, binding };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// 获取 Agent 能力绑定
ipcMain.handle('get-agent-capabilities', (_event, agentId: string) => {
  return capabilityManager.getBinding(agentId);
});

// 列出所有能力绑定
ipcMain.handle('list-agent-capabilities', () => {
  return capabilityManager.listBindings();
});

// 检查 Agent 权限
ipcMain.handle('check-agent-permission', (_event, agentId: string, server: string, tool: string) => {
  return capabilityManager.hasPermission(agentId, server, tool);
});

// 获取 MCP HTTP API 地址
ipcMain.handle('get-mcp-http-endpoint', () => {
  return mcpHttpServer.getAddress();
});

// 保存 npm 镜像源设置
ipcMain.handle('save-npm-registry', async (_event, registry: 'auto' | 'china' | 'official') => {
  log.info('[IPC] save-npm-registry called:', registry);
  const config = getProtocolConfig();
  config.npmRegistry = registry;
  config.lastUpdated = new Date().toISOString();
  saveProtocolConfig(config);
});

// 获取 npm 镜像源设置
ipcMain.handle('get-npm-registry', () => {
  const config = getProtocolConfig();
  return config.npmRegistry || 'auto';
});


// ==================== A2A 协议执行 IPC ====================

// 发送 A2A 任务（同步）
ipcMain.handle('send-a2a-task-sync', async (_event, agentId: string, task: string, timeout?: number) => {
  log.info('[IPC] send-a2a-task-sync called:', agentId, 'timeout:', timeout);
  try {
    // 默认超时 5 分钟，AHIVECORE 可能需要更长时间
    const actualTimeout = timeout || 300000;
    const result = await a2aManager.sendTaskSync(agentId, task, actualTimeout);
    return { success: true, result };
  } catch (error: any) {
    return { success: false, error: error?.message || String(error) || 'Unknown error' };
  }
});

// 发送 A2A 任务（异步）
ipcMain.handle('send-a2a-task-async', async (_event, agentId: string, task: string, webhookUrl?: string) => {
  log.info('[IPC] send-a2a-task-async called:', agentId);
  try {
    const taskId = await a2aManager.sendTaskAsync(agentId, task, webhookUrl);
    return { success: true, taskId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// 获取 A2A 任务状态
ipcMain.handle('get-a2a-task-status', (_event, agentId: string, taskId: string) => {
  return a2aManager.getTaskStatus(agentId, taskId);
});

// 取消 A2A 任务
ipcMain.handle('cancel-a2a-task', async (_event, agentId: string, taskId: string) => {
  return a2aManager.cancelTask(agentId, taskId);
});

// 刷新 A2A Agent Card
ipcMain.handle('refresh-a2a-agent-card', async (_event, agentId: string) => {
  return a2aManager.refreshAgentCard(agentId);
});

// 获取 A2A Agent 列表（带 Card）
ipcMain.handle('get-a2a-agent-list', () => {
  return a2aManager.getAgentList();
});

// 发现 A2A Agent Card (绕过 CORS)
ipcMain.handle('discover-a2a-agent-card', async (_event, endpoint: string, protocolType?: string, allowLocalNetwork?: boolean) => {
  log.info('[IPC] discover-a2a-agent-card called:', endpoint, protocolType, 'allowLocalNetwork:', allowLocalNetwork);

  // AHIVECORE 协议默认允许访问本地网络
  const shouldAllowLocal = allowLocalNetwork || protocolType === 'ahivecore';

  // SSRF 防护：验证 URL
  const validateUrl = (url: string, allowLocal: boolean): { valid: boolean; error?: string } => {
    try {
      const parsed = new URL(url);
      
      // 只允许 http 和 https 协议
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, error: 'Invalid protocol. Only http and https are allowed.' };
      }
      
      // 如果允许本地网络，跳过内网检查
      if (allowLocal) {
        return { valid: true };
      }
      
      // 阻止访问内网 IP 地址
      const hostname = parsed.hostname;
      const blockedPatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^0\.0\.0\.0$/,
        /^::1$/,
        /^fc00:/i,
        /^fe80:/i,
      ];
      
      for (const pattern of blockedPatterns) {
        if (pattern.test(hostname)) {
          return { valid: false, error: 'Access to private/internal networks is not allowed. Enable "Allow Local Network" option for local agents.' };
        }
      }
      
      return { valid: true };
    } catch (e) {
      return { valid: false, error: 'Invalid URL format.' };
    }
  };

  try {
    // 验证 endpoint URL（传递 allowLocalNetwork 参数）
    const validation = validateUrl(endpoint, shouldAllowLocal);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // AHIVECORE 特殊处理：使用 /health 和 /api/unified-agents/active 端点
    if (protocolType === 'ahivecore') {
      return await discoverAHIVECOREAgent(endpoint);
    }

    // OpenCode 特殊处理：使用 /session 端点验证连接
    if (protocolType === 'opencode') {
      return await discoverOpenCodeAgent(endpoint);
    }

    // OpenClaw 和标准 A2A：尝试多个发现路径
    const paths = protocolType === 'openclaw'
      ? ['/.well-known/a2a/agent-card', '/.well-known/agent.json', '/agentCard', '/v1/responses']
      : ['/.well-known/a2a/agent-card', '/.well-known/agent.json', '/agentCard'];

    for (const path of paths) {
      try {
        const url = endpoint.replace(/\/\/+$/, '') + path;
        log.info(`[A2A] Trying to fetch: ${url}`);

        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000) // 5秒超时
        });

        if (response.ok) {
          const data = await response.json();
          log.info(`[A2A] Successfully fetched agent card from ${path}`);

          // 标准化返回格式
          return {
            success: true,
            card: {
              id: data.agentId || data.id || '',
              name: data.name || 'Unknown Agent',
              description: data.description || '',
              url: data.url || endpoint,
              capabilities: data.capabilities || [],
              version: data.version || '1.0.0'
            },
            endpoint: path
          };
        }
      } catch (err) {
        log.debug(`[A2A] Failed to fetch from ${path}:`, err);
        continue;
      }
    }

    return {
      success: false,
      error: '未能发现 Agent Card，请检查端点 URL 是否正确，或手动填写信息'
    };
  } catch (error) {
    log.error('[A2A] Discover agent card error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * AHIVECORE Agent 发现（使用 /health 和 /api/unified-agents/active 端点）
 */
async function discoverAHIVECOREAgent(endpoint: string): Promise<{ success: boolean; card?: any; endpoint?: string; error?: string }> {
  try {
    // 1. 首先检查健康状态
    const healthUrl = endpoint.replace(/\/\/+$/, '') + '/health';
    log.info(`[A2A] AHIVECORE: Checking health at ${healthUrl}`);
    
    const healthResponse = await fetch(healthUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000) // 30秒超时
    });
    
    if (!healthResponse.ok) {
      return {
        success: false,
        error: `AHIVECORE 服务不可用: ${healthResponse.status}`
      };
    }
    
    const healthData = await healthResponse.json();
    log.info(`[A2A] AHIVECORE: Health check passed`, healthData);
    
    // 2. 获取活跃智能体信息
    const activeUrl = endpoint.replace(/\/\/+$/, '') + '/api/unified-agents/active';
    log.info(`[A2A] AHIVECORE: Fetching active agent from ${activeUrl}`);
    
    const activeResponse = await fetch(activeUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    
    let agentInfo: any = {
      id: 'ahivecore-default',
      name: 'AHIVECORE Agent',
      description: 'AHIVECORE 本地智能体引擎',
      capabilities: ['chat', 'tools', 'code'],
      version: '1.0.0'
    };
    
    if (activeResponse.ok) {
      const activeData = await activeResponse.json();
      log.info(`[A2A] AHIVECORE: Active agent data`, activeData);
      
      if (activeData.active && activeData.agent_id) {
        agentInfo.id = activeData.agent_id;
        agentInfo.name = `AHIVECORE ${activeData.type || 'Agent'}`;
        if (activeData.model) {
          agentInfo.model = activeData.model.name || activeData.model;
        }
      }
    }
    
    // 3. 返回成功结果
    return {
      success: true,
      card: {
        id: agentInfo.id,
        name: agentInfo.name,
        description: agentInfo.description,
        url: endpoint,
        capabilities: agentInfo.capabilities,
        version: healthData.version || agentInfo.version,
        model: agentInfo.model
      },
      endpoint: '/health'
    };
    
  } catch (error) {
    log.error('[A2A] AHIVECORE discover error:', error);
    return {
      success: false,
      error: `连接 AHIVECORE 失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * OpenCode Agent 发现（使用 /session 端点验证连接）
 */
async function discoverOpenCodeAgent(endpoint: string): Promise<{ success: boolean; card?: any; endpoint?: string; error?: string }> {
  try {
    const url = endpoint.replace(/\/\/+$/, '') + '/session';
    log.info(`[A2A] OpenCode: Testing connection with ${url}`);

    // 尝试创建临时 session 来验证连接
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ directory: process.cwd() }),
      signal: AbortSignal.timeout(10000) // 10秒超时
    });

    if (response.ok) {
      const data = await response.json();
      log.info('[A2A] OpenCode: Connection successful, session created:', data.id);

      // 返回生成的 Agent Card
      return {
        success: true,
        card: {
          id: data.id || '',
          name: 'OpenCode Agent',
          description: 'OpenCode Serve API Agent',
          url: endpoint,
          capabilities: ['chat', 'code', 'tools'],
          version: data.version || '1.0.0'
        },
        endpoint: '/session'
      };
    } else if (response.status === 401) {
      // 需要认证，但服务器可达
      log.info('[A2A] OpenCode: Server reachable, authentication required');
      return {
        success: true,
        card: {
          id: '',
          name: 'OpenCode Agent',
          description: 'OpenCode Serve API Agent (需要 API Key)',
          url: endpoint,
          capabilities: ['chat', 'code', 'tools'],
          version: '1.0.0'
        },
        endpoint: '/session'
      };
    } else {
      return {
        success: false,
        error: `OpenCode 服务器响应: ${response.status} ${response.statusText}`
      };
    }
  } catch (err) {
    log.error('[A2A] OpenCode discovery failed:', err);
    return {
      success: false,
      error: `无法连接到 OpenCode 服务器: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

// ========== Agent 技能持久化 ==========

ipcMain.handle('get-persisted-agents', () => {
  return getAgents();
});

ipcMain.handle('get-persisted-agent', (_event, id: string) => {
  return getAgent(id);
});

ipcMain.handle('save-agent', (_event, agent: any) => {
  return saveAgent(agent);
});

ipcMain.handle('update-agent-skills', (_event, id: string, skills: string[]) => {
  return updateAgentSkills(id, skills);
});

ipcMain.handle('delete-agent', (_event, id: string) => {
  return deleteAgent(id);
});

ipcMain.handle('save-agents', (_event, agents: any[]) => {
  return saveAgents(agents);
});

// ========== 语音 API ==========

/**
 * TTS - 调用 OpenClaw 将文字转为语音
 */
ipcMain.handle('invoke-tts', async (_event, text: string) => {
  try {
    const { spawn } = await import('child_process');
    
    // 输入验证：限制文本长度和字符
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Invalid text input' };
    }
    if (text.length > 1000) {
      return { success: false, error: 'Text too long (max 1000 chars)' };
    }
    
    // 使用 spawn 替代 exec，避免 shell 注入
    return new Promise((resolve) => {
      const process = spawn('openclaw', ['tts', text], {
        shell: false,  // 禁用 shell，防止命令注入
        timeout: 30000  // 30秒超时
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, message: 'TTS 请求已发送' });
        } else {
          resolve({ success: false, error: stderr || `Process exited with code ${code}` });
        }
      });
      
      process.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error: any) {
    log.error('[TTS] Error:', error);
    return {
      success: false,
      error: error.message || 'TTS 调用失败',
    };
  }
});

/**
 * 获取可用声音列表 (通过 Web Speech API，由前端直接调用)
 */
ipcMain.handle('get-voices', async () => {
  // 这个 API 实际上由前端 Web Speech API 提供
  // 这里保留作为扩展点，未来可以集成服务端 TTS 声音列表
  return {
    success: true,
    message: '请通过 window.speechSynthesis.getVoices() 获取',
  };
});

// ========== A2A 健康检查 ==========

const HEALTH_CHECK_INTERVAL = 30000; // 30秒
let healthCheckTimer: NodeJS.Timeout | null = null;

/**
 * 执行健康检查
 */
async function performHealthCheck() {
  try {
    const results = await a2aManager.healthCheckAll();
    const offlineAgents: string[] = [];
    
    results.forEach((healthy, agentId) => {
      if (!healthy) {
        // 添加 a2a- 前缀，匹配前端 Agent 列表中的 ID 格式
        offlineAgents.push(`a2a-${agentId}`);
        log.warn(`[HealthCheck] Agent offline: ${agentId}`);
      }
    });
    
    // 推送给前端
    if (mainWindow) {
      mainWindow.webContents.send('a2a-health-status', {
        offlineAgents,
        totalAgents: results.size,
        timestamp: Date.now()
      });
    }
    
    log.info(`[HealthCheck] Completed: ${results.size - offlineAgents.length}/${results.size} online`);
  } catch (err) {
    log.error('[HealthCheck] Failed:', err);
  }
}

/**
 * 启动健康检查定时器
 */
function startHealthCheck() {
  if (healthCheckTimer) return;
  
  // 启动时立即执行一次
  performHealthCheck();
  
  healthCheckTimer = setInterval(performHealthCheck, HEALTH_CHECK_INTERVAL);
  log.info('[HealthCheck] Started with interval:', HEALTH_CHECK_INTERVAL);
}

/**
 * 停止健康检查
 */
function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    log.info('[HealthCheck] Stopped');
  }
}

// IPC handlers for health check
ipcMain.handle('check-a2a-health', async () => {
  return await a2aManager.healthCheckAll();
});

ipcMain.handle('start-health-check', () => {
  startHealthCheck();
  return true;
});

ipcMain.handle('stop-health-check', () => {
  stopHealthCheck();
  return true;
});

// ==================== 系统状态检测 IPC ====================

/**
 * 检测 OpenClaw 是否安装
 */
ipcMain.handle('check-openclaw-installed', async () => {
  try {
    const result = await executeCLISafe('openclaw', ['--version']);
    return {
      installed: result.success,
      version: result.success ? result.stdout.trim() : null,
      error: result.success ? null : result.error
    };
  } catch (error) {
    return { installed: false, version: null, error: String(error) };
  }
});

/**
 * 检测 OpenCode 是否安装
 */
ipcMain.handle('check-opencode-installed', async () => {
  try {
    const result = await executeCLISafe('opencode', ['--version']);
    return {
      installed: result.success,
      version: result.success ? result.stdout.trim() : null,
      error: result.success ? null : result.error
    };
  } catch (error) {
    return { installed: false, version: null, error: String(error) };
  }
});

/**
 * 获取系统服务状态汇总
 */
ipcMain.handle('get-system-services-status', async () => {
  // 获取 Gateway 状态
  const gatewayStatusData = { status: gatewayStatus, error: gatewayErrorMsg };

  // 获取 MCP HTTP 服务地址
  const mcpHttpEndpoint = mcpHttpServer.getAddress();

  // 获取 A2A 服务信息
  const a2aAgents = getA2AAgents();
  const enabledA2AAgents = a2aAgents.filter(a => a.enabled);

  return {
    gateway: gatewayStatusData,
    mcpHttpEndpoint,
    a2a: {
      totalAgents: a2aAgents.length,
      enabledAgents: enabledA2AAgents.length
    }
  };
});

/**
 * 获取 A2A 通讯接口 URL
 * A2A HTTP Server 运行在 Electron 客户端，端口 3003
 */
ipcMain.handle('get-a2a-endpoint', () => {
  if (a2aHttpServer && a2aHttpServer.isRunning()) {
    return a2aHttpServer.getAddress();
  }
  // 服务未启动时返回默认地址
  return 'http://127.0.0.1:3003';
});

/**
 * 启动 OpenCode serve
 * @param port 服务端口
 */
let openCodeProcess: ChildProcess | null = null;

/**
 * 杀掉占用指定端口的进程（Windows）
 */
async function killProcessOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
      if (error || !stdout) {
        resolve();
        return;
      }

      // 解析 netstat 输出，找到占用端口的 PID
      const lines = stdout.trim().split('\n');
      const pids = new Set<number>();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid > 0) {
          pids.add(pid);
        }
      }

      if (pids.size === 0) {
        resolve();
        return;
      }

      log.info(`[OpenCode] Killing processes on port ${port}: ${Array.from(pids).join(', ')}`);

      // 杀掉所有占用端口的进程
      let killed = 0;
      for (const pid of pids) {
        exec(`taskkill /F /PID ${pid}`, (err) => {
          if (!err) killed++;
        });
      }

      // 等待进程被杀掉
      setTimeout(resolve, 2000);
    });
  });
}

ipcMain.handle('start-opencode-serve', async (_event, port: number = 8095) => {
  // 如果已有进程，先尝试停止
  if (openCodeProcess) {
    try {
      openCodeProcess.kill();
      openCodeProcess = null;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch { /* ignore */ }
  }

  // 检查并清理占用端口的进程
  await killProcessOnPort(port);

  try {
    log.info(`[OpenCode] Starting serve on port ${port}...`);

    // 设置空密码，避免 OpenCode Desktop 设置的全局密码影响
    const env = { ...process.env, OPENCODE_SERVER_PASSWORD: '' };

    // Windows 需要使用 shell: true 才能找到全局安装的命令
    openCodeProcess = spawn('opencode', ['serve', '--port', String(port)], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env
    });

    let startupOutput = '';
    let errorOutput = '';

    openCodeProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      startupOutput += text;
      log.info('[OpenCode stdout]', text);
    });

    openCodeProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      log.warn('[OpenCode stderr]', text);
    });

    openCodeProcess.on('error', (err) => {
      log.error('[OpenCode] Process error:', err.message);
      openCodeProcess = null;
    });

    openCodeProcess.on('exit', (code, signal) => {
      log.info(`[OpenCode] Exited with code: ${code}, signal: ${signal}`);
      if (code !== 0 && code !== null) {
        log.error('[OpenCode] Exit error output:', errorOutput);
      }
      openCodeProcess = null;
    });

    // 等待启动
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (openCodeProcess && !openCodeProcess.killed) {
      return {
        success: true,
        endpoint: `http://127.0.0.1:${port}`,
        message: 'OpenCode serve 启动成功'
      };
    } else {
      return {
        success: false,
        error: errorOutput || '启动失败'
      };
    }
  } catch (error: any) {
    log.error('[OpenCode] Failed to start:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 停止 OpenCode serve
 */
ipcMain.handle('stop-opencode-serve', async () => {
  if (!openCodeProcess) {
    return { success: true };
  }

  try {
    openCodeProcess.kill();
    openCodeProcess = null;
    log.info('[OpenCode] Stopped');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 获取 OpenCode serve 状态
 */
ipcMain.handle('get-opencode-serve-status', () => {
  return {
    running: openCodeProcess !== null && !openCodeProcess.killed
  };
});


// ==================== LLM Center IPC ====================

/**
 * LLM 聊天
 */
ipcMain.handle('llm-chat', async (_event, messages: any[], options?: any) => {
  log.info('[IPC] llm-chat called');
  try {
    const response = await llmCenterService.chat(messages, options);
    return { success: true, response };
  } catch (error: any) {
    log.error('[IPC] llm-chat error:', error);
    return { success: false, error: error.message };
  }
});

/**
 * LLM 带记忆的聊天
 */
ipcMain.handle('llm-chat-with-memory', async (_event, query: string, options?: any) => {
  log.info('[IPC] llm-chat-with-memory called');
  try {
    const response = await llmCenterService.chatWithMemory(query, options);
    return { success: true, response };
  } catch (error: any) {
    log.error('[IPC] llm-chat-with-memory error:', error);
    return { success: false, error: error.message };
  }
});

/**
 * 获取 LLM 统计
 */
ipcMain.handle('llm-get-stats', async (_event, options?: { agentId?: string }) => {
  try {
    const stats = await llmCenterService.getStats(options);
    return { success: true, stats };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 重置 LLM 统计
 */
ipcMain.handle('llm-reset-stats', () => {
  llmCenterService.resetStats();
  return { success: true };
});

/**
 * 获取 LLM Provider 列表
 */
ipcMain.handle('llm-list-providers', () => {
  return llmCenterService.listProviders();
});

/**
 * 获取 LLM 服务配置
 */
ipcMain.handle('llm-get-config', () => {
  return llmCenterService.getConfig();
});

/**
 * 设置 LLM Provider 配置
 */
ipcMain.handle('llm-set-provider-config', async (_event, config: any) => {
  log.info('[IPC] llm-set-provider-config called:', config?.name);
  try {
    await llmCenterService.setProviderConfig(config);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 删除 LLM Provider 配置
 */
ipcMain.handle('llm-remove-provider-config', (_event, name: string) => {
  log.info('[IPC] llm-remove-provider-config called:', name);
  llmCenterService.removeProviderConfig(name);
  return { success: true };
});

/**
 * 设置默认 LLM Provider
 */
ipcMain.handle('llm-set-default-provider', (_event, name: string) => {
  log.info('[IPC] llm-set-default-provider called:', name);
  try {
    llmCenterService.setDefaultProvider(name);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 设置智能体 LLM 配置
 */
ipcMain.handle('llm-set-agent-config', (_event, agentId: string, config: any) => {
  log.info('[IPC] llm-set-agent-config called:', agentId);
  llmCenterService.setAgentConfig(agentId, config);
  return { success: true };
});

/**
 * 获取智能体 LLM 配置
 */
ipcMain.handle('llm-get-agent-config', (_event, agentId: string) => {
  return llmCenterService.getAgentConfig(agentId);
});


// ==================== LLM Gateway IPC ====================

/**
 * 获取 LLM Gateway 地址
 */
ipcMain.handle('llm-gateway-get-address', () => {
  return llmGateway.getAddress();
});

/**
 * 获取所有 AppKeys
 */
ipcMain.handle('llm-gateway-list-appkeys', () => {
  return llmGateway.listAppKeys();
});

/**
 * 生成 AppKey
 */
ipcMain.handle('llm-gateway-generate-appkey', (_event, agentId: string, agentName?: string) => {
  log.info('[IPC] llm-gateway-generate-appkey called:', agentId);
  return llmGateway.generateAppKey(agentId, agentName || agentId);
});

/**
 * 删除 AppKey
 */
ipcMain.handle('llm-gateway-delete-appkey', (_event, key: string) => {
  log.info('[IPC] llm-gateway-delete-appkey called:', key.substring(0, 12) + '...');
  return { success: llmGateway.deleteAppKey(key) };
});

/**
 * 启用/禁用 AppKey
 */
ipcMain.handle('llm-gateway-toggle-appkey', (_event, key: string, enabled: boolean) => {
  log.info('[IPC] llm-gateway-toggle-appkey called:', key.substring(0, 12) + '...', enabled);
  return { success: llmGateway.setAppKeyEnabled(key, enabled) };
});


// ==================== AHIVECORE IPC ====================

/**
 * 获取 AHIVECORE 连接状态
 */
ipcMain.handle('ahivecore-get-status', () => {
  return {
    connected: ahivecoreService.getConnectionState() === 'connected',
    state: ahivecoreService.getConnectionState(),
    config: ahivecoreService.getConfig()
  };
});

/**
 * 获取 AHIVECORE 智能体列表
 */
ipcMain.handle('ahivecore-get-agents', async () => {
  try {
    const agents = await ahivecoreService.getAgents();
    return { success: true, agents };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 激活 AHIVECORE 智能体
 */
ipcMain.handle('ahivecore-activate-agent', async (_event, agentId: string) => {
  try {
    const success = await ahivecoreService.activateAgent(agentId);
    return { success };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 获取 WebSocket 服务器状态
 */
ipcMain.handle('ahivecore-get-ws-status', () => {
  return {
    running: wsServer.getConnectionState() === 'connected',
    clients: wsServer.getClientCount(),
    clientIds: wsServer.getClientIds()
  };
});

/**
 * 启动 SSE 流式对话
 */
ipcMain.handle('ahivecore-start-stream', async (_event, agentId: string, message: string, sessionId?: string) => {
  try {
    await sseBridge.startStream(agentId, message, sessionId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 停止 SSE 流
 */
ipcMain.handle('ahivecore-stop-stream', async (_event, agentId: string) => {
  try {
    await sseBridge.stopStream(agentId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 发送用户输入（插话）
 */
ipcMain.handle('ahivecore-send-input', async (_event, agentId: string, input: string) => {
  try {
    await sseBridge.sendUserInput(agentId, input);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

/**
 * 中断对话（停止任务）
 */
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


// 退出时清理
app.on('before-quit', async () => {
  if (gatewayProcess) {
    await stopGateway();
  }
  // 停止 LLM Gateway
  await llmGateway.stop();
  // 销毁 LLM Center 服务
  llmCenterService.destroy();
  // 停止 AHIVECORE 服务
  await ahivecoreService.stop();
  await wsServer.stop();
});

log.info('Main process initialized');

// ========== Chromium 启动标志 ==========
// 解决渲染进程崩溃问题（退出码 -36861）
// 设置 locale 为 en-US 避免 DevTools locale 错误
app.commandLine.appendSwitch('lang', 'en-US');
// 使用 ANGLE OpenGL ES 2.0 实现（最稳定的 WebGL 实现）
app.commandLine.appendSwitch('use-angle', 'essl');
// 禁用 GPU 合成（避免 compositing 问题）
app.commandLine.appendSwitch('disable-gpu-compositing');
// 禁用 GPU 进程 sandbox（Windows 特定问题）
app.commandLine.appendSwitch('disable-gpu-sandbox');
// ========== Chromium 启动标志 END ==========

// 启动应用
app.whenReady().then(async () => {
  createWindow();
  
  // 初始化 A2A Manager
  try {
    await a2aManager.initialize();
    log.info('[Main] A2A Manager initialized');
    
    // 启动健康检查
    startHealthCheck();
  } catch (error) {
    log.error('[Main] Failed to initialize A2A Manager:', error);
  }
  
  // 初始化 AHIVECORE 服务
  // 先启动 WebSocket Server（独立于 AHIVECORE Service）
  try {
    wsServer = getWebSocketServer();
    await wsServer.start();
    log.info('[Main] WebSocket Server started on port 3005');
  } catch (error) {
    log.error('[Main] Failed to start WebSocket Server:', error);
  }
  
  // 初始化工作流调度器（需要在 wsServer 之后，因为 broadcast 回调依赖它）
  try {
    log.info('[Main] Starting WorkflowScheduler initialization...');
    
    const callAgent = async (
      agent: Agent,
      prompt: string,
      timeout?: number
    ): Promise<{ success: boolean; output: string; error?: string }> => {
      try {
        log.info(`[WorkflowScheduler] Calling agent: ${agent.name} (${agent.agentId || agent.id}), timeout: ${timeout || 120000}ms`);
        const result = await a2aManager.sendTaskSync(agent.agentId || agent.id, prompt, timeout || 120000);
        
        log.info(`[WorkflowScheduler] Agent response status: ${result.status}, artifacts: ${result.artifacts?.length || 0}`);
        
        if (result.status === 'completed' && result.artifacts?.length > 0) {
          const textArtifact = result.artifacts.find(a => a.type === 'text');
          return {
            success: true,
            output: textArtifact?.content || JSON.stringify(result.artifacts),
          };
        } else if (result.status === 'failed') {
          return {
            success: false,
            output: '',
            error: result.error || 'Task failed',
          };
        } else if (result.status === 'timeout') {
          return {
            success: false,
            output: '',
            error: `Agent task timeout after ${timeout || 120000}ms`,
          };
        } else if (result.status === 'pending' || result.status === 'working') {
          // 任务未完成，不应该返回成功
          log.warn(`[WorkflowScheduler] Agent task not completed, status: ${result.status}`);
          return {
            success: false,
            output: '',
            error: `Agent task not completed, status: ${result.status}`,
          };
        }
        
        // 未知状态，视为失败
        log.warn(`[WorkflowScheduler] Unknown agent status: ${result.status}`);
        return {
          success: false,
          output: result.artifacts?.map(a => a.content).join('\n') || '',
          error: `Unknown task status: ${result.status}`,
        };
      } catch (error: any) {
        log.error(`[WorkflowScheduler] Agent call failed: ${agent.id}`, error);
        return {
          success: false,
          output: '',
          error: error.message,
        };
      }
    };
    
    // 创建 broadcast 回调函数
    const broadcast = (event: WorkflowEvent) => {
      // 直接使用 wsServer 广播工作流事件
      if (wsServer) {
        wsServer.broadcastAll({
          type: event.type as any,
          agentId: event.instanceId,
          timestamp: event.timestamp,
          data: event,
        });
      }
    };
    
    // 创建 getAgents 回调函数
    const getAgents = (): Agent[] => {
      const a2aAgents = getA2AAgents();
      return a2aAgents.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description || '',
        status: a.enabled !== false ? 'idle' : 'offline',
        avatar: a.avatar || '',
        agentId: a.agentId,
        agentType: a.protocolType,
        skills: a.skills || [],
        type: a.protocolType === 'openclaw' ? 'openclaw' : 
              a.protocolType === 'ahivecore' ? 'custom' : 'a2a',
        protocolType: a.protocolType,
        createdAt: a.createdAt || new Date().toISOString(),
        updatedAt: a.updatedAt || new Date().toISOString(),
      }));
    };
    
    // 创建 getWorkflow 回调函数
    const getWorkflowCb = (workflowId: string): Workflow | undefined => {
      const wf = getWorkflow(workflowId);
      return wf as Workflow | undefined;
    };
    
    // 创建工作流状态数据库（动态导入）
    log.info('[Main] Importing WorkflowStateDB...');
    const { WorkflowStateDB } = await import('./workflow/persistence/WorkflowStateDB');
    log.info('[Main] WorkflowStateDB imported, creating instance...');
    const dbPath = join(process.cwd(), 'data', 'workflow-states', 'workflow.db');
    workflowStateDB = new WorkflowStateDB(dbPath);
    log.info('[Main] WorkflowStateDB initialized:', dbPath);
    
    const schedulerConfig: WorkflowSchedulerConfig = {
      wsServer,
      callAgent,
      broadcast,
      getAgents,
      getWorkflow: getWorkflowCb,
      // 从配置文件读取心跳和询问间隔
      heartbeatInterval: appConfig.workflow?.heartbeatInterval || 180000, // 默认 3 分钟
      pollInterval: appConfig.workflow?.pollInterval || 1800000,           // 默认 30 分钟
      stateDB: workflowStateDB,  // 传递数据库实例
    };
    
    workflowScheduler = new WorkflowScheduler(schedulerConfig);
    log.info('[Main] WorkflowScheduler initialized with config:', {
      heartbeatInterval: schedulerConfig.heartbeatInterval,
      pollInterval: schedulerConfig.pollInterval,
    });
    
    // 启动 WorkflowScheduler
    await workflowScheduler.start();
    log.info('[Main] WorkflowScheduler started');
    
    // 设置 WorkflowScheduler 到 WebSocketServer（用于处理 workflow-control 命令）
    if (wsServer) {
      wsServer.setWorkflowScheduler(workflowScheduler);
      log.info('[Main] WorkflowScheduler set to WebSocketServer');
    }
  } catch (error) {
    log.error('[Main] Failed to initialize WorkflowScheduler:', error);
  }

  // 创建 SSE 桥接器
  try {
    if (wsServer) {
      sseBridge = new SSEBridge(wsServer);
      log.info('[Main] SSE Bridge created');
      
      // 创建流式广播器
      const streamBroadcaster = getStreamBroadcaster(wsServer);
      log.info('[Main] StreamBroadcaster created');
    }
  } catch (error) {
    log.error('[Main] Failed to create SSE Bridge:', error);
  }

  // 初始化 AHIVECORE Service（独立于 WebSocket）
  try {
    ahivecoreService = getAHIVECoreService();
    await ahivecoreService.initialize();
    log.info('[Main] AHIVECORE Service initialized');
  } catch (error) {
    log.error('[Main] Failed to initialize AHIVECORE Service:', error);
  }

  // 监听 workflows 目录变化（用于自动刷新前端工作流列表）
  try {
    const workflowsDir = join(getDataDirectory(), 'workflows');
    if (existsSync(workflowsDir)) {
      const workflowWatcher = watch(workflowsDir, (eventType, filename) => {
        if (filename && filename.endsWith('.json') && eventType === 'rename') {
          // 'rename' 事件在文件创建或删除时触发
          const filePath = join(workflowsDir, filename);
          if (existsSync(filePath)) {
            // 文件被创建
            log.info(`[Main] New workflow detected: ${filename}`);
            // 广播给前端
            if (wsServer) {
              wsServer.broadcastAll({
                type: 'workflow-created',
                agentId: 'ahivecore',
                agentName: 'AHIVECORE',
                timestamp: Date.now(),
                data: { filename, path: filePath }
              });
            }
          }
        }
      });
      log.info(`[Main] Workflow directory watcher started: ${workflowsDir}`);
    } else {
      log.warn(`[Main] Workflow directory not found: ${workflowsDir}`);
    }
  } catch (error) {
    log.error('[Main] Failed to start workflow directory watcher:', error);
  }
});


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

