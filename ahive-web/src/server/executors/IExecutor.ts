/**
 * 统一执行器接口
 * 所有执行器 (OpenCode, MCP, A2A 等) 都实现此接口
 * 
 * 文档: MCP_A2A_INTEGRATION_DESIGN.md
 * 创建日期: 2026-03-05
 */

import type { 
  Task, 
  TaskResult, 
  ExecutionContext, 
  ExtendedAgentRuntimeType 
} from '@/shared';

/**
 * 统一执行器接口
 */
export interface IExecutor {
  /**
   * 执行任务
   * @param task 任务定义
   * @param context 执行上下文
   * @returns 执行结果
   */
  execute(task: Task, context?: ExecutionContext): Promise<TaskResult>;
  
  /**
   * 取消任务
   * @param taskId 任务 ID
   * @returns 是否成功取消
   */
  cancel(taskId: string): Promise<boolean>;
  
  /**
   * 获取执行器类型
   */
  getType(): ExtendedAgentRuntimeType;
  
  /**
   * 获取可用工具列表 (仅 MCP/A2A 执行器支持)
   */
  getAvailableTools?(): Promise<string[]>;
  
  /**
   * 健康检查
   */
  healthCheck?(): Promise<boolean>;
  
  /**
   * 清理资源 (关闭连接、进程等)
   */
  cleanup?(): Promise<void>;
}

/**
 * 执行器基础抽象类
 * 提供通用功能
 */
export abstract class BaseExecutor implements IExecutor {
  abstract execute(task: Task, context?: ExecutionContext): Promise<TaskResult>;
  abstract cancel(taskId: string): Promise<boolean>;
  abstract getType(): ExtendedAgentRuntimeType;
  
  /**
   * 计算执行时长
   */
  protected calculateDuration(startTime: number): number {
    return Date.now() - startTime;
  }
  
  /**
   * 创建成功的任务结果
   */
  protected createSuccessResult(
    output: string[], 
    metadata: TaskResult['metadata'],
    artifacts?: TaskResult['artifacts'],
    duration?: number
  ): TaskResult {
    return {
      success: true,
      output,
      artifacts,
      metadata,
      duration
    };
  }
  
  /**
   * 创建失败的任务结果
   */
  protected createErrorResult(
    error: string,
    output: string[],
    metadata: TaskResult['metadata'],
    duration?: number
  ): TaskResult {
    return {
      success: false,
      output,
      error,
      metadata,
      duration
    };
  }
}