/**
 * 增强意图解析器
 * 将自然语言目标转换为结构化任务和执行计划
 */

import type { Agent } from '../types';
import { blackboard } from './Blackboard';

// ========== 类型定义 ==========

/** 意图类型 */
export type IntentType = 
  | 'task'          // 单任务
  | 'workflow'      // 工作流
  | 'query'         // 查询
  | 'analysis'      // 分析
  | 'creation'      // 创建
  | 'modification'  // 修改
  | 'deletion'      // 删除
  | 'collaboration' // 协作
  | 'automation';   // 自动化

/** 优先级 */
export type Priority = 'critical' | 'high' | 'medium' | 'low';

/** 解析后的意图 */
export interface ParsedIntent {
  /** 意图 ID */
  id: string;
  /** 原始输入 */
  rawInput: string;
  /** 意图类型 */
  type: IntentType;
  /** 主要动作 */
  action: string;
  /** 目标对象 */
  target?: string;
  /** 参数 */
  parameters: Record<string, unknown>;
  /** 约束条件 */
  constraints: Constraint[];
  /** 预期输出 */
  expectedOutput?: OutputSpec;
  /** 优先级 */
  priority: Priority;
  /** 置信度 (0-1) */
  confidence: number;
  /** 子意图 */
  subIntents?: ParsedIntent[];
  /** 依赖 */
  dependencies?: string[];
  /** 解析时间 */
  parsedAt: string;
  /** 歧义信息 */
  ambiguities?: Ambiguity[];
}

/** 约束条件 */
export interface Constraint {
  type: 'time' | 'resource' | 'quality' | 'dependency' | 'custom';
  description: string;
  value?: unknown;
}

/** 输出规格 */
export interface OutputSpec {
  format: 'text' | 'json' | 'file' | 'report' | 'code';
  schema?: Record<string, unknown>;
  destination?: string;
}

/** 歧义 */
export interface Ambiguity {
  field: string;
  possibleValues: unknown[];
  needsClarification: boolean;
}

/** 任务建议 */
export interface TaskSuggestion {
  /** 任务描述 */
  description: string;
  /** 推荐的 Agent 类型/技能 */
  recommendedAgentSkills: string[];
  /** 预计时间 */
  estimatedTime: number;
  /** 依赖项 */
  dependencies: string[];
  /** 输入需求 */
  inputs: string[];
  /** 输出 */
  outputs: string[];
}

/** 执行计划 */
export interface ExecutionPlan {
  /** 计划 ID */
  id: string;
  /** 关联的意图 ID */
  intentId: string;
  /** 任务序列 */
  tasks: PlannedTask[];
  /** 并行组 */
  parallelGroups: string[][];
  /** 总预计时间 */
  estimatedDuration: number;
  /** 所需资源 */
  requiredResources: string[];
  /** 风险评估 */
  risks: Risk[];
  /** 备选方案 */
  alternatives: ExecutionPlan[];
}

/** 计划中的任务 */
export interface PlannedTask {
  id: string;
  name: string;
  description: string;
  agentSkill: string;
  inputs: Record<string, unknown>;
  outputs: string[];
  dependencies: string[];
  estimatedTime: number;
  priority: number;
  retryable: boolean;
}

/** 风险 */
export interface Risk {
  type: string;
  probability: number;
  impact: number;
  mitigation: string;
}

/** 意图解析配置 */
export interface IntentParserConfig {
  /** 是否启用歧义检测 */
  detectAmbiguities: boolean;
  /** 是否生成备选方案 */
  generateAlternatives: boolean;
  /** 最大子意图深度 */
  maxSubIntentDepth: number;
  /** 置信度阈值 */
  confidenceThreshold: number;
  /** 是否启用学习 */
  enableLearning: boolean;
}

// ========== 意图解析器类 ==========

/**
 * 增强意图解析器
 * 
 * 功能：
 * 1. 自然语言理解 - 解析用户意图
 * 2. 任务分解 - 拆解复杂任务
 * 3. 计划生成 - 创建执行计划
 * 4. 歧义检测 - 识别需要澄清的部分
 */
export class IntentParserEnhanced {
  private config: Required<IntentParserConfig>;
  private patterns: Map<IntentType, RegExp[]> = new Map();
  private keywords: Map<string, IntentType> = new Map();
  private actionPatterns: Map<string, RegExp> = new Map();
  private agents: Agent[] = [];
  private executeAgentFn: ((agent: Agent, prompt: string) => Promise<{
    success: boolean;
    output: string[];
    error?: string;
  }>) | null = null;

