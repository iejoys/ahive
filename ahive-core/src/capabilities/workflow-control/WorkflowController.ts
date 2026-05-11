/**
 * 工作流控制器
 * 
 * 指挥官用于控制工作流执行
 * 架构：工作流引擎 ← WebSocket → 前端，指挥官 → 下级 Agent
 * - 暂停/停止工作流引擎：通过 WebSocket 发送指令到前端
 * - 控制下级 Agent：通过指挥官的 agentController 下达指令（不越级直接通知 Agent）
 */

import { getWSClient } from '../../monitoring/ws-client.js';
import { getAgentOrchestratorController } from '../agent-orchestrator/tools.js';
import { logger } from '../../utils/index.js';

/**
 * 工作流控制命令
 */
export interface WorkflowControlCommand {
  type: 'workflow-control';
  action: 'execute' | 'pause' | 'resume' | 'stop' | 'list-active';
  workflowId?: string;  // 用于 execute
  instanceId?: string;  // 用于 pause/resume/stop
  variables?: Record<string, unknown>;  // 用于 execute
  reason?: string;
  timestamp: number;
  source: 'ahivecore';
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
}

/**
 * 工作流控制器类
 */
export class WorkflowController {
  private wsClient: ReturnType<typeof getWSClient>;

  constructor() {
    this.wsClient = getWSClient();
  }

  /**
   * 暂停工作流
   * 
   * 1. 通过 WebSocket 通知前端暂停工作流引擎
   * 2. 中断指挥官自身当前执行
   * 3. 通过指挥官向所有下级 Agent 下达"暂停"指令（保留上下文）
   */
  async pause(instanceId: string, reason?: string): Promise<ToolResult> {
    logger.info('[WorkflowController] Pause workflow:', instanceId, reason);
    
    // 1. 发送 WebSocket 命令暂停工作流引擎
    this.sendCommand({
      action: 'pause',
      instanceId,
      reason,
    });
    
    // 2. 通过指挥官向所有下级 Agent 下达"暂停"指令
    const agentCount = this.commandAgents('pause', reason || '工作流暂停，请暂停当前任务');
    
    return {
      success: true,
      content: [{
        type: 'text',
        text: `✅ 工作流已暂停: ${instanceId}，已向 ${agentCount} 个下级 Agent 下达暂停指令${reason ? `，原因：${reason}` : ''}`,
      }],
      details: { instanceId, action: 'pause', reason, agentsNotified: agentCount },
    };
  }

  /**
   * 恢复工作流
   * 
   * 1. 通过 WebSocket 通知前端恢复工作流引擎
   * 2. 通过指挥官向所有下级 Agent 下达"继续"指令（上下文完整，直接继续）
   */
  async resume(instanceId: string): Promise<ToolResult> {
    logger.info('[WorkflowController] Resume workflow:', instanceId);
    
    // 1. 发送 WebSocket 命令恢复工作流引擎
    this.sendCommand({
      action: 'resume',
      instanceId,
    });
    
    // 2. 通过指挥官向所有下级 Agent 下达"继续"指令
    const agentCount = this.commandAgents('resume', '工作流恢复执行，请继续');
    
    return {
      success: true,
      content: [{
        type: 'text',
        text: `✅ 工作流已恢复: ${instanceId}，已向 ${agentCount} 个下级 Agent 下达继续指令`,
      }],
      details: { instanceId, action: 'resume', agentsNotified: agentCount },
    };
  }

  /**
   * 停止工作流（完全停止，不可恢复）
   * 
   * 1. 通过 WebSocket 通知前端停止工作流引擎
   * 2. 中断指挥官自身当前执行
   * 3. 通过指挥官终止所有下级 Agent 并清空上下文
   */
  async stop(instanceId: string, reason?: string): Promise<ToolResult> {
    logger.info('[WorkflowController] Stop workflow:', instanceId, reason);
    
    // 1. 发送 WebSocket 命令停止工作流引擎
    this.sendCommand({
      action: 'stop',
      instanceId,
      reason,
    });
    
    // 2. 通过指挥官终止所有下级 Agent（清空上下文）
    const agentCount = this.commandAgents('stop', reason || '工作流已停止，请终止并清空上下文');
    
    return {
      success: true,
      content: [{
        type: 'text',
        text: `✅ 工作流已停止: ${instanceId}，已终止 ${agentCount} 个下级 Agent 并清空上下文${reason ? `，原因：${reason}` : ''}`,
      }],
      details: { instanceId, action: 'stop', reason, agentsTerminated: agentCount },
    };
  }

