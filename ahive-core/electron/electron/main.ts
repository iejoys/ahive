/**
 * AHIVECORE Desktop - Electron 主进程
 * 
 * 功能：
 * - 内嵌本地模型服务
 * - 开机自动启动
 * - 系统托盘
 * - GPU 设置
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, ipcMain } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let isQuitting = false;

// 路径配置
const isDev = !app.isPackaged;
const appPath = isDev ? join(__dirname, '..') : process.resourcesPath;
const modelsPath = join(appPath, 'models');
const modelFile = 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf';

// 配置文件
const configPath = join(app.getPath('userData'), 'config.json');
interface AppConfig {
  gpuLayers: number;
  threads: number;
  contextSize: number;
  temperature: number;
  maxTokens: number;
}
let config: AppConfig = loadConfig();

function loadConfig(): AppConfig {
  const defaultConfig: AppConfig = {
    gpuLayers: 0,
    threads: 4,
    contextSize: 4096,
    temperature: 0.7,
    maxTokens: 2048
  };
  
  try {
    if (existsSync(configPath)) {
      return { ...defaultConfig, ...JSON.parse(readFileSync(configPath, 'utf-8')) };
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return defaultConfig;
}

function saveConfig() {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'AHIVECORE',
    icon: join(appPath, 'electron/resources/icon.png'),
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    show: false
  });

  // 加载页面
  const serverUrl = 'http://127.0.0.1:18790';
  
  // 等待服务器启动后加载
  const checkAndLoad = () => {
    fetch(serverUrl)
      .then(() => {
        mainWindow?.loadURL(serverUrl);
        mainWindow?.show();
      })
      .catch(() => {
        // 服务器还没启动，继续等待
        setTimeout(checkAndLoad, 500);
      });
  };
  
  setTimeout(checkAndLoad, 1000);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 创建托盘
function createTray() {
  const iconPath = join(appPath, 'electron/resources/icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    { 
      label: 'GPU 加速', 
      type: 'checkbox', 
      checked: config.gpuLayers > 0,
      click: (item) => {
        config.gpuLayers = item.checked ? 99 : 0;
        saveConfig();
        dialog.showMessageBox({
          type: 'info',
          message: 'GPU 设置已更改',
          detail: '请重启应用以应用新设置'
        });
      }
    },
    { type: 'separator' },
    { label: '打开配置目录', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '关于', click: () => {
      dialog.showMessageBox({
        type: 'info',
        title: '关于 AHIVECORE',
        message: 'AHIVECORE 智能体核心引擎',
        detail: `版本: ${app.getVersion()}\n模型: Qwen2.5-1.5B-Instruct\n\n© 2026 星未来软件工作室\nQQ: 8980188\n微信: etflyer`
      });
    }},
    { type: 'separator' },
    { label: '退出', click: () => {
      isQuitting = true;
      app.quit();
    }}
  ]);
  
  tray.setToolTip('AHIVECORE');
  tray.setContextMenu(contextMenu);
  
  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

// 启动服务器
function startServer() {
  if (serverProcess) return;
  
  console.log('Starting AHIVECORE server...');
  
  const mainPath = isDev 
    ? join(__dirname, '../dist/main.js')
    : join(appPath, 'app/dist/main.js');
  
  const env = {
    ...process.env,
    MODEL_MODE: 'embedded',
    AHIVE_PORT: '18790',
    GPU_LAYERS: String(config.gpuLayers),
    THREADS: String(config.threads)
  };
  
  serverProcess = spawn(process.execPath, [mainPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  
  serverProcess.stdout?.on('data', (data) => {
    console.log('[Server]', data.toString());
  });
  
  serverProcess.stderr?.on('data', (data) => {
    console.error('[Server Error]', data.toString());
  });
  
  serverProcess.on('exit', (code) => {
    console.log('Server exited with code:', code);
    serverProcess = null;
  });
}

// 停止服务器
function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// IPC 处理
ipcMain.handle('get-config', () => config);

ipcMain.handle('save-config', (_, newConfig) => {
  config = { ...config, ...newConfig };
  saveConfig();
  return { success: true };
});

ipcMain.handle('get-model-status', () => {
  const modelPath = join(modelsPath, modelFile);
  return {
    exists: existsSync(modelPath),
    path: modelPath,
    name: 'Qwen2.5-1.5B-Instruct-Q4'
  };
});

// 应用生命周期
app.whenReady().then(() => {
  // 检查模型
  const modelPath = join(modelsPath, modelFile);
  if (!existsSync(modelPath)) {
    dialog.showErrorBox(
      '模型文件缺失',
      '未找到模型文件，请重新安装或手动下载模型到：\n' + modelPath
    );
    app.quit();
    return;
  }
  
  startServer();
  createTray();
  createWindow();
});

app.on('window-all-closed', () => {
  // 不退出，保持在托盘运行
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('will-quit', () => {
  stopServer();
});