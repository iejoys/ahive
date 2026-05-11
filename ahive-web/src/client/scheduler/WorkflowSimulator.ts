/**
 * 工作流模拟执行器
 * 沙箱模式验证工作流设计，无需真实 Agent
 * 
 * 功能:
 * - 模拟所有节点类型执行
 * - 检测配置错误和逻辑问题
 * - 可视化执行路径
 * - 生成问题报告
 */

import type { 
  Workflow, 
  WorkflowNode, 
  WorkflowEdge, 
  Agent,
  WorkflowNodeConfig,
  InputMapping,
  OutputMapping,
  Department,
} from '../types';
import { blackboard } from './Blackboard';
import { templateRenderer } from './TemplateRenderer';

// ========== 类型定义 ==========

/** 模拟执行状态 */
export type SimulationStatus = 
  | 'idle' 
  | 'running' 
  | 'paused' 
  | 'completed' 
  | 'failed';

/** 节点模拟结果 */
export interface NodeSimulationResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'success' | 'failed' | 'skipped' | 'warning';
  message: string;
  duration: number;
  inputVariables: Record<string, unknown>;
  outputVariables: Record<string, unknown>;
  issues: SimulationIssue[];
  startedAt: string;
  completedAt: string;
}

/** 模拟问题 */
export interface SimulationIssue {
  type: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestion?: string;
}

/** 模拟执行上下文 */
export interface SimulationContext {
  instanceId: string;
  workflowId: string;
  workflowName: string;
  status: SimulationStatus;
  currentNodeId: string;
  executionPath: string[];
  startedAt: string;
  completedAt?: string;
  totalNodes: number;
  executedNodes: number;
  progress: number;
}

/** 模拟执行报告 */
export interface SimulationReport {
  context: SimulationContext;
  nodeResults: NodeSimulationResult[];
  blackboardSnapshot: Record<string, unknown>;
  issues: SimulationIssue[];
  summary: {
    totalNodes: number;
    successNodes: number;
    failedNodes: number;
    warningNodes: number;
    skippedNodes: number;
    totalIssues: number;
    errors: number;
    warnings: number;
    executionTime: number;
    canRunInProduction: boolean;
  };
}

/** 模拟回调 */
export interface SimulationCallbacks {
  onStateChange?: (context: SimulationContext) => void;
  onNodeStart?: (nodeId: string, nodeName: string) => void;
  onNodeComplete?: (result: NodeSimulationResult) => void;
  onIssueDetected?: (issue: SimulationIssue) => void;
  onComplete?: (report: SimulationReport) => void;
}

/** 模拟 Agent 响应配置 */
interface MockAgentResponseConfig {
  agentId: string;
  agentName: string;
  skills: string[];
  responseTemplate: string;
  outputData: Record<string, unknown>;
}

// ========== 预设模拟响应 ==========

const DEFAULT_MOCK_RESPONSES: Record<string, MockAgentResponseConfig> = {
  // 通用响应模板
  '_default': {
    agentId: '_default',
    agentName: 'Mock Agent',
    skills: ['general'],
    responseTemplate: '任务已完成。输出结果已准备好。',
    outputData: {
      result: '模拟执行成功',
      status: 'completed',
    }
  },
  
  // 开发类 Agent
  'developer': {
    agentId: 'developer',
    agentName: '开发工程师',
    skills: ['coding', 'debugging', 'testing'],
    responseTemplate: '代码开发完成。已实现所有功能模块。',
    outputData: {
      modules: ['ModuleA', 'ModuleB', 'ModuleC'],
      progress: 100,
      testCoverage: 85,
    }
  },
  
  // 设计类 Agent
  'designer': {
    agentId: 'designer',
    agentName: '设计师',
    skills: ['ui-design', 'ux-design', 'graphic'],
    responseTemplate: '设计稿已完成。包含所有界面元素。',
    outputData: {
      assets: ['design_v1.png', 'components.json'],
      revisions: 2,
    }
  },
  
  // 分析类 Agent
  'analyst': {
    agentId: 'analyst',
    agentName: '分析师',
    skills: ['data-analysis', 'reporting', 'visualization'],
    responseTemplate: '数据分析完成。已生成分析报告。',
    outputData: {
      report: { summary: '分析结果摘要', details: [] },
      insights: ['洞察1', '洞察2'],
    }
  },
  
  // 测试类 Agent
  'tester': {
    agentId: 'tester',
    agentName: '测试工程师',
    skills: ['testing', 'qa', 'automation'],
    responseTemplate: '测试执行完成。发现若干问题。',
    outputData: {
      testCases: 50,
      passed: 45,
      failed: 5,
      bugCount: 3,
    }
  },
  
  // 管理类 Agent
  'manager': {
    agentId: 'manager',
    agentName: '项目经理',
    skills: ['planning', 'coordination', 'review'],
    responseTemplate: '项目审核完成。整体进度良好。',
    outputData: {
      reviewScore: 85,
      status: 'approved',
      nextSteps: ['步骤1', '步骤2'],
    }
  },
};

// ========== 模拟执行器类 ==========

