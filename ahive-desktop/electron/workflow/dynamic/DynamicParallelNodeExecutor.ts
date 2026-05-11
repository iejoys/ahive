/**
 * 动态并行节点执行器
 * 
 * 根据规划结果动态创建子节点，按批次执行（批内并行，批间顺序）
 */

import type { Agent, WorkflowNode, WorkflowNodeConfig, WorkflowEdge } from '../types';
import type { 
  DynamicParallelConfig, 
  PlannerModule, 
  DynamicNodeState,
  DynamicParallelOutput,
  DynamicNodeResult,
  BatchGroup
} from './types';
import { TemplateEngine } from './TemplateEngine';
import { BatchGrouper } from './BatchGrouper';
import { ProgressTracker } from './ProgressTracker';
import { DynamicNodeStateStore } from './DynamicNodeStateStore';
import { WorkflowFilePersistence } from './WorkflowFilePersistence';

/**
 * Agent调用回调类型
 */
export type CallAgentCallback = (
  agent: Agent,
  prompt: string,
  timeout?: number
) => Promise<{ success: boolean; output: string; error?: string }>;

/**
 * 广播事件回调类型
 */
export type BroadcastCallback = (event: any) => void;

/**
 * 动态并行节点执行器配置
 */
export interface DynamicParallelExecutorConfig {
  // 节点配置
  node: WorkflowNode;
  
  // Agent列表
  agents: Agent[];
  
  // Agent调用回调
  callAgent: CallAgentCallback;
  
  // 广播回调
  broadcast?: BroadcastCallback;
  
  // 工作流上下文
  workflowContext: Record<string, any>;
  
  // 黑板变量
  blackboard: Map<string, any>;
  
  // 上游节点输出
  prevOutputs: Map<string, Record<string, any>>;
  
  // 默认Agent ID
  defaultAgentId?: string;
  
  // 工作流ID
  workflowId: string;
  
  // 实例ID
  instanceId: string;
  
  // 状态存储目录
  stateDir?: string;
  
  // 工作流文件路径（用于持久化）
  workflowFilePath?: string;
}

/**
 * 动态并行节点执行器
 */
export class DynamicParallelNodeExecutor {
  private config: DynamicParallelExecutorConfig;
  private templateEngine: TemplateEngine;
  private batchGrouper: BatchGrouper;
  private progressTracker: ProgressTracker;
  private stateStore: DynamicNodeStateStore;
  private filePersistence: WorkflowFilePersistence;
  
  constructor(config: DynamicParallelExecutorConfig) {
    this.config = config;
    this.templateEngine = new TemplateEngine();
    this.batchGrouper = new BatchGrouper();
    this.progressTracker = new ProgressTracker();
    this.stateStore = new DynamicNodeStateStore(config.stateDir || './data/workflow-states');
    this.filePersistence = new WorkflowFilePersistence();
  }
  
