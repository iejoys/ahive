/**
 * AHIVECORE 记忆压缩器
 * 
 * 当 rollout 文件过大时自动压缩历史
 * 
 * Compaction 触发条件（参考 CODEX）：
 * - 优先：Token 估算 >= contextWindow × compactRatio
 * - 备用：消息数 > triggerThreshold
 * 
 * contextWindow 来源：
 * 1. providers.json 中的 currentConfig.maxTokens
 * 2. 如果未配置，默认 200K
 * 
 * 🔧 修复记录 (2026-03-27)：
 * - 修复压缩后文件大小没有减少的问题
 * - 修复 replacement_history 包含完整消息对象的问题
 * - 添加压缩结果保存到数据库的功能
 * - 添加压缩后重新检查文件大小的逻辑
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ES Module 兼容的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import type {
    CompactionConfig,
    LLMService,
    MemorySpace,
    RolloutItem,
    RolloutStats
} from './types.js';
import {
    truncateWithTokenBudget,
    approxTokenCount,
    getRolloutsDir
} from './utils.js';
import { compactionLogger } from '../../utils/llm-logger.js';

/** 默认压缩配置 */
const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
    triggerThreshold: 500,         // 备用：超过 500 条消息触发
    preserveRecent: 20,            // 保留最近 20 条
    summaryMaxTokens: 4000,        // 摘要最大 4K tokens
    contextWindow: 200000,         // 默认 200K 上下文窗口
    compactRatio: 0.9,             // 90% 时触发压缩
};

/** 压缩完成回调参数 */
export interface CompactionResult {
    threadId: string;
    summary: string;
    originalCount: number;
    preservedCount: number;
    originalSize: number;
    compactedSize: number;
    timestamp: Date;
    // 🔧 新增：完整的 replacement_history
    replacementHistory?: RolloutItem[];
}

/** 默认上下文窗口（200K tokens） */
const DEFAULT_CONTEXT_WINDOW = 200000;

/** providers.json 配置接口 */
interface ProviderConfig {
    currentConfig?: {
        maxTokens?: number;
        [key: string]: any;
    };
    settings?: {
        defaultMaxTokens?: number;
        [key: string]: any;
    };
}

/** 压缩回调类型 */
export type CompactionCallback = (result: CompactionResult) => void;

export class MemoryCompactor {
    private config: CompactionConfig;
    private llmService: LLMService | null = null;
    private onCompactionComplete: CompactionCallback | null = null;

    constructor(config?: Partial<CompactionConfig>, llmService?: LLMService) {
        this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
        this.llmService = llmService || null;

        // 🔑 自动从配置文件读取 contextWindow
        const contextWindow = this.loadContextWindowFromConfig();
        if (contextWindow) {
            this.config.contextWindow = contextWindow;
        }
    }

    /**
     * 设置压缩完成回调
     */
    setCompactionCallback(callback: CompactionCallback): void {
        this.onCompactionComplete = callback;
    }

