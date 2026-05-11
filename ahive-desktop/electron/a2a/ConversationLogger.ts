/**
 * A2A 对话日志记录器 (Electron 版本)
 * 记录智能体间的所有对话通讯
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';

// ==================== 类型定义 ====================

/** A2A 消息类型 */
export type A2AMessageType = 
  // === Agent ↔ Agent 协作消息 ===
  | 'talktoagent'     // 普通对话
  | 'review_request'  // 审核请求
  | 'review_result'   // 审核结果
  | 'handover'        // 任务交接
  | 'question'        // 提问
  | 'answer'          // 回答
  // === AHIVE → Agent 控制消息 ===
  | 'task_assign'     // 任务分配
  | 'timeout_alert'   // 超时提醒
  | 'recovery_info'   // 恢复信息
  // === Agent → AHIVE 状态消息 ===
  | 'task_start'      // 任务开始
  | 'task_progress'   // 进度更新
  | 'task_complete'   // 任务完成
  // === 双向同步消息 ===
  | 'status_sync';    // 状态同步

/** A2A 消息类型分类 */
export const A2A_MESSAGE_CATEGORIES = {
  /** Agent 间协作 */
  collaboration: ['talktoagent', 'review_request', 'review_result', 'handover', 'question', 'answer'] as const,
  /** AHIVE 控制 */
  control: ['task_assign', 'timeout_alert', 'recovery_info'] as const,
  /** 状态上报 */
  report: ['task_start', 'task_progress', 'task_complete'] as const,
  /** 同步消息 */
  sync: ['status_sync'] as const,
};

/** A2A 消息类型说明 */
export const A2A_MESSAGE_DESCRIPTIONS: Record<A2AMessageType, string> = {
  talktoagent: '普通对话',
  review_request: '审核请求',
  review_result: '审核结果',
  handover: '任务交接',
  question: '提问',
  answer: '回答',
  task_assign: '任务分配',
  timeout_alert: '超时提醒',
  recovery_info: '恢复信息',
  task_start: '任务开始',
  task_progress: '进度更新',
  task_complete: '任务完成',
  status_sync: '状态同步',
};

/** A2A 对话记录 */
export interface A2AConversationLog {
  logId: string;
  workflowId: string;
  nodeId?: string;
  type: A2AMessageType;
  from: string;
  to: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/** 对话日志文件结构 */
interface ConversationLogFile {
  logId: string;
  workflowId: string;
  participants: string[];
  messages: A2AConversationLog[];
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'closed';
}

// ==================== 对话日志记录器 ====================

export class ConversationLogger {
  private logsDir: string;
  private activeConversations: Map<string, ConversationLogFile> = new Map();

  constructor(logsDir?: string) {
    // 使用应用数据目录
    const userDataPath = app.getPath('userData');
    this.logsDir = logsDir || path.join(userDataPath, 'logs', 'a2a');
    this.ensureLogsDir();
    log.info(`[ConversationLogger] Logs directory: ${this.logsDir}`);
  }

