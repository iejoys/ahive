/**
 * AHIVECORE 模型管理服务
 * 
 * 功能：
 * - 列出可用模型
 * - 检测已下载模型
 * - 下载模型（支持多镜像源自动切换）
 * - 切换当前模型
 * - 删除模型
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '../../models');
const CONFIG_FILE = path.join(__dirname, '../../config/models.json');

/**
 * 下载镜像源
 */
export interface DownloadMirror {
  name: string;
  url: string;
  region: 'china' | 'global';
}

/**
 * 模型信息
 */
export interface ModelInfo {
  id: string;
  name: string;
  filename: string;
  size: string;
  sizeBytes: number;
  category?: 'general' | 'function-calling';
  developer?: string;
  baseModel?: string;
  description: string;
  capabilities?: {
    chat: string;
    math: string;
    code: string;
    functionCalling: string;
    reasoning: string;
  };
  bestFor?: string[];
  notGoodFor?: string[];
  requirements: {
    memory: string;
    disk: string;
    gpu?: string;
  };
  downloadMirrors: DownloadMirror[];
  note?: string;
  downloaded?: boolean;
  downloadedSize?: number;
  downloading?: boolean;
  progress?: number;
  currentMirror?: string;
}

/**
 * 模型配置
 */
export interface ModelsConfig {
  currentModel: string;
  models: ModelInfo[];
  settings: {
    defaultGpuLayers: number;
    defaultThreads: number;
    defaultContextSize: number;
    defaultTemperature: number;
    defaultMaxTokens: number;
  };
}

/**
 * 下载进度回调
 */
export type ProgressCallback = (progress: {
  percent: number;
  downloaded: number;
  total: number;
  speed: string;
  mirror?: string;
  mirrorIndex?: number;
  totalMirrors?: number;
}) => void;

/**
 * 模型管理器
 */
export class ModelManager {
  private config: ModelsConfig | null = null;
  private downloadAbortControllers: Map<string, AbortController> = new Map();

  /**
   * 加载配置
   */
  async loadConfig(): Promise<ModelsConfig> {
    if (this.config) return this.config;

    try {
      const content = await fs.readFile(CONFIG_FILE, 'utf-8');
      this.config = JSON.parse(content);
    } catch {
      // 配置文件不存在，使用默认配置
      this.config = {
        currentModel: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
        models: [],
        settings: {
          defaultGpuLayers: 0,
          defaultThreads: 4,
          defaultContextSize: 4096,
          defaultTemperature: 0.7,
          defaultMaxTokens: 2048,
        },
      };
    }

    return this.config;
  }