  /**
   * 执行动态并行节点
   */
  async execute(): Promise<DynamicParallelOutput> {
    const startTime = Date.now();
    
    try {
      // 1. 获取配置
      const dpConfig = this.getDynamicParallelConfig();
      
      if (!dpConfig) {
        throw new Error('Missing dynamic-parallel config');
      }
      
      // 2. 获取规划输出（模块列表）
      const modules = await this.getModules(dpConfig);
      
      if (!modules || modules.length === 0) {
        throw new Error('No modules to execute');
      }
      
      // 3. 按批次分组
      const batches = this.batchGrouper.groupByBatch(modules, dpConfig.batchField);
      const totalBatches = batches.length;
      
      console.log(`[DynamicParallelNodeExecutor] ${modules.length} modules in ${totalBatches} batches`);
      
      // 4. 初始化进度追踪
      this.progressTracker.initProgress(this.config.node.id, modules.length, totalBatches);
      
      // 5. 按批次执行
      const results: DynamicNodeResult[] = [];
      
      for (const batch of batches) {
        console.log(`[DynamicParallelNodeExecutor] Starting batch ${batch.batch} with ${batch.modules.length} modules`);
        
        // 报告批次开始
        this.reportProgress({
          type: 'batch_start',
          parentNodeId: this.config.node.id,
          nodeId: this.config.node.id,
          batch: batch.batch,
          index: 0,
          total: modules.length,
        });
        
        // 执行当前批次（并行）
        const batchResults = await this.executeBatch(batch, dpConfig, modules);
        results.push(...batchResults);
        
        // 报告批次完成
        this.reportProgress({
          type: 'batch_complete',
          parentNodeId: this.config.node.id,
          nodeId: this.config.node.id,
          batch: batch.batch,
          index: batch.modules.length,
          total: modules.length,
        });
        
        // 检查是否有失败且策略为abort
        const hasFailure = batchResults.some(r => !r.success);
        if (hasFailure && dpConfig.failureStrategy.action === 'abort') {
          console.error('[DynamicParallelNodeExecutor] Aborting due to failure');
          break;
        }
      }
      
      // 6. 持久化到工作流文件
      if (this.config.workflowFilePath) {
        await this.persistToWorkflowFile(modules, batches, results);
      }
      
      // 7. 构建输出
      const output: DynamicParallelOutput = {
        results,
        batches,
        successCount: results.filter(r => r.success).length,
        failureCount: results.filter(r => !r.success).length,
        totalDuration: Date.now() - startTime,
      };
      
      console.log(`[DynamicParallelNodeExecutor] Completed: ${output.successCount} success, ${output.failureCount} failed`);
      
      return output;
      
    } catch (error: any) {
      console.error('[DynamicParallelNodeExecutor] Execution error:', error);
      
      return {
        results: [],
        batches: [],
        successCount: 0,
        failureCount: 1,
        totalDuration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 获取动态并行配置
   */
  private getDynamicParallelConfig(): DynamicParallelConfig | null {
    const nodeConfig = this.config.node.config as any;
    
    if (!nodeConfig) return null;
    
    // 尝试多种配置位置
    if (nodeConfig.dynamicParallelConfig) {
      return nodeConfig.dynamicParallelConfig;
    }
    if (nodeConfig['dynamic-parallel']) {
      return nodeConfig['dynamic-parallel'];
    }
    
    // 从根级别构建配置
    return {
      sourceNode: nodeConfig.sourceNode || '',
      sourceKey: nodeConfig.sourceKey || 'modules',
      batchField: nodeConfig.batchField || 'batch',
      nodeTemplate: nodeConfig.nodeTemplate || { type: 'agent', config: {} },
      maxConcurrency: nodeConfig.maxConcurrency || 3,
      mergeStrategy: nodeConfig.mergeStrategy || 'all',
      failureStrategy: nodeConfig.failureStrategy || { action: 'continue' },
    };
  }
  
  /**
   * 获取模块列表
   */
  private async getModules(config: DynamicParallelConfig): Promise<PlannerModule[]> {
    // 从上游输出获取
    const sourceOutput = this.config.prevOutputs.get(config.sourceNode);
    
    if (sourceOutput && sourceOutput[config.sourceKey]) {
      return sourceOutput[config.sourceKey];
    }
    
    // 从黑板获取
    if (this.config.blackboard.has(config.sourceKey)) {
      return this.config.blackboard.get(config.sourceKey);
    }
    
    throw new Error(`Modules not found: sourceNode=${config.sourceNode}, sourceKey=${config.sourceKey}`);
  }
  
  /**
   * 执行一个批次
   */
  private async executeBatch(
    batch: BatchGroup,
    config: DynamicParallelConfig,
    allModules: PlannerModule[]
  ): Promise<DynamicNodeResult[]> {
    const results: DynamicNodeResult[] = [];
    const concurrency = config.maxConcurrency;
    
    // 分批并行执行
    for (let i = 0; i < batch.modules.length; i += concurrency) {
      const chunk = batch.modules.slice(i, i + concurrency);
      
      const chunkResults = await Promise.all(
        chunk.map((module, chunkIndex) => 
          this.executeModule(module, batch.batch, i + chunkIndex, allModules.length, config)
        )
      );
      
      results.push(...chunkResults);
    }
    
    return results;
  }
  
  /**
   * 执行单个模块
   */
  private async executeModule(
    module: PlannerModule,
    batch: number,
    index: number,
    total: number,
    config: DynamicParallelConfig
  ): Promise<DynamicNodeResult> {
    const startTime = Date.now();
    const nodeId = this.filePersistence.generateDynamicNodeId(this.config.node.id, batch, index);
    
    // 创建节点状态
    const state: DynamicNodeState = {
      nodeId,
      parentNodeId: this.config.node.id,
      workflowId: this.config.workflowId,
      instanceId: this.config.instanceId,
      batch,
      module,
      createdAt: new Date().toISOString(),
      status: 'running',
      input: {},
    };
    
    await this.stateStore.save(state);
    
    // 报告开始
    this.reportProgress({
      type: 'started',
      parentNodeId: this.config.node.id,
      nodeId,
      batch,
      index,
      total,
    });
    
    try {
      // 获取Agent
      const agent = this.getAgent();
      
      if (!agent) {
        throw new Error('No agent available');
      }
      
      // 构建任务提示词
      const prompt = this.buildTaskPrompt(module, config);
      
      // 调用Agent
      const result = await this.config.callAgent(agent, prompt, 3600000); // 1小时超时
      
      // 更新状态
      state.status = result.success ? 'completed' : 'failed';
      state.endTime = new Date().toISOString();
      state.duration = Date.now() - startTime;
      state.output = { raw: result.output };
      if (!result.success) {
        state.error = result.error;
      }
      
      await this.stateStore.save(state);
      
      // 报告完成
      this.reportProgress({
        type: result.success ? 'completed' : 'failed',
        parentNodeId: this.config.node.id,
        nodeId,
        batch,
        index,
        total,
        data: { duration: state.duration },
      });
      
      return {
        moduleId: module.id,
        batch,
        success: result.success,
        output: { raw: result.output },
        error: result.error,
        duration: state.duration,
      };
      
    } catch (error: any) {
      // 更新失败状态
      state.status = 'failed';
      state.endTime = new Date().toISOString();
      state.duration = Date.now() - startTime;
      state.error = error.message;
      
      await this.stateStore.save(state);
      
      // 报告失败
      this.reportProgress({
        type: 'failed',
        parentNodeId: this.config.node.id,
        nodeId,
        batch,
        index,
        total,
        data: { error: error.message },
      });
      
      return {
        moduleId: module.id,
        batch,
        success: false,
        error: error.message,
        duration: state.duration,
      };
    }
  }
  
  /**
   * 获取Agent
   */
  private getAgent(): Agent | null {
    if (this.config.defaultAgentId) {
      const agent = this.config.agents.find(a => a.id === this.config.defaultAgentId);
      if (agent) return agent;
    }
    return this.config.agents[0] || null;
  }
  
  /**
   * 构建任务提示词
   */
  private buildTaskPrompt(module: PlannerModule, config: DynamicParallelConfig): string {
    const context = this.templateEngine.createContext({
      workflowContext: this.config.workflowContext,
      input: {},
      item: module,
      index: 0,
      batch: module.batch,
      blackboard: this.config.blackboard,
    });
    
    // 使用节点模板的 taskTemplate
    const template = config.nodeTemplate.config?.taskTemplate || 
      '开发模块: {{item.name}}\n\n描述: {{item.description}}';
    
    return this.templateEngine.render(template, context);
  }
  
  /**
   * 报告进度
   */
  private reportProgress(options: {
    type: any;
    parentNodeId: string;
    nodeId: string;
    batch: number;
    index: number;
    total: number;
    data?: any;
  }): void {
    const event = this.progressTracker.createEvent(options);
    this.progressTracker.report(event);
    
    // 广播事件
    if (this.config.broadcast) {
      this.config.broadcast({
        type: 'workflow-dynamic-progress',
        instanceId: this.config.instanceId,
        workflowId: this.config.workflowId,
        nodeId: this.config.node.id,
        timestamp: Date.now(),
        data: event,
      });
    }
  }
  
  /**
   * 持久化到工作流文件
   */
  private async persistToWorkflowFile(
    modules: PlannerModule[],
    batches: BatchGroup[],
    results: DynamicNodeResult[]
  ): Promise<void> {
    if (!this.config.workflowFilePath) return;
    
    // 创建动态节点
    const dynamicNodes: WorkflowNode[] = [];
    const dynamicEdges: WorkflowEdge[] = [];
    
    for (const batch of batches) {
      for (let i = 0; i < batch.modules.length; i++) {
        const module = batch.modules[i];
        const nodeId = this.filePersistence.generateDynamicNodeId(this.config.node.id, batch.batch, i);
        
        const node: WorkflowNode = {
          id: nodeId,
          type: 'agent',
          name: module.name,
          description: module.description,
          position: {
            x: this.config.node.position.x + (batch.batch * 150),
            y: this.config.node.position.y + (i * 100),
          },
          config: {
            taskTemplate: `开发模块: ${module.name}\n\n描述: ${module.description}`,
            timeout: 3600000,
          },
        };
        
        dynamicNodes.push(node);
      }
    }
    
    // 创建边（批次间连接）
    for (let b = 0; b < batches.length - 1; b++) {
      const currentBatch = batches[b];
      const nextBatch = batches[b + 1];
      
      // 连接当前批次最后一个节点到下一批次第一个节点
      const sourceId = this.filePersistence.generateDynamicNodeId(
        this.config.node.id, 
        currentBatch.batch, 
        currentBatch.modules.length - 1
      );
      const targetId = this.filePersistence.generateDynamicNodeId(
        this.config.node.id, 
        nextBatch.batch, 
        0
      );
      
      const edge: WorkflowEdge = {
        id: this.filePersistence.generateDynamicEdgeId(sourceId, targetId),
        source: sourceId,
        target: targetId,
      };
      
      dynamicEdges.push(edge);
    }
    
    // 创建元数据
    const metadata = this.filePersistence.createMetadata(this.config.node.id, batches);
    
    // 持久化
    await this.filePersistence.persistDynamicNodes(
      this.config.workflowFilePath,
      dynamicNodes,
      dynamicEdges,
      metadata
    );
  }
  
  /**
   * 获取进度追踪器
   */
  getProgressTracker(): ProgressTracker {
    return this.progressTracker;
  }
}
