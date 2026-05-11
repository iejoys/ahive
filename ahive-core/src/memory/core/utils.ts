/**
 * AHIVECORE 记忆系统工具函数
 * 
 * 提供 token 计算、文本截断等功能
 * 参考 CODEX 的截断实现
 */

import path from 'path';

// ==================== Token 计算 ====================

/** 近似每 token 字节数（用于字节估算） */
const APPROX_BYTES_PER_TOKEN = 4;

/**
 * 近似计算文本 token 数量
 * 
 * 改进版：考虑中文字符
 * - 英文：约 4 字符 = 1 token
 * - 中文：约 1.5 字符 = 1 token（中文字符通常占 1-2 token）
 * - 混合：根据中文字符比例动态估算
 */
export function approxTokenCount(text: string): number {
    if (!text || text.length === 0) {
        return 0;
    }

    // 统计中文字符数量
    // 匹配 CJK 统一汉字、扩展 A-F、兼容汉字等
    // 使用简单的 Unicode 范围匹配
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
    const cjkChars = (text.match(cjkRegex) || []).length;

    const totalChars = text.length;
    const nonCjkChars = totalChars - cjkChars;

    // 中文：约 1.5 字符 = 1 token
    // 英文/其他：约 4 字符 = 1 token
    const cjkTokens = Math.ceil(cjkChars / 1.5);
    const nonCjkTokens = Math.ceil(nonCjkChars / 4);

    const total = cjkTokens + nonCjkTokens;

    // 🔍 DEBUG: 输出估算细节（仅在 DEBUG 环境变量设置时）
    if (process.env.DEBUG_TOKEN === 'true') {
        console.log(`[TokenCount] 总字符=${totalChars}, 中文=${cjkChars}, 非中文=${nonCjkChars}, 中文tokens=${cjkTokens}, 非中文tokens=${nonCjkTokens}, 总计=${total}`);
    }

    return total;
}

/**
 * 从字符数估算 token 数量（简化版，用于文件大小估算）
 * M-12: 重命名为 approxTokenCountFromCharCount，明确参数是字符数
 * 
 * 假设文本是中英混合，取中间值：约 2.5 字符 = 1 token
 */
export function approxTokenCountFromCharCount(charCount: number): number {
    return Math.ceil(charCount / 2.5);
}

/** @deprecated 使用 approxTokenCountFromCharCount 代替 */
export function approxTokenCountFromString(charCount: number): number {
    return approxTokenCountFromCharCount(charCount);
}

/**
 * 根据目标 token 数计算字节数
 */
export function approxBytesForTokens(tokens: number): number {
    return tokens * APPROX_BYTES_PER_TOKEN;
}

/**
 * 从字节数计算近似 token 数
 */
export function approxTokensFromByteCount(bytes: number): number {
    return Math.ceil(bytes / APPROX_BYTES_PER_TOKEN);
}

// ==================== 文本截断（参考 CODEX）====================

/**
 * 截断策略
 */
export interface TruncationPolicy {
    type: 'bytes' | 'tokens';
    limit: number;
}

/**
 * 截断结果
 */
export interface TruncationResult {
    text: string;
    truncated: boolean;
    originalLines?: number;
    removedTokens?: number;
    removedChars?: number;
}

/**
 * 格式化截断输出（参考 CODEX）
 * 添加总行数信息，保留头尾
 */
export function formattedTruncateText(content: string, policy: TruncationPolicy): string {
    const result = truncateText(content, policy);

    if (!result.truncated) {
        return content;
    }

    const totalLines = content.split('\n').length;

    // M-7: 修复死代码，将省略信息纳入输出
    let omissionInfo = '';
    if (result.removedTokens) {
        omissionInfo = `…${result.removedTokens} tokens truncated…`;
    } else if (result.removedChars) {
        omissionInfo = `…${result.removedChars} chars truncated…`;
    }

    return `Total output lines: ${totalLines}\n${omissionInfo ? omissionInfo + '\n' : ''}\n${result.text}`;
}

/**
 * 通用截断函数（参考 CODEX）
 * 保留头尾，中间用省略标记替换
 */
