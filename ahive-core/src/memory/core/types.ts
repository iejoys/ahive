/**
 * AHIVECORE 记忆系统核心类型定义
 * 
 * 支持 SQLite + Compaction 混合架构
 */

// ==================== 多层压缩类型（按轮次） ====================

/** 内容块类型 */
export type ContentBlockType = 'text' | 'tool_use' | 'tool_result';

/** 内容块 - 文本 */
export interface TextBlock {
    type: 'text';
    text: string;
}

/** 内容块 - 工具调用 */
export interface ToolUseBlock {
    type: 'tool_use';
    tool_use_id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
}

/** 内容块 - 工具结果 */
export interface ToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    tool_name: string;
    tool_output: string;
    is_error?: boolean;
}

/** 统一内容块 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** 带 turnId 的消息结构 */
export interface MessageWithTurn {
    role: 'user' | 'assistant' | 'system';
    content: ContentBlock[];
    turnId: string;
    timestamp?: Date | string;
}

/** 对话轮次 */
export interface DialogTurn {
    turnId: string;
    timestamp: Date | string;
    userMessage?: string;
    assistantBlocks: Array<{
        type: 'text' | 'tool_use';
        content: string;
        toolName?: string;
        toolArgs?: Record<string, unknown>;
        toolUseId?: string;
    }>;
    toolResults: Array<{
        toolUseId: string;
        toolName: string;
        content: string;
        isError?: boolean;
    }>;
}

/** 需要处理的特定工具集合 */
export const COMPACTABLE_TOOLS = new Set([
    'read_file',    // 文件内容，可能很长
    'exec',         // 命令输出，可能很长
    'grep',         // 搜索结果，可能很多
    'glob',         // 文件匹配结果
    'web_search',   // 网页搜索结果
    'web_fetch',    // 网页内容
]);

/** 三层压缩常量 */
export const LAYER1_TURN_COUNT = 5;    // 最近5轮对话（完整保留）
export const LAYER2_TURN_COUNT = 15;   // 第6-20轮对话（占位符替换）
export const LAYER_TOKEN_LIMIT = 50000;  // 每层50K tokens上限

// ==================== 隔离策略 ====================

/** 记忆隔离策略 */
export type IsolationStrategy = 'global' | 'type' | 'agent' | 'hybrid';

/** 智能体类型 */
export type AgentType = 'ahive-worker' | 'ahive-coder' | 'core';

// ==================== 记忆空间 ====================

/** 记忆空间 */
export interface MemorySpace {
    spaceId: string;
    spaceType: IsolationStrategy;
    agentType?: AgentType;
    agentId?: string;
    fsPath: string;
}

// ==================== 数据库模型 ====================

/** 记忆空间记录 */
export interface MemorySpaceRecord {
    space_id: string;
    space_type: IsolationStrategy;
    agent_type: string | null;
    agent_id: string | null;
    created_at: number;
    updated_at: number;
}

/** Stage1 输出记录 */
export interface Stage1OutputRecord {
    thread_id: string;
    space_id: string;
    source_updated_at: number;
    raw_memory: string | null;
    rollout_summary: string | null;
    rollout_slug: string | null;
    generated_at: number;
    usage_count: number;
    last_usage: number | null;
    selected_for_phase2: number;
    // 🔧 新增：CompactedItem 完整数据
    replacement_history: string | null;  // JSON 序列化的 replacement_history
    preserved_count: number | null;
    original_count: number | null;
}

/** 线程记录 */
export interface ThreadRecord {
    thread_id: string;
    space_id: string;
    agent_id: string | null;
    rollout_path: string;
    created_at: number;
    updated_at: number;
    title: string | null;
    message_count: number;
    archived: number;
}

/** 任务记录 */
export interface MemoryJobRecord {
    job_id: string;
    job_type: 'phase1' | 'phase2' | 'compaction';
    space_id: string | null;
    status: 'pending' | 'running' | 'done' | 'error';
    worker_id: string | null;
    ownership_token: string | null;
    started_at: number | null;
    finished_at: number | null;
    lease_until: number | null;
    retry_count: number;
    last_error: string | null;
}

// ==================== 应用层模型 ====================

/** Stage1 输出 */
export interface Stage1Output {
    threadId: string;
    spaceId: string;
    sourceUpdatedAt: Date;
    rawMemory: string;
    rolloutSummary: string;
    rolloutSlug?: string;
    usageCount: number;
    lastUsage?: Date;
    // 🔧 新增：CompactedItem 完整数据
    replacementHistory?: RolloutItem[];
    preservedCount?: number;
    originalCount?: number;
}

