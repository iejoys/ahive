/**
 * Config Store - 配置存储
 * 
 * 功能：
 * - 智能体配置持久化（JSON 文件）
 * - 配额配置持久化
 * - 自动加载和保存
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/index.js';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ 接口定义 ============

/**
 * 智能体配置
 */
export interface AgentConfig {
  id: string;
  name: string;
  tokenHash: string;
  rawToken?: string;  // 仅在创建时返回，不保存
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  description?: string;
  type?: 'ahive-worker' | 'ahive-coder';
  model?: {
    provider?: 'openai' | 'anthropic' | 'ollama' | 'local' | 'bailian' | 'custom';
    name?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
  };
  /** 分身默认模型配置 - 设置后所有子分身自动使用此模型 */
  spawnModel?: {
    provider?: 'openai' | 'anthropic' | 'ollama' | 'local' | 'bailian' | 'custom';
    name?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
  };
  /** 最大分身数量，默认 3 */
  maxSpawns?: number;
}

/**
 * 配额配置
 */
export interface QuotaConfig {
  agent_id: string;
  monthly_budget: number;
  daily_budget: number;
  qpm_limit: number;
  concurrent_limit: number;
  token_limit_per_minute: number;
  updatedAt: string;
}

/**
 * 完整配置
 */
export interface FullConfig {
  version: string;
  agents: Record<string, AgentConfig>;
  quotas: Record<string, QuotaConfig>;
  updatedAt: string;
}

// ============ 配置存储类 ============

