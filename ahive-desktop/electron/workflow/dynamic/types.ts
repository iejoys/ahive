/**
 * 动态任务拆分工作流类型定义
 * 
 * 包含 Planner 和 Dynamic-Parallel 节点的类型定义
 */

// ========== 规划节点类型 ==========

/**
 * 规划节点配置
 */
export interface PlannerNodeConfig {
  plannerConfig: {
    // 输入数据的键名
    inputKey: string;
    
    // 规划提示词模板
    planningPrompt: string;
    
    // 输出数据的JSON Schema
    outputSchema: Record<string, any>;
    
    // 生成的子节点类型
    targetNodeType: 'agent' | 'script' | 'http';
    
    // 子节点配置模板
    targetNodeTemplate: Record<string, any>;
    
    // 规划Agent配置（可选，默认使用工作流默认Agent）
    plannerAgent?: {
      agentId: string;
      model?: string;
      temperature?: number;
    };
  };
}

/**
 * 规划输出中的模块定义
 */
export interface PlannerModule {
  // 模块ID
  id: string;
  
  // 模块名称
  name: string;
  
  // 模块描述
  description: string;
  
  // 执行批次（同批次并行，不同批次顺序执行）
  batch: number;
  
  // 预估代码行数
  estimatedLines?: number;
  
  // 优先级
  priority?: 'high' | 'medium' | 'low';
  
  // 技术要点
  techPoints?: string[];
  
  // 依赖的模块ID列表
  dependsOn?: string[];
}

/**
 * 规划节点输出
 */
export interface PlannerOutput {
  // 模块列表（按batch升序排列）
  modules: PlannerModule[];
  
  // 整体架构设计
  architecture?: Record<string, any>;
  
  // 集成方案说明
  integrationPlan?: string;
}

// ========== 动态并行节点类型 ==========

/**
 * 动态并行节点配置
 */
export interface DynamicParallelConfig {
  // 数据来源节点ID
  sourceNode: string;
  
  // 数据来源的输出键名
  sourceKey: string;
  
  // 批次字段名（默认 "batch"）
  batchField?: string;
  
  // 子节点配置模板
  nodeTemplate: {
    type: string;
    config: Record<string, any>;
  };
  
  // 每批次内的最大并发数
  maxConcurrency: number;
  
  // 合并策略
  mergeStrategy: 'all' | 'any' | 'first';
  
  // 失败处理策略
  failureStrategy: {
    action: 'continue' | 'abort' | 'retry';
    retryCount?: number;
  };
  
  // 进度回调配置
  progressCallback?: {
    enabled: boolean;
    interval: number;
  };
}

/**
 * 批次分组结果
 */
export interface BatchGroup {
  // 批次号
  batch: number;
  
  // 该批次的模块列表
  modules: PlannerModule[];
}

/**
 * 动态节点执行结果
 */
export interface DynamicNodeResult {
  // 模块ID
  moduleId: string;
  
  // 批次号
  batch: number;
  
  // 执行成功
  success: boolean;
  
  // 输出数据
  output?: Record<string, any>;
  
  // 错误信息
  error?: string;
  
  // 执行时长（毫秒）
  duration?: number;
}

/**
 * 动态并行节点输出
 */
export interface DynamicParallelOutput {
  // 所有执行结果
  results: DynamicNodeResult[];
  
  // 批次信息
  batches: BatchGroup[];
  
  // 成功数量
  successCount: number;
  
  // 失败数量
  failureCount: number;
  
  // 总执行时长
  totalDuration: number;
}

// ========== 动态节点状态类型 ==========

/**
 * 动态节点状态
 */
export interface DynamicNodeState {
  // 动态节点ID
  nodeId: string;
  
  // 父节点ID
  parentNodeId: string;
  
  // 工作流ID
  workflowId: string;
  
  // 实例ID
  instanceId: string;
  
  // 批次号
  batch: number;
  
  // 模块信息
  module: PlannerModule;
  
  // 创建时间
  createdAt: string;
  
  // 节点状态
  status: 'pending' | 'running' | 'completed' | 'failed';
  
  // 输入数据
  input: Record<string, any>;
  
  // 输出数据
  output?: Record<string, any>;
  
  // 错误信息
  error?: string;
  
  // 执行时间
  startTime?: string;
  endTime?: string;
  duration?: number;
}

/**
 * 工作流动态元数据
 */
export interface WorkflowDynamicMetadata {
  // 父节点ID
  parentNodeId: string;
  
  // 批次映射 { batch号: [节点ID列表] }
  batches: Record<number, string[]>;
  
  // 创建时间
  createdAt: string;
  
  // 更新时间
  updatedAt?: string;
}

// ========== 进度事件类型 ==========

/**
 * 动态节点进度事件类型
 */
export type DynamicProgressEventType = 
  | 'created' 
  | 'started' 
  | 'progress' 
  | 'completed' 
  | 'failed' 
  | 'batch_start' 
  | 'batch_complete';

/**
 * 动态节点进度事件
 */
export interface DynamicNodeProgressEvent {
  // 事件类型
  type: DynamicProgressEventType;
  
  // 父节点ID
  parentNodeId: string;
  
  // 动态节点ID
  nodeId: string;
  
  // 批次号
  batch: number;
  
  // 节点索引
  index: number;
  
  // 总数
  total: number;
  
  // 进度百分比
  percentage: number;
  
  // 时间戳
  timestamp: string;
  
  // 附加数据
  data?: Record<string, any>;
}

// ========== 模板上下文类型 ==========

/**
 * 模板渲染上下文
 */
export interface TemplateContext {
  // 工作流上下文
  context: Record<string, any>;
  
  // 节点输入
  input: Record<string, any>;
  
  // 当前项（动态节点）
  item?: PlannerModule;
  
  // 当前索引
  index?: number;
  
  // 当前批次
  batch?: number;
  
  // 其他变量
  [key: string]: any;
}
