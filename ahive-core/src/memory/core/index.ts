/**
 * AHIVECORE 记忆系统核心模块
 * 
 * SQLite + Compaction 混合架构
 */

// 核心组件
export { MemoryDatabase } from './MemoryDatabase.js';
export { MemoryRouter } from './MemoryRouter.js';
export { MemoryManager } from './MemoryManager.js';
export { MemoryCompactor } from './MemoryCompactor.js';

// 类型和配置
export type {
    IsolationStrategy,
    AgentType,
    MemorySpace,
    MemorySpaceRecord,
    Stage1OutputRecord,
    ThreadRecord,
    MemoryJobRecord,
    Stage1Output,
    RolloutItem,
    RolloutStats,
    CompactionConfig,
    PhaseConfig,
    CleanupConfig,
    MemorySystemConfig,
    LLMService,
    MemoryEvent,
    // 新增：多层压缩类型
    ContentBlockType,
    ContentBlock,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    MessageWithTurn,
    DialogTurn,
} from './types.js';

export {
    DEFAULT_MEMORY_CONFIG,
    // 新增：多层压缩常量
    COMPACTABLE_TOOLS,
    LAYER1_TURN_COUNT,
    LAYER2_TURN_COUNT,
    LAYER_TOKEN_LIMIT,
} from './types.js';

// 工具函数
export {
    approxTokenCount,
    approxBytesForTokens,
    truncateWithTokenBudget,
    truncateWithByteBudget,
    truncateText,
    formatDateForFilename,
    generateShortHash,
    generateRolloutSummaryFilename,
    getSpaceDir,
    getRolloutsDir,
    getRolloutSummariesDir,
    getMemoryFilePath,
    getRolloutFilePath,
    isStale,
    daysToMs,
    hoursToMs,
} from './utils.js';

// 便捷创建函数
import { MemoryManager } from './MemoryManager.js';
import type { MemorySystemConfig, LLMService } from './types.js';
import { DEFAULT_MEMORY_CONFIG } from './types.js';

/**
 * 创建记忆管理器
 */
export function createMemoryManager(
    config?: Partial<MemorySystemConfig>,
    llmService?: LLMService
): MemoryManager {
    return new MemoryManager(config, llmService);
}