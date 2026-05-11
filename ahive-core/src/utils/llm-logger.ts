/**
 * LLM 调用日志系统
 * 
 * 专门记录所有 LLM 调用和记忆压缩的详细日志
 * 日志保存到文件，便于排查问题
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// 日志文件路径 - 使用程序运行目录下的 logs 文件夹
const LOG_DIR = path.join(process.cwd(), 'logs');
const LLM_LOG_FILE = path.join(LOG_DIR, 'llm-calls.log');
const COMPACT_LOG_FILE = path.join(LOG_DIR, 'memory-compact.log');
const ARCHIVE_LOG_FILE = path.join(LOG_DIR, 'archive.log');

// 确保日志目录存在
function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (e) {
      console.error(`[LLM-Logger] 无法创建日志目录: ${LOG_DIR}`, e);
    }
  }
}

/**
 * 格式化时间戳
 */
function formatTime(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').slice(0, 23);
}

/**
 * 格式化消息内容（截断过长的内容）
 */
function formatContent(content: string | any[], maxLength: number = 500): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  if (!text) return '(空)';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + `... [截断，总长度: ${text.length}]`;
}

/**
 * 格式化工具调用
 */
function formatToolCalls(toolCalls: Array<{ function?: { name?: string; arguments?: string } }>): string {
  if (!toolCalls || toolCalls.length === 0) return '(无)';
  
  return toolCalls.map((tc, i) => {
    const funcName = tc.function?.name || 'unknown';
    const args = tc.function?.arguments || '';
    // 尝试解析参数
    let argsDisplay = args;
    try {
      const parsed = JSON.parse(args);
      argsDisplay = JSON.stringify(parsed, null, 2).slice(0, 200);
    } catch {
      argsDisplay = args.slice(0, 200);
    }
    return `    [${i}] ${funcName}(${argsDisplay})`;
  }).join('\n');
}

/**
 * 格式化消息数组
 */
function formatMessages(messages: Array<{ role: string; content?: string | any[]; tool_calls?: any[] }>): string {
  return messages.map((m, i) => {
    const roleIcon = m.role === 'user' ? '👤' : m.role === 'assistant' ? '🤖' : m.role === 'tool' ? '🔧' : '⚙️';
    const content = m.content ? formatContent(m.content, 300) : '(无文本内容)';
    
    // 处理工具调用
    let toolCallsStr = '';
    if (m.tool_calls && m.tool_calls.length > 0) {
      toolCallsStr = `\n    🔧 工具调用 (${m.tool_calls.length}个):\n${formatToolCalls(m.tool_calls)}`;
    }
    
    return `  [${i}] ${roleIcon} ${m.role}: ${content}${toolCallsStr}`;
  }).join('\n');
}

/**
 * LLM 调用日志接口
 */