export class ConfigStore {
  private configPath: string;
  private config: FullConfig;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'config', 'ahive-config.json');
    this.config = this.load();
  }

  /**
   * 加载配置
   */
  private load(): FullConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(data);
        logger.info(`📂 [Config Store] 已加载配置：${this.configPath}`);
        return config;
      }
    } catch (error) {
      logger.warn(`⚠️ [Config Store] 加载配置失败：${error}，使用默认配置`);
    }

    // 返回默认配置
    return this.createDefaultConfig();
  }

  /**
   * 创建默认配置
   */
  private createDefaultConfig(): FullConfig {
    const now = new Date().toISOString();
    const config: FullConfig = {
      version: '1.0',
      updatedAt: now,
      agents: {
'ahive-worker': {
    id: 'ahive-worker',
          name: 'OpenClaw',
          tokenHash: this.hashToken('ahive-openclaw-default-token'),
          rawToken: 'ahive-openclaw-default-token',
          enabled: true,
          createdAt: now,
          updatedAt: now,
          description: '多通道智能体网关',
        },
        'pi': {
          id: 'pi',
          name: 'Pi Agent',
          tokenHash: this.hashToken('ahive-pi-default-token'),
          rawToken: 'ahive-pi-default-token',
          enabled: true,
          createdAt: now,
          updatedAt: now,
          description: '轻量级 AI 助手',
        },
        'claude': {
          id: 'claude',
          name: 'Claude Code',
          tokenHash: this.hashToken('ahive-claude-default-token'),
          rawToken: 'ahive-claude-default-token',
          enabled: true,
          createdAt: now,
          updatedAt: now,
          description: 'Anthropic 编码助手',
        },
      },
      quotas: {
'ahive-worker': {
    agent_id: 'ahive-worker',
          monthly_budget: 500,
          daily_budget: 50,
          qpm_limit: 60,
          concurrent_limit: 5,
          token_limit_per_minute: 100000,
          updatedAt: now,
        },
        'pi': {
          agent_id: 'pi',
          monthly_budget: 200,
          daily_budget: 20,
          qpm_limit: 30,
          concurrent_limit: 2,
          token_limit_per_minute: 50000,
          updatedAt: now,
        },
        'claude': {
          agent_id: 'claude',
          monthly_budget: 300,
          daily_budget: 30,
          qpm_limit: 40,
          concurrent_limit: 3,
          token_limit_per_minute: 75000,
          updatedAt: now,
        },
        'default': {
          agent_id: 'default',
          monthly_budget: 100,
          daily_budget: 10,
          qpm_limit: 20,
          concurrent_limit: 2,
          token_limit_per_minute: 30000,
          updatedAt: now,
        },
      },
    };

    // 保存默认配置
    this.save(config);
    logger.info(`📂 [Config Store] 已创建默认配置：${this.configPath}`);

    return config;
  }

  /**
   * 保存配置
   */
  private save(config?: FullConfig): void {
    try {
      const configToSave = config || this.config;
      configToSave.updatedAt = new Date().toISOString();

      // 确保目录存在
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件（格式化 JSON）
      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
      logger.debug(`💾 [Config Store] 配置已保存`);
    } catch (error) {
      logger.error(`❌ [Config Store] 保存配置失败：${error}`);
    }
  }

  /**
   * 哈希 Token
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * 生成新 Token
   */
  generateToken(agentId: string): string {
    const random = crypto.randomBytes(16).toString('hex');
    return `ahive-${agentId}-${random}`;
  }

  /**
   * 获取智能体
   */
  getAgent(agentId: string): AgentConfig | undefined {
    return this.config.agents[agentId];
  }

  /**
   * 获取所有智能体
   */
  getAllAgents(): AgentConfig[] {
    return Object.values(this.config.agents);
  }

  /**
   * 创建智能体
   */
  createAgent(agentId: string, name?: string): AgentConfig {
    if (this.config.agents[agentId]) {
      throw new Error(`Agent ${agentId} already exists`);
    }

    const now = new Date().toISOString();
    const rawToken = this.generateToken(agentId);
    const agent: AgentConfig = {
      id: agentId,
      name: name || agentId,
      tokenHash: this.hashToken(rawToken),
      rawToken,  // 返回明文 Token（仅一次）
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    this.config.agents[agentId] = agent;
    this.save();

    logger.info(`✅ [Config Store] 已创建智能体：${agentId}`);

    // 创建默认配额
    if (!this.config.quotas[agentId]) {
      this.updateQuota({
        agent_id: agentId,
        monthly_budget: 100,
        daily_budget: 10,
        qpm_limit: 20,
        concurrent_limit: 2,
        token_limit_per_minute: 30000,
        updatedAt: new Date().toISOString(),
      } as any);
    }

    return agent;
  }

  /**
   * 更新智能体
   */
  updateAgent(agentId: string, updates: Partial<AgentConfig>): AgentConfig | undefined {
    const agent = this.config.agents[agentId];
    if (!agent) {
      return undefined;
    }

    Object.assign(agent, updates, { updatedAt: new Date().toISOString() });
    this.save();

    logger.info(`🔄 [Config Store] 已更新智能体：${agentId}`);

    return agent;
  }

  /**
   * 删除智能体
   */
  deleteAgent(agentId: string): boolean {
    if (!this.config.agents[agentId]) {
      return false;
    }

    delete this.config.agents[agentId];
    delete this.config.quotas[agentId];
    this.save();

    logger.info(`🗑️ [Config Store] 已删除智能体：${agentId}`);

    return true;
  }

  /**
   * 验证 Token
   */
  validateToken(agentId: string, token: string): boolean {
    const agent = this.config.agents[agentId];
    if (!agent || !agent.enabled) {
      return false;
    }

    const tokenHash = this.hashToken(token);
    return agent.tokenHash === tokenHash;
  }

  /**
   * 重置 Token
   */
  resetToken(agentId: string): string | undefined {
    const agent = this.config.agents[agentId];
    if (!agent) {
      return undefined;
    }

    const rawToken = this.generateToken(agentId);
    agent.tokenHash = this.hashToken(rawToken);
    agent.rawToken = rawToken;
    agent.updatedAt = new Date().toISOString();
    this.save();

    logger.info(`🔄 [Config Store] 已重置智能体 Token: ${agentId}`);

    return rawToken;
  }

  /**
   * 获取智能体模型配置
   */
  getAgentModel(agentId: string): AgentConfig['model'] | undefined {
    const agent = this.config.agents[agentId];
    return agent?.model;
  }

  /**
   * 设置智能体模型配置
   */
  setAgentModel(agentId: string, model: AgentConfig['model']): AgentConfig | undefined {
    const agent = this.config.agents[agentId];
    if (!agent) {
      return undefined;
    }

    agent.model = { ...agent.model, ...model };
    agent.updatedAt = new Date().toISOString();
    this.save();

    logger.info(`🤖 [Config Store] 已更新智能体模型配置：${agentId}`, model);

    return agent;
  }

  /**
   * 获取配额
   */
  getQuota(agentId: string): QuotaConfig | undefined {
    return this.config.quotas[agentId] || this.config.quotas['default'];
  }

  /**
   * 更新配额
   */
  updateQuota(quota: QuotaConfig): QuotaConfig {
    this.config.quotas[quota.agent_id] = {
      ...quota,
      updatedAt: new Date().toISOString(),
    };
    this.save();

    logger.info(`📊 [Config Store] 已更新配额：${quota.agent_id}`);

    return quota;
  }

  /**
   * 获取所有配额
   */
  getAllQuotas(): QuotaConfig[] {
    return Object.values(this.config.quotas);
  }

  /**
   * 导出配置（不含 Token 哈希）
   */
  exportConfig(): any {
    const agents = Object.fromEntries(
      Object.entries(this.config.agents).map(([id, agent]) => [
        id,
        {
          id: agent.id,
          name: agent.name,
          enabled: agent.enabled,
          createdAt: agent.createdAt,
          description: agent.description,
        },
      ])
    );

    return {
      version: this.config.version,
      agents,
      quotas: this.config.quotas,
      updatedAt: this.config.updatedAt,
    };
  }

  /**
   * 获取配置路径
   */
  getConfigPath(): string {
    return this.configPath;
  }
}

// 全局单例
export const configStore = new ConfigStore();
