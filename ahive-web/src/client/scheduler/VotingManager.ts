/**
 * 投票管理器
 * 支持多 Agent 投票决策、共识达成、冲突解决
 */

import type { Agent } from '../types';
import { blackboard } from './Blackboard';

// ========== 类型定义 ==========

/** 投票状态 */
export type VoteStatus = 
  | 'pending'      // 等待投票
  | 'voting'       // 投票进行中
  | 'completed'    // 已完成
  | 'cancelled';   // 已取消

/** 投票类型 */
export type VoteType = 
  | 'single'       // 单选
  | 'multiple'     // 多选
  | 'ranking'      // 排序
  | 'score';       // 评分

/** 单个投票 */
export interface Vote {
  /** 投票 ID */
  voteId: string;
  /** 投票主题 */
  topic: string;
  /** 描述 */
  description?: string;
  /** 投票类型 */
  type: VoteType;
  /** 选项 */
  options: VoteOption[];
  /** 参与者 */
  participants: string[];
  /** 当前状态 */
  status: VoteStatus;
  /** 投票结果 */
  result?: VoteResult;
  /** 创建时间 */
  createdAt: string;
  /** 截止时间 */
  deadline?: string;
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 发起者 */
  initiator?: string;
}

/** 投票选项 */
export interface VoteOption {
  /** 选项 ID */
  id: string;
  /** 选项文本 */
  text: string;
  /** 选项描述 */
  description?: string;
  /** 附加数据 */
  data?: unknown;
}

/** 单票 */
export interface Ballot {
  /** 投票 ID */
  voteId: string;
  /** 投票者 ID */
  voterId: string;
  /** 投票者名称 */
  voterName: string;
  /** 选择的选项 ID(s) */
  selections: string[];
  /** 评分 (评分投票时使用) */
  scores?: Record<string, number>;
  /** 理由 */
  reason?: string;
  /** 投票时间 */
  timestamp: string;
  /** 权重 (默认 1) */
  weight?: number;
}

/** 投票结果 */
export interface VoteResult {
  /** 获胜选项 */
  winner: VoteOption;
  /** 所有选项统计 */
  tallies: VoteTally[];
  /** 总票数 */
  totalVotes: number;
  /** 是否达成共识 */
  consensus: boolean;
  /** 共识度 (0-1) */
  consensusLevel: number;
  /** 结束时间 */
  completedAt: string;
  /** 决策方法 */
  method: VoteDecisionMethod;
}

/** 选项统计 */
export interface VoteTally {
  /** 选项 ID */
  optionId: string;
  /** 选项文本 */
  optionText: string;
  /** 票数 */
  count: number;
  /** 百分比 */
  percentage: number;
  /** 总分 (评分投票) */
  totalScore?: number;
  /** 平均分 */
  averageScore?: number;
  /** 排名 */
  rank: number;
}

/** 决策方法 */
export type VoteDecisionMethod = 
  | 'plurality'    // 简单多数
  | 'majority'     // 绝对多数 (>50%)
  | 'supermajority' // 超级多数 (>66%)
  | 'unanimous'    // 一致同意
  | 'borda'        // Borda 计数
  | 'runoff';      // 决选

/** 投票配置 */
export interface VotingConfig {
  /** 默认超时时间 (ms) */
  defaultTimeout: number;
  /** 默认决策方法 */
  defaultMethod: VoteDecisionMethod;
  /** 是否允许弃权 */
  allowAbstain: boolean;
  /** 最少参与人数 */
  minParticipants: number;
  /** 多数阈值 (用于 majority) */
  majorityThreshold: number;
  /** 超级多数阈值 (用于 supermajority) */
  supermajorityThreshold: number;
  /** 是否自动关闭 */
  autoClose: boolean;
}

/** 投票回调 */
export interface VotingCallbacks {
  /** 投票创建回调 */
  onVoteCreated?: (vote: Vote) => void;
  /** 收到投票回调 */
  onBallotReceived?: (ballot: Ballot) => void;
  /** 投票完成回调 */
  onVoteCompleted?: (result: VoteResult) => void;
  /** 请求 Agent 投票 */
  requestAgentVote?: (vote: Vote, agentId: string) => Promise<Ballot | null>;
}

// ========== 投票管理器类 ==========

/**
 * 投票管理器
 * 
 * 功能：
 * 1. 创建和管理投票
 * 2. 收集和统计投票
 * 3. 计算获胜者
 * 4. 支持多种决策方法
 */