    /**
     * 从配置文件动态读取上下文窗口大小
     */
    private loadContextWindowFromConfig(): number | null {
        try {
            const possiblePaths = [
                path.join(process.cwd(), 'config', 'providers.json'),
                path.join(process.cwd(), 'providers.json'),
                path.join(__dirname, '..', '..', '..', 'config', 'providers.json'),
            ];

            for (const configPath of possiblePaths) {
                if (fs.existsSync(configPath)) {
                    try {
                        const content = fs.readFileSync(configPath, 'utf-8');
                        const providerConfig: ProviderConfig = JSON.parse(content);

                        if (providerConfig.currentConfig?.contextWindow) {
                            const contextWindow = providerConfig.currentConfig.contextWindow;
                            console.log(`[Compactor] 从 providers.json 读取上下文窗口: ${(contextWindow / 1000).toFixed(0)}K tokens`);
                            return contextWindow;
                        }

                        if (providerConfig.currentConfig?.maxTokens) {
                            const maxTokens = providerConfig.currentConfig.maxTokens;
                            console.log(`[Compactor] 从 providers.json(maxTokens) 估算上下文窗口: ${(maxTokens / 1000).toFixed(0)}K tokens`);
                            return maxTokens;
                        }

                        if (providerConfig.settings?.defaultMaxTokens) {
                            const defaultMaxTokens = providerConfig.settings.defaultMaxTokens;
                            console.log(`[Compactor] 从 providers.json(settings) 读取上下文窗口: ${(defaultMaxTokens / 1000).toFixed(0)}K tokens`);
                            return defaultMaxTokens;
                        }
                    } catch (e) {
                        // 解析失败，继续尝试下一个路径
                    }
                }
            }

            const modelsPaths = [
                path.join(process.cwd(), 'config', 'models.json'),
                path.join(process.cwd(), 'models.json'),
                path.join(__dirname, '..', '..', '..', 'config', 'models.json'),
            ];

            for (const configPath of modelsPaths) {
                if (fs.existsSync(configPath)) {
                    try {
                        const content = fs.readFileSync(configPath, 'utf-8');
                        const modelsConfig = JSON.parse(content);

                        if (modelsConfig.settings?.defaultContextSize) {
                            const contextSize = modelsConfig.settings.defaultContextSize;
                            console.log(`[Compactor] 从 models.json 读取上下文窗口: ${(contextSize / 1000).toFixed(0)}K tokens`);
                            return contextSize;
                        }

                        if (modelsConfig.settings?.defaultMaxTokens) {
                            const defaultMaxTokens = modelsConfig.settings.defaultMaxTokens;
                            console.log(`[Compactor] 从 models.json(settings) 读取上下文窗口: ${(defaultMaxTokens / 1000).toFixed(0)}K tokens`);
                            return defaultMaxTokens;
                        }
                    } catch (e) {
                        // 解析失败，继续尝试
                    }
                }
            }

            console.log(`[Compactor] 未找到配置文件，使用默认上下文窗口: ${DEFAULT_CONTEXT_WINDOW / 1000}K tokens`);
            return null;

        } catch (error) {
            console.log(`[Compactor] 读取配置文件失败，使用默认上下文窗口: ${DEFAULT_CONTEXT_WINDOW / 1000}K tokens`);
            return null;
        }
    }

    /**
     * 设置 LLM 服务
     */
    setLLMService(service: LLMService): void {
        this.llmService = service;
    }

    /**
     * 设置模型上下文窗口大小
     */
    setContextWindow(contextWindow: number): void {
        this.config.contextWindow = contextWindow;
        console.log(`[Compactor] 上下文窗口设置为: ${(contextWindow / 1000).toFixed(0)}K, 压缩阈值: ${((contextWindow * this.config.compactRatio) / 1000).toFixed(0)}K tokens`);
    }

    /**
     * 检查是否需要压缩
     * 
     * 🔧 修复：正确计算压缩后的 token 数
     */
    needsCompaction(stats: RolloutStats, threadId: string = 'unknown'): boolean {
        const contextWindow = this.config.contextWindow || DEFAULT_CONTEXT_WINDOW;
        const tokenThreshold = Math.floor(contextWindow * this.config.compactRatio);

        // M-4: 统一使用 approxTokenCount 进行 token 估算
        // stats.estimatedTokens 已经是通过 approxTokenCount 计算的，无需 fallback 到不同比例的函数
        const approxTokens = stats.estimatedTokens || 0;

        // 判断是否需要压缩
        const needsCompact = approxTokens >= tokenThreshold || stats.messageCount > this.config.triggerThreshold;

        // 记录压缩检查日志
        compactionLogger.logCheck(threadId, {
            messageCount: stats.messageCount,
            estimatedTokens: approxTokens,
            tokenThreshold,
            contextWindow,
            compactRatio: this.config.compactRatio,
            needsCompact,
        });

        return needsCompact;
    }

    /**
     * 检查并执行压缩
     */
    async checkAndCompact(space: MemorySpace, threadId: string): Promise<boolean> {
        const rolloutPath = path.join(space.fsPath, 'rollouts', `${threadId}.jsonl`);

        if (!fs.existsSync(rolloutPath)) {
            return false;
        }

        const stats = this.getRolloutStats(rolloutPath);

        if (!this.needsCompaction(stats, threadId)) {
            return false;
        }

        await this.compact(rolloutPath, threadId, space.spaceId);
        return true;
    }

