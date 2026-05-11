/**
 * LSP Client - 管理单个 LSP Server 连接
 *
 * 通过 stdio 与 LSP Server 通信
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../utils/index.js';
import type { LSPServerConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * LSP 协议请求
 */
interface LSPProtocolRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

/**
 * LSP 协议响应
 */
interface LSPProtocolResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * LSP 协议通知
 */
interface LSPProtocolNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

/**
 * LSP Client
 *
 * 管理与单个 LSP Server 的通信
 */
export class LSPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private buffer = Buffer.alloc(0); // 使用 Buffer 存储字节数据
  private initialized = false;
  private starting = false;
  private openFiles = new Set<string>(); // 跟踪已打开的文件 URI

  constructor(private config: LSPServerConfig) {}

  /**
   * 启动 LSP Server
   */
  async start(): Promise<void> {
    if (this.process || this.starting) {
      return;
    }

    this.starting = true;

    return new Promise((resolve, reject) => {
      try {
        const isWindows = process.platform === 'win32';
        let command = this.config.command;
        let useShell = false;

        // Windows 下尝试找到命令的完整路径，避免使用 shell
        if (isWindows) {
          // 对于全局安装的 npm 包，使用 npx 来运行
          // 这避免了 shell 带来的缓冲问题
          useShell = true;  // Windows 上仍然需要 shell 来找到命令
        }

        logger.info(`[LSPClient ${this.config.name}] Starting: ${command} ${(this.config.args || []).join(' ')}`);

        this.process = spawn(command, this.config.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: useShell,
          windowsHide: true,  // 隐藏 Windows 子进程窗口
        });

        // 设置流编码
        this.process.stdin?.setDefaultEncoding?.('utf-8');
        // stdout 不要设置编码，保持 Buffer 格式以正确处理 Content-Length
        this.process.stderr?.setEncoding?.('utf-8');

        // 设置 stdin 为非缓冲模式
        const stdin = this.process.stdin;
        if (stdin) {
          stdin.on('error', (err) => {
            logger.error(`[LSPClient ${this.config.name}] stdin error:`, err);
          });
        }

        this.process.on('error', (error) => {
          logger.error(`[LSPClient ${this.config.name}] Process error:`, error);
          this.starting = false;
          reject(error);
        });

        this.process.on('exit', (code, signal) => {
          logger.info(`[LSPClient ${this.config.name}] Process exited: code=${code}, signal=${signal}`);
          this.process = null;
          this.initialized = false;
          this.starting = false;
          // 拒绝所有待处理的请求
          for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('LSP Server exited'));
          }
          this.pendingRequests.clear();
        });

        this.process.stderr?.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) {
            logger.info(`[LSPClient ${this.config.name}] stderr: ${msg}`);
          }
        });

        this.process.stdout?.on('data', (data) => {
          this.handleResponse(data);
        });

        // 等待进程启动后初始化
        setTimeout(async () => {
          try {
            await this.initialize();
            this.initialized = true;
            this.starting = false;
            logger.info(`[LSPClient ${this.config.name}] Initialized successfully`);
            resolve();
          } catch (error) {
            this.starting = false;
            reject(error);
          }
        }, 500);

      } catch (error) {
        this.starting = false;
        reject(error);
      }
    });
  }

  /**
   * 停止 LSP Server
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    // 发送 shutdown 请求
    try {
      await this.request('shutdown', {}, 5000);
    } catch {
      // 忽略错误
    }

    // 发送 exit 通知
    this.sendNotification('exit', {});

    // 强制终止
    this.process.stdin?.end();
    this.process.kill('SIGTERM');

    // 等待进程退出
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill('SIGKILL');
        resolve();
      }, 3000);

      this.process?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.process = null;
    this.initialized = false;
    this.pendingRequests.clear();
    logger.info(`[LSPClient ${this.config.name}] Stopped`);
  }

  /**
   * 发送 LSP 请求
   */
  async request(method: string, params: any, timeoutMs: number = 30000): Promise<any> {
    if (!this.initialized && method !== 'initialize') {
      throw new Error(`LSP ${this.config.name} not initialized`);
    }

    if (!this.process) {
      throw new Error(`LSP ${this.config.name} process not running`);
    }

    const id = ++this.requestId;
    const request: LSPProtocolRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    // LSP 协议要求 Content-Length 头（使用 UTF-8 字节长度）
    const content = JSON.stringify(request);
    const byteLength = Buffer.byteLength(content, 'utf8');
    const header = `Content-Length: ${byteLength}\r\n\r\n`;

    // 创建 Promise 来等待响应
    const responsePromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
    });

    // 写入请求（分开写入 header 和 content，确保正确的字节计算）
    const stdin = this.process.stdin;
    if (stdin) {
      stdin.cork();
      stdin.write(header);
      stdin.write(content);
      stdin.uncork();
    }
    logger.debug(`[LSPClient ${this.config.name}] Sent request: ${method} (id=${id}, bytes=${byteLength})`);

    return responsePromise;
  }

  /**
   * 发送 LSP 通知
   */
  sendNotification(method: string, params: any): void {
    if (!this.process) {
      return;
    }

    const notification: LSPProtocolNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    // LSP 协议要求 Content-Length 头（使用 UTF-8 字节长度）
    const content = JSON.stringify(notification);
    const byteLength = Buffer.byteLength(content, 'utf8');
    const header = `Content-Length: ${byteLength}\r\n\r\n`;

    // 写入通知（分开写入 header 和 content）
    const stdin = this.process.stdin;
    if (stdin) {
      stdin.cork();
      stdin.write(header);
      stdin.write(content);
      stdin.uncork();
    }
    logger.debug(`[LSPClient ${this.config.name}] Sent notification: ${method} (bytes=${byteLength})`);
  }

  /**
   * 打开文件
   */
  async openFile(filePath: string, content: string): Promise<void> {
    // Windows 需要 file:///C:/... 格式，且路径使用正斜杠
    const normalizedPath = filePath.replace(/\\/g, '/');
    const uri = process.platform === 'win32'
      ? `file:///${normalizedPath}`
      : `file://${normalizedPath}`;

    this.openFiles.add(uri); // 跟踪已打开的文件

    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: this.getLanguageId(filePath),
        version: 1,
        text: content,
      },
    });
  }

  /**
   * 关闭文件
   */
  async closeFile(filePath: string): Promise<void> {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const uri = process.platform === 'win32'
      ? `file:///${normalizedPath}`
      : `file://${normalizedPath}`;

    this.openFiles.delete(uri); // 从跟踪列表移除

    this.sendNotification('textDocument/didClose', {
      textDocument: {
        uri,
      },
    });
  }

  /**
   * 检查文件是否已打开
   */
  isFileOpen(uri: string): boolean {
    return this.openFiles.has(uri);
  }

  /**
   * 检查是否就绪
   */
  isReady(): boolean {
    return this.initialized && this.process !== null && !this.process.killed;
  }

  /**
   * 获取配置
   */
  getConfig(): LSPServerConfig {
    return this.config;
  }

  // ===== 私有方法 =====

  /**
   * 初始化 LSP 协议
   */
  private async initialize(): Promise<void> {
    // 获取工作区根目录
    const cwd = process.cwd();
    // 将 Windows 反斜杠转换为正斜杠
    const normalizedCwd = cwd.replace(/\\/g, '/');
    const rootUri = process.platform === 'win32'
      ? `file:///${normalizedCwd}`
      : `file://${normalizedCwd}`;

    logger.debug(`[LSPClient ${this.config.name}] Initializing with rootUri: ${rootUri}`);

    // 基础 capabilities
    const capabilities = {
      textDocument: {
        definition: { dynamicRegistration: false, linkSupport: true },
        references: { dynamicRegistration: false },
        hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] as const },
        documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
        typeDefinition: { dynamicRegistration: false, linkSupport: true },
        implementation: { dynamicRegistration: false, linkSupport: true },
      },
      workspace: {
        symbol: { dynamicRegistration: false },
        workspaceFolders: true,
      },
    };

    // 根据服务器类型设置初始化选项
    let initializationOptions: any = {};
    if (this.config.name === 'typescript' || this.config.name === 'vtsls') {
      // TypeScript 特定选项
      const localTspath = path.join(cwd, 'node_modules', 'typescript', 'lib', 'tsserver.js');
      const typescriptServerPath = fs.existsSync(localTspath) ? localTspath : undefined;
      initializationOptions = {
        preferences: {
          disableAutomaticTypingAcquisition: true,
          includePackageJsonAutoImports: 'off' as const,
        },
        maxTsServerMemory: 4096,
        typescriptServerPath,
      };
    }

    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{
        uri: rootUri,
        name: path.basename(cwd),
      }],
      capabilities,
      initializationOptions,
    }, 30000);  // 30 秒超时

    logger.debug(`[LSPClient ${this.config.name}] Initialized with capabilities: ${JSON.stringify(result.capabilities).substring(0, 100)}...`);

    // 发送 initialized 通知
    this.sendNotification('initialized', {});

    // 等待一小段时间让服务器处理
    await new Promise(r => setTimeout(r, 100));
  }

  /**
   * 处理 LSP 响应
   * LSP 协议使用 Content-Length 头格式
   * 重要：Content-Length 是 UTF-8 字节长度，不是字符数
   */
  private handleResponse(data: Buffer): void {
    // 合并新数据到 buffer
    this.buffer = Buffer.concat([this.buffer, data]);

    while (true) {
      // 查找 Content-Length 头（在 Buffer 中查找 \r\n\r\n）
      const headerEndMarker = Buffer.from('\r\n\r\n');
      const headerEndIndex = this.buffer.indexOf(headerEndMarker);

      if (headerEndIndex === -1) {
        break; // 没有完整的消息头
      }

      const header = this.buffer.subarray(0, headerEndIndex).toString('utf-8');
      const contentStart = headerEndIndex + 4; // 字节偏移

      // 解析 Content-Length
      const lengthMatch = header.match(/Content-Length: (\d+)/i);
      if (!lengthMatch) {
        // 可能是其他输出（日志等），跳过这个消息
        this.buffer = this.buffer.subarray(contentStart);
        continue;
      }

      const contentLength = parseInt(lengthMatch[1], 10); // 字节长度

      // 检查是否有完整的内容（使用字节偏移）
      if (this.buffer.length < contentStart + contentLength) {
        break; // 内容字节不完整，等待更多数据
      }

      // 提取内容（使用字节偏移）
      const contentBuffer = this.buffer.subarray(contentStart, contentStart + contentLength);
      const content = contentBuffer.toString('utf-8');

      // 移除已处理的消息
      this.buffer = this.buffer.subarray(contentStart + contentLength);

      try {
        const parsed = JSON.parse(content);

        // 判断是 Response（有 id）还是 Notification（无 id）
        if ('id' in parsed && parsed.id !== undefined) {
          const response = parsed as LSPProtocolResponse;
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            clearTimeout(pending.timeout);

            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          } else {
            logger.warn(`[LSPClient ${this.config.name}] No pending request for id=${response.id}`);
          }
        } else {
          // 这是一个通知
          const notification = parsed as LSPProtocolNotification;
          logger.debug(`[LSPClient ${this.config.name}] Notification: ${notification.method}`);
        }
      } catch (e) {
        logger.error(`[LSPClient ${this.config.name}] Parse error: ${content.substring(0, 100)}`);
      }
    }
  }

  /**
   * 获取语言 ID
   */
  private getLanguageId(filePath: string): string {
    const ext = path.extname(filePath);
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.pyi': 'python',
      '.go': 'go',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.rs': 'rust',
      '.java': 'java',
      '.kt': 'kotlin',
      '.swift': 'swift',
      '.gd': 'gdscript',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
      '.lua': 'lua',
    };
    return map[ext] || 'plaintext';
  }
}