export class VotingManager {
  private config: Required<VotingConfig>;
  private votes: Map<string, Vote> = new Map();
  private ballots: Map<string, Ballot[]> = new Map();
  private callbacks: VotingCallbacks = {};
  private agents: Agent[] = [];
  private executeAgentFn: ((agent: Agent, prompt: string) => Promise<{
    success: boolean;
    output: string[];
    error?: string;
  }>) | null = null;

  constructor(config: Partial<VotingConfig> = {}) {
    this.config = {
      defaultTimeout: config.defaultTimeout ?? 60000,
      defaultMethod: config.defaultMethod ?? 'plurality',
      allowAbstain: config.allowAbstain ?? true,
      minParticipants: config.minParticipants ?? 2,
      majorityThreshold: config.majorityThreshold ?? 0.5,
      supermajorityThreshold: config.supermajorityThreshold ?? 0.66,
      autoClose: config.autoClose ?? true,
    };
  }

  // ========== 初始化方法 ==========

  /**
   * 设置 Agent 列表
   */
  setAgents(agents: Agent[]): void {
    this.agents = agents;
  }

  /**
   * 设置执行函数
   */
  setExecuteFn(
    fn: (agent: Agent, prompt: string) => Promise<{
      success: boolean;
      output: string[];
      error?: string;
    }>
  ): void {
    this.executeAgentFn = fn;
  }

