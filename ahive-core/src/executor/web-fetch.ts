/**
 * AHIVECORE Web Fetch Tool
 * 
 * 从 OpenClaw 移植的网页抓取工具
 * 功能：
 * - 获取网页内容
 * - HTML → Markdown/Text 转换
 * - 正文提取（Readability）
 * - 缓存支持
 */

import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import {
  extractReadableContent,
  htmlToMarkdown,
  markdownToText,
  truncateText,
  type ExtractMode,
} from './web-fetch-utils.js';

// ============ 常量 ============

const DEFAULT_TIMEOUT = 30000; // 30秒
const DEFAULT_MAX_CHARS = 50000; // 5万字符
const DEFAULT_MAX_BYTES = 2_000_000; // 2MB
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ============ 全局配置 ============

/** 是否允许访问私有网络（局域网） */
let allowPrivateNetwork = false;

/**
 * 设置是否允许访问私有网络
 */
export function setAllowPrivateNetwork(allow: boolean): void {
  allowPrivateNetwork = allow;
}

/**
 * 获取当前私有网络访问设置
 */
export function getAllowPrivateNetwork(): boolean {
  return allowPrivateNetwork;
}

// ============ 缓存 ============

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const FETCH_CACHE = new Map<string, CacheEntry<WebFetchResult>>();
const DEFAULT_CACHE_TTL = 30 * 60 * 1000; // 30分钟

// ============ 类型 ============

export interface WebFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  extractMode: ExtractMode;
  truncated: boolean;
  length: number;
  text: string;
  fetchedAt: string;
  tookMs: number;
  cached?: boolean;
}

// ============ Schema ============

export const WebFetchParamsSchema = z.object({
  url: z.string().describe('要抓取的网页 URL'),
  extractMode: z
    .enum(['markdown', 'text'])
    .optional()
    .default('markdown')
    .describe('提取模式：markdown 或 text'),
  maxChars: z
    .number()
    .min(100)
    .max(100000)
    .optional()
    .describe('最大返回字符数'),
});

// ============ 工具实现 ============

/**
 * 检查是否为私有网络（SSRF 防护）
 * 
 * 注意：允许本地回环地址（localhost/127.0.0.1/::1）
 * 仅阻止外部私有网络（10.x, 172.16-31.x, 192.168.x 等）
 */
function isPrivateNetwork(hostname: string): boolean {
  // 允许本地回环地址（本地开发场景）
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return false;  // 不阻止
  }

  // 阻止外部私有网络
  const privatePatterns = [
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\.0\.0\.0$/,
  ];

  return privatePatterns.some((pattern) => pattern.test(hostname));
}

/**
 * 执行网页抓取
 */
async function doWebFetch(params: {
  url: string;
  extractMode: ExtractMode;
  maxChars: number;
  timeout: number;
}): Promise<WebFetchResult> {
  const { url, extractMode, maxChars, timeout } = params;
  const startTime = Date.now();

  // 解析 URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`无效的 URL: ${url}`);
  }

  // 协议检查
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('URL 必须是 http 或 https 协议');
  }

  // SSRF 防护（可配置允许私有网络）
  if (!allowPrivateNetwork && isPrivateNetwork(parsedUrl.hostname)) {
    throw new Error(`禁止访问私有网络: ${parsedUrl.hostname}。如需访问局域网，请启用 allowPrivateNetwork 配置`);
  }

  // 发起请求
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/markdown,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw error;
  }

  clearTimeout(timeoutId);

  // 检查响应
  if (!response.ok) {
    throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`);
  }

  // 读取内容
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const finalUrl = response.url;

  // 检查内容大小
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > DEFAULT_MAX_BYTES) {
    throw new Error(`响应过大 (${(contentLength / 1024 / 1024).toFixed(2)}MB)，超过限制`);
  }

  // 读取文本
  let text = await response.text();

  // 根据内容类型处理
  let title: string | undefined;
  let extractor = 'raw';

  if (contentType.includes('text/markdown')) {
    // 已经是 Markdown
    extractor = 'markdown';
    if (extractMode === 'text') {
      text = markdownToText(text);
    }
  } else if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    // HTML，提取正文
    try {
      const readable = await extractReadableContent({
        html: text,
        url: finalUrl,
        extractMode,
      });

      if (readable?.text) {
        text = readable.text;
        title = readable.title;
        extractor = 'readability';
      } else {
        // Readability 失败，使用简单转换
        const mdResult = htmlToMarkdown(text);
        text = extractMode === 'text' ? markdownToText(mdResult.text) : mdResult.text;
        title = mdResult.title;
        extractor = 'simple';
      }
    } catch (error) {
      // 提取失败，使用简单转换
      const mdResult = htmlToMarkdown(text);
      text = extractMode === 'text' ? markdownToText(mdResult.text) : mdResult.text;
      title = mdResult.title;
      extractor = 'simple';
    }
  } else if (contentType.includes('application/json')) {
    // JSON
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
      extractor = 'json';
    } catch {
      // 保持原样
    }
  } else if (contentType.includes('text/')) {
    // 纯文本
    extractor = 'text';
  } else {
    // 其他类型
    throw new Error(`不支持的 Content-Type: ${contentType}`);
  }

  // 截断
  const truncated = truncateText(text, maxChars);
  if (truncated.truncated) {
    text = truncated.text;
  }

  const tookMs = Date.now() - startTime;

  return {
    url,
    finalUrl,
    status: response.status,
    contentType: contentType.split(';')[0].trim(),
    title,
    extractMode,
    truncated: truncated.truncated,
    length: text.length,
    text,
    fetchedAt: new Date().toISOString(),
    tookMs,
  };
}

/**
 * Web Fetch 工具定义
 */
export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  description: '抓取网页内容并提取正文。可以获取网页的文本或Markdown格式内容。',
  parameters: WebFetchParamsSchema,

  async execute(params: z.infer<typeof WebFetchParamsSchema>) {
    const {
      url,
      extractMode = 'markdown',
      maxChars = DEFAULT_MAX_CHARS,
    } = params;

    // 检查缓存
    const cacheKey = `${url}:${extractMode}:${maxChars}`;
    const cached = FETCH_CACHE.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cached: true };
    }

    // 执行抓取
    const result = await doWebFetch({
      url,
      extractMode,
      maxChars,
      timeout: DEFAULT_TIMEOUT,
    });

    // 写入缓存
    FETCH_CACHE.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + DEFAULT_CACHE_TTL,
    });

    return result;
  },
};

// ============ 导出 ============

export default webFetchTool;