export function truncateText(content: string, policy: TruncationPolicy): TruncationResult {
    if (!content || content.length === 0) {
        return { text: '', truncated: false };
    }

    const maxBytes = policy.type === 'bytes'
        ? policy.limit
        : approxBytesForTokens(policy.limit);

    if (content.length <= maxBytes) {
        return { text: content, truncated: false };
    }

    // 预算为 0，只显示省略标记
    if (maxBytes === 0) {
        const removedTokens = approxTokenCount(content);
        const removedChars = content.length;
        return {
            text: policy.type === 'tokens'
                ? `…${removedTokens} tokens truncated…`
                : `…${removedChars} chars truncated…`,
            truncated: true,
            removedTokens,
            removedChars,
        };
    }

    // 分割预算：前半 + 后半
    const { left, right } = splitBudget(maxBytes);

    // 在 UTF-8 边界分割
    const { removedChars, prefix, suffix } = splitString(content, left, right);

    // 计算省略数量
    const removedBytes = content.length - maxBytes;
    const removedTokens = approxTokensFromByteCount(removedBytes);

    // 生成截断标记
    const marker = policy.type === 'tokens'
        ? `…${removedTokens} tokens truncated…`
        : `…${removedChars} chars truncated…`;

    // 组装输出
    const text = assembleTruncatedOutput(prefix, suffix, marker);

    return {
        text,
        truncated: true,
        removedTokens,
        removedChars,
    };
}

/**
 * 分割预算（参考 CODEX）
 */
function splitBudget(budget: number): { left: number; right: number } {
    const left = Math.floor(budget / 2);
    return { left, right: budget - left };
}

/**
 * 在字符边界分割字符串（参考 CODEX）
 * M-9: 注意：JavaScript 字符串是 UTF-16，此处按字符偏移分割（非字节）
 */
function splitString(s: string, beginningChars: number, endChars: number): {
    removedChars: number;
    prefix: string;
    suffix: string;
} {
    if (!s || s.length === 0) {
        return { removedChars: 0, prefix: '', suffix: '' };
    }

    const len = s.length;
    const tailStartTarget = Math.max(0, len - endChars);

    let prefixEnd = 0;
    let suffixStart = len;
    let removedChars = 0;
    let suffixStarted = false;

    // 遍历字符，找到合适的分割点
    for (let i = 0; i < len;) {
        const char = s[i];
        const charLen = char.length; // JavaScript 字符串已经是 Unicode
        const charEnd = i + charLen;

        if (charEnd <= beginningChars) {
            prefixEnd = charEnd;
            i = charEnd;
            continue;
        }

        if (i >= tailStartTarget) {
            if (!suffixStarted) {
                suffixStart = i;
                suffixStarted = true;
            }
            i = charEnd;
            continue;
        }

        removedChars++;
        i = charEnd;
    }

    // 确保 suffix 在 prefix 之后
    if (suffixStart < prefixEnd) {
        suffixStart = prefixEnd;
    }

    const prefix = s.slice(0, prefixEnd);
    const suffix = s.slice(suffixStart);

    return { removedChars, prefix, suffix };
}

/**
 * 组装截断输出（参考 CODEX）
 */
function assembleTruncatedOutput(prefix: string, suffix: string, marker: string): string {
    return prefix + marker + suffix;
}

/**
 * 截断函数输出项列表（参考 CODEX）
 * 用于处理多个输出项，保留图片等
 */
export function truncateFunctionOutputItems(
    items: Array<{ type: 'text' | 'image'; content?: string; url?: string }>,
    policy: TruncationPolicy
): Array<{ type: 'text' | 'image'; content?: string; url?: string }> {
    const result: Array<{ type: 'text' | 'image'; content?: string; url?: string }> = [];

    let remainingBudget = policy.type === 'bytes'
        ? policy.limit
        : policy.limit; // token 预算

    let omittedTextItems = 0;

    for (const item of items) {
        if (item.type === 'image') {
            // 图片直接保留
            result.push(item);
            continue;
        }

        if (item.type === 'text' && item.content) {
            if (remainingBudget === 0) {
                omittedTextItems++;
                continue;
            }

            const cost = policy.type === 'bytes'
                ? item.content.length
                : approxTokenCount(item.content);

            if (cost <= remainingBudget) {
                result.push(item);
                remainingBudget -= cost;
            } else {
                // 截断到剩余预算
                const snippetPolicy: TruncationPolicy = policy.type === 'bytes'
                    ? { type: 'bytes', limit: remainingBudget }
                    : { type: 'tokens', limit: remainingBudget };

                const truncated = truncateText(item.content, snippetPolicy);
                if (truncated.text) {
                    result.push({ type: 'text', content: truncated.text });
                } else {
                    omittedTextItems++;
                }
                remainingBudget = 0;
            }
        }
    }

    // 添加省略项标记
    if (omittedTextItems > 0) {
        result.push({
            type: 'text',
            content: `[omitted ${omittedTextItems} text items ...]`,
        });
    }

    return result;
}

// ==================== 消息列表处理 ====================

/**
 * 消息项接口（通用型）
 */
export interface GenericMessage {
    role: string;
    content: string;
    [key: string]: any;
}

/**
 * 按 Token 预算截断消息列表
 * 
 * 策略：从最新的消息开始保留，直到达到预算限制。
 * 总是保留第一条消息（如果是 system 角色，通常是核心提示词）。
 */
