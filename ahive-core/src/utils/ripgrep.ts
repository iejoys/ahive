/**
 * Ripgrep 引擎
 *
 * 直接使用 vendor 目录下的预编译版本
 * 参考 CC-main 的实现方式
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';

// ES Module 下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ripgrep 执行结果
 */
export interface RipgrepResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Glob 搜索结果
 */
export interface GlobResult {
  files: string[];
  truncated: boolean;
}

/**
 * Grep 匹配项
 */
export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

/**
 * Ripgrep 引擎
 */
export class RipgrepEngine {
  private static rgPath: string | null = null;
  private static initialized = false;
  private static logger = new Logger({ module: 'ripgrep' });

  /** 执行超时 (60秒) - 对于大型代码库搜索 */
  private static TIMEOUT_MS = 60000;

  /** 输出缓冲区大小 (20MB) */
  private static MAX_BUFFER = 20 * 1024 * 1024;

  /**
   * 初始化：加载 vendor 目录下的 ripgrep
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    const vendorRg = this.findVendorRg();
    if (vendorRg) {
      this.rgPath = vendorRg;
      this.logger.info(`[Ripgrep] 加载成功: ${vendorRg}`);
    } else {
      this.logger.warn('[Ripgrep] 未找到 ripgrep，将使用 fs 回退实现');
    }

    this.initialized = true;
  }

  /**
   * 查找 vendor 目录下的 ripgrep
   * 目录结构: vendor/ripgrep/{arch}-{platform}/rg
   *
   * 例如: x64-win32/rg.exe, x64-linux/rg, arm64-darwin/rg
   */
  private static findVendorRg(): string | null {
    const platform = process.platform;
    const arch = process.arch;

    // 与 CC 保持一致的命名
    const platformName = platform === 'win32' ? 'win32' : platform;
    const dirName = `${arch}-${platformName}`;
    const exeName = platform === 'win32' ? 'rg.exe' : 'rg';

    // 尝试多个可能的位置
    const possiblePaths = [
      // 项目根目录下的 vendor (开发模式)
      path.join(process.cwd(), 'vendor', 'ripgrep', dirName, exeName),
      // src 目录的相对路径 (编译后运行)
      path.join(__dirname, '..', '..', 'vendor', 'ripgrep', dirName, exeName),
      // Electron 打包后的路径 (extraResources 放在 resources 目录)
      path.join(path.dirname(process.execPath), 'resources', 'vendor', 'ripgrep', dirName, exeName),
      // 打包后的备用路径 (直接在安装目录下)
      path.join(path.dirname(process.execPath), 'vendor', 'ripgrep', dirName, exeName),
    ];

    for (const vendorPath of possiblePaths) {
      if (fs.existsSync(vendorPath)) {
        return vendorPath;
      }
    }

    return null;
  }

  /**
   * 获取 ripgrep 路径（用于诊断）
   */
  static getRgPath(): string | null {
    return this.rgPath;
  }

  /**
   * 检查 ripgrep 是否可用
   */
  static isAvailable(): boolean {
    return this.rgPath !== null;
  }

  /**
   * 执行 ripgrep 命令
   */
  static async execute(
    args: string[],
    options?: {
      cwd?: string;
      timeout?: number;
      signal?: AbortSignal;
    }
  ): Promise<RipgrepResult> {
    await this.initialize();

    if (!this.rgPath) {
      return {
        stdout: '',
        stderr: 'ripgrep not available',
        exitCode: -1,
        durationMs: 0,
      };
    }

    return this.runCommand(
      this.rgPath,
      args,
      options?.timeout ?? this.TIMEOUT_MS,
      options?.cwd,
      options?.signal
    );
  }

