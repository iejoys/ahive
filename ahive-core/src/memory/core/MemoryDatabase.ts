/**
 * AHIVECORE 记忆数据库管理
 * 
 * 基于 SQLite 的记忆索引和查询系统
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { 
    MemorySpaceRecord, 
    Stage1OutputRecord, 
    ThreadRecord,
    MemoryJobRecord,
    Stage1Output,
    AgentType,
    IsolationStrategy 
} from './types.js';
import { daysToMs } from './utils.js';

/** 数据库版本 */
const DB_VERSION = 1;

export class MemoryDatabase {
    private db: Database.Database;
    private dbPath: string;
    
    constructor(dbPath: string) {
        this.dbPath = dbPath;
        
        // 确保目录存在
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // 打开数据库
        this.db = new Database(dbPath);
        
        // 配置 WAL 模式
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('busy_timeout = 5000');
        
        // 初始化表
        this.initTables();
        
        console.log(`[MemoryDatabase] 数据库初始化完成: ${dbPath}`);
    }
    
    /**
     * 获取原生数据库实例
     */
    getNativeDb(): Database.Database {
        return this.db;
    }
    
    /**
     * 初始化数据库表
     */
    private initTables(): void {
        this.db.exec(`
            -- 记忆空间表
            CREATE TABLE IF NOT EXISTS memory_spaces (
                space_id TEXT PRIMARY KEY,
                space_type TEXT NOT NULL CHECK (space_type IN ('global', 'type', 'agent', 'hybrid')),
                agent_type TEXT CHECK (agent_type IN ('ahive-worker', 'ahive-coder', NULL)),
                agent_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(space_type, agent_type, agent_id)
            );
            
            -- Stage1 输出表
            CREATE TABLE IF NOT EXISTS stage1_outputs (
                thread_id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                source_updated_at INTEGER NOT NULL,
                raw_memory TEXT,
                rollout_summary TEXT,
                rollout_slug TEXT,
                generated_at INTEGER NOT NULL,
                usage_count INTEGER DEFAULT 0,
                last_usage INTEGER,
                selected_for_phase2 INTEGER DEFAULT 0,
                
                FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id) ON DELETE CASCADE
            );
            
            -- 线程表
            CREATE TABLE IF NOT EXISTS threads (
                thread_id TEXT PRIMARY KEY,
                space_id TEXT NOT NULL,
                agent_id TEXT,
                rollout_path TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                title TEXT,
                message_count INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                
                FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id) ON DELETE CASCADE
            );
            
            -- 任务队列表
            CREATE TABLE IF NOT EXISTS memory_jobs (
                job_id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL CHECK (job_type IN ('phase1', 'phase2', 'compaction')),
                space_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
                worker_id TEXT,
                ownership_token TEXT,
                started_at INTEGER,
                finished_at INTEGER,
                lease_until INTEGER,
                retry_count INTEGER DEFAULT 0,
                last_error TEXT,
                
                FOREIGN KEY (space_id) REFERENCES memory_spaces(space_id)
            );
            
            -- 元数据表
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            
            -- 索引
            CREATE INDEX IF NOT EXISTS idx_stage1_space_usage 
                ON stage1_outputs(space_id, usage_count DESC);
            CREATE INDEX IF NOT EXISTS idx_stage1_space_last_usage 
                ON stage1_outputs(space_id, last_usage DESC);
            CREATE INDEX IF NOT EXISTS idx_threads_space_updated 
                ON threads(space_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_jobs_status
                ON memory_jobs(status, lease_until);
        `);

        // 🔧 迁移：添加新列（支持存储完整 CompactedItem）
        try {
            this.db.exec(`ALTER TABLE stage1_outputs ADD COLUMN replacement_history TEXT`);
        } catch { /* 列已存在，忽略 */ }
        try {
            this.db.exec(`ALTER TABLE stage1_outputs ADD COLUMN preserved_count INTEGER`);
        } catch { /* 列已存在，忽略 */ }
        try {
            this.db.exec(`ALTER TABLE stage1_outputs ADD COLUMN original_count INTEGER`);
        } catch { /* 列已存在，忽略 */ }

        // 设置数据库版本
        this.db.prepare(`
            INSERT OR REPLACE INTO metadata (key, value) VALUES ('version', ?)
        `).run(DB_VERSION.toString());
    }
    
