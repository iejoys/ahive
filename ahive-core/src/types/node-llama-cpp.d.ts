/**
 * Type declarations for node-llama-cpp
 * 
 * Full types are available when the package is installed.
 * @see https://github.com/withcatai/node-llama-cpp
 */

declare module 'node-llama-cpp' {
  // ============ Llama 实例 ============
  
  export interface LlamaOptions {
    /** GPU 层数（0 = 纯 CPU，-1 = 全部 GPU） */
    gpuLayers?: number;
    /** 线程数 */
    threads?: number;
    /** 日志级别 */
    logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'none';
  }

  export interface GetLlamaOptions extends LlamaOptions {}

  /**
   * 获取 Llama 实例（推荐方式）
   */
  export function getLlama(options?: GetLlamaOptions): Promise<Llama>;

  /**
   * Llama 类（旧版 API，不推荐直接使用）
   * @deprecated 使用 getLlama() 代替
   */
  export class Llama {
    constructor(options?: LlamaOptions);
    loadModel(options: LoadModelOptions): Promise<LlamaModel>;
  }

  // ============ 模型加载 ============

  export interface LoadModelOptions {
    /** GGUF 模型文件路径 */
    modelPath: string;
    /** 是否使用模型文件中的 tokenizer */
    useFileLocks?: boolean;
  }

  export interface LlamaModel {
    /** 创建上下文 */
    createContext(options?: CreateContextOptions): Promise<LlamaContext>;
    /** 释放资源 */
    dispose(): Promise<void>;
    /** 获取模型信息 */
    getModelInfo(): ModelInfo;
  }

  export interface ModelInfo {
    name?: string;
    description?: string;
    contextLength: number;
    embeddingLength: number;
    chatTemplate?: string;
  }

  // ============ 上下文 ============

  export interface CreateContextOptions {
    /** 上下文长度 */
    contextSize?: number;
    /** 批处理大小 */
    batchSize?: number;
    /** 是否使用评估缓存 */
    evaluateCache?: boolean;
  }

  export interface LlamaContext {
    /** 获取上下文序列（用于 ChatSession） */
    getSequence(): LlamaContextSequence;
    /** 释放资源 */
    dispose(): Promise<void>;
    
    // 旧版 API（不推荐）
    /** @deprecated 使用 LlamaChatSession 代替 */
    generateCompletion(prompt: string, options?: GenerateCompletionOptions): Promise<string>;
  }

  export interface LlamaContextSequence {
    /** 上下文 */
    readonly context: LlamaContext;
  }

  // ============ 生成选项 ============

  export interface GenerateCompletionOptions {
    /** 最大生成 Token 数 */
    maxTokens?: number;
    /** 温度（0-2） */
    temperature?: number;
    /** Top-P 采样 */
    topP?: number;
    /** Top-K 采样 */
    topK?: number;
    /** Min-P 采样 */
    minP?: number;
    /** 重复惩罚 */
    repeatPenalty?: number;
    /** 停止词 */
    stopTokens?: string[];
    /** 种子 */
    seed?: number;
  }

  // ============ Chat Session ============

  export interface LlamaChatSessionOptions {
    /** 上下文序列 */
    contextSequence: LlamaContextSequence;
    /** 聊天包装器（自动检测，通常不需要指定） */
    chatWrapper?: LlamaChatWrapper | 'auto';
    /** 系统提示词 */
    systemPrompt?: string;
  }

  export interface LlamaChatPromptOptions extends GenerateCompletionOptions {
    /** 函数定义（用于 Function Calling） */
    functions?: Record<string, LlamaChatSessionFunction>;
    /** 最大函数调用迭代次数 */
    maxParallelFunctionCalls?: number;
  }

  /**
   * Chat Session - 推荐的对话方式
   * 
   * 自动处理：
   * - Qwen、Llama、ChatML 等各种 chat 格式
   * - 对话历史管理
   * - Function Calling
   */
  export class LlamaChatSession {
    constructor(options: LlamaChatSessionOptions);
    
    /**
     * 发送消息并获取回复
     * @param prompt 用户消息
     * @param options 生成选项
     */
    prompt(prompt: string, options?: LlamaChatPromptOptions): Promise<string>;
    
    /**
     * 发送消息（流式）
     */
    promptWithMeta(prompt: string, options?: LlamaChatPromptOptions): Promise<LlamaChatPromptResponse>;
    
    /** 获取聊天包装器 */
    readonly chatWrapper: LlamaChatWrapper;
    
    /** 重置对话历史 */
    reset(): void;
  }

  export interface LlamaChatPromptResponse {
    /** 回复文本 */
    response: string;
    /** 是否有函数调用 */
    functionCall?: LlamaChatSessionFunctionCallResult;
    /** 元数据 */
    metadata?: {
      tokensGenerated: number;
      stopReason: string;
    };
  }

  // ============ Function Calling ============

  export interface LlamaChatSessionFunctionParams {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  }

  export interface LlamaChatSessionFunctionDefinition {
    /** 函数描述 */
    description: string;
    /** 参数定义 */
    params: LlamaChatSessionFunctionParams;
    /** 处理函数 */
    handler: (params: Record<string, any>) => Promise<any> | any;
  }

  export type LlamaChatSessionFunction = LlamaChatSessionFunctionDefinition;

  export interface LlamaChatSessionFunctionCallResult {
    /** 函数名 */
    name: string;
    /** 参数 */
    params: Record<string, any>;
    /** 结果 */
    result: any;
  }

  // ============ Chat Wrapper ============

  export type LlamaChatWrapper = any; // 简化类型

  /**
   * 解析聊天包装器（自动从 GGUF 文件检测）
   */
  export function resolveChatWrapper(model: LlamaModel, options?: any): LlamaChatWrapper;

  // ============ 辅助函数 ============

  /**
   * 定义 Chat Session 函数
   */
  export function defineChatSessionFunction(definition: LlamaChatSessionFunctionDefinition): LlamaChatSessionFunction;
}