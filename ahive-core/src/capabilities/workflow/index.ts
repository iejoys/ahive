/**
 * 工作流编排能力模块
 * 
 * 指挥官用于生成和管理工作流
 */

export { WorkflowOrchestrator } from '../../orchestrator/WorkflowOrchestrator.js';
export { workflowTools } from './tools.js';
export type {
  WorkflowGenerationResult,
  WorkflowJSON,
  WorkflowNode,
  WorkflowEdge,
} from '../../orchestrator/WorkflowOrchestrator.js';