export interface LLMCallLog {
  timestamp: string;
  callId: string;
  source: string;           // 调用来源
  model: string;            // 模型名称
  messageCount: number;     // 消息数量
  messages: Array<{ role: string; content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }>;  // 消息内容
  duration: number;         // 耗时（毫秒）
  responseContent?: string; // 响应内容
  responseToolCalls?: Array<{ function?: { name?: string; arguments?: string } }>;  // 响应中的工具调用
  toolCalls?: number;       // 工具调用数量（用于 LLMCallTracker.success）
  toolCallsCount?: number;  // 工具调用数量
  finishReason?: string;    // 结束原因
  error?: string;           // 错误信息
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * 记忆压缩日志接口
 */
export interface CompactLog {
  timestamp: string;
  threadId: string;
  action: 'check' | 'compact_start' | 'compact_end' | 'compact_error';
  details: {
    messageCount?: number;
    estimatedTokens?: number;
    tokenThreshold?: number;
    contextWindow?: number;
    compactRatio?: number;
    originalSize?: number;
    compactedSize?: number;
    compressionRatio?: string;
    originalTokens?: number;
    compactedTokens?: number;
    preservedCount?: number;
    summary?: string;
    error?: string;
  };
}

// 调用ID计数器
let callIdCounter = 0;

/**
 * 生成调用ID
 */
function generateCallId(): string {
  callIdCounter++;
  const timestamp = Date.now().toString(36);
  const counter = callIdCounter.toString(36).padStart(4, '0');
  return `llm_${timestamp}_${counter}`;
}

/**
 * 写入LLM调用日志
 */
export function logLLMCall(log: LLMCallLog): void {
  ensureLogDir();
  const lines: string[] = [];
  
  // 分隔线
  lines.push('═'.repeat(80));
  
  // 基本信息
  lines.push(`[${log.timestamp}] LLM 调用 #${log.callId}`);
  lines.push(`来源: ${log.source}`);
  lines.push(`模型: ${log.model}`);
  lines.push(`消息数: ${log.messageCount}`);
  lines.push(`耗时: ${log.duration}ms`);
  
  // 消息内容
  lines.push('\n📤 发送的消息:');
  lines.push(formatMessages(log.messages));
  
  // 响应内容
  if (log.responseContent) {
    lines.push('\n📥 响应内容:');
    lines.push(`  ${formatContent(log.responseContent, 1000)}`);
  } else if (log.responseToolCalls && log.responseToolCalls.length > 0) {
    // 如果没有文本内容但有工具调用，记录工具调用
    lines.push('\n📥 响应: (无文本内容，返回工具调用)');
  }
  
  // 工具调用详情
  if (log.responseToolCalls && log.responseToolCalls.length > 0) {
    lines.push(`\n🔧 工具调用 (${log.responseToolCalls.length}个):`);
    lines.push(formatToolCalls(log.responseToolCalls));
  } else if (log.toolCalls !== undefined) {
    lines.push(`\n🔧 工具调用: ${log.toolCalls} 个`);
  }
  
  // 结束原因
  if (log.finishReason) {
    lines.push(`🏁 结束原因: ${log.finishReason}`);
  }
  
  // Token 使用
  if (log.tokenUsage) {
    lines.push(`\n📊 Token 使用:`);
    lines.push(`  - Prompt: ${log.tokenUsage.promptTokens}`);
    lines.push(`  - Completion: ${log.tokenUsage.completionTokens}`);
    lines.push(`  - Total: ${log.tokenUsage.totalTokens}`);
  }
  
  // 错误
  if (log.error) {
    lines.push(`\n❌ 错误: ${log.error}`);
  }
  
  lines.push('');  // 空行
  
  // 写入文件
  const logText = lines.join('\n');
  fs.appendFileSync(LLM_LOG_FILE, logText, 'utf-8');
  
  // 同时输出到控制台（简化版）
  const status = log.error ? '❌' : '✅';
  console.log(`[LLM-Logger] ${status} #${log.callId} | ${log.source} | ${log.model} | ${log.messageCount}条消息 | ${log.duration}ms${log.error ? ` | 错误: ${log.error}` : ''}`);
}

/**
 * 写入记忆压缩日志
 */
export function logCompact(log: CompactLog): void {
  const lines: string[] = [];
  
  // 分隔线
  lines.push('─'.repeat(60));
  
  // 基本信息
  lines.push(`[${log.timestamp}] 记忆压缩 [${log.threadId}]`);
  lines.push(`动作: ${log.action}`);
  
  // 详细信息
  const d = log.details;
  
  if (d.messageCount !== undefined) {
    lines.push(`消息数: ${d.messageCount}`);
  }
  if (d.estimatedTokens !== undefined) {
    lines.push(`估算 Tokens: ${d.estimatedTokens}`);
  }
  if (d.tokenThreshold !== undefined) {
    lines.push(`Token 阈值: ${d.tokenThreshold}`);
  }
  if (d.contextWindow !== undefined) {
    lines.push(`上下文窗口: ${d.contextWindow}`);
  }
  if (d.compactRatio !== undefined) {
    lines.push(`压缩比例: ${d.compactRatio}`);
  }
  if (d.originalSize !== undefined) {
    lines.push(`原始大小: ${d.originalSize} 字符`);
  }
  if (d.compactedSize !== undefined) {
    lines.push(`压缩后大小: ${d.compactedSize} 字符`);
  }
  if (d.compressionRatio !== undefined) {
    lines.push(`压缩率: ${d.compressionRatio}%`);
  }
  if (d.originalTokens !== undefined) {
    lines.push(`原始 Tokens: ${d.originalTokens}`);
  }
  if (d.compactedTokens !== undefined) {
    lines.push(`压缩后 Tokens: ${d.compactedTokens}`);
  }
  if (d.preservedCount !== undefined) {
    lines.push(`保留消息数: ${d.preservedCount}`);
  }
  if (d.summary) {
    lines.push(`摘要: ${formatContent(d.summary, 200)}`);
  }
  if (d.error) {
    lines.push(`❌ 错误: ${d.error}`);
  }
  
  lines.push('');  // 空行
  
  // 写入文件
  const logText = lines.join('\n');
  fs.appendFileSync(COMPACT_LOG_FILE, logText, 'utf-8');
  
  // 同时输出到控制台
  const status = log.action === 'compact_error' ? '❌' : 
                 log.action === 'compact_end' ? '✅' : 
                 log.action === 'check' ? '🔍' : '📦';
  console.log(`[Compact-Logger] ${status} [${log.threadId}] | ${log.action}${d.error ? ` | 错误: ${d.error}` : ''}`);
}

/**
 * 归档日志接口
 */
export interface ArchiveLog {
  timestamp: string;
  threadId: string;
  action: 'check' | 'archive_start' | 'archive_success' | 'archive_skip' | 'archive_error';
  details: {
    root?: string;
    filePath?: string;
    fileSize?: number;
    fileSizeMB?: string;
    thresholdMB?: number;
    thresholdBytes?: number;
    exceedsThreshold?: boolean;
    totalLines?: number;
    keepLines?: number;
    needsArchive?: boolean;
    archivePath?: string;
    archivedLines?: number;
    archivedSize?: number;
    remainingLines?: number;
    error?: string;
  };
}

/**
 * 写入归档日志
 */
export function logArchive(log: ArchiveLog): void {
  return; // 暂时禁用归档日志记录
  
  ensureLogDir();
  const lines: string[] = [];

  // 分隔线
  lines.push('─'.repeat(60));

  // 基本信息
  lines.push(`[${log.timestamp}] 归档操作 [${log.threadId}]`);
  lines.push(`动作: ${log.action}`);

  // 详细信息
  const d = log.details;

  if (d.root) {
    lines.push(`根目录: ${d.root}`);
  }
  if (d.filePath) {
    lines.push(`文件路径: ${d.filePath}`);
  }
  if (d.fileSizeMB) {
    lines.push(`文件大小: ${d.fileSizeMB} MB (${d.fileSize} bytes)`);
  }
  if (d.thresholdMB !== undefined) {
    lines.push(`阈值: ${d.thresholdMB} MB (${d.thresholdBytes} bytes)`);
  }
  if (d.exceedsThreshold !== undefined) {
    lines.push(`超过阈值: ${d.exceedsThreshold ? '是' : '否'}`);
  }
  if (d.totalLines !== undefined) {
    lines.push(`总行数: ${d.totalLines}`);
  }
  if (d.keepLines !== undefined) {
    lines.push(`保留行数: ${d.keepLines}`);
  }
  if (d.needsArchive !== undefined) {
    lines.push(`需要归档: ${d.needsArchive ? '是' : '否'}`);
  }
  if (d.archivePath) {
    lines.push(`归档路径: ${d.archivePath}`);
  }
  if (d.archivedLines !== undefined) {
    lines.push(`归档行数: ${d.archivedLines}`);
  }
  if (d.archivedSize !== undefined) {
    lines.push(`归档大小: ${(d.archivedSize / 1024).toFixed(1)} KB`);
  }
  if (d.remainingLines !== undefined) {
    lines.push(`剩余行数: ${d.remainingLines}`);
  }
  if (d.error) {
    lines.push(`❌ 错误: ${d.error}`);
  }

  lines.push('');  // 空行

  // 写入文件
  const logText = lines.join('\n');
  fs.appendFileSync(ARCHIVE_LOG_FILE, logText, 'utf-8');

  // 同时输出到控制台
  const status = log.action === 'archive_error' ? '❌' :
                 log.action === 'archive_success' ? '✅' :
                 log.action === 'check' ? '🔍' :
                 log.action === 'archive_skip' ? '⏭️' : '📦';
  console.log(`[Archive-Logger] ${status} [${log.threadId}] | ${log.action}${d.error ? ` | 错误: ${d.error}` : ''}`);
}

/**
 * 创建LLM调用追踪器
 * 用于追踪单次LLM调用的完整生命周期
 */
export class LLMCallTracker {
  private callId: string;
  private startTime: number;
  private source: string;
  private model: string;
  private messages: Array<{ role: string; content: string }>;
  
