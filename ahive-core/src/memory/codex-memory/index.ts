/**
 * AHIVE Core - CODEX 记忆系统
 * 
 * 完整实现 CODEX 的两阶段记忆管道：
 * - Phase 1: 从 rollouts 提取 raw_memory 和 rollout_summary
 * - Phase 2: 整合多个 raw_memory 到 MEMORY.md 和 memory_summary.md
 */

import fs from 'fs';
import path from 'path';
import type { Rollout, Stage1Output, MemoryConfig, RolloutItem } from './types.js';
import { DEFAULT_MEMORY_CONFIG } from './types.js';
import { runPhase1, Phase1Extractor, getPendingRollouts, loadRolloutFromFile, type LLMService } from './phase1.js';
import { runPhase2Direct, runPhase2, type AgentService, type LLMServiceForPhase2 } from './phase2.js';
import {
  ensureLayout,
  getMemoryRoot,
  getMemoryFile,
  getMemorySummaryFile,
  getRawMemoriesFile,
  getRolloutsDir,
  getRolloutSummariesDir,
  loadMemory,
  loadMemorySummary,
  loadRawMemories,
  saveMemory,
  saveMemorySummary,
  saveRollout,
  loadRollout,
  loadRolloutReverse,
  loadRolloutPaginated,
  getRolloutStats,
  appendToRolloutWithIndex,
  writeRolloutSummary,
  getSessionIndex,
  updateSessionIndex,
  getRolloutFilePath,
  type SessionIndex,
  type SessionIndexItem,
} from './storage.js';
import { buildMemoryToolDeveloperInstructions } from './prompts.js';
import { logger } from '../../utils/index.js';

// 导出所有类型和函数
export * from './types.js';
export * from './phase1.js';
export * from './phase2.js';
export * from './storage.js';
export * from './prompts.js';

export { 
  saveRollout, 
  loadRollout, 
  getRolloutsDir,
  getRolloutSummariesDir,
  loadRolloutReverse,
  loadRolloutPaginated,
  getRolloutStats,
  appendToRolloutWithIndex,
  getSessionIndex,
  updateSessionIndex,
  getRolloutFilePath,
} from './storage.js';

export interface CodexMemoryOptions {
  config?: Partial<MemoryConfig>;
  llmService?: LLMService;
  agentService?: AgentService;
}

/**
 * CODEX 记忆系统
 * 
 * 核心功能：
 * 1. 记录对话到 rollouts（.jsonl 文件）
 * 2. Phase 1: 从 rollouts 提取记忆
 * 3. Phase 2: 整合记忆到 MEMORY.md
 * 4. 提供记忆上下文给 LLM
 */
export class CodexMemorySystem {
  private config: MemoryConfig;
  private llmService?: LLMService;
  private agentService?: AgentService;
  private stage1Outputs: Map<string, Stage1Output> = new Map();
  private rollouts: Map<string, Rollout> = new Map();
  private initialized: boolean = false;