export class WorkflowSimulator {
  private workflow: Workflow;
  private agents: Agent[];
  private departments: Department[];
  private sandboxBlackboard: typeof blackboard;
  private context: SimulationContext;
  private nodeResults: NodeSimulationResult[] = [];
  private allIssues: SimulationIssue[] = [];
  private callbacks: SimulationCallbacks;
  private iterationCount: number = 0;
  private readonly MAX_ITERATIONS = 50; // 防止死循环
  
  constructor(
    workflow: Workflow,
    agents: Agent[],
    departments: Department[],
    callbacks: SimulationCallbacks = {}
  ) {
    this.workflow = workflow;
    this.agents = agents;
    this.departments = departments;
    this.callbacks = callbacks;
    
    // 创建沙箱黑板（使用原型继承，但不影响原黑板）
    this.sandboxBlackboard = blackboard;
    
    // 初始化上下文
    const startNode = this.findStartNode();
    this.context = {
      instanceId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: 'idle',
      currentNodeId: startNode?.id ?? '',
      executionPath: [],
      startedAt: new Date().toISOString(),
      totalNodes: workflow.nodes.length,
      executedNodes: 0,
      progress: 0,
    };
  }
  
  /**
   * 运行模拟执行
   */
  async run(): Promise<SimulationReport> {
    // 清空沙箱黑板
    this.sandboxBlackboard.clear();
    
    // 预检查
    const preCheckIssues = this.preCheckWorkflow();
    this.allIssues.push(...preCheckIssues);
    
    if (preCheckIssues.some(i => i.type === 'error')) {
      // 有严重错误，无法执行
      this.context.status = 'failed';
      this.notifyStateChange();
      return this.buildReport();
    }
    
    // 开始执行
    this.context.status = 'running';
    this.notifyStateChange();
    
    console.log(`[Simulator] Starting simulation: ${this.workflow.name}`);
    
    try {
      // 执行循环
      while (this.context.status === 'running' && this.iterationCount < this.MAX_ITERATIONS) {
        await this.executeCurrentNode();
        this.iterationCount++;
        
        if (this.context.status !== 'running') break;
        
        // 移动到下一节点
        const nextNode = this.findNextNode();
        if (nextNode) {
          this.context.currentNodeId = nextNode.id;
          this.context.executionPath.push(nextNode.id);
          this.context.executedNodes++;
          // 进度上限为 100%，避免循环节点导致进度超过 100%
          const rawProgress = (this.context.executedNodes / this.context.totalNodes) * 100;
          this.context.progress = Math.min(Math.round(rawProgress), 100);
          this.notifyStateChange();
        } else {
          // 没有下一节点，完成
          this.context.status = 'completed';
          this.context.completedAt = new Date().toISOString();
          this.notifyStateChange();
        }
      }
      
      // 检查是否因迭代次数过多而停止
      if (this.iterationCount >= this.MAX_ITERATIONS) {
        // 检查是否真的死循环（连续执行同一节点超过 10 次）
        const lastNodes = this.context.executionPath.slice(-10);
        const isDeadLoop = lastNodes.length >= 10 && lastNodes.every(n => n === lastNodes[0]);
        
        if (isDeadLoop) {
          this.addIssue('error', 'INFINITE_LOOP', `节点 "${lastNodes[0]}" 可能存在死循环，连续执行超过 10 次`, '检查节点连接是否形成自环');
          this.context.status = 'failed';
        } else {
          // 正常循环达到限制，标记为警告而非错误
          this.addIssue('warning', 'ITERATION_LIMIT', `执行达到最大迭代次数 (${this.MAX_ITERATIONS})，可能包含循环设计`, '如需更多迭代，可调整 MAX_ITERATIONS 配置');
          this.context.status = 'completed';
        }
      }
      
    } catch (error) {
      this.context.status = 'failed';
      this.addIssue('error', 'EXECUTION_ERROR', `执行错误: ${error}`, '检查节点配置');
    }
    
    return this.buildReport();
  }
  
  /**
   * 暂停模拟
   */
  pause(): void {
    if (this.context.status === 'running') {
      this.context.status = 'paused';
      this.notifyStateChange();
    }
  }
  
  /**
   * 恢复模拟
   */
  async resume(): Promise<SimulationReport> {
    if (this.context.status === 'paused') {
      this.context.status = 'running';
      this.notifyStateChange();
      return this.run();
    }
    return this.buildReport();
  }
  
  /**
   * 停止模拟
   */
  stop(): void {
    this.context.status = 'failed';
    this.addIssue('info', 'USER_STOPPED', '用户手动停止模拟');
    this.notifyStateChange();
  }
  
  /**
   * 获取当前状态
   */
  getContext(): SimulationContext {
    return { ...this.context };
  }
  
  /**
   * 获取节点结果
   */
  getNodeResults(): NodeSimulationResult[] {
    return [...this.nodeResults];
  }
  
  // ========== 私有方法 ==========
  