  constructor(source: string, model: string, messages: Array<{ role: string; content: string }>) {
    this.callId = generateCallId();
    this.startTime = Date.now();
    this.source = source;
    this.model = model;
    this.messages = messages;
    
    // 记录调用开始
    console.log(`[LLM-Logger] 🚀 #${this.callId} 开始调用 | ${source} | ${model} | ${messages.length}条消息`);
  }
  
  /**
   * 记录成功响应
   */
  success(response: {
    content: string;
    toolCalls?: number;
    finishReason?: string;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }): void {
    const duration = Date.now() - this.startTime;
    
    logLLMCall({
      timestamp: formatTime(),
      callId: this.callId,
      source: this.source,
      model: this.model,
      messageCount: this.messages.length,
      messages: this.messages,
      duration,
      responseContent: response.content,
      toolCalls: response.toolCalls,
      finishReason: response.finishReason,
      tokenUsage: response.tokenUsage,
    });
  }
  
  /**
   * 记录错误
   */
  error(error: string): void {
    const duration = Date.now() - this.startTime;
    
    logLLMCall({
      timestamp: formatTime(),
      callId: this.callId,
      source: this.source,
      model: this.model,
      messageCount: this.messages.length,
      messages: this.messages,
      duration,
      error,
    });
  }
}

/**
 * 获取日志文件路径
 */
export function getLogFilePaths(): { llmLog: string; compactLog: string } {
  return {
    llmLog: LLM_LOG_FILE,
    compactLog: COMPACT_LOG_FILE,
  };
}

/**
 * 清理旧日志（保留最近N天）
 */
export function cleanOldLogs(daysToKeep: number = 7): void {
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  
  for (const logFile of [LLM_LOG_FILE, COMPACT_LOG_FILE]) {
    if (fs.existsSync(logFile)) {
      const stat = fs.statSync(logFile);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(logFile);
        console.log(`[LLM-Logger] 已清理旧日志: ${logFile}`);
      }
    }
  }
}

