import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import type { Stage1Output, MemoryConfig } from './types.js';
import { logArchive } from '../../utils/llm-logger.js';

const ROLLOUT_SUMMARIES_SUBDIR = 'rollout_summaries';
const RAW_MEMORIES_FILENAME = 'raw_memories.md';
const MEMORY_FILENAME = 'MEMORY.md';
const MEMORY_SUMMARY_FILENAME = 'memory_summary.md';
const SKILLS_SUBDIR = 'skills';
const ROLLOUTS_SUBDIR = 'rollouts';
const INDEX_FILENAME = 'rollout_index.json';
const READ_CHUNK_SIZE = 8192; // 8KB chunks for reverse reading

export function getMemoryRoot(config: MemoryConfig): string {
  return config.memoryRoot;
}

export function getRolloutSummariesDir(root: string): string {
  return path.join(root, ROLLOUT_SUMMARIES_SUBDIR);
}

export function getRawMemoriesFile(root: string): string {
  return path.join(root, RAW_MEMORIES_FILENAME);
}

export function getMemoryFile(root: string): string {
  return path.join(root, MEMORY_FILENAME);
}

export function getMemorySummaryFile(root: string): string {
  return path.join(root, MEMORY_SUMMARY_FILENAME);
}

export function getSkillsDir(root: string): string {
  return path.join(root, SKILLS_SUBDIR);
}

