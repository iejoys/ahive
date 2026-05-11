/**
 * 工作流引擎
 * 核心执行引擎，支持中断恢复、状态持久化、指挥官通信
 */

import type {
  Workflow,
  WorkflowNode,
  Agent,
  ExecutionStatus,
  ExecutionContext,
  NodeExecutionRecord,
  WorkflowExecutionResult,
  ExecutionCallback,
  WorkflowEvent,
  OutputMapping,
  ExecutorConfig,
  PersistedExecutionState,
  CommanderMessage,
  AgentStatusReport,
  // 新增：拆解相关类型
  DecompositionState,
  DecompositionProposal,
  ProposalReviewResult,
  SubTaskState,
} from '../types';

import { StateManager } from '../persistence/StateManager';
import { CommanderChannel, CommanderChannelConfig } from './CommanderChannel';
import { BlackboardService } from '../Blackboard';
import { TemplateRenderer } from '../TemplateRenderer';
import { OutputParser } from '../OutputParser';
import { AgentResolver } from '../AgentResolver';
import { 
  PlannerNodeExecutor, 
  DynamicParallelNodeExecutor,
  type PlannerOutput,
  type DynamicParallelOutput
} from '../dynamic';

/**
 * Agent 调用回调类型
 */
export type CallAgentCallback = (
  agent: Agent,
  prompt: string,
  timeout?: number
) => Promise<{ success: boolean; output: string; error?: string }>;

/**
 * 广播事件回调类型
 */
export type BroadcastCallback = (event: WorkflowEvent) => void;

/**
 * 工作流引擎配置
 */
export interface WorkflowEngineConfig {
  workflow: Workflow;
  agents: Agent[];
  callAgent: CallAgentCallback;
  broadcast?: BroadcastCallback;
  callbacks?: ExecutionCallback;
  commanderConfig?: Partial<CommanderChannelConfig>;
  stateDir?: string;
  stateDB?: any; // WorkflowStateDB 实例
  instanceId?: string; // 外部传入的实例 ID
  wsServer?: any; // WebSocket 服务器实例
}

/**
 * 工作流引擎类
 */
export class WorkflowEngine {
  // 核心组件
  private workflow: Workflow;
  private agentResolver: AgentResolver;
  private blackboard: BlackboardService;
  private templateRenderer: TemplateRenderer;
  private outputParser: OutputParser;
  private stateManager: StateManager;
  private stateDB?: any; // WorkflowStateDB 实例
  private commanderChannel: CommanderChannel;

  // 回调
  private callAgent: CallAgentCallback;
  private broadcast?: BroadcastCallback;
  private callbacks: ExecutionCallback;
  
  // 执行状态
  private context: ExecutionContext;
  private history: NodeExecutionRecord[] = [];
  private currentNodeIndex: number = 0;
  
  // 控制
  private abortController: AbortController | null = null;
  private inquiryInterval: NodeJS.Timeout | null = null;
  private resumeResolver: (() => void) | null = null;
  
