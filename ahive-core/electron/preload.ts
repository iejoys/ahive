/**
 * AHIVECORE Electron Preload 脚本
 *
 * 安全地暴露 IPC API 给渲染进程
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// 定义 IPC 通道
export interface AppConfig {
  gpuLayers: number;
  threads: number;
  contextSize: number;
  temperature: number;
  maxTokens: number;
}

export interface ModelStatus {
  exists: boolean;
  path: string;
  name: string;
}

// 暴露安全的 IPC API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 配置相关
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (newConfig: Partial<AppConfig>) => ipcRenderer.invoke('save-config', newConfig),

  // 模型相关
  getModelStatus: () => ipcRenderer.invoke('get-model-status'),

  // 事件监听
  onConfigChanged: (callback: (config: AppConfig) => void) => {
    const handler = (_event: IpcRendererEvent, config: AppConfig) => callback(config);
    ipcRenderer.on('config-changed', handler);
    return () => ipcRenderer.removeListener('config-changed', handler);
  }
});

// 类型声明
declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<AppConfig>;
      saveConfig: (newConfig: Partial<AppConfig>) => Promise<{ success: boolean }>;
      getModelStatus: () => Promise<ModelStatus>;
      onConfigChanged: (callback: (config: AppConfig) => void) => () => void;
    };
  }
}