  /**
   * 保存配置
   */
  async saveConfig(): Promise<void> {
    if (!this.config) return;
    
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  /**
   * 获取模型列表（含下载状态）
   */
  async listModels(): Promise<ModelInfo[]> {
    const config = await this.loadConfig();
    
    // 检查 models 目录是否存在
    try {
      await fs.mkdir(MODELS_DIR, { recursive: true });
    } catch {
      // ignore
    }

    // 获取已下载的文件列表
    const downloadedFiles = new Set<string>();
    try {
      const files = await fs.readdir(MODELS_DIR);
      for (const file of files) {
        if (file.endsWith('.gguf')) {
          downloadedFiles.add(file);
        }
      }
    } catch {
      // ignore
    }

    // 标记下载状态
    return config.models.map(model => {
      const downloaded = downloadedFiles.has(model.filename);
      let downloadedSize: number | undefined;
      
      if (downloaded) {
        try {
          const stat = fsSync.statSync(path.join(MODELS_DIR, model.filename));
          downloadedSize = stat.size;
        } catch {
          // ignore
        }
      }

      return {
        ...model,
        downloaded,
        downloadedSize,
      };
    });
  }

  /**
   * 获取当前模型
   */
  async getCurrentModel(): Promise<ModelInfo | null> {
    const config = await this.loadConfig();
    const models = await this.listModels();
    return models.find(m => m.filename === config.currentModel) || null;
  }

  /**
   * 切换模型
   */
  async switchModel(modelId: string): Promise<{ success: boolean; error?: string }> {
    const config = await this.loadConfig();
    const model = config.models.find(m => m.id === modelId);
    
    if (!model) {
      return { success: false, error: `模型不存在: ${modelId}` };
    }

    // 检查是否已下载
    const modelPath = path.join(MODELS_DIR, model.filename);
    if (!fsSync.existsSync(modelPath)) {
      return { success: false, error: `模型未下载: ${model.name}` };
    }

    // 更新配置
    config.currentModel = model.filename;
    await this.saveConfig();

    return { success: true };
  }

  /**
   * 下载模型（支持多镜像源自动切换）
   */
  async downloadModel(
    modelId: string,
    onProgress?: ProgressCallback
  ): Promise<{ success: boolean; error?: string }> {
    const config = await this.loadConfig();
    const model = config.models.find(m => m.id === modelId);
    
    if (!model) {
      return { success: false, error: `模型不存在: ${modelId}` };
    }

    const modelPath = path.join(MODELS_DIR, model.filename);
    
    // 检查是否已下载
    if (fsSync.existsSync(modelPath)) {
      const stat = fsSync.statSync(modelPath);
      if (stat.size > model.sizeBytes * 0.9) {
        return { success: true }; // 已下载
      }
      // 文件不完整，删除重新下载
      fsSync.unlinkSync(modelPath);
    }

    // 创建目录
    await fs.mkdir(MODELS_DIR, { recursive: true });

    // 创建 AbortController
    const abortController = new AbortController();
    this.downloadAbortControllers.set(modelId, abortController);

    const mirrors = model.downloadMirrors;
    if (!mirrors || mirrors.length === 0) {
      return { success: false, error: '模型没有配置下载镜像源' };
    }

    const errors: string[] = [];

    // 尝试每个镜像源
    for (let i = 0; i < mirrors.length; i++) {
      const mirror = mirrors[i];
      
      console.log(`[ModelManager] 尝试镜像源 [${i + 1}/${mirrors.length}]: ${mirror.name}`);
      
      // 通知前端当前使用的镜像
      if (onProgress) {
        onProgress({
          percent: 0,
          downloaded: 0,
          total: model.sizeBytes,
          speed: '0 MB/s',
          mirror: mirror.name,
          mirrorIndex: i + 1,
          totalMirrors: mirrors.length,
        });
      }

      try {
        await this.downloadFile(
          mirror.url,
          modelPath,
          model.sizeBytes,
          (progress) => {
            if (onProgress) {
              onProgress({
                ...progress,
                mirror: mirror.name,
                mirrorIndex: i + 1,
                totalMirrors: mirrors.length,
              });
            }
          },
          abortController.signal
        );
        
        // 验证文件大小
        const stat = fsSync.statSync(modelPath);
        if (stat.size < model.sizeBytes * 0.9) {
          throw new Error(`文件不完整: ${stat.size} < ${model.sizeBytes * 0.9}`);
        }
        
        console.log(`[ModelManager] 下载成功: ${mirror.name}`);
        return { success: true };
        
      } catch (error) {
        const errMsg = (error as Error).message;
        console.error(`[ModelManager] 镜像源 ${mirror.name} 失败: ${errMsg}`);
        errors.push(`${mirror.name}: ${errMsg}`);
        
        // 清理失败的文件
        if (fsSync.existsSync(modelPath)) {
          try {
            fsSync.unlinkSync(modelPath);
          } catch {
            // ignore
          }
        }
        
        // 如果是用户取消，直接返回
        if (errMsg === 'aborted') {
          this.downloadAbortControllers.delete(modelId);
          return { success: false, error: '下载已取消' };
        }
        
        // 继续尝试下一个镜像
        if (i < mirrors.length - 1) {
          console.log(`[ModelManager] 切换到下一个镜像源...`);
        }
      }
    }

    // 所有镜像都失败
    this.downloadAbortControllers.delete(modelId);
    return {
      success: false,
      error: `所有镜像源均失败:\n${errors.join('\n')}`,
    };
  }

  /**
   * 取消下载
   */
  cancelDownload(modelId: string): void {
    const controller = this.downloadAbortControllers.get(modelId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * 删除模型
   */
  async deleteModel(modelId: string): Promise<{ success: boolean; error?: string }> {
    const config = await this.loadConfig();
    const model = config.models.find(m => m.id === modelId);
    
    if (!model) {
      return { success: false, error: `模型不存在: ${modelId}` };
    }

    // 不允许删除当前使用的模型
    if (config.currentModel === model.filename) {
      return { success: false, error: '无法删除当前正在使用的模型' };
    }

    const modelPath = path.join(MODELS_DIR, model.filename);
    
    try {
      if (fsSync.existsSync(modelPath)) {
        await fs.unlink(modelPath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 获取当前模型路径
   */
  async getCurrentModelPath(): Promise<string> {
    const config = await this.loadConfig();
    return path.join(MODELS_DIR, config.currentModel);
  }

  /**
   * 更新设置
   */
  async updateSettings(settings: Partial<ModelsConfig['settings']>): Promise<void> {
    const config = await this.loadConfig();
    config.settings = { ...config.settings, ...settings };
    await this.saveConfig();
  }

  /**
   * 获取设置
   */
  async getSettings(): Promise<ModelsConfig['settings']> {
    const config = await this.loadConfig();
    return config.settings;
  }

  /**
   * 下载文件
   */
  private downloadFile(
    url: string,
    destPath: string,
    expectedSize: number,
    onProgress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const file = fsSync.createWriteStream(destPath);
      let downloaded = 0;
      let startTime = Date.now();

      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'AHIVECORE/0.1.0',
        },
        timeout: 120000, // 2分钟超时
      }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          fsSync.unlinkSync(destPath);
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.downloadFile(redirectUrl, destPath, expectedSize, onProgress, signal)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fsSync.unlinkSync(destPath);
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const total = parseInt(response.headers['content-length'] || '0', 10) || expectedSize;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          
          if (onProgress) {
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? (downloaded / elapsed / 1024 / 1024).toFixed(2) + ' MB/s' : '0 MB/s';
            
            onProgress({
              percent: Math.round((downloaded / total) * 100),
              downloaded,
              total,
              speed,
            });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        try {
          fsSync.unlinkSync(destPath);
        } catch {
          // ignore
        }
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        try {
          fsSync.unlinkSync(destPath);
        } catch {
          // ignore
        }
        reject(new Error('连接超时'));
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          request.destroy();
          file.close();
          try {
            fsSync.unlinkSync(destPath);
          } catch {
            // ignore
          }
          reject(new Error('aborted'));
        });
      }
    });
  }
}

// 全局实例
let globalModelManager: ModelManager | null = null;

/**
 * 获取模型管理器实例
 */
export function getModelManager(): ModelManager {
  if (!globalModelManager) {
    globalModelManager = new ModelManager();
  }
  return globalModelManager;
}