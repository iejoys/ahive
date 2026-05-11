/**
 * 数据迁移模块
 * 处理工作流数据的版本升级和向后兼容
 */

import type { 
  Workflow, 
  WorkflowNode, 
  WorkflowEdge, 
  WorkflowNodeConfig,
  ExecutorConfig,
  WorkflowNodeType,
  InputMapping,
  OutputMapping 
} from '../types';

// ========== 版本定义 ==========

/** 当前数据版本 */
export const CURRENT_DATA_VERSION = '2.0.0';

/** 版本历史 */
export const VERSION_HISTORY = [
  { version: '1.0.0', description: '初始版本' },
  { version: '1.5.0', description: '添加失败退回线支持' },
  { version: '2.0.0', description: '多执行者支持、部门系统、审核节点' },
];

// ========== 类型定义 ==========

/** 旧版工作流节点 (v1.x) */
interface LegacyWorkflowNodeV1 {
  id: string;
  type: 'agent' | 'group' | 'condition' | 'parallel' | 'human';
  agentId?: string;
  groupId?: string;
  name: string;
  description?: string;
  position: { x: number; y: number };
  config?: {
    agentId?: string;
    groupId?: string;
    taskTemplate?: string;
    inputs?: unknown[];
    outputs?: unknown[];
    timeout?: number;
    retryCount?: number;
    conditions?: Array<{ expression: string; targetNode: string }>;
    defaultNode?: string;
    branches?: string[];
    mergeType?: 'all' | 'any';
    reviewTitle?: string;
    reviewDescription?: string;
    reviewOptions?: Array<{ label: string; value: string }>;
  };
  createdAt?: string;
  updatedAt?: string;
}

/** 旧版工作流 (v1.x) */
interface LegacyWorkflowV1 {
  id: string;
  name: string;
  description?: string;
  nodes: LegacyWorkflowNodeV1[];
  edges: WorkflowEdge[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** 工作流数据文件格式 (支持新旧版本) */
interface WorkflowsDataFile {
  version?: string;
  workflows: Workflow[] | LegacyWorkflowV1[];
  lastUpdated: string;
}

// ========== 迁移函数 ==========

/**
 * 迁移单个节点
 * 将旧版节点转换为新版格式
 */
export function migrateNode(node: LegacyWorkflowNodeV1): WorkflowNode {
  const migrated: WorkflowNode = {
    id: node.id,
    type: node.type as WorkflowNodeType,
    name: node.name,
    description: node.description,
    position: node.position,
    createdAt: node.createdAt,
    updatedAt: new Date().toISOString(),
  };
  
  // 迁移 config - 需要处理类型转换
  const config: WorkflowNodeConfig = {
    ...node.config,
    // 处理 inputs 类型转换
    inputs: node.config?.inputs as InputMapping[] | undefined,
    // 处理 outputs 类型转换
    outputs: node.config?.outputs as OutputMapping[] | undefined,
  };
  
  // 处理 agentId -> executor 迁移
  const agentId = node.agentId || node.config?.agentId;
  if (agentId) {
    // 保留旧字段以兼容
    migrated.agentId = agentId;
    config.agentId = agentId;
    
    // 生成新的 executor 配置
    config.executor = {
      mode: 'single',
      executors: [{
        type: 'agent',
        id: agentId,
      }],
      failureStrategy: {
        action: 'abort',
      },
    };
  }
  
  // 处理 groupId -> departmentConfig 迁移
  const groupId = node.groupId || node.config?.groupId;
  if (groupId) {
    // 将 group 类型改为 department
    migrated.type = 'department';
    
    // 保留旧字段以兼容
    migrated.groupId = groupId;
    config.groupId = groupId;
    
    // 生成新的 departmentConfig
    config.departmentConfig = {
      departmentId: groupId,
      triggerInternalWorkflow: true,
      waitForResult: true,
    };
  }
  
  // 迁移审核节点配置
  if (node.type === 'human' && (config.reviewTitle || config.reviewDescription)) {
    // 保留旧字段，同时生成新的 reviewConfig
    config.reviewConfig = {
      reviewType: 'human',
      title: config.reviewTitle || node.name,
      instruction: config.reviewDescription || '',
      scoreMethod: 'pass_fail',
      passCondition: {
        variableName: 'review_result',
        operator: 'eq',
        threshold: 1,
      },
      failAction: {
        type: 'abort',
      },
    };
  }
  
  migrated.config = config;
  return migrated;
}

/**
 * 迁移整个工作流
 */
export function migrateWorkflow(workflow: LegacyWorkflowV1): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map(migrateNode),
    edges: workflow.edges.map(migrateEdge),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 迁移边数据
 */
export function migrateEdge(edge: WorkflowEdge): WorkflowEdge {
  // 边数据结构未变化，直接返回
  return {
    ...edge,
    // 确保 failCondition 格式正确
    failCondition: edge.failCondition ? {
      variableName: edge.failCondition.variableName,
      operator: edge.failCondition.operator,
      value: edge.failCondition.value,
    } : undefined,
  };
}

/**
 * 迁移工作流数据文件
 * 检测版本并执行必要的迁移
 */
export function migrateWorkflowsData(data: WorkflowsDataFile): WorkflowsDataFile {
  const version = data.version || '1.0.0';
  
  // 已经是最新版本
  if (version === CURRENT_DATA_VERSION) {
    return data;
  }
  
  console.log(`[Migration] Migrating data from version ${version} to ${CURRENT_DATA_VERSION}`);
  
  // 执行迁移 - 将旧版数据转换为新版
  const migrated: WorkflowsDataFile = {
    version: CURRENT_DATA_VERSION,
    workflows: (data.workflows as LegacyWorkflowV1[]).map(migrateWorkflow),
    lastUpdated: new Date().toISOString(),
  };
  
  console.log(`[Migration] Migrated ${migrated.workflows.length} workflows`);
  
  return migrated;
}

/**
 * 检查是否需要迁移
 */
export function needsMigration(data: WorkflowsDataFile): boolean {
  const version = data.version || '1.0.0';
  return version !== CURRENT_DATA_VERSION;
}

/**
 * 获取迁移统计信息
 */
export function getMigrationStats(workflows: LegacyWorkflowV1[]): {
  total: number;
  needsMigration: number;
  hasMultipleAgents: number;
  hasGroups: number;
} {
  return {
    total: workflows.length,
    needsMigration: workflows.filter(w => !w.nodes?.every(n => 
      n.type !== 'group'
    )).length,
    hasMultipleAgents: workflows.filter(w => 
      w.nodes?.some(n => {
        const executor = (n.config as Record<string, unknown>)?.executor as { executors?: unknown[] } | undefined;
        return executor?.executors && executor.executors.length > 1;
      })
    ).length,
    hasGroups: workflows.filter(w => 
      w.nodes?.some(n => n.type === 'group' || n.groupId)
    ).length,
  };
}

// ========== 版本比较工具 ==========

/**
 * 比较版本号
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  
  return 0;
}

/**
 * 检查版本是否需要升级
 */
export function isVersionOutdated(version: string): boolean {
  return compareVersions(version, CURRENT_DATA_VERSION) < 0;
}

// ========== 导出 ==========

export default {
  CURRENT_DATA_VERSION,
  migrateNode,
  migrateWorkflow,
  migrateEdge,
  migrateWorkflowsData,
  needsMigration,
  getMigrationStats,
  compareVersions,
  isVersionOutdated,
};