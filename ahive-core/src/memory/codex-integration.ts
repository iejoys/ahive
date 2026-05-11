import { CodexMemorySystem, createCodexMemorySystem, type LLMService, type AgentService, type MemoryConfig } from './codex-memory/index.js';
import type { RolloutItem, Stage1Output } from './codex-memory/types.js';
import { 
  loadRolloutReverse, 
  getRolloutsDir, 
  getRolloutFilePath,
  getRolloutStats,
  ensureLayout,
  rolloutSummaryFileStemFromParts,
  getRolloutSummariesDir,
  getMemoryFile,
  getMemorySummaryFile,
  saveMemory,
  saveMemorySummary,
} from './codex-memory/storage.js';
import { Phase1Extractor, getPendingRollouts, type LLMService as Phase1LLMService } from './codex-memory/phase1.js';
import { Phase2Consolidator, type LLMServiceForPhase2 } from './codex-memory/phase2.js';
import { logger } from '../utils/index.js';
import path from 'path';
import fs from 'fs';

let codexMemoryInstance: CodexMemorySystem | null = null;
let recentRolloutItems: RolloutItem[] = [];  // 缓存最近的 rollout 记忆
let llmServiceInstance: LLMService | null = null;  // LLM 服务实例

/**
 * 加载选项
 */
export interface LoadMemoryOptions {
  agentId?: string;
  agentType?: string;
  limit?: number;
}

/**
 * 加载指定智能体的 rollout 记忆
 * 每个 agent 只加载自己的记忆文件，不混合其他智能体
 * 
 * @param memoryRoot 记忆根目录
 * @param options 加载选项
 */
