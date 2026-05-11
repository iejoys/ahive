/**
 * LSP Client Manager - LSP 客户端管理器
 *
 * 管理多个 LSP Client，根据文件扩展名自动路由请求
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logger } from '../utils/index.js';
import { LSPClient } from './LSPClient.js';
import type {
  LSPRequest,
  LSPResult,
  LSPServerConfig,
  LSPOperation,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * LSP Client Manager
 *
 * 在主进程中运行，管理所有 LSP Client
 */
export class LSPClientManager {
  private clients = new Map<string, LSPClient>();
  private extensionMap = new Map<string, string>(); // extension -> clientName
  private configs: LSPServerConfig[] = [];
  private initialized = false;

  /**
   * 默认 LSP 服务器配置
   */
  private defaultConfigs: LSPServerConfig[] = [
    {
      name: 'typescript',
      command: 'typescript-language-server',
      args: ['--stdio'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      enabled: true,
    },
    {
      name: 'pyright',
      command: 'pyright-langserver',
      args: ['--stdio'],
      extensions: ['.py', '.pyi'],
      enabled: false,
    },
    {
      name: 'gopls',
      command: 'gopls',
      args: [],
      extensions: ['.go'],
      enabled: false,
    },
    {
      name: 'clangd',
      command: 'clangd',
      args: ['--background-index'],
      extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp'],
      enabled: false,
    },
  ];

  /**
   * 初始化所有启用的 LSP Client
   */
  async initialize(configs?: LSPServerConfig[]): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 加载配置
    this.configs = configs || await this.loadConfig();

    // 构建扩展名映射
    for (const config of this.configs) {
      if (config.enabled) {
        for (const ext of config.extensions) {
          this.extensionMap.set(ext.toLowerCase(), config.name);
        }
      }
    }

    // 启动启用的 LSP Server
    for (const config of this.configs) {
      if (config.enabled) {
        await this.startClient(config);
      }
    }

    this.initialized = true;
    logger.info(`[LSPClientManager] Initialized with ${this.clients.size} clients`);
  }