  // 拆解状态（Agent自主性升级）
  private decompositionStates: Map<string, DecompositionState> = new Map();
  private pendingProposals: Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }> = new Map();
  
  // 配置
  private stateDir: string;
  
  constructor(config: WorkflowEngineConfig) {
    this.workflow = config.workflow;
    this.callAgent = config.callAgent;
    this.broadcast = config.broadcast;
    this.callbacks = config.callbacks || {};
    this.stateDir = config.stateDir || './data/workflow-states';
    
    // 初始化组件
    this.agentResolver = new AgentResolver();
    this.agentResolver.registerAgents(config.agents);

    this.blackboard = new BlackboardService(`wf-${Date.now()}`);
    this.templateRenderer = new TemplateRenderer();
    this.outputParser = new OutputParser();

    // 初始化状态管理器（保留用于日志等非核心功能）
    this.stateManager = new StateManager(this.stateDir);

    // 初始化 WorkflowStateDB（如果提供）
    this.stateDB = config.stateDB;

    // 初始化指挥官通道
    this.commanderChannel = new CommanderChannel({
      workflowId: this.workflow.id,
      onInquiry: this.handleCommanderInquiry.bind(this),
      onTaskAssign: this.handleTaskAssign.bind(this),
      ...config.commanderConfig,
    });

    // 监听指挥官通道的任务完成事件
    this.commanderChannel.on('task-complete', (result: {
      taskId: string;
      nodeId: string;
      agentId: string;
      success: boolean;
      outputs?: Record<string, unknown>;
      error?: string;
    }) => {
      console.log(`[WorkflowEngine] Task complete via commander: ${result.taskId} (${result.nodeId})`);
      // 这个事件会被 waitForTaskComplete 的 Promise 捕获
      // 这里主要用于日志和额外的状态更新
    });

    // 监听拆解相关事件
    this.commanderChannel.on('task-decompose', (data: any) => {
      this.handleTaskDecomposeReport(data);
    });

    this.commanderChannel.on('task-decompose-approved', (data: any) => {
      this.handleDecompositionApproved(data);
    });

    this.commanderChannel.on('task-decompose-rejected', (data: any) => {
      this.handleDecompositionRejected(data);
    });

    this.commanderChannel.on('sub-task-start', (data: any) => {
      this.handleSubTaskStartReport(data);
    });

    this.commanderChannel.on('sub-task-complete', (data: any) => {
      this.handleSubTaskCompleteReport(data);
    });

    this.commanderChannel.on('task-merge', (data: any) => {
      this.handleTaskMergeReport(data);
    });

    // 初始化执行上下文
    const startNode = this.findStartNode();
    this.context = {
      instanceId: config.instanceId || `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      workflowId: this.workflow.id,
      currentNodeId: startNode?.id ?? '',
      status: 'idle',
      executionPath: startNode ? [startNode.id] : [],
      startedAt: new Date().toISOString(),
    };

    console.log(`[WorkflowEngine] Created for workflow: ${this.workflow.name} (instanceId: ${this.context.instanceId})`);
  }
  
  /**
   * 获取执行上下文
   */
  getContext(): ExecutionContext {
    return { ...this.context };
  }
  
  /**
   * 获取黑板
   */
  getBlackboard(): BlackboardService {
    return this.blackboard;
  }
  
  /**
   * 获取执行历史
   */
  getHistory(): NodeExecutionRecord[] {
    return [...this.history];
  }
  
  /**
   * 获取当前节点 ID
   */
  getCurrentNodeId(): string {
    return this.context.currentNodeId;
  }
  
  /**
   * 获取节点信息
   */
  getNode(nodeId: string): WorkflowNode | undefined {
    return this.workflow.nodes.find(n => n.id === nodeId);
  }
  
  /**
   * 开始执行
   */
  async start(initialVariables?: Record<string, unknown>): Promise<WorkflowExecutionResult> {
    if (this.context.status !== 'idle') {
      return {
        success: false,
        context: this.context,
        outputs: {},
        history: this.history,
        error: 'Engine already started',
      };
    }
    
    this.abortController = new AbortController();
    this.context.status = 'running';
    
    // 初始化黑板变量
    if (initialVariables) {
      for (const [key, value] of Object.entries(initialVariables)) {
        this.blackboard.setVariable(key, value, { owner: this.context.instanceId });
      }
    }
    
    // 加载工作流上下文变量
    if (this.workflow.context) {
      this.blackboard.setVariable('context', this.workflow.context, { owner: this.context.instanceId });
    }
    
    console.log(`[WorkflowEngine] Starting workflow: ${this.workflow.name}`);
    
    // 广播开始事件
    this.broadcastEvent({
      type: 'workflow-started',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      timestamp: Date.now(),
    });
    
    // 启动定时询问
    this.startInquiryTimer();
    
    this.callbacks.onStateChange?.(this.context);
    
    try {
      // 保存初始状态
      await this.saveState();
      
      // 执行循环
      const nodes = this.getSortedNodes();
      
      for (let i = this.currentNodeIndex; i < nodes.length; i++) {
        if (this.context.status !== 'running') {
          break;
        }
        
        const node = nodes[i];
        this.context.currentNodeId = node.id;
        
        // 避免重复添加（构造函数可能已初始化起始节点）
        if (!this.context.executionPath.includes(node.id)) {
          this.context.executionPath.push(node.id);
        }
        
        this.currentNodeIndex = i;
        
        await this.executeNode(node);
        
        // 检查 currentNodeIndex 是否被修改（如审核失败返回）
        if (this.currentNodeIndex !== i) {
          console.log(`[WorkflowEngine] Node index changed from ${i} to ${this.currentNodeIndex}, adjusting loop`);
          i = this.currentNodeIndex;  // 同步循环变量
        }
        
        // 每个节点执行后保存状态
        await this.saveState();
      }
      
      // 完成
      if (this.context.status === 'running') {
        this.context.status = 'completed';
        this.context.completedAt = new Date().toISOString();

        // 更新数据库中的实例完成状态
        if (this.stateDB) {
          this.stateDB.completeInstance(this.context.instanceId, true);
        }
      }

    } catch (error) {
      this.context.status = 'failed';
      this.context.error = error instanceof Error ? error.message : String(error);
      this.context.completedAt = new Date().toISOString();

      // 更新数据库中的实例失败状态
      if (this.stateDB) {
        this.stateDB.completeInstance(this.context.instanceId, false, this.context.error);
      }

      this.callbacks.onError?.(this.context.currentNodeId, error instanceof Error ? error : new Error(String(error)));
    }
    
    // 停止询问
    this.stopInquiryTimer();
    
    // 保存最终状态
    await this.saveState();
    
    // 广播完成事件
    this.broadcastEvent({
      type: this.context.status === 'completed' ? 'workflow-completed' : 'workflow-error',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      timestamp: Date.now(),
      data: { status: this.context.status, error: this.context.error },
    });
    
    this.callbacks.onStateChange?.(this.context);
    
    // 构建结果
    const blackboardData = this.blackboard.export();
    
    return {
      success: this.context.status === 'completed',
      context: this.context,
      outputs: blackboardData.variables,
      history: this.history,
      error: this.context.error,
    };
  }
  
  /**
   * 暂停执行
   * 1. 修改引擎状态为 paused
   * 2. 通过 CommanderChannel 广播"暂停"消息给 AHIVECORE，中断 Agent 当前任务
   */
  async pause(): Promise<void> {
    if (this.context.status === 'running') {
      this.context.status = 'paused';
      await this.saveState();
      this.callbacks.onStateChange?.(this.context);
      
      this.broadcastEvent({
        type: 'workflow-paused',
        instanceId: this.context.instanceId,
        workflowId: this.workflow.id,
        timestamp: Date.now(),
      });
    }
  }
  
  /**
   * 恢复执行
   */
  async resume(): Promise<void> {
    // 处理 human/review 节点的等待恢复
    if (this.context.status === 'waiting_review' && this.resumeResolver) {
      const resolver = this.resumeResolver;
      this.resumeResolver = null;
      this.context.status = 'running';
      await this.saveState();
      this.callbacks.onStateChange?.(this.context);
      
      this.broadcastEvent({
        type: 'workflow-resumed',
        instanceId: this.context.instanceId,
        workflowId: this.workflow.id,
        timestamp: Date.now(),
      });
      
      resolver();
      return;
    }
    
    // 处理普通暂停恢复
    if (this.context.status === 'paused') {
      this.context.status = 'running';
      await this.saveState();
      this.callbacks.onStateChange?.(this.context);
      
      this.broadcastEvent({
        type: 'workflow-resumed',
        instanceId: this.context.instanceId,
        workflowId: this.workflow.id,
        timestamp: Date.now(),
      });
    }
  }
  
  /**
   * 停止执行（完全停止，不可恢复）
   */
  async stop(): Promise<void> {
    this.context.status = 'failed';
    this.context.error = 'Workflow stopped by user';
    this.context.completedAt = new Date().toISOString();
    
    if (this.abortController) {
      this.abortController.abort();
    }
    
    this.stopInquiryTimer();
    
    await this.saveState();
    this.callbacks.onStateChange?.(this.context);
    
    this.broadcastEvent({
      type: 'workflow-stopped',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      timestamp: Date.now(),
    });
  }
  
  /**
   * 保存状态
   */
  private async saveState(): Promise<void> {
    // 如果有数据库，更新数据库中的变量和执行路径
    if (this.stateDB) {
      const variables = this.blackboard.export().variables;
      const executionPath = this.context.executionPath;

      // 更新实例的变量和执行路径
      const stmt = (this.stateDB as any).db.prepare(`
        UPDATE workflow_instances
        SET variables = ?, execution_path = ?, updated_at = ?
        WHERE instance_id = ?
      `);

      stmt.run(
        JSON.stringify(variables),
        JSON.stringify(executionPath),
        new Date().toISOString(),
        this.context.instanceId
      );
    }

    console.log(`[WorkflowEngine] State saved: ${this.context.instanceId}, status: ${this.context.status}`);
  }
  
  /**
   * 启动定时询问
   */
  private startInquiryTimer(): void {
    this.inquiryInterval = setInterval(() => {
      // 定期向指挥官询问状态
      this.commanderChannel.requestStatusUpdate(this.context);
    }, 60000); // 60秒询问一次
  }
  
  /**
   * 停止定时询问
   */
  private stopInquiryTimer(): void {
    if (this.inquiryInterval) {
      clearInterval(this.inquiryInterval);
      this.inquiryInterval = null;
    }
  }
  
  /**
   * 处理指挥官询问
   */
  private async handleCommanderInquiry(message: CommanderMessage): Promise<AgentStatusReport> {
    const currentNode = this.workflow.nodes.find(n => n.id === this.context.currentNodeId);
    
    // 保存状态
    await this.saveState();
    
    return {
      agentId: this.context.instanceId,
      status: this.context.status,
      currentNodeId: this.context.currentNodeId,
      currentNodeName: currentNode?.name || '',
      progress: this.calculateProgress(),
      lastUpdate: new Date().toISOString(),
      message: `Executing: ${currentNode?.name || 'Unknown'}`,
    };
  }
  
  /**
   * 处理任务分配
   */
  private async handleTaskAssign(message: CommanderMessage): Promise<void> {
    console.log(`[WorkflowEngine] Task assigned: ${message.payload.taskId}`);
    // 任务分配处理逻辑
  }
  
  /**
   * 计算进度
   */
  private calculateProgress(): number {
    const total = this.workflow.nodes.length;
    const completed = this.currentNodeIndex;
    return total > 0 ? Math.round((completed / total) * 100) : 0;
  }
  
  /**
   * 执行单个节点
   */
  private async executeNode(node: WorkflowNode): Promise<void> {
    const record = this.createRecord(node);

    // 收集节点输入数据（用于数据库保存）
    const nodeInput = {
      nodeType: node.type,
      config: node.config,
      agentId: node.agentId || (node.config as any)?.agentId,
    };

    // 更新数据库中的当前节点状态
    if (this.stateDB) {
      this.stateDB.updateInstanceStatus(this.context.instanceId, 'running', node.id, node.name);
      this.stateDB.startNode(this.context.instanceId, node.id, node.name, node.type, nodeInput);
      console.log(`[WorkflowEngine] startNode called for ${node.id}, input saved`);
    }

    this.callbacks.onNodeStart?.(node.id, node.name);

    this.broadcastEvent({
      type: 'workflow-node-start',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: node.id,
      nodeName: node.name,
      timestamp: Date.now(),
    });

    console.log(`[WorkflowEngine] Executing node: ${node.name} (${node.type})`);
    
    try {
      switch (node.type) {
        case 'agent':
          await this.executeAgentNode(node, record);
          break;
          
        case 'condition':
          this.executeConditionNode(node);
          break;
          
        case 'parallel':
          await this.executeParallelNode(node, record);
          break;
          
        case 'loop':
          await this.executeLoopNode(node);
          break;
          
        case 'delay':
          await this.executeDelayNode(node);
          break;
          
        case 'variable':
          this.executeVariableNode(node);
          break;
          
        case 'human':
          await this.executeHumanNode(node);
          break;
          
        case 'review':
          await this.executeReviewNode(node);
          break;
          
        case 'notify':
          await this.executeNotifyNode(node);
          break;
          
        case 'output':
          this.executeOutputNode(node);
          break;
          
        case 'milestone':
          console.log(`[WorkflowEngine] Milestone: ${node.name}`);
          break;
          
        case 'group':
          break;
          
        case 'planner':
          await this.executePlannerNode(node, record);
          break;
          
        case 'dynamic-parallel':
          await this.executeDynamicParallelNode(node, record);
          break;
          
        default:
          console.warn(`[WorkflowEngine] Unknown node type: ${node.type}`);
      }

      record.status = 'success';
      record.completedAt = new Date().toISOString();

      // 更新数据库中的节点完成状态
      if (this.stateDB) {
        this.stateDB.completeNode(this.context.instanceId, node.id, record.output);
      }

    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      record.completedAt = new Date().toISOString();

      // 更新数据库中的节点失败状态
      if (this.stateDB) {
        this.stateDB.completeNode(
          this.context.instanceId,
          node.id,
          undefined,
          record.error
        );
      }

      this.callbacks.onError?.(node.id, error instanceof Error ? error : new Error(String(error)));

      const config = node.config || {};
      const failureStrategy = (config as any).executor?.failureStrategy;

      if (failureStrategy?.action === 'abort') {
        throw error;
      }
    }
    
    record.duration = record.completedAt 
      ? new Date(record.completedAt).getTime() - new Date(record.startedAt).getTime()
      : 0;
    
    this.history.push(record);
    
    this.callbacks.onNodeComplete?.(record);
    
    this.broadcastEvent({
      type: 'workflow-node-complete',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: node.id,
      nodeName: node.name,
      timestamp: Date.now(),
      data: { status: record.status, duration: record.duration },
    });
  }
  
  /**
   * 执行 Agent 节点
   */
  private async executeAgentNode(node: WorkflowNode, record: NodeExecutionRecord): Promise<void> {
    const config = node.config || {};
    
    // 收集输入
    const inputs = this.gatherInputs(config);
    record.input.variables = Object.keys(inputs);
    
    // 渲染任务模板
    const taskTemplate = config.taskTemplate || `执行任务: ${node.name}`;
    const prompt = this.templateRenderer.render(taskTemplate, {
      ...inputs,
      context: this.blackboard.getVariableValue('context'),
    });
    record.input.prompt = prompt;
    
    console.log(`[WorkflowEngine] Rendered prompt:`, prompt.slice(0, 200));
    
    // 获取执行者
    const executorConfig = config.executor as ExecutorConfig | undefined;
    let agents: Agent[] = [];
    
    if (executorConfig && executorConfig.executors && executorConfig.executors.length > 0) {
      agents = this.agentResolver.resolveExecutors(executorConfig.executors);
    } else if ((config as any).agentId || node.agentId) {
      const agentId = (config as any).agentId || node.agentId;
      const agent = this.agentResolver.resolve(agentId);
      if (agent) {
        agents = [agent];
      }
    }
    
    if (agents.length === 0) {
      throw new Error(`No valid executors for node: ${node.name}`);
    }
    
    console.log(`[WorkflowEngine] Executors: ${agents.map(a => a.name).join(', ')}`);
    
    // 保存 Agent 信息到数据库
    if (this.stateDB) {
      this.stateDB.updateNodeAgentInfo(
        this.context.instanceId,
        node.id,
        agents[0].agentId || agents[0].id,
        agents[0].name,
        prompt
      );
    }
    
    // 通知指挥官任务开始
    this.commanderChannel.notifyTaskStart({
      nodeId: node.id,
      nodeName: node.name,
      agentId: agents[0].agentId || agents[0].id,
      agentName: agents[0].name,
      prompt: prompt.slice(0, 500),
    });
    
    // 根据模式执行
    const mode = executorConfig?.mode || 'single';
    const timeout = config.timeout || 120000;
    
    let response: { success: boolean; output: string; error?: string };
    
    // 判断是否为 AHIVECORE 类型 Agent，走 CommanderChannel 异步链路
    const isAHIVECore = agents[0].protocolType === 'ahivecore' || agents[0].agentType === 'ahivecore';
    
    if (isAHIVECore && mode === 'single') {
      // AHIVECORE Agent: 通过 CommanderChannel 异步执行
      const taskId = `task_${this.context.instanceId}_${node.id}_${Date.now()}`;
      
      console.log(`[WorkflowEngine] Dispatching to AHIVECORE via CommanderChannel: ${taskId}`);
      
      // 发送任务分配（发送完整 prompt，不要截断）
      await this.commanderChannel.assignTask(
        taskId,
        node.id,
        node.name,
        prompt,
        agents[0].agentId || agents[0].id,
        this.context.workflowId,
        this.context.instanceId,
        inputs,
        timeout
      );
      
      // 等待任务完成
      response = await this.commanderChannel.waitForTaskComplete(taskId, timeout);
      
      console.log(`[WorkflowEngine] AHIVECORE task ${taskId} completed: ${response.success}`);
    } else {
      // 非 AHIVECORE Agent: 走原有同步调用
      switch (mode) {
        case 'single':
          response = await this.callAgent(agents[0], prompt, timeout);
          break;
          
        case 'any':
          response = await this.executeAnyAgent(agents, prompt, timeout);
          break;
          
        case 'all':
          response = await this.executeAllAgents(agents, prompt, timeout);
          break;
          
        case 'vote':
          response = await this.executeVoteAgents(agents, prompt, timeout);
          break;
          
        case 'round-robin':
          const selectedAgent = agents[Date.now() % agents.length];
          response = await this.callAgent(selectedAgent, prompt, timeout);
          break;
          
        default:
          response = await this.callAgent(agents[0], prompt, timeout);
      }
    }
    
    record.output.raw = response.output;
    
    // 保存 Agent 响应到数据库
    if (this.stateDB && response.output) {
      this.stateDB.updateNodeResponse(
        this.context.instanceId,
        node.id,
        response.output
      );
    }
    
    if (!response.success) {
      // 通知指挥官任务失败
      this.commanderChannel.notifyTaskError({
        nodeId: node.id,
        nodeName: node.name,
        error: response.error || 'Agent execution failed',
      });
      
      throw new Error(response.error || 'Agent execution failed');
    }
    
    // 解析输出
    const outputs = config.outputs as OutputMapping[] | undefined;
    if (outputs && outputs.length > 0) {
      const parsed = this.outputParser.parse(response.output, outputs);
      
      for (const [key, value] of Object.entries(parsed.variables)) {
        this.blackboard.setVariable(key, value, { owner: this.context.instanceId });
        record.output.extracted[key] = value;
      }
      
      if (!parsed.success) {
        console.warn(`[WorkflowEngine] Output parsing warnings:`, parsed.errors);
      }
    }
    
    // 通知指挥官任务完成
    this.commanderChannel.notifyTaskComplete({
      nodeId: node.id,
      nodeName: node.name,
      output: response.output.slice(0, 500),
    });
  }
  
  /**
   * 任一完成模式
   */
  private async executeAnyAgent(
    agents: Agent[],
    prompt: string,
    timeout: number
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const promises = agents.map(agent => this.callAgent(agent, prompt, timeout));
    
    return new Promise((resolve) => {
      let resolved = false;
      
      for (const promise of promises) {
        promise.then(result => {
          if (!resolved && result.success) {
            resolved = true;
            resolve(result);
          }
        }).catch(() => {});
      }
      
      Promise.allSettled(promises).then(results => {
        if (!resolved) {
          const firstResult = results.find(r => r.status === 'fulfilled');
          if (firstResult && firstResult.status === 'fulfilled') {
            resolve(firstResult.value);
          } else {
            resolve({ success: false, output: '', error: 'All executors failed' });
          }
        }
      });
    });
  }
  
  /**
   * 全部执行模式
   */
  private async executeAllAgents(
    agents: Agent[],
    prompt: string,
    timeout: number
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const promises = agents.map(agent => this.callAgent(agent, prompt, timeout));
    const results = await Promise.allSettled(promises);
    
    const outputs: string[] = [];
    const errors: string[] = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        outputs.push(result.value.output);
        if (!result.value.success && result.value.error) {
          errors.push(result.value.error);
        }
      } else {
        errors.push(result.reason?.message || 'Unknown error');
      }
    }
    
    return {
      success: errors.length === 0,
      output: outputs.join('\n\n---\n\n'),
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }
  
  /**
   * 投票模式
   */
  private async executeVoteAgents(
    agents: Agent[],
    prompt: string,
    timeout: number
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const votePrompt = prompt + '\n\n请在回复末尾给出你的选择。';
    
    const promises = agents.map(agent => this.callAgent(agent, votePrompt, timeout));
    const results = await Promise.allSettled(promises);
    
    const responses: string[] = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        responses.push(result.value.output);
      }
    }
    
    if (responses.length === 0) {
      return { success: false, output: '', error: 'No valid votes' };
    }
    
    return {
      success: true,
      output: responses.join('\n\n---\n\n'),
    };
  }
  
  /**
   * 执行条件节点
   */
  private executeConditionNode(node: WorkflowNode): void {
    const config = node.config || {};
    const conditions = (config as any).conditions || [];
    
    console.log(`[WorkflowEngine] Evaluating condition node: ${node.name}`);
    
    for (const condition of conditions) {
      const result = this.evaluateCondition(condition.expression);
      
      if (result) {
        const targetNode = this.workflow.nodes.find(n => n.id === condition.targetNode);
        if (targetNode) {
          const targetIndex = this.workflow.nodes.findIndex(n => n.id === condition.targetNode);
          if (targetIndex !== -1) {
            this.currentNodeIndex = targetIndex - 1;
          }
        }
        return;
      }
    }
    
    if ((config as any).defaultNode) {
      const targetIndex = this.workflow.nodes.findIndex(n => n.id === (config as any).defaultNode);
      if (targetIndex !== -1) {
        this.currentNodeIndex = targetIndex - 1;
      }
    }
  }
  
  /**
   * 执行并行节点
   */
  private async executeParallelNode(node: WorkflowNode, record: NodeExecutionRecord): Promise<void> {
    const config = node.config || {};
    const branches = (config as any).branches || [];
    
    console.log(`[WorkflowEngine] Executing parallel branches: ${branches.length}`);
    
    const promises = branches.map((branchId: string) => {
      const branchNode = this.workflow.nodes.find(n => n.id === branchId);
      if (branchNode) {
        return this.executeNode(branchNode);
      }
      return Promise.resolve();
    });
    
    await Promise.all(promises);
  }
  
  /**
   * 执行循环节点
   */
  private async executeLoopNode(node: WorkflowNode): Promise<void> {
    const config = node.config || {};
    const loopConfig = (config as any).loopConfig;
    
    if (!loopConfig) return;
    
    const { type, count, condition, loopBodyNode } = loopConfig;
    
    let iterations = 0;
    const maxIterations = type === 'count' ? (count || 1) : 100;
    
    while (iterations < maxIterations) {
      if (type === 'condition' && condition) {
        const result = this.evaluateCondition(condition);
        if (!result) break;
      }
      
      const bodyNode = this.workflow.nodes.find(n => n.id === loopBodyNode);
      if (bodyNode) {
        await this.executeNode(bodyNode);
      }
      
      iterations++;
    }
    
    console.log(`[WorkflowEngine] Loop completed: ${iterations} iterations`);
  }
  
  /**
   * 执行延时节点
   */
  private async executeDelayNode(node: WorkflowNode): Promise<void> {
    const config = node.config || {};
    const delayConfig = (config as any).delayConfig;
    
    if (!delayConfig) return;
    
    const { duration, unit } = delayConfig;
    const ms = unit === 'hours' ? duration * 3600000 :
               unit === 'minutes' ? duration * 60000 :
               duration * 1000;
    
    console.log(`[WorkflowEngine] Delaying for ${duration} ${unit}`);
    
    await new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 执行变量节点
   * 支持新版多变量配置（v2）和旧版单变量配置
   */
  private executeVariableNode(node: WorkflowNode): void {
    const config = node.config || {};
    const variableConfig = (config as any).variableConfig;
    
    if (!variableConfig) return;
    
    // 检测配置版本
    if (variableConfig.version === 'v2') {
      // 新版多变量配置
      this.executeVariableNodeV2(variableConfig);
    } else {
      // 旧版单变量配置（向后兼容）
      this.executeVariableNodeV1(variableConfig);
    }
  }
  
  /**
   * 执行旧版单变量配置
   */
  private executeVariableNodeV1(variableConfig: any): void {
    const { name, value, type } = variableConfig;
    
    let parsedValue: unknown = value;
    
    if (type === 'json') {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }
    } else if (type === 'number') {
      parsedValue = Number(value);
    } else if (type === 'boolean') {
      parsedValue = value === 'true';
    }
    
    this.blackboard.setVariable(name, parsedValue, { owner: this.context.instanceId });
    
    console.log(`[WorkflowEngine] Set variable (v1): ${name} = ${JSON.stringify(parsedValue).slice(0, 100)}`);
  }
  
  /**
   * 执行新版多变量配置
   * 将所有变量打包成一个 JSON 对象存入黑板
   */
  private executeVariableNodeV2(variableConfig: any): void {
    const { variables, packedVariableName = 'project' } = variableConfig;
    
    if (!variables || !Array.isArray(variables)) return;
    
    // 构建打包后的数据结构
    const packedData: Record<string, unknown> = {};
    const agentPrivateData: Record<string, Record<string, unknown>> = {};
    
    for (const varItem of variables) {
      // 跳过禁用的变量
      if (varItem.enabled === false) continue;
      
      // 解析变量值
      const parsedValue = this.parseVariableValue(varItem.value, varItem.type);
      
      // 根据是否有专用 agentId 决定存储位置
      if (varItem.agentId) {
        // 专用参数，存入 _agentPrivate
        if (!agentPrivateData[varItem.agentId]) {
          agentPrivateData[varItem.agentId] = {};
        }
        agentPrivateData[varItem.agentId][varItem.name] = parsedValue;
      } else {
        // 公共参数，存入主对象
        packedData[varItem.name] = parsedValue;
      }
      
      console.log(`[WorkflowEngine] Process variable: ${varItem.name} (${varItem.agentId ? `agent: ${varItem.agentId}` : 'public'})`);
    }
    
    // 如果有专用参数，添加到 _agentPrivate 字段
    if (Object.keys(agentPrivateData).length > 0) {
      packedData._agentPrivate = agentPrivateData;
    }
    
    // 存入黑板（使用打包变量名）
    this.blackboard.setVariable(packedVariableName, packedData, { owner: this.context.instanceId });
    
    console.log(`[WorkflowEngine] Set packed variable: ${packedVariableName} = ${JSON.stringify(packedData).slice(0, 200)}...`);
    console.log(`[WorkflowEngine] Total variables: ${variables.length}, Public: ${Object.keys(packedData).length - (Object.keys(agentPrivateData).length > 0 ? 1 : 0)}, Private agents: ${Object.keys(agentPrivateData).length}`);
  }
  
  /**
   * 解析变量值
   */
  private parseVariableValue(value: string, type: string): unknown {
    if (!value) return value;
    
    switch (type) {
      case 'json':
      case 'object':
      case 'array':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
        
      case 'number':
        const num = Number(value);
        return isNaN(num) ? value : num;
        
      case 'boolean':
        return value === 'true' || value === '1';
        
      case 'file':
      case 'directory':
      case 'string':
        return value;
        
      default:
        return value;
    }
  }
  
  /**
   * 执行人工节点
   */
  private async executeHumanNode(node: WorkflowNode): Promise<void> {
    const config = node.config || {};
    const message = (config as any).message || '请确认是否继续';
    
    console.log(`[WorkflowEngine] Human node waiting: ${message}`);
    
    this.context.status = 'waiting_review';
    await this.saveState();
    this.callbacks.onStateChange?.(this.context);
    
    this.broadcastEvent({
      type: 'workflow-waiting-review',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: node.id,
      nodeName: node.name,
      timestamp: Date.now(),
      data: { message },
    });
    
    // 真正等待 resume() 信号
    await new Promise<void>(resolve => {
      this.resumeResolver = resolve;
    });
  }
  
  /**
   * 执行审核节点
   * 支持两种审核类型：
   * - agent: 自动派遣审核任务给审核智能体
   * - human/manual: 等待人工审核（resume）
   */
  private async executeReviewNode(node: WorkflowNode): Promise<void> {
    const config = node.config || {};
    const reviewConfig = (config as any).reviewConfig;
    
    if (!reviewConfig) return;
    
    console.log(`[WorkflowEngine] Review node: ${reviewConfig.title} (type: ${reviewConfig.reviewType})`);
    
    // 广播审核节点开始
    this.broadcastEvent({
      type: 'workflow-waiting-review',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: node.id,
      nodeName: node.name,
      timestamp: Date.now(),
      data: { reviewConfig },
    });
    
    // 根据审核类型执行不同逻辑
    if (reviewConfig.reviewType === 'agent') {
      await this.executeAgentReview(node, reviewConfig);
    } else {
      // 人工审核：等待 resume() 信号
      this.context.status = 'waiting_review';
      await this.saveState();
      this.callbacks.onStateChange?.(this.context);
      
      await new Promise<void>(resolve => {
        this.resumeResolver = resolve;
      });
    }
  }
  
  /**
   * 执行智能体自动审核
   */
  private async executeAgentReview(node: WorkflowNode, reviewConfig: any): Promise<void> {
    const { reviewerAgentId, title, instruction, scoreMethod, criteria, passCondition, failAction, reviewReportInstruction } = reviewConfig;
    
    // 1. 查找审核智能体
    const reviewerAgent = this.agentResolver.resolve(reviewerAgentId);
    if (!reviewerAgent) {
      throw new Error(`Reviewer agent not found: ${reviewerAgentId}`);
    }
    
    console.log(`[WorkflowEngine] Agent review by: ${reviewerAgent.name}`);
    
    // 2. 收集被审核的内容（从上一个节点的输出）
    const prevNodeIndex = this.currentNodeIndex - 1;
    if (prevNodeIndex < 0) {
      throw new Error('No previous node to review');
    }
    const prevNode = this.workflow.nodes[prevNodeIndex];
    const prevRecord = this.history.find(r => r.nodeId === prevNode.id);
    const contentToReview = prevRecord?.output?.raw || 'No content available';
    
    // 尝试从上一个节点的输出中获取文档路径（用于提示词中告知 Agent）
    const prevOutputPath = prevRecord?.output?.extracted?.docPath || 
                           prevRecord?.output?.extracted?.outputPath ||
                           prevRecord?.output?.extracted?.filePath || '';
    
    // 3. 构建审核提示词
    const criteriaText = criteria?.map((c: any) => 
      `- ${c.name} (权重${c.weight}%): ${c.description}`
    ).join('\n') || '';
    
    // 构建评分项 JSON 模板
    const criteriaScoresTemplate = criteria?.map((c: any) => 
      `    "${c.name}": <分数>`
    ).join(',\n') || '    "criterion1": <分数>';
    
    // 审核报告要求（使用前端配置或默认值）
    const reviewReportRequirement = reviewReportInstruction || 
      '审核完成后，请生成审核报告文件，保存到与审核目标文档相同的目录下，命名规范为：{审核目标文档名字}_审核报告{日期时间}.md，并在返回审核结果时将该审核报告的完整路径附在 review_file 字段中。';
    
    // 构建审核提示词
    const reviewPrompt = `# 审核任务：${title || node.name}

## 审核说明
${instruction || '请对以下内容进行审核评估。'}

## 审核标准
${criteriaText}

## 评分方式
${scoreMethod === 'score' ? '请给出0-100的综合评分' : '请给出1-5星评级'}

## 待审核内容
${contentToReview}

## 审核报告要求
${reviewReportRequirement}

审核报告内容应包含：
1. 审核对象信息（节点名称、审核时间）
2. 审核评分结果（分数、是否通过）
3. 审核总结
4. 发现的问题列表
5. 改进建议列表
6. 详细审核意见

## 输出格式要求
请严格按照以下JSON格式输出审核结果（不要输出其他内容）：
\`\`\`json
{
  "score": <综合评分0-100>,
  "stars": <星级1-5>,
  "passed": <是否通过true/false>,
  "criteria_scores": {
${criteriaScoresTemplate}
  },
  "summary": "<审核总结>",
  "issues": ["<问题1>", "<问题2>", ...],
  "suggestions": ["<改进建议1>", "<改进建议2>", ...],
  "review_file": "<审核报告文件的完整路径>"
}
\`\`\`

注意：review_file 字段必须填写实际生成的审核报告文件路径。`;
    
    // 4. 保存审核 Agent 信息到数据库
    if (this.stateDB) {
      this.stateDB.updateNodeAgentInfo(
        this.context.instanceId,
        node.id,
        reviewerAgent.agentId || reviewerAgent.id,
        reviewerAgent.name,
        reviewPrompt
      );
    }
    
    // 5. 通知指挥官审核任务开始
    this.commanderChannel.notifyTaskStart({
      nodeId: node.id,
      nodeName: node.name,
      agentId: reviewerAgent.agentId || reviewerAgent.id,
      agentName: reviewerAgent.name,
      prompt: `审核任务: ${title || node.name}`,
    });
    
    // 6. 调用审核智能体
    const timeout = 0; // 0 表示无超时,永久等待审核完成
    let response: { success: boolean; output: string; error?: string };
    
    // 判断是否为 AHIVECORE 类型 Agent，走 CommanderChannel 异步链路
    const isAHIVECore = reviewerAgent.protocolType === 'ahivecore' || reviewerAgent.agentType === 'ahivecore';
    
    if (isAHIVECore) {
      // AHIVECORE Agent: 通过 CommanderChannel 异步执行
      const taskId = `review_${this.context.instanceId}_${node.id}_${Date.now()}`;
      
      console.log(`[WorkflowEngine] Dispatching agent review to AHIVECORE via CommanderChannel: ${taskId}`);
      
      // 发送审核任务
      await this.commanderChannel.assignTask(
        taskId,
        node.id,
        node.name,
        reviewPrompt,
        reviewerAgent.agentId || reviewerAgent.id,
        this.context.workflowId,
        this.context.instanceId,
        {},
        timeout
      );
      
      // 等待审核完成
      response = await this.commanderChannel.waitForTaskComplete(taskId, timeout);
      
      console.log(`[WorkflowEngine] Agent review task ${taskId} completed: ${response.success}`);
    } else {
      // 非 AHIVECORE Agent: 走原有同步调用
      response = await this.callAgent(reviewerAgent, reviewPrompt, timeout);
    }
    
    if (!response.success) {
      this.commanderChannel.notifyTaskError({
        nodeId: node.id,
        nodeName: node.name,
        error: response.error || 'Agent review failed',
      });
      throw new Error(response.error || 'Agent review failed');
    }
    
    // 6. 保存审核 Agent 的响应到数据库
    if (this.stateDB) {
      this.stateDB.updateNodeResponse(
        this.context.instanceId,
        node.id,
        response.output
      );
      console.log(`[WorkflowEngine] 审核响应已保存到数据库: ${node.id}`);
    }
    
    // 7. 解析审核结果
    const reviewResult = this.parseReviewResult(response.output);
    
    // 提取审核意见文件路径 (从 outputs 中)
    const reviewFile = response.outputs?.review_file || response.outputs?.reviewFile;
    
    console.log(`[WorkflowEngine] Review result:`, reviewResult);
    console.log(`[WorkflowEngine] Review file:`, reviewFile);
    
    // 7. 保存审核结果到数据库（简报 + 审核报告路径）
    if (this.stateDB) {
      const reviewOutputData = {
        summary: reviewResult.summary,
        score: reviewResult.score,
        passed: reviewResult.passed,
        issues: reviewResult.issues?.slice(0, 3), // 只保存前3条主要问题
        reviewFile: reviewFile, // 审核报告文件路径
      };
      
      await this.stateDB.updateNodeStatus(
        this.context.instanceId,
        node.id,
        'reviewed',
        reviewOutputData
      );
      console.log(`[WorkflowEngine] 审核结果已保存到数据库: ${node.id}`);
    }
    
    // 8. 存储审核结果到黑板
    this.blackboard.setVariable(`${node.id}:reviewResult`, reviewResult, {
      owner: this.context.instanceId,
    });
    
    // 存储分数到指定变量名（用于 passCondition 判断）
    if (passCondition?.variableName) {
      const scoreValue = scoreMethod === 'stars' ? (reviewResult.stars || 0) * 20 : (reviewResult.score || 0);
      this.blackboard.setVariable(passCondition.variableName, scoreValue, {
        owner: this.context.instanceId,
      });
      console.log(`[WorkflowEngine] Set ${passCondition.variableName} = ${scoreValue}`);
    }
    
    // 9. 判断是否通过审核
    const passed = this.evaluateReviewPassCondition(reviewResult, passCondition);
    
    console.log(`[WorkflowEngine] Review ${passed ? 'PASSED' : 'FAILED'}`);
    console.log(`[WorkflowEngine] Review result details:`, JSON.stringify(reviewResult, null, 2));
    console.log(`[WorkflowEngine] Pass condition:`, JSON.stringify(passCondition, null, 2));
    console.log(`[WorkflowEngine] Fail action:`, JSON.stringify(failAction, null, 2));
    
    // 10. 通知指挥官审核完成
    this.commanderChannel.notifyTaskComplete({
      nodeId: node.id,
      nodeName: node.name,
      output: `审核${passed ? '通过' : '未通过'}: ${reviewResult.summary || ''}`,
    });
    
    // 11. 如果审核未通过，处理失败动作
    if (!passed) {
      console.log(`[WorkflowEngine] Review failed, checking fail action...`);
      
      if (!failAction) {
        console.warn(`[WorkflowEngine] No fail action configured, continuing to next node`);
      } else if (failAction.type !== 'return') {
        console.warn(`[WorkflowEngine] Fail action type is '${failAction.type}', not 'return', continuing to next node`);
      } else {
        console.log(`[WorkflowEngine] Fail action type is 'return', will return to node: ${failAction.targetNodeId}`);
      }
    }
    
    if (!passed && failAction?.type === 'return') {
      const targetNodeId = failAction.targetNodeId;
      const maxRetries = failAction.maxRetries || 3;
      
      // 检查重试次数
      const retryKey = `${targetNodeId}:review_retries`;
      const currentRetries = (this.blackboard.getVariableValue(retryKey) as number) || 0;
      
      if (currentRetries >= maxRetries) {
        throw new Error(`审核未通过，已达到最大重试次数 ${maxRetries}`);
      }
      
      // 增加重试计数
      this.blackboard.setVariable(retryKey, currentRetries + 1, {
        owner: this.context.instanceId,
      });
      
      // 将审核意见保存到黑板,传递给目标节点
      const reviewFeedback = {
        passed: false,
        score: reviewResult.score,
        stars: reviewResult.stars,
        summary: reviewResult.summary,
        issues: reviewResult.issues,
        suggestions: reviewResult.suggestions,
        retryCount: currentRetries + 1,
        maxRetries: maxRetries,
        reviewNodeId: node.id,
        reviewNodeName: node.name,
        reviewFile: reviewFile,  // 添加审核意见文件路径
        timestamp: Date.now(),
      };
      
      // 保存审核反馈到黑板,供目标节点使用
      this.blackboard.setVariable(`${targetNodeId}:review_feedback`, reviewFeedback, {
        owner: this.context.instanceId,
      });
      
      // 同时保存到全局变量,方便访问
      this.blackboard.setVariable('last_review_feedback', reviewFeedback, {
        owner: this.context.instanceId,
      });
      
      console.log(`[WorkflowEngine] Review feedback saved for node ${targetNodeId}:`, JSON.stringify(reviewFeedback, null, 2));
      
      // 跳转回目标节点重新执行
      const targetIndex = this.workflow.nodes.findIndex(n => n.id === targetNodeId);
      if (targetIndex !== -1) {
        const targetNode = this.workflow.nodes[targetIndex];
        const targetAgent = this.agentResolver.resolve(targetNode.agentId || targetNode.id);
        
        console.log(`[WorkflowEngine] Review failed, returning to node: ${targetNodeId} (retry ${currentRetries + 1}/${maxRetries})`);
        
        // 广播审核失败事件,通知前端
        this.broadcastEvent({
          type: 'workflow-review-failed',
          instanceId: this.context.instanceId,
          workflowId: this.workflow.id,
          nodeId: node.id,
          nodeName: node.name,
          timestamp: Date.now(),
          data: {
            targetNodeId,
            reviewFeedback,
            retryCount: currentRetries + 1,
            maxRetries,
          },
        });
        
        // 向指挥官下达返工任务
        const retryTaskId = `retry_${taskId}_${currentRetries + 1}`;
        
        console.log(`[WorkflowEngine] 向指挥官下达返工任务: ${retryTaskId}`);
        
        await this.commanderChannel.assignTask(
          retryTaskId,
          targetNodeId,
          targetNode.name,
          '根据审核意见修改',  // taskBrief
          targetAgent?.agentId || targetAgent?.id || '',
          this.context.workflowId,
          this.context.instanceId,
          {
            reviewFeedback: reviewFeedback,  // 审核反馈信息
          },
          0  // 无超时
        );
        
        // 等待返工任务完成
        console.log(`[WorkflowEngine] 等待返工任务完成...`);
        const retryResponse = await this.commanderChannel.waitForTaskComplete(retryTaskId, 0);
        
        if (!retryResponse.success) {
          throw new Error(`返工任务失败: ${retryResponse.error}`);
        }
        
        console.log(`[WorkflowEngine] 返工任务完成,将继续执行审核节点`);
        
        // 设置当前节点为审核节点,继续循环
        this.currentNodeIndex = this.workflow.nodes.findIndex(n => n.id === node.id) - 1;
      }
    }
  }
  
  /**
   * 解析审核结果（从智能体回复中提取JSON）
   */
  private parseReviewResult(output: string): Record<string, any> {
    // 尝试提取 JSON 块
    const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // 继续尝试解析整个输出
      }
    }
    
    // 尝试直接解析
    try {
      return JSON.parse(output);
    } catch {
      // 尝试找到第一个 { 到最后一个 }
      const start = output.indexOf('{');
      const end = output.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        try {
          return JSON.parse(output.slice(start, end + 1));
        } catch {
          // 返回默认结果
        }
      }
    }
    
    // 默认结果
    return {
      score: 0,
      stars: 0,
      passed: false,
      summary: '无法解析审核结果',
      issues: ['审核结果格式无效'],
    };
  }
  
  /**
   * 评估审核是否通过
   */
  private evaluateReviewPassCondition(reviewResult: Record<string, any>, passCondition: any): boolean {
    if (!passCondition) {
      // 没有配置通过条件，默认审核通过
      return true;
    }
    
    const { variableName, operator, value: threshold } = passCondition;
    
    // 获取实际值
    let actualValue: number;
    if (variableName) {
      actualValue = Number(this.blackboard.getVariableValue(variableName)) || 0;
    } else {
      // 默认使用 score
      actualValue = reviewResult.score || 0;
    }
    
    // 评估条件
    switch (operator) {
      case 'gte':
      case '>=':
        return actualValue >= threshold;
      case 'gt':
      case '>':
        return actualValue > threshold;
      case 'lte':
      case '<=':
        return actualValue <= threshold;
      case 'lt':
      case '<':
        return actualValue < threshold;
      case 'eq':
      case '==':
        return actualValue === threshold;
      default:
        return actualValue >= threshold; // 默认 >=
    }
  }
  
  /**
   * 执行通知节点
   */
  private async executeNotifyNode(node: WorkflowNode): Promise<void> {
    const config = node.config || {};
    const notifyConfig = (config as any).notifyConfig;
    
    if (!notifyConfig) return;
    
    console.log(`[WorkflowEngine] Notify: ${notifyConfig.channels?.join(', ')}`);
    
    const template = notifyConfig.template || '';
    const message = this.templateRenderer.render(template, {
      ...this.blackboard.export().variables,
    });
    
    this.broadcastEvent({
      type: 'workflow-variable-set',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      timestamp: Date.now(),
      data: { type: 'notification', channels: notifyConfig.channels, message },
    });
  }
  
  /**
   * 执行输出节点
   */
  private executeOutputNode(node: WorkflowNode): void {
    const config = node.config || {};
    const outputConfig = (config as any).outputConfig;
    
    if (!outputConfig) return;
    
    console.log(`[WorkflowEngine] Output: ${outputConfig.name}`);
    
    this.blackboard.setVariable(`output:${outputConfig.name}`, {
      description: outputConfig.description,
      type: outputConfig.type,
      isFinalOutput: outputConfig.isFinalOutput,
      createdAt: new Date().toISOString(),
    }, { owner: this.context.instanceId });
  }
  
  /**
   * 收集输入
   */
  private gatherInputs(config: any): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const inputMappings = config.inputs;
    
    if (!inputMappings || inputMappings.length === 0) {
      return inputs;
    }
    
    for (const mapping of inputMappings) {
      let value: unknown;
      
      switch (mapping.source) {
        case 'blackboard':
          value = this.blackboard.getVariableValue(mapping.sourceKey || mapping.name);
          break;
          
        case 'prev-output':
          const parts = (mapping.sourceKey || '').split(':');
          if (parts.length === 2) {
            const nodeId = parts[0];
            const varName = parts[1];
            const key = `${nodeId}:${varName}`;
            value = this.blackboard.getVariableValue(key);
          }
          break;
          
        case 'user-input':
          value = mapping.defaultValue;
          break;
          
        case 'env':
          value = process.env[mapping.sourceKey || mapping.name];
          break;
      }
      
      if (value === undefined && mapping.defaultValue !== undefined) {
        value = mapping.defaultValue;
      }
      
      inputs[mapping.name] = value;
    }
    
    return inputs;
  }
  
  /**
   * 评估条件
   */
  private evaluateCondition(expression: string): boolean {
    if (!expression) return false;
    
    try {
      const varMatch = expression.match(/^(\w+)/);
      if (!varMatch) return false;
      
      const varName = varMatch[1];
      const varValue = this.blackboard.getVariableValue(varName);
      
      if (expression.includes('==')) {
        const [, right] = expression.split('==');
        return String(varValue) === right.trim();
      }
      
      if (expression.includes('!=')) {
        const [, right] = expression.split('!=');
        return String(varValue) !== right.trim();
      }
      
      if (expression.includes('>=')) {
        const [, right] = expression.split('>=');
        return Number(varValue) >= Number(right.trim());
      }
      
      if (expression.includes('<=')) {
        const [, right] = expression.split('<=');
        return Number(varValue) <= Number(right.trim());
      }
      
      if (expression.includes('>')) {
        const [, right] = expression.split('>');
        return Number(varValue) > Number(right.trim());
      }
      
      if (expression.includes('<')) {
        const [, right] = expression.split('<');
        return Number(varValue) < Number(right.trim());
      }
      
      return Boolean(varValue);
      
    } catch (error) {
      console.error(`[WorkflowEngine] Condition evaluation error:`, error);
      return false;
    }
  }
  
  /**
   * 创建执行记录
   */
  private createRecord(node: WorkflowNode): NodeExecutionRecord {
    return {
      nodeId: node.id,
      nodeName: node.name,
      startedAt: new Date().toISOString(),
      status: 'success',
      input: { prompt: '', variables: [] },
      output: { raw: '', extracted: {} },
    };
  }
  
  /**
   * 查找起始节点
   */
  private findStartNode(): WorkflowNode | undefined {
    const targetIds = new Set(this.workflow.edges.map(e => e.target));
    return this.workflow.nodes.find(n => !targetIds.has(n.id)) || this.workflow.nodes[0];
  }
  
  /**
   * 获取排序后的节点列表
   * 只考虑正常流程边，排除失败退回边（有 failCondition 的边）
   */
  private getSortedNodes(): WorkflowNode[] {
    const nodes = [...this.workflow.nodes];
    const edges = this.workflow.edges;
    
    // 只保留正常流程边（没有 failCondition 的边）
    const normalEdges = edges.filter(e => !e.failCondition);
    
    const sorted: WorkflowNode[] = [];
    const visited = new Set<string>();
    
    const visit = (node: WorkflowNode) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      
      // 只使用正常流程边
      const incoming = normalEdges.filter(e => e.target === node.id);
      for (const edge of incoming) {
        const prevNode = nodes.find(n => n.id === edge.source);
        if (prevNode) visit(prevNode);
      }
      
      sorted.push(node);
    };
    
    for (const node of nodes) {
      visit(node);
    }
    
    console.log(`[WorkflowEngine] Sorted nodes: ${sorted.map(n => n.name).join(' -> ')}`);
    
    return sorted;
  }
  
  /**
   * 广播事件
   */
  private broadcastEvent(event: WorkflowEvent): void {
    if (this.broadcast) {
      this.broadcast(event);
    }
  }
  
  /**
   * 执行规划节点
   * 调用LLM分析设计文档，生成带batch字段的任务列表
   */
  private async executePlannerNode(node: WorkflowNode, record: NodeExecutionRecord): Promise<void> {
    console.log(`[WorkflowEngine] Executing planner node: ${node.name}`);
    
    // 获取Agent列表
    const agents = this.agentResolver.getAllAgents();
    
    // 构建上游输出映射
    const prevOutputs = new Map<string, Record<string, any>>();
    for (const histRecord of this.history) {
      if (histRecord.output.extracted) {
        prevOutputs.set(histRecord.nodeId, histRecord.output.extracted);
      }
    }
    
    // 创建执行器
    const executor = new PlannerNodeExecutor({
      node,
      agents,
      callAgent: this.callAgent,
      workflowContext: this.workflow.context || {},
      blackboard: new Map(Object.entries(this.blackboard.export().variables)),
      prevOutputs,
      defaultAgentId: (node.config as any)?.executor?.executors?.[0]?.id,
    });
    
    // 执行
    const result = await executor.execute();
    
    if (result.success && result.output) {
      // 将规划输出存入黑板
      this.blackboard.setVariable(`${node.id}:output`, result.output, { 
        owner: this.context.instanceId 
      });
      this.blackboard.setVariable('modules', result.output.modules, { 
        owner: this.context.instanceId 
      });
      
      // 更新记录
      record.output.raw = JSON.stringify(result.output);
      record.output.extracted = { 
        modules: result.output.modules,
        architecture: result.output.architecture,
        integrationPlan: result.output.integrationPlan,
      };
      
      console.log(`[WorkflowEngine] Planner completed: ${result.output.modules.length} modules in ${result.duration}ms`);
    } else {
      throw new Error(result.error || 'Planner execution failed');
    }
  }
  
  /**
   * 执行动态并行节点
   * 根据规划结果动态创建子节点，按批次执行
   */
  private async executeDynamicParallelNode(node: WorkflowNode, record: NodeExecutionRecord): Promise<void> {
    console.log(`[WorkflowEngine] Executing dynamic-parallel node: ${node.name}`);
    
    // 获取Agent列表
    const agents = this.agentResolver.getAllAgents();
    
    // 构建上游输出映射
    const prevOutputs = new Map<string, Record<string, any>>();
    for (const histRecord of this.history) {
      if (histRecord.output.extracted) {
        prevOutputs.set(histRecord.nodeId, histRecord.output.extracted);
      }
    }
    
    // 创建执行器
    const executor = new DynamicParallelNodeExecutor({
      node,
      agents,
      callAgent: this.callAgent,
      broadcast: this.broadcast,
      workflowContext: this.workflow.context || {},
      blackboard: new Map(Object.entries(this.blackboard.export().variables)),
      prevOutputs,
      defaultAgentId: (node.config as any)?.executor?.executors?.[0]?.id,
      workflowId: this.workflow.id,
      instanceId: this.context.instanceId,
      stateDir: this.stateDir,
    });
    
    // 执行
    const result = await executor.execute();
    
    // 将结果存入黑板
    this.blackboard.setVariable(`${node.id}:output`, result, { 
      owner: this.context.instanceId 
    });
    this.blackboard.setVariable('dynamicResults', result.results, { 
      owner: this.context.instanceId 
    });
    
    // 更新记录
    record.output.raw = JSON.stringify(result);
    record.output.extracted = {
      results: result.results,
      successCount: result.successCount,
      failureCount: result.failureCount,
    };
    
    console.log(`[WorkflowEngine] Dynamic-parallel completed: ${result.successCount} success, ${result.failureCount} failed in ${result.totalDuration}ms`);
    
    // 如果全部失败且策略为abort，抛出错误
    if (result.failureCount > 0 && result.successCount === 0) {
      const config = node.config as any;
      if (config?.failureStrategy?.action === 'abort') {
        throw new Error('All dynamic nodes failed');
      }
    }
  }
  
  /**
   * 处理任务完成上报
   * 由 CommanderChannel 接收到 task_complete 事件后调用
   */
  async handleTaskCompleteReport(report: {
    taskId: string;
    nodeId: string;
    agentId: string;
    status: 'success' | 'failed' | 'partial';
    outputs: Record<string, any>;
    summary: string;
    timestamp: string;
    error?: { code: string; message: string; stack?: string };
  }): Promise<void> {
    console.log(`[WorkflowEngine] Task complete report: ${report.taskId} (${report.status})`);
    
    // 1. 更新节点状态
    const node = this.getNode(report.nodeId);
    if (!node) {
      console.warn(`[WorkflowEngine] Node not found: ${report.nodeId}`);
      return;
    }
    
    // 2. 更新黑板变量
    if (report.status === 'success' || report.status === 'partial') {
      // 将输出存入黑板
      for (const [key, value] of Object.entries(report.outputs)) {
        this.blackboard.setVariable(`${report.nodeId}:${key}`, value, {
          owner: report.agentId,
          type: 'output',
        });
      }
      
      // 存储摘要
      this.blackboard.setVariable(`${report.nodeId}:summary`, report.summary, {
        owner: report.agentId,
        type: 'summary',
      });
    }
    
    // 3. 持久化状态
    await this.saveState();
    
    // 4. 广播状态更新到前端
    this.broadcastEvent({
      type: 'workflow-node-state-update',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      timestamp: Date.now(),
      data: {
        nodeId: report.nodeId,
        nodeName: node.name,
        status: report.status,
        progress: report.status === 'success' ? 100 : (report.status === 'partial' ? 50 : 0),
        outputs: report.outputs,
        summary: report.summary,
        agentId: report.agentId,
      },
    });
    
    // 5. 如果失败，记录错误
    if (report.status === 'failed' && report.error) {
      this.context.error = report.error.message;
      this.callbacks.onError?.(report.nodeId, new Error(report.error.message));
    }
    
    // 6. 通知指挥官
    this.commanderChannel.notifyTaskComplete({
      nodeId: report.nodeId,
      nodeName: node.name,
      output: report.summary,
    });
  }
  
  /**
   * 处理进度上报
   */
  handleProgressReport(report: {
    taskId: string;
    nodeId: string;
    agentId: string;
    progress: number;
    phase: string;
    timestamp: string;
  }): void {
    console.log(`[WorkflowEngine] Progress report: ${report.taskId} - ${report.progress}%`);
    
    // 广播进度更新到前端
    this.broadcastEvent({
      type: 'workflow-node-progress',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      timestamp: Date.now(),
      data: {
        nodeId: report.nodeId,
        progress: report.progress,
        phase: report.phase,
        agentId: report.agentId,
      },
    });
  }

  /**
   * 处理指挥官返回的任务完成事件
   * 由 commanderChannel.on('task-complete') 触发
   */
  private handleTaskCompleteFromCommander(data: {
    taskId: string;
    nodeId: string;
    agentId: string;
    success: boolean;
    outputs?: Record<string, unknown>;
    error?: string;
  }): void {
    console.log(`[WorkflowEngine] Task complete from commander: ${data.taskId} (${data.nodeId})`);
    
    // 查找对应的执行记录
    const record = this.history.find(r => r.nodeId === data.nodeId);
    if (!record) {
      console.warn(`[WorkflowEngine] No execution record found for node: ${data.nodeId}`);
      return;
    }
    
    if (data.success) {
      // 解析输出
      const outputs = record.output.extracted || {};
      if (data.outputs) {
        for (const [key, value] of Object.entries(data.outputs)) {
          outputs[key] = value;
          this.blackboard.setVariable(`${data.nodeId}:${key}`, value, {
            owner: this.context.instanceId,
          });
        }
      }
      
      record.output.raw = (data.outputs?.output as string) || '';
      record.output.extracted = outputs;
      record.status = 'completed';
      record.completedAt = new Date().toISOString();
      
      console.log(`[WorkflowEngine] Node ${data.nodeId} completed via commander`);
    } else {
      record.status = 'failed';
      record.error = data.error || 'Task failed';
      record.completedAt = new Date().toISOString();
      
      console.warn(`[WorkflowEngine] Node ${data.nodeId} failed via commander: ${data.error}`);
    }
  }
  
  // ==================== 任务拆解处理方法 ====================

  /**
   * 处理拆解提案上报
   * 当 Agent 提交拆解方案时，保存状态并广播事件
   */
  handleDecomposeReport(report: {
    task_id: string;
    node_id: string;
    proposal_id: string;
    plan_path: string;
    plan_summary: {
      sub_tasks_count: number;
      estimated_time: number;
      risk_level: string;
    };
    status: string;
  }): void {
    console.log(`[WorkflowEngine] Decompose report: ${report.proposal_id} for node ${report.node_id}`);

    // 1. 保存拆解状态
    const state: DecompositionState = {
      status: 'proposing',
      proposalId: report.proposal_id,
      proposal: {
        taskId: report.task_id,
        nodeId: report.node_id,
        proposalId: report.proposal_id,
        planPath: report.plan_path,
        subTasksCount: report.plan_summary.sub_tasks_count,
        estimatedTime: report.plan_summary.estimated_time,
        riskLevel: report.plan_summary.risk_level,
      },
      subTasks: [],
      submittedAt: new Date().toISOString(),
    };

    this.decompositionStates.set(report.node_id, state);

    // 2. 保存到数据库
    if (this.stateDB) {
      this.stateDB.createDecomposition({
        instanceId: this.context.instanceId,
        nodeId: report.node_id,
        parentTaskId: report.task_id,
        proposalId: report.proposal_id,
        decompositionPlan: JSON.stringify(state.proposal),
        status: 'pending',
        submittedAt: new Date().toISOString(),
      });
    }

    // 3. 广播事件到前端
    this.broadcastEvent({
      type: 'workflow-task-decompose',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: report.node_id,
      nodeName: this.getNode(report.node_id)?.name || '',
      timestamp: Date.now(),
      data: {
        proposalId: report.proposal_id,
        planPath: report.plan_path,
        subTasksCount: report.plan_summary.sub_tasks_count,
        estimatedTime: report.plan_summary.estimated_time,
        riskLevel: report.plan_summary.risk_level,
        status: 'pending_approval',
      },
    });
  }

  /**
   * 处理拆解审批结果
   * 当指挥官审批后，更新状态并通知 Agent
   */
  handleDecomposeApprovedReport(report: {
    proposal_id: string;
    node_id: string;
    status: 'approved' | 'rejected';
    approved_sub_agents?: number;
    notes?: string;
    rejection_reason?: string;
    suggestions?: string;
  }): void {
    console.log(`[WorkflowEngine] Decompose approved/rejected: ${report.proposal_id} - ${report.status}`);

    // 1. 更新拆解状态
    const state = this.decompositionStates.get(report.node_id);
    if (!state) {
      console.warn(`[WorkflowEngine] No decomposition state for node: ${report.node_id}`);
      return;
    }

    state.status = report.status === 'approved' ? 'approved' : 'rejected';
    state.reviewResult = {
      status: report.status,
      approvedSubAgents: report.approved_sub_agents,
      notes: report.notes,
      rejectionReason: report.rejection_reason,
      suggestions: report.suggestions,
      reviewedAt: new Date().toISOString(),
    };

    this.decompositionStates.set(report.node_id, state);

    // 2. 更新数据库
    if (this.stateDB) {
      if (report.status === 'approved') {
        this.stateDB.approveDecomposition(
          report.proposal_id,
          'ahivecore',
          new Date().toISOString()
        );
      } else {
        this.stateDB.rejectDecomposition(
          report.proposal_id,
          report.rejection_reason || '',
          report.suggestions || ''
        );
      }
    }

    // 3. 广播事件到前端
    this.broadcastEvent({
      type: 'workflow-decompose-review',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: report.node_id,
      nodeName: this.getNode(report.node_id)?.name || '',
      timestamp: Date.now(),
      data: {
        proposalId: report.proposal_id,
        status: report.status,
        approvedSubAgents: report.approved_sub_agents,
        notes: report.notes,
        rejectionReason: report.rejection_reason,
        suggestions: report.suggestions,
      },
    });

    // 4. 如果批准，通知 CommanderChannel 发送审批结果给 Agent
    if (report.status === 'approved') {
      this.commanderChannel.notifyDecomposeApproved({
        nodeId: report.node_id,
        proposalId: report.proposal_id,
        authorizedSubAgents: report.approved_sub_agents || 3,
        notes: report.notes || '',
      });
    } else {
      this.commanderChannel.notifyDecomposeRejected({
        nodeId: report.node_id,
        proposalId: report.proposal_id,
        reason: report.rejection_reason || '',
        suggestions: report.suggestions || '',
      });
    }
  }

  /**
   * 处理子任务开始上报
   */
  handleSubTaskStartReport(report: {
    task_id: string;
    node_id: string;
    sub_task_id: string;
    agent_id: string;
  }): void {
    console.log(`[WorkflowEngine] Sub-task start: ${report.sub_task_id} by ${report.agent_id}`);

    const state = this.decompositionStates.get(report.node_id);
    if (!state) return;

    // 添加子任务状态
    const subTask: SubTaskState = {
      id: report.sub_task_id,
      name: report.sub_task_id,
      status: 'running',
      agentId: report.agent_id,
      startedAt: new Date().toISOString(),
    };

    state.subTasks.push(subTask);
    this.decompositionStates.set(report.node_id, state);

    // 更新数据库
    if (this.stateDB) {
      this.stateDB.updateDecompositionSubTasks(
        state.proposalId!,
        JSON.stringify(state.subTasks)
      );
    }

    // 广播事件
    this.broadcastEvent({
      type: 'workflow-sub-task-start',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: report.node_id,
      nodeName: this.getNode(report.node_id)?.name || '',
      timestamp: Date.now(),
      data: {
        subTaskId: report.sub_task_id,
        agentId: report.agent_id,
      },
    });
  }

  /**
   * 处理子任务完成上报
   */
  handleSubTaskCompleteReport(report: {
    task_id: string;
    node_id: string;
    sub_task_id: string;
    success: boolean;
    outputs?: Record<string, unknown>;
    error?: string;
  }): void {
    console.log(`[WorkflowEngine] Sub-task complete: ${report.sub_task_id} - ${report.success ? 'success' : 'failed'}`);

    const state = this.decompositionStates.get(report.node_id);
    if (!state) return;

    // 更新子任务状态
    const subTask = state.subTasks.find(s => s.id === report.sub_task_id);
    if (subTask) {
      subTask.status = report.success ? 'completed' : 'failed';
      subTask.outputs = report.outputs;
      subTask.error = report.error;
      subTask.completedAt = new Date().toISOString();
    }

    this.decompositionStates.set(report.node_id, state);

    // 更新数据库
    if (this.stateDB) {
      this.stateDB.updateDecompositionSubTasks(
        state.proposalId!,
        JSON.stringify(state.subTasks)
      );
    }

    // 广播事件
    this.broadcastEvent({
      type: 'workflow-sub-task-complete',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: report.node_id,
      nodeName: this.getNode(report.node_id)?.name || '',
      timestamp: Date.now(),
      data: {
        subTaskId: report.sub_task_id,
        success: report.success,
        outputs: report.outputs,
        error: report.error,
      },
    });
  }

  /**
   * 处理任务合并上报
   * 当所有子任务完成并合并后，更新状态并完成节点
   */
  handleTaskMergeReport(report: {
    task_id: string;
    node_id: string;
    proposal_id: string;
    merged_output: Record<string, unknown>;
    summary: string;
  }): void {
    console.log(`[WorkflowEngine] Task merge: ${report.proposal_id} for node ${report.node_id}`);

    const state = this.decompositionStates.get(report.node_id);
    if (!state) return;

    // 更新状态
    state.status = 'merged';
    state.mergeResult = {
      outputs: report.merged_output,
      summary: report.summary,
      mergedAt: new Date().toISOString(),
    };

    this.decompositionStates.set(report.node_id, state);

    // 更新数据库
    if (this.stateDB) {
      this.stateDB.completeDecomposition(
        report.proposal_id,
        JSON.stringify(report.merged_output),
        new Date().toISOString()
      );
    }

    // 将合并结果存入黑板
    for (const [key, value] of Object.entries(report.merged_output)) {
      this.blackboard.setVariable(`${report.node_id}:${key}`, value, {
        owner: this.context.instanceId,
      });
    }

    // 广播事件
    this.broadcastEvent({
      type: 'workflow-task-merge',
      instanceId: this.context.instanceId,
      workflowId: this.workflow.id,
      nodeId: report.node_id,
      nodeName: this.getNode(report.node_id)?.name || '',
      timestamp: Date.now(),
      data: {
        proposalId: report.proposal_id,
        mergedOutput: report.merged_output,
        summary: report.summary,
      },
    });

    // 标记节点完成（解除等待状态）
    // 这里需要通知 CommanderChannel 任务完成
    this.commanderChannel.notifyTaskComplete({
      nodeId: report.node_id,
      nodeName: this.getNode(report.node_id)?.name || '',
      output: report.summary,
    });
  }

  /**
   * 检查节点是否启用拆解
   */
  isDecompositionEnabled(node: WorkflowNode): boolean {
    const config = node.config || {};
    const decompositionConfig = (config as any).decompositionConfig;

    // 默认不启用，需要显式配置
    return decompositionConfig?.enabled === true;
  }

  /**
   * 获取节点的拆解状态
   */
  getDecompositionState(nodeId: string): DecompositionState | undefined {
    return this.decompositionStates.get(nodeId);
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.stopInquiryTimer();
    this.blackboard.destroy();
    this.agentResolver.clear();
    this.commanderChannel.destroy();
    this.decompositionStates.clear();
  }
}