/** Rollout 消息项 */
export interface RolloutItem {
    type: 'message' | 'tool_call' | 'tool_output' | 'compacted';
    timestamp: Date | string;
    role?: 'user' | 'assistant' | 'system';
    content?: string;
    agentId?: string;
    threadId?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
    // 🔧 新增：轮次标识和结构化内容
    turnId?: string;                       // 轮次标识（用于按轮分组）
    contentBlocks?: ContentBlock[];        // 结构化内容块
    // compacted 类型专用字段
    summary?: string;                    // LLM 生成的摘要
    replacement_history?: RolloutItem[]; // 压缩后的历史（关键：用于恢复上下文）
    preservedCount?: number;             // 保留的消息数
    originalCount?: number;              // 原始消息总数
}

/** Rollout 统计 */
export interface RolloutStats {
    messageCount: number;
    toolCallCount: number;
    compactedCount: number;
    totalSize: number;           // 字符数
    estimatedTokens: number;     // 估算的 token 数（考虑中文字符）
    oldestTimestamp: Date | null;
    newestTimestamp: Date | null;
}

// ==================== 配置 ====================

// ==================== 截断策略 ====================

/** 截断策略（参考 CODEX）— M-8: 主定义在 utils.ts 中，此处保留向后兼容的类型别名 */
export type { TruncationPolicy } from './utils.js';

/** 截断配置 */
export interface TruncationConfig {
    /** 命令输出最大字节数（默认 1MB） */
    execOutputMaxBytes: number;
    /** 默认输出 token 限制（默认 10000） */
    defaultMaxOutputTokens: number;
    /** 工具输出 token 限制（可配置） */
    toolOutputTokenLimit?: number;
}

/** 默认截断配置（参考 CODEX） */
export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
    execOutputMaxBytes: 1024 * 1024,    // 1 MB
    defaultMaxOutputTokens: 10000,      // 10K tokens
};

/** Compaction 配置 */
export interface CompactionConfig {
    triggerThreshold: number;      // 触发阈值 (消息数，作为备用)
    preserveRecent: number;        // 保留最近N条
    summaryMaxTokens: number;      // 摘要最大 token 数
    contextWindow?: number;        // 模型上下文窗口大小（默认 200000 = 200K）
    compactRatio: number;          // 压缩触发比例（默认 0.9 = 90%）
}

/** Phase 配置 */
export interface PhaseConfig {
    phase1: {
        scanLimit: number;
        maxClaimed: number;
        minIdleHours: number;
    };
    phase2: {
        maxRawMemories: number;
        consolidationIntervalMs: number;
    };
}

/** 清理配置 */
export interface CleanupConfig {
    maxUnusedDays: number;
    archiveAge: number;
    deleteAge: number;
    vacuumDay: number;  // 0-6, 0 = Sunday
}

/** 记忆系统配置 */
export interface MemorySystemConfig {
    memoryRoot: string;
    isolationStrategy: IsolationStrategy;
    maxMemoriesForContext: number;
    compaction: CompactionConfig;
    phases: PhaseConfig;
    cleanup: CleanupConfig;
}

/** 默认配置 */
export const DEFAULT_MEMORY_CONFIG: MemorySystemConfig = {
    memoryRoot: './data/memories',
    isolationStrategy: 'type',
    maxMemoriesForContext: 256,
    compaction: {
        triggerThreshold: 500,        // 2026-03-26 从 100 提高到 500
        preserveRecent: 20,
        summaryMaxTokens: 4000,
        contextWindow: 200000,     // 默认 200K
        compactRatio: 0.9,         // 90% 触发
    },
    phases: {
        phase1: {
            scanLimit: 5000,
            maxClaimed: 8,
            minIdleHours: 6,
        },
        phase2: {
            maxRawMemories: 256,
            consolidationIntervalMs: 24 * 60 * 60 * 1000, // 1 day
        },
    },
    cleanup: {
        maxUnusedDays: 30,
        archiveAge: 90,
        deleteAge: 365,
        vacuumDay: 0,
    },
};

// ==================== LLM 服务接口 ====================

/** LLM 服务接口 (用于 Compaction 摘要生成) */
export interface LLMService {
    chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, config?: unknown): Promise<{
        content: string;
        toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        finishReason?: string;
    }>;
}

// ==================== 事件类型 ====================

/** 记忆系统事件 */
export interface MemoryEvent {
    type: 'memory:recorded' | 'memory:retrieved' | 'memory:compacted' | 'memory:cleaned';
    spaceId: string;
    agentId?: string;
    threadId?: string;
    data?: unknown;
    timestamp: Date;
}