  private ensureLogsDir(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private generateLogId(date: Date, participants: string[]): string {
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const participantsStr = participants.sort().join('_');
    const timestamp = Date.now();
    return `${dateStr}_${participantsStr}_${timestamp}`;
  }

  private getDateDir(date: Date): string {
    const dateStr = date.toISOString().split('T')[0];
    const dateDir = path.join(this.logsDir, dateStr);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    return dateDir;
  }

  /**
   * 记录 A2A 消息
   */
  async log(params: {
    type: A2AMessageType;
    from: string;
    to: string;
    message: string;
    workflowId: string;
    nodeId?: string;
    data?: Record<string, unknown>;
  }): Promise<A2AConversationLog> {
    const now = new Date();
    const logEntry: A2AConversationLog = {
      logId: `${Date.now()}_${params.from}_${params.to}`,
      workflowId: params.workflowId,
      nodeId: params.nodeId,
      type: params.type,
      from: params.from,
      to: params.to,
      message: params.message,
      timestamp: now.toISOString(),
      data: params.data,
    };

    // 更新或创建对话文件
    const participants = [params.from, params.to].sort();
    const conversationKey = `${params.workflowId}_${participants.join('_')}`;
    
    let conversation = this.activeConversations.get(conversationKey);
    
    if (!conversation) {
      conversation = {
        logId: this.generateLogId(now, participants),
        workflowId: params.workflowId,
        participants,
        messages: [],
        startedAt: now.toISOString(),
        status: 'active',
      };
      this.activeConversations.set(conversationKey, conversation);
    }

    conversation.messages.push(logEntry);
    conversation.endedAt = now.toISOString();

    // 保存到文件
    await this.saveConversation(conversation);

    log.info(`[ConversationLogger] Logged: ${params.from} -> ${params.to} (${params.type})`);
    return logEntry;
  }

  private async saveConversation(conversation: ConversationLogFile): Promise<void> {
    const dateDir = this.getDateDir(new Date(conversation.startedAt));
    const filePath = path.join(dateDir, `${conversation.logId}.json`);
    
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8', (err) => {
        if (err) {
          log.error('[ConversationLogger] Failed to save:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 获取对话日志
   */
  async getConversation(logId: string): Promise<ConversationLogFile | null> {
    // 从内存查找
    for (const conversation of this.activeConversations.values()) {
      if (conversation.logId === logId) {
        return conversation;
      }
    }

    // 从文件查找
    const files = this.findAllLogFiles();
    for (const file of files) {
      if (path.basename(file, '.json').includes(logId) || file.includes(logId)) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          return JSON.parse(content);
        } catch {
          // 忽略解析错误
        }
      }
    }

    return null;
  }

  private findAllLogFiles(): string[] {
    const files: string[] = [];
    
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          files.push(fullPath);
        }
      }
    };

    scanDir(this.logsDir);
    return files;
  }

  /**
   * 搜索对话日志
   */
  async search(params: {
    workflowId?: string;
    participants?: string[];
    type?: A2AMessageType;
    nodeId?: string;
    limit?: number;
  }): Promise<ConversationLogFile[]> {
    const results: ConversationLogFile[] = [];
    const files = this.findAllLogFiles();
    const limit = params.limit || 100;

    for (const file of files) {
      if (results.length >= limit) break;

      try {
        const content = fs.readFileSync(file, 'utf-8');
        const conversation: ConversationLogFile = JSON.parse(content);

        // 过滤条件
        if (params.workflowId && conversation.workflowId !== params.workflowId) continue;
        
        if (params.participants && params.participants.length > 0) {
          const hasAllParticipants = params.participants.every(
            p => conversation.participants.includes(p)
          );
          if (!hasAllParticipants) continue;
        }

        if (params.nodeId) {
          const hasNode = conversation.messages.some(m => m.nodeId === params.nodeId);
          if (!hasNode) continue;
        }

        if (params.type) {
          const hasType = conversation.messages.some(m => m.type === params.type);
          if (!hasType) continue;
        }

        results.push(conversation);
      } catch (err) {
        log.warn('[ConversationLogger] Failed to parse:', file);
      }
    }

    // 按时间排序（最新的在前）
    results.sort((a, b) => 
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    return results;
  }

  /**
   * 清理过期日志
   */
  async cleanup(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    const files = this.findAllLogFiles();
    let deletedCount = 0;

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const conversation: ConversationLogFile = JSON.parse(content);
        
        if (new Date(conversation.startedAt) < cutoffDate) {
          fs.unlinkSync(file);
          deletedCount++;
        }
      } catch {
        // 忽略错误
      }
    }

    log.info(`[ConversationLogger] Cleaned up ${deletedCount} old logs`);
    return deletedCount;
  }
}

// 单例导出
export const conversationLogger = new ConversationLogger();