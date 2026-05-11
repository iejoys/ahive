/**
 * AHIVECORE 执行器 - 网络请求
 * 
 * 功能：
 * - HTTP 请求
 * - 域名安全检查
 * - 超时控制
 */

import type { HttpResult, SecurityPolicy } from './types.js';
import { DEFAULT_SECURITY_POLICY } from './types.js';

/**
 * 网络请求执行器
 */
export class HttpExecutor {
  private policy: SecurityPolicy;

  constructor(policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) {
    this.policy = policy;
  }

  /**
   * 发送 HTTP 请求
   */
  async request(
    url: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    } = {}
  ): Promise<HttpResult> {
    const { method = 'GET', headers = {}, body, timeout = 30000 } = options;

    // 解析 URL 检查域名
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        success: false,
        status: 0,
        headers: {},
        body: `Invalid URL: ${url}`,
      };
    }

    // 域名安全检查
    if (this.policy.allowedDomains && this.policy.allowedDomains.length > 0) {
      const allowed = this.policy.allowedDomains.some(domain => 
        parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain)
      );
      if (!allowed) {
        return {
          success: false,
          status: 0,
          headers: {},
          body: `Domain not allowed: ${parsedUrl.hostname}`,
        };
      }
    }

    // 阻止私有网络访问 (SSRF 防护)
    if (this.isPrivateNetwork(parsedUrl.hostname)) {
      return {
        success: false,
        status: 0,
        headers: {},
        body: `Private network access blocked: ${parsedUrl.hostname}`,
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': 'AHIVECORE/0.1.0',
          ...headers,
        },
        body: method !== 'GET' ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const responseBody = await response.text();

      return {
        success: response.ok,
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      };
    } catch (error) {
      return {
        success: false,
        status: 0,
        headers: {},
        body: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * GET 请求
   */
  async get(url: string, headers?: Record<string, string>): Promise<HttpResult> {
    return this.request(url, { method: 'GET', headers });
  }

  /**
   * POST 请求
   */
  async post(
    url: string,
    body: string | Record<string, any>,
    headers?: Record<string, string>
  ): Promise<HttpResult> {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    return this.request(url, {
      method: 'POST',
      body: bodyStr,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  }

  /**
   * 检查是否为私有网络
   */
  private isPrivateNetwork(hostname: string): boolean {
    // localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // 私有 IP 段
    const privatePatterns = [
      /^10\./,                    // 10.0.0.0/8
      /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
      /^192\.168\./,              // 192.168.0.0/16
      /^169\.254\./,              // Link-local
      /^0\.0\.0\.0$/,             // Any address
    ];

    return privatePatterns.some(pattern => pattern.test(hostname));
  }
}

/**
 * 创建 HTTP 执行器
 */
export function createHttpExecutor(policy?: SecurityPolicy): HttpExecutor {
  return new HttpExecutor(policy);
}