/**
 * 网络搜索工具
 *
 * 使用 DuckDuckGo 进行网络搜索
 *
 * 安全防护：
 * - 查询注入防护
 * - 超时控制
 * - 响应大小限制
 * - URL 验证
 * - 敏感内容过滤
 */

import { z } from 'zod';
import type { AgentTool } from './tool-system.js';
import { errorResult } from './tool-system.js';
import { logger } from '../utils/index.js';

// ============ 配置 ============

/** 搜索超时时间 (ms) */
const SEARCH_TIMEOUT = 15000;

/** 最大结果数 */
const MAX_RESULTS = 10;

/** 最大响应大小 (5MB) */
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

/** 最大标题长度 */
const MAX_TITLE_LENGTH = 200;

/** 最大描述长度 */
const MAX_DESCRIPTION_LENGTH = 500;

/** User-Agent */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 危险 URL 模式（防止钓鱼/恶意网站）*/
const DANGEROUS_URL_PATTERNS = [
  /\.(exe|dll|bat|cmd|ps1|sh|msi)$/i,  // 可执行文件
  /javascript:/i,                        // JavaScript 伪协议
  /data:/i,                              // Data URL
  /file:/i,                              // 本地文件
  /localhost/i,                          // 本地地址
  /127\.\d+\.\d+\.\d+/,                  // 回环地址
  /192\.168\.\d+\.\d+/,                  // 内网地址
  /10\.\d+\.\d+\.\d+/,                   // 内网地址
  /172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/,  // 内网地址
];

/** 查询注入危险字符 */
const QUERY_DANGEROUS_PATTERNS = [
  /<[^>]*>/g,           // HTML 标签
  /javascript:/gi,      // JavaScript
  /on\w+\s*=/gi,        // 事件处理器
  /data:/gi,            // Data URL
  /vbscript:/gi,        // VBScript
];

// ============ 安全防护函数 ============

/**
 * 清理查询字符串，防止注入攻击
 */
function sanitizeQuery(query: string): string {
  let cleaned = query;

  // 移除危险模式
  for (const pattern of QUERY_DANGEROUS_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 限制长度
  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 200);
  }

  // 移除控制字符
  cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, '');

  return cleaned.trim();
}

/**
 * 验证 URL 是否安全
 */
function isUrlSafe(url: string): boolean {
  if (!url) return false;

  // 检查危险模式
  for (const pattern of DANGEROUS_URL_PATTERNS) {
    if (pattern.test(url)) {
      return false;
    }
  }

  // 只允许 http/https
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * 清理文本内容，防止 XSS
 */
function sanitizeText(text: string, maxLength: number): string {
  // 移除 HTML 标签
  let cleaned = text.replace(/<[^>]*>/g, '');

  // 解码 HTML 实体
  cleaned = cleaned
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')  // 移除数字实体
    .replace(/&#[xX][0-9a-fA-F]+;/g, '');  // 移除十六进制实体

  // 合并空白
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 限制长度
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + '...';
  }

  // 移除可能的脚本注入
  cleaned = cleaned.replace(/javascript:/gi, '');
  cleaned = cleaned.replace(/on\w+\s*=/gi, '');

  return cleaned;
}

// ============ 类型定义 ============

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  durationMs: number;
  error?: string;
}

// ============ 参数 Schema ============

const WebSearchParamsSchema = z.object({
  query: z.string().min(2).describe('搜索关键词'),
  max_results: z.number().min(1).max(20).optional().default(10).describe('最大返回结果数 (1-20)'),
});

// ============ DuckDuckGo 搜索实现 ============

/**
 * 执行 DuckDuckGo 搜索
 *
 * 使用 HTML 解析方式，因为 DuckDuckGo 没有官方搜索 API
 */
