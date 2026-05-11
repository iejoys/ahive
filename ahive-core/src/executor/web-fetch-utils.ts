/**
 * AHIVECORE Web Fetch Utils
 * 
 * 从 OpenClaw 移植的 HTML 解析工具
 * 功能：
 * - HTML → Markdown 转换
 * - HTML → 纯文本转换
 * - Readability 正文提取
 */

export type ExtractMode = 'markdown' | 'text';

const READABILITY_MAX_HTML_CHARS = 1_000_000;

// ============ Readability 依赖懒加载 ============

let readabilityDepsPromise: Promise<{
  Readability: typeof import('@mozilla/readability').Readability;
  parseHTML: typeof import('linkedom').parseHTML;
}> | undefined;

async function loadReadabilityDeps(): Promise<{
  Readability: typeof import('@mozilla/readability').Readability;
  parseHTML: typeof import('linkedom').parseHTML;
}> {
  if (!readabilityDepsPromise) {
    readabilityDepsPromise = Promise.all([
      import('@mozilla/readability'),
      import('linkedom'),
    ]).then(([readability, linkedom]) => ({
      Readability: readability.Readability,
      parseHTML: linkedom.parseHTML,
    }));
  }
  try {
    return await readabilityDepsPromise;
  } catch (error) {
    readabilityDepsPromise = undefined;
    throw error;
  }
}

// ============ HTML 工具函数 ============

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/gi, (_, dec) =>
      String.fromCharCode(parseInt(dec, 10))
    );
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ''));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ============ HTML → Markdown ============

export function htmlToMarkdown(html: string): { text: string; title?: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? normalizeWhitespace(stripTags(titleMatch[1]))
    : undefined;

  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // 链接转换
  text = text.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, body) => {
      const label = normalizeWhitespace(stripTags(body));
      if (!label) return href;
      return `[${label}](${href})`;
    }
  );

  // 标题转换
  text = text.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level, body) => {
      const prefix = '#'.repeat(Math.max(1, Math.min(6, parseInt(level, 10))));
      const label = normalizeWhitespace(stripTags(body));
      return `\n${prefix} ${label}\n`;
    }
  );

  // 列表转换
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => {
    const label = normalizeWhitespace(stripTags(body));
    return label ? `\n- ${label}` : '';
  });

  // 换行处理
  text = text
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|table|tr|ul|ol)>/gi, '\n');

  text = stripTags(text);
  text = normalizeWhitespace(text);

  return { text, title };
}

// ============ Markdown → Text ============

export function markdownToText(markdown: string): string {
  let text = markdown;

  // 移除图片
  text = text.replace(/!\[[^\]]*]\([^)]+\)/g, '');

  // 链接只保留文本
  text = text.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');

  // 代码块
  text = text.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/```[^\n]*\n?/g, '').replace(/```/g, '')
  );

  // 行内代码
  text = text.replace(/`([^`]+)`/g, '$1');

  // 标题
  text = text.replace(/^#{1,6}\s+/gm, '');

  // 列表
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');

  // 粗体/斜体
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  return normalizeWhitespace(text);
}

// ============ Readability 正文提取 ============

export async function extractReadableContent(params: {
  html: string;
  url?: string;
  extractMode?: ExtractMode;
}): Promise<{ text: string; title?: string } | null> {
  const { html, url = '', extractMode = 'markdown' } = params;

  if (html.length > READABILITY_MAX_HTML_CHARS) {
    // 太长，直接用简单解析
    const result = htmlToMarkdown(html);
    return {
      text: extractMode === 'text' ? markdownToText(result.text) : result.text,
      title: result.title,
    };
  }

  try {
    const { Readability, parseHTML } = await loadReadabilityDeps();
    const doc = parseHTML(html);

    const reader = new Readability(doc.document, {
      debug: false,
      maxElemsToParse: 10000,
    });

    const article = reader.parse();

    if (!article?.textContent) {
      return null;
    }

    const title = article.title || undefined;
    let text = article.textContent;

    if (extractMode === 'markdown') {
      // 使用 HTML 内容转换为 Markdown
      if (article.content) {
        const mdResult = htmlToMarkdown(article.content);
        text = mdResult.text;
      }
    }

    return {
      text: normalizeWhitespace(text),
      title,
    };
  } catch (error) {
    console.error('[WebFetch] Readability 解析失败:', error);
    return null;
  }
}

// ============ 文本截断 ============

export function truncateText(
  text: string,
  maxLength: number
): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  // 尝试在句子边界截断
  const truncated = text.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('。');
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = Math.max(lastPeriod, lastNewline, maxLength - 200);

  return {
    text: truncated.slice(0, cutPoint) + '\n\n[...内容已截断...]',
    truncated: true,
  };
}