/**
 * LLM 调用日志记录器（高级API）
 */
export class LLMLogger {
  private callIdCounter = 0;
  
  /**
   * 生成调用ID
   */
  private generateCallId(): string {
    this.callIdCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.callIdCounter.toString(36).padStart(4, '0');
    return `llm_${timestamp}_${counter}`;
  }
  
  /**
   * 记录LLM调用开始
   */
  logCallStart(params: {
    provider: string;
    model: string;
    messages: Array<{ role: string; content?: string | any[]; tool_calls?: any[] }>;
    config?: any;
    isStream?: boolean;
    isIsolated?: boolean;
  }): string {
    const callId = this.generateCallId();
    const timestamp = formatTime();
    const source = `${params.provider}${params.isStream ? '(stream)' : ''}${params.isIsolated ? '(isolated)' : ''}`;
    
    // 记录开始日志
    const lines: string[] = [];
    lines.push('═'.repeat(80));
    lines.push(`[${timestamp}] 🚀 LLM 调用开始 #${callId}`);
    lines.push(`来源: ${source}`);
    lines.push(`模型: ${params.model}`);
    lines.push(`消息数: ${params.messages.length}`);
    lines.push(`\n📤 发送的消息:`);
    lines.push(formatMessages(params.messages));
    lines.push('');
    
    fs.appendFileSync(LLM_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[LLM-Logger] 🚀 #${callId} | ${source} | ${params.model} | ${params.messages.length}条消息`);
    
    return callId;
  }
  
  /**
   * 记录LLM调用结束
   */
  logCallEnd(callId: string, result: {
    duration: number;
    tokens?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    finishReason?: string;
    toolCalls?: string[];
    responseContent?: string;
  }): void {
    const timestamp = formatTime();
    
    const lines: string[] = [];
    lines.push(`[${timestamp}] ✅ LLM 调用结束 #${callId}`);
    lines.push(`耗时: ${result.duration}ms`);
    
    if (result.tokens) {
      lines.push(`Token 使用:`);
      lines.push(`  - Prompt: ${result.tokens.promptTokens}`);
      lines.push(`  - Completion: ${result.tokens.completionTokens}`);
      lines.push(`  - Total: ${result.tokens.totalTokens}`);
    }
    
    if (result.finishReason) {
      lines.push(`结束原因: ${result.finishReason}`);
    }
    
    if (result.toolCalls && result.toolCalls.length > 0) {
      lines.push(`工具调用: ${result.toolCalls.length} 个 (${result.toolCalls.join(', ')})`);
    }
    
    if (result.responseContent) {
      lines.push(`\n📥 响应内容:`);
      lines.push(`  ${formatContent(result.responseContent, 500)}`);
    }
    
    lines.push('');
    
    fs.appendFileSync(LLM_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[LLM-Logger] ✅ #${callId} | ${result.duration}ms | tokens: ${result.tokens?.totalTokens || 'N/A'} | tools: ${result.toolCalls?.length || 0}`);
  }
  
  /**
   * 记录LLM调用错误
   */
  logCallError(callId: string, result: {
    duration: number;
    error: string;
  }): void {
    const timestamp = formatTime();
    
    const lines: string[] = [];
    lines.push(`[${timestamp}] ❌ LLM 调用失败 #${callId}`);
    lines.push(`耗时: ${result.duration}ms`);
    lines.push(`错误: ${result.error}`);
    lines.push('');
    
    fs.appendFileSync(LLM_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[LLM-Logger] ❌ #${callId} | ${result.duration}ms | 错误: ${result.error}`);
  }
}

/**
 * 记忆压缩日志记录器（高级API）
 */
export class CompactionLogger {
  /**
   * 记录压缩检查
   */
  logCheck(threadId: string, details: {
    messageCount: number;
    estimatedTokens: number;
    tokenThreshold: number;
    contextWindow: number;
    compactRatio: number;
    needsCompact: boolean;
  }): void {
    const timestamp = formatTime();
    
    const lines: string[] = [];
    lines.push('─'.repeat(60));
    lines.push(`[${timestamp}] 🔍 压缩检查 [${threadId}]`);
    lines.push(`消息数: ${details.messageCount}`);
    lines.push(`估算 Tokens: ${details.estimatedTokens}`);
    lines.push(`Token 阈值: ${details.tokenThreshold}`);
    lines.push(`上下文窗口: ${details.contextWindow}`);
    lines.push(`压缩比例: ${details.compactRatio}`);
    lines.push(`结果: ${details.needsCompact ? '⚠️ 需要压缩' : '✅ 无需压缩'}`);
    lines.push('');
    
    fs.appendFileSync(COMPACT_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[Compact-Logger] 🔍 [${threadId}] | tokens: ${details.estimatedTokens}/${details.tokenThreshold} | ${details.needsCompact ? '需要压缩' : '无需压缩'}`);
  }
  
  /**
   * 记录压缩开始
   */
  logStart(threadId: string, details: {
    originalSize: number;
    originalTokens: number;
    messageCount: number;
    preserveCount: number;
  }): void {
    const timestamp = formatTime();
    
    const lines: string[] = [];
    lines.push(`[${timestamp}] 📦 开始压缩 [${threadId}]`);
    lines.push(`原始大小: ${details.originalSize} 字符`);
    lines.push(`原始 Tokens: ${details.originalTokens}`);
    lines.push(`消息数: ${details.messageCount}`);
    lines.push(`保留消息数: ${details.preserveCount}`);
    lines.push('');
    
    fs.appendFileSync(COMPACT_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[Compact-Logger] 📦 [${threadId}] | 原始: ${details.originalTokens} tokens | 消息: ${details.messageCount}条`);
  }
  
  /**
   * 记录压缩结束
   */
  logEnd(threadId: string, details: {
    duration: number;
    compactedSize: number;
    compactedTokens: number;
    compressionRatio: string;
    preservedCount: number;
    summary?: string;
  }): void {
    const timestamp = formatTime();
    
    const lines: string[] = [];
    lines.push(`[${timestamp}] ✅ 压缩完成 [${threadId}]`);
    lines.push(`耗时: ${details.duration}ms`);
    lines.push(`压缩后大小: ${details.compactedSize} 字符`);
    lines.push(`压缩后 Tokens: ${details.compactedTokens}`);
    lines.push(`压缩率: ${details.compressionRatio}%`);
    lines.push(`保留消息数: ${details.preservedCount}`);
    
    if (details.summary) {
      lines.push(`摘要: ${formatContent(details.summary, 200)}`);
    }
    
    lines.push('');
    
    fs.appendFileSync(COMPACT_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[Compact-Logger] ✅ [${threadId}] | ${details.duration}ms | 压缩后: ${details.compactedTokens} tokens | 压缩率: ${details.compressionRatio}%`);
  }
  
  /**
   * 记录压缩错误
   */
  logError(threadId: string, details: {
    error: string;
  }): void {
    const timestamp = formatTime();
    
    const lines: string[] = [];
    lines.push(`[${timestamp}] ❌ 压缩失败 [${threadId}]`);
    lines.push(`错误: ${details.error}`);
    lines.push('');
    
    fs.appendFileSync(COMPACT_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[Compact-Logger] ❌ [${threadId}] | 错误: ${details.error}`);
  }
  
  /**
   * 记录跳过压缩
   */
  logSkip(threadId: string, reason: string): void {
    const timestamp = formatTime();
    
    const lines: string[] = [];
    lines.push(`[${timestamp}] ⏭️ 跳过压缩 [${threadId}]`);
    lines.push(`原因: ${reason}`);
    lines.push('');
    
    fs.appendFileSync(COMPACT_LOG_FILE, lines.join('\n'), 'utf-8');
    console.log(`[Compact-Logger] ⏭️ [${threadId}] | ${reason}`);
  }
}

// 创建全局实例
export const llmLogger = new LLMLogger();
export const compactionLogger = new CompactionLogger();

// 导出默认对象
export default {
  logLLMCall,
  logCompact,
  LLMCallTracker,
  LLMLogger,
  CompactionLogger,
  llmLogger,
  compactionLogger,
  getLogFilePaths,
  cleanOldLogs,
};