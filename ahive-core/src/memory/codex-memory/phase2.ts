import fs from 'fs';
import path from 'path';
import type { Stage1Output, Phase2InputSelection, MemoryConfig, Rollout } from './types.js';
import { buildConsolidationPrompt } from './prompts.js';
import {
  ensureLayout,
  rebuildRawMemoriesFile,
  syncRolloutSummaries,
  getMemoryRoot,
  getMemoryFile,
  getMemorySummaryFile,
  saveMemory,
  saveMemorySummary,
  loadMemory,
  loadMemorySummary,
  loadRawMemories,
  rolloutSummaryFileStem,
  getRolloutsDir,
  getRolloutSummariesDir,
  getSkillsDir,
  loadRolloutReverse,
} from './storage.js';
import { logger } from '../../utils/index.js';

const JOB_LEASE_SECONDS = 3600;
const JOB_HEARTBEAT_SECONDS = 90;

export interface AgentService {
  spawnAgent(config: {
    cwd: string;
    prompt: string;
    model?: string;
  }): Promise<string>;
  waitForAgent(threadId: string): Promise<{ status: string; output?: string }>;
  shutdownAgent(threadId: string): Promise<void>;
}

export interface Phase2Options {
  agentService?: AgentService;
  consolidationModel?: string;
  llmService?: LLMServiceForPhase2;
}

export interface LLMServiceForPhase2 {
  chat(messages: Array<{ role: string; content: string }>, options?: { 
    systemPrompt?: string;
    temperature?: number;
  }): Promise<string>;
}

/**
 * Phase 2 整合器
 * 将 Phase 1 的输出整合成 MEMORY.md 和 memory_summary.md
 */
export class Phase2Consolidator {
  private agentService?: AgentService;
  private consolidationModel: string;
  private llmService?: LLMServiceForPhase2;

  constructor(options: Phase2Options & { llmService?: LLMServiceForPhase2 }) {
    this.agentService = options.agentService;
    this.consolidationModel = options.consolidationModel || 'default';
    this.llmService = options.llmService;
  }

  /**
   * 整合记忆
   */
  async consolidate(
    memories: Stage1Output[],
    config: MemoryConfig
  ): Promise<boolean> {
    const root = getMemoryRoot(config);
    await ensureLayout(root);

    if (memories.length === 0) {
      logger.info('[Phase2] No memories to consolidate');
      
      // 即使没有新记忆，也检查是否有历史记忆
      const existingMemory = await loadMemory(root);
      if (!existingMemory) {
        const emptyMemory = '# Memory\n\nNo memories yet.\n';
        const emptySummary = '# Memory Summary\n\nNo memories yet.\n';
        
        saveMemory(root, emptyMemory);
        saveMemorySummary(root, emptySummary);
      }
      
      return true;
    }

    // 同步 rollout 摘要文件
    await syncRolloutSummaries(root, memories, config.maxRawMemoriesForConsolidation);
    
    // 重建 raw_memories.md
    await rebuildRawMemoriesFile(root, memories, config.maxRawMemoriesForConsolidation);

    const selection = this.buildSelection(memories);
    
    // 如果有 LLM 服务，使用 LLM 整合
    if (this.llmService) {
      return this.consolidateWithLLM(root, selection, config);
    }
    
    // 如果有 Agent 服务，使用 Agent 整合
    if (this.agentService) {
      return this.consolidateWithAgent(root, selection, config);
    }
    
    // 否则使用简单的合并策略
    return this.consolidateSimple(root, memories, config);
  }

