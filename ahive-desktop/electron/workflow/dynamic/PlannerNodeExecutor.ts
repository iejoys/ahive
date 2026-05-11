/**
 * 规划节点执行器
 * 
 * 调用LLM分析设计文档，生成带batch字段的任务列表
 */

import type { Agent, WorkflowNode, WorkflowNodeConfig } from '../types';
import type { PlannerNodeConfig, PlannerOutput, PlannerModule } from './types';
import { TemplateEngine } from './TemplateEngine';
import { BatchGrouper } from './BatchGrouper';

/**
 * Agent调用回调类型
 */
export type CallAgentCallback = (
  agent: Agent,
  prompt: string,
  timeout?: number
) => Promise<{ success: boolean; output: string; error?: string }>;

/**
 * 规划节点执行器配置
 */
export interface PlannerExecutorConfig {
  // 节点配置
  node: WorkflowNode;
  
  // Agent列表
  agents: Agent[];
  
  // Agent调用回调
  callAgent: CallAgentCallback;
  
  // 工作流上下文
  workflowContext: Record<string, any>;
  
  // 黑板变量
  blackboard: Map<string, any>;
  
  // 上游节点输出
  prevOutputs: Map<string, Record<string, any>>;
  
  // 默认Agent ID
  defaultAgentId?: string;
}

/**
 * 规划节点执行结果
 */
export interface PlannerExecutorResult {
  // 是否成功
  success: boolean;
  
  // 规划输出
  output?: PlannerOutput;
  
  // 错误信息
  error?: string;
  
  // 执行时长
  duration: number;
}

/**
 * 规划节点执行器
 */
export class PlannerNodeExecutor {
  private config: PlannerExecutorConfig;
  private templateEngine: TemplateEngine;
  private batchGrouper: BatchGrouper;
  
  constructor(config: PlannerExecutorConfig) {
    this.config = config;
    this.templateEngine = new TemplateEngine();
    this.batchGrouper = new BatchGrouper();
  }
  
  /**
   * 执行规划节点
   */
  async execute(): Promise<PlannerExecutorResult> {
    const startTime = Date.now();
    
    try {
      // 1. 获取规划配置
      const plannerConfig = this.getPlannerConfig();
      
      if (!plannerConfig) {
        return {
          success: false,
          error: 'Missing plannerConfig in node configuration',
          duration: Date.now() - startTime,
        };
      }
      
      // 2. 获取输入数据
      const inputData = await this.getInputData(plannerConfig.inputKey);
      
      // 3. 构建规划提示词
      const prompt = this.buildPrompt(plannerConfig, inputData);
      
      // 4. 获取规划Agent
      const agent = this.getPlannerAgent(plannerConfig);
      
      if (!agent) {
        return {
          success: false,
          error: 'No agent available for planning',
          duration: Date.now() - startTime,
        };
      }
      
      // 5. 调用Agent进行规划
      console.log(`[PlannerNodeExecutor] Calling agent ${agent.id} for planning...`);
      
      const result = await this.config.callAgent(agent, prompt, 300000); // 5分钟超时
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Agent call failed',
          duration: Date.now() - startTime,
        };
      }
      
      // 6. 解析规划输出
      const output = this.parseOutput(result.output, plannerConfig);
      
      if (!output) {
        return {
          success: false,
          error: 'Failed to parse planner output',
          duration: Date.now() - startTime,
        };
      }
      
      // 7. 验证和修正批次分配
      const validatedOutput = this.validateAndFixOutput(output);
      
      console.log(`[PlannerNodeExecutor] Planning completed with ${validatedOutput.modules.length} modules`);
      
