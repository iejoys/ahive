/**
 * AHIVECORE 记忆路由器
 * 
 * 根据隔离策略将智能体路由到对应的记忆空间
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { 
    MemorySpace, 
    AgentType, 
    IsolationStrategy 
} from './types.js';

export class MemoryRouter {
    private db: Database.Database;
    private strategy: IsolationStrategy;
    private memoryRoot: string;
    private spaceCache: Map<string, MemorySpace> = new Map();
    
    constructor(config: {
        db: Database.Database;
        strategy: IsolationStrategy;
        memoryRoot: string;
    }) {
        this.db = config.db;
        this.strategy = config.strategy;
        this.memoryRoot = config.memoryRoot;
        
        // 确保根目录存在
        if (!fs.existsSync(this.memoryRoot)) {
            fs.mkdirSync(this.memoryRoot, { recursive: true });
        }
        
        // 初始化默认空间
        this.initDefaultSpaces();
        
        console.log(`[MemoryRouter] 初始化完成，隔离策略: ${this.strategy}`);
    }
    
    /**
     * 初始化默认空间
     */
    private initDefaultSpaces(): void {
        switch (this.strategy) {
            case 'global':
                this.createSpace('global', 'global');
                break;
                
            case 'type':
                this.createSpace('type:ahive-worker', 'type', 'ahive-worker');
                this.createSpace('type:ahive-coder', 'type', 'ahive-coder');
                break;
                
            case 'hybrid':
                this.createSpace('type:ahive-worker', 'type', 'ahive-worker');
                this.createSpace('type:ahive-coder', 'type', 'ahive-coder');
                break;
        }
    }
    
    /**
     * 获取智能体对应的记忆空间
     */
    getSpace(agentId: string, agentType: AgentType): MemorySpace {
        const key = this.getSpaceKey(agentId, agentType);
        
        if (this.spaceCache.has(key)) {
            return this.spaceCache.get(key)!;
        }
        
        const space = this.resolveOrCreateSpace(agentId, agentType);
        this.spaceCache.set(key, space);
        return space;
    }
    
    /**
     * 获取空间缓存键
     */
    private getSpaceKey(agentId: string, agentType: string): string {
        switch (this.strategy) {
            case 'global':
                return 'global';
            case 'type':
            case 'hybrid':
                return `type:${agentType}`;
            case 'agent':
                return `agent:${agentId}`;
        }
    }
    
    /**
     * 解析或创建空间
     */
    private resolveOrCreateSpace(agentId: string, agentType: AgentType): MemorySpace {
        let spaceId: string;
        let spaceType: string;
        let fsPath: string;
        
        switch (this.strategy) {
            case 'global':
                spaceId = 'global';
                spaceType = 'global';
                fsPath = path.join(this.memoryRoot, 'spaces', 'global');
                break;
                
            case 'type':
            case 'hybrid':
                spaceId = `type:${agentType}`;
                spaceType = 'type';
                fsPath = path.join(this.memoryRoot, 'spaces', agentType);
                break;
                
            case 'agent':
                spaceId = `agent:${agentId}`;
                spaceType = 'agent';
                fsPath = path.join(this.memoryRoot, 'spaces', 'agents', agentId);
                break;
        }
        
        // 创建文件系统结构
        this.ensureSpaceDir(fsPath);
        
        // 创建数据库记录
        this.createSpace(spaceId, spaceType as IsolationStrategy, agentType, 
            this.strategy === 'agent' ? agentId : undefined);
        
        return {
            spaceId,
            spaceType: spaceType as IsolationStrategy,
            agentType,
            agentId: this.strategy === 'agent' ? agentId : undefined,
            fsPath,
        };
    }
    
    /**
     * 确保空间目录存在
     */
    private ensureSpaceDir(fsPath: string): void {
        if (!fs.existsSync(fsPath)) {
            fs.mkdirSync(fsPath, { recursive: true });
        }
        
        const rolloutsDir = path.join(fsPath, 'rollouts');
        const summariesDir = path.join(fsPath, 'rollout_summaries');
        
        if (!fs.existsSync(rolloutsDir)) {
            fs.mkdirSync(rolloutsDir, { recursive: true });
        }
        if (!fs.existsSync(summariesDir)) {
            fs.mkdirSync(summariesDir, { recursive: true });
        }
    }
    
    /**
     * 创建空间记录
     */
    private createSpace(
        spaceId: string, 
        spaceType: IsolationStrategy, 
        agentType?: AgentType, 
        agentId?: string
    ): void {
        const now = Date.now();
        this.db.prepare(`
            INSERT OR IGNORE INTO memory_spaces 
            (space_id, space_type, agent_type, agent_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(spaceId, spaceType, agentType || null, agentId || null, now, now);
    }
    
    /**
     * 获取所有空间
     */
    getAllSpaces(): MemorySpace[] {
        const records = this.db.prepare(`
            SELECT * FROM memory_spaces ORDER BY updated_at DESC
        `).all() as Array<{
            space_id: string;
            space_type: IsolationStrategy;
            agent_type: string | null;
            agent_id: string | null;
        }>;
        
        return records.map(r => ({
            spaceId: r.space_id,
            spaceType: r.space_type,
            agentType: r.agent_type as AgentType | undefined,
            agentId: r.agent_id || undefined,
            fsPath: this.getSpaceFsPath(r.space_id, r.space_type, r.agent_type, r.agent_id),
        }));
    }
    
    /**
     * 获取空间文件系统路径
     */
    private getSpaceFsPath(
        spaceId: string, 
        spaceType: string, 
        agentType: string | null, 
        agentId: string | null
    ): string {
        switch (spaceType) {
            case 'global':
                return path.join(this.memoryRoot, 'spaces', 'global');
            case 'type':
                return path.join(this.memoryRoot, 'spaces', agentType || 'unknown');
            case 'agent':
                return path.join(this.memoryRoot, 'spaces', 'agents', agentId || 'unknown');
            default:
                return path.join(this.memoryRoot, 'spaces', spaceId.replace(':', path.sep));
        }
    }
    
    /**
     * 清除缓存
     */
    clearCache(): void {
        this.spaceCache.clear();
    }
    
    /**
     * 获取隔离策略
     */
    getStrategy(): IsolationStrategy {
        return this.strategy;
    }
    
    /**
     * 设置隔离策略（需要重新初始化）
     */
    setStrategy(strategy: IsolationStrategy): void {
        this.strategy = strategy;
        this.clearCache();
        this.initDefaultSpaces();
        console.log(`[MemoryRouter] 隔离策略已更新: ${strategy}`);
    }
}