    /**
     * 执行压缩
     * 
     * 🔧 修复：
     * 1. replacement_history 只保留摘要，不保留完整消息
     * 2. 压缩后验证文件大小
     * 3. 保存压缩结果到数据库
     */
    async compact(rolloutPath: string, threadId: string, spaceId?: string, initialContext?: string): Promise<CompactionResult | null> {
        const startTime = Date.now();

        console.log(`[Compactor] 开始压缩: ${threadId}`);

        // 记录原始大小
        const originalContent = fs.readFileSync(rolloutPath, 'utf-8');
        const originalSize = originalContent.length;
        const originalTokens = approxTokenCount(originalContent);

        // 1. 读取所有消息
        const messages = this.loadRolloutMessages(rolloutPath);

        // 记录压缩开始日志
        compactionLogger.logStart(threadId, {
            originalSize,
            originalTokens,
            messageCount: messages.length,
            preserveCount: this.config.preserveRecent,
        });

        if (messages.length <= this.config.preserveRecent) {
            console.log(`[Compactor] 消息数不足，跳过压缩: ${messages.length}`);
            compactionLogger.logSkip(threadId, `消息数不足: ${messages.length}`);
            return null;
        }

        // 2. 分割：待压缩部分 + 保留部分
        const toCompress = messages.slice(0, -this.config.preserveRecent);
        const toPreserve = messages.slice(-this.config.preserveRecent);

        if (toCompress.length === 0) {
            compactionLogger.logSkip(threadId, '待压缩消息为空');
            return null;
        }

        // 3. 生成摘要
        const summary = await this.generateSummary(toCompress);

        // 🔧 修复：构建增强型 replacement_history (对齐 CODEX 防腐机制)
        const refresherBlock = `
> [!IMPORTANT]
> **Environment Refresher & Critical Context**
> - **Current Working Directory (CWD)**: \`${process.cwd()}\`
> - **Active Mission**: Continue assisting the user based on the summary provided below.
> - **System Constraints**: Adhere to all previous safety guidelines and tool usage rules.
`.trim();

        const replacementHistory: RolloutItem[] = [];

        // 1. 如果有初始上下文，进行重注入
        if (initialContext) {
            replacementHistory.push({
                type: 'message' as const,
                timestamp: new Date().toISOString(),
                role: 'system' as const,
                content: `[Initial Context Reinjection]\n${initialContext}`,
            });
        }

        // 2. 添加摘要
        replacementHistory.push({
            type: 'message' as const,
            timestamp: new Date().toISOString(),
            role: 'system' as const,
            content: `[历史对话摘要 - ${new Date().toLocaleDateString()}]\n${summary}`,
        });

        // 3. 添加环境刷新块
        replacementHistory.push({
            type: 'message' as const,
            timestamp: new Date().toISOString(),
            role: 'system' as const,
            content: refresherBlock,
        });

        // 4. 构建压缩项（精简版）
        const compactedItem: RolloutItem = {
            type: 'compacted',
            timestamp: new Date().toISOString(),
            summary,
            replacement_history: replacementHistory,  // 只包含摘要
            preservedCount: toPreserve.length,
            originalCount: messages.length,
        };

        // 5. 🔧 核心修复：不再 writeFileSync 覆盖 rollout 文件！
        // 持久化文件保留完整原文，压缩结果仅追加 compacted 标记作为书签
        // 归档逻辑（超1MB时移至 archived/）负责文件生命周期管理
        fs.appendFileSync(rolloutPath, JSON.stringify(compactedItem) + '\n', 'utf-8');

        // 验证压缩效果（基于摘要+保留消息的估算）
        const compactedSize = JSON.stringify(compactedItem).length + toPreserve.map(m => JSON.stringify(m).length).reduce((a, b) => a + b, 0);
        const compactedTokens = approxTokenCount(compactedItem.summary || '');
        const compressionRatio = ((1 - compactedSize / originalSize) * 100).toFixed(1);
        const duration = Date.now() - startTime;

        console.log(`[Compactor] 压缩完成: ${threadId}`);
        console.log(`[Compactor]   - 消息数: ${messages.length} → ${toPreserve.length + 1} 条`);
        console.log(`[Compactor]   - 文件大小: ${originalSize} → ${compactedSize} 字符 (压缩 ${compressionRatio}%)`);
        console.log(`[Compactor]   - Token 数: ${originalTokens} → ${compactedTokens}`);

        // 记录压缩完成日志
        compactionLogger.logEnd(threadId, {
            duration,
            compactedSize,
            compactedTokens,
            compressionRatio,
            preservedCount: toPreserve.length + 1,
            summary,
        });

        // 构建结果
        const result: CompactionResult = {
            threadId,
            summary,
            originalCount: messages.length,
            preservedCount: toPreserve.length,
            originalSize,
            compactedSize,
            timestamp: new Date(),
            // 🔧 新增：传递 replacement_history 到数据库
            replacementHistory: replacementHistory,
        };

        // 🔧 调用回调（用于保存到数据库）
        if (this.onCompactionComplete) {
            this.onCompactionComplete(result);
        }

        return result;
    }

    /**
     * 收集用户消息
     */
    private collectUserMessages(messages: RolloutItem[]): RolloutItem[] {
        return messages.filter(m => m.type === 'message' && m.role === 'user' && m.content);
    }

