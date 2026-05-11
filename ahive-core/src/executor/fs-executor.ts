/**
 * AHIVECORE 执行器 - 文件系统操作
 * 
 * 功能：
 * - 读写文件
 * - 目录操作
 * - 路径安全检查
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { FileResult, ListResult, SecurityPolicy } from './types.js';
import { DEFAULT_SECURITY_POLICY } from './types.js';

/**
 * 文件系统执行器
 */
export class FileSystemExecutor {
  private policy: SecurityPolicy;
  private workspaceRoot: string;

  constructor(
    workspaceRoot: string = process.cwd(),
    policy: SecurityPolicy = DEFAULT_SECURITY_POLICY
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.policy = policy;
  }

  /**
   * 读取文件
   */
  async readFile(
    filePath: string,
    encoding: BufferEncoding = 'utf-8',
    signal?: AbortSignal
  ): Promise<FileResult> {
    const resolvedPath = this.resolvePath(filePath);

    // 安全检查
    const check = this.checkPathSafety(resolvedPath, 'read');
    if (!check.allowed) {
      return { success: false, path: resolvedPath };
    }

    try {
      const content = await fs.readFile(resolvedPath, encoding);
      const stats = await fs.stat(resolvedPath);

      // 检查文件大小
      if (this.policy.maxFileSize && stats.size > this.policy.maxFileSize) {
        return {
          success: false,
          path: resolvedPath,
          content: `File too large: ${stats.size} bytes (max: ${this.policy.maxFileSize})`,
        };
      }

      return {
        success: true,
        path: resolvedPath,
        content: content.toString(),
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch (error) {
      return {
        success: false,
        path: resolvedPath,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 写入文件
   */
  async writeFile(
    filePath: string,
    content: string,
    options: {
      encoding?: BufferEncoding;
      mkdir?: boolean;
    } = {},
    signal?: AbortSignal
  ): Promise<FileResult> {
    const { encoding = 'utf-8', mkdir = true } = options;
    const resolvedPath = this.resolvePath(filePath);

    // 安全检查
    const check = this.checkPathSafety(resolvedPath, 'write');
    if (!check.allowed) {
      return { success: false, path: resolvedPath };
    }

    try {
      // 创建目录
      if (mkdir) {
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(resolvedPath, content, encoding);
      const stats = await fs.stat(resolvedPath);

      return {
        success: true,
        path: resolvedPath,
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch (error) {
      return {
        success: false,
        path: resolvedPath,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 列出目录内容
   */
  async listDir(
    dirPath: string,
    recursive: boolean = false,
    signal?: AbortSignal
  ): Promise<ListResult> {
    const resolvedPath = this.resolvePath(dirPath);

    // 安全检查
    const check = this.checkPathSafety(resolvedPath, 'read');
    if (!check.allowed) {
      return { success: false, path: resolvedPath, entries: [] };
    }

    try {
      const entries = await this.readDirectory(resolvedPath, recursive);
      return {
        success: true,
        path: resolvedPath,
        entries,
      };
    } catch (error) {
      return {
        success: false,
        path: resolvedPath,
        entries: [],
      };
    }
  }

  /**
   * 删除文件/目录
   */
  async delete(
    targetPath: string,
    recursive: boolean = false,
    signal?: AbortSignal
  ): Promise<FileResult> {
    const resolvedPath = this.resolvePath(targetPath);

    // 安全检查
    const check = this.checkPathSafety(resolvedPath, 'delete');
    if (!check.allowed) {
      return { success: false, path: resolvedPath };
    }

    // 额外检查：不允许删除工作区根目录
    if (resolvedPath === this.workspaceRoot) {
      return {
        success: false,
        path: resolvedPath,
        content: 'Cannot delete workspace root',
      };
    }

    try {
      const stats = await fs.stat(resolvedPath);

      if (stats.isDirectory()) {
        await fs.rm(resolvedPath, { recursive, force: true });
      } else {
        await fs.unlink(resolvedPath);
      }

      return { success: true, path: resolvedPath };
    } catch (error) {
      return {
        success: false,
        path: resolvedPath,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 创建目录
   */
  async mkdir(dirPath: string, signal?: AbortSignal): Promise<FileResult> {
    const resolvedPath = this.resolvePath(dirPath);

    // 安全检查
    const check = this.checkPathSafety(resolvedPath, 'write');
    if (!check.allowed) {
      return { success: false, path: resolvedPath };
    }

    try {
      await fs.mkdir(resolvedPath, { recursive: true });
      return { success: true, path: resolvedPath };
    } catch (error) {
      return {
        success: false,
        path: resolvedPath,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取文件信息
   */
  async stat(filePath: string): Promise<FileResult> {
    const resolvedPath = this.resolvePath(filePath);

    try {
      const stats = await fs.stat(resolvedPath);
      return {
        success: true,
        path: resolvedPath,
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch (error) {
      return {
        success: false,
        path: resolvedPath,
      };
    }
  }

  /**
   * 检查文件是否存在
   */
  async exists(filePath: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(filePath);
    try {
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  // ============ 私有方法 ============

  /**
   * 解析路径 (相对路径转绝对路径)
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }
    return path.resolve(this.workspaceRoot, filePath);
  }

  /**
   * 路径安全检查
   */
  private checkPathSafety(
    resolvedPath: string,
    action: 'read' | 'write' | 'delete'
  ): { allowed: boolean; reason?: string } {
    // 检查是否在工作区内 (可选的安全措施)
    // const inWorkspace = resolvedPath.startsWith(this.workspaceRoot);
    // if (!inWorkspace && action !== 'read') {
    //   return { allowed: false, reason: 'Path outside workspace' };
    // }

    // 检查禁止的路径
    if (this.policy.blockedPaths) {
      for (const blocked of this.policy.blockedPaths) {
        if (resolvedPath.startsWith(blocked)) {
          return { allowed: false, reason: `Blocked path: ${blocked}` };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * 读取目录内容
   */
  private async readDirectory(
    dirPath: string,
    recursive: boolean
  ): Promise<ListResult['entries']> {
    const entries: ListResult['entries'] = [];
    const items = await fs.readdir(dirPath, { withFileTypes: true });

    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      const stats = await fs.stat(itemPath);

      entries.push({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        mtime: stats.mtime,
      });

      // 递归读取子目录
      if (recursive && item.isDirectory()) {
        const subEntries = await this.readDirectory(itemPath, true);
        entries.push(...subEntries);
      }
    }

    return entries;
  }
}

/**
 * 创建文件系统执行器
 */
export function createFileSystemExecutor(
  workspaceRoot?: string,
  policy?: SecurityPolicy
): FileSystemExecutor {
  return new FileSystemExecutor(workspaceRoot, policy);
}