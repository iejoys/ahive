/**
 * 工作流模块统一导出
 */

// 类型
export * from './types';

// 基础工具类
export { BlackboardService } from './Blackboard';
export type { BlackboardConfig, PersistCallback } from './Blackboard';

export { TemplateRenderer } from './TemplateRenderer';
export { OutputParser } from './OutputParser';
export type { ParsedOutput } from './OutputParser';

export { AgentResolver } from './AgentResolver';

// 核心类（从 core 目录导出）
export { WorkflowScheduler } from './core/WorkflowScheduler';
export type { WorkflowSchedulerConfig } from './core/WorkflowScheduler';

export { WorkflowEngine } from './core/WorkflowEngine';
export type { WorkflowEngineConfig, CallAgentCallback, BroadcastCallback } from './core/WorkflowEngine';

export { CommanderChannel } from './core/CommanderChannel';
export type { CommanderChannelConfig, CommanderMessage } from './core/CommanderChannel';

// 持久化类
export { StateManager } from './persistence/StateManager';
export type { 
  WorkflowExecutionState, 
  NodeExecutionRecord, 
  AgentWorkState,
  CommanderLogEntry,
  WorkflowExecutionStatus,
  NodeExecutionStatus
} from './persistence/StateManager';

// 恢复类
export { InterruptRecovery } from './recovery/InterruptRecovery';
export type { 
  RecoveryPoint, 
  RecoveryResult, 
  InterruptRecoveryConfig 
} from './recovery/InterruptRecovery';