  constructor(config: Partial<IntentParserConfig> = {}) {
    this.config = {
      detectAmbiguities: config.detectAmbiguities ?? true,
      generateAlternatives: config.generateAlternatives ?? true,
      maxSubIntentDepth: config.maxSubIntentDepth ?? 3,
      confidenceThreshold: config.confidenceThreshold ?? 0.7,
      enableLearning: config.enableLearning ?? false,
    };

    this.initializePatterns();
    this.initializeKeywords();
    this.initializeActionPatterns();
  }

  // ========== 初始化方法 ==========

  /**
   * 初始化意图模式
   */
  private initializePatterns(): void {
    this.patterns.set('task', [
      /请帮我(.+)/i,
      /帮我(.+)/i,
      /执行(.+)/i,
      /完成(.+)/i,
    ]);

    this.patterns.set('query', [
      /查询(.+)/i,
      /搜索(.+)/i,
      /查找(.+)/i,
      /什么是(.+)/i,
      /解释(.+)/i,
    ]);

    this.patterns.set('analysis', [
      /分析(.+)/i,
      /评估(.+)/i,
      /检查(.+)/i,
      /审查(.+)/i,
      /诊断(.+)/i,
    ]);

    this.patterns.set('creation', [
      /创建(.+)/i,
      /生成(.+)/i,
      /编写(.+)/i,
      /开发(.+)/i,
      /构建(.+)/i,
      /新建(.+)/i,
    ]);

    this.patterns.set('modification', [
      /修改(.+)/i,
      /更新(.+)/i,
      /编辑(.+)/i,
      /优化(.+)/i,
      /重构(.+)/i,
      /改进(.+)/i,
    ]);

    this.patterns.set('deletion', [
      /删除(.+)/i,
      /移除(.+)/i,
      /清除(.+)/i,
      /卸载(.+)/i,
    ]);

    this.patterns.set('collaboration', [
      /协作(.+)/i,
      /合作(.+)/i,
      /一起(.+)/i,
      /联合(.+)/i,
    ]);

    this.patterns.set('automation', [
      /自动化(.+)/i,
      /自动(.+)/i,
      /定时(.+)/i,
      /批量(.+)/i,
    ]);

    this.patterns.set('workflow', [
      /工作流(.+)/i,
      /流程(.+)/i,
      /流水线(.+)/i,
      /编排(.+)/i,
    ]);
  }

  /**
   * 初始化关键词映射
   */
  private initializeKeywords(): void {
    // 任务动词
    this.keywords.set('帮我', 'task');
    this.keywords.set('执行', 'task');
    this.keywords.set('完成', 'task');
    
    // 查询动词
    this.keywords.set('查询', 'query');
    this.keywords.set('搜索', 'query');
    this.keywords.set('查找', 'query');
    this.keywords.set('什么是', 'query');
    
    // 分析动词
    this.keywords.set('分析', 'analysis');
    this.keywords.set('评估', 'analysis');
    this.keywords.set('检查', 'analysis');
    this.keywords.set('审查', 'analysis');
    
    // 创建动词
    this.keywords.set('创建', 'creation');
    this.keywords.set('生成', 'creation');
    this.keywords.set('编写', 'creation');
    this.keywords.set('开发', 'creation');
    this.keywords.set('构建', 'creation');
    
    // 修改动词
    this.keywords.set('修改', 'modification');
    this.keywords.set('更新', 'modification');
    this.keywords.set('编辑', 'modification');
    this.keywords.set('优化', 'modification');
    this.keywords.set('重构', 'modification');
    
    // 删除动词
    this.keywords.set('删除', 'deletion');
    this.keywords.set('移除', 'deletion');
    
    // 协作动词
    this.keywords.set('协作', 'collaboration');
    this.keywords.set('合作', 'collaboration');
    
    // 自动化动词
    this.keywords.set('自动化', 'automation');
    this.keywords.set('定时', 'automation');
    this.keywords.set('批量', 'automation');
  }

  /**
   * 初始化动作模式
   */
  private initializeActionPatterns(): void {
    this.actionPatterns.set('code', /代码|程序|脚本|函数|类|模块/i);
    this.actionPatterns.set('document', /文档|报告|说明|手册|文档/i);
    this.actionPatterns.set('data', /数据|表格|数据库|记录/i);
    this.actionPatterns.set('test', /测试|验证|检查|用例/i);
    this.actionPatterns.set('deploy', /部署|发布|上线|安装/i);
    this.actionPatterns.set('config', /配置|设置|参数|选项/i);
  }

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