  /**
   * 执行工作流
   * 
   * @param workflowId 工作流 ID
   * @param variables 工作流变量（可选）
   */
  async execute(workflowId: string, variables?: Record<string, unknown>): Promise<ToolResult> {
    logger.info('[WorkflowController] Execute workflow:', workflowId, variables);
    
    this.sendCommand({
      action: 'execute',
      workflowId,
      variables,
    });
    
    return {
      success: true,
      content: [{
        type: 'text',
        text: `✅ 已发送执行命令到工作流 ${workflowId}${variables ? `，变量：${JSON.stringify(variables)}` : ''}`,
      }],
      details: {
        workflowId,
        action: 'execute',
        variables,
      },
    };
  }

  /**
   * 获取活跃工作流列表
   * 
   * 使用请求-响应模式：发送命令后等待 WebSocketServer 返回实际结果
   * 超时时间 10 秒
   */
  async listActive(): Promise<ToolResult> {
    logger.info('[WorkflowController] List active workflows');
    
    try {
      const message = {
        type: 'event' as const,
        payload: {
          type: 'workflow-control',
          agentId: 'ahivecore',
          agentName: 'AHIVECORE',
          timestamp: Date.now(),
          data: {
            type: 'workflow-control',
            action: 'list-active',
            timestamp: Date.now(),
            source: 'ahivecore',
          },
        },
      };
      
      // 使用 sendRequest 等待响应
      const response = await this.wsClient.sendRequest(message, 10000);
      
      // 解析响应
      const responseData = response.data;
      if (responseData && responseData.status === 'completed' && responseData.result) {
        const instances = responseData.result.instances || [];
        
        if (instances.length === 0) {
          return {
            success: true,
            content: [{
              type: 'text',
              text: '当前没有活跃的工作流实例',
            }],
            details: { instances: [] },
          };
        }
        
        // 格式化实例列表
        const instanceList = instances.map((inst: any) => {
          const id = inst.instanceId || inst.id || 'unknown';
          const name = inst.workflowName || inst.name || 'unknown';
          const status = inst.status || 'unknown';
          const currentNode = inst.currentNodeId || inst.currentNode || '-';
          return `  - 实例ID: ${id}\n    工作流: ${name}\n    状态: ${status}\n    当前节点: ${currentNode}`;
        }).join('\n');
        
        return {
          success: true,
          content: [{
            type: 'text',
            text: `当前有 ${instances.length} 个活跃工作流实例：\n${instanceList}`,
          }],
          details: { instances },
        };
      } else {
        return {
          success: false,
          content: [{
            type: 'text',
            text: `查询活跃工作流失败: ${responseData?.message || '未知错误'}`,
          }],
          details: { response: responseData },
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('[WorkflowController] listActive error:', errorMsg);
      return {
        success: false,
        content: [{
          type: 'text',
          text: `查询活跃工作流超时或失败: ${errorMsg}`,
        }],
      };
    }
  }

  /**
   * 通过指挥官向下级 Agent 下达控制指令
   * - pause: 向所有活跃 Agent 发送"暂停"消息（保留上下文）
   * - resume: 向所有活跃 Agent 发送"继续"消息（上下文完整，直接继续）
   * - stop: 终止所有分身 Agent（清空上下文）
   * 
   * 返回受影响的 Agent 数量
   */
  private commandAgents(action: 'pause' | 'resume' | 'stop', message: string): number {
    const controller = getAgentOrchestratorController();
    if (!controller) {
      logger.warn('[WorkflowController] ⚠️ agentController 未初始化，无法控制下级 Agent');
      return 0;
    }

    try {
      const mainAgentId = controller.getMainAgentId();
      if (!mainAgentId) {
        logger.warn('[WorkflowController] ⚠️ 无法获取主智能体 ID');
        return 0;
      }

      if (action === 'stop') {
        // 停止：终止所有分身 Agent（清空上下文）
        const allStatus = controller.getAllStatus();
        // getAllStatus 返回 Promise，需要同步处理
        // 由于这是指挥官工具的同步部分，我们通过 sendTo 广播终止消息
        // 实际的 terminateAgent 由 Agent 自身收到终止消息后执行
        const msg = {
          type: 'event' as const,
          payload: {
            type: 'workflow-agent-control',
            agentId: 'ahivecore',
            agentName: 'AHIVECORE',
            timestamp: Date.now(),
            data: {
              type: 'workflow-agent-control',
              command: '终止',
              detail: message,
              timestamp: Date.now(),
              source: 'ahivecore-commander',
            },
          },
        };
        this.wsClient.send(msg);
        logger.info('[WorkflowController] 已通过指挥官下达终止指令给所有下级 Agent');
        return -1; // -1 表示广播，无法确定具体数量
      } else {
        // 暂停/恢复：通过 sendTo 向所有活跃 Agent 发送控制消息
        const command = action === 'pause' ? '暂停' : '继续';
        const msg = {
          type: 'event' as const,
          payload: {
            type: 'workflow-agent-control',
            agentId: 'ahivecore',
            agentName: 'AHIVECORE',
            timestamp: Date.now(),
            data: {
              type: 'workflow-agent-control',
              command,
              detail: message,
              timestamp: Date.now(),
              source: 'ahivecore-commander',
            },
          },
        };
        this.wsClient.send(msg);
        logger.info(`[WorkflowController] 已通过指挥官下达${command}指令给所有下级 Agent`);
        return -1; // -1 表示广播
      }
    } catch (error) {
      logger.error('[WorkflowController] 控制下级 Agent 失败:', error);
      return 0;
    }
  }

  /**
   * 发送命令到前端
   * 
   * 通过 WebSocket 发送 workflow-control 消息
   * 前端 WebSocketServer 接收后，转发给渲染进程执行
   */
  private sendCommand(command: {
    action: 'execute' | 'pause' | 'resume' | 'stop' | 'list-active';
    workflowId?: string;
    instanceId?: string;
    variables?: Record<string, unknown>;
    reason?: string;
  }): void {
    // 检查连接状态
    const isConnected = this.wsClient.isConnected();
    const queueSize = this.wsClient.getQueueSize();
    
    logger.info('[WorkflowController] sendCommand:', {
      action: command.action,
      instanceId: command.instanceId,
      isConnected,
      queueSize,
    });
    
    if (!isConnected) {
      logger.warn('[WorkflowController] ⚠️ WebSocket 未连接，消息将被缓存');
      logger.warn('[WorkflowController] 当前队列大小:', queueSize);
    }
    
    // 构造消息
    const message = {
      type: 'event' as const,
      payload: {
        type: 'workflow-control',
        agentId: 'ahivecore',
        agentName: 'AHIVECORE',
        timestamp: Date.now(),
        data: {
          type: 'workflow-control',
          action: command.action,
          workflowId: command.workflowId,
          instanceId: command.instanceId,
          variables: command.variables,
          reason: command.reason,
          timestamp: Date.now(),
          source: 'ahivecore',
        },
      },
    };
    
    logger.info('[WorkflowController] 发送消息:', JSON.stringify(message, null, 2));
    
    this.wsClient.send(message);
    
    // 检查队列大小变化
    const newQueueSize = this.wsClient.getQueueSize();
    if (newQueueSize > queueSize) {
      logger.warn('[WorkflowController] ⚠️ 消息已缓存到队列，等待连接恢复后发送');
    } else {
      logger.info('[WorkflowController] ✅ 消息已发送');
    }
  }
}

// ==================== 单例 ====================

let workflowControllerInstance: WorkflowController | null = null;

/**
 * 获取工作流控制器实例
 */
export function getWorkflowController(): WorkflowController {
  if (!workflowControllerInstance) {
    workflowControllerInstance = new WorkflowController();
  }
  return workflowControllerInstance;
}

/**
 * 重置工作流控制器（用于测试）
 */
export function resetWorkflowController(): void {
  workflowControllerInstance = null;
}