  /**
   * 工作流预检查
   */
  private preCheckWorkflow(): SimulationIssue[] {
    const issues: SimulationIssue[] = [];
    
    // 1. 检查是否有节点
    if (this.workflow.nodes.length === 0) {
      issues.push({
        type: 'error',
        code: 'NO_NODES',
        message: '工作流没有任何节点',
        suggestion: '添加至少一个节点',
      });
      return issues;
    }
    
    // 2. 检查起始节点
    const startNode = this.findStartNode();
    if (!startNode) {
      issues.push({
        type: 'error',
        code: 'NO_START_NODE',
        message: '无法确定起始节点',
        suggestion: '确保有一个节点没有入边',
      });
    }
    
    // 3. 检查节点连接完整性
    for (const node of this.workflow.nodes) {
      // 检查 Agent 节点是否有执行者
      if (node.type === 'agent') {
        const config = node.config;
        if (!config?.executor && !config?.agentId && !node.agentId) {
          issues.push({
            type: 'error',
            code: 'NO_EXECUTOR',
            message: `节点 "${node.name}" 未配置执行者`,
            suggestion: '在节点配置中选择执行者',
          });
        }
        
        // 检查执行者是否存在
        if (config?.executor?.executors) {
          for (const executor of config.executor.executors) {
            if (executor.type === 'agent') {
              const agent = this.agents.find(a => a.id === executor.id);
              if (!agent) {
                issues.push({
                  type: 'warning',
                  code: 'EXECUTOR_NOT_FOUND',
                  message: `节点 "${node.name}" 的执行者 "${executor.id}" 不存在`,
                  suggestion: '选择已存在的 Agent',
                });
              }
            }
          }
        }
      }
      
      // 检查部门节点
      if (node.type === 'department') {
        const config = node.config?.departmentConfig;
        if (!config?.departmentId) {
          issues.push({
            type: 'error',
            code: 'NO_DEPARTMENT',
            message: `节点 "${node.name}" 未配置部门`,
            suggestion: '选择一个部门',
          });
        } else {
          const dept = this.departments.find(d => d.id === config.departmentId);
          if (!dept) {
            issues.push({
              type: 'warning',
              code: 'DEPARTMENT_NOT_FOUND',
              message: `节点 "${node.name}" 的部门 "${config.departmentId}" 不存在`,
              suggestion: '选择已存在的部门',
            });
          }
        }
      }
      
      // 检查条件节点
      if (node.type === 'condition') {
        const conditions = node.config?.conditions || [];
        if (conditions.length === 0) {
          issues.push({
            type: 'warning',
            code: 'NO_CONDITIONS',
            message: `节点 "${node.name}" 未配置条件分支`,
            suggestion: '添加至少一个条件分支',
          });
        }
        
        // 检查目标节点是否存在
        for (const cond of conditions) {
          if (cond.targetNode) {
            const target = this.workflow.nodes.find(n => n.id === cond.targetNode);
            if (!target) {
              issues.push({
                type: 'error',
                code: 'TARGET_NODE_NOT_FOUND',
                message: `节点 "${node.name}" 的条件分支目标 "${cond.targetNode}" 不存在`,
                suggestion: '选择已存在的节点作为目标',
              });
            }
          }
        }
      }
      
      // 检查循环节点
      if (node.type === 'loop') {
        const loopConfig = node.config?.loopConfig;
        if (!loopConfig?.loopBodyNode) {
          issues.push({
            type: 'error',
            code: 'NO_LOOP_BODY',
            message: `节点 "${node.name}" 未配置循环体节点`,
            suggestion: '选择一个节点作为循环体',
          });
        }
      }
      
      // 检查并行节点
      if (node.type === 'parallel') {
        const branches = node.config?.branches || [];
        if (branches.length === 0) {
          issues.push({
            type: 'warning',
            code: 'NO_BRANCHES',
            message: `节点 "${node.name}" 未配置并行分支`,
            suggestion: '添加至少一个并行分支节点',
          });
        }
      }
      
      // 检查变量节点
      if (node.type === 'variable') {
        const varConfig = node.config?.variableConfig;
        if (!varConfig?.name) {
          issues.push({
            type: 'error',
            code: 'NO_VARIABLE_NAME',
            message: `节点 "${node.name}" 未配置变量名`,
            suggestion: '设置变量名',
          });
        }
      }
      
      // 检查审核节点
      if (node.type === 'review') {
        const reviewConfig = node.config?.reviewConfig;
        if (!reviewConfig?.passCondition) {
          issues.push({
            type: 'warning',
            code: 'NO_PASS_CONDITION',
            message: `节点 "${node.name}" 未配置通过条件`,
            suggestion: '设置审核通过条件',
          });
        }
      }
    }
    
    // 4. 检查边连接
    for (const edge of this.workflow.edges) {
      const source = this.workflow.nodes.find(n => n.id === edge.source);
      const target = this.workflow.nodes.find(n => n.id === edge.target);
      
      if (!source) {
        issues.push({
          type: 'error',
          code: 'EDGE_SOURCE_NOT_FOUND',
          message: `边的源节点 "${edge.source}" 不存在`,
        });
      }
      if (!target) {
        issues.push({
          type: 'error',
          code: 'EDGE_TARGET_NOT_FOUND',
          message: `边的目标节点 "${edge.target}" 不存在`,
        });
      }
    }
    
    return issues;
  }
  
