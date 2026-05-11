/**
 * AHIVE Core - 统一错误处理
 * 
 * 功能：
 * - 统一错误码定义
 * - 错误处理中间件
 * - 错误日志记录
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { logger } from './index.js';

// ============ 错误码定义 ============

export enum ErrorCode {
  // 通用错误 (1000-1999)
  UNKNOWN_ERROR = 1000,
  INVALID_REQUEST = 1001,
  INVALID_PARAMS = 1002,
  NOT_FOUND = 1003,
  UNAUTHORIZED = 1004,
  FORBIDDEN = 1005,
  
  // 智能体错误 (2000-2999)
  AGENT_NOT_FOUND = 2000,
  AGENT_ALREADY_EXISTS = 2001,
  AGENT_CREATION_FAILED = 2002,
  AGENT_EXECUTION_FAILED = 2003,
  AGENT_TIMEOUT = 2004,
  
  // 会话错误 (3000-3999)
  SESSION_NOT_FOUND = 3000,
  SESSION_EXPIRED = 3001,
  SESSION_CREATION_FAILED = 3002,
  
  // 模型错误 (4000-4999)
  MODEL_NOT_FOUND = 4000,
  MODEL_LOAD_FAILED = 4001,
  MODEL_INFERENCE_FAILED = 4002,
  PROVIDER_NOT_AVAILABLE = 4003,
  
  // 工具错误 (5000-5999)
  TOOL_NOT_FOUND = 5000,
  TOOL_EXECUTION_FAILED = 5001,
  TOOL_TIMEOUT = 5002,
  INVALID_TOOL_PARAMS = 5003,
  
  // 文件错误 (6000-6999)
  FILE_NOT_FOUND = 6000,
  FILE_READ_ERROR = 6001,
  FILE_WRITE_ERROR = 6002,
  FILE_DELETE_ERROR = 6003,
  FILE_TOO_LARGE = 6004,
  
  // 网络错误 (7000-7999)
  NETWORK_ERROR = 7000,
  REQUEST_TIMEOUT = 7001,
  CONNECTION_REFUSED = 7002,
  
  // 内存错误 (8000-8999)
  MEMORY_ERROR = 8000,
  MEMORY_OVERFLOW = 8001,
  CONTEXT_TOO_LONG = 8002,
}

// ============ 错误类 ============

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

// ============ 错误工厂 ============

export class ErrorFactory {
  static notFound(resource: string): AppError {
    return new AppError(
      ErrorCode.NOT_FOUND,
      `${resource} not found`,
      404
    );
  }

  static invalidParams(message: string, details?: any): AppError {
    return new AppError(
      ErrorCode.INVALID_PARAMS,
      message,
      400,
      details
    );
  }

  static unauthorized(message: string = 'Unauthorized'): AppError {
    return new AppError(
      ErrorCode.UNAUTHORIZED,
      message,
      401
    );
  }

  static forbidden(message: string = 'Forbidden'): AppError {
    return new AppError(
      ErrorCode.FORBIDDEN,
      message,
      403
    );
  }

  static agentNotFound(agentId: string): AppError {
    return new AppError(
      ErrorCode.AGENT_NOT_FOUND,
      `Agent ${agentId} not found`,
      404
    );
  }

  static sessionNotFound(sessionId: string): AppError {
    return new AppError(
      ErrorCode.SESSION_NOT_FOUND,
      `Session ${sessionId} not found`,
      404
    );
  }

  static modelNotFound(modelId: string): AppError {
    return new AppError(
      ErrorCode.MODEL_NOT_FOUND,
      `Model ${modelId} not found`,
      404
    );
  }

  static toolExecutionFailed(toolName: string, error: Error): AppError {
    return new AppError(
      ErrorCode.TOOL_EXECUTION_FAILED,
      `Tool ${toolName} execution failed: ${error.message}`,
      500,
      { toolName, error: error.message }
    );
  }

  static fileTooLarge(size: number, maxSize: number): AppError {
    return new AppError(
      ErrorCode.FILE_TOO_LARGE,
      `File size ${size} exceeds maximum ${maxSize}`,
      413,
      { size, maxSize }
    );
  }

  static contextTooLong(length: number, maxLength: number): AppError {
    return new AppError(
      ErrorCode.CONTEXT_TOO_LONG,
      `Context length ${length} exceeds maximum ${maxLength}`,
      400,
      { length, maxLength }
    );
  }
}

// ============ 错误处理中间件 ============

export async function handleError(
  error: Error | AppError,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // 记录错误日志
  logger.error('[ErrorHandler]', {
    url: req.url,
    method: req.method,
    error: error.message,
    stack: error.stack,
  });

  // 设置响应头
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 根据错误类型返回不同的响应
  if (error instanceof AppError) {
    res.writeHead(error.statusCode);
    res.end(JSON.stringify(error.toJSON()));
  } else {
    // 未知错误
    res.writeHead(500);
    res.end(JSON.stringify({
      error: 'Internal Server Error',
      code: ErrorCode.UNKNOWN_ERROR,
      message: error.message,
    }));
  }
}

// ============ 错误处理包装器 ============

export function withErrorHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await handler(req, res);
    } catch (error) {
      await handleError(error as Error, req, res);
    }
  };
}

// ============ 异步错误处理包装器 ============

export function asyncHandler(
  fn: (req: IncomingMessage, res: ServerResponse) => Promise<void>
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    Promise.resolve(fn(req, res)).catch((error) => {
      handleError(error, req, res);
    });
  };
}