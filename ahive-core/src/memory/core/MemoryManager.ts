/**
 * AHIVECORE 记忆管理器
 * 
 * 统一管理记忆系统的核心组件
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { MemoryDatabase } from './MemoryDatabase.js';
import { MemoryRouter } from './MemoryRouter.js';
import { MemoryCompactor, CompactionResult } from './MemoryCompactor.js';
import type {
    MemorySystemConfig,
    MemorySpace,
    AgentType,
    LLMService,
    RolloutItem,
    Stage1Output,
    Stage1OutputRecord,
    MemoryEvent,
    ContentBlock,
    ToolResultBlock,
    RolloutStats,
} from './types.js';
import { DEFAULT_MEMORY_CONFIG } from './types.js';
import {
    truncateWithTokenBudget,
    approxTokenCount,
    getRolloutsDir,
    getRolloutFilePath,
    daysToMs,
} from './utils.js';
import { archiveOldRolloutContent } from '../codex-memory/storage.js';
import { logArchive } from '../../utils/llm-logger.js';

export class MemoryManager extends EventEmitter {
    private config: MemorySystemConfig;
    private db: MemoryDatabase;
    private router: MemoryRouter;
    private compactor: MemoryCompactor;
    private llmService: LLMService | null = null;

    /** 初始化标志 */
    private initialized: boolean = false;

    /** agentId → 当前活跃threadId的映射 */
    private activeThreadIds: Map<string, string> = new Map();

    /** M-5: 正在压缩的文件集合，防止并发压缩 */
    private compactingFiles: Set<string> = new Set();

    /** 正在归档的文件集合，防止并发归档 */
    private archivingFiles: Set<string> = new Set();

    /** 归档防抖定时器 */
    private archiveTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(config?: Partial<MemorySystemConfig>, llmService?: LLMService) {
        super();

        this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };

        if (llmService) {
            this.llmService = llmService;
        }

        // 初始化组件
        const dbPath = path.join(this.config.memoryRoot, 'memory.db');
        this.db = new MemoryDatabase(dbPath);

        this.router = new MemoryRouter({
            db: this.db.getNativeDb(),
            strategy: this.config.isolationStrategy,
            memoryRoot: this.config.memoryRoot,
        });

        this.compactor = new MemoryCompactor(this.config.compaction, llmService || undefined);

        // 🔑 设置压缩完成回调
        this.compactor.setCompactionCallback(this.handleCompactionComplete.bind(this));

        this.initialized = true;

        console.log(`[MemoryManager] 初始化完成，记忆根目录: ${this.config.memoryRoot}`);
    }

    // ==================== LLM 服务 ====================

    /**
     * 设置 LLM 服务
     */
    setLLMService(service: LLMService): void {
        this.llmService = service;
        this.compactor.setLLMService(service);
    }

    // ==================== 压缩回调处理 ====================

    /**
     * 处理压缩完成事件
     *
     * 功能：
     * 1. 将摘要保存到 stage1_outputs 表
     * 2. 发出压缩完成事件
     * 3. 更新内存缓存
     *
     * 🔧 M-2 修复：参数字段名对齐 CompactionResult（compactedSize）
     * 🔧 新增：存储完整的 replacement_history
     */
    private async handleCompactionComplete(result: {
        threadId: string;
        summary: string;
        originalCount: number;
        preservedCount: number;
        originalSize: number;
        compactedSize: number;
        replacementHistory?: RolloutItem[];  // 🔧 新增
    }): Promise<void> {
        console.log(`[MemoryManager] 处理压缩完成: ${result.threadId}`);

        try {
            // 1. 获取空间信息
            const thread = this.db.getThread(result.threadId);
            if (!thread) {
                console.warn(`[MemoryManager] 未找到线程记录: ${result.threadId}`);
                return;
            }

            // 2. 保存完整 CompactedItem 到 stage1_outputs 表
            this.db.upsertStage1Output(thread.space_id, {
                threadId: result.threadId,
                sourceUpdatedAt: new Date(),
                rawMemory: result.summary,
                rolloutSummary: result.summary.slice(0, 500),
                usageCount: 0,
                // 🔧 新增：存储完整数据
                replacementHistory: result.replacementHistory,
                preservedCount: result.preservedCount,
                originalCount: result.originalCount,
            });

            console.log(`[MemoryManager] ✅ 完整 CompactedItem 已保存到数据库: ${result.threadId}`);

            // 3. 发出压缩完成事件
            // M-2: 使用 compactedSize（与 CompactionResult 一致）
            this.emitEvent('memory:compacted', thread.space_id, result.threadId, result.threadId, {
                originalCount: result.originalCount,
                preservedCount: result.preservedCount,
                originalSize: result.originalSize,
                newSize: result.compactedSize,
                compressionRatio: ((result.originalSize - result.compactedSize) / result.originalSize * 100).toFixed(1) + '%',
            });

        } catch (error) {
            console.error(`[MemoryManager] 处理压缩完成失败:`, error);
        }
    }

    // ==================== 记忆记录 ====================

    /**
     * 记录消息到 rollout
     * 
     * 🔧 M-5: 如果当前文件正在被压缩，跳过写入防止数据竞争
     */
    async recordMessage(
        agentId: string,
        agentType: AgentType,
        role: 'user' | 'assistant' | 'system',
        content: string
    ): Promise<void> {
        console.log(`[MemoryManager] recordMessage 被调用: agentId=${agentId}, agentType=${agentType}, role=${role}, contentLength=${content.length}`);

        // 🔍 调试日志：记录recordMessage调用
        logArchive({
            timestamp: new Date().toISOString(),
            threadId: agentId,
            action: 'check',
            details: {
                root: `recordMessage调用`,
                filePath: `agentType=${agentType}, role=${role}`,
                fileSize: content.length,
                thresholdMB: 0,
            }
        });

        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, threadId);

        // M-5: 检查文件是否正在被压缩
        if (this.compactingFiles.has(rolloutPath)) {
            console.warn(`[MemoryManager] 文件正在压缩中，跳过写入: ${agentId}`);
            return;
        }

        const item: RolloutItem = {
            type: 'message',
            timestamp: new Date().toISOString(),
            role,
            content: truncateWithTokenBudget(content, 8000),
            agentId,
            threadId,
        };

        // 确保目录存在
        const rolloutsDir = getRolloutsDir(space.fsPath);
        if (!fs.existsSync(rolloutsDir)) {
            fs.mkdirSync(rolloutsDir, { recursive: true });
        }

        // 追加写入
        fs.appendFileSync(rolloutPath, JSON.stringify(item) + '\n', 'utf-8');

        // 更新线程记录
        // 提取标题：用户消息的前 50 个字符
        const title = role === 'user' ? content.slice(0, 50) : undefined;
        this.db.upsertThread(threadId, space.spaceId, rolloutPath, agentId, title);

        // 🔧 自动归档：使用防抖+锁机制，避免重复触发和并发冲突
        this.triggerArchiveWithDebounce(threadId, space.fsPath, rolloutPath);

        // 发出事件
        this.emitEvent('memory:recorded', space.spaceId, agentId, agentId, { role, contentLength: content.length });
    }

    /**
     * 记录工具调用
     */
    async recordToolCall(
        agentId: string,
        agentType: AgentType,
        toolName: string,
        toolArgs: Record<string, unknown>
    ): Promise<void> {
        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, threadId);

        const item: RolloutItem = {
            type: 'tool_call',
            timestamp: new Date().toISOString(),
            agentId,
            toolName,
            toolArgs,
        };

        fs.appendFileSync(rolloutPath, JSON.stringify(item) + '\n', 'utf-8');
    }

    /**
     * 记录工具输出
     */
    async recordToolOutput(
        agentId: string,
        agentType: AgentType,
        toolName: string,
        toolResult: string
    ): Promise<void> {
        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, threadId);

        const item: RolloutItem = {
            type: 'tool_output',
            timestamp: new Date().toISOString(),
            agentId,
            toolName,
            toolResult: truncateWithTokenBudget(toolResult, 4000),
        };

        fs.appendFileSync(rolloutPath, JSON.stringify(item) + '\n', 'utf-8');
    }

    /**
     * 🔧 新增：记录结构化消息（支持工具调用和结果）
     * 用于保存完整的对话内容，包括工具调用过程
     */
    async recordStructuredMessage(
        agentId: string,
        agentType: AgentType,
        message: {
            role: 'user' | 'assistant' | 'system';
            content: string;
            turnId?: string;
            contentBlocks?: ContentBlock[];
        }
    ): Promise<void> {
        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, threadId);

        // M-5: 检查文件是否正在被压缩
        if (this.compactingFiles.has(rolloutPath)) {
            console.warn(`[MemoryManager] 文件正在压缩中，跳过写入: ${agentId}`);
            return;
        }

        // 确保目录存在
        const rolloutsDir = getRolloutsDir(space.fsPath);
        if (!fs.existsSync(rolloutsDir)) {
            fs.mkdirSync(rolloutsDir, { recursive: true });
        }

        // 拆分逻辑：assistant消息含tool_use contentBlocks时，拆为message + tool_call多条记录
        const hasToolUse = message.role === 'assistant'
            && message.contentBlocks
            && message.contentBlocks.some((b: any) => b.type === 'tool_use' || b.type === 'tool_call');

        if (hasToolUse && message.contentBlocks) {
            // 先写入纯文本preamble（如果有）
            const textBlocks = message.contentBlocks.filter((b: any) => b.type === 'text');
            const preamble = textBlocks.map((b: any) => b.text || '').join('');
            const combinedContent = preamble || message.content;
            if (combinedContent.trim()) {
                const msgItem: RolloutItem = {
                    type: 'message',
                    timestamp: new Date().toISOString(),
                    role: 'assistant',
                    content: truncateWithTokenBudget(combinedContent, 8000),
                    agentId,
                    turnId: message.turnId,
                };
                fs.appendFileSync(rolloutPath, JSON.stringify(msgItem) + '\n', 'utf-8');
            }

            // 每个tool_use拆为独立的tool_call记录
            const toolUseBlocks = message.contentBlocks.filter((b: any) => b.type === 'tool_use' || b.type === 'tool_call');
            for (const block of toolUseBlocks) {
                const tcItem: RolloutItem = {
                    type: 'tool_call',
                    timestamp: new Date().toISOString(),
                    agentId,
                    turnId: message.turnId,
                    toolName: (block as any).name || 'unknown',
                    toolArgs: (block as any).arguments || (block as any).args || {},
                };
                fs.appendFileSync(rolloutPath, JSON.stringify(tcItem) + '\n', 'utf-8');
            }
        } else {
            // 普通消息：直接写入
            const item: RolloutItem = {
                type: 'message',
                timestamp: new Date().toISOString(),
                role: message.role,
                content: truncateWithTokenBudget(message.content, 8000),
                agentId,
                turnId: message.turnId,
                contentBlocks: message.contentBlocks ? this.simplifyContentBlocks(message.contentBlocks) : undefined,
            };
            fs.appendFileSync(rolloutPath, JSON.stringify(item) + '\n', 'utf-8');
        }

        // 更新线程记录（提取标题）
        const title = message.role === 'user' ? message.content.slice(0, 50) : undefined;
        this.db.upsertThread(threadId, space.spaceId, rolloutPath, agentId, title);

        // 🔧 自动归档：使用防抖机制，避免短时间内重复触发
        this.scheduleArchiveCheck(threadId, space.fsPath, rolloutPath);

        // 发出事件
        this.emitEvent('memory:recorded', space.spaceId, agentId, agentId, {
            role: message.role,
            contentLength: message.content.length,
            hasToolContent: message.contentBlocks?.some((b: any) => b.type === 'tool_use' || b.type === 'tool_result')
        });
    }

    /**
     * 🔧 新增：记录运行时压缩结果
     * 用于 AhiveCoderExecutor 在动态压缩后持久化到 rollout 文件
     */
    async recordRuntimeCompaction(
        agentId: string,
        agentType: AgentType,
        compactedItem: {
            summary: string;
            replacementHistory: RolloutItem[];
            preservedCount: number;
            originalCount: number;
        }
    ): Promise<void> {
        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, threadId);

        // M-5: 检查文件是否正在被压缩
        if (this.compactingFiles.has(rolloutPath)) {
            console.warn(`[MemoryManager] 文件正在压缩中，跳过运行时压缩写入: ${agentId}`);
            return;
        }

        // 读取现有的保留消息（最近的）
        const existingItems = await this.getRecentRolloutItems(agentId, agentType, compactedItem.preservedCount);

        // 构建 CompactedItem
        const item: RolloutItem = {
            type: 'compacted',
            timestamp: new Date().toISOString(),
            summary: compactedItem.summary,
            replacement_history: compactedItem.replacementHistory,
            preservedCount: compactedItem.preservedCount,
            originalCount: compactedItem.originalCount,
        };

        // 🔧 核心修复：不再 writeFileSync 覆盖 rollout 文件！
        // 只追加 compacted 标记，保留完整原文
        fs.appendFileSync(rolloutPath, JSON.stringify(item) + '\n', 'utf-8');

        // 更新数据库
        this.db.upsertThread(threadId, space.spaceId, rolloutPath, agentId);

        // 保存到 stage1_outputs 表
        this.db.upsertStage1Output(space.spaceId, {
            threadId: threadId,
            sourceUpdatedAt: new Date(),
            rawMemory: compactedItem.summary,
            rolloutSummary: compactedItem.summary.slice(0, 500),
            usageCount: 0,
            replacementHistory: compactedItem.replacementHistory,
            preservedCount: compactedItem.preservedCount,
            originalCount: compactedItem.originalCount,
        });

        console.log(`[MemoryManager] ✅ 运行时压缩已持久化: ${agentId}`);

        // 发出事件
        this.emitEvent('memory:compacted', space.spaceId, agentId, agentId, {
            originalCount: compactedItem.originalCount,
            preservedCount: compactedItem.preservedCount,
            source: 'runtime',
        });
    }

    // ==================== 记忆获取 ====================

    /**
     * 获取智能体的记忆上下文
     */
    async getMemoryContext(
        agentId: string,
        agentType: AgentType,
        maxTokens: number = 8000
    ): Promise<string> {
        const space = this.router.getSpace(agentId, agentType);

        // 从数据库获取排序后的记忆
        const memories = this.db.getMemoriesForContext(
            space.spaceId,
            this.config.maxMemoriesForContext,
            this.config.cleanup.maxUnusedDays
        );

        if (memories.length === 0) {
            return '';
        }

        // 构建上下文
        const parts: string[] = ['## 历史记忆上下文\n'];
        let tokens = approxTokenCount(parts[0]);
        const usedThreadIds: string[] = [];

        for (const memory of memories) {
            const memoryText = this.formatMemoryForContext(memory);
            const memoryTokens = approxTokenCount(memoryText);

            // 检查是否超出预算
            if (tokens + memoryTokens > maxTokens * 0.7) {
                break;
            }

            parts.push(memoryText);
            tokens += memoryTokens;
            usedThreadIds.push(memory.thread_id);
        }

        // 更新使用统计
        if (usedThreadIds.length > 0) {
            this.db.touchMemories(usedThreadIds);
        }

        const context = parts.join('\n\n');

        // 发出事件
        this.emitEvent('memory:retrieved', space.spaceId, agentId, undefined, {
            memoryCount: usedThreadIds.length,
            tokens
        });

        return context;
    }

    /**
     * 获取最近的 rollout 记忆
     * 🔧 修复：检查并自动创建线程记录
     */
    async getRecentRolloutItems(
        agentId: string,
        agentType: AgentType,
        limit: number = 50,
        threadId?: string
    ): Promise<RolloutItem[]> {
        const space = this.router.getSpace(agentId, agentType);
        const tid = threadId || this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, tid);

        if (!fs.existsSync(rolloutPath)) {
            return [];
        }

        // 从文件末尾倒序读取
        const items = this.loadRolloutReverse(rolloutPath, limit);

        return items;
    }

    /**
     * 格式化记忆为上下文
     */
    private formatMemoryForContext(memory: Stage1OutputRecord): string {
        const date = new Date(memory.source_updated_at).toLocaleDateString();
        const summary = memory.rollout_summary || memory.raw_memory?.slice(0, 500) || '(无内容)';

        return `### ${date}\n${summary}`;
    }

    // ==================== 会话管理 ====================

    /**
     * 获取智能体的记忆文件路径
     */
    getRolloutPath(agentId: string, agentType: AgentType): string {
        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        return getRolloutFilePath(space.fsPath, threadId);
    }

    getThreadsByAgentId(agentId: string, limit: number = 100) {
        return this.db.getThreadsByAgentId(agentId, limit);
    }

    getActiveThreadId(agentId: string, agentType: AgentType): string {
        const cached = this.activeThreadIds.get(agentId);
        if (cached) return cached;

        const existing = this.db.getActiveThreadIdByAgentId(agentId);
        if (existing) {
            this.activeThreadIds.set(agentId, existing);
            return existing;
        }

        const space = this.router.getSpace(agentId, agentType);
        const newThreadId = crypto.randomUUID();
        const rolloutPath = getRolloutFilePath(space.fsPath, newThreadId);
        this.db.upsertThread(newThreadId, space.spaceId, rolloutPath, agentId);
        this.activeThreadIds.set(agentId, newThreadId);
        return newThreadId;
    }

    setActiveThreadId(agentId: string, threadId: string): void {
        this.activeThreadIds.set(agentId, threadId);
    }

    startNewSession(agentId: string, agentType: AgentType): string {
        const oldThreadId = this.activeThreadIds.get(agentId);
        if (oldThreadId) {
            this.db.archiveThread(oldThreadId);
            const space = this.router.getSpace(agentId, agentType);
            const oldRolloutPath = getRolloutFilePath(space.fsPath, oldThreadId);
            if (fs.existsSync(oldRolloutPath)) {
                const archivedDir = path.join(getRolloutsDir(space.fsPath), 'archived');
                if (!fs.existsSync(archivedDir)) {
                    fs.mkdirSync(archivedDir, { recursive: true });
                }
                const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
                const archivePath = path.join(archivedDir, `${oldThreadId}_${timestamp}.jsonl`);
                fs.renameSync(oldRolloutPath, archivePath);
                console.log(`[MemoryManager] 归档旧会话: ${oldThreadId} → ${archivePath}`);
            }
        }

        const newThreadId = crypto.randomUUID();
        const space = this.router.getSpace(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, newThreadId);
        this.db.upsertThread(newThreadId, space.spaceId, rolloutPath, agentId);
        this.activeThreadIds.set(agentId, newThreadId);
        console.log(`[MemoryManager] 新会话: agentId=${agentId}, threadId=${newThreadId}`);
        return newThreadId;
    }

    // ==================== Rollout 加载（内存优化） ====================

    /**
        * 从文件末尾反向加载 Rollout
        * 
        * 内存优化：
        * - 小文件（<1MB）：直接读取
        * - 大文件（>=1MB）：从末尾反向读取，避免加载整个文件
        */
    private loadRolloutReverse(rolloutPath: string, limit: number): RolloutItem[] {
        if (!fs.existsSync(rolloutPath)) {
            return [];
        }

        const stats = fs.statSync(rolloutPath);
        const fileSize = stats.size;

        // 小文件直接读取
        if (fileSize < 1024 * 1024) {
            const content = fs.readFileSync(rolloutPath, 'utf-8');
            return this.parseRolloutContent(content, limit);
        }

        // 大文件：从末尾反向读取
        return this.loadRolloutReverseLarge(rolloutPath, limit, fileSize);
    }

    /**
     * 解析 Rollout 内容
     * 
     * 🔑 修复：正确处理压缩后的历史
     * 
     * 参考 CODEX 的设计：
     * - 压缩后的文件只包含：[compacted项, 保留的最近消息]
     * - compacted 项的 replacement_history 只用于记录，不用于恢复上下文
     * - 恢复上下文时，应该使用 compacted 项的 summary + 保留的消息
     */
    private parseRolloutContent(content: string, limit: number): RolloutItem[] {
        const lines = content.split('\n').filter(line => line.trim());

        if (lines.length === 0) {
            return [];
        }

        // 解析所有消息
        const allItems: RolloutItem[] = [];
        for (const line of lines) {
            try {
                const item = JSON.parse(line) as RolloutItem;
                if (typeof item.timestamp === 'string') {
                    item.timestamp = new Date(item.timestamp);
                }
                allItems.push(item);
            } catch {
                // 跳过解析失败的行
            }
        }

        // 🔑 修复：查找 compacted 项，优先使用 replacement_history（对齐 CODEX 设计）
        for (let i = 0; i < allItems.length; i++) {
            const item = allItems[i];
            if (item.type === 'compacted') {
                const itemsAfterCompacted = allItems.slice(i + 1);

                // 如果有重注入历史，优先使用它
                if (item.replacement_history && item.replacement_history.length > 0) {
                    const result = [...item.replacement_history, ...itemsAfterCompacted];
                    console.log(`[MemoryManager] 使用 Compacted 重注入历史: 原始 ${item.originalCount} 条 → 压缩后 ${result.length} 条`);
                    return result.slice(-limit);
                }

                // 否则构建基础摘要消息
                const summaryMessage: RolloutItem = {
                    type: 'message',
                    timestamp: item.timestamp,
                    role: 'system',
                    content: `[历史对话摘要]\n${item.summary || '(无摘要)'}`,
                };

                const result = [summaryMessage, ...itemsAfterCompacted];
                console.log(`[MemoryManager] 使用基础压缩历史: 原始 ${item.originalCount} 条 → 压缩后 ${result.length} 条`);
                return result.slice(-limit);
            }
        }

        // 没有 CompactedItem，直接返回原始消息
        return allItems.slice(-limit);
    }

    /**
     * 大文件反向读取（内存优化）
     *
     * 🔧 修复记录:
     * - M-1: 使用 summary 而非 replacement_history（与 parseRolloutContent 一致）
     * - M-6: 修复反向读取后消息顺序错误
     * - M-7: 优先检查文件开头的 CompactedItem，避免遗漏
     */
    private loadRolloutReverseLarge(rolloutPath: string, limit: number, fileSize: number): RolloutItem[] {
        const CHUNK_SIZE = 64 * 1024;  // 64KB 块
        const fd = fs.openSync(rolloutPath, 'r');

        try {
            // 🔧 M-7: 先检查文件开头是否有 CompactedItem
            let compactedItem: RolloutItem | null = null;
            const headerBuffer = Buffer.allocUnsafe(8192);  // 8KB 头部
            fs.readSync(fd, headerBuffer, 0, 8192, 0);
            const headerContent = headerBuffer.toString('utf-8');
            const headerLines = headerContent.split('\n').filter(l => l.trim());

            for (const line of headerLines) {
                try {
                    const item = JSON.parse(line) as RolloutItem;
                    if (item.type === 'compacted') {
                        compactedItem = item;
                        console.log(`[MemoryManager] 大文件开头找到 CompactedItem`);
                        break;
                    }
                } catch {
                    // 跳过解析失败的行
                }
            }

            // 从末尾读取保留消息
            const lines: string[] = [];
            let position = fileSize;
            let remainingChunk = '';

            // 从末尾向前读取，直到获取足够的行
            while (position > 0 && lines.length < limit * 2) {
                const readSize = Math.min(CHUNK_SIZE, position);
                position -= readSize;

                const buffer = Buffer.allocUnsafe(readSize);
                fs.readSync(fd, buffer, 0, readSize, position);

                const chunk = buffer.toString('utf-8');
                const fullChunk = chunk + remainingChunk;

                const chunkLines = fullChunk.split('\n');
                // 第一行可能不完整，保留到下一次
                remainingChunk = chunkLines[0];

                // 添加完整的行（倒序）
                for (let i = chunkLines.length - 1; i >= 1; i--) {
                    if (chunkLines[i].trim()) {
                        lines.push(chunkLines[i]);
                    }
                }
            }

            // 处理最后一部分
            if (remainingChunk.trim()) {
                lines.push(remainingChunk);
            }

            // M-6: 反向读取的行是倒序的，需要翻转为正序
            lines.reverse();

            // 解析获取的行（排除 compacted 类型，因为已经单独处理）
            const itemsAfterCompacted: RolloutItem[] = [];
            for (const line of lines) {
                try {
                    const item = JSON.parse(line) as RolloutItem;
                    if (typeof item.timestamp === 'string') {
                        item.timestamp = new Date(item.timestamp);
                    }
                    // 跳过 compacted 类型（已从开头获取）
                    if (item.type !== 'compacted') {
                        itemsAfterCompacted.push(item);
                    }
                } catch {
                    // 跳过解析失败的行
                }
            }

            // 🔧 M-7: 如果开头找到了 CompactedItem，合并结果
            if (compactedItem) {
                if (compactedItem.replacement_history && compactedItem.replacement_history.length > 0) {
                    // 🔧 修复：replacement_history 是关键上下文，应该始终保留
                    // 只截断 itemsAfterCompacted 部分，确保关键历史不丢失
                    const preservedItems = itemsAfterCompacted.slice(-(limit - compactedItem.replacement_history.length));
                    const result = [...compactedItem.replacement_history, ...preservedItems];
                    console.log(`[MemoryManager] 大文件完整恢复（含 replacement_history）: replacement_history=${compactedItem.replacement_history.length}, 保留消息=${preservedItems.length}`);
                    return result;
                }

                const summaryMessage: RolloutItem = {
                    type: 'message',
                    timestamp: compactedItem.timestamp,
                    role: 'system',
                    content: `[历史对话摘要]\n${compactedItem.summary || '(无摘要)'}`,
                };

                const result = [summaryMessage, ...itemsAfterCompacted.slice(-(limit - 1))];
                console.log(`[MemoryManager] 大文件恢复（摘要模式）: ${result.length} 条`);
                return result;
            }

            // 没有找到 CompactedItem，检查是否在反向读取的内容中
            for (let i = 0; i < itemsAfterCompacted.length; i++) {
                const item = itemsAfterCompacted[i];
                if (item.type === 'compacted') {
                    const afterCompacted = itemsAfterCompacted.slice(i + 1);

                    if (item.replacement_history && item.replacement_history.length > 0) {
                        // 🔧 修复：replacement_history 始终保留
                        const preservedItems = afterCompacted.slice(-(limit - item.replacement_history.length));
                        const result = [...item.replacement_history, ...preservedItems];
                        console.log(`[MemoryManager] 大文件反向读取找到 CompactedItem: ${result.length} 条`);
                        return result;
                    }

                    const summaryMessage: RolloutItem = {
                        type: 'message',
                        timestamp: item.timestamp,
                        role: 'system',
                        content: `[历史对话摘要]\n${item.summary || '(无摘要)'}`,
                    };

                    const result = [summaryMessage, ...afterCompacted.slice(-(limit - 1))];
                    return result;
                }
            }

            return itemsAfterCompacted.slice(-limit);
        } finally {
            fs.closeSync(fd);
        }
    }

    // ==================== Phase 1 提取 ====================

    /**
     * 运行 Phase 1 提取
     */
    async runPhase1(spaceId: string): Promise<void> {
        console.log(`[MemoryManager] Phase 1 提取开始: ${spaceId}`);

        // 获取空间
        const spaces = this.router.getAllSpaces();
        const space = spaces.find(s => s.spaceId === spaceId);

        if (!space) {
            console.warn(`[MemoryManager] 空间不存在: ${spaceId}`);
            return;
        }

        // 获取所有 rollout 文件
        const rolloutsDir = getRolloutsDir(space.fsPath);

        if (!fs.existsSync(rolloutsDir)) {
            return;
        }

        const files = fs.readdirSync(rolloutsDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => ({
                name: f,
                path: path.join(rolloutsDir, f),
                mtime: fs.statSync(path.join(rolloutsDir, f)).mtime,
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        // 处理每个 rollout
        for (const file of files.slice(0, this.config.phases.phase1.maxClaimed)) {
            const threadId = file.name.replace('.jsonl', '');

            // 检查是否已处理
            const existing = this.db.getStage1Output(threadId);
            if (existing) {
                continue;
            }

            // 提取记忆
            const items = this.loadRolloutReverse(file.path, 100);
            if (items.length === 0) {
                continue;
            }

            // 生成简单摘要
            const summary = this.generateRolloutSummary(items);

            // 存储
            this.db.upsertStage1Output(spaceId, {
                threadId,
                sourceUpdatedAt: new Date(),
                rawMemory: summary,
                rolloutSummary: summary.slice(0, 500),
                usageCount: 0,
            });
        }

        console.log(`[MemoryManager] Phase 1 提取完成: ${spaceId}`);
    }

    /**
     * 生成 rollout 摘要
     */
    private generateRolloutSummary(items: RolloutItem[]): string {
        const messages = items.filter(i => i.type === 'message' && i.content);

        if (messages.length === 0) {
            return '(空会话)';
        }

        const userMessages = messages.filter(m => m.role === 'user');
        const assistantMessages = messages.filter(m => m.role === 'assistant');

        const lines = [
            `## 会话摘要`,
            `- 消息数: ${messages.length}`,
            `- 用户消息: ${userMessages.length}`,
            `- 助手回复: ${assistantMessages.length}`,
            ``,
            `### 最近对话`,
        ];

        // 添加最近几条消息
        for (const msg of messages.slice(-5)) {
            const preview = msg.content?.slice(0, 200) || '(空)';
            lines.push(`- ${msg.role}: ${preview}...`);
        }

        return lines.join('\n');
    }

    // ==================== 清理任务 ====================

    /**
     * 运行每日清理任务
     */
    async runDailyCleanup(): Promise<void> {
        console.log('[MemoryManager] 开始每日清理任务');

        const spaces = this.router.getAllSpaces();

        for (const space of spaces) {
            // 清理过期记忆
            const cleaned = this.db.cleanupStaleMemories(
                space.spaceId,
                this.config.cleanup.maxUnusedDays
            );

            if (cleaned > 0) {
                console.log(`[MemoryManager] 空间 ${space.spaceId} 清理了 ${cleaned} 条过期记忆`);
            }

            // 归档旧线程
            const archived = this.db.archiveOldThreads(
                space.spaceId,
                this.config.cleanup.archiveAge
            );

            if (archived > 0) {
                console.log(`[MemoryManager] 空间 ${space.spaceId} 归档了 ${archived} 条旧线程`);
            }
        }

        // 每周 VACUUM
        const today = new Date().getDay();
        if (today === this.config.cleanup.vacuumDay) {
            this.db.vacuum();
        }

        this.emitEvent('memory:cleaned', 'global', undefined, undefined, { spaces: spaces.length });

        console.log('[MemoryManager] 每日清理任务完成');
    }

    // ==================== Fork History (参考 CODEX) ====================

    /**
     * 获取智能体的 rollout 历史
     * 参考 CODEX: RolloutRecorder::get_rollout_history
     */
    async getRolloutHistory(agentId: string): Promise<RolloutItem[]> {
        const agentType = agentId.includes('-child-') ? 'ahive-coder' :
            (agentId.startsWith('ahive-worker') ? 'ahive-worker' : 'ahive-coder');
        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, threadId);

        if (!fs.existsSync(rolloutPath)) {
            console.log(`[MemoryManager] rollout 文件不存在: ${rolloutPath}`);
            return [];
        }

        try {
            const content = fs.readFileSync(rolloutPath, 'utf-8');
            const lines = content.trim().split('\n').filter(line => line.trim());

            const items: RolloutItem[] = [];
            for (const line of lines) {
                try {
                    const item = JSON.parse(line) as RolloutItem;
                    items.push(item);
                } catch (e) {
                    // 跳过解析失败的行
                }
            }

            console.log(`[MemoryManager] 读取 rollout 历史: ${items.length} 条`);
            return items;
        } catch (error) {
            console.error(`[MemoryManager] 读取 rollout 历史失败:`, error);
            return [];
        }
    }

    /**
     * 使用 forked 历史初始化智能体
     * 参考 CODEX: InitialHistory::Forked
     */
    async initWithForkedHistory(
        agentId: string,
        history: RolloutItem[],
        options: { source: string; parentAgentId: string }
    ): Promise<void> {
        if (!history || history.length === 0) {
            console.log(`[MemoryManager] 无 forked 历史需要初始化`);
            return;
        }

        const agentType = agentId.includes('-child-') ? 'ahive-coder' :
            (agentId.startsWith('ahive-worker') ? 'ahive-worker' : 'ahive-coder');
        const space = this.router.getSpace(agentId, agentType);
        const threadId = this.getActiveThreadId(agentId, agentType);
        const rolloutPath = getRolloutFilePath(space.fsPath, threadId);
        const rolloutsDir = getRolloutsDir(space.fsPath);

        // 确保目录存在
        if (!fs.existsSync(rolloutsDir)) {
            fs.mkdirSync(rolloutsDir, { recursive: true });
        }

        // 写入 forked 历史到新的 rollout 文件
        // 参考 CODEX: 将父级的历史复制到子分身的 rollout 文件
        const lines = history.map(item => JSON.stringify(item));
        fs.writeFileSync(rolloutPath, lines.join('\n') + '\n', 'utf-8');

        // 添加一个标记，表明这是 forked 历史
        const forkMarker: RolloutItem = {
            type: 'message',
            timestamp: new Date().toISOString(),
            role: 'system',
            content: `[Forked from ${options.parentAgentId}]`,
            agentId,
        };
        fs.appendFileSync(rolloutPath, JSON.stringify(forkMarker) + '\n', 'utf-8');

        console.log(`[MemoryManager] 已初始化 forked 历史: ${history.length} 条 (父级: ${options.parentAgentId})`);
    }

    // ==================== 统计 ====================

    /**
     * 获取空间统计
     */
    getSpaceStats(spaceId: string): ReturnType<MemoryDatabase['getSpaceStats']> {
        return this.db.getSpaceStats(spaceId);
    }

    /**
     * 获取所有统计
     */
    getAllStats(): Record<string, ReturnType<MemoryDatabase['getSpaceStats']>> {
        const spaces = this.router.getAllSpaces();
        const stats: Record<string, ReturnType<MemoryDatabase['getSpaceStats']>> = {};

        for (const space of spaces) {
            stats[space.spaceId] = this.db.getSpaceStats(space.spaceId);
        }

        return stats;
    }

    // ==================== 事件 ====================

    /**
     * 发出事件
     */
    private emitEvent(
        type: MemoryEvent['type'],
        spaceId: string,
        agentId?: string,
        threadId?: string,
        data?: unknown
    ): void {
        this.emit(type, {
            type,
            spaceId,
            agentId,
            threadId,
            data,
            timestamp: new Date(),
        } as MemoryEvent);
    }

    // ==================== 配置 ====================

    /**
     * 获取配置
     */
    getConfig(): MemorySystemConfig {
        return { ...this.config };
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<MemorySystemConfig>): void {
        this.config = { ...this.config, ...config };

        if (config.isolationStrategy) {
            this.router.setStrategy(config.isolationStrategy);
        }

        if (config.compaction) {
            this.compactor.updateConfig(config.compaction);
        }
    }

    // ==================== 生命周期 ====================

    /**
     * 关闭
     */
    close(): void {
        this.db.close();
        this.removeAllListeners();
        console.log('[MemoryManager] 已关闭');
    }

    /**
     * 获取数据库实例 (用于路由器)
     */
    getDatabase(): MemoryDatabase {
        return this.db;
    }

    /**
     * 获取压缩器实例
     */
    getCompactor(): MemoryCompactor {
        return this.compactor;
    }

    // ==================== 归档防抖与锁机制 ====================

    /**
     * 🔧 新增：触发归档（带防抖）
     * 用于 recordMessage
     */
    private triggerArchiveWithDebounce(threadId: string, fsPath: string, rolloutPath: string): void {
        // 清除旧的定时器
        const existingTimer = this.archiveTimers.get(rolloutPath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // 设置新定时器：5秒后执行归档检查
        const timer = setTimeout(() => {
            this.archiveTimers.delete(rolloutPath);
            this.performArchive(threadId, fsPath, rolloutPath);
        }, 5000);

        this.archiveTimers.set(rolloutPath, timer);
    }

    /**
     * 🔧 新增：调度归档检查（带防抖）
     * 用于 recordStructuredMessage
     */
    private simplifyContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
        return blocks.map(cb => {
            if (cb.type === 'tool_result') {
                const tr = cb as ToolResultBlock;
                const output = tr.tool_output;
                const outputLen = typeof output === 'string' ? output.length : JSON.stringify(output).length;
                if (outputLen > 2000) {
                    const preview = typeof output === 'string' ? output.slice(0, 500) : JSON.stringify(output).slice(0, 500);
                    return {
                        type: 'tool_result' as const,
                        tool_use_id: tr.tool_use_id,
                        tool_name: tr.tool_name,
                        tool_output: `${preview}\n... [truncated, total=${outputLen} chars]`,
                        is_error: tr.is_error,
                    } as ToolResultBlock;
                }
            }
            return cb;
        });
    }

    private scheduleArchiveCheck(threadId: string, fsPath: string, rolloutPath: string): void {
        // 清除旧的定时器
        const existingTimer = this.archiveTimers.get(rolloutPath);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // 设置新定时器：5秒后执行归档检查 + 压缩检查
        const timer = setTimeout(() => {
            this.archiveTimers.delete(rolloutPath);
            this.performArchive(threadId, fsPath, rolloutPath);
            this.triggerCompactionIfNeeded(threadId, fsPath, rolloutPath).catch(() => {});
        }, 5000);

        this.archiveTimers.set(rolloutPath, timer);
    }

    private async triggerCompactionIfNeeded(threadId: string, fsPath: string, rolloutPath: string): Promise<void> {
        if (!this.compactor) return;
        try {
            const stats = this.getRolloutStats(rolloutPath);
            if (stats && this.compactor.needsCompaction(stats, threadId)) {
                console.log(`[MemoryManager] 触发后台压缩: ${threadId} (${stats.estimatedTokens || 0} tokens, ${stats.messageCount} messages)`);
                await this.compactor.compact(rolloutPath, threadId, fsPath);
            }
        } catch (err) {
            console.warn('[MemoryManager] 后台压缩失败:', err);
        }
    }

    private getRolloutStats(rolloutPath: string): RolloutStats | null {
        try {
            if (!fs.existsSync(rolloutPath)) return null;
            const content = fs.readFileSync(rolloutPath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            let messageCount = 0;
            let totalChars = 0;
            for (const line of lines) {
                try {
                    const item = JSON.parse(line);
                    if (item.type === 'compacted') {
                        messageCount++;
                        continue;
                    }
                    messageCount++;
                    if (item.content) totalChars += item.content.length;
                    for (const cb of (item.contentBlocks || [])) {
                        if (cb.type === 'text') totalChars += (cb.text || '').length;
                        else if (cb.type === 'tool_use') totalChars += JSON.stringify(cb.tool_input || {}).length;
                        else if (cb.type === 'tool_result') totalChars += (typeof cb.tool_output === 'string' ? cb.tool_output.length : JSON.stringify(cb.tool_output || {}).length);
                    }
                } catch {}
            }
            return { estimatedTokens: Math.ceil(totalChars / 2.5), messageCount, toolCallCount: 0, compactedCount: 0, totalSize: totalChars, oldestTimestamp: new Date(), newestTimestamp: new Date() };
        } catch {
            return null;
        }
    }

    /**
     * 🔧 新增：执行归档（带锁）
     */
    private async performArchive(threadId: string, fsPath: string, rolloutPath: string): Promise<void> {
        // 检查是否正在归档
        if (this.archivingFiles.has(rolloutPath)) {
            return;
        }

        // 检查文件大小（快速检查，避免不必要的异步操作）
        try {
            if (!fs.existsSync(rolloutPath)) return;
            const stats = fs.statSync(rolloutPath);
            if (stats.size < 1 * 1024 * 1024) return; // 1MB threshold
        } catch {
            return;
        }

        // 加锁
        this.archivingFiles.add(rolloutPath);

        try {
            const result = await archiveOldRolloutContent(fsPath, threadId, 100);
            if (result.archived) {
                console.log(`[MemoryManager] 归档完成: threadId=${threadId}, archivedLines=${result.archivedLines}`);
            }
        } catch (err) {
            console.error(`[MemoryManager] 归档失败: threadId=${threadId}, error=${err}`);
        } finally {
            // 解锁
            this.archivingFiles.delete(rolloutPath);
        }
    }
}