import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Stage1Output, Phase2InputSelection } from './types.js';
import { rolloutSummaryFileStemFromParts } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, '..', '..', '..', 'templates', 'memories');

function loadTemplate(name: string): string {
  const filePath = path.join(TEMPLATES_DIR, name);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  throw new Error(`Template not found: ${name}`);
}

export function getStageOneSystemPrompt(): string {
  return loadTemplate('stage_one_system.md');
}

export function buildStageOneInputMessage(
  rolloutPath: string,
  rolloutCwd: string,
  rolloutContents: string
): string {
  const template = loadTemplate('stage_one_input.md');
  return template
    .replace('{{ rollout_path }}', rolloutPath)
    .replace('{{ rollout_cwd }}', rolloutCwd)
    .replace('{{ rollout_contents }}', rolloutContents);
}

export function buildConsolidationPrompt(
  memoryRoot: string,
  selection: Phase2InputSelection
): string {
  const template = loadTemplate('consolidation.md');
  const phase2InputSelection = renderPhase2InputSelection(selection);
  
  return template
    .replace(/\{\{ memory_root \}\}/g, memoryRoot)
    .replace('{{ phase2_input_selection }}', phase2InputSelection);
}

function renderPhase2InputSelection(selection: Phase2InputSelection): string {
  const retained = selection.retainedThreadIds.length;
  const added = selection.selected.length - retained;
  
  const selected = selection.selected.length === 0
    ? '- none'
    : selection.selected.map(item => 
        renderSelectedInputLine(item, selection.retainedThreadIds.includes(item.threadId))
      ).join('\n');
  
  const removed = selection.removed.length === 0
    ? '- none'
    : selection.removed.map(renderRemovedInputLine).join('\n');

  return `- selected inputs this run: ${selection.selected.length}
- newly added since the last successful Phase 2 run: ${added}
- retained from the last successful Phase 2 run: ${retained}
- removed from the last successful Phase 2 run: ${selection.removed.length}

Current selected Phase 1 inputs:
${selected}

Removed from the last successful Phase 2 selection:
${removed}`;
}

function renderSelectedInputLine(item: Stage1Output, retained: boolean): string {
  const status = retained ? 'retained' : 'added';
  const rolloutSummaryFile = `rollout_summaries/${rolloutSummaryFileStemFromParts(
    item.threadId,
    item.sourceUpdatedAt,
    item.rolloutSlug
  )}.md`;
  return `- [${status}] thread_id=${item.threadId}, rollout_summary_file=${rolloutSummaryFile}`;
}

function renderRemovedInputLine(item: { threadId: string; sourceUpdatedAt: Date; rolloutSlug?: string }): string {
  const rolloutSummaryFile = `rollout_summaries/${rolloutSummaryFileStemFromParts(
    item.threadId,
    item.sourceUpdatedAt,
    item.rolloutSlug
  )}.md`;
  return `- thread_id=${item.threadId}, rollout_summary_file=${rolloutSummaryFile}`;
}

export async function buildMemoryToolDeveloperInstructions(
  memoryRoot: string,
  tokenLimit: number = 5000
): Promise<string | null> {
  const memorySummaryPath = path.join(memoryRoot, 'memory_summary.md');
  const memoryPath = path.join(memoryRoot, 'MEMORY.md');
  const rolloutsDir = path.join(memoryRoot, 'rollouts');
  
  // 1. 优先使用记忆摘要
  if (fs.existsSync(memorySummaryPath)) {
    let memorySummary = fs.readFileSync(memorySummaryPath, 'utf-8').trim();
    if (memorySummary.length > 0) {
      const template = loadTemplate('read_path.md');
      return template
        .replace('{{ base_path }}', memoryRoot)
        .replace('{{ memory_summary }}', memorySummary);
    }
  }
  
  // 2. 其次使用完整记忆文件
  if (fs.existsSync(memoryPath)) {
    let memory = fs.readFileSync(memoryPath, 'utf-8').trim();
    if (memory.length > 0) {
      // 截断到 token 限制（粗略估计：1 token ≈ 4 字符）
      const charLimit = tokenLimit * 4;
      if (memory.length > charLimit) {
        memory = memory.slice(0, charLimit) + '\n\n... (记忆已截断)';
      }
      return `## 项目记忆\n\n${memory}`;
    }
  }
  
  // 3. 最后从 rollouts 加载最近的对话记录（从文件末尾倒序读取）
  if (fs.existsSync(rolloutsDir)) {
    const files = fs.readdirSync(rolloutsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(rolloutsDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 5); // 最近 5 个会话
    
    if (files.length > 0) {
      let context = '## 最近对话记录（从最新到最旧）\n\n';
      const charLimit = tokenLimit * 4;
      
      for (const file of files) {
        if (context.length >= charLimit) break;
        
        const filePath = path.join(rolloutsDir, file.name);
        const threadId = file.name.replace('.jsonl', '');
        
        // 🔑 关键修复：使用倒序读取，从文件末尾读取最新的记录
        const { loadRolloutReverse } = await import('./storage.js');
        const lines = loadRolloutReverse(memoryRoot, threadId, 50); // 每个会话最多 50 条
        
        context += `### 会话 ${threadId}\n`;
        
        for (const line of lines) {
          if (context.length >= charLimit) break;
          
          try {
            const item = JSON.parse(line);
            const role = item.role || 'unknown';
            const content = (item.content || '').slice(0, 500);
            context += `**${role}**: ${content}${content.length >= 500 ? '...' : ''}\n\n`;
          } catch (e) {
            // 跳过解析失败的行
          }
        }
      }
      
      return context.slice(0, charLimit);
    }
  }
  
  return null;
}

export const STAGE_ONE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    rollout_summary: { type: 'string' },
    rollout_slug: { type: ['string', 'null'] },
    raw_memory: { type: 'string' }
  },
  required: ['rollout_summary', 'rollout_slug', 'raw_memory'],
  additionalProperties: false
};