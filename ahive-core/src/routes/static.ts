/**
 * 静态文件服务路由
 * 处理静态文件请求
 */

import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendError, parseUrlPath } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * MIME 类型映射
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * 解析静态文件目录路径
 * 支持多种运行模式：开发模式、编译模式、打包模式
 */
function resolvePublicDir(customDir?: string): string {
  // 1. 如果提供了自定义路径，优先使用
  if (customDir) {
    return customDir;
  }
  
  // 2. 环境变量
  const envPublicDir = process.env.AHIVE_PUBLIC_DIR;
  if (envPublicDir) {
    return envPublicDir;
  }
  
  // 3. 尝试多个可能的路径（按优先级）
  const possiblePaths = [
    // 开发模式: src/routes/ -> ../../public
    path.resolve(__dirname, '../../public'),
    // 编译模式: dist/routes/ -> ../../../public
    path.resolve(__dirname, '../../../public'),
    // 打包模式: 当前工作目录下的 public
    path.resolve(process.cwd(), 'public'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // 4. 默认返回第一个路径（兼容旧行为）
  return path.resolve(__dirname, '../../public');
}

/**
 * 静态文件路由处理器
 */
export class StaticRouteHandler {
  private publicDir: string;
  
  constructor(publicDir?: string) {
    this.publicDir = resolvePublicDir(publicDir);
    //console.log('[StaticRoute] Public directory resolved to:', this.publicDir);
  }
  
  /**
   * 处理静态文件请求
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url || '/';
    const method = req.method || 'GET';
    
    // 只处理 GET 和 HEAD 请求
    if (method !== 'GET' && method !== 'HEAD') {
      return false;
    }
    
    // 解析路径
    const parsedPath = parseUrlPath(url);
    const pathParts = parsedPath.split('/').filter(Boolean);
    
    // 如果请求根路径，尝试返回 index.html
    let filePath = parsedPath === '/' 
      ? path.join(this.publicDir, 'index.html')
      : path.join(this.publicDir, ...pathParts);
    
    // 安全检查：防止目录遍历攻击
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(this.publicDir)) {
      sendError(res, 403, 'Forbidden');
      return true;
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(resolvedPath)) {
      // 如果是目录，尝试返回 index.html
      if (fs.existsSync(path.join(resolvedPath, 'index.html'))) {
        filePath = path.join(resolvedPath, 'index.html');
      } else {
        return false; // 文件不存在，返回 false 让其他路由处理
      }
    }
    
    // 如果是目录，尝试返回 index.html
    if (fs.statSync(resolvedPath).isDirectory()) {
      const indexPath = path.join(resolvedPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        filePath = indexPath;
      } else {
        return false;
      }
    }
    
    // 获取文件扩展名
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    try {
      // 读取文件
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const lastModified = stat.mtime.toUTCString();
      
      // 设置响应头
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Last-Modified', lastModified);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 缓存 1 小时
      
      // 检查 If-Modified-Since 头（缓存验证）
      const ifModifiedSince = req.headers['if-modified-since'];
      if (ifModifiedSince && new Date(ifModifiedSince) >= new Date(lastModified)) {
        res.writeHead(304); // Not Modified
        res.end();
        return true;
      }
      
      // HEAD 请求只返回头信息
      if (method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return true;
      }
      
      // GET 请求返回文件内容
      const fileStream = fs.createReadStream(filePath);
      res.writeHead(200);
      fileStream.pipe(res);
      
      return new Promise((resolve, reject) => {
        fileStream.on('end', () => resolve(true));
        fileStream.on('error', (error) => {
          console.error('[StaticRoute] File stream error:', error);
          sendError(res, 500, 'Internal Server Error');
          resolve(true);
        });
      });
      
    } catch (error) {
      console.error('[StaticRoute] Serve file error:', error);
      sendError(res, 500, 'Internal Server Error');
      return true;
    }
  }
  
  /**
   * 设置 CORS 头
   */
  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

/**
 * 静态文件路由函数
 */
export async function staticRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  publicDir?: string
): Promise<boolean> {
  const handler = new StaticRouteHandler(publicDir);
  return await handler.handle(req, res);
}

/**
 * 创建静态文件路由处理器
 */
export function createStaticHandler(publicDir?: string): StaticRouteHandler {
  return new StaticRouteHandler(publicDir);
}