/**
 * 工作流消息处理器
 * 复用已有的 WSClient 连接，处理工作流任务分配、查询和唤醒消息
 * 
 * 架构：
 * ┌──────────────────┐
 * │  Electron WS     │
 * │  Server (3005)   │
 * └────────▲─────────┘
 *          │ WebSocket (复用 WSClient 连接)
 * ┌────────┴─────────┐
 * │  WSClient        │ ← 已有，负责连接/心跳/重连
 * │  (monitoring)    │
 * └────────▲─────────┘
 *          │ on('message')
 * ┌────────┴─────────┐
 * │  WorkflowMsg     │ ← 本模块，负责工作流消息路由
 * │  Handler         │
 * └────────▲─────────┘
 *          │ processManager.call()
 * ┌────────┴─────────┐
 * │  AgentProcess    │
 * │  Manager         │
 * └──────────────────┘
 */

import { EventEmitter } from 'events';
import { AgentProcessManager, AgentProcessStatus } from '../process-manager/AgentProcessManager.js';
import { getWSClient, WSClient, WSMessage as WSClientMessage } from '../monitoring/ws-client.js';
import { logger } from '../utils/index.js';
import { getAHIVECore, AHIVECore } from '../core/ahivecore.js';

// ==================== 类型定义 ====================

interface WorkflowTaskAssign {
  taskId: string;
  nodeId: string;
  nodeName: string;
  taskBrief: string;
  agentId: string;
  workflowId: string;
  instanceId: string;
  inputs?: Record<string, unknown>;
  timeout?: number;
}

interface WorkflowTaskComplete {
  type: 'task_complete';
  taskId: string;
  nodeId: string;
  agentId: string;
  success: boolean;
  outputs?: Record<string, unknown>;
  error?: string;
  summary?: string;
  timestamp: number;
}

// 本地消息类型（用于内部处理，与 WSClientMessage 不同）
interface LocalWSMessage {
  type: string;
  payload?: any;
}

interface PendingTask {
  taskId: string;
  nodeId: string;
  agentId: string;
  timer: NodeJS.Timeout;
}

// ==================== 配置 ====================

const DEFAULT_TASK_TIMEOUT = 120000;

// ==================== 主类 ====================

export class WorkflowMessageHandler extends EventEmitter {
  private processManager: AgentProcessManager;
  private wsClient: WSClient;
  private pendingTasks: Map<string, PendingTask> = new Map();
  private isInitialized = false;

  constructor(processManager: AgentProcessManager) {
    super();
    this.processManager = processManager;
    this.wsClient = getWSClient();
  }

