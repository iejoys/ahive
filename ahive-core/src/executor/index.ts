/**
 * 执行层入口
 * 
 * 导出所有执行器相关模块
 */

// 从 registry.ts 导出
export { ToolRegistry, getToolRegistry, BUILTIN_TOOLS } from './registry.js';

// AhiveCoderExecutor 从 agents/ahive-coder 导出（主要实现）
export { AhiveCoderExecutor, createAhiveCoderExecutor } from '../agents/ahive-coder/executor.js';

// 从 types.ts 导出
export type { ToolDefinition, SecurityPolicy } from './types.js';

// 从 tool-system.ts 导出（AHIVE-WORKER 风格工具系统）
export {
  // 类型
  type ToolParameters,
  type ToolUpdateCallback,
  type ToolCallRequest,
  type ToolResult,
  type AgentTool,
  type LLMMessage,
  
  // 函数
  extractToolCallsFromAssistant,
  extractToolCallsFromText,
  executeToolLoop,
  zodToJSONSchema,
  generateToolCallingPrompt,
  removeToolCallMarkers,
  getGlobalToolRegistry,
  initToolRegistry,
  
  // 类
  ToolLoopExecutor,
} from './tool-system.js';

// 从 builtin-tools.ts 导出
export { createBuiltinTools } from './builtin-tools.js';

// 从 tool-parser.ts 导出
export { extractToolCalls, executeToolCalls, assembleResponse } from './tool-parser.js';

// 从 process-manager.ts 导出
export { ProcessManager, getProcessManager } from './process-manager.js';

// 从 shell-executor.ts 导出
export { ShellExecutor, createShellExecutor } from './shell-executor.js';

// 从 fs-executor.ts 导出
export { FileSystemExecutor, createFileSystemExecutor } from './fs-executor.js';

// 从 file-reader-optimized.ts 导出（优化版文件读取）
export {
  OptimizedFileReader,
  getFileReader,
  readOptimizedFile,
  FILE_UNCHANGED_MARKER,
  TokenLimitExceededError,
  FileTooLargeError,
  type FileReadOptions,
  type FileReadResult,
  type FileEncoding,
} from './file-reader-optimized.js';

// 从 file-read-cache.ts 导出（文件读取缓存）
export {
  FileReadCacheManager,
  getFileReadCache,
} from './file-read-cache.js';

// 从 file-state-tracker.ts 导出（文件状态跟踪）
export {
  FileStateTracker,
  getFileStateTracker,
} from './file-state-tracker.js';

// 从 http-executor.ts 导出
export { HttpExecutor, createHttpExecutor } from './http-executor.js';

// 从 web-fetch.ts 导出
export { webFetchTool } from './web-fetch.js';

// 从 web-search.ts 导出
export { webSearchTool, searchDuckDuckGo } from './web-search.js';
export type { SearchResult, SearchResponse } from './web-search.js';

// 兼容旧代码：创建默认执行器实例
// 这个 executor 对象提供 deploy, start, stop, list, diagnose 方法
// 用于 main.ts 中的意图处理
export const executor = {
  /**
   * 部署智能体
   */
  async deploy(agentName: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: `智能体 ${agentName} 部署成功` };
  },

  /**
   * 启动智能体
   */
  async start(agentName: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: `智能体 ${agentName} 已启动` };
  },

  /**
   * 停止智能体
   */
  async stop(agentName: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: `智能体 ${agentName} 已停止` };
  },

  /**
   * 列出智能体
   */
  list(): { success: boolean; message: string; data?: { agents: string[] } } {
    return { 
      success: true, 
      message: '已列出所有智能体',
      data: { agents: ['ahive-worker', 'ahive-coder'] }
    };
  },

  /**
   * 诊断智能体
   */
  async diagnose(agentName: string, message?: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: `智能体 ${agentName} 诊断完成` };
  },
};