  // ========== 核心解析方法 ==========

  /**
   * 解析用户意图
   */
  parse(input: string): ParsedIntent {
    const id = `intent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const trimmedInput = input.trim();

    // 1. 识别意图类型
    const type = this.detectIntentType(trimmedInput);
    
    // 2. 提取动作
    const action = this.extractAction(trimmedInput, type);
    
    // 3. 提取目标
    const target = this.extractTarget(trimmedInput, type, action);
    
    // 4. 提取参数
    const parameters = this.extractParameters(trimmedInput, type, action);
    
    // 5. 提取约束
    const constraints = this.extractConstraints(trimmedInput);
    
    // 6. 推断优先级
    const priority = this.inferPriority(trimmedInput);
    
    // 7. 计算置信度
    const confidence = this.calculateConfidence(trimmedInput, type, action);
    
    // 8. 检测歧义
    const ambiguities = this.config.detectAmbiguities 
      ? this.detectAmbiguities(trimmedInput, type, parameters)
      : [];

    const intent: ParsedIntent = {
      id,
      rawInput: trimmedInput,
      type,
      action,
      target,
      parameters,
      constraints,
      priority,
      confidence,
      ambiguities,
      parsedAt: new Date().toISOString(),
    };

    // 写入黑板
    blackboard.setVariable(`intent_${id}`, intent, { type: 'public' });

    return intent;
  }

  /**
   * 使用 AI 增强解析
   */
  async parseWithAI(input: string): Promise<ParsedIntent> {
    // 基础解析
    const baseIntent = this.parse(input);

    // 如果置信度足够高，直接返回
    if (baseIntent.confidence >= this.config.confidenceThreshold) {
      return baseIntent;
    }

    // 使用 AI 进行增强解析
    if (this.executeAgentFn && this.agents.length > 0) {
      try {
        const analyzerAgent = this.findBestAgent(['intent-analysis', 'nlp', 'understanding']);
        
        if (analyzerAgent) {
          const prompt = this.buildAnalysisPrompt(input);
          const result = await this.executeAgentFn(analyzerAgent, prompt);
          
          if (result.success && result.output.length > 0) {
            // 解析 AI 响应，增强意图
            const enhancedIntent = this.mergeAIAnalysis(baseIntent, result.output.join('\n'));
            return enhancedIntent;
          }
        }
      } catch (error) {
        console.warn('[IntentParser] AI enhancement failed:', error);
      }
    }

    return baseIntent;
  }

  /**
   * 生成执行计划
   */
  generatePlan(intent: ParsedIntent): ExecutionPlan {
    const planId = `plan-${Date.now()}`;
    
    // 分解任务
    const tasks = this.decomposeIntent(intent);
    
    const parallelGroups = this.identifyParallelGroups(tasks);
    
    // 估算时间
    const estimatedDuration = tasks.reduce((sum, t) => sum + t.estimatedTime, 0);
    
    // 识别资源
    const requiredResources = this.identifyResources(tasks);
    
    // 风险评估
    const risks = this.assessRisks(tasks, intent);
    
    // 生成备选方案
    const alternatives = this.config.generateAlternatives 
      ? this.generateAlternatives(intent, tasks)
      : [];

    const plan: ExecutionPlan = {
      id: planId,
      intentId: intent.id,
      tasks,
      parallelGroups,
      estimatedDuration,
      requiredResources,
      risks,
      alternatives,
    };

    // 写入黑板
    blackboard.setVariable(`plan_${planId}`, plan, { type: 'public' });

    return plan;
  }

  /**
   * 获取任务建议
   */
  suggestTasks(intent: ParsedIntent): TaskSuggestion[] {
    const suggestions: TaskSuggestion[] = [];

    switch (intent.type) {
      case 'creation':
        if (intent.action.includes('代码')) {
          suggestions.push({
            description: '设计系统架构',
            recommendedAgentSkills: ['architecture', 'design'],
            estimatedTime: 30,
            dependencies: [],
            inputs: ['需求文档', '技术约束'],
            outputs: ['架构设计文档'],
          });
          suggestions.push({
            description: '编写核心代码',
            recommendedAgentSkills: ['coding', 'programming'],
            estimatedTime: 60,
            dependencies: ['架构设计文档'],
            inputs: ['架构设计文档'],
            outputs: ['源代码文件'],
          });
          suggestions.push({
            description: '编写单元测试',
            recommendedAgentSkills: ['testing', 'quality'],
            estimatedTime: 30,
            dependencies: ['源代码文件'],
            inputs: ['源代码文件'],
            outputs: ['测试文件'],
          });
        }
        break;

      case 'analysis':
        suggestions.push({
          description: '收集数据',
          recommendedAgentSkills: ['data-collection', 'research'],
          estimatedTime: 20,
          dependencies: [],
          inputs: ['数据源'],
          outputs: ['原始数据'],
        });
        suggestions.push({
          description: '数据分析',
          recommendedAgentSkills: ['analysis', 'statistics'],
          estimatedTime: 40,
          dependencies: ['原始数据'],
          inputs: ['原始数据'],
          outputs: ['分析结果'],
        });
        suggestions.push({
          description: '生成报告',
          recommendedAgentSkills: ['writing', 'reporting'],
          estimatedTime: 20,
          dependencies: ['分析结果'],
          inputs: ['分析结果'],
          outputs: ['分析报告'],
        });
        break;

      case 'query':
        suggestions.push({
          description: '执行查询',
          recommendedAgentSkills: ['search', 'query'],
          estimatedTime: 10,
          dependencies: [],
          inputs: ['查询条件'],
          outputs: ['查询结果'],
        });
        break;

      default:
        suggestions.push({
          description: intent.action,
          recommendedAgentSkills: ['general'],
          estimatedTime: 30,
          dependencies: [],
          inputs: [],
          outputs: ['执行结果'],
        });
    }

    return suggestions;
  }

  // ========== 私有方法 ==========

  /**
   * 检测意图类型
   */
  private detectIntentType(input: string): IntentType {
    // 检查模式匹配
    for (const [type, patterns] of this.patterns) {
      for (const pattern of patterns) {
        if (pattern.test(input)) {
          return type;
        }
      }
    }

    // 检查关键词
    for (const [keyword, type] of this.keywords) {
      if (input.includes(keyword)) {
        return type;
      }
    }

    // 默认为任务类型
    return 'task';
  }

  /**
   * 提取动作
   */
  private extractAction(input: string, type: IntentType): string {
    // 移除常见前缀
    let action = input
      .replace(/^(请|帮我|麻烦|可以|能够|想要|希望)\s*/i, '')
      .replace(/^(查询|搜索|分析|创建|修改|删除|执行|完成|检查|审查)\s*/i, '')
      .trim();

    // 如果动作太长，截取前50个字符
    if (action.length > 100) {
      action = action.slice(0, 100) + '...';
    }

    return action;
  }

  /**
   * 提取目标
   */
  private extractTarget(input: string, type: IntentType, action: string): string | undefined {
    // 检查动作模式
    for (const [key, pattern] of this.actionPatterns) {
      if (pattern.test(input)) {
        return key;
      }
    }

    // 提取名词短语作为目标
    const nounMatch = input.match(/(?:创建|修改|删除|查询|分析)\s*(?:一个|一份|这个)?\s*(.+?)(?:的|，|。|$)/i);
    if (nounMatch) {
      return nounMatch[1].trim();
    }

    return undefined;
  }

  /**
   * 提取参数
   */
  private extractParameters(input: string, type: IntentType, action: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // 提取时间约束
    const timeMatch = input.match(/(\d+)\s*(分钟|小时|天|秒)/i);
    if (timeMatch) {
      params.timeLimit = {
        value: parseInt(timeMatch[1]),
        unit: timeMatch[2],
      };
    }

    // 提取数量
    const countMatch = input.match(/(\d+)\s*(个|份|条|项)/i);
    if (countMatch) {
      params.count = parseInt(countMatch[1]);
    }

    // 提取优先级关键词
    if (/紧急|立即|马上|快速/i.test(input)) {
      params.urgency = 'high';
    }

    // 提取输出格式
    if (/JSON|JSON格式/i.test(input)) {
      params.outputFormat = 'json';
    } else if (/报告/i.test(input)) {
      params.outputFormat = 'report';
    }

    return params;
  }

  /**
   * 提取约束
   */
  private extractConstraints(input: string): Constraint[] {
    const constraints: Constraint[] = [];

    // 时间约束
    const timeMatch = input.match(/在\s*(.+?)\s*(之前|之内|完成)/i);
    if (timeMatch) {
      constraints.push({
        type: 'time',
        description: timeMatch[0],
        value: timeMatch[1],
      });
    }

    // 质量约束
    if (/高质量|完美|精确|准确/i.test(input)) {
      constraints.push({
        type: 'quality',
        description: '高质量要求',
        value: 'high',
      });
    }

    // 资源约束
    const resourceMatch = input.match(/使用\s*(.+?)\s*(工具|资源|技术)/i);
    if (resourceMatch) {
      constraints.push({
        type: 'resource',
        description: resourceMatch[0],
        value: resourceMatch[1],
      });
    }

    return constraints;
  }

  /**
   * 推断优先级
   */
  private inferPriority(input: string): Priority {
    if (/紧急|立即|马上|ASAP|critical/i.test(input)) {
      return 'critical';
    }
    if (/重要|优先|尽快/i.test(input)) {
      return 'high';
    }
    if (/稍后|不急|有时间/i.test(input)) {
      return 'low';
    }
    return 'medium';
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(input: string, type: IntentType, action: string): number {
    let confidence = 0.5; // 基础置信度

    // 根据模式匹配增加置信度
    const patterns = this.patterns.get(type) || [];
    for (const pattern of patterns) {
      if (pattern.test(input)) {
        confidence += 0.2;
        break;
      }
    }

    // 根据关键词匹配增加置信度
    for (const [keyword] of this.keywords) {
      if (input.includes(keyword)) {
        confidence += 0.1;
        break;
      }
    }

    // 根据输入长度调整
    if (input.length > 10 && input.length < 200) {
      confidence += 0.1;
    }

    // 限制在 0-1 之间
    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * 检测歧义
   */
  private detectAmbiguities(
    input: string, 
    type: IntentType, 
    parameters: Record<string, unknown>
  ): Ambiguity[] {
    const ambiguities: Ambiguity[] = [];

    // 检查代词歧义
    if (/它|这个|那个/i.test(input)) {
      ambiguities.push({
        field: 'target',
        possibleValues: ['需要上下文确定'],
        needsClarification: true,
      });
    }

    // 检查范围歧义
    if (/一些|部分|少量/i.test(input)) {
      ambiguities.push({
        field: 'scope',
        possibleValues: ['未明确数量'],
        needsClarification: true,
      });
    }

    // 检查动作歧义
    if (/处理|操作|处理/i.test(input)) {
      ambiguities.push({
        field: 'action',
        possibleValues: ['具体操作不明确'],
        needsClarification: true,
      });
    }

    return ambiguities;
  }

  /**
   * 分解意图为任务
   */
  private decomposeIntent(intent: ParsedIntent): PlannedTask[] {
    const tasks: PlannedTask[] = [];
    const suggestions = this.suggestTasks(intent);

    suggestions.forEach((suggestion, index) => {
      tasks.push({
        id: `task-${index}`,
        name: suggestion.description,
        description: suggestion.description,
        agentSkill: suggestion.recommendedAgentSkills[0] || 'general',
        inputs: {},
        outputs: suggestion.outputs,
        dependencies: suggestion.dependencies.length > 0 
          ? [`task-${Math.max(0, index - 1)}`] 
          : [],
        estimatedTime: suggestion.estimatedTime,
        priority: index === 0 ? 10 : 5,
        retryable: true,
      });
    });

    return tasks;
  }

  /**
   * 识别并行组
   */
  private identifyParallelGroups(tasks: PlannedTask[]): string[][] {
    // 简单实现：没有依赖的任务可以并行
    const noDeps = tasks.filter(t => t.dependencies.length === 0);
    
    if (noDeps.length > 1) {
      return [noDeps.map(t => t.id)];
    }

    return [];
  }

  /**
   * 识别资源
   */
  private identifyResources(tasks: PlannedTask[]): string[] {
    const resources = new Set<string>();
    
    for (const task of tasks) {
      resources.add(task.agentSkill);
      for (const dep of task.dependencies) {
        resources.add(dep);
      }
    }

    return Array.from(resources);
  }

  /**
   * 风险评估
   */
  private assessRisks(tasks: PlannedTask[], intent: ParsedIntent): Risk[] {
    const risks: Risk[] = [];

    // 任务数量风险
    if (tasks.length > 5) {
      risks.push({
        type: 'complexity',
        probability: 0.3,
        impact: 0.5,
        mitigation: '分解为更小的子任务',
      });
    }

    // 依赖风险
    const depCount = tasks.reduce((sum, t) => sum + t.dependencies.length, 0);
    if (depCount > 3) {
      risks.push({
        type: 'dependency',
        probability: 0.4,
        impact: 0.6,
        mitigation: '准备备选执行路径',
      });
    }

    // 时间风险
    if (intent.constraints.some(c => c.type === 'time')) {
      risks.push({
        type: 'time',
        probability: 0.5,
        impact: 0.7,
        mitigation: '优先执行关键任务',
      });
    }

    return risks;
  }

  /**
   * 生成备选方案
   */
  private generateAlternatives(intent: ParsedIntent, tasks: PlannedTask[]): ExecutionPlan[] {
    // 简化实现：生成一个备选方案
    const alternativeTasks = tasks.map(t => ({
      ...t,
      id: `${t.id}-alt`,
      agentSkill: 'general', // 使用通用技能
    }));

    return [{
      id: `plan-${Date.now()}-alt`,
      intentId: intent.id,
      tasks: alternativeTasks,
      parallelGroups: [],
      estimatedDuration: tasks.reduce((sum, t) => sum + t.estimatedTime * 1.2, 0),
      requiredResources: ['general'],
      risks: [],
      alternatives: [],
    }];
  }

  /**
   * 构建分析提示
   */
  private buildAnalysisPrompt(input: string): string {
    return `分析以下用户意图，返回 JSON 格式结果：

用户输入: "${input}"

请返回：
{
  "type": "task|query|analysis|creation|modification|deletion|collaboration|automation|workflow",
  "action": "具体动作描述",
  "target": "目标对象",
  "parameters": {},
  "confidence": 0.0-1.0
}

只返回 JSON，不要其他内容。`;
  }

  /**
   * 合并 AI 分析结果
   */
  private mergeAIAnalysis(intent: ParsedIntent, aiResponse: string): ParsedIntent {
    try {
      // 尝试解析 JSON
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        
        return {
          ...intent,
          type: analysis.type || intent.type,
          action: analysis.action || intent.action,
          target: analysis.target || intent.target,
          parameters: { ...intent.parameters, ...analysis.parameters },
          confidence: Math.max(intent.confidence, analysis.confidence || 0.8),
        };
      }
    } catch (error) {
      console.warn('[IntentParser] Failed to parse AI response:', error);
    }

    return intent;
  }

  /**
   * 查找最佳 Agent
   */
  private findBestAgent(skills: string[]): Agent | null {
    for (const skill of skills) {
      const agent = this.agents.find(a => 
        a.skills.some(s => s.toLowerCase().includes(skill.toLowerCase()))
      );
      if (agent) return agent;
    }
    return this.agents[0] || null;
  }

  // ========== 公共辅助方法 ==========

  /**
   * 检查是否需要澄清
   */
  needsClarification(intent: ParsedIntent): boolean {
    return (intent.ambiguities?.length || 0) > 0 || intent.confidence < this.config.confidenceThreshold;
  }

  /**
   * 生成澄清问题
   */
  generateClarificationQuestions(intent: ParsedIntent): string[] {
    const questions: string[] = [];

    if (intent.ambiguities) {
      for (const ambiguity of intent.ambiguities) {
        switch (ambiguity.field) {
          case 'target':
            questions.push('您指的是哪个具体对象？');
            break;
          case 'scope':
            questions.push('您需要处理多少内容？');
            break;
          case 'action':
            questions.push('您希望执行什么具体操作？');
            break;
        }
      }
    }

    if (intent.confidence < this.config.confidenceThreshold) {
      questions.push('能否提供更多细节？');
    }

    return questions;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<IntentParserConfig> {
    return this.config;
  }
}

// ========== 默认实例 ==========

export const intentParserEnhanced = new IntentParserEnhanced();

// ========== 辅助函数 ==========

/**
 * 解析意图
 */
export function parseIntent(input: string): ParsedIntent {
  return intentParserEnhanced.parse(input);
}

/**
 * 解析意图并生成计划
 */
export function parseAndPlan(input: string): { intent: ParsedIntent; plan: ExecutionPlan } {
  const intent = intentParserEnhanced.parse(input);
  const plan = intentParserEnhanced.generatePlan(intent);
  return { intent, plan };
}