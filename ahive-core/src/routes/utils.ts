/**
 * 路由工具函数
 */

import type { IncomingMessage, ServerResponse } from 'http';

/**
 * 解析请求体
 */
export async function parseBody<T = any>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (!body) {
          resolve({} as T);
          return;
        }
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error}`));
      }
    });
    
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
export function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.writeHead(statusCode);
  res.end(JSON.stringify(data));
}

/**
 * 发送错误响应
 */
export function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, {
    success: false,
    error: message,
  });
}

/**
 * 获取查询参数
 */
export function getQueryParam(url: string, name: string): string | null {
  try {
    const urlObj = new URL(url, 'http://localhost');
    return urlObj.searchParams.get(name);
  } catch {
    return null;
  }
}

/**
 * 获取所有查询参数
 */
export function getQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  try {
    const urlObj = new URL(url, 'http://localhost');
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
  } catch {
    // ignore
  }
  return params;
}

/**
 * 解析 URL 路径
 */
export function parseUrlPath(url: string): string {
  return url.split('?')[0];
}

/**
 * 解析 URL
 */
export function parseUrl(url: string, host: string = 'localhost'): URL {
  return new URL(url, `http://${host}`);
}

/**
 * 设置 CORS 头
 */
export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

/**
 * 处理 OPTIONS 预检请求
 */
export function handleOptions(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/**
 * 提取路径参数
 * 例如: extractPathParams('/api/agents/:id', '/api/agents/123') => { id: '123' }
 */
export function extractPathParams(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  
  const params: Record<string, string> = {};
  
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = pathPart;
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  
  return params;
}

/**
 * 匹配路由
 */
export function matchRoute(
  method: string,
  path: string,
  routes: Array<{
    method: string;
    pattern: string;
    handler: (params: Record<string, string>, query: Record<string, string>) => any;
  }>
): { handler: Function; params: Record<string, string>; query: Record<string, string> } | null {
  const query: Record<string, string> = {};
  const pathOnly = path.split('?')[0];
  
  // 提取查询参数
  try {
    const urlObj = new URL(path, 'http://localhost');
    urlObj.searchParams.forEach((value, key) => {
      query[key] = value;
    });
  } catch {
    // ignore
  }
  
  for (const route of routes) {
    if (route.method !== method) continue;
    
    const params = extractPathParams(route.pattern, pathOnly);
    if (params) {
      return {
        handler: route.handler,
        params,
        query,
      };
    }
  }
  
  return null;
}