  /**
   * 执行命令（核心实现）
   * 参考 CC 使用 execFile 而不是 spawn
   */
  private static runCommand(
    cmd: string,
    args: string[],
    timeout: number,
    cwd?: string,
    signal?: AbortSignal
  ): Promise<RipgrepResult> {
    return new Promise((resolve) => {
      const start = Date.now();

      // 验证 cwd 是否存在，不存在则回退到 process.cwd()
      // Windows 上 execFile 的 cwd 指向不存在的目录时会报 ENOENT，
      // 但错误消息指向可执行文件路径而非 cwd，容易误导诊断
      let effectiveCwd = cwd ?? process.cwd();
      if (!fs.existsSync(effectiveCwd)) {
        this.logger.warn(`[runCommand] cwd 不存在: ${effectiveCwd}，回退到 process.cwd(): ${process.cwd()}`);
        effectiveCwd = process.cwd();
      }

      const options = {
        cwd: effectiveCwd,
        maxBuffer: this.MAX_BUFFER,
        timeout,
        signal,
        windowsHide: true,
      };

      execFile(cmd, args, options, (error, stdout, stderr) => {
        const durationMs = Date.now() - start;

        if (error) {
          // exit code 1 表示无匹配，不是真正的错误
          if (error.code === 1) {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: 1,
              durationMs,
            });
          } else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            // 缓冲区溢出 - 返回部分结果（exitCode 0 表示有结果）
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: 0,  // 视为成功，因为有部分结果
              durationMs,
            });
          } else if (error.code === 'ENOENT') {
            // ENOENT: 可执行文件找不到或 cwd 无效
            // 尝试以 process.cwd() 重试一次（可能是 cwd 瞬态失效）
            this.logger.warn(`[runCommand] ENOENT 错误，尝试以 process.cwd() 重试: cmd=${cmd}`);
            const retryOptions = {
              cwd: process.cwd(),
              maxBuffer: this.MAX_BUFFER,
              timeout,
              signal,
              windowsHide: true,
            };
            execFile(cmd, args, retryOptions, (retryError, retryStdout, retryStderr) => {
              const retryDurationMs = Date.now() - start;
              if (retryError) {
                this.logger.error(`[runCommand] 重试仍失败: code=${retryError.code}, message=${retryError.message}`);
                resolve({
                  stdout: retryStdout ?? '',
                  stderr: retryStderr ?? '',
                  exitCode: typeof retryError.code === 'number' ? retryError.code : -1,
                  durationMs: retryDurationMs,
                });
              } else {
                this.logger.info(`[runCommand] 重试成功`);
                resolve({
                  stdout: retryStdout ?? '',
                  stderr: retryStderr ?? '',
                  exitCode: 0,
                  durationMs: retryDurationMs,
                });
              }
            });
          } else {
            this.logger.error(`[runCommand] error: code=${error.code}, message=${error.message}`);
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exitCode: typeof error.code === 'number' ? error.code : -1,
              durationMs,
            });
          }
        } else {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: 0,
            durationMs,
          });
        }
      });
    });
  }

  /**
   * Glob 模式文件搜索
   * 使用 rg --files --glob <pattern>
   */
  static async glob(
    pattern: string,
    cwd?: string,
    options?: {
      limit?: number;
      signal?: AbortSignal;
    }
  ): Promise<GlobResult> {
    const args = [
      '--files',
      '--glob', pattern,
      '--hidden',               // 包含隐藏文件
      '--sort-files',           // 按文件名排序
      '--glob', '!nul',         // Windows 特殊文件名排除
    ];

    // 目标路径（必需）
    args.push(cwd ?? '.');

    const result = await this.execute(args, { cwd, signal: options?.signal });

    // exitCode 1 表示无匹配，不是错误
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`ripgrep error: ${result.stderr}`);
    }

    const limit = options?.limit ?? 100;
    const allLines = result.stdout.split('\n').filter(f => f.trim());
    const files = allLines.slice(0, limit);
    const truncated = allLines.length > limit;

    return { files, truncated };
  }

  /**
   * Grep 内容搜索
   * 使用 rg <pattern>
   */
  static async grep(
    pattern: string,
    cwd?: string,
    options?: {
      glob?: string;           // 文件过滤模式
      ignoreCase?: boolean;    // 忽略大小写
      multiline?: boolean;     // 多行模式
      context?: number;        // 上下文行数
      maxResults?: number;     // 最大结果数
      signal?: AbortSignal;
    }
  ): Promise<GrepMatch[]> {
    // 规范化路径：确保路径格式正确
    const normalizedPath = cwd ? path.resolve(cwd) : '.';

    const args: string[] = [
      '--line-number',         // 显示行号
      '--color=never',         // 禁用颜色
      '--no-heading',          // 禁用文件头
      '--glob', '!nul',        // Windows 特殊文件名排除
    ];

    if (options?.ignoreCase) args.push('-i');
    if (options?.multiline) args.push('-U');
    if (options?.glob) args.push('--glob', options.glob);
    if (options?.context) args.push('-C', String(options.context));

    args.push('-m', String(options?.maxResults ?? 100));
    args.push(pattern);
    // 目标路径（必需，否则 rg 会挂起）
    args.push(normalizedPath);

    this.logger.debug(`[Grep] 执行命令: rg ${args.join(' ')}`);

    const result = await this.execute(args, { cwd: normalizedPath, signal: options?.signal });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      this.logger.error(`[Grep] ripgrep 错误: exitCode=${result.exitCode}, stderr=${result.stderr}`);
      throw new Error(`ripgrep error: ${result.stderr}`);
    }

    // 解析输出格式: filename:line:content
    // 注意: Windows 路径包含冒号 (如 F:\...)，需要特殊处理
    const matches: GrepMatch[] = [];
    const maxResults = options?.maxResults ?? 100;

    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue;

      // 修复: 从右向左解析，先找最后一个冒号分隔的行号
      // 格式: path:line:content
      // Windows 路径如 F:\path\file.ts:60:content
      // 从右边找，第一个冒号后面是 content，第二个冒号后面是行号，剩下的都是文件路径
      const lastColonIndex = line.lastIndexOf(':');
      if (lastColonIndex === -1) continue;

      const content = line.slice(lastColonIndex + 1);

      // 在剩余部分找行号
      const remaining = line.slice(0, lastColonIndex);
      const secondLastColonIndex = remaining.lastIndexOf(':');
      if (secondLastColonIndex === -1) continue;

      const lineNumStr = remaining.slice(secondLastColonIndex + 1);
      const lineNum = parseInt(lineNumStr, 10);
      if (isNaN(lineNum)) continue;

      const filePath = remaining.slice(0, secondLastColonIndex);

      matches.push({
        file: filePath,
        line: lineNum,
        content,
      });
      // 达到最大结果数就停止
      if (matches.length >= maxResults) break;
    }

    this.logger.debug(`[Grep] 找到 ${matches.length} 个匹配`);
    return matches;
  }

  /**
   * 统计匹配数量
   * 使用 rg --count
   */
  static async count(
    pattern: string,
    cwd?: string,
    options?: {
      glob?: string;
      ignoreCase?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<Map<string, number>> {
    const args: string[] = [
      '--count',
      '--color=never',
      '--no-heading',
    ];

    if (options?.ignoreCase) args.push('-i');
    if (options?.glob) args.push(`--glob=${options.glob}`);
    args.push(pattern);

    const result = await this.execute(args, { cwd, signal: options?.signal });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`ripgrep error: ${result.stderr}`);
    }

    // 解析输出格式: filename:count
    const counts = new Map<string, number>();

    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue;

      const match = line.match(/^([^:]+):(\d+)$/);
      if (match) {
        counts.set(match[1], parseInt(match[2], 10));
      }
    }

    return counts;
  }
}