  /**
   * 从配置文件加载
   */
  private async loadConfig(): Promise<LSPServerConfig[]> {
    // 尝试从配置文件加载
    const configPath = path.join(process.cwd(), 'config', 'lsp-servers.yaml');

    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        // 简单的 YAML 解析（不引入依赖）
        return this.parseYamlConfig(content);
      } catch (error) {
        logger.warn(`[LSPClientManager] Failed to load config: ${error}`);
      }
    }

    return this.defaultConfigs;
  }

  /**
   * 简单 YAML 解析
   */
  private parseYamlConfig(content: string): LSPServerConfig[] {
    const configs: LSPServerConfig[] = [];
    let currentServer: Partial<LSPServerConfig> | null = null;
    let inServers = false;
    let inExtensions = false;
    let inArgs = false;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // 跳过空行和注释
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 检测 servers 块
      if (trimmed === 'servers:') {
        inServers = true;
        continue;
      }

      // 如果不在 servers 块内，跳过
      if (!inServers) continue;

      // 检测缩进级别，确定是否是顶级字段（version 等）
      if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t') && trimmed !== 'servers:') {
        // 离开 servers 块
        break;
      }

      // 新服务器定义（缩进 2 空格，以 : 结尾）
      if (line.startsWith('  ') && !line.startsWith('    ') && trimmed.endsWith(':')) {
        // 保存之前的服务器
        if (currentServer && currentServer.name && currentServer.command) {
          configs.push({
            name: currentServer.name,
            command: currentServer.command,
            args: currentServer.args || [],
            extensions: currentServer.extensions || [],
            enabled: currentServer.enabled ?? false,
          });
        }
        currentServer = {
          name: trimmed.slice(0, -1),
          extensions: [],
          args: [],
        };
        inExtensions = false;
        inArgs = false;
        continue;
      }

      if (!currentServer) continue;

      // 解析字段（缩进 4 空格）
      if (line.startsWith('    ') && !line.startsWith('      ')) {
        if (trimmed.startsWith('enabled:')) {
          currentServer.enabled = trimmed.includes('true');
          inExtensions = false;
          inArgs = false;
        } else if (trimmed.startsWith('command:')) {
          const value = trimmed.substring('command:'.length).trim().replace(/"/g, '');
          currentServer.command = value;
          inExtensions = false;
          inArgs = false;
        } else if (trimmed === 'extensions:') {
          inExtensions = true;
          inArgs = false;
        } else if (trimmed === 'args:') {
          inArgs = true;
          inExtensions = false;
        } else {
          inExtensions = false;
          inArgs = false;
        }
        continue;
      }

      // 解析列表项（缩进 6 空格，以 - 开头）
      if (line.startsWith('      ') && trimmed.startsWith('-')) {
        const value = trimmed.substring(1).trim().replace(/"/g, '');
        if (inExtensions && currentServer.extensions) {
          currentServer.extensions.push(value);
        } else if (inArgs && currentServer.args) {
          currentServer.args.push(value);
        }
      }
    }

    // 保存最后一个服务器
    if (currentServer && currentServer.name && currentServer.command) {
      configs.push({
        name: currentServer.name,
        command: currentServer.command,
        args: currentServer.args || [],
        extensions: currentServer.extensions || [],
        enabled: currentServer.enabled ?? false,
      });
    }

    return configs.length > 0 ? configs : this.defaultConfigs;
  }

  /**
   * 启动单个 Client
   */
  private async startClient(config: LSPServerConfig): Promise<void> {
    try {
      const client = new LSPClient(config);
      await client.start();
      this.clients.set(config.name, client);
      logger.info(`[LSPClientManager] Started ${config.name}`);
    } catch (error) {
      logger.warn(`[LSPClientManager] Failed to start ${config.name}:`, error);
    }
  }

  /**
   * 处理 LSP 请求（根据文件扩展名自动路由）
   */
  async handleRequest(request: LSPRequest): Promise<LSPResult> {
    const start = Date.now();

    try {
      const ext = path.extname(request.filePath).toLowerCase();
      const clientName = this.extensionMap.get(ext);

      if (!clientName) {
        return {
          success: false,
          error: `No LSP server for extension: ${ext}`,
          durationMs: Date.now() - start,
        };
      }

      const client = this.clients.get(clientName);
      if (!client || !client.isReady()) {
        return {
          success: false,
          error: `LSP server ${clientName} not ready`,
          durationMs: Date.now() - start,
        };
      }

      // 自动打开文件（如果尚未打开）
      const normalizedPath = request.filePath.replace(/\\/g, '/');
      const uri = process.platform === 'win32'
        ? `file:///${normalizedPath}`
        : `file://${normalizedPath}`;

      // 检查文件是否需要打开
      if (!client.isFileOpen(uri)) {
        // 读取文件内容
        try {
          const content = fs.readFileSync(request.filePath, 'utf-8');
          await client.openFile(request.filePath, content);
          logger.debug(`[LSPClientManager] Auto-opened file: ${request.filePath}`);
        } catch (readError) {
          // 文件可能不存在，继续尝试请求（LSP 可能已通过其他方式打开）
          logger.debug(`[LSPClientManager] Could not read file: ${request.filePath}`);
        }
      }

      const position = {
        line: request.line - 1,      // LSP 使用 0-based
        character: request.character - 1,
      };

      let result: any;

      switch (request.operation) {
        case 'definition':
          result = await client.request('textDocument/definition', {
            textDocument: { uri },
            position,
          });
          break;

        case 'references':
          result = await client.request('textDocument/references', {
            textDocument: { uri },
            position,
            context: { includeDeclaration: true },
          });
          break;

        case 'hover':
          result = await client.request('textDocument/hover', {
            textDocument: { uri },
            position,
          });
          break;

        case 'documentSymbol':
          result = await client.request('textDocument/documentSymbol', {
            textDocument: { uri },
          });
          break;

        case 'workspaceSymbol':
          result = await client.request('workspace/symbol', {
            query: '',
          });
          break;

        case 'implementation':
          result = await client.request('textDocument/implementation', {
            textDocument: { uri },
            position,
          });
          break;

        case 'typeDefinition':
          result = await client.request('textDocument/typeDefinition', {
            textDocument: { uri },
            position,
          });
          break;

        default:
          throw new Error(`Unknown operation: ${request.operation}`);
      }

      return {
        success: true,
        data: result,
        durationMs: Date.now() - start,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 启用 LSP Server
   */
  async enableServer(name: string): Promise<void> {
    const config = this.configs.find(c => c.name === name);
    if (!config) {
      throw new Error(`LSP server not found: ${name}`);
    }

    if (this.clients.has(name)) {
      return; // 已经在运行
    }

    await this.startClient(config);

    // 更新扩展名映射
    for (const ext of config.extensions) {
      this.extensionMap.set(ext.toLowerCase(), name);
    }
  }

  /**
   * 禁用 LSP Server
   */
  async disableServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;

    await client.stop();
    this.clients.delete(name);

    // 移除扩展名映射
    const config = this.configs.find(c => c.name === name);
    if (config) {
      for (const ext of config.extensions) {
        this.extensionMap.delete(ext.toLowerCase());
      }
    }

    logger.info(`[LSPClientManager] Disabled ${name}`);
  }

  /**
   * 获取状态
   */
  getStatus(): Array<{ name: string; status: string; extensions: string[] }> {
    return this.configs.map(config => ({
      name: config.name,
      status: this.clients.has(config.name) &&
              this.clients.get(config.name)!.isReady() ? 'running' : 'stopped',
      extensions: config.extensions,
    }));
  }

  /**
   * 获取所有配置
   */
  getConfigs(): LSPServerConfig[] {
    return this.configs;
  }

  /**
   * 打开文件（通知 LSP Server 加载文件内容）
   */
  async openFile(filePath: string, content: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    const clientName = this.extensionMap.get(ext);

    if (!clientName) {
      logger.warn(`[LSPClientManager] No LSP server for extension: ${ext}`);
      return;
    }

    const client = this.clients.get(clientName);
    if (!client || !client.isReady()) {
      logger.warn(`[LSPClientManager] LSP server ${clientName} not ready`);
      return;
    }

    await client.openFile(filePath, content);
    logger.debug(`[LSPClientManager] Opened file: ${filePath}`);
  }

  /**
   * 关闭文件
   */
  async closeFile(filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    const clientName = this.extensionMap.get(ext);

    if (!clientName) return;

    const client = this.clients.get(clientName);
    if (!client) return;

    await client.closeFile(filePath);
    logger.debug(`[LSPClientManager] Closed file: ${filePath}`);
  }

  /**
   * 检查是否初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 关闭所有 LSP Server
   */
  async shutdown(): Promise<void> {
    for (const [name, client] of this.clients) {
      await client.stop();
      logger.info(`[LSPClientManager] Stopped ${name}`);
    }
    this.clients.clear();
    this.extensionMap.clear();
    this.initialized = false;
  }
}

// 单例
let lspClientManager: LSPClientManager | null = null;

/**
 * 获取 LSP Client Manager 单例
 */
export function getLSPClientManager(): LSPClientManager {
  if (!lspClientManager) {
    lspClientManager = new LSPClientManager();
  }
  return lspClientManager;
}