  /**
   * 使用 LLM 整合记忆
   */
  private async consolidateWithLLM(
    root: string,
    selection: Phase2InputSelection,
    config: MemoryConfig
  ): Promise<boolean> {
    const prompt = buildConsolidationPrompt(root, selection);

    try {
      logger.info('[Phase2] 🧠 使用 LLM 整合记忆...');
      
      const response = await this.llmService!.chat(
        [{ role: 'user', content: prompt }],
        { 
          systemPrompt: 'You are a Memory Writing Agent. Follow the instructions carefully. Output valid markdown.',
          temperature: 0.3
        }
      );

      // 解析响应
      const memoryContent = this.extractSection(response, 'MEMORY.md') || this.generateDefaultMemory(selection.selected);
      const summaryContent = this.extractSection(response, 'memory_summary.md') || this.generateDefaultSummary(selection.selected);

      // 保存记忆文件
      saveMemory(root, memoryContent);
      logger.info('[Phase2] ✅ MEMORY.md 已保存');

      saveMemorySummary(root, summaryContent);
      logger.info('[Phase2] ✅ memory_summary.md 已保存');

      return true;
    } catch (error) {
      logger.error(`[Phase2] LLM 整合失败: ${error}`);
      // 降级到简单合并
      return this.consolidateSimple(root, selection.selected, config);
    }
  }

  /**
   * 使用 Agent 整合记忆
   */
  private async consolidateWithAgent(
    root: string,
    selection: Phase2InputSelection,
    config: MemoryConfig
  ): Promise<boolean> {
    const prompt = buildConsolidationPrompt(root, selection);
    
    try {
      const threadId = await this.agentService!.spawnAgent({
        cwd: root,
        prompt,
        model: this.consolidationModel
      });

      logger.info(`[Phase2] Spawned consolidation agent: ${threadId}`);

      const result = await this.agentService!.waitForAgent(threadId);
      
      if (result.status === 'completed') {
        logger.info('[Phase2] Consolidation completed successfully');
        await this.agentService!.shutdownAgent(threadId);
        return true;
      } else {
        logger.error(`[Phase2] Consolidation failed: ${result.status}`);
        await this.agentService!.shutdownAgent(threadId);
        return false;
      }
    } catch (error) {
      logger.error(`[Phase2] Consolidation error: ${error}`);
      return false;
    }
  }

  /**
   * 简单合并策略（不使用 LLM）
   */
  private async consolidateSimple(
    root: string,
    memories: Stage1Output[],
    config: MemoryConfig
  ): Promise<boolean> {
    logger.info('[Phase2] 📝 使用简单合并策略...');
    
    // 生成 MEMORY.md
    const memoryContent = this.generateDefaultMemory(memories);
    saveMemory(root, memoryContent);
    
    // 生成 memory_summary.md
    const summaryContent = this.generateDefaultSummary(memories);
    saveMemorySummary(root, summaryContent);
    
    logger.info('[Phase2] ✅ 记忆文件已生成（简单模式）');
    return true;
  }

  /**
   * 构建选择对象
   */
  private buildSelection(memories: Stage1Output[]): Phase2InputSelection {
    return {
      selected: memories,
      previousSelected: [],
      retainedThreadIds: memories.map(m => m.threadId),
      removed: []
    };
  }

