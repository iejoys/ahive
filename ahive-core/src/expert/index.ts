/**
 * Expert Agent - 知识库专家智能体
 * 
 * 基于 RAG (Retrieval Augmented Generation) 实现
 * 功能：
 * - 专业领域问答
 * - 知识检索与引用
 * - 多轮对话
 * - 置信度评估
 */

import type { KnowledgeBase, SearchResult } from '../knowledge/index.js';
import type { LLMClient } from '../agents/index.js';

// ============ 核心接口 ============

/**
 * 专家配置
 */
export interface ExpertConfig {
  name: string;                    // 专家名称
  domain: string;                  // 专业领域
  description?: string;            // 专家描述
  tone?: 'professional' | 'friendly' | 'casual';  // 语气风格
  maxContextLength?: number;       // 最大上下文长度
  confidenceThreshold?: number;    // 置信度阈值
}

/**
 * 答案对象
 */
export interface Answer {
  content: string;                 // 答案内容
  confidence: number;              // 置信度 (0-1)
  sources: Source[];               // 引用来源
  followUp?: string[];             // 后续问题建议
  actions?: Action[];              // 可执行操作
  metadata?: Record<string, any>;
}

/**
 * 引用来源
 */
export interface Source {
  docId: string;                   // 文档 ID
  chunkId: string;                 // 知识块 ID
  content: string;                 // 引用内容
  score: number;                   // 相关度分数
  metadata?: Record<string, any>;
}

/**
 * 可执行操作
 */
export interface Action {
  label: string;                   // 操作标签
  type: 'link' | 'command' | 'form' | 'contact';
  value: string;                   // 操作值
  description?: string;
}

/**
 * 对话消息
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  answer?: Answer;
}

/**
 * 对话会话
 */
export interface ChatSession {
  id: string;
  userId?: string;
  messages: ChatMessage[];
  context?: string;                // 当前话题
  createdAt: Date;
  lastActiveAt: Date;
}

// ============ 专家智能体实现 ============

/**
 * 专家智能体
 */
export class ExpertAgent {
  private config: ExpertConfig;
  private knowledgeBase: KnowledgeBase;
  private llm?: LLMClient;
  private sessions: Map<string, ChatSession> = new Map();

  constructor(
    config: ExpertConfig,
    knowledgeBase: KnowledgeBase,
    llm?: LLMClient
  ) {
    this.config = {
      tone: 'professional',
      maxContextLength: 10,
      confidenceThreshold: 0.7,
      ...config
    };
    this.knowledgeBase = knowledgeBase;
    this.llm = llm;
  }

  /**
   * 单次问答
   */
  async answer(question: string): Promise<Answer> {
    // 1. 检索相关知识
    const results = await this.knowledgeBase.search(question, 5);
    
    // 2. 评估置信度
    const confidence = this.calculateConfidence(results);
    
    // 3. 构建答案
    const answer = await this.buildAnswer(question, results, confidence);
    
    // 4. 添加元数据
    answer.metadata = {
      queryTime: new Date().toISOString(),
      resultCount: results.length,
      domain: this.config.domain,
    };

    return answer;
  }

  /**
   * 对话聊天
   */
  async chat(sessionId: string, message: string): Promise<Answer> {
    // 获取或创建会话
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.createSession(sessionId);
    }