    // ==================== 空间管理 ====================
    
    /**
     * 创建或获取记忆空间
     */
    upsertSpace(
        spaceId: string, 
        spaceType: IsolationStrategy, 
        agentType?: AgentType, 
        agentId?: string
    ): void {
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO memory_spaces (space_id, space_type, agent_type, agent_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(space_id) DO UPDATE SET updated_at = excluded.updated_at
        `).run(spaceId, spaceType, agentType || null, agentId || null, now, now);
    }
    
    /**
     * 获取空间记录
     */
    getSpace(spaceId: string): MemorySpaceRecord | undefined {
        return this.db.prepare(`
            SELECT * FROM memory_spaces WHERE space_id = ?
        `).get(spaceId) as MemorySpaceRecord | undefined;
    }
    
    /**
     * 获取所有空间
     */
    getAllSpaces(): MemorySpaceRecord[] {
        return this.db.prepare(`
            SELECT * FROM memory_spaces ORDER BY updated_at DESC
        `).all() as MemorySpaceRecord[];
    }
    
    // ==================== 记忆存储与查询 ====================
    
    /**
     * 获取指定空间的记忆（按使用频率排序）
     */
    getMemoriesForContext(spaceId: string, limit: number = 256, maxUnusedDays: number = 30): Stage1OutputRecord[] {
        const cutoff = Date.now() - daysToMs(maxUnusedDays);
        
        return this.db.prepare(`
            SELECT s.* FROM stage1_outputs s
            JOIN threads t ON s.thread_id = t.thread_id
            WHERE s.space_id = ?
              AND t.archived = 0
              AND (s.last_usage > ? OR s.last_usage IS NULL)
              AND s.raw_memory IS NOT NULL
              AND length(s.raw_memory) > 0
            ORDER BY 
                s.usage_count DESC,
                COALESCE(s.last_usage, s.source_updated_at) DESC
            LIMIT ?
        `).all(spaceId, cutoff, limit) as Stage1OutputRecord[];
    }
    
    /**
     * 获取 Stage1 输出
     */
    getStage1Output(threadId: string): Stage1OutputRecord | undefined {
        return this.db.prepare(`
            SELECT * FROM stage1_outputs WHERE thread_id = ?
        `).get(threadId) as Stage1OutputRecord | undefined;
    }
    
    /**
     * 存储 Stage1 输出
     * 🔧 更新：支持存储完整的 CompactedItem 数据
     */
    upsertStage1Output(spaceId: string, output: Omit<Stage1Output, 'spaceId'>): void {
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO stage1_outputs
            (thread_id, space_id, source_updated_at, raw_memory, rollout_summary,
             rollout_slug, generated_at, usage_count, last_usage,
             replacement_history, preserved_count, original_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                source_updated_at = excluded.source_updated_at,
                raw_memory = excluded.raw_memory,
                rollout_summary = excluded.rollout_summary,
                rollout_slug = excluded.rollout_slug,
                generated_at = excluded.generated_at,
                replacement_history = excluded.replacement_history,
                preserved_count = excluded.preserved_count,
                original_count = excluded.original_count
        `).run(
            output.threadId,
            spaceId,
            output.sourceUpdatedAt.getTime(),
            output.rawMemory || null,
            output.rolloutSummary || null,
            output.rolloutSlug || null,
            now,
            output.replacementHistory ? JSON.stringify(output.replacementHistory) : null,
            output.preservedCount || null,
            output.originalCount || null
        );
    }
    
    // ==================== 使用统计 ====================
    
    /**
     * 更新记忆使用统计
     */
    touchMemory(threadId: string): void {
        this.db.prepare(`
            UPDATE stage1_outputs 
            SET usage_count = usage_count + 1, last_usage = ?
            WHERE thread_id = ?
        `).run(Date.now(), threadId);
    }
    