  /**
   * 设置回调
   */
  setCallbacks(callbacks: VotingCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // ========== 投票创建方法 ==========

  /**
   * 创建投票
   */
  createVote(
    topic: string,
    options: string[] | VoteOption[],
    config: {
      type?: VoteType;
      participants?: string[];
      description?: string;
      timeout?: number;
      context?: Record<string, unknown>;
      initiator?: string;
      method?: VoteDecisionMethod;
    } = {}
  ): Vote {
    const voteId = `vote-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    // 格式化选项
    const formattedOptions: VoteOption[] = Array.isArray(options) && typeof options[0] === 'string'
      ? (options as string[]).map((text, i) => ({
          id: `opt-${i}`,
          text,
        }))
      : options as VoteOption[];

    // 确定参与者
    const participants = config.participants || this.agents.map(a => a.id);

    const vote: Vote = {
      voteId,
      topic,
      description: config.description,
      type: config.type || 'single',
      options: formattedOptions,
      participants,
      status: 'pending',
      createdAt: new Date().toISOString(),
      deadline: config.timeout 
        ? new Date(Date.now() + config.timeout).toISOString()
        : undefined,
      context: config.context,
      initiator: config.initiator,
    };

    this.votes.set(voteId, vote);
    this.ballots.set(voteId, []);

    // 写入黑板
    blackboard.setVariable(`vote_${voteId}`, vote, { type: 'public' });

    this.callbacks.onVoteCreated?.(vote);

    console.log(`[Voting] Created vote: ${topic} (${participants.length} participants)`);

    return vote;
  }

  /**
   * 快速投票 (简化接口)
   */
  async quickVote(
    topic: string,
    options: string[],
    participants?: string[]
  ): Promise<VoteResult> {
    const vote = this.createVote(topic, options, { participants });
    await this.startVoting(vote.voteId);
    return this.waitForResult(vote.voteId);
  }

  // ========== 投票执行方法 ==========

  /**
   * 开始投票
   */
  async startVoting(voteId: string): Promise<void> {
    const vote = this.votes.get(voteId);
    if (!vote) {
      throw new Error(`Vote not found: ${voteId}`);
    }

    if (vote.status !== 'pending') {
      throw new Error(`Vote is not in pending status: ${vote.status}`);
    }

    vote.status = 'voting';
    this.votes.set(voteId, vote);

    console.log(`[Voting] Started voting: ${vote.topic}`);

    // 请求参与者投票
    const votePromises = vote.participants.map(agentId => 
      this.requestVote(vote, agentId)
    );

    // 并行请求所有投票
    await Promise.allSettled(votePromises);

    // 自动关闭
    if (this.config.autoClose) {
      // 如果有截止时间，等待截止
      if (vote.deadline) {
        const delay = new Date(vote.deadline).getTime() - Date.now();
        if (delay > 0) {
          setTimeout(() => this.closeVote(voteId), delay);
        }
      } else {
        // 所有参与者都投票后关闭
        await this.closeVote(voteId);
      }
    }
  }

  /**
   * 请求 Agent 投票
   */
  private async requestVote(vote: Vote, agentId: string): Promise<void> {
    // 使用自定义回调
    if (this.callbacks.requestAgentVote) {
      const ballot = await this.callbacks.requestAgentVote(vote, agentId);
      if (ballot) {
        this.submitBallot(ballot);
      }
      return;
    }

    // 使用默认实现
    if (!this.executeAgentFn) {
      console.warn(`[Voting] No execute function set, agent ${agentId} cannot vote`);
      return;
    }

    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) {
      console.warn(`[Voting] Agent not found: ${agentId}`);
      return;
    }

    // 构建投票提示
    const prompt = this.buildVotingPrompt(vote);

    try {
      const result = await this.executeAgentFn(agent, prompt);
      
      if (result.success && result.output.length > 0) {
        // 解析投票响应
        const ballot = this.parseVoteResponse(vote, agent, result.output.join('\n'));
        if (ballot) {
          this.submitBallot(ballot);
        }
      }
    } catch (error) {
      console.error(`[Voting] Agent ${agent.name} failed to vote:`, error);
    }
  }

  /**
   * 构建投票提示
   */
  private buildVotingPrompt(vote: Vote): string {
    const optionsText = vote.options.map((opt, i) => 
      `${i + 1}. ${opt.text}${opt.description ? ` - ${opt.description}` : ''}`
    ).join('\n');

    let typeInstruction = '';
    switch (vote.type) {
      case 'single':
        typeInstruction = '请选择一个选项，回复选项编号或选项文本。';
        break;
      case 'multiple':
        typeInstruction = '可以选择多个选项，回复选项编号或文本，用逗号分隔。';
        break;
      case 'ranking':
        typeInstruction = '请对选项进行排序，回复如 "1>2>3" 或 "A,B,C"。';
        break;
      case 'score':
        typeInstruction = '请为每个选项打分 (1-10)，回复如 "选项A:8, 选项B:6"。';
        break;
    }

    return `## 投票请求

**主题**: ${vote.topic}
${vote.description ? `\n**说明**: ${vote.description}\n` : ''}

### 选项:
${optionsText}

### 投票说明:
${typeInstruction}

请直接回复你的选择。如需说明理由，可以在选择后添加理由。`;
  }

  /**
   * 解析投票响应
   */
  private parseVoteResponse(vote: Vote, agent: Agent, response: string): Ballot | null {
    const responseLower = response.toLowerCase().trim();
    
    // 尝试解析选择
    let selections: string[] = [];

    // 检查是否包含选项文本
    for (const option of vote.options) {
      if (responseLower.includes(option.text.toLowerCase())) {
        selections.push(option.id);
      }
    }

    // 检查是否包含选项编号
    const numberMatch = responseLower.match(/\b([1-9])\b/);
    if (numberMatch && selections.length === 0) {
      const index = parseInt(numberMatch[1]) - 1;
      if (index >= 0 && index < vote.options.length) {
        selections = [vote.options[index].id];
      }
    }

    if (selections.length === 0) {
      // 默认选择第一个选项
      selections = [vote.options[0].id];
    }

    // 解析理由
    let reason: string | undefined;
    const reasonMatch = response.match(/(?:理由|因为|reason)[：:]\s*(.+)/i);
    if (reasonMatch) {
      reason = reasonMatch[1].trim();
    }

    return {
      voteId: vote.voteId,
      voterId: agent.id,
      voterName: agent.name,
      selections,
      reason,
      timestamp: new Date().toISOString(),
      weight: 1,
    };
  }

  // ========== 投票提交方法 ==========

  /**
   * 提交投票
   */
  submitBallot(ballot: Ballot): boolean {
    const vote = this.votes.get(ballot.voteId);
    if (!vote) {
      console.error(`[Voting] Vote not found: ${ballot.voteId}`);
      return false;
    }

    if (vote.status !== 'voting') {
      console.error(`[Voting] Vote is not open for voting: ${vote.status}`);
      return false;
    }

    // 验证参与者
    if (!vote.participants.includes(ballot.voterId)) {
      console.error(`[Voting] Voter not authorized: ${ballot.voterId}`);
      return false;
    }

    // 验证选择
    const validOptionIds = vote.options.map(o => o.id);
    const invalidSelections = ballot.selections.filter(s => !validOptionIds.includes(s));
    if (invalidSelections.length > 0) {
      console.error(`[Voting] Invalid selections: ${invalidSelections.join(', ')}`);
      return false;
    }

    // 添加投票
    const ballots = this.ballots.get(ballot.voteId) || [];
    
    // 检查是否已投票 (更新投票)
    const existingIndex = ballots.findIndex(b => b.voterId === ballot.voterId);
    if (existingIndex >= 0) {
      ballots[existingIndex] = ballot;
    } else {
      ballots.push(ballot);
    }
    
    this.ballots.set(ballot.voteId, ballots);

    // 写入黑板
    blackboard.setVariable(
      `ballot_${ballot.voteId}_${ballot.voterId}`,
      ballot,
      { type: 'public' }
    );

    this.callbacks.onBallotReceived?.(ballot);

    console.log(`[Voting] Ballot received from ${ballot.voterName}: ${ballot.selections.join(', ')}`);

    return true;
  }

  /**
   * 关闭投票并计算结果
   */
  closeVote(voteId: string): VoteResult | null {
    const vote = this.votes.get(voteId);
    if (!vote) {
      return null;
    }

    const ballots = this.ballots.get(voteId) || [];
    
    if (ballots.length < this.config.minParticipants) {
      console.warn(`[Voting] Not enough participants: ${ballots.length} < ${this.config.minParticipants}`);
    }

    // 计算结果
    const result = this.calculateResult(vote, ballots);
    
    vote.status = 'completed';
    vote.result = result;
    this.votes.set(voteId, vote);

    // 更新黑板
    blackboard.setVariable(`vote_${voteId}`, vote, { type: 'public' });
    blackboard.setVariable(`vote_result_${voteId}`, result, { type: 'public' });

    this.callbacks.onVoteCompleted?.(result);

    console.log(`[Voting] Vote completed: ${result.winner.text} (${result.consensusLevel * 100}% consensus)`);

    return result;
  }

  /**
   * 计算投票结果
   */
  private calculateResult(vote: Vote, ballots: Ballot[]): VoteResult {
    const method = vote.context?.method as VoteDecisionMethod || this.config.defaultMethod;
    
    // 统计票数
    const tallies: VoteTally[] = vote.options.map(option => ({
      optionId: option.id,
      optionText: option.text,
      count: 0,
      percentage: 0,
      rank: 0,
    }));

    // 根据投票类型统计
    for (const ballot of ballots) {
      const weight = ballot.weight || 1;
      
      for (const selection of ballot.selections) {
        const tally = tallies.find(t => t.optionId === selection);
        if (tally) {
          tally.count += weight;
        }
      }

      // 评分投票
      if (vote.type === 'score' && ballot.scores) {
        for (const [optionId, score] of Object.entries(ballot.scores)) {
          const tally = tallies.find(t => t.optionId === optionId);
          if (tally) {
            tally.totalScore = (tally.totalScore || 0) + score * weight;
          }
        }
      }
    }

    // 计算百分比和排名
    const totalVotes = ballots.reduce((sum, b) => sum + (b.weight || 1), 0);
    
    for (const tally of tallies) {
      tally.percentage = totalVotes > 0 ? tally.count / totalVotes : 0;
      if (tally.totalScore !== undefined && tally.count > 0) {
        tally.averageScore = tally.totalScore / tally.count;
      }
    }

    // 排序和排名
    tallies.sort((a, b) => {
      if (vote.type === 'score') {
        return (b.averageScore || 0) - (a.averageScore || 0);
      }
      return b.count - a.count;
    });

    tallies.forEach((tally, index) => {
      tally.rank = index + 1;
    });

    // 确定获胜者
    const winner = this.determineWinner(vote, tallies, totalVotes, method);

    // 计算共识度
    const consensusLevel = this.calculateConsensusLevel(tallies, method);

    return {
      winner: vote.options.find(o => o.id === winner.optionId)!,
      tallies,
      totalVotes,
      consensus: this.checkConsensus(tallies, method),
      consensusLevel,
      completedAt: new Date().toISOString(),
      method,
    };
  }

  /**
   * 确定获胜者
   */
  private determineWinner(
    vote: Vote,
    tallies: VoteTally[],
    totalVotes: number,
    method: VoteDecisionMethod
  ): VoteTally {
    switch (method) {
      case 'majority':
        // 需要超过 50%
        const majorityTally = tallies.find(t => t.percentage > this.config.majorityThreshold);
        return majorityTally || tallies[0];

      case 'supermajority':
        // 需要超过 66%
        const superTally = tallies.find(t => t.percentage > this.config.supermajorityThreshold);
        return superTally || tallies[0];

      case 'unanimous':
        // 需要一致同意
        const unanimousTally = tallies.find(t => t.percentage === 1);
        return unanimousTally || tallies[0];

      case 'borda':
        // Borda 计数法
        const bordaTallies = tallies.map((t, i) => ({
          ...t,
          bordaScore: tallies.length - i,
        }));
        bordaTallies.sort((a, b) => b.bordaScore - a.bordaScore);
        return bordaTallies[0];

      case 'runoff':
        // 决选法 - 简化实现
        return tallies[0];

      case 'plurality':
      default:
        // 简单多数
        return tallies[0];
    }
  }

  /**
   * 检查是否达成共识
   */
  private checkConsensus(tallies: VoteTally[], method: VoteDecisionMethod): boolean {
    const topTally = tallies[0];
    
    switch (method) {
      case 'majority':
        return topTally.percentage > this.config.majorityThreshold;
      case 'supermajority':
        return topTally.percentage > this.config.supermajorityThreshold;
      case 'unanimous':
        return topTally.percentage === 1;
      default:
        return topTally.percentage > 0.5;
    }
  }

  /**
   * 计算共识度
   */
  private calculateConsensusLevel(tallies: VoteTally[], method: VoteDecisionMethod): number {
    if (tallies.length === 0) return 0;
    
    const topTally = tallies[0];
    return topTally.percentage;
  }

  // ========== 辅助方法 ==========

  /**
   * 等待投票结果
   */
  async waitForResult(voteId: string, timeout?: number): Promise<VoteResult> {
    const vote = this.votes.get(voteId);
    if (!vote) {
      throw new Error(`Vote not found: ${voteId}`);
    }

    if (vote.status === 'completed' && vote.result) {
      return vote.result;
    }

    // 等待投票完成
    return new Promise((resolve, reject) => {
      const timeoutMs = timeout || this.config.defaultTimeout;
      let checkInterval: ReturnType<typeof setInterval> | null = null;
      
      const timer = setTimeout(() => {
        // 超时时清理 checkInterval
        if (checkInterval) {
          clearInterval(checkInterval);
        }
        reject(new Error('Voting timeout'));
      }, timeoutMs);

      checkInterval = setInterval(() => {
        const v = this.votes.get(voteId);
        if (v?.status === 'completed' && v.result) {
          clearInterval(checkInterval!);
          clearTimeout(timer);
          resolve(v.result);
        }
      }, 100);
    });
  }

  /**
   * 获取投票信息
   */
  getVote(voteId: string): Vote | undefined {
    return this.votes.get(voteId);
  }

  /**
   * 获取所有活跃投票
   */
  getActiveVotes(): Vote[] {
    return Array.from(this.votes.values()).filter(v => v.status === 'voting');
  }

  /**
   * 取消投票
   */
  cancelVote(voteId: string): boolean {
    const vote = this.votes.get(voteId);
    if (!vote || vote.status === 'completed') {
      return false;
    }

    vote.status = 'cancelled';
    this.votes.set(voteId, vote);
    return true;
  }

  /**
   * 获取投票统计
   */
  getVoteStats(voteId: string): {
    totalParticipants: number;
    votedCount: number;
    participationRate: number;
  } | null {
    const vote = this.votes.get(voteId);
    const ballots = this.ballots.get(voteId);
    
    if (!vote || !ballots) {
      return null;
    }

    const votedCount = new Set(ballots.map(b => b.voterId)).size;
    
    return {
      totalParticipants: vote.participants.length,
      votedCount,
      participationRate: votedCount / vote.participants.length,
    };
  }
}

// ========== 默认实例 ==========

export const votingManager = new VotingManager();

// ========== 辅助函数 ==========

/**
 * 创建投票选项
 */
export function createVoteOption(text: string, description?: string, data?: unknown): VoteOption {
  return {
    id: `opt-${Math.random().toString(36).slice(2, 7)}`,
    text,
    description,
    data,
  };
}

/**
 * 创建投票
 */
export function createVote(
  topic: string,
  options: string[],
  participants?: string[]
): Promise<VoteResult> {
  return votingManager.quickVote(topic, options, participants);
}