export async function ensureLayout(root: string): Promise<void> {
  const dirs = [
    root,
    getRolloutSummariesDir(root),
    getSkillsDir(root),
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function rolloutSummaryFileStem(memory: Stage1Output): string {
  return rolloutSummaryFileStemFromParts(
    memory.threadId,
    memory.sourceUpdatedAt,
    memory.rolloutSlug
  );
}

export function rolloutSummaryFileStemFromParts(
  threadId: string,
  sourceUpdatedAt: Date,
  rolloutSlug?: string
): string {
  const ROLLOUT_SLUG_MAX_LEN = 60;
  const SHORT_HASH_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const SHORT_HASH_SPACE = 14776336;

  const timestampFragment = formatDateForFilename(sourceUpdatedAt);
  
  let shortHashSeed = 0;
  for (let i = 0; i < threadId.length; i++) {
    shortHashSeed = (shortHashSeed * 31 + threadId.charCodeAt(i)) >>> 0;
  }
  shortHashSeed = shortHashSeed % SHORT_HASH_SPACE;

  let shortHashValue = shortHashSeed;
  const shortHashChars: string[] = ['0', '0', '0', '0'];
  for (let idx = 3; idx >= 0; idx--) {
    const alphabetIdx = shortHashValue % SHORT_HASH_ALPHABET.length;
    shortHashChars[idx] = SHORT_HASH_ALPHABET[alphabetIdx];
    shortHashValue = Math.floor(shortHashValue / SHORT_HASH_ALPHABET.length);
  }
  const shortHash = shortHashChars.join('');
  const filePrefix = `${timestampFragment}-${shortHash}`;

  if (!rolloutSlug) {
    return filePrefix;
  }

  let slug = '';
  for (const ch of rolloutSlug) {
    if (slug.length >= ROLLOUT_SLUG_MAX_LEN) break;
    if (/[a-zA-Z0-9]/.test(ch)) {
      slug += ch.toLowerCase();
    } else {
      slug += '_';
    }
  }

  while (slug.endsWith('_')) {
    slug = slug.slice(0, -1);
  }

  return slug ? `${filePrefix}-${slug}` : filePrefix;
}

function formatDateForFilename(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export async function rebuildRawMemoriesFile(
  root: string,
  memories: Stage1Output[],
  maxRawMemories: number
): Promise<void> {
  await ensureLayout(root);
  
  const retained = memories.slice(0, Math.min(memories.length, maxRawMemories));
  let body = '# Raw Memories\n\n';

  if (retained.length === 0) {
    body += 'No raw memories yet.\n';
    fs.writeFileSync(getRawMemoriesFile(root), body, 'utf-8');
    return;
  }

  body += 'Merged stage-1 raw memories (latest first):\n\n';
  
  for (const memory of retained) {
    body += `## Thread \`${memory.threadId}\`\n`;
    body += `updated_at: ${memory.sourceUpdatedAt.toISOString()}\n`;
    body += `cwd: ${memory.cwd}\n`;
    body += `rollout_path: ${memory.rolloutPath}\n`;
    const summaryFile = `${rolloutSummaryFileStem(memory)}.md`;
    body += `rollout_summary_file: ${summaryFile}\n\n`;
    body += memory.rawMemory.trim() + '\n\n';
  }

  fs.writeFileSync(getRawMemoriesFile(root), body, 'utf-8');
}

export async function syncRolloutSummaries(
  root: string,
  memories: Stage1Output[],
  maxRawMemories: number
): Promise<void> {
  await ensureLayout(root);

  const retained = memories.slice(0, Math.min(memories.length, maxRawMemories));
  const keep = new Set(retained.map(rolloutSummaryFileStem));

  const summariesDir = getRolloutSummariesDir(root);
  if (fs.existsSync(summariesDir)) {
    const files = fs.readdirSync(summariesDir);
    for (const file of files) {
      const stem = file.replace(/\.md$/, '');
      if (!keep.has(stem)) {
        fs.unlinkSync(path.join(summariesDir, file));
      }
    }
  }

  for (const memory of retained) {
    await writeRolloutSummary(root, memory);
  }

  if (retained.length === 0) {
    for (const fileName of ['MEMORY.md', 'memory_summary.md']) {
      const filePath = path.join(root, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    const skillsDir = getSkillsDir(root);
    if (fs.existsSync(skillsDir)) {
      fs.rmSync(skillsDir, { recursive: true });
    }
  }
}

export async function writeRolloutSummary(
  root: string,
  memory: Stage1Output
): Promise<void> {
  const fileStem = rolloutSummaryFileStem(memory);
  
  // 如果有 spaceType，写入到对应的 space 目录
  let summariesDir: string;
  if (memory.spaceType) {
    summariesDir = path.join(root, 'spaces', memory.spaceType, 'rollout_summaries');
  } else {
    summariesDir = getRolloutSummariesDir(root);
  }
  
  // 确保目录存在
  if (!fs.existsSync(summariesDir)) {
    fs.mkdirSync(summariesDir, { recursive: true });
  }
  
  const filePath = path.join(summariesDir, `${fileStem}.md`);

  let body = `thread_id: ${memory.threadId}\n`;
  body += `updated_at: ${memory.sourceUpdatedAt.toISOString()}\n`;
  body += `rollout_path: ${memory.rolloutPath}\n`;
  body += `cwd: ${memory.cwd}\n`;
  if (memory.gitBranch) {
    body += `git_branch: ${memory.gitBranch}\n`;
  }
  if (memory.spaceType) {
    body += `space_type: ${memory.spaceType}\n`;
  }
  body += '\n';
  body += memory.rolloutSummary + '\n';

  fs.writeFileSync(filePath, body, 'utf-8');
}

export async function loadMemorySummary(root: string): Promise<string | null> {
  const filePath = getMemorySummaryFile(root);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }
  return null;
}

export async function loadMemory(root: string): Promise<string | null> {
  const filePath = getMemoryFile(root);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }
  return null;
}

export async function loadRawMemories(root: string): Promise<string | null> {
  const filePath = getRawMemoriesFile(root);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }
  return null;
}

export function saveMemorySummary(root: string, content: string): void {
  fs.writeFileSync(getMemorySummaryFile(root), content, 'utf-8');
}

export function saveMemory(root: string, content: string): void {
  fs.writeFileSync(getMemoryFile(root), content, 'utf-8');
}

export function getRolloutsDir(root: string): string {
  return path.join(root, 'rollouts');
}

export function saveRollout(root: string, threadId: string, content: string): void {
  const rolloutsDir = getRolloutsDir(root);
  if (!fs.existsSync(rolloutsDir)) {
    fs.mkdirSync(rolloutsDir, { recursive: true });
  }
  const filePath = path.join(rolloutsDir, `${threadId}.jsonl`);
  fs.appendFileSync(filePath, content + '\n', 'utf-8');
}

export function loadRollout(root: string, threadId: string): string[] {
  const filePath = path.join(getRolloutsDir(root), `${threadId}.jsonl`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(line => line.trim());
  }
  return [];
}

// ============ 新增：倒序读取和分页功能 ============

/**
 * 获取 rollout 文件路径
 */
export function getRolloutFilePath(root: string, threadId: string): string {
  return path.join(getRolloutsDir(root), `${threadId}.jsonl`);
}

/**
 * 获取索引文件路径
 */
export function getIndexFilePath(root: string): string {
  return path.join(root, INDEX_FILENAME);
}

/**
 * 会话索引项
 */
export interface SessionIndexItem {
  threadId: string;
  updatedAt: string;
  itemCount: number;
  fileSize: number;
}

/**
 * 会话索引
 */
export interface SessionIndex {
  sessions: SessionIndexItem[];
  lastUpdated: string;
}

/**
 * 获取或创建会话索引
 */
export function getSessionIndex(root: string): SessionIndex {
  const indexPath = getIndexFilePath(root);
  if (fs.existsSync(indexPath)) {
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // 索引损坏，返回空索引
    }
  }
  return { sessions: [], lastUpdated: new Date().toISOString() };
}

/**
 * 更新会话索引
 */
export function updateSessionIndex(root: string, threadId: string, itemCount: number): void {
  const index = getSessionIndex(root);
  const filePath = getRolloutFilePath(root, threadId);
  const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  
  // 查找或添加会话
  const existingIdx = index.sessions.findIndex(s => s.threadId === threadId);
  const item: SessionIndexItem = {
    threadId,
    updatedAt: new Date().toISOString(),
    itemCount,
    fileSize
  };
  
  if (existingIdx >= 0) {
    index.sessions[existingIdx] = item;
  } else {
    index.sessions.push(item);
  }
  
  // 按更新时间排序（最新的在前）
  index.sessions.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  
  index.lastUpdated = new Date().toISOString();
  
  // 保存索引
  const indexPath = getIndexFilePath(root);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * 获取 rollout 统计信息
 */
export function getRolloutStats(root: string, threadId: string): {
  exists: boolean;
  lineCount: number;
  fileSize: number;
  lastModified: Date | null;
} {
  const filePath = getRolloutFilePath(root, threadId);
  if (!fs.existsSync(filePath)) {
    return { exists: false, lineCount: 0, fileSize: 0, lastModified: null };
  }
  
  const stats = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  return {
    exists: true,
    lineCount: lines.length,
    fileSize: stats.size,
    lastModified: stats.mtime
  };
}

/**
 * 倒序读取 rollout（从最新到最旧）
 * 返回最后 N 条记录
 */
export function loadRolloutReverse(root: string, threadId: string, limit?: number): string[] {
  const filePath = getRolloutFilePath(root, threadId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const fd = fs.openSync(filePath, 'r');
  const stats = fs.fstatSync(fd);
  const fileSize = stats.size;
  
  if (fileSize === 0) {
    fs.closeSync(fd);
    return [];
  }
  
  const lines: string[] = [];
  let buffer = Buffer.alloc(0);
  let position = fileSize;
  let chunkBuffer = Buffer.alloc(READ_CHUNK_SIZE);
  
  while (position > 0 && (limit === undefined || lines.length < limit)) {
    const readSize = Math.min(READ_CHUNK_SIZE, position);
    position -= readSize;
    
    fs.readSync(fd, chunkBuffer, 0, readSize, position);
    buffer = Buffer.concat([chunkBuffer.slice(0, readSize), buffer]);
    
    // 从后往前找换行符
    let lastNewline = buffer.length;
    while (true) {
      const newlineIdx = buffer.lastIndexOf('\n', lastNewline - 1);
      if (newlineIdx === -1) break;
      
      const line = buffer.slice(newlineIdx + 1, lastNewline).toString('utf-8').trim();
      if (line) {
        lines.push(line);
        if (limit !== undefined && lines.length >= limit) break;
      }
      lastNewline = newlineIdx;
    }
    
    // 保留未处理的部分
    if (lastNewline > 0) {
      buffer = buffer.slice(0, lastNewline);
    }
  }
  
  // 处理剩余的第一行
  if (buffer.length > 0 && (limit === undefined || lines.length < limit)) {
    const line = buffer.toString('utf-8').trim();
    if (line) {
      lines.push(line);
    }
  }
  
  fs.closeSync(fd);
  return lines;
}

/**
 * 分页读取 rollout
 */
export interface RolloutPage {
  items: string[];
  cursor: number;  // 下次读取的起始位置（从文件开头算起的行号）
  hasMore: boolean;
  totalCount: number;
}

export function loadRolloutPaginated(
  root: string, 
  threadId: string, 
  cursor: number = 0, 
  limit: number = 50
): RolloutPage {
  const filePath = getRolloutFilePath(root, threadId);
  if (!fs.existsSync(filePath)) {
    return { items: [], cursor: 0, hasMore: false, totalCount: 0 };
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const allLines = content.split('\n').filter(line => line.trim());
  const totalCount = allLines.length;
  
  // 如果 cursor 为负数，表示从末尾开始读取
  if (cursor < 0) {
    const startIdx = Math.max(0, totalCount + cursor);
    const items = allLines.slice(startIdx, startIdx + limit);
    return {
      items,
      cursor: startIdx + items.length,
      hasMore: startIdx + items.length < totalCount,
      totalCount
    };
  }
  
  const items = allLines.slice(cursor, cursor + limit);
  return {
    items,
    cursor: cursor + items.length,
    hasMore: cursor + items.length < totalCount,
    totalCount
  };
}

/**
 * 追加写入并更新索引
 */
export function appendToRolloutWithIndex(
  root: string, 
  threadId: string, 
  content: string
): void {
  // 确保目录存在
  const rolloutsDir = getRolloutsDir(root);
  if (!fs.existsSync(rolloutsDir)) {
    fs.mkdirSync(rolloutsDir, { recursive: true });
  }
  
  // 追加写入
  const filePath = getRolloutFilePath(root, threadId);
  fs.appendFileSync(filePath, content + '\n', 'utf-8');
  
  // 更新索引
  const stats = getRolloutStats(root, threadId);
  updateSessionIndex(root, threadId, stats.lineCount);
}

// ============ 新增：自动归档清理功能 ============

/** 默认归档阈值：1MB */
const DEFAULT_ARCHIVE_THRESHOLD_MB = 1;

/** 默认保留行数 */
const DEFAULT_KEEP_LINES = 100;

/**
 * 归档结果
 */
export interface ArchiveResult {
  archived: boolean;
  archivePath?: string;
  archivedLines?: number;
  remainingLines?: number;
  originalSize?: number;
  archivedSize?: number;
  error?: string;
}

/**
 * 格式化时间戳用于归档文件名
 * @param date 日期对象
 * @returns YYYYMMDDHHmm 格式的字符串
 */
export function formatTimestampForArchive(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}`;
}

/**
 * 归档旧的 rollout 内容（异步版）
 *
 * 当文件超过阈值时，将旧内容移动到 archived 目录
 * 使用异步 I/O，避免阻塞主线程
 *
 * @param root 记忆根目录
 * @param threadId 线程ID
 * @param keepLines 保留的行数（默认100）
 * @param thresholdMB 触发阈值（默认1MB）
 * @returns 归档结果
 */
export async function archiveOldRolloutContent(
  root: string,
  threadId: string,
  keepLines: number = DEFAULT_KEEP_LINES,
  thresholdMB: number = DEFAULT_ARCHIVE_THRESHOLD_MB
): Promise<ArchiveResult> {
  const timestamp = new Date().toISOString();

  logArchive({
    timestamp,
    threadId,
    action: 'check',
    details: {
      root,
      keepLines,
      thresholdMB
    }
  });

  const filePath = getRolloutFilePath(root, threadId);

  // 1. 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    logArchive({
      timestamp,
      threadId,
      action: 'archive_error',
      details: { filePath, error: '文件不存在' }
    });
    return { archived: false, error: '文件不存在' };
  }

  // 2. 检查文件大小
  const stats = await fsPromises.stat(filePath);
  const thresholdBytes = thresholdMB * 1024 * 1024;
  const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

  logArchive({
    timestamp,
    threadId,
    action: 'check',
    details: {
      filePath,
      fileSize: stats.size,
      fileSizeMB,
      thresholdMB,
      thresholdBytes,
      exceedsThreshold: stats.size >= thresholdBytes
    }
  });

  if (stats.size < thresholdBytes) {
    const lineCount = await countLinesAsync(filePath);
    logArchive({
      timestamp,
      threadId,
      action: 'archive_skip',
      details: {
        fileSize: stats.size,
        fileSizeMB,
        thresholdMB,
        remainingLines: lineCount,
        error: '文件未达阈值'
      }
    });
    return {
      archived: false,
      remainingLines: lineCount,
      originalSize: stats.size
    };
  }

  // 3. 读取所有行（异步）
  let content: string;
  try {
    content = await fsPromises.readFile(filePath, 'utf-8');
  } catch (error) {
    logArchive({
      timestamp,
      threadId,
      action: 'archive_error',
      details: { filePath, error: `读取文件失败: ${error}` }
    });
    return { archived: false, error: `读取文件失败: ${error}` };
  }

  const lines = content.split('\n').filter(line => line.trim());
  const totalLines = lines.length;

  // 4. 检查是否需要归档（行数不足时不归档）
  if (totalLines <= keepLines) {
    logArchive({
      timestamp,
      threadId,
      action: 'archive_skip',
      details: {
        totalLines,
        keepLines,
        needsArchive: false,
        error: '行数不足'
      }
    });
    return {
      archived: false,
      remainingLines: totalLines,
      originalSize: stats.size
    };
  }

  // 5. 创建归档目录（异步）
  const rolloutsDir = getRolloutsDir(root);
  const archivedDir = path.join(rolloutsDir, 'archived');
  await fsPromises.mkdir(archivedDir, { recursive: true });

  // 6. 生成归档文件名
  const archiveTimestamp = new Date();
  const timestampStr = formatTimestampForArchive(archiveTimestamp);
  const archiveFileName = `${threadId}_${timestampStr}.jsonl`;
  const archivePath = path.join(archivedDir, archiveFileName);

  // 7. 写入归档文件（前 N-keepLines 行）
  const archiveLines = lines.slice(0, totalLines - keepLines);
  const archiveContent = archiveLines.join('\n') + '\n';
  const archivedSize = Buffer.byteLength(archiveContent, 'utf-8');

  logArchive({
    timestamp,
    threadId,
    action: 'archive_start',
    details: {
      archivePath,
      archivedLines: archiveLines.length,
      archivedSize,
      totalLines,
      keepLines
    }
  });

  try {
    await fsPromises.writeFile(archivePath, archiveContent, 'utf-8');
  } catch (error) {
    logArchive({
      timestamp,
      threadId,
      action: 'archive_error',
      details: { archivePath, error: `写入归档文件失败: ${error}` }
    });
    return { archived: false, error: `写入归档文件失败: ${error}` };
  }

  // 8. 原文件只保留最后 keepLines 行
  const remainingContent = lines.slice(-keepLines).join('\n') + '\n';

  try {
    await fsPromises.writeFile(filePath, remainingContent, 'utf-8');
  } catch (error) {
    logArchive({
      timestamp,
      threadId,
      action: 'archive_error',
      details: { filePath, error: `更新原文件失败: ${error}` }
    });
    // 回滚：删除已创建的归档文件
    try {
      await fsPromises.unlink(archivePath);
    } catch { }
    return { archived: false, error: `更新原文件失败: ${error}` };
  }

  logArchive({
    timestamp,
    threadId,
    action: 'archive_success',
    details: {
      archivePath,
      archivedLines: archiveLines.length,
      archivedSize,
      remainingLines: keepLines
    }
  });

  return {
    archived: true,
    archivePath,
    archivedLines: archiveLines.length,
    remainingLines: keepLines,
    originalSize: stats.size,
    archivedSize
  };
}

/**
 * 统计文件行数（异步）
 */
async function countLinesAsync(filePath: string): Promise<number> {
  const content = await fsPromises.readFile(filePath, 'utf-8');
  return content.split('\n').filter(line => line.trim()).length;
}

/**
 * 获取归档文件列表
 */
export function listArchivedRollouts(root: string, threadId?: string): string[] {
  const rolloutsDir = getRolloutsDir(root);
  const archivedDir = path.join(rolloutsDir, 'archived');
  
  if (!fs.existsSync(archivedDir)) {
    return [];
  }
  
  let files = fs.readdirSync(archivedDir)
    .filter(f => f.endsWith('.jsonl'));
  
  if (threadId) {
    files = files.filter(f => f.startsWith(threadId + '_'));
  }
  
  return files.sort().reverse(); // 最新的在前
}

/**
 * 读取归档文件内容
 */
export function loadArchivedRollout(root: string, archiveFileName: string): string[] {
  const rolloutsDir = getRolloutsDir(root);
  const archivePath = path.join(rolloutsDir, 'archived', archiveFileName);
  
  if (!fs.existsSync(archivePath)) {
    return [];
  }
  
  const content = fs.readFileSync(archivePath, 'utf-8');
  return content.split('\n').filter(line => line.trim());
}

/**
 * 获取归档统计信息
 */
export function getArchiveStats(root: string, threadId?: string): {
  archiveCount: number;
  totalSize: number;
  oldestArchive: Date | null;
  newestArchive: Date | null;
} {
  const archives = listArchivedRollouts(root, threadId);
  const rolloutsDir = getRolloutsDir(root);
  const archivedDir = path.join(rolloutsDir, 'archived');
  
  let totalSize = 0;
  let oldestArchive: Date | null = null;
  let newestArchive: Date | null = null;
  
  for (const archive of archives) {
    const archivePath = path.join(archivedDir, archive);
    const stats = fs.statSync(archivePath);
    totalSize += stats.size;
    
    const mtime = stats.mtime;
    if (!oldestArchive || mtime < oldestArchive) {
      oldestArchive = mtime;
    }
    if (!newestArchive || mtime > newestArchive) {
      newestArchive = mtime;
    }
  }
  
  return {
    archiveCount: archives.length,
    totalSize,
    oldestArchive,
    newestArchive
  };
}