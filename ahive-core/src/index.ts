/**
 * AHIVE Core - 基于 OpenClaw 复用的核心引擎
 * 
 * 从 OpenClaw 抽离的可复用模块：
 * - Plugin SDK: 插件系统核心
 * - Memory: 记忆与向量搜索
 * - Agents: 智能体引擎
 * - Gateway: 网关与认证
 * - Config: 配置管理
 * 
 * 新增模块 (参考 Codex/OpenCode 设计)：
 * - MultiAgent: 多智能体分身系统
 * - Sandbox: 沙箱安全执行
 * - Orchestrator: 工具编排器
 */

// ========== 核心智能体系统 ==========
export { UnifiedAgentSystem } from './agents/core/UnifiedAgentSystem.js';
export type { 
  AgentType,
  AgentModelConfig,
  AgentCard,
} from './agents/core/UnifiedAgentSystem.js';

// ========== AHIVE-CODER 执行器 ==========
export { AhiveCoderExecutor, createAhiveCoderExecutor } from './agents/ahive-coder/index.js';
export type { 
  AhiveCoderExecutorConfig, 
  AhiveCoderExecuteOptions,
  AhiveCoderEvent,
} from './agents/ahive-coder/executor.js';

// ========== 工具系统 ==========
export { ToolRegistry } from './executor/tool-system.js';
export { 
  execTool, 
  readFileTool, 
  writeFileTool, 
  processTool,
  grepFilesTool,
  spawnAgentTool,
  waitAgentTool,
  sendMessageTool,
} from './executor/builtin-tools.js';
export type { AgentTool, ToolResult, ToolParameters } from './executor/tool-system.js';

// ========== 模型提供者 ==========
export { getProviderManager } from './providers/provider-manager.js';
export { OpenAIProvider } from './providers/openai-provider.js';
export type { 
  ProviderConfig,
  ToolDefinition as ProviderToolDefinition,
} from './providers/index.js';

// Plugin SDK (排除 Logger 接口，避免与 utils Logger 类冲突)
export {
  Plugin,
  PluginContext,
  MessagePayload,
  Attachment,
  SendResult,
  Storage,
  Command,
  CommandParameter,
  CommandArgs,
  CallerInfo,
  CommandResult,
  Tool,
  PluginManager,
  createLogger,
  createMemoryStorage,
} from './plugin-sdk/index.js';
// Plugin SDK 的 Logger 接口使用别名导出
export type { Logger as PluginLogger } from './plugin-sdk/index.js';

// Memory System
export {
  createMemoryStore,
  createSessionMessage,
  MemoryStoreImpl,
} from './memory/index.js';
export type {
  Memory,
  MemoryType,
  MemoryQuery,
  MemoryStore,
  SessionMemory,
  SessionMessage,
} from './memory/index.js';

// Agents Engine
export {
  createIntentParser,
  createGGUFClient,
  createOllamaClient,
} from './agents/index.js';
export type {
  Agent,
  ModelConfig,
  ChatMessage,
  LLMResponse,
  GGUFClient,
  OllamaClient,
} from './agents/index.js';

// Multi-Agent System (新增 - 参考 Codex)
export {
  AgentController,
  agentController,
  MultiAgentStatus,
} from './agents/index.js';
export type {
  MultiAgentConfig,
  MultiAgentMessage,
  MultiAgentResult,
  SpawnAgentOptions,
  SandboxPolicy,
  ApprovalPolicy,
} from './agents/index.js';

// Sandbox Executor (新增 - 参考 Codex)
export {
  SandboxExecutor,
  sandboxExecutor,
  ApprovalDecision,
  SandboxType,
} from './sandbox/index.js';
export type {
  CommandSpec,
  ExecResult,
  ApprovalRequest,
} from './sandbox/index.js';

// Tool Orchestrator (新增 - 参考 Codex)
export {
  ToolOrchestrator,
  toolOrchestrator,
  registerBuiltinTools,
  ToolKind,
} from './orchestrator/index.js';
export type {
  ToolDefinition,
  ToolCallRequest,
  ToolCallResult,
  ToolHandler,
  ParallelOptions,
} from './orchestrator/index.js';

// Gateway Core (excluding AuthConfig to avoid conflict)
export {
  GatewayConfig,
  CorsConfig,
  HttpRequest,
  HttpResponse,
  RouteHandler,
  Middleware,
  SimpleHttpServer,
  AuthManager,
  createGatewayConfig,
  createHttpServer,
  createAuthManager,
  loggingMiddleware,
  authMiddleware,
} from './gateway/index.js';
export type { AuthResult } from './gateway/index.js';
export { agentRegistry } from './gateway/auth-middleware.js';
export type { AgentInfo, AgentConfig } from './gateway/auth-middleware.js';

// Config System
export * from './config/index.js';

// Knowledge Base (新增)
export * from './knowledge/index.js';

// Expert Agent (新增)
export * from './expert/index.js';

// ASTA 已移除

// Utils (Logger 类从这里导出)
export * from './utils/index.js';

/**
 * 版本信息
 */
export const VERSION = '0.1.0';
export const OPENCLAW_VERSION = '2026.3.8';

/**
 * 快速验证函数
 */
export async function verify(): Promise<VerificationResult> {
  const result: VerificationResult = {
    version: VERSION,
    openclawVersion: OPENCLAW_VERSION,
    modules: {},
    timestamp: new Date().toISOString(),
  };

  // 验证各模块
  try {
    result.modules['plugin-sdk'] = 'loaded';
  } catch (e) {
    result.modules['plugin-sdk'] = `error: ${e}`;
  }

  try {
    result.modules['memory'] = 'loaded';
  } catch (e) {
    result.modules['memory'] = `error: ${e}`;
  }

  try {
    result.modules['agents'] = 'loaded';
  } catch (e) {
    result.modules['agents'] = `error: ${e}`;
  }

  return result;
}

export interface VerificationResult {
  version: string;
  openclawVersion: string;
  modules: Record<string, string>;
  timestamp: string;
}

// 默认导出
export default {
  verify,
  VERSION,
  OPENCLAW_VERSION,
};
