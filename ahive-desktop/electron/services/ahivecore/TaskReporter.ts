/**
 * 任务上报器
 * 用于指挥官向工作流引擎上报任务状态
 * 
 * 使用方式：
 * 1. Agent完成任务后调用 reportTaskComplete
 * 2. Agent执行过程中调用 reportProgress 上报进度
 * 3. Agent遇到错误时调用 reportTaskFailed
 */

import type { WebSocketServer } from './WebSocketServer';

// ========== 类型定义 ==========

/**
 * 任务完成上报数据
 */
export interface TaskCompleteReport {
  /** 任务ID */
  taskId: string;
  
  /** 节点ID */
  nodeId: string;
  
  /** Agent ID */
  agentId: string;
  
  /** 执行状态 */
  status: 'success' | 'failed' | 'partial';
  
  /** 输出结果 */
  outputs: Record<string, any>;
  
  /** 任务摘要 */
  summary: string;
  
  /** 时间戳 */
  timestamp: string;
  
  /** 错误信息（失败时） */
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

/**
 * 进度上报数据
 */
export interface ProgressReport {
  /** 任务ID */
  taskId: string;
  
  /** 节点ID */
  nodeId: string;
  
  /** Agent ID */
  agentId: string;
  
  /** 进度百分比 0-100 */
  progress: number;
  
  /** 当前阶段描述 */
  phase: string;
  
  /** 时间戳 */
  timestamp: string;
}

/**
 * 任务失败上报数据
 */
export interface TaskFailedReport {
  /** 任务ID */
  taskId: string;
  
  /** 节点ID */
  nodeId: string;
  
  /** Agent ID */
  agentId: string;
  
  /** 错误代码 */
  errorCode: string;
  
  /** 错误消息 */
  errorMessage: string;
  
  /** 错误堆栈 */
  errorStack?: string;
  
  /** 时间戳 */
  timestamp: string;
}

// ========== TaskReporter 类 ==========

/**
 * 任务上报器
 * 通过 WebSocket 向工作流引擎上报任务状态
 */
export class TaskReporter {
  private wsServer: WebSocketServer;
  
  constructor(wsServer: WebSocketServer) {
    this.wsServer = wsServer;
  }
  
  /**
   * 上报任务完成
   * 
   * @param report 任务完成报告
   * 
   * @example
   * await reporter.reportTaskComplete({
   *   taskId: 'task-001',
   *   nodeId: 'node-001',
   *   agentId: 'agent-001',
   *   status: 'success',
   *   outputs: {
   *     files: ['src/core/Engine.ts'],
   *     linesOfCode: 1500
   *   },
   *   summary: '完成核心引擎开发'
   * });
   */
  async reportTaskComplete(report: TaskCompleteReport): Promise<void> {
    const message = {
      type: 'task_complete',
      payload: {
        ...report,
        timestamp: report.timestamp || new Date().toISOString(),
      },
    };
    
    this.wsServer.broadcastAll({
      type: 'event',
      payload: {
        type: 'workflow_task_complete',
        agentId: report.agentId,
        timestamp: Date.now(),
        data: message,
      },
    });
    
    console.log(`[TaskReporter] Task complete: ${report.taskId} (${report.status})`);
  }
  
  /**
   * 上报任务进度
   * 
   * @param report 进度报告
   * 
   * @example
   * await reporter.reportProgress({
   *   taskId: 'task-001',
   *   nodeId: 'node-001',
   *   agentId: 'agent-001',
   *   progress: 50,
   *   phase: '正在编写核心逻辑'
   * });
   */
  async reportProgress(report: ProgressReport): Promise<void> {
    const message = {
      type: 'task_progress',
      payload: {
        ...report,
        timestamp: report.timestamp || new Date().toISOString(),
      },
    };
    
    this.wsServer.broadcastAll({
      type: 'event',
      payload: {
        type: 'workflow_task_progress',
        agentId: report.agentId,
        timestamp: Date.now(),
        data: message,
      },
    });
  }
  
  /**
   * 上报任务失败
   * 
   * @param report 任务失败报告
   * 
   * @example
   * await reporter.reportTaskFailed({
   *   taskId: 'task-001',
   *   nodeId: 'node-001',
   *   agentId: 'agent-001',
   *   errorCode: 'DEPENDENCY_NOT_FOUND',
   *   errorMessage: '依赖模块未找到'
   * });
   */
  async reportTaskFailed(report: TaskFailedReport): Promise<void> {
    const message = {
      type: 'task_failed',
      payload: {
        taskId: report.taskId,
        nodeId: report.nodeId,
        agentId: report.agentId,
        error: {
          code: report.errorCode,
          message: report.errorMessage,
          stack: report.errorStack,
        },
        timestamp: report.timestamp || new Date().toISOString(),
      },
    };
    
    this.wsServer.broadcastAll({
      type: 'event',
      payload: {
        type: 'workflow_task_failed',
        agentId: report.agentId,
        timestamp: Date.now(),
        data: message,
      },
    });
    
    console.log(`[TaskReporter] Task failed: ${report.taskId} - ${report.errorMessage}`);
  }
  
  /**
   * 便捷方法：从 Error 对象创建失败报告
   */
  async reportError(
    taskId: string,
    nodeId: string,
    agentId: string,
    error: Error
  ): Promise<void> {
    await this.reportTaskFailed({
      taskId,
      nodeId,
      agentId,
      errorCode: 'TASK_ERROR',
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }
}

// ========== 默认任务上报提示词 ==========

/**
 * 默认任务上报提示词
 * 在项目启动时注入到 Agent 的系统提示词中
 */
export const DEFAULT_REPORT_PROMPT = `
## 任务完成上报规范

完成任务后，必须调用上报函数：

\`\`\`typescript
reportTaskComplete({
  status: 'success' | 'failed' | 'partial',
  outputs: { 
    // 输出结果，根据任务类型填写
    // 例如：
    files: ['生成的文件路径'],
    data: { /* 结构化数据 */ }
  },
  summary: '任务完成摘要，简述做了什么'
});
\`\`\`

### 上报时机

1. **阶段性成果完成时** - 上报 partial 状态
2. **任务最终完成时** - 上报 success 状态
3. **遇到阻塞无法继续时** - 上报 failed 状态

### 上报内容要求

- **outputs**: 必须包含任务产出的关键信息
- **summary**: 简洁明了，不超过200字
- **status**: 准确反映任务执行状态

### 进度上报

执行过程中可以上报进度：

\`\`\`typescript
reportProgress({
  progress: 50,  // 0-100
  phase: '正在编写核心逻辑'
});
\`\`\`

### 示例

\`\`\`typescript
// 成功完成
reportTaskComplete({
  status: 'success',
  outputs: {
    files: ['src/core/Engine.ts'],
    linesOfCode: 1500
  },
  summary: '完成核心引擎开发，包含实体管理和渲染循环'
});

// 部分完成
reportTaskComplete({
  status: 'partial',
  outputs: {
    completed: ['基础框架'],
    pending: ['性能优化']
  },
  summary: '完成基础框架搭建，性能优化待后续处理'
});

// 失败
reportTaskComplete({
  status: 'failed',
  outputs: {},
  summary: '依赖模块未找到，无法继续'
});
\`\`\`
`;

export default TaskReporter;