    // 添加用户消息
    const userMessage: ChatMessage = {
      id: this.generateId('msg'),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    session.messages.push(userMessage);

    // 生成答案
    const answer = await this.answer(message);

    // 添加助手回复
    const assistantMessage: ChatMessage = {
      id: this.generateId('msg'),
      role: 'assistant',
      content: answer.content,
      timestamp: new Date(),
      answer,
    };
    session.messages.push(assistantMessage);

    // 更新会话
    session.lastActiveAt = new Date();
    this.sessions.set(sessionId, session);

    return answer;
  }

  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.sessions.get(sessionId);
  }

  /**
   * 清除会话
   */
  async clearSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /**
   * 获取专家信息
   */
  getInfo() {
    return {
      name: this.config.name,
      domain: this.config.domain,
      description: this.config.description,
      tone: this.config.tone,
    };
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(results: SearchResult[]): number {
    if (results.length === 0) {
      return 0.1;
    }

    // 基于最高相关度分数
    const maxScore = Math.max(...results.map(r => r.score));
    
    // 基于结果数量
    const countBonus = Math.min(results.length * 0.05, 0.2);
    
    // 综合置信度
    return Math.min(maxScore + countBonus, 1.0);
  }

  /**
   * 构建答案
   */
  private async buildAnswer(
    question: string,
    results: SearchResult[],
    confidence: number
  ): Promise<Answer> {
    // 如果没有 LLM，使用模板答案
    if (!this.llm) {
      return this.buildTemplateAnswer(question, results, confidence);
    }

    // 使用 LLM 生成答案
    return this.buildLLMAnswer(question, results, confidence);
  }

  /**
   * 模板答案（无 LLM 时）
   */
  private buildTemplateAnswer(
    question: string,
    results: SearchResult[],
    confidence: number
  ): Answer {
    const sources: Source[] = results.map(r => ({
      docId: r.chunk.docId,
      chunkId: r.chunk.id,
      content: r.chunk.content,
      score: r.score,
      metadata: r.chunk.metadata,
    }));

    let content = '';

    if (confidence < 0.3) {
      content = `抱歉，我在知识库中没有找到与"${question}"高度相关的信息。建议您：\n\n1. 尝试用不同的措辞提问\n2. 联系人工客服获取帮助\n3. 查看相关文档`;
    } else {
      content = `根据我的知识库，${this.formatAnswer(results)}\n\n[置信度：${(confidence * 100).toFixed(0)}%]`;
    }

    return {
      content,
      confidence,
      sources,
      followUp: this.suggestFollowUp(question, results),
    };
  }

  /**
   * LLM 答案（有 LLM 时）
   */
  private async buildLLMAnswer(
    question: string,
    results: SearchResult[],
    confidence: number
  ): Promise<Answer> {
    const sources: Source[] = results.map(r => ({
      docId: r.chunk.docId,
      chunkId: r.chunk.id,
      content: r.chunk.content,
      score: r.score,
      metadata: r.chunk.metadata,
    }));

    // 构建提示词
    const prompt = this.buildPrompt(question, results);

    // TODO: 调用 LLM
    // const response = await this.llm.generate(prompt);
    
    // 临时实现
    const response = {
      text: `根据知识库信息，${this.formatAnswer(results)}`,
      confidence: confidence,
    };

    return {
      content: response.text,
      confidence,
      sources,
      followUp: this.suggestFollowUp(question, results),
    };
  }

  /**
   * 构建提示词
   */
  private buildPrompt(question: string, results: SearchResult[]): string {
    const knowledge = results.map((r, i) => 
      `[${i + 1}] ${r.chunk.content} (相关度：${(r.score * 100).toFixed(0)}%)`
    ).join('\n');

    const toneInstruction = {
      professional: '使用专业、正式的语气回答。',
      friendly: '使用友好、亲切的语气回答。',
      casual: '使用轻松、随意的语气回答。',
    }[this.config.tone || 'professional'];

    return `
你是一个${this.config.domain}专家。请根据以下知识回答问题。

相关知识:
${knowledge}

问题：${question}

要求:
1. 基于上述知识回答，不要编造信息
2. 标注引用来源，如 [1], [2]
3. 如果知识不足，诚实地说不知道
4. 提供后续问题建议
5. ${toneInstruction}

答案:
`;
  }

  /**
   * 格式化答案
   */
  private formatAnswer(results: SearchResult[]): string {
    if (results.length === 0) {
      return '没有找到相关信息。';
    }

    const content = results[0].chunk.content;
    const truncated = content.length > 500 
      ? content.slice(0, 500) + '...' 
      : content;

    return truncated;
  }

  /**
   * 建议后续问题
   */
  private suggestFollowUp(question: string, results: SearchResult[]): string[] {
    const followUps: string[] = [];

    // 基于问题类型建议
    if (question.includes('怎么') || question.includes('如何')) {
      followUps.push('还有其他步骤需要注意吗？');
      followUps.push('如果遇到问题怎么办？');
    } else if (question.includes('什么')) {
      followUps.push('这个有什么用途？');
      followUps.push('如何使用这个功能？');
    }

    // 基于检索结果建议
    results.slice(0, 2).forEach(r => {
      const keywords = r.chunk.content.split(/\s+/).slice(0, 5).join(' ');
      followUps.push(`关于"${keywords}"还有什么？`);
    });

    return followUps.slice(0, 3);
  }

  /**
   * 创建会话
   */
  private async createSession(sessionId: string): Promise<ChatSession> {
    const session: ChatSession = {
      id: sessionId,
      messages: [],
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============ 辅助函数 ============

/**
 * 创建专家智能体
 */
export function createExpertAgent(
  config: ExpertConfig,
  knowledgeBase: KnowledgeBase,
  llm?: LLMClient
): ExpertAgent {
  return new ExpertAgent(config, knowledgeBase, llm);
}

// 默认导出
export default {
  ExpertAgent,
  createExpertAgent,
};