  /**
   * 执行当前节点
   */
  private async executeCurrentNode(): Promise<void> {
    const node = this.workflow.nodes.find(n => n.id === this.context.currentNodeId);
    
    if (!node) {
      this.addIssue('error', 'NODE_NOT_FOUND', `节点不存在: ${this.context.currentNodeId}`);
      this.context.status = 'failed';
      return;
    }
    
    console.log(`[Simulator] Simulating node: ${node.name} (${node.type})`);
    
    this.callbacks.onNodeStart?.(node.id, node.name);
    
    const startTime = Date.now();
    const result: NodeSimulationResult = {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      status: 'success',
      message: '',
      duration: 0,
      inputVariables: {},
      outputVariables: {},
      issues: [],
      startedAt: new Date().toISOString(),
      completedAt: '',
    };
    
    try {
      // 根据节点类型模拟执行
      switch (node.type) {
        case 'agent':
          this.simulateAgentNode(node, result);
          break;
        case 'variable':
          this.simulateVariableNode(node, result);
          break;
        case 'condition':
          this.simulateConditionNode(node, result);
          break;
        case 'parallel':
          await this.simulateParallelNode(node, result);
          break;
        case 'loop':
          this.simulateLoopNode(node, result);
          break;
        case 'delay':
          this.simulateDelayNode(node, result);
          break;
        case 'review':
          this.simulateReviewNode(node, result);
          break;
        case 'department':
          this.simulateDepartmentNode(node, result);
          break;
        case 'transform':
          this.simulateTransformNode(node, result);
          break;
        case 'output':
          this.simulateOutputNode(node, result);
          break;
        case 'notify':
          this.simulateNotifyNode(node, result);
          break;
        case 'api':
          this.simulateApiNode(node, result);
          break;
        case 'webhook':
          this.simulateWebhookNode(node, result);
          break;
        case 'email':
          this.simulateEmailNode(node, result);
          break;
        case 'message':
          this.simulateMessageNode(node, result);
          break;
        case 'milestone':
          this.simulateMilestoneNode(node, result);
          break;
        case 'human':
          this.simulateHumanNode(node, result);
          break;
        case 'group':
          result.status = 'skipped';
          result.message = '分组节点已跳过';
          break;
        default:
          result.status = 'warning';
          result.message = `未知节点类型: ${node.type}`;
          this.addIssue('warning', 'UNKNOWN_NODE_TYPE', `节点 "${node.name}" 类型 "${node.type}" 未知`);
      }
      
    } catch (error) {
      result.status = 'failed';
      result.message = `执行错误: ${error}`;
      result.issues.push({
        type: 'error',
        code: 'EXECUTION_ERROR',
        message: String(error),
      });
    }
    
    result.duration = Date.now() - startTime;
    result.completedAt = new Date().toISOString();
    
    this.nodeResults.push(result);
    this.allIssues.push(...result.issues);
    this.callbacks.onNodeComplete?.(result);
  }
  
  /**
   * 模拟 Agent 节点
   */
  private simulateAgentNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config || {};
    
    // 1. 收集输入变量
    const inputs = this.gatherInputs(config);
    result.inputVariables = inputs;
    
    // 2. 渲染任务模板
    const taskTemplate = config.taskTemplate || `执行任务: ${node.name}`;
    const prompt = templateRenderer.render(taskTemplate, inputs);
    
    // 3. 获取执行者
    let mockAgent: Agent | null = null;
    
    if (config.executor?.executors?.length > 0) {
      const executorId = config.executor.executors[0].id;
      mockAgent = this.agents.find(a => a.id === executorId) || null;
    } else if (config.agentId || node.agentId) {
      mockAgent = this.agents.find(a => a.id === config.agentId || node.agentId) || null;
    }
    
    if (!mockAgent) {
      result.status = 'warning';
      result.message = '未找到执行者，使用默认模拟响应';
      result.issues.push({
        type: 'warning',
        code: 'EXECUTOR_NOT_FOUND',
        message: '执行者不存在，使用模拟数据',
      });
      mockAgent = { id: '_mock', name: 'Mock Agent', status: 'idle', position: { x: 0, y: 0, z: 0 } };
    }
    
    // 4. 生成模拟响应
    const mockResponse = this.generateMockResponse(mockAgent, prompt, config);
    result.outputVariables = mockResponse.data;
    result.message = `模拟执行完成 (执行者: ${mockAgent.name})`;
    
    // 5. 写入黑板
    for (const [key, value] of Object.entries(mockResponse.data)) {
      this.sandboxBlackboard.setVariable(key, value, { owner: node.id });
    }
    
