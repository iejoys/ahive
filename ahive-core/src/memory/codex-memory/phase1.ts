import fs from 'fs';
import path from 'path';
import type { Rollout, Stage1Output, MemoryConfig, RolloutItem, JobResult } from './types.js';
import { getStageOneSystemPrompt, buildStageOneInputMessage, STAGE_ONE_OUTPUT_SCHEMA } from './prompts.js';
import { ensureLayout, rolloutSummaryFileStem, getRolloutsDir, getRolloutSummariesDir, getRawMemoriesFile, writeRolloutSummary } from './storage.js';
import { logger } from '../../utils/index.js';

const CONCURRENCY_LIMIT = 4;  // 降低并发数，避免 API 限流
const DEFAULT_STAGE_ONE_ROLLOUT_TOKEN_LIMIT = 100000;  // 降低 token 限制
const JOB_LEASE_SECONDS = 3600;

// Phase 1 触发条件
const MIN_ROLLOUT_ITEMS = 2;  // 最少消息条数才值得提取
const MIN_ROLLOUT_AGE_MS = 5 * 60 * 1000;  // 5 分钟空闲后才提取

export interface LLMService {
  chat(messages: Array<{ role: string; content: string }>, options?: {
    systemPrompt?: string;
    outputSchema?: object;
    temperature?: number;
  }): Promise<string>;
}

export interface Phase1Options {
  llmService: LLMService;
  model?: string;
  tokenLimit?: number;
}

interface StageOneOutputParsed {
  rollout_summary: string;
  rollout_slug: string | null;
  raw_memory: string;
}

/**
 * 从文件加载 Rollout
 */
export function loadRolloutFromFile(filePath: string): Rollout | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    
    if (lines.length === 0) {
      return null;
    }

    const items: RolloutItem[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // 确保时间戳是 Date 对象
        if (typeof parsed.timestamp === 'string') {
          parsed.timestamp = new Date(parsed.timestamp);
        }
        items.push(parsed);
      } catch {
        // 跳过解析失败的行
      }
    }

    if (items.length === 0) {
      return null;
    }

    const threadId = path.basename(filePath, '.jsonl');
    const stats = fs.statSync(filePath);

    return {
      threadId,
      cwd: process.cwd(),
      items,
      updatedAt: new Date(stats.mtime),
    };
  } catch (error) {
    logger.error(`[Phase1] 加载 rollout 文件失败: ${filePath}, ${error}`);
    return null;
  }
}

/**
 * 获取所有待处理的 Rollouts
 * 优先从 spaces 目录查找，回退到旧目录
 */
