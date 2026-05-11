/**
 * AHIVECORE 新记忆系统集成适配器
 * 
 * 提供与现有 codex-integration.ts 兼容的接口
 * 内部使用新的 MemoryManager (SQLite + Compaction)
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { MemoryManager, createMemoryManager } from './core/index.js';
import type { MemorySystemConfig, AgentType, LLMService } from './core/types.js';
import { DEFAULT_MEMORY_CONFIG } from './core/types.js';

// ES Module 兼容的 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 导出类型别名以兼容旧代码
export type MemoryAgentType = AgentType;

/** 全局 MemoryManager 实例 */
let memoryManagerInstance: MemoryManager | null = null;

/** 配置 */
let config: Partial<MemorySystemConfig> = {
    memoryRoot: './data/memories',
    isolationStrategy: 'type',
};

/**
 * 初始化新记忆系统
 */
export async function initializeNewMemorySystem(
    memoryRoot?: string,
    llmService?: LLMService
): Promise<MemoryManager> {
    if (memoryRoot) {
        config.memoryRoot = memoryRoot;
    }
    
    if (!memoryManagerInstance) {
        // 尝试加载配置文件
        try {
            const configPath = path.join(__dirname, '..', 'config', 'memory.json');
            const fs = await import('fs');
            if (fs.existsSync(configPath)) {
                const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                config = { ...config, ...fileConfig };
            }
        } catch (e) {
            // 使用默认配置
        }
        
        memoryManagerInstance = createMemoryManager(config, llmService);
        
        console.log(`[NewMemory] ✅ 新记忆系统初始化完成`);
        console.log(`[NewMemory] - 记忆根目录: ${config.memoryRoot}`);
        console.log(`[NewMemory] - 隔离策略: ${config.isolationStrategy}`);
    }
    
    return memoryManagerInstance;
}

/**
 * 获取 MemoryManager 实例
 */
export function getMemoryManager(): MemoryManager | null {
    return memoryManagerInstance;
}

/**
 * 设置 LLM 服务（用于摘要生成）
 */
export function setMemoryLLMService(service: LLMService): void {
    if (memoryManagerInstance) {
        memoryManagerInstance.setLLMService(service);
    }
}

// ==================== 兼容接口 ====================

/**
 * 记录消息（兼容 codex-integration.recordCodexMessage）
 */
export async function recordNewMemoryMessage(
    agentId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
): Promise<void> {
    if (!memoryManagerInstance) {
        await initializeNewMemorySystem();
    }
    
    if (!memoryManagerInstance) {
        console.warn('[NewMemory] 记忆系统未初始化，跳过记录');
        return;
    }
    
    // 确定智能体类型（默认 ahive-worker）
    const agentType: AgentType = 'ahive-worker'; // 可以从外部传入或通过其他方式确定
    
    await memoryManagerInstance.recordMessage(agentId, agentType, role, content);
}

/**
 * 获取记忆上下文（兼容 codex-integration.getMemoryForContext）
 */
export async function getNewMemoryContext(
    maxTokens: number = 8000
): Promise<string> {
    if (!memoryManagerInstance) {
        return '';
    }
    
    // 使用默认智能体获取记忆
    const agentId = 'default';
    const agentType: AgentType = 'ahive-worker';
    
    return memoryManagerInstance.getMemoryContext(agentId, agentType, maxTokens);
}

/**
 * 获取最近的 rollout 记忆
 */
export async function getNewRecentRolloutItems(
    limit: number = 50
): Promise<any[]> {
    if (!memoryManagerInstance) {
        return [];
    }
    
    const agentId = 'default';
    const agentType: AgentType = 'ahive-worker';
    
    return memoryManagerInstance.getRecentRolloutItems(agentId, agentType, limit);
}

// ==================== 智能体类型感知接口 ====================

/**
 * 记录智能体消息（带类型感知）
 */
export async function recordAgentMessage(
    agentId: string,
    agentType: AgentType,
    role: 'user' | 'assistant' | 'system',
    content: string
): Promise<void> {
    if (!memoryManagerInstance) {
        await initializeNewMemorySystem();
    }
    
    if (!memoryManagerInstance) {
        return;
    }
    
    await memoryManagerInstance.recordMessage(agentId, agentType, role, content);
}

/**
 * 获取智能体记忆上下文（带类型感知）
 */
export async function getAgentMemoryContext(
    agentId: string,
    agentType: AgentType,
    maxTokens: number = 8000
): Promise<string> {
    if (!memoryManagerInstance) {
        return '';
    }
    
    return memoryManagerInstance.getMemoryContext(agentId, agentType, maxTokens);
}

// ==================== 维护接口 ====================

/**
 * 运行每日清理
 */
export async function runMemoryCleanup(): Promise<void> {
    if (!memoryManagerInstance) {
        return;
    }
    
    await memoryManagerInstance.runDailyCleanup();
}

/**
 * 获取记忆统计
 */
export function getMemoryStats(): Record<string, any> {
    if (!memoryManagerInstance) {
        return {};
    }
    
    return memoryManagerInstance.getAllStats();
}

/**
 * 关闭记忆系统
 */
export function closeNewMemorySystem(): void {
    if (memoryManagerInstance) {
        memoryManagerInstance.close();
        memoryManagerInstance = null;
    }
}

// ==================== 配置接口 ====================

/**
 * 更新记忆配置
 */
export function updateMemoryConfig(newConfig: Partial<MemorySystemConfig>): void {
    config = { ...config, ...newConfig };
    
    if (memoryManagerInstance) {
        memoryManagerInstance.updateConfig(newConfig);
    }
}

/**
 * 获取当前配置
 */
export function getMemoryConfig(): Partial<MemorySystemConfig> {
    return { ...config };
}