export async function loadRecentRolloutMemory(
  memoryRoot: string,
  options: LoadMemoryOptions = {}
): Promise<RolloutItem[]> {
  const { agentId, agentType, limit = 100 } = options;
  const items: RolloutItem[] = [];
  
  // 1. 从 spaces/{agentType}/rollouts/{agentId}.jsonl 加载
  if (agentId && agentType) {
    const spacesDir = path.join(memoryRoot, 'spaces');
    const rolloutFile = path.join(spacesDir, agentType, 'rollouts', `${agentId}.jsonl`);
    
    if (fs.existsSync(rolloutFile)) {
      logger.info(`[Memory] 加载智能体记忆: ${agentType}/${agentId}`);
      return loadRolloutFile(rolloutFile, agentType, limit);
    }
  }
  
  // 2. 如果指定了 agentType 但没指定 agentId，加载该类型最新的文件
  if (agentType && !agentId) {
    const spacesDir = path.join(memoryRoot, 'spaces');
    const rolloutsDir = path.join(spacesDir, agentType, 'rollouts');
    
    if (fs.existsSync(rolloutsDir)) {
      const files = fs.readdirSync(rolloutsDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          path: path.join(rolloutsDir, f),
          mtime: fs.statSync(path.join(rolloutsDir, f)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      if (files.length > 0) {
        logger.info(`[Memory] 加载最新记忆: ${agentType}/${files[0].name}`);
        return loadRolloutFile(files[0].path, agentType, limit);
      }
    }
  }
  
  // 3. 兼容旧系统：从旧目录加载
  const oldRolloutsDir = getRolloutsDir(memoryRoot);
  
  if (fs.existsSync(oldRolloutsDir)) {
    const files = fs.readdirSync(oldRolloutsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(oldRolloutsDir, f),
        mtime: fs.statSync(path.join(oldRolloutsDir, f)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    
    for (const file of files) {
      if (items.length >= limit) break;
      
      try {
        const fileItems = loadRolloutFile(file.path, 'legacy', limit - items.length);
        for (const item of fileItems) {
          (item as any)._fromOldSystem = true;
          items.push(item);
        }
      } catch (error) {
        logger.warn(`[Memory] 读取旧 rollout 文件失败: ${file.name}`);
      }
    }
    
    if (items.length > 0) {
      logger.info(`[Memory] ✅ 从旧目录加载了 ${items.length} 条历史记忆`);
    }
  }
  
  return items;
}

/**
 * 加载单个 rollout 文件
 */
function loadRolloutFile(filePath: string, spaceType: string, limit: number): RolloutItem[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  
  if (lines.length === 0) return [];
  
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
  
  // 🔑 关键：倒序查找最新的 CompactedItem
  for (let i = allItems.length - 1; i >= 0; i--) {
    const item = allItems[i];
    if (item.type === 'compacted' && item.replacement_history) {
      // 找到了！使用 replacement_history + 之后的新消息
      const itemsAfterCompacted = allItems.slice(i + 1);
      const result = [...item.replacement_history, ...itemsAfterCompacted];
      
      logger.info(`[Memory] 使用 Compacted 历史: ${item.originalCount} → ${result.length} 条`);
      
      return result.slice(-limit).map(item => {
        (item as any)._spaceType = spaceType;
        return item;
      });
    }
  }
  
  // 没有 CompactedItem，使用原始消息
  return allItems.slice(-limit).map(item => {
    (item as any)._spaceType = spaceType;
    return item;
  });
}

/**
 * 获取缓存的历史记忆
 */
export function getRecentRolloutItems(): RolloutItem[] {
  return recentRolloutItems;
}

/**
 * 格式化历史记忆为上下文字符串
 */
export function formatRolloutItemsAsContext(items: RolloutItem[], maxChars: number = 10000): string {
  if (items.length === 0) return '';
  
  const lines: string[] = ['## 最近对话历史（从最新到最旧）\n'];
  let totalChars = 0;
  
  for (const item of items) {
    const line = `**${item.role}**: ${item.content?.slice(0, 500) || ''}\n`;
    if (totalChars + line.length > maxChars) break;
    lines.push(line);
    totalChars += line.length;
  }
  
  return lines.join('');
}

export async function initializeCodexMemory(config?: Partial<MemoryConfig>): Promise<CodexMemorySystem> {
  const memoryRoot = config?.memoryRoot || './data/memories';
  
  if (!codexMemoryInstance) {
    codexMemoryInstance = createCodexMemorySystem({
      config: {
        memoryRoot,
        generateMemories: true,
        useMemories: true,
        maxRolloutsPerStartup: 16,
        minRolloutIdleHours: 0.5,  // 30 分钟空闲后提取
        ...config
      }
    });
    
    // 初始化目录结构
    await ensureLayout(memoryRoot);
    
    // 🔑 关键修复：初始化时加载历史记忆
    try {
      recentRolloutItems = await loadRecentRolloutMemory(memoryRoot, { limit: 100 });
      if (recentRolloutItems.length > 0) {
        logger.info(`[Memory] 🧠 历史记忆已加载: ${recentRolloutItems.length} 条`);
      }
    } catch (error) {
      logger.warn('[Memory] 加载历史记忆失败:', error);
    }
  }
  return codexMemoryInstance;
}

export function getCodexMemory(): CodexMemorySystem | null {
  return codexMemoryInstance;
}

export function setCodexMemoryLLMService(service: LLMService): void {
  llmServiceInstance = service;
  if (codexMemoryInstance) {
    codexMemoryInstance.setLLMService(service);
  }
}

export function setCodexMemoryAgentService(service: AgentService): void {
  if (codexMemoryInstance) {
    codexMemoryInstance.setAgentService(service);
  }
}

export async function recordCodexMessage(
  threadId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<void> {
  if (codexMemoryInstance) {
    await codexMemoryInstance.recordMessage(threadId, role, content);
    
    // 同时更新缓存
    const item: RolloutItem = {
      role,
      content,
      timestamp: new Date()
    };
    recentRolloutItems.unshift(item);
    // 保持缓存大小
    if (recentRolloutItems.length > 100) {
      recentRolloutItems = recentRolloutItems.slice(0, 100);
    }
  }
}

export async function recordCodexToolCall(
  threadId: string,
  toolCall: { id: string; name: string; arguments: Record<string, unknown> }
): Promise<void> {
  if (codexMemoryInstance) {
    await codexMemoryInstance.recordToolCall(threadId, toolCall);
  }
}

export async function recordCodexToolOutput(
  threadId: string,
  output: { toolCallId: string; output: string; isError?: boolean }
): Promise<void> {
  if (codexMemoryInstance) {
    await codexMemoryInstance.recordToolOutput(threadId, output);
  }
}

/**
 * 运行记忆管道
 * Phase 1: 从 rollouts 提取记忆
 * Phase 2: 整合记忆到 MEMORY.md
 */
export async function runCodexMemoryPipeline(): Promise<void> {
  if (!codexMemoryInstance) {
    logger.warn('[Memory] 记忆系统未初始化');
    return;
  }
  
  const config = codexMemoryInstance.getConfig();
  const memoryRoot = config.memoryRoot;
  
  logger.info('[Memory] 🚀 开始运行记忆管道...');
  
  try {
    // Phase 1: 提取记忆
    if (!llmServiceInstance) {
      logger.warn('[Memory] 没有 LLM 服务，跳过 Phase 1 提取');
      return;
    }
    
    // 获取待处理的 rollouts
    const pendingRollouts = getPendingRollouts(memoryRoot, config);
    
    if (pendingRollouts.length === 0) {
      logger.info('[Memory] 没有待处理的 rollouts');
      return;
    }
    
    logger.info(`[Memory] 发现 ${pendingRollouts.length} 个待处理的 rollouts`);
    
    // 创建 Phase 1 提取器
    const extractor = new Phase1Extractor({
      llmService: llmServiceInstance as Phase1LLMService,
      tokenLimit: 150000
    });
    
    // 提取记忆
    const results = await extractor.extractFromRollouts(pendingRollouts, config);
    
    const succeeded = results.filter(r => r.outcome === 'succeeded_with_output');
    logger.info(`[Memory] Phase 1 完成: ${succeeded.length}/${results.length} 成功提取`);
    
    if (succeeded.length === 0) {
      logger.info('[Memory] 没有成功提取的记忆，跳过 Phase 2');
      return;
    }
    
    // Phase 2: 整合记忆
    const memories: Stage1Output[] = succeeded
      .map(r => r.output)
      .filter((m): m is Stage1Output => m !== undefined);
    
    const consolidator = new Phase2Consolidator({
      llmService: llmServiceInstance as LLMServiceForPhase2,
      consolidationModel: config.consolidationModel
    });
    
    const success = await consolidator.consolidate(memories, config);
    
    if (success) {
      logger.info('[Memory] ✅ 记忆管道完成');
    } else {
      logger.warn('[Memory] Phase 2 整合失败');
    }
    
  } catch (error) {
    logger.error('[Memory] 记忆管道错误:', error);
  }
}

export async function getCodexMemoryContext(tokenLimit?: number): Promise<string | null> {
  // 优先使用缓存的最近记忆
  if (recentRolloutItems.length > 0) {
    return formatRolloutItemsAsContext(recentRolloutItems, (tokenLimit || 5000) * 4);
  }
  
  if (codexMemoryInstance) {
    return codexMemoryInstance.getMemoryForContext(tokenLimit);
  }
  return null;
}

export async function searchCodexMemory(query: string): Promise<string[]> {
  if (codexMemoryInstance) {
    return codexMemoryInstance.searchMemory(query);
  }
  return [];
}

/**
 * 获取记忆系统状态
 */
export function getMemoryStatus(): {
  initialized: boolean;
  cachedItems: number;
  hasLLMService: boolean;
} {
  return {
    initialized: codexMemoryInstance !== null,
    cachedItems: recentRolloutItems.length,
    hasLLMService: llmServiceInstance !== null
  };
}

export {
  CodexMemorySystem,
  createCodexMemorySystem,
  type LLMService,
  type AgentService,
  type MemoryConfig
};