async function searchDuckDuckGo(
  query: string,
  maxResults: number = 10,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const startTime = Date.now();

  // 清理查询
  const sanitizedQuery = sanitizeQuery(query);
  if (!sanitizedQuery) {
    return {
      success: false,
      query,
      results: [],
      durationMs: Date.now() - startTime,
      error: '无效的搜索关键词',
    };
  }

  try {
    // DuckDuckGo HTML 搜索页面
    const encodedQuery = encodeURIComponent(sanitizedQuery);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    logger.debug(`[WebSearch] Searching: ${sanitizedQuery}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 检查响应大小
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(`响应过大 (${contentLength} bytes)，已拒绝`);
    }

    // 读取响应（限制大小）
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应');
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > MAX_RESPONSE_SIZE) {
        reader.cancel();
        throw new Error(`响应过大，已拒绝`);
      }
      chunks.push(value);
    }

    // 合并 chunks
    const html = new TextDecoder().decode(
      Buffer.concat(chunks)
    );

    const results = parseDuckDuckGoResults(html, maxResults);

    return {
      success: true,
      query: sanitizedQuery,
      results,
      durationMs: Date.now() - startTime,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 检查是否是网络错误（可能被墙）
    if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
      return {
        success: false,
        query: sanitizedQuery,
        results: [],
        durationMs: Date.now() - startTime,
        error: '网络连接失败，可能需要代理访问 DuckDuckGo',
      };
    }

    // 检查是否是中止错误
    if (errorMessage.includes('abort') || errorMessage.includes('cancel')) {
      return {
        success: false,
        query: sanitizedQuery,
        results: [],
        durationMs: Date.now() - startTime,
        error: '搜索已超时或被取消',
      };
    }

    return {
      success: false,
      query: sanitizedQuery,
      results: [],
      durationMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

/**
 * 解析 DuckDuckGo HTML 结果
 */
function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo HTML 结果格式：
  // <a class="result__a" href="...">Title</a>
  // <a class="result__url" href="...">url</a>
  // <a class="result__snippet">Description</a>

  // 匹配结果块
  const resultRegex = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];

    // 提取标题和链接
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const rawUrl = decodeDuckDuckGoUrl(titleMatch[1]);

    // 验证 URL 安全性
    if (!isUrlSafe(rawUrl)) {
      continue;  // 跳过不安全的 URL
    }

    const title = sanitizeText(titleMatch[2], MAX_TITLE_LENGTH);
    if (!title) continue;

    // 提取描述
    const descMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const description = descMatch ? sanitizeText(descMatch[1], MAX_DESCRIPTION_LENGTH) : '';

    results.push({ title, url: rawUrl, description });
  }

  // 备用解析方式（如果上面没匹配到）
  if (results.length === 0) {
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = decodeDuckDuckGoUrl(match[1]);

      // 验证 URL 安全性
      if (!isUrlSafe(rawUrl)) {
        continue;
      }

      const title = sanitizeText(match[2], MAX_TITLE_LENGTH);

      if (title && !results.some(r => r.url === rawUrl)) {
        results.push({ title, url: rawUrl, description: '' });
      }
    }
  }

  return results;
}

/**
 * 解码 DuckDuckGo 重定向 URL
 */
function decodeDuckDuckGoUrl(redirectUrl: string): string {
  // DuckDuckGo 使用重定向 URL: /l/?uddg=encoded_url
  try {
    const match = redirectUrl.match(/uddg=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    // 如果不是重定向格式，直接返回
    if (redirectUrl.startsWith('http')) {
      return redirectUrl;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 清理 HTML 标签
 */
function cleanHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')  // 移除 HTML 标签
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')  // 合并空白
    .trim();
}

// ============ 工具定义 ============

export const webSearchTool: AgentTool<z.infer<typeof WebSearchParamsSchema>> = {
  name: 'web_search',
  label: 'web search',
  description: `Search the web using DuckDuckGo to get up-to-date information beyond your knowledge cutoff.

**Parameters:**
- query: The search query (at least 2 characters)
- max_results: Maximum number of results to return (default: 10, max: 20)

**Returns:**
- List of search results with title, URL, and description
- Results are formatted as markdown with clickable links

**CRITICAL REQUIREMENT - You MUST follow this:**
After answering the user's question, you MUST include a "Sources:" section at the end of your response.
In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
This is MANDATORY - never skip including sources in your response.

**Example format:**
\`\`\`
[Your answer here]

Sources:
- [Source Title 1](https://example.com/1)
- [Source Title 2](https://example.com/2)
\`\`\`

**Usage Notes:**
- Use this tool for accessing information beyond your knowledge cutoff
- Provides up-to-date information for current events and recent data
- Searches are performed automatically within a single API call
- May require proxy in some regions

**IMPORTANT - Use the correct year in search queries:**
When searching for recent information, documentation, or current events, always use the current year (2024 or later).
Example: If the user asks for "latest React docs", search for "React documentation 2024", NOT "React documentation 2023".

**Examples:**
- "latest Node.js features 2024" - search for recent Node.js news
- "how to center a div CSS 2024" - search for current CSS tutorials
- "React 18 new features" - search for specific version features`,

  parameters: WebSearchParamsSchema,

  async execute(toolCallId, params, signal) {
    const { query, max_results = 10 } = params;

    try {
      // 检查取消信号
      if (signal?.aborted) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: '⚠️ 操作已取消' }],
        };
      }

      // 创建超时控制器
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), SEARCH_TIMEOUT);

      // 合并外部信号和超时信号
      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;

      // 执行搜索
      const result = await searchDuckDuckGo(query, max_results, combinedSignal);

      clearTimeout(timeoutId);

      // 处理错误
      if (!result.success) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `⚠️ 搜索失败: ${result.error}`,
          }],
        };
      }

      // 格式化输出
      if (result.results.length === 0) {
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `未找到 "${result.query}" 的相关结果。\n\n建议：尝试不同的关键词或检查网络连接。`,
          }],
          details: {
            query: result.query,
            originalQuery: query,
            resultCount: 0,
            durationMs: result.durationMs,
          },
        };
      }

      // 构建结果文本
      const lines: string[] = [
        `🔍 搜索 "${result.query}" 找到 ${result.results.length} 个结果 (${result.durationMs}ms)`,
        '',
      ];

      for (let i = 0; i < result.results.length; i++) {
        const r = result.results[i];
        lines.push(`## ${i + 1}. ${r.title}`);
        lines.push(`**URL**: ${r.url}`);
        if (r.description) {
          lines.push(`**摘要**: ${r.description}`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('💡 提示：点击链接查看详细内容，或在回复中引用来源。');

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: lines.join('\n'),
        }],
        details: {
          query: result.query,  // 使用清理后的查询
          originalQuery: query,  // 原始查询（用于对比）
          resultCount: result.results.length,
          durationMs: result.durationMs,
          results: result.results,
        },
      };

    } catch (error) {
      // 处理取消
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: '⚠️ 操作已取消' }],
        };
      }

      return errorResult('web_search', error);
    }
  },
};

// ============ 导出 ============

export { searchDuckDuckGo };
export type { SearchResult, SearchResponse };