  /**
   * 初始化：注册 WSClient 消息监听
   * 必须在 WSClient 启动后调用
   */
  initialize(): void {
    if (this.isInitialized) {
      logger.warn('[WorkflowMessageHandler] 已初始化，跳过');
      return;
    }

    // 监听 WSClient 收到的所有消息
    this.wsClient.on('message', (message: WSClientMessage) => {
      this.handleMessage(message);
    });

    this.isInitialized = true;
    logger.info('[WorkflowMessageHandler] ✅ 已注册到 WSClient 消息通道');
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(message: WSClientMessage): void {
    // 🔍 DEBUG: 打印所有收到的消息
    logger.info(`[WorkflowMessageHandler] 📨 收到消息: type=${message.type}, payload.type=${message.payload?.type}`);
    
    if (message.type !== 'event' || !message.payload) {
      logger.debug(`[WorkflowMessageHandler] ⏭️ 跳过非事件消息: type=${message.type}`);
      return;
    }

    const eventType = message.payload.type;
    logger.info(`[WorkflowMessageHandler] 🔄 处理事件: ${eventType}`);

    switch (eventType) {
      case 'workflow_task_assign':
        logger.info(`[WorkflowMessageHandler] ✅ 匹配 workflow_task_assign，调用 handleTaskAssign`);
        this.handleTaskAssign(message.payload.data);
        break;

      case 'workflow_task_query':
        this.handleTaskQuery(message.payload.data);
        break;

      case 'workflow_agent_wakeup':
        this.handleAgentWakeup(message.payload.data);
        break;

      // 忽略非工作流消息（由其他模块处理）
      default:
        logger.debug(`[WorkflowMessageHandler] ⏭️ 忽略非工作流事件: ${eventType}`);
        break;
    }
  }

  /**
   * 处理任务分配
   * 通过 AHIVECore（指挥官）来处理任务，而不是直接调用 AgentProcessManager
   */
  private async handleTaskAssign(data: WorkflowTaskAssign): Promise<void> {
    const { taskId, nodeId, nodeName, taskBrief, agentId, workflowId, instanceId, inputs, timeout } = data;

    logger.info(`[WorkflowMessageHandler] 📥 收到任务分配: taskId=${taskId}, nodeId=${nodeId}, agentId=${agentId}`);
    logger.info(`[WorkflowMessageHandler] 任务摘要: ${taskBrief.slice(0, 100)}...`);

    // 判断是否为返工任务
    const isReworkTask = inputs?.reviewFeedback !== undefined;
    
    if (isReworkTask) {
      logger.info(`[WorkflowMessageHandler] 🔄 检测到返工任务,生成返工任务提示词`);
    }

    // 记录待处理任务
    const taskTimeout = timeout || DEFAULT_TASK_TIMEOUT;
    const timer = setTimeout(() => {
      this.pendingTasks.delete(taskId);
      logger.warn(`[WorkflowMessageHandler] 任务超时: ${taskId}`);
      this.reportTaskComplete({
        type: 'task_complete',
        taskId,
        nodeId,
        agentId,
        success: false,
        error: `Task timeout after ${taskTimeout}ms`,
        timestamp: Date.now(),
      });
    }, taskTimeout);

    this.pendingTasks.set(taskId, { taskId, nodeId, agentId, timer });

    const startTime = Date.now();

    try {
      // 🔄 通过 AHIVECore（指挥官）来处理任务
      logger.info(`[WorkflowMessageHandler] 🚀 转发任务给指挥官: ${taskId}`);
      
      // 构建发给指挥官的消息
      let commanderMessage: string;
      
      if (isReworkTask) {
        // 返工任务: 生成返工任务提示词
        commanderMessage = this.generateReworkTaskPrompt(
          taskId,
          nodeId,
          nodeName,
          agentId,
          inputs.reviewFeedback
        );
      } else {
        // 普通任务
        commanderMessage = `[WORKFLOW_TASK]
任务ID: ${taskId}
节点ID: ${nodeId}
节点名称: ${nodeName}
目标智能体: ${agentId}
工作流ID: ${workflowId}
实例ID: ${instanceId}
超时: ${taskTimeout}ms

任务摘要:
${taskBrief}

请处理此任务并返回结果。`;
      }

      // 获取 AHIVECore 实例
      const ahivecore = getAHIVECore();
      
      // 调用指挥官处理任务
      const result = await ahivecore.chat(commanderMessage);

      const duration = Date.now() - startTime;
      logger.info(`[WorkflowMessageHandler] ✅ 任务完成: ${taskId} (${duration}ms)`);

      clearTimeout(timer);
      this.pendingTasks.delete(taskId);

      this.reportTaskComplete({
        type: 'task_complete',
        taskId,
        nodeId,
        agentId,
        success: true,
        outputs: {
          output: result.content || '',
          duration,
          toolCallsExecuted: result.toolCallsExecuted,
        },
        summary: result.content.slice(0, 200),
        timestamp: Date.now(),
      });

    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error(`[WorkflowMessageHandler] ❌ 任务失败: ${taskId} (${duration}ms): ${error.message}`);

      clearTimeout(timer);
      this.pendingTasks.delete(taskId);

      this.reportTaskComplete({
        type: 'task_complete',
        taskId,
        nodeId,
        agentId,
        success: false,
        error: error.message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 生成返工任务提示词
   */
  private generateReworkTaskPrompt(
    taskId: string,
    nodeId: string,
    nodeName: string,
    agentId: string,
    reviewFeedback: any
  ): string {
    const {
      score,
      summary,
      issues,
      suggestions,
      reviewFile,
      retryCount,
      maxRetries,
    } = reviewFeedback;

    const issuesText = issues && issues.length > 0
      ? issues.map((issue: string, i: number) => `${i + 1}. ${issue}`).join('\n')
      : '无具体问题列表';

    const suggestionsText = suggestions && suggestions.length > 0
      ? suggestions.map((suggestion: string, i: number) => `${i + 1}. ${suggestion}`).join('\n')
      : '无具体建议列表';

    return `# 返工任务

## 任务背景
你之前的代码/文档未通过审核,需要根据审核意见进行修改。

## 任务信息
- 任务ID: ${taskId}
- 节点ID: ${nodeId}
- 节点名称: ${nodeName}
- 目标智能体: ${agentId}

## 审核结果
- 审核分数: ${score} / 100
- 审核总结: ${summary}
- 重试次数: ${retryCount} / ${maxRetries}

## 审核意见文件
审核Agent已将详细的审核意见保存到文件:
- 文件路径: ${reviewFile}

请使用 \`read_file\` 工具读取审核意见文件,了解详细的问题和改进建议。

## 主要问题预览
${issuesText}

## 改进建议预览
${suggestionsText}

## 执行要求

### 1. 读取审核意见
\`\`\`
read_file({ path: "${reviewFile}" })
\`\`\`

### 2. 分析审核意见
审核意见文件包含:
- \`score\`: 审核分数
- \`summary\`: 审核总结
- \`issues\`: 具体问题列表
- \`suggestions\`: 改进建议列表
- \`criteria_scores\`: 各项标准得分

### 3. 执行修改
根据审核建议逐一修改代码/文档:
- 优先处理严重问题
- 每个建议都要处理
- 保持代码风格一致
- 修改后验证

### 4. 汇报完成
修改完成后:
\`\`\`
workflow_report({
  report_type: "task_complete",
  task_id: "${taskId}",
  success: true,
  summary: "已根据审核意见完成修改"
})
\`\`\`

## 开始执行
请现在开始读取审核意见文件,并执行修改。`;
  }

  /**
   * 处理任务查询
   */
  private handleTaskQuery(data: any): void {
    const { taskId, nodeId, agentId, queryBrief } = data;
    logger.info(`[WorkflowMessageHandler] 收到任务查询: taskId=${taskId}`);

    const pending = this.pendingTasks.get(taskId);
    if (pending) {
      logger.info(`[WorkflowMessageHandler] 任务 ${taskId} 正在执行中`);
    } else {
      logger.info(`[WorkflowMessageHandler] 任务 ${taskId} 不在执行队列中`);
    }
  }

  /**
   * 处理智能体唤醒
   */
  private handleAgentWakeup(data: any): void {
    const { agentId, reason } = data;
    logger.info(`[WorkflowMessageHandler] 收到智能体唤醒: agentId=${agentId}, reason=${reason}`);

    const targetAgentId = this.resolveAgentId(agentId);
    if (targetAgentId) {
      const status = this.processManager.getAgentStatus(targetAgentId);
      if (!status || status.status !== 'running') {
        logger.info(`[WorkflowMessageHandler] 唤醒智能体: ${targetAgentId}`);
      }
    }
  }

  /**
   * 报告任务完成
   */
  private reportTaskComplete(report: WorkflowTaskComplete): void {
    const wsClient = getWSClient();
    if (!wsClient.isConnected()) {
      logger.error('[WorkflowMessageHandler] 无法发送完成报告: WSClient 未连接');
      return;
    }

    const message: WSClientMessage = {
      type: 'event' as const,
      payload: {
        type: 'task_complete',
        agentId: 'ahivecore',
        timestamp: Date.now(),
        data: report,
      },
    };

    try {
      wsClient.send(message);
      logger.info(`[WorkflowMessageHandler] 📤 已发送任务完成报告: taskId=${report.taskId}, success=${report.success}`);
    } catch (error: any) {
      logger.error(`[WorkflowMessageHandler] 发送完成报告失败: ${error.message}`);
    }
  }

  /**
   * 解析智能体 ID
   */
  private resolveAgentId(agentId: string): string | null {
    // 先尝试直接匹配
    const status = this.processManager.getAgentStatus(agentId);
    if (status) {
      return agentId;
    }

    // 尝试查找匹配类型的智能体
    const allStatus = this.processManager.getStatus();
    for (const [id, info] of allStatus) {
      if (info.status === AgentProcessStatus.Running && agentId.includes(info.type)) {
        return id;
      }
    }

    return null;
  }

  /**
   * 构建系统提示
   */
  private buildSystemPrompt(
    workflowId: string,
    nodeId: string,
    nodeName: string,
    inputs?: Record<string, unknown>
  ): string {
    return `你是一个工作流执行智能体。

当前工作流上下文：
- 工作流 ID: ${workflowId}
- 节点 ID: ${nodeId}
- 节点名称: ${nodeName}

请根据任务要求完成工作，并返回结构化的结果。

${inputs ? `输入参数：\n${JSON.stringify(inputs, null, 2)}` : ''}
`;
  }

  /**
   * 从执行结果中提取摘要
   */
  private extractSummary(result: any): string {
    if (typeof result.output === 'string') {
      return result.output.slice(0, 500);
    }
    if (typeof result.response === 'string') {
      return result.response.slice(0, 500);
    }
    if (result.summary) {
      return result.summary;
    }
    return 'Task completed';
  }

  /**
   * 获取正在执行的任务列表
   */
  getPendingTasks(): PendingTask[] {
    return Array.from(this.pendingTasks.values());
  }

  /**
   * 销毁
   */
  destroy(): void {
    // 清理所有待处理任务
    for (const [taskId, pending] of this.pendingTasks) {
      clearTimeout(pending.timer);
      logger.warn(`[WorkflowMessageHandler] 清理待处理任务: ${taskId}`);
    }
    this.pendingTasks.clear();
    this.removeAllListeners();
    this.isInitialized = false;
    logger.info('[WorkflowMessageHandler] 已销毁');
  }
}

// ==================== 全局实例 ====================

let globalHandler: WorkflowMessageHandler | null = null;

/**
 * 获取或创建工作流消息处理器
 */
export function getWorkflowMessageHandler(processManager: AgentProcessManager): WorkflowMessageHandler {
  if (!globalHandler) {
    globalHandler = new WorkflowMessageHandler(processManager);
  }
  return globalHandler;
}

/**
 * 初始化工作流消息处理器（在 WSClient 启动后调用）
 */
export function initWorkflowMessageHandler(processManager: AgentProcessManager): WorkflowMessageHandler {
  const handler = getWorkflowMessageHandler(processManager);
  handler.initialize();
  return handler;
}

/**
 * 销毁工作流消息处理器
 */
export function destroyWorkflowMessageHandler(): void {
  if (globalHandler) {
    globalHandler.destroy();
    globalHandler = null;
  }
}
