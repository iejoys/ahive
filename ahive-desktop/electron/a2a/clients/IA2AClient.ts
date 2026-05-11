/**
 * A2A 客户端接口
 * 所有 A2A 协议客户端必须实现此接口
 */

import type { A2AAgentConfig, A2AAgentCard, A2ATaskStatus, A2AArtifact } from '../../storage';

/**
 * SSE 流式事件类型
 */
export type A2AStreamEventType = 
  | 'delta'           // 文本增量（流式输出）
  | 'status_update'   // 任务状态更新
  | 'artifact_update' // 产物更新
  | 'message'         // 完整消息
  | 'error'           // 错误
  | 'text_delta'      // 文本增量 (配置驱动模式)
  | 'text_done'       // 文本完成 (配置驱动模式)
  | 'complete'        // 消息完成 (配置驱动模式)
  | 'connected'       // 连接成功
  | 'heartbeat';      // 心跳

/**
 * SSE 流式事件
 */
export interface A2AStreamEvent {
  type: A2AStreamEventType;
  data?: A2AStreamEventData;
  text?: string;   // 配置驱动模式的文本增量
  error?: string;  // 错误信息
}

/**
 * SSE 流式事件数据
 */
export type A2AStreamEventData = 
  | TextDelta 
  | TaskStatusUpdate 
  | TaskArtifactUpdate 
  | AgentMessage
  | ErrorInfo;

/**
 * 文本增量（流式输出）
 */
export interface TextDelta {
  text: string;
  isFinal?: boolean;
  error?: string;  // 可选的错误信息
}

/**
 * 任务状态更新
 */
export interface TaskStatusUpdate {
  taskId: string;
  status: 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  message?: {
    role: 'agent';
    content: string;
  };
  progress?: number;
}

/**
 * 任务产物更新
 */
export interface TaskArtifactUpdate {
  taskId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
}

/**
 * Agent 消息
 */
export interface AgentMessage {
  role: 'agent';
  content: string;
  parts?: MessagePart[];
}

/**
 * 消息部分
 */
export interface MessagePart {
  type: 'text' | 'image' | 'file';
  text?: string;
  data?: string;
  mimeType?: string;
}

/**
 * 错误信息
 */
export interface ErrorInfo {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * 流式回调函数
 */
export type StreamCallback = (event: A2AStreamEvent) => void;

/**
 * A2A 客户端接口
 * 
 * 职责：
 * - 与特定类型的 A2A Agent 通信
 * - 处理协议特定的消息格式
 * - 支持同步、异步、流式三种通信模式
 */
export interface IA2AClient {
  /**
   * 协议类型标识
   */
  readonly protocolType: string;

  /**
   * 初始化客户端
   * @returns Agent Card 信息，失败返回 null
   */
  initialize(): Promise<A2AAgentCard | null>;

  /**
   * 获取 Agent Card
   */
  getAgentCard(): A2AAgentCard | null;

  /**
   * 发送任务（同步模式）
   * 阻塞等待直到任务完成
   */
  sendTaskSync(task: string, timeout?: number): Promise<A2ATaskStatus>;

  /**
   * 发送任务（异步模式）
   * 返回任务 ID，通过 webhook 或轮询获取结果
   */
  sendTaskAsync(task: string, webhookUrl?: string): Promise<string>;

  /**
   * 发送任务（流式模式）
   * 通过 SSE 实时返回任务进度和结果
   */
  sendTaskStream(
    task: string, 
    onEvent: StreamCallback,
    signal?: AbortSignal
  ): Promise<A2ATaskStatus>;

  /**
   * 取消任务
   */
  cancelTask(taskId: string): Promise<boolean>;

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): Promise<A2ATaskStatus | null>;

  /**
   * 健康检查
   */
  healthCheck(): Promise<boolean>;

  /**
   * 清理资源
   */
  cleanup(): Promise<void>;
}

/**
 * A2A 客户端工厂接口
 */
export interface IA2AClientFactory {
  /**
   * 创建客户端实例
   */
  createClient(config: A2AAgentConfig): IA2AClient;

  /**
   * 支持的协议类型
   */
  getSupportedProtocols(): string[];
}