export function truncateMessagesByTokenBudget(
    messages: GenericMessage[],
    maxTokens: number
): GenericMessage[] {
    if (messages.length === 0) return [];

    const result: GenericMessage[] = [];
    let currentTokens = 0;

    // 1. 总是尝试保留第一条消息（如果是系统提示词）
    const firstMsg = messages[0];
    const firstMsgTokens = approxTokenCount(firstMsg.content || '');
    
    // 如果只有一条消息，直接返回
    if (messages.length === 1) {
        return [firstMsg];
    }

    // 2. 从最后一条消息开始反向遍历，保留最近的对话
    const dialogMessages = messages.slice(1);
    const preservedDialog: GenericMessage[] = [];
    
    // 为系统提示词预留空间
    const availableTokens = Math.max(0, maxTokens - firstMsgTokens);

    for (let i = dialogMessages.length - 1; i >= 0; i--) {
        const msg = dialogMessages[i];
        const msgTokens = approxTokenCount(msg.content || '') + 4; // 4 是格式开销

        if (currentTokens + msgTokens <= availableTokens) {
            preservedDialog.unshift(msg);
            currentTokens += msgTokens;
        } else {
            // 空间不足，停止添加
            break;
        }
    }

    // 3. 组合结果
    result.push(firstMsg);
    result.push(...preservedDialog);

    return result;
}

// 保留旧的简化接口（向后兼容）
/**
 * 按 token 预算截断文本（简化版，向后兼容）
 */
export function truncateWithTokenBudget(text: string, maxTokens: number): string {
    const result = truncateText(text, { type: 'tokens', limit: maxTokens });
    return result.text;
}

/**
 * 按字节数截断文本（简化版，向后兼容）
 */
export function truncateWithByteBudget(text: string, maxBytes: number): string {
    const result = truncateText(text, { type: 'bytes', limit: maxBytes });
    return result.text;
}

// ==================== 文件路径工具 ====================

/**
 * 格式化日期为文件名格式
 */
export function formatDateForFilename(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;
}

/**
 * 从 thread ID 生成短哈希
 */
export function generateShortHash(threadId: string): string {
    const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const SPACE = 14776336; // 62^4

    let seed = 0;
    for (let i = 0; i < threadId.length; i++) {
        seed = (seed * 31 + threadId.charCodeAt(i)) >>> 0;
    }
    seed = seed % SPACE;

    const chars: string[] = ['0', '0', '0', '0'];
    for (let i = 3; i >= 0; i--) {
        chars[i] = ALPHABET[seed % ALPHABET.length];
        seed = Math.floor(seed / ALPHABET.length);
    }

    return chars.join('');
}

/**
 * 生成 rollout 摘要文件名
 */
export function generateRolloutSummaryFilename(threadId: string, sourceUpdatedAt: Date, slug?: string): string {
    const timestamp = formatDateForFilename(sourceUpdatedAt);
    const hash = generateShortHash(threadId);

    if (slug) {
        const sanitizedSlug = slug
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .slice(0, 60);
        return `${timestamp}-${hash}-${sanitizedSlug}.md`;
    }

    return `${timestamp}-${hash}.md`;
}

// ==================== 目录路径工具 ====================

/**
 * 获取记忆空间目录
 */
export function getSpaceDir(memoryRoot: string, spaceId: string): string {
    return path.join(memoryRoot, 'spaces', spaceId.replace(':', path.sep));
}

/**
 * 获取 rollouts 目录
 */
export function getRolloutsDir(spaceDir: string): string {
    return path.join(spaceDir, 'rollouts');
}

/**
 * 获取 rollout 摘要目录
 */
export function getRolloutSummariesDir(spaceDir: string): string {
    return path.join(spaceDir, 'rollout_summaries');
}

/**
 * 获取 MEMORY.md 文件路径
 */
export function getMemoryFilePath(spaceDir: string): string {
    return path.join(spaceDir, 'MEMORY.md');
}

/**
 * 获取 rollout 文件路径
 */
export function getRolloutFilePath(spaceDir: string, threadId: string): string {
    return path.join(getRolloutsDir(spaceDir), `${threadId}.jsonl`);
}

// ==================== 时间工具 ====================

/**
 * 检查日期是否过期
 */
export function isStale(timestamp: number | Date, maxAgeMs: number): boolean {
    const ts = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
    return Date.now() - ts > maxAgeMs;
}

/**
 * 获取天数对应的毫秒数
 */
export function daysToMs(days: number): number {
    return days * 24 * 60 * 60 * 1000;
}

/**
 * 获取小时数对应的毫秒数
 */
export function hoursToMs(hours: number): number {
    return hours * 60 * 60 * 1000;
}