      return {
        success: true,
        output: validatedOutput,
        duration: Date.now() - startTime,
      };
      
    } catch (error: any) {
      console.error('[PlannerNodeExecutor] Execution error:', error);
      return {
        success: false,
        error: error.message || 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 获取规划配置
   */
  private getPlannerConfig(): PlannerNodeConfig['plannerConfig'] | null {
    const nodeConfig = this.config.node.config as WorkflowNodeConfig;
    
    if (!nodeConfig || !nodeConfig.plannerConfig) {
      // 尝试从 config 根级别获取
      const rootConfig = this.config.node.config as any;
      if (rootConfig && rootConfig.plannerConfig) {
        return rootConfig.plannerConfig;
      }
      return null;
    }
    
    return nodeConfig.plannerConfig as PlannerNodeConfig['plannerConfig'];
  }
  
  /**
   * 获取输入数据
   */
  private async getInputData(inputKey: string): Promise<any> {
    // 优先从黑板获取
    if (this.config.blackboard.has(inputKey)) {
      return this.config.blackboard.get(inputKey);
    }
    
    // 从上游输出获取
    for (const [nodeId, output] of this.config.prevOutputs) {
      if (output[inputKey] !== undefined) {
        return output[inputKey];
      }
    }
    
    // 从工作流上下文获取
    if (this.config.workflowContext[inputKey] !== undefined) {
      return this.config.workflowContext[inputKey];
    }
    
    return null;
  }
  
  /**
   * 构建规划提示词
   */
  private buildPrompt(plannerConfig: PlannerNodeConfig['plannerConfig'], inputData: any): string {
    const context = this.templateEngine.createContext({
      workflowContext: this.config.workflowContext,
      input: { [plannerConfig.inputKey]: inputData },
      blackboard: this.config.blackboard,
    });
    
    // 渲染提示词模板
    let prompt = this.templateEngine.render(plannerConfig.planningPrompt, context);
    
    // 添加输入数据
    prompt += '\n\n---\n\n**输入数据:**\n';
    if (typeof inputData === 'string') {
      prompt += inputData;
    } else {
      prompt += '```json\n' + JSON.stringify(inputData, null, 2) + '\n```';
    }
    
    // 添加输出格式要求
    prompt += '\n\n---\n\n**输出格式要求:**\n';
    prompt += '请以JSON格式输出，包含以下字段:\n';
    prompt += '- modules: 模块数组，每个模块包含 id, name, description, batch, priority 等字段\n';
    prompt += '- architecture: 整体架构设计（可选）\n';
    prompt += '- integrationPlan: 集成方案说明（可选）\n';
    prompt += '\n请确保输出是有效的JSON格式。';
    
    return prompt;
  }
  
  /**
   * 获取规划Agent
   */
  private getPlannerAgent(plannerConfig: PlannerNodeConfig['plannerConfig']): Agent | null {
    // 优先使用配置的规划Agent
    if (plannerConfig.plannerAgent?.agentId) {
      const agent = this.config.agents.find(a => a.id === plannerConfig.plannerAgent!.agentId);
      if (agent) return agent;
    }
    
    // 使用默认Agent
    if (this.config.defaultAgentId) {
      const agent = this.config.agents.find(a => a.id === this.config.defaultAgentId);
      if (agent) return agent;
    }
    
    // 使用第一个可用Agent
    return this.config.agents[0] || null;
  }
  
  /**
   * 解析规划输出
   */
  private parseOutput(rawOutput: string, plannerConfig: PlannerNodeConfig['plannerConfig']): PlannerOutput | null {
    try {
      // 尝试提取JSON
      let jsonStr = rawOutput;
      
      // 尝试从markdown代码块中提取
      const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      
      // 尝试直接解析
      const parsed = JSON.parse(jsonStr);
      
      // 验证必要字段
      if (!parsed.modules || !Array.isArray(parsed.modules)) {
        console.error('[PlannerNodeExecutor] Output missing modules array');
        return null;
      }
      
      // 确保每个模块有必要的字段
      const modules: PlannerModule[] = parsed.modules.map((m: any, index: number) => ({
        id: m.id || `module-${index}`,
        name: m.name || `Module ${index}`,
        description: m.description || '',
        batch: m.batch ?? 1,
        estimatedLines: m.estimatedLines,
        priority: m.priority || 'medium',
        techPoints: m.techPoints || [],
        dependsOn: m.dependsOn || [],
      }));
      
      return {
        modules,
        architecture: parsed.architecture,
        integrationPlan: parsed.integrationPlan,
      };
      
    } catch (error) {
      console.error('[PlannerNodeExecutor] Failed to parse output:', error);
      return null;
    }
  }
  
  /**
   * 验证和修正批次分配
   */
  private validateAndFixOutput(output: PlannerOutput): PlannerOutput {
    // 验证批次分配
    const validation = this.batchGrouper.validateBatchAssignment(output.modules);
    
    if (!validation.valid) {
      console.warn('[PlannerNodeExecutor] Batch assignment validation failed:', validation.errors);
      
      // 自动修正
      const fixedModules = this.batchGrouper.autoFixBatchAssignment(output.modules);
      console.log('[PlannerNodeExecutor] Auto-fixed batch assignment');
      
      return {
        ...output,
        modules: fixedModules,
      };
    }
    
    return output;
  }
}