export function getPendingRollouts(memoryRoot: string, config: MemoryConfig): Rollout[] {
  const rollouts: Rollout[] = [];
  const now = Date.now();
  
  // 1. 优先从 spaces 目录查找
  const spacesDir = path.join(memoryRoot, 'spaces');
  
  if (fs.existsSync(spacesDir)) {
    const spaceDirs = fs.readdirSync(spacesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    for (const spaceType of spaceDirs) {
      const rolloutsDir = path.join(spacesDir, spaceType, 'rollouts');
      const summariesDir = path.join(spacesDir, spaceType, 'rollout_summaries');
      
      if (!fs.existsSync(rolloutsDir)) continue;
      
      // 确保 summaries 目录存在
      if (!fs.existsSync(summariesDir)) {
        fs.mkdirSync(summariesDir, { recursive: true });
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
      
      // 获取 rollout 文件
      const rolloutFiles = fs.readdirSync(rolloutsDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          path: path.join(rolloutsDir, f),
          mtime: fs.statSync(path.join(rolloutsDir, f)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      for (const file of rolloutFiles) {
        const threadId = file.name.replace('.jsonl', '');
        
        if (processedThreads.has(threadId)) {
          logger.debug(`[Phase1] 跳过已处理的 rollout: ${threadId}`);
          continue;
        }
        
        const age = now - file.mtime.getTime();
        if (age < MIN_ROLLOUT_AGE_MS) {
          logger.debug(`[Phase1] Rollout ${threadId} 太新，跳过（${Math.round(age / 1000)}秒）`);
          continue;
        }
        
        const rollout = loadRolloutFromFile(file.path);
        if (rollout && rollout.items.length >= MIN_ROLLOUT_ITEMS) {
          // 标记来源
          rollout.spaceType = spaceType;
          rollouts.push(rollout);
          logger.info(`[Phase1] 发现待处理 rollout: ${threadId} (${rollout.items.length} 条消息, space: ${spaceType})`);
        }
        
        if (rollouts.length >= config.maxRolloutsPerStartup) {
          break;
        }
      }
      
      if (rollouts.length >= config.maxRolloutsPerStartup) {
        break;
      }
    }
  }
  
  // 2. 如果 spaces 目录没有数据，回退到旧目录
  if (rollouts.length === 0) {
    const oldRolloutsDir = getRolloutsDir(memoryRoot);
    
    if (fs.existsSync(oldRolloutsDir)) {
      const summariesDir = getRolloutSummariesDir(memoryRoot);
      if (!fs.existsSync(summariesDir)) {
        fs.mkdirSync(summariesDir, { recursive: true });
      }
      
      const processedThreads = new Set<string>();
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
      
      const rolloutFiles = fs.readdirSync(oldRolloutsDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({
          name: f,
          path: path.join(oldRolloutsDir, f),
          mtime: fs.statSync(path.join(oldRolloutsDir, f)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      for (const file of rolloutFiles) {
        const threadId = file.name.replace('.jsonl', '');
        
        if (processedThreads.has(threadId)) {
          continue;
        }
        
        const age = now - file.mtime.getTime();
        if (age < MIN_ROLLOUT_AGE_MS) {
          continue;
        }
        
        const rollout = loadRolloutFromFile(file.path);
        if (rollout && rollout.items.length >= MIN_ROLLOUT_ITEMS) {
          rollouts.push(rollout);
          logger.info(`[Phase1] 发现待处理 rollout (旧目录): ${threadId} (${rollout.items.length} 条消息)`);
        }
        
        if (rollouts.length >= config.maxRolloutsPerStartup) {
          break;
        }
      }
    }
  }
  
  return rollouts;
}

export class Phase1Extractor {
  private llmService: LLMService;
  private model: string;
  private tokenLimit: number;

  constructor(options: Phase1Options) {
    this.llmService = options.llmService;
    this.model = options.model || 'default';
    this.tokenLimit = options.tokenLimit || DEFAULT_STAGE_ONE_ROLLOUT_TOKEN_LIMIT;
  }

  async extractFromRollout(rollout: Rollout): Promise<Stage1Output | null> {
    const rolloutContents = this.serializeRollout(rollout);
    
    if (!rolloutContents || rolloutContents.length === 0) {
      logger.info(`[Phase1] Empty rollout for thread ${rollout.threadId}, skipping`);
      return null;
    }

    const truncatedContents = this.truncateContent(rolloutContents);
    
    const systemPrompt = getStageOneSystemPrompt();
    const userMessage = buildStageOneInputMessage(
      rollout.threadId,
      rollout.cwd,
      truncatedContents
    );

    try {
      logger.info(`[Phase1] 正在提取 thread ${rollout.threadId.slice(0, 8)}... 的记忆`);
      
      const response = await this.llmService.chat(
        [{ role: 'user', content: userMessage }],
        {
          systemPrompt,
          outputSchema: STAGE_ONE_OUTPUT_SCHEMA,
          temperature: 0.3
        }
      );

      const parsed = this.parseOutput(response);
      
      if (!parsed || !parsed.raw_memory || !parsed.rollout_summary) {
        logger.info(`[Phase1] No output for thread ${rollout.threadId}, skipping`);
        return null;
      }

      // 检查是否为空输出（无意义内容）
      if (parsed.raw_memory.trim() === '' && parsed.rollout_summary.trim() === '') {
        logger.info(`[Phase1] Empty memory output for thread ${rollout.threadId}, skipping (no-op)`);
        return null;
      }

      logger.info(`[Phase1] ✅ 成功提取 thread ${rollout.threadId.slice(0, 8)}... 的记忆`);
      
      return {
        threadId: rollout.threadId,
        rolloutPath: rollout.threadId,
        sourceUpdatedAt: rollout.updatedAt,
        rawMemory: this.redactSecrets(parsed.raw_memory),
        rolloutSummary: this.redactSecrets(parsed.rollout_summary),
        rolloutSlug: parsed.rollout_slug ? this.redactSecrets(parsed.rollout_slug) : undefined,
        cwd: rollout.cwd,
        gitBranch: rollout.gitBranch,
        generatedAt: new Date(),
        spaceType: rollout.spaceType,  // 传递 spaceType
      };
    } catch (error) {
      logger.error(`[Phase1] Failed to extract from rollout ${rollout.threadId}: ${error}`);
      return null;
    }
  }

  async extractFromRollouts(
    rollouts: Rollout[],
    config: MemoryConfig
  ): Promise<JobResult[]> {
    const results: JobResult[] = [];
    
    // 串行处理，避免 API 限流
    for (const rollout of rollouts) {
      const output = await this.extractFromRollout(rollout);
      results.push({
        threadId: rollout.threadId,
        outcome: output ? 'succeeded_with_output' : 'succeeded_no_output',
        output
      });
      
      // 添加延迟，避免 API 限流
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const succeeded = results.filter(r => r.outcome === 'succeeded_with_output').length;
    const noOutput = results.filter(r => r.outcome === 'succeeded_no_output').length;
    
    logger.info(
      `[Phase1] Extraction complete: ${results.length} jobs, ${succeeded} succeeded, ${noOutput} no-output`
    );

    return results;
  }

  private serializeRollout(rollout: Rollout): string {
    const filtered = rollout.items
      .filter(item => this.shouldPersistItem(item))
      .map(item => this.serializeItem(item));
    
    return JSON.stringify(filtered);
  }

  private shouldPersistItem(item: RolloutItem): boolean {
    // 过滤掉太短的内容
    if (item.content && item.content.length < 5) {
      return false;
    }
    return true;
  }

  private serializeItem(item: RolloutItem): object {
    const result: Record<string, unknown> = {
      role: item.role,
      content: item.content,
      timestamp: item.timestamp instanceof Date 
        ? item.timestamp.toISOString() 
        : new Date(item.timestamp).toISOString()
    };

    if (item.toolCalls) {
      result.tool_calls = item.toolCalls;
    }
    if (item.toolOutputs) {
      result.tool_outputs = item.toolOutputs;
    }

    return result;
  }

  private truncateContent(content: string): string {
    const estimatedTokens = Math.ceil(content.length / 4);
    if (estimatedTokens <= this.tokenLimit) {
      return content;
    }
    
    const targetChars = this.tokenLimit * 4;
    const halfTarget = Math.floor(targetChars / 2);
    
    const head = content.slice(0, halfTarget);
    const tail = content.slice(-halfTarget);
    
    return `${head}\n\n... [truncated] ...\n\n${tail}`;
  }

  private parseOutput(response: string): StageOneOutputParsed | null {
    try {
      // 尝试直接解析
      let parsed: any;
      try {
        parsed = JSON.parse(response);
      } catch {
        // 尝试提取 JSON 块
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return null;
        }
        parsed = JSON.parse(jsonMatch[0]);
      }
      
      if (
        typeof parsed.rollout_summary === 'string' &&
        typeof parsed.raw_memory === 'string' &&
        (parsed.rollout_slug === null || typeof parsed.rollout_slug === 'string')
      ) {
        return parsed as StageOneOutputParsed;
      }
      
      return null;
    } catch {
      return null;
    }
  }

  private redactSecrets(text: string): string {
    const patterns = [
      /[a-zA-Z0-9_-]{32,}/g,
      /sk-[a-zA-Z0-9]{20,}/g,
      /xox[baprs]-[a-zA-Z0-9-]+/g,
      /ghp_[a-zA-Z0-9]{36}/g,
      /gho_[a-zA-Z0-9]{36}/g,
      /ghu_[a-zA-Z0-9]{36}/g,
      /ghs_[a-zA-Z0-9]{36}/g,
      /ghr_[a-zA-Z0-9]{36}/g,
      /api[_-]?key[_-]?[a-zA-Z0-9]{16,}/gi,
      /token[_-]?[a-zA-Z0-9]{16,}/gi,
      /secret[_-]?[a-zA-Z0-9]{16,}/gi,
      /password[_-]?[a-zA-Z0-9]{8,}/gi,
    ];

    let result = text;
    for (const pattern of patterns) {
      result = result.replace(pattern, '[REDACTED_SECRET]');
    }
    return result;
  }
}

/**
 * 运行 Phase 1 提取
 */
export async function runPhase1(
  rollouts: Rollout[],
  config: MemoryConfig,
  llmService: LLMService
): Promise<Stage1Output[]> {
  const extractor = new Phase1Extractor({
    llmService,
    tokenLimit: DEFAULT_STAGE_ONE_ROLLOUT_TOKEN_LIMIT
  });

  const results = await extractor.extractFromRollouts(rollouts, config);
  
  // 保存成功的输出
  const outputs: Stage1Output[] = [];
  const root = config.memoryRoot;
  
  for (const result of results) {
    if (result.outcome === 'succeeded_with_output' && result.output) {
      outputs.push(result.output);
      
      // 保存 rollout summary 文件
      await writeRolloutSummary(root, result.output);
      logger.info(`[Phase1] 保存摘要: ${rolloutSummaryFileStem(result.output)}.md`);
    }
  }

  return outputs;
}

/**
 * 从现有 rollout 文件运行 Phase 1
 */
export async function runPhase1FromFiles(
  config: MemoryConfig,
  llmService: LLMService
): Promise<Stage1Output[]> {
  const rollouts = getPendingRollouts(config.memoryRoot, config);
  
  if (rollouts.length === 0) {
    logger.info('[Phase1] 没有待处理的 rollouts');
    return [];
  }

  logger.info(`[Phase1] 发现 ${rollouts.length} 个待处理的 rollouts`);
  return runPhase1(rollouts, config, llmService);
}