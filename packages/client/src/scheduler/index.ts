// ========== 定时任务调度 ==========
export { taskScheduler } from './TaskScheduler';
export type { TaskExecutor } from './TaskScheduler';
export { executeScheduledTask, isElectronEnvironment } from './TaskExecutor';
export type { ExecutionResult } from './TaskExecutor';

// ========== 数据同步 ==========
export {
  loadScheduledTasksFromStorage,
  saveScheduledTaskToStorage,
  deleteScheduledTaskFromStorage,
  toggleScheduledTaskInStorage,
  addTaskRunToStorage,
  loadAllTaskRunsFromStorage,
  getDataDirectory,
  // 工作流持久化
  loadWorkflowsFromStorage,
  saveWorkflowToStorage,
  deleteWorkflowFromStorage,
  importWorkflowToStorage,
  workflowNameExistsInStorage,
  // 黑板持久化（旧版兼容）
  loadBlackboardStateFromStorage,
  saveBlackboardStateToStorage,
  // 黑板持久化（V2 - 分文件存储）
  loadGlobalVariablesFromStorage,
  saveGlobalVariablesToStorage,
  loadWorkflowVariablesFromStorage,
  saveWorkflowVariablesToStorage,
  deleteWorkflowVariablesFromStorage,
  loadAllWorkflowVariablesFromStorage,
  // 执行状态持久化
  loadExecutionStatesFromStorage,
  saveExecutionStateToStorage,
  // 工作流执行日志持久化
  saveWorkflowExecutionLogToStorage,
  getWorkflowExecutionLogFromStorage,
  getWorkflowExecutionLogsFromStorage,
  deleteWorkflowExecutionLogFromStorage,
  // 部门持久化
  loadDepartmentsFromStorage,
  saveDepartmentsToStorage,
  saveDepartmentToStorage,
  deleteDepartmentFromStorage,
} from './DataSync';

// ========== 共享黑板 ==========
export { BlackboardService, blackboard } from './Blackboard';
export type { PersistCallback } from './Blackboard';
export type {
  VariableEntry,
  VariableScope,
  BlackboardTask,
  AgentState,
  Artifact,
  TaskStatus,
  SetVariableOptions,
  VariableSubscribeCallback,
  TaskSubscribeCallback,
  EventCallback,
  BlackboardEvent,
  BlackboardConfig,
  BlackboardSnapshot,
  WorkflowVariableSyncEvent,
  GlobalVariableChangeEvent,
  BlackboardStats,
} from './BlackboardTypes';

// ========== 模板渲染 ==========
export { TemplateRenderer, templateRenderer } from './TemplateRenderer';

// ========== 输出解析 ==========
export { OutputParser, outputParser } from './OutputParser';
export type { ParsedOutput } from './OutputParser';

// ========== 工作流执行器 V2 ==========
// 注意：WorkflowExecutorV2 已迁移到主进程 (ahive-electron/electron/workflow/)
// 前端通过 IPC 调用，此处仅保留类型导出
// export { WorkflowExecutorV2, createWorkflowExecutor } from './WorkflowExecutorV2';
export type {
  ExecutionStatus,
  ExecutionContext,
  NodeExecutionRecord,
  WorkflowExecutionResult,
  ExecutionCallback,
} from './WorkflowExecutorV2';

// ========== Agent 协作协议 ==========
export {
  AgentProtocolParser,
  AgentProtocolExecutor,
  agentProtocolParser,
  parseProtocolCommands,
  generateAgentListPrompt,
} from './AgentProtocol';
export type {
  ProtocolCommandType,
  RequestAgentCommand,
  BroadcastCommand,
  VoteCommand,
  QueryPeerCommand,
  ProtocolCommand,
  ProtocolParseResult,
  ProtocolExecutionResult,
  ProtocolExecutorCallbacks,
  AgentProtocolConfig,
} from './AgentProtocol';

// ========== 故障恢复管理器 ==========
export { RecoveryManager, recoveryManager, withTimeout, withRetry } from './RecoveryManager';
export type {
  FailureType,
  RecoveryStrategy,
  FailureRecord,
  RecoveryConfig,
  RecoveryAction,
  AgentHealthStatus,
} from './RecoveryManager';

// ========== Agent Swarm 集群执行 ==========
export { AgentSwarm, agentSwarm, createSwarmTask, createSwarmTasks } from './AgentSwarm';
export type {
  SwarmTask,
  SwarmTaskStatus,
  SwarmTaskRecord,
  SwarmResult,
  SwarmConfig,
  AgentLoad,
  SwarmCallbacks,
} from './AgentSwarm';

// ========== 投票管理器 ==========
export { VotingManager, votingManager, createVoteOption, createVote } from './VotingManager';
export type {
  VoteStatus,
  VoteType,
  Vote,
  VoteOption,
  Ballot,
  VoteResult,
  VoteTally,
  VoteDecisionMethod,
  VotingConfig,
  VotingCallbacks,
} from './VotingManager';

// ========== 意图解析器增强 ==========
export { IntentParserEnhanced, intentParserEnhanced, parseIntent, parseAndPlan } from './IntentParserEnhanced';
export type {
  IntentType,
  Priority,
  ParsedIntent,
  Constraint,
  OutputSpec,
  Ambiguity,
  TaskSuggestion,
  ExecutionPlan,
  PlannedTask,
  Risk,
  IntentParserConfig,
} from './IntentParserEnhanced';