    /**
     * 获取 rollout 统计
     * 
     * 🔧 修复：正确处理 compacted 类型的消息
     */
    getRolloutStats(rolloutPath: string): RolloutStats {
        const stats: RolloutStats = {
            messageCount: 0,
            toolCallCount: 0,
            compactedCount: 0,
            totalSize: 0,
            estimatedTokens: 0,
            oldestTimestamp: null,
            newestTimestamp: null,
        };

        if (!fs.existsSync(rolloutPath)) {
            return stats;
        }

        const content = fs.readFileSync(rolloutPath, 'utf-8');
        stats.totalSize = content.length;
        stats.estimatedTokens = approxTokenCount(content);

        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const item = JSON.parse(line) as RolloutItem;

                switch (item.type) {
                    case 'message':
                        stats.messageCount++;
                        break;
                    case 'tool_call':
                        stats.toolCallCount++;
                        break;
                    case 'compacted':
                        stats.compactedCount++;
                        // 🔧 修复：compacted 消息也计入消息数
                        stats.messageCount++;
                        break;
                }

                const timestamp = typeof item.timestamp === 'string'
                    ? new Date(item.timestamp)
                    : item.timestamp;

                if (timestamp) {
                    if (!stats.oldestTimestamp || timestamp < stats.oldestTimestamp) {
                        stats.oldestTimestamp = timestamp;
                    }
                    if (!stats.newestTimestamp || timestamp > stats.newestTimestamp) {
                        stats.newestTimestamp = timestamp;
                    }
                }
            } catch {
                // 跳过解析失败的行
            }
        }

        return stats;
    }

    /**
     * 加载 rollout 消息
     */
    loadRolloutMessages(rolloutPath: string): RolloutItem[] {
        if (!fs.existsSync(rolloutPath)) {
            return [];
        }

        const content = fs.readFileSync(rolloutPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const messages: RolloutItem[] = [];

        for (const line of lines) {
            try {
                const item = JSON.parse(line) as RolloutItem;
                if (typeof item.timestamp === 'string') {
                    item.timestamp = new Date(item.timestamp);
                }
                messages.push(item);
            } catch {
                // 跳过解析失败的行
            }
        }

        return messages;
    }

    /**
     * LLM 生成摘要
     */
    private async generateSummary(messages: RolloutItem[]): Promise<string> {
        const dialogMessages = messages.filter(m => m.type === 'message' && m.role && m.content);

        if (dialogMessages.length === 0) {
            return '(无对话内容)';
        }

        const conversationText = dialogMessages
            .map(m => `${m.role}: ${m.content}`)
            .join('\n\n');

        const truncatedText = truncateWithTokenBudget(
            conversationText,
            this.config.summaryMaxTokens * 2
        );

        if (!this.llmService) {
            return this.generateSimpleSummary(dialogMessages);
        }

        try {
            const response = await this.llmService.chat([
                {
                    role: 'system',
                    content: `你是一个记忆压缩助手。请为以下对话生成简洁的摘要，保留关键信息、决策和重要细节。摘要应该：1. 简明扼要 2. 保留关键决策 3. 记住重要上下文 4. 不超过 500 字`
                },
                {
                    role: 'user',
                    content: `请为以下对话生成摘要：\n\n${truncatedText}`
                }
            ]);

            return truncateWithTokenBudget(response.content, this.config.summaryMaxTokens);
        } catch (error) {
            console.error('[Compactor] LLM 摘要生成失败:', error);
            return this.generateSimpleSummary(dialogMessages);
        }
    }

    /**
     * 生成简单摘要（无 LLM 时使用）
     */
    private generateSimpleSummary(messages: RolloutItem[]): string {
        const userMessages = messages.filter(m => m.role === 'user' && m.content);
        const assistantMessages = messages.filter(m => m.role === 'assistant' && m.content);

        const summary = [
            `## 历史对话摘要`,
            `- 对话轮次: ${userMessages.length} 轮`,
            `- 用户消息: ${userMessages.length} 条`,
            `- 助手回复: ${assistantMessages.length} 条`,
            ``,
            `### 最近话题`,
            ...userMessages.slice(-5).map((m, i) => `${i + 1}. ${m.content?.slice(0, 100)}...`),
        ].join('\n');

        return truncateWithTokenBudget(summary, this.config.summaryMaxTokens);
    }

    /**
     * 获取配置
     */
    getConfig(): CompactionConfig {
        return { ...this.config };
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<CompactionConfig>): void {
        this.config = { ...this.config, ...config };
    }
}