    // 6. 检查输出映射
    if (config.outputs && config.outputs.length > 0) {
      for (const output of config.outputs) {
        if (!mockResponse.data[output.name]) {
          result.issues.push({
            type: 'warning',
            code: 'OUTPUT_NOT_FOUND',
            message: `输出变量 "${output.name}" 未在响应中找到`,
            suggestion: '检查输出映射配置',
          });
        }
      }
    }
  }
  
  /**
   * 生成模拟响应
   */
  private generateMockResponse(
    agent: Agent, 
    prompt: string, 
    config: WorkflowNodeConfig
  ): { output: string; data: Record<string, unknown> } {
    // 根据 Agent 类型选择响应模板
    const agentType = agent.agentType || agent.group || 'general';
    
    // 查找匹配的响应模板
    let responseConfig = DEFAULT_MOCK_RESPONSES[agentType] || DEFAULT_MOCK_RESPONSES['_default'];
    
    // 根据输出配置生成数据
    const outputData: Record<string, unknown> = {};
    
    if (config.outputs && config.outputs.length > 0) {
      // 根据输出映射生成模拟数据
      for (const output of config.outputs) {
        const varName = output.name;
        // 根据变量名生成合适的模拟值
        if (varName.includes('count') || varName.includes('number')) {
          outputData[varName] = Math.floor(Math.random() * 10) + 1;
        } else if (varName.includes('score') || varName.includes('rate')) {
          outputData[varName] = Math.floor(Math.random() * 30) + 70;
        } else if (varName.includes('list') || varName.includes('items')) {
          outputData[varName] = ['item1', 'item2', 'item3'];
        } else if (varName.includes('status') || varName.includes('result')) {
          outputData[varName] = 'completed';
        } else if (varName.includes('doc') || varName.includes('report')) {
          outputData[varName] = { title: '模拟文档', content: '这是模拟生成的内容' };
        } else {
          outputData[varName] = `模拟_${varName}_值`;
        }
      }
    } else {
      // 使用默认响应数据
      Object.assign(outputData, responseConfig.outputData);
    }
    
    return {
      output: responseConfig.responseTemplate,
      data: outputData,
    };
  }
  
  /**
   * 模拟变量节点
   */
  private simulateVariableNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.variableConfig;
    
    if (!config) {
      result.status = 'failed';
      result.message = '缺少变量配置';
      result.issues.push({
        type: 'error',
        code: 'NO_CONFIG',
        message: '变量节点缺少配置',
      });
      return;
    }
    
    // 解析变量值
    let value: unknown = config.value;
    
    if (config.type === 'number') {
      value = Number(config.value) || 0;
    } else if (config.type === 'boolean') {
      value = config.value === 'true' || config.value === true;
    } else if (config.type === 'json') {
      try {
        value = JSON.parse(config.value);
      } catch {
        result.issues.push({
          type: 'warning',
          code: 'JSON_PARSE_ERROR',
          message: 'JSON 解析失败，使用原始值',
        });
      }
    }
    
    // 写入黑板
    this.sandboxBlackboard.setVariable(config.name, value, { owner: node.id });
    
    result.outputVariables = { [config.name]: value };
    result.message = `变量 "${config.name}" 已设置`;
  }
  
  /**
   * 模拟条件节点
   */
  private simulateConditionNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config || {};
    const conditions = config.conditions || [];
    
    if (conditions.length === 0) {
      result.status = 'warning';
      result.message = '未配置条件分支，使用默认路径';
      result.issues.push({
        type: 'warning',
        code: 'NO_CONDITIONS',
        message: '条件节点未配置分支',
      });
      return;
    }
    
    // 评估条件（模拟）
    let matchedCondition = null;
    const variables = this.sandboxBlackboard.export().variables;
    
    for (const condition of conditions) {
      // 模拟条件评估
      const evalResult = this.evaluateCondition(condition.expression, variables);
      
      if (evalResult.matched) {
        matchedCondition = condition;
        break;
      }
    }
    
    // 设置下一个节点
    const targetNode = matchedCondition?.targetNode || config.defaultNode;
    
    if (targetNode) {
      this.context.currentNodeId = targetNode;
      result.message = matchedCondition 
        ? `条件匹配: ${matchedCondition.label || matchedCondition.expression} → ${targetNode}`
        : `使用默认分支 → ${targetNode}`;
      result.outputVariables = { 
        matchedCondition: matchedCondition?.label || 'default',
        targetNode,
      };
    } else {
      result.status = 'warning';
      result.message = '未找到目标节点';
      result.issues.push({
        type: 'warning',
        code: 'NO_TARGET',
        message: '条件分支未配置目标节点',
      });
    }
  }
  
  /**
   * 评估条件表达式（安全模式）
   */
  private evaluateCondition(
    expression: string, 
    variables: Record<string, unknown>
  ): { matched: boolean; error?: string } {
    try {
      // 解析简单表达式
      const operators = ['>=', '<=', '!=', '==', '>', '<'];
      
      for (const op of operators) {
        const parts = expression.split(op);
        if (parts.length === 2) {
          const left = parts[0].trim();
          const right = parts[1].trim();
          
          // 获取左值
          let leftValue = variables[left];
          if (leftValue === undefined) {
            // 尝试解析为字面量
            leftValue = this.parseLiteral(left);
          }
          
          // 获取右值
          let rightValue = variables[right];
          if (rightValue === undefined) {
            rightValue = this.parseLiteral(right);
          }
          
          // 比较
          const leftNum = Number(leftValue);
          const rightNum = Number(rightValue);
          
          let matched = false;
          switch (op) {
            case '>': matched = leftNum > rightNum; break;
            case '<': matched = leftNum < rightNum; break;
            case '>=': matched = leftNum >= rightNum; break;
            case '<=': matched = leftNum <= rightNum; break;
            case '==': matched = leftValue == rightValue; break;
            case '!=': matched = leftValue != rightValue; break;
          }
          
          return { matched };
        }
      }
      
      // 无法解析的表达式，模拟为随机结果
      return { matched: Math.random() > 0.5 };
      
    } catch (error) {
      return { matched: false, error: String(error) };
    }
  }
  
  /**
   * 解析字面量
   */
  private parseLiteral(value: string): string | number | boolean | null {
    if ((value.startsWith("'") && value.endsWith("'")) || 
        (value.startsWith('"') && value.endsWith('"'))) {
      return value.slice(1, -1);
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    const num = Number(value);
    if (!isNaN(num)) return num;
    return value;
  }
  
  /**
   * 模拟并行节点
   */
  private async simulateParallelNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config || {};
    const branches = config.branches || [];
    
    if (branches.length === 0) {
      result.status = 'warning';
      result.message = '未配置并行分支';
      return;
    }
    
    // 模拟并行执行
    const branchResults: Record<string, unknown> = {};
    
    for (const branchId of branches) {
      const branchNode = this.workflow.nodes.find(n => n.id === branchId);
      if (branchNode) {
        // 模拟执行分支节点
        branchResults[branchId] = {
          status: 'completed',
          nodeName: branchNode.name,
          outputs: { result: `模拟_${branchNode.name}_输出` },
        };
        
        // 写入黑板
        this.sandboxBlackboard.setVariable(
          `parallel_${branchId}_result`,
          branchResults[branchId],
          { owner: node.id }
        );
      } else {
        result.issues.push({
          type: 'warning',
          code: 'BRANCH_NOT_FOUND',
          message: `分支节点 "${branchId}" 不存在`,
        });
      }
    }
    
    // 汇总结果
    this.sandboxBlackboard.setVariable('parallelResults', branchResults, { owner: node.id });
    
    result.outputVariables = { parallelResults: branchResults, branchCount: branches.length };
    result.message = `并行执行 ${branches.length} 个分支`;
  }
  
  /**
   * 模拟循环节点
   */
  private simulateLoopNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.loopConfig;
    
    if (!config) {
      result.status = 'failed';
      result.message = '缺少循环配置';
      return;
    }
    
    // 模拟循环次数
    let iterations = 0;
    
    if (config.type === 'count' && config.count) {
      iterations = Math.min(config.count, 5); // 限制模拟次数
    } else if (config.type === 'condition') {
      iterations = 2; // 模拟条件循环
    } else if (config.type === 'array') {
      iterations = 3; // 模拟数组遍历
    }
    
    // 检查循环体节点
    if (config.loopBodyNode) {
      const bodyNode = this.workflow.nodes.find(n => n.id === config.loopBodyNode);
      if (!bodyNode) {
        result.issues.push({
          type: 'error',
          code: 'LOOP_BODY_NOT_FOUND',
          message: `循环体节点 "${config.loopBodyNode}" 不存在`,
        });
      }
    }
    
    result.outputVariables = { iterations, type: config.type };
    result.message = `循环类型: ${config.type}, 模拟迭代: ${iterations} 次`;
  }
  
  /**
   * 模拟延时节点
   */
  private simulateDelayNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.delayConfig;
    
    if (!config) {
      result.status = 'failed';
      result.message = '缺少延时配置';
      return;
    }
    
    // 模拟延时（实际不等待）
    const duration = config.duration || 1;
    const unit = config.unit || 'seconds';
    
    result.message = `模拟延时: ${duration} ${unit}`;
    result.outputVariables = { delayDuration: duration, delayUnit: unit };
  }
  
  /**
   * 模拟审核节点
   */
  private simulateReviewNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.reviewConfig;
    
    if (!config) {
      result.status = 'warning';
      result.message = '缺少审核配置，使用默认模拟';
    }
    
    // 模拟审核评分
    const score = Math.floor(Math.random() * 30) + 70; // 70-100分
    const threshold = config?.passCondition?.threshold || 70;
    const passed = score >= threshold;
    
    // 写入黑板
    this.sandboxBlackboard.setVariable('reviewScore', score, { owner: node.id });
    this.sandboxBlackboard.setVariable('reviewPassed', passed, { owner: node.id });
    
    result.outputVariables = { score, threshold, passed };
    result.message = `审核完成: ${score}分 (${passed ? '通过' : '未通过'})`;
  }
  
  /**
   * 模拟部门节点
   */
  private simulateDepartmentNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.departmentConfig;
    
    if (!config) {
      result.status = 'failed';
      result.message = '缺少部门配置';
      return;
    }
    
    const department = this.departments.find(d => d.id === config.departmentId);
    
    if (!department) {
      result.status = 'warning';
      result.message = `部门 "${config.departmentId}" 不存在，使用模拟数据`;
      result.issues.push({
        type: 'warning',
        code: 'DEPARTMENT_NOT_FOUND',
        message: '部门不存在',
      });
    } else {
      result.message = `部门任务已分配: ${department.name}`;
      result.outputVariables = { 
        departmentId: config.departmentId, 
        departmentName: department.name,
        memberCount: department.members.length,
      };
    }
  }
  
  /**
   * 模拟数据转换节点
   */
  private simulateTransformNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.transformConfig;
    
    if (!config) {
      result.status = 'failed';
      result.message = '缺少转换配置';
      return;
    }
    
    // 获取输入变量
    const inputValue = this.sandboxBlackboard.getVariableValue(config.inputVariable);
    
    if (inputValue === undefined) {
      result.status = 'warning';
      result.message = `输入变量 "${config.inputVariable}" 不存在`;
      result.issues.push({
        type: 'warning',
        code: 'INPUT_NOT_FOUND',
        message: '输入变量不存在',
        suggestion: '检查变量名或前置节点输出',
      });
    }
    
    // 模拟转换
    const outputValue = inputValue !== undefined 
      ? { transformed: true, source: config.inputVariable, value: inputValue }
      : { transformed: false };
    
    // 写入黑板
    this.sandboxBlackboard.setVariable(config.outputVariable, outputValue, { owner: node.id });
    
    result.inputVariables = { [config.inputVariable]: inputValue };
    result.outputVariables = { [config.outputVariable]: outputValue };
    result.message = `数据转换: ${config.inputVariable} → ${config.outputVariable}`;
  }
  
  /**
   * 模拟输出节点
   */
  private simulateOutputNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.outputConfig;
    
    if (!config) {
      result.status = 'failed';
      result.message = '缺少输出配置';
      return;
    }
    
    const value = this.sandboxBlackboard.getVariableValue(config.name);
    const outputKey = config.isFinalOutput ? `final_output_${config.name}` : `output_${config.name}`;
    
    if (value === undefined) {
      result.status = 'warning';
      result.message = `变量 "${config.name}" 不存在`;
      result.issues.push({
        type: 'warning',
        code: 'VARIABLE_NOT_FOUND',
        message: '输出变量不存在',
      });
    }
    
    this.sandboxBlackboard.setVariable(outputKey, value, { owner: node.id });
    
    result.outputVariables = { [outputKey]: value };
    result.message = `输出变量: ${config.name} (最终输出: ${config.isFinalOutput})`;
  }
  
  /**
   * 模拟通知节点
   */
  private simulateNotifyNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.notifyConfig;
    
    if (!config) {
      result.status = 'warning';
      result.message = '缺少通知配置';
      return;
    }
    
    result.message = `通知已模拟发送到: ${config.channels?.join(', ') || '未配置渠道'}`;
    result.outputVariables = { 
      channels: config.channels || [],
      recipients: config.recipients || [],
      sent: true,
    };
  }
  
  /**
   * 模拟 API 节点
   */
  private simulateApiNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.apiConfig;
    
    if (!config) {
      result.status = 'warning';
      result.message = '缺少 API 配置';
      return;
    }
    
    result.message = `API 调用已模拟: ${config.method || 'GET'} ${config.url || '未配置URL'}`;
    result.outputVariables = {
      status: 200,
      response: { data: '模拟响应数据' },
    };
  }
  
  /**
   * 模拟 Webhook 节点
   */
  private simulateWebhookNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.webhookConfig;
    
    result.message = `Webhook 已模拟触发: ${config?.path || '未配置路径'}`;
    result.outputVariables = {
      triggered: true,
      payload: { event: '模拟事件' },
    };
  }
  
  /**
   * 模拟邮件节点
   */
  private simulateEmailNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.emailConfig;
    
    result.message = `邮件已模拟发送: ${config?.to?.join(', ') || '未配置收件人'}`;
    result.outputVariables = {
      sent: true,
      subject: config?.subject || '模拟邮件',
    };
  }
  
  /**
   * 模拟消息节点
   */
  private simulateMessageNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.messageConfig;
    
    result.message = `消息已模拟发送: ${config?.type || '未配置类型'}`;
    result.outputVariables = {
      sent: true,
      type: config?.type || 'unknown',
    };
  }
  
  /**
   * 模拟里程碑节点
   */
  private simulateMilestoneNode(node: WorkflowNode, result: NodeSimulationResult): void {
    const config = node.config?.milestoneConfig;
    
    result.message = `里程碑已模拟完成: ${node.name}`;
    result.outputVariables = {
      milestone: node.name,
      completed: true,
      childNodes: config?.childNodes || [],
    };
  }
  
  /**
   * 模拟人工节点
   */
  private simulateHumanNode(node: WorkflowNode, result: NodeSimulationResult): void {
    result.message = '人工审核节点已模拟通过';
    result.outputVariables = {
      approved: true,
      reviewer: '模拟审核人',
    };
  }
  
  /**
   * 收集输入变量
   */
  private gatherInputs(config: WorkflowNodeConfig): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    
    // 先加载黑板所有用户变量
    const blackboardVars = this.sandboxBlackboard.export().variables;
    const systemPrefixes = ['intent_', 'plan_', 'vote_', 'swarm_', 'retry_', 'recovery_', 'failure_', 'protocol_', 'broadcast_', 'parallel_'];
    
    for (const [key, value] of Object.entries(blackboardVars)) {
      if (!systemPrefixes.some(prefix => key.startsWith(prefix))) {
        inputs[key] = value;
      }
    }
    
    // 处理显式配置的输入映射
    const mappings = config.inputs || [];
    
    for (const mapping of mappings) {
      let value: unknown;
      
      switch (mapping.source) {
        case 'blackboard':
          value = this.sandboxBlackboard.getVariableValue(mapping.sourceKey || mapping.name);
          break;
        case 'prev-output':
          value = this.sandboxBlackboard.getVariableValue(mapping.sourceKey || mapping.name);
          break;
        case 'user-input':
          value = this.sandboxBlackboard.getVariableValue(mapping.sourceKey || mapping.name);
          break;
        case 'env':
          value = `[环境变量: ${mapping.sourceKey || mapping.name}]`;
          break;
        default:
          value = this.sandboxBlackboard.getVariableValue(mapping.name);
      }
      
      if (value === undefined && mapping.defaultValue !== undefined) {
        value = mapping.defaultValue;
      }
      
      if (value === undefined && mapping.required) {
        // 记录缺失的必填变量
        this.addIssue('warning', 'MISSING_REQUIRED_INPUT', 
          `节点缺少必填输入: ${mapping.name}`,
          '检查前置节点是否输出此变量');
      }
      
      if (value !== undefined) {
        inputs[mapping.name] = value;
      }
    }
    
    return inputs;
  }
  
  /**
   * 找到起始节点
   */
  private findStartNode(): WorkflowNode | undefined {
    const targetIds = new Set(this.workflow.edges.map(e => e.target));
    return this.workflow.nodes.find(n => !targetIds.has(n.id)) || this.workflow.nodes[0];
  }
  
  /**
   * 找到下一个节点
   */
  private findNextNode(): WorkflowNode | undefined {
    const currentNodeId = this.context.currentNodeId;
    
    const outgoingEdges = this.workflow.edges.filter(e => e.source === currentNodeId);
    
    if (outgoingEdges.length === 0) {
      return undefined;
    }
    
    // 使用第一条出边
    const normalEdge = outgoingEdges.find(e => !e.targetHandle || e.targetHandle === 'top');
    
    if (normalEdge) {
      return this.workflow.nodes.find(n => n.id === normalEdge.target);
    }
    
    return this.workflow.nodes.find(n => n.id === outgoingEdges[0].target);
  }
  
  /**
   * 添加问题
   */
  private addIssue(
    type: 'error' | 'warning' | 'info', 
    code: string, 
    message: string, 
    suggestion?: string
  ): void {
    const issue: SimulationIssue = { type, code, message, suggestion };
    this.allIssues.push(issue);
    this.callbacks.onIssueDetected?.(issue);
  }
  
  /**
   * 通知状态变更
   */
  private notifyStateChange(): void {
    this.callbacks.onStateChange?.(this.getContext());
  }
  
  /**
   * 构建报告
   */
  private buildReport(): SimulationReport {
    const blackboardSnapshot = this.sandboxBlackboard.export().variables;
    
    const successNodes = this.nodeResults.filter(r => r.status === 'success').length;
    const failedNodes = this.nodeResults.filter(r => r.status === 'failed').length;
    const warningNodes = this.nodeResults.filter(r => r.status === 'warning').length;
    const skippedNodes = this.nodeResults.filter(r => r.status === 'skipped').length;
    
    const errors = this.allIssues.filter(i => i.type === 'error').length;
    const warnings = this.allIssues.filter(i => i.type === 'warning').length;
    
    const executionTime = this.nodeResults.reduce((sum, r) => sum + r.duration, 0);
    
    return {
      context: this.getContext(),
      nodeResults: this.getNodeResults(),
      blackboardSnapshot,
      issues: this.allIssues,
      summary: {
        totalNodes: this.workflow.nodes.length,
        successNodes,
        failedNodes,
        warningNodes,
        skippedNodes,
        totalIssues: this.allIssues.length,
        errors,
        warnings,
        executionTime,
        canRunInProduction: errors === 0 && failedNodes === 0,
      },
    };
  }
}

// ========== 导出便捷函数 ==========

/**
 * 快速模拟工作流
 */
export async function simulateWorkflow(
  workflow: Workflow,
  agents: Agent[],
  departments: Department[],
  callbacks?: SimulationCallbacks
): Promise<SimulationReport> {
  const simulator = new WorkflowSimulator(workflow, agents, departments, callbacks);
  return simulator.run();
}