  constructor(options: CodexMemoryOptions = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...options.config };
    this.llmService = options.llmService;
    this.agentService = options.agentService;
  }

  /**
   * 初始化记忆系统
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    const root = getMemoryRoot(this.config);
    await ensureLayout(root);
    
    // 加载已有的 Phase 1 输出
    await this.loadExistingOutputs();
    
    // 重建会话索引
    await this.rebuildSessionIndex();
    
    this.initialized = true;
    logger.info(`[CodexMemory] ✅ 初始化完成，记忆根目录: ${root}`);
  }

  /**
   * 加载已有的 Phase 1 输出
   */
  private async loadExistingOutputs(): Promise<void> {
    const root = getMemoryRoot(this.config);
    const summariesDir = getRolloutSummariesDir(root);
    
    if (!fs.existsSync(summariesDir)) {
      return;
    }

    // 从 rollout_summaries 目录加载已有的摘要
    const files = fs.readdirSync(summariesDir).filter(f => f.endsWith('.md'));
    
    for (const file of files) {
      const filePath = path.join(summariesDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // 解析 frontmatter
        const threadIdMatch = content.match(/^thread_id:\s*(.+)$/m);
        const updatedAtMatch = content.match(/^updated_at:\s*(.+)$/m);
        const cwdMatch = content.match(/^cwd:\s*(.+)$/m);
        
        if (threadIdMatch) {
          const threadId = threadIdMatch[1].trim();
          
          // 提取摘要内容（frontmatter 之后的部分）
          const bodyMatch = content.match(/\n---\n([\s\S]*)$/);
          const rolloutSummary = bodyMatch ? bodyMatch[1].trim() : '';
          
          this.stage1Outputs.set(threadId, {
            threadId,
            rolloutPath: threadId,
            sourceUpdatedAt: updatedAtMatch ? new Date(updatedAtMatch[1].trim()) : new Date(),
            rawMemory: '',  // raw_memory 存储在 raw_memories.md 中
            rolloutSummary,
            cwd: cwdMatch ? cwdMatch[1].trim() : '',
            generatedAt: new Date()
          });
        }
      } catch (error) {
        logger.warn(`[CodexMemory] 加载摘要失败: ${file}`);
      }
    }
    
    logger.info(`[CodexMemory] 加载了 ${this.stage1Outputs.size} 个已有摘要`);
  }

  /**
   * 记录 RolloutItem 到内存
   */
  recordRolloutItem(threadId: string, item: RolloutItem): void {
    if (!this.rollouts.has(threadId)) {
      this.rollouts.set(threadId, {
        threadId,
        cwd: process.cwd(),
        items: [],
        updatedAt: new Date()
      });
    }
    
    const rollout = this.rollouts.get(threadId)!;
    rollout.items.push(item);
    rollout.updatedAt = new Date();
  }

  /**
   * 记录消息到 rollout 文件
   */
  async recordMessage(
    threadId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    const item: RolloutItem = {
      role,
      content,
      timestamp: new Date()
    };
    
    this.recordRolloutItem(threadId, item);
    
    const root = getMemoryRoot(this.config);
    appendToRolloutWithIndex(root, threadId, JSON.stringify(item));
    
    logger.debug(`[CodexMemory] 记录消息: thread=${threadId.slice(0, 8)}... role=${role}`);
  }

  /**
   * 记录工具调用
   */
  async recordToolCall(
    threadId: string,
    toolCall: { id: string; name: string; arguments: Record<string, unknown> }
  ): Promise<void> {
    const rollout = this.rollouts.get(threadId);
    if (rollout && rollout.items.length > 0) {
      const lastItem = rollout.items[rollout.items.length - 1];
      if (!lastItem.toolCalls) {
        lastItem.toolCalls = [];
      }
      lastItem.toolCalls.push(toolCall);
    }
  }

  /**
   * 记录工具输出
   */
  async recordToolOutput(
    threadId: string,
    output: { toolCallId: string; output: string; isError?: boolean }
  ): Promise<void> {
    const rollout = this.rollouts.get(threadId);
    if (rollout) {
      const newItem: RolloutItem = {
        role: 'system',
        content: '',
        timestamp: new Date(),
        toolOutputs: [output]
      };
      rollout.items.push(newItem);
    }
  }

  /**
   * 运行记忆管道
   * 
   * Phase 1: 从 rollouts 提取记忆
   * Phase 2: 整合记忆到 MEMORY.md
   */
  async runMemoryPipeline(): Promise<void> {
    if (!this.llmService) {
      logger.warn('[CodexMemory] 没有配置 LLM 服务，跳过记忆管道');
      return;
    }

    logger.info('[CodexMemory] 🧠 开始运行记忆管道...');

    // Phase 1: 获取待处理的 rollouts
    const root = getMemoryRoot(this.config);
    const pendingRollouts = getPendingRollouts(root, this.config);
    
    if (pendingRollouts.length === 0) {
      logger.info('[CodexMemory] 没有待处理的 rollouts');
      return;
    }

    logger.info(`[CodexMemory] 发现 ${pendingRollouts.length} 个待处理的 rollouts`);

    // 运行 Phase 1 提取
    const extractor = new Phase1Extractor({
      llmService: this.llmService,
      model: this.config.extractModel
    });

    const phase1Outputs = await extractor.extractFromRollouts(pendingRollouts, this.config);
    
    // 保存 Phase 1 输出
    for (const result of phase1Outputs) {
      if (result.output) {
        this.stage1Outputs.set(result.threadId, result.output);
        
        // 写入摘要文件
        try {
          await writeRolloutSummary(root, result.output);
          logger.info(`[CodexMemory] 保存摘要: ${result.output.threadId.slice(0, 8)}...`);
        } catch (e) {
          logger.error(`[CodexMemory] 写入摘要失败: ${result.output.threadId}`, e);
        }
      }
    }

    const succeededOutputs = phase1Outputs
      .filter(r => r.outcome === 'succeeded_with_output' && r.output)
      .map(r => r.output!);

    if (succeededOutputs.length === 0) {
      logger.info('[CodexMemory] Phase 1 没有产生有效输出');
      return;
    }

    logger.info(`[CodexMemory] Phase 1 完成: ${succeededOutputs.length} 个有效输出`);

    // Phase 2: 整合记忆
    const allOutputs = Array.from(this.stage1Outputs.values())
      .sort((a, b) => b.sourceUpdatedAt.getTime() - a.sourceUpdatedAt.getTime());

    if (this.agentService) {
      await runPhase2(allOutputs, this.config, this.agentService);
    } else if (this.llmService) {
      await runPhase2Direct(allOutputs, this.config, this.llmService as LLMServiceForPhase2);
    }

    logger.info('[CodexMemory] ✅ 记忆管道完成');
  }

  /**
   * 获取记忆上下文（用于 LLM system prompt）
   */
  async getMemoryForContext(tokenLimit: number = 5000): Promise<string | null> {
    const root = getMemoryRoot(this.config);
    return buildMemoryToolDeveloperInstructions(root, tokenLimit);
  }

  /**
   * 获取记忆摘要
   */
  async getMemorySummary(): Promise<string | null> {
    const root = getMemoryRoot(this.config);
    return loadMemorySummary(root);
  }

  /**
   * 获取完整记忆
   */
  async getFullMemory(): Promise<string | null> {
    const root = getMemoryRoot(this.config);
    return loadMemory(root);
  }

  /**
   * 搜索记忆
   */
  async searchMemory(query: string): Promise<string[]> {
    const root = getMemoryRoot(this.config);
    const memory = await loadMemory(root);
    
    if (!memory) {
      return [];
    }

    const lines = memory.split('\n');
    const results: string[] = [];
    const queryLower = query.toLowerCase();
    
    let currentSection = '';
    for (const line of lines) {
      if (line.startsWith('#')) {
        currentSection = line;
      }
      if (line.toLowerCase().includes(queryLower)) {
        results.push(`${currentSection}\n${line}`);
      }
    }

    return results.slice(0, 10);
  }

  /**
   * 设置 LLM 服务
   */
  setLLMService(service: LLMService): void {
    this.llmService = service;
  }

  /**
   * 设置 Agent 服务
   */
  setAgentService(service: AgentService): void {
    this.agentService = service;
  }

  /**
   * 获取配置
   */
  getConfig(): MemoryConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<MemoryConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // ==================== 倒序读取和分页功能 ====================

  /**
   * 倒序读取 rollout（从最新到最旧）
   */
  async loadRecentRolloutItems(threadId: string, limit: number = 50): Promise<RolloutItem[]> {
    const root = getMemoryRoot(this.config);
    const items = loadRolloutReverse(root, threadId, limit);
    return items.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean) as RolloutItem[];
  }

  /**
   * 分页读取 rollout
   */
  async loadRolloutPaginated(
    threadId: string,
    cursor: number | null,
    limit: number = 20
  ): Promise<{ items: RolloutItem[]; cursor: number; hasMore: boolean; totalCount: number }> {
    const root = getMemoryRoot(this.config);
    const result = loadRolloutPaginated(root, threadId, cursor ?? 0, limit);
    return {
      items: result.items.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean) as RolloutItem[],
      cursor: result.cursor,
      hasMore: result.hasMore,
      totalCount: result.totalCount
    };
  }

  /**
   * 获取 rollout 统计信息
   */
  async getRolloutStats(threadId: string): Promise<{
    exists: boolean;
    lineCount: number;
    fileSize: number;
    lastModified: Date | null;
  }> {
    const root = getMemoryRoot(this.config);
    return getRolloutStats(root, threadId);
  }

  /**
   * 获取会话索引
   */
  async getSessionIndexData(): Promise<SessionIndex> {
    const root = getMemoryRoot(this.config);
    return getSessionIndex(root);
  }

  /**
   * 重建会话索引
   */
  async rebuildSessionIndex(): Promise<void> {
    const root = getMemoryRoot(this.config);
    const rolloutsDir = getRolloutsDir(root);
    
    if (!fs.existsSync(rolloutsDir)) {
      return;
    }

    const files = fs.readdirSync(rolloutsDir).filter(f => f.endsWith('.jsonl'));
    
    for (const file of files) {
      const threadId = file.replace('.jsonl', '');
      const stats = getRolloutStats(root, threadId);
      
      if (stats.exists && stats.lineCount > 0) {
        updateSessionIndex(root, threadId, stats.lineCount);
      }
    }
    
    logger.info(`[CodexMemory] 重建索引完成: ${files.length} 个会话`);
  }

  /**
   * 获取所有会话列表
   */
  async getAllSessions(): Promise<SessionIndexItem[]> {
    const index = await this.getSessionIndexData();
    return index.sessions;
  }

  /**
   * 从所有 rollouts 加载最近的记忆（用于启动时恢复上下文）
   */
  async loadRecentMemoriesFromAllRollouts(limit: number = 100): Promise<RolloutItem[]> {
    const root = getMemoryRoot(this.config);
    const rolloutsDir = getRolloutsDir(root);
    
    if (!fs.existsSync(rolloutsDir)) {
      return [];
    }

    // 获取所有 rollout 文件，按修改时间排序
    const files = fs.readdirSync(rolloutsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(rolloutsDir, f),
        mtime: fs.statSync(path.join(rolloutsDir, f)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    const items: RolloutItem[] = [];

    for (const file of files) {
      if (items.length >= limit) break;

      try {
        const lines = loadRolloutReverse(root, file.name.replace('.jsonl', ''), limit - items.length);
        
        for (const line of lines) {
          if (items.length >= limit) break;
          try {
            items.push(JSON.parse(line));
          } catch {
            // 跳过解析失败的行
          }
        }
      } catch (error) {
        logger.warn(`[CodexMemory] 读取 rollout 失败: ${file.name}`);
      }
    }

    logger.info(`[CodexMemory] 加载了 ${items.length} 条最近记忆`);
    return items;
  }
}

/**
 * 创建 CODEX 记忆系统实例
 */
export function createCodexMemorySystem(options: CodexMemoryOptions = {}): CodexMemorySystem {
  return new CodexMemorySystem(options);
}