  /**
   * 从响应中提取指定部分
   */
  private extractSection(response: string, sectionName: string): string | null {
    const patterns = [
      new RegExp(`##\\s*${sectionName.replace('.', '\\.')}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i'),
      new RegExp(`\\*\\*${sectionName.replace('.', '\\.')}\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|$)`, 'i'),
      new RegExp(`#\\s*${sectionName.replace('.', '\\.')}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = response.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * 生成默认的 MEMORY.md 内容
   */
  private generateDefaultMemory(memories: Stage1Output[]): string {
    const lines: string[] = [
      '# Memory',
      '',
      '## 项目记忆',
      '',
      '从对话历史中提取的结构化记忆。',
      '',
    ];

    // 按工作目录分组
    const byCwd = new Map<string, Stage1Output[]>();
    for (const memory of memories) {
      const cwd = memory.cwd || 'unknown';
      if (!byCwd.has(cwd)) {
        byCwd.set(cwd, []);
      }
      byCwd.get(cwd)!.push(memory);
    }

    // 生成每个工作目录的记忆
    for (const [cwd, items] of byCwd) {
      lines.push(`## Task Group: ${cwd}`);
      lines.push('');
      lines.push(`scope: ${cwd}`);
      lines.push(`applies_to: cwd=${cwd}`);
      lines.push('');

      for (const item of items) {
        const date = item.sourceUpdatedAt.toISOString().split('T')[0];
        lines.push(`### ${date} - ${item.threadId.slice(0, 8)}`);
        lines.push('');
        
        if (item.rolloutSummary) {
          lines.push('**摘要**:');
          lines.push(item.rolloutSummary.slice(0, 500));
          lines.push('');
        }
        
        if (item.rawMemory) {
          lines.push('**详细记忆**:');
          lines.push(item.rawMemory.slice(0, 1000));
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成默认的 memory_summary.md 内容
   */
  private generateDefaultSummary(memories: Stage1Output[]): string {
    const lines: string[] = [
      '# Memory Summary',
      '',
      '## User Profile',
      '',
      '用户偏好和习惯的简要概述。',
      '',
      '## User Preferences',
      '',
      '从对话中提取的用户偏好。',
      '',
      '## Recent Topics',
      '',
    ];

    // 添加最近的主题
    const recentMemories = memories.slice(0, 10);
    for (const memory of recentMemories) {
      const date = memory.sourceUpdatedAt.toISOString().split('T')[0];
      const summary = memory.rolloutSummary?.slice(0, 200) || '无摘要';
      lines.push(`- **${date}** (${memory.threadId.slice(0, 8)}): ${summary}`);
    }

    lines.push('');
    lines.push('## Keywords');
    lines.push('');
    
    // 提取关键词
    const keywords = new Set<string>();
    for (const memory of memories) {
      if (memory.rolloutSlug) {
        keywords.add(memory.rolloutSlug.replace(/-/g, ' '));
      }
    }
    
    if (keywords.size > 0) {
      for (const keyword of keywords) {
        lines.push(`- ${keyword}`);
      }
    } else {
      lines.push('- 暂无关键词');
    }

    return lines.join('\n');
  }
}

/**
 * 运行 Phase 2 整合（使用 Agent）
 */
export async function runPhase2(
  memories: Stage1Output[],
  config: MemoryConfig,
  agentService: AgentService
): Promise<boolean> {
  const consolidator = new Phase2Consolidator({
    agentService,
    consolidationModel: config.consolidationModel
  });

  return consolidator.consolidate(memories, config);
}

/**
 * 运行 Phase 2 整合（直接使用 LLM）
 */
export async function runPhase2Direct(
  memories: Stage1Output[],
  config: MemoryConfig,
  llmService: LLMServiceForPhase2
): Promise<boolean> {
  const consolidator = new Phase2Consolidator({
    llmService,
    consolidationModel: config.consolidationModel
  });

  return consolidator.consolidate(memories, config);
}

/**
 * 从现有 rollouts 生成初始记忆
 * 用于首次运行或重建记忆
 */
export async function generateInitialMemories(
  config: MemoryConfig,
  llmService: LLMServiceForPhase2
): Promise<boolean> {
  const root = getMemoryRoot(config);
  const rolloutsDir = getRolloutsDir(root);
  
  if (!fs.existsSync(rolloutsDir)) {
    logger.info('[Phase2] 没有 rollouts 目录，跳过初始记忆生成');
    return false;
  }
  
  // 获取所有 rollout 文件
  const files = fs.readdirSync(rolloutsDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      path: path.join(rolloutsDir, f),
      mtime: fs.statSync(path.join(rolloutsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, config.maxRolloutsPerStartup);
  
  if (files.length === 0) {
    logger.info('[Phase2] 没有 rollout 文件，跳过初始记忆生成');
    return false;
  }
  
  logger.info(`[Phase2] 发现 ${files.length} 个 rollout 文件，开始生成初始记忆...`);
  
  // 加载 rollouts
  const rollouts: Rollout[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file.path, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    
    if (lines.length === 0) continue;
    
    const items: any[] = [];
    for (const line of lines) {
      try {
        items.push(JSON.parse(line));
      } catch {
        // 跳过解析失败的行
      }
    }
    
    if (items.length === 0) continue;
    
    rollouts.push({
      threadId: file.name.replace('.jsonl', ''),
      cwd: process.cwd(),
      items,
      updatedAt: file.mtime
    });
  }
  
  if (rollouts.length === 0) {
    logger.info('[Phase2] 没有有效的 rollout 数据');
    return false;
  }
  
  // 使用 Phase 1 提取记忆
  const { Phase1Extractor } = await import('./phase1.js');
  const extractor = new Phase1Extractor({ llmService });
  
  const results = await extractor.extractFromRollouts(rollouts, config);
  
  // 收集成功的输出
  const memories: Stage1Output[] = [];
  for (const result of results) {
    if (result.output) {
      memories.push(result.output);
    }
  }
  
  if (memories.length === 0) {
    logger.info('[Phase2] 没有提取到有效记忆');
    return false;
  }
  
  // 整合记忆
  return runPhase2Direct(memories, config, llmService);
}

/**
 * 检查是否需要运行记忆管道
 */
export function shouldRunMemoryPipeline(config: MemoryConfig): {
  shouldRun: boolean;
  reason: string;
  pendingCount: number;
} {
  const root = getMemoryRoot(config);
  const rolloutsDir = getRolloutsDir(root);
  const summariesDir = getRolloutSummariesDir(root);
  
  if (!fs.existsSync(rolloutsDir)) {
    return { shouldRun: false, reason: '没有 rollouts 目录', pendingCount: 0 };
  }
  
  // 获取所有 rollout 文件
  const rolloutFiles = fs.readdirSync(rolloutsDir)
    .filter(f => f.endsWith('.jsonl'));
  
  if (rolloutFiles.length === 0) {
    return { shouldRun: false, reason: '没有 rollout 文件', pendingCount: 0 };
  }
  
  // 获取已处理的 thread IDs
  const processedThreads = new Set<string>();
  if (fs.existsSync(summariesDir)) {
    const summaryFiles = fs.readdirSync(summariesDir).filter(f => f.endsWith('.md'));
    for (const file of summaryFiles) {
      const filePath = path.join(summariesDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const match = content.match(/^thread_id:\s*(.+)$/m);
        if (match) {
          processedThreads.add(match[1].trim());
        }
      } catch {
        // 跳过
      }
    }
  }
  
  // 计算待处理的数量
  const pendingCount = rolloutFiles.filter(f => {
    const threadId = f.replace('.jsonl', '');
    return !processedThreads.has(threadId);
  }).length;
  
  return {
    shouldRun: pendingCount > 0,
    reason: pendingCount > 0 ? `有 ${pendingCount} 个待处理的 rollout` : '所有 rollout 已处理',
    pendingCount
  };
}

/**
 * 获取记忆系统状态
 */
export function getMemorySystemStatus(config: MemoryConfig): {
  rolloutsCount: number;
  summariesCount: number;
  hasMemory: boolean;
  hasSummary: boolean;
  skillsCount: number;
} {
  const root = getMemoryRoot(config);
  const rolloutsDir = getRolloutsDir(root);
  const summariesDir = getRolloutSummariesDir(root);
  const skillsDir = getSkillsDir(root);
  
  let rolloutsCount = 0;
  let summariesCount = 0;
  let skillsCount = 0;
  
  if (fs.existsSync(rolloutsDir)) {
    rolloutsCount = fs.readdirSync(rolloutsDir).filter(f => f.endsWith('.jsonl')).length;
  }
  
  if (fs.existsSync(summariesDir)) {
    summariesCount = fs.readdirSync(summariesDir).filter(f => f.endsWith('.md')).length;
  }
  
  if (fs.existsSync(skillsDir)) {
    skillsCount = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory()).length;
  }
  
  const memoryPath = getMemoryFile(root);
  const summaryPath = getMemorySummaryFile(root);
  
  return {
    rolloutsCount,
    summariesCount,
    hasMemory: fs.existsSync(memoryPath),
    hasSummary: fs.existsSync(summaryPath),
    skillsCount
  };
}

/**
 * 从现有 rollouts 生成初始记忆（旧版本，保留兼容）
 */
export async function generateInitialMemoriesLegacy(
  config: MemoryConfig,
  llmService: LLMServiceForPhase2
): Promise<boolean> {
  const root = getMemoryRoot(config);
  const rolloutsDir = getRolloutsDir(root);
  
  if (!fs.existsSync(rolloutsDir)) {
    logger.info('[Phase2] 没有 rollouts 目录，跳过初始记忆生成');
    return false;
  }
  
  // 获取所有 rollout 文件
  const files = fs.readdirSync(rolloutsDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      path: path.join(rolloutsDir, f),
      mtime: fs.statSync(path.join(rolloutsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, config.maxRolloutsPerStartup);
  
  if (files.length === 0) {
    logger.info('[Phase2] 没有 rollout 文件，跳过初始记忆生成');
    return false;
  }
  
  logger.info(`[Phase2] 📂 发现 ${files.length} 个 rollout 文件，开始生成初始记忆...`);
  
  // 从每个文件提取记忆
  const memories: Stage1Output[] = [];
  
  for (const file of files) {
    try {
      const threadId = file.name.replace('.jsonl', '');
      const lines = loadRolloutReverse(root, threadId, 100);
      
      if (lines.length < 2) continue;
      
      // 解析 rollout items
      const items = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
      
      if (items.length === 0) continue;
      
      // 创建简单的 Stage1Output
      const memory: Stage1Output = {
        threadId,
        rolloutPath: threadId,
        sourceUpdatedAt: file.mtime,
        rawMemory: generateRawMemoryFromItems(items),
        rolloutSummary: generateSummaryFromItems(items),
        rolloutSlug: generateSlugFromItems(items),
        cwd: process.cwd(),
        generatedAt: new Date(),
      };
      
      memories.push(memory);
    } catch (error) {
      logger.warn(`[Phase2] 处理文件失败: ${file.name}`);
    }
  }
  
  if (memories.length === 0) {
    logger.info('[Phase2] 没有有效的 rollout 数据');
    return false;
  }
  
  // 使用 LLM 整合
  const consolidator = new Phase2Consolidator({ llmService });
  return consolidator.consolidate(memories, config);
}

/**
 * 从 items 生成原始记忆
 */
function generateRawMemoryFromItems(items: any[]): string {
  const lines: string[] = [
    '---',
    `description: 从 ${items.length} 条对话中提取的记忆`,
    `task_outcome: success`,
    '---',
    '',
  ];
  
  for (const item of items.slice(0, 20)) {
    const role = item.role || 'unknown';
    const content = (item.content || '').slice(0, 300);
    lines.push(`**${role}**: ${content}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * 从 items 生成摘要
 */
function generateSummaryFromItems(items: any[]): string {
  const userMessages = items.filter(i => i.role === 'user');
  const assistantMessages = items.filter(i => i.role === 'assistant');
  
  return `对话包含 ${userMessages.length} 条用户消息和 ${assistantMessages.length} 条助手回复。主要涉及编程、调试和问题解决。`;
}

/**
 * 从 items 生成 slug
 */
function generateSlugFromItems(items: any[]): string {
  // 从第一条用户消息中提取关键词
  const firstUserMessage = items.find(i => i.role === 'user');
  if (!firstUserMessage) return 'conversation';
  
  const content = firstUserMessage.content || '';
  const words = content.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
  return words.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'conversation';
}