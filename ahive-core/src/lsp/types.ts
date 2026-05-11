/**
 * LSP 类型定义
 *
 * Language Server Protocol 相关类型
 */

/**
 * LSP 操作类型
 */
export type LSPOperation =
  | 'definition'       // 跳转到定义
  | 'references'       // 查找引用
  | 'hover'            // 悬停信息
  | 'documentSymbol'   // 文档符号
  | 'workspaceSymbol'  // 工作区符号
  | 'implementation'   // 跳转到实现
  | 'typeDefinition';  // 类型定义

/**
 * LSP 请求参数
 */
export interface LSPRequest {
  operation: LSPOperation;
  filePath: string;
  line: number;      // 1-based
  character: number; // 1-based
}

/**
 * LSP 响应结果
 */
export interface LSPResult {
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
}

/**
 * LSP 服务器配置
 */
export interface LSPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;  // 环境变量
  extensions: string[];  // 支持的文件扩展名
  enabled?: boolean;
}

/**
 * LSP 位置
 */
export interface LSPPosition {
  line: number;      // 0-based
  character: number; // 0-based
}

/**
 * LSP 范围
 */
export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

/**
 * LSP 位置链接（定义跳转结果）
 */
export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

/**
 * LSP 位置链接（支持多目标）
 */
export interface LSPLocationLink {
  targetUri: string;
  targetRange: LSPRange;
  targetSelectionRange: LSPRange;
}

/**
 * LSP 悬停信息
 */
export interface LSPHover {
  contents: string | { kind: string; value: string } | Array<string | { language: string; value: string }>;
  range?: LSPRange;
}

/**
 * LSP 符号信息
 */
export interface LSPSymbolInformation {
  name: string;
  kind: number;  // SymbolKind
  location: LSPLocation;
  containerName?: string;
}

/**
 * LSP 文档符号
 */
export interface LSPDocumentSymbol {
  name: string;
  kind: number;
  range: LSPRange;
  selectionRange: LSPRange;
  children?: LSPDocumentSymbol[];
}

/**
 * IPC 消息：LSP 请求
 */
export interface LSPRequestMessage {
  type: 'lsp_request';
  id: string;
  operation: LSPOperation;
  filePath: string;
  line: number;
  character: number;
}

/**
 * IPC 消息：LSP 响应
 */
export interface LSPResponseMessage {
  type: 'lsp_response';
  id: string;
  success: boolean;
  data?: any;
  error?: string;
  durationMs?: number;
}

/**
 * IPC 消息：LSP 状态查询
 */
export interface LSPStatusMessage {
  type: 'lsp_status';
  id: string;
}

/**
 * IPC 消息：LSP 状态响应
 */
export interface LSPStatusResponse {
  type: 'lsp_status_response';
  id: string;
  status: Array<{ name: string; status: string }>;
}

/**
 * IPC 消息：启用 LSP 服务器
 */
export interface LSPEnableMessage {
  type: 'lsp_enable';
  id: string;
  serverName: string;
}

/**
 * IPC 消息：禁用 LSP 服务器
 */
export interface LSPDisableMessage {
  type: 'lsp_disable';
  id: string;
  serverName: string;
}

/**
 * 所有 LSP IPC 消息类型
 */
export type LSPIPCMessage =
  | LSPRequestMessage
  | LSPResponseMessage
  | LSPStatusMessage
  | LSPStatusResponse
  | LSPEnableMessage
  | LSPDisableMessage;