    /**
     * 批量更新使用统计
     */
    touchMemories(threadIds: string[]): void {
        if (threadIds.length === 0) return;
        
        const now = Date.now();
        const stmt = this.db.prepare(`
            UPDATE stage1_outputs 
            SET usage_count = usage_count + 1, last_usage = ?
            WHERE thread_id = ?
        `);
        
        const updateMany = this.db.transaction((ids: string[]) => {
            for (const id of ids) {
                stmt.run(now, id);
            }
        });
        
        updateMany(threadIds);
    }
    
    // ==================== 线程管理 ====================
    
    /**
     * 创建或更新线程
     */
    upsertThread(
        threadId: string, 
        spaceId: string, 
        rolloutPath: string, 
        agentId?: string,
        title?: string
    ): void {
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO threads (thread_id, space_id, agent_id, rollout_path, created_at, updated_at, title)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                updated_at = excluded.updated_at,
                title = COALESCE(excluded.title, threads.title)
        `).run(threadId, spaceId, agentId || null, rolloutPath, now, now, title || null);
    }
    
    /**
     * 更新线程消息数
     */
    updateThreadMessageCount(threadId: string, count: number): void {
        this.db.prepare(`
            UPDATE threads SET message_count = ?, updated_at = ? WHERE thread_id = ?
        `).run(count, Date.now(), threadId);
    }
    
    /**
     * 获取线程
     */
    getThread(threadId: string): ThreadRecord | undefined {
        return this.db.prepare(`
            SELECT * FROM threads WHERE thread_id = ?
        `).get(threadId) as ThreadRecord | undefined;
    }
    
    /**
     * 获取空间的线程列表
     */
    getThreadsBySpace(spaceId: string, limit: number = 100): ThreadRecord[] {
        return this.db.prepare(`
            SELECT * FROM threads 
            WHERE space_id = ? AND archived = 0
            ORDER BY updated_at DESC 
            LIMIT ?
        `).all(spaceId, limit) as ThreadRecord[];
    }

    getThreadsByAgentId(agentId: string, limit: number = 100): ThreadRecord[] {
        return this.db.prepare(`
            SELECT * FROM threads
            WHERE agent_id = ? AND archived = 0
            ORDER BY updated_at DESC
            LIMIT ?
        `).all(agentId, limit) as ThreadRecord[];
    }

    getActiveThreadIdByAgentId(agentId: string): string | null {
        const row = this.db.prepare(`
            SELECT thread_id FROM threads
            WHERE agent_id = ? AND archived = 0
            ORDER BY updated_at DESC
            LIMIT 1
        `).get(agentId) as { thread_id: string } | undefined;
        return row?.thread_id || null;
    }

    archiveThread(threadId: string): void {
        this.db.prepare(`
            UPDATE threads SET archived = 1 WHERE thread_id = ?
        `).run(threadId);
    }
    
    // ==================== 清理任务 ====================
    
    /**
     * 清理过期记忆
     */
    cleanupStaleMemories(spaceId: string, maxUnusedDays: number = 30): number {
        const cutoff = Date.now() - daysToMs(maxUnusedDays);
        
        const result = this.db.prepare(`
            DELETE FROM stage1_outputs
            WHERE space_id = ?
              AND last_usage < ?
              AND usage_count = 0
        `).run(spaceId, cutoff);
        
        return result.changes;
    }
    
    /**
     * 归档旧线程
     */
    archiveOldThreads(spaceId: string, maxAgeDays: number = 90): number {
        const cutoff = Date.now() - daysToMs(maxAgeDays);
        
        const result = this.db.prepare(`
            UPDATE threads SET archived = 1
            WHERE space_id = ? AND updated_at < ? AND archived = 0
        `).run(spaceId, cutoff);
        
        return result.changes;
    }
    
    /**
     * 删除旧线程
     */
    deleteOldThreads(spaceId: string, maxAgeDays: number = 365): number {
        const cutoff = Date.now() - daysToMs(maxAgeDays);
        
        const result = this.db.prepare(`
            DELETE FROM threads
            WHERE space_id = ? AND updated_at < ?
        `).run(spaceId, cutoff);
        
        return result.changes;
    }
    
    // ==================== 任务队列 ====================
    
    /**
     * 创建任务
     */
    createJob(jobId: string, jobType: 'phase1' | 'phase2' | 'compaction', spaceId?: string): void {
        this.db.prepare(`
            INSERT INTO memory_jobs (job_id, job_type, space_id, status, retry_count)
            VALUES (?, ?, ?, 'pending', 0)
        `).run(jobId, jobType, spaceId || null);
    }
    
    /**
     * 尝试认领任务
     */
    claimJob(jobType: string, workerId: string, leaseMs: number = 300000): MemoryJobRecord | undefined {
        const now = Date.now();
        const leaseUntil = now + leaseMs;
        
        // 查找可认领的任务
        const job = this.db.prepare(`
            SELECT * FROM memory_jobs 
            WHERE job_type = ? AND status IN ('pending', 'error')
              AND (lease_until IS NULL OR lease_until < ?)
            ORDER BY created_at ASC
            LIMIT 1
        `).get(jobType, now) as MemoryJobRecord | undefined;
        
        if (!job) return undefined;
        
        // 尝试获取所有权
        const result = this.db.prepare(`
            UPDATE memory_jobs 
            SET status = 'running', 
                worker_id = ?, 
                ownership_token = ?,
                started_at = ?,
                lease_until = ?
            WHERE job_id = ? AND status IN ('pending', 'error')
        `).run(workerId, crypto.randomUUID(), now, leaseUntil, job.job_id);
        
        if (result.changes === 0) return undefined;
        
        return this.getJob(job.job_id);
    }
    
    /**
     * 获取任务
     */
    getJob(jobId: string): MemoryJobRecord | undefined {
        return this.db.prepare(`
            SELECT * FROM memory_jobs WHERE job_id = ?
        `).get(jobId) as MemoryJobRecord | undefined;
    }
    
    /**
     * 完成任务
     */
    completeJob(jobId: string): void {
        this.db.prepare(`
            UPDATE memory_jobs 
            SET status = 'done', finished_at = ?
            WHERE job_id = ?
        `).run(Date.now(), jobId);
    }
    
    /**
     * 任务失败
     */
    failJob(jobId: string, error: string): void {
        this.db.prepare(`
            UPDATE memory_jobs 
            SET status = 'error', 
                last_error = ?,
                retry_count = retry_count + 1,
                finished_at = ?
            WHERE job_id = ?
        `).run(error, Date.now(), jobId);
    }
    
    // ==================== 统计 ====================
    
    /**
     * 获取空间统计
     */
    getSpaceStats(spaceId: string): {
        threadCount: number;
        memoryCount: number;
        totalUsage: number;
        avgUsageCount: number;
    } {
        const stats = this.db.prepare(`
            SELECT 
                COUNT(DISTINCT t.thread_id) as thread_count,
                COUNT(s.thread_id) as memory_count,
                COALESCE(SUM(s.usage_count), 0) as total_usage,
                COALESCE(AVG(s.usage_count), 0) as avg_usage
            FROM threads t
            LEFT JOIN stage1_outputs s ON t.space_id = s.space_id
            WHERE t.space_id = ? AND t.archived = 0
        `).get(spaceId) as {
            thread_count: number;
            memory_count: number;
            total_usage: number;
            avg_usage: number;
        };
        
        return {
            threadCount: stats.thread_count || 0,
            memoryCount: stats.memory_count || 0,
            totalUsage: stats.total_usage || 0,
            avgUsageCount: Math.round(stats.avg_usage || 0),
        };
    }
    
    // ==================== 维护 ====================
    
    /**
     * 执行 VACUUM
     */
    vacuum(): void {
        this.db.exec('VACUUM');
        console.log('[MemoryDatabase] VACUUM 完成');
    }
    
    /**
     * 关闭数据库
     */
    close(): void {
        this.db.close();
        console.log('[MemoryDatabase] 数据库已关闭');
    }
}