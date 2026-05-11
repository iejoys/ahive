/**
 * 智能体统筹工具定义
 * 复用现有 AgentProcessManager
 */

import { z } from 'zod';
import type { AgentTool } from '../../executor/tool-system.js';
import { errorResult } from '../../executor/tool-system.js';
import { logger } from '../../utils/index.js';

/**
 * 智能体控制器接口
 * 由外部注入，提供多智能体管理能力
 */
let agentController: {
  spawnAgent(parentId: string, options: { 
    message?: string; 
    role?: string; 
    model?: Partial<{ name: string; provider: string }>;
    forkHistory?: boolean;
  }): Promise<string>;
  waitAgent(agentId: string, timeout?: number): Promise<{ status: string; content?: string; error?: string }>;
  terminateAgent(agentId: string): void;
  getMainAgentId(): string | null;
  getActiveAgent(): string | null;
  getAllStatus(): Promise<Map<string, { type: string; status: string; role?: string; nickname?: string; model?: string }>>;
  sendTo(fromId: string, toId: string, content: string, type?: string): void;
  sendAndWait(fromId: string, toId: string, content: string, type?: string, timeout?: number): Promise<{ success: boolean; content?: string; error?: string }>;
  getConcurrencyStatus(): { active: number; max: number; available: number };
  createMainAgent(type?: 'ahive-worker' | 'ahive-coder'): string;
} | null = null;

/**
 * 设置智能体控制器
 */
export function setAgentOrchestratorController(controller: typeof agentController): void {
  agentController = controller;
}

/**
 * 获取智能体控制器
 */
export function getAgentOrchestratorController(): typeof agentController {
  return agentController;
}

/**
 * 发送消息给智能体（不等待回复）
 */
const AgentSendParamsSchema = z.object({
  to: z.string().describe('目标智能体 ID'),
  message: z.string().describe('消息内容'),
  type: z.enum(['task', 'query', 'response', 'notification']).optional().default('task').describe('消息类型'),
});

export const agentSendTool: AgentTool<z.infer<typeof AgentSendParamsSchema>> = {
  name: 'agent_send',
  label: 'send message to agent (no wait)',
  description: `发送消息给智能体（不等待回复）。

参数：
- to: 目标智能体 ID
- message: 消息内容
- type: 消息类型 (task/query/response/notification)

适用场景：
- 发送通知类消息
- 不需要立即回复的任务
- 广播信息

示例：
- 发送通知: agent_send({ to: "agent-coder", message: "项目已更新", type: "notification" })`,
  parameters: AgentSendParamsSchema,
  
  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    try {
      const mainAgentId = agentController.getMainAgentId();
      if (!mainAgentId) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: 'No main agent exists' }],
        };
      }

      agentController.sendTo(mainAgentId, params.to, params.message, params.type);

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 消息已发送给 ${params.to}\n类型: ${params.type}\n内容: ${params.message.substring(0, 100)}...`,
        }],
      };
    } catch (error) {
      return errorResult('agent_send', error);
    }
  },
};

/**
 * 发送消息给智能体并等待回复
 */
const AgentSendAndWaitParamsSchema = z.object({
  to: z.string().describe('目标智能体 ID'),
  message: z.string().describe('消息内容'),
  timeout: z.number().optional().default(60000).describe('超时时间（毫秒）'),
});

export const agentSendAndWaitTool: AgentTool<z.infer<typeof AgentSendAndWaitParamsSchema>> = {
  name: 'agent_send_and_wait',
  label: 'send message and wait for reply',
  description: `发送消息给智能体并等待回复。

参数：
- to: 目标智能体 ID
- message: 消息内容
- timeout: 超时时间（毫秒），默认 60000

适用场景：
- 需要立即获取结果的任务
- 查询智能体状态
- 协作任务

示例：
- 查询状态: agent_send_and_wait({ to: "agent-coder", message: "当前进度如何？" })
- 分配任务: agent_send_and_wait({ to: "agent-reviewer", message: "审查这个文件: src/app.ts" })`,
  parameters: AgentSendAndWaitParamsSchema,
  
  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    try {
      const mainAgentId = agentController.getMainAgentId();
      if (!mainAgentId) {
        return {
          success: false,
          content: [{ type: 'text' as const, text: 'No main agent exists' }],
        };
      }

      const result = await agentController.sendAndWait(
        mainAgentId,
        params.to,
        params.message,
        'task',
        params.timeout
      );

      if (result.success && result.content) {
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `📨 收到 ${params.to} 的回复：\n\n${result.content}`,
          }],
          details: { targetId: params.to, reply: result.content },
        };
      } else if (!result.success && result.error?.includes('超时')) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `⏱️ 等待 ${params.to} 回复超时 (${params.timeout}ms)`,
          }],
        };
      } else {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 发送消息失败: ${result.error || '未知错误'}`,
          }],
        };
      }
    } catch (error) {
      return errorResult('agent_send_and_wait', error);
    }
  },
};

/**
 * 创建分身智能体
 */
const AgentSpawnParamsSchema = z.object({
  message: z.string().describe('初始任务消息'),
  role: z.string().optional().describe('角色（worker/analyzer/coder）'),
  model: z.string().optional().describe('模型名称'),
  fork_history: z.boolean().optional().default(false).describe('是否继承历史'),
});

export const agentSpawnTool: AgentTool<z.infer<typeof AgentSpawnParamsSchema>> = {
  name: 'agent_spawn',
  label: 'spawn child agent',
  description: `创建分身智能体。

参数：
- message: 初始任务消息
- role: 角色（可选：worker/analyzer/coder）
- model: 模型名称（可选）
- fork_history: 是否继承历史（默认 false）

适用场景：
- 并行处理多个任务
- 分解复杂任务
- 专项任务处理

注意：
- 最大 6 个分身
- 分身完成后自动终止

示例：
- 创建分析分身: agent_spawn({ message: "分析项目结构", role: "analyzer" })
- 创建编码分身: agent_spawn({ message: "实现登录功能", role: "coder" })`,
  parameters: AgentSpawnParamsSchema,
  
  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    const mainAgentId = agentController.getMainAgentId();
    if (!mainAgentId) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'No main agent exists' }],
      };
    }

    // 检查并发状态
    const concurrency = agentController.getConcurrencyStatus();
    if (concurrency.available <= 0) {
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `⚠️ 分身数量已达上限 (${concurrency.active}/${concurrency.max})\n请等待现有分身完成任务后再试。`,
        }],
      };
    }

    try {
      const childId = await agentController.spawnAgent(mainAgentId, {
        message: params.message,
        role: params.role,
        model: params.model ? { name: params.model } : undefined,
        forkHistory: params.fork_history,
      });

      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 分身已创建
ID: ${childId}
角色: ${params.role || 'worker'}
模型: ${params.model || '继承父级'}
继承历史: ${params.fork_history ? '是' : '否'}
任务: ${params.message.substring(0, 100)}...

并发状态: ${concurrency.active + 1}/${concurrency.max}

使用 agent_wait({ childId: "${childId}" }) 等待结果。`,
        }],
        details: {
          agentId: childId,
          role: params.role || 'worker',
          model: params.model,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{ type: 'text' as const, text: `❌ 创建分身失败: ${message}` }],
      };
    }
  },
};

/**
 * 等待分身完成
 */
const AgentWaitParamsSchema = z.object({
  childId: z.string().describe('分身智能体 ID'),
  timeout: z.number().optional().default(60000).describe('超时时间（毫秒）'),
});

export const agentWaitTool: AgentTool<z.infer<typeof AgentWaitParamsSchema>> = {
  name: 'agent_wait',
  label: 'wait for child agent',
  description: `等待分身智能体完成任务。

参数：
- childId: 分身智能体 ID
- timeout: 超时时间（毫秒），默认 60000

注意：
- 只在需要立即获取结果时调用
- 不要频繁等待，让分身在后台运行

示例：
- 等待分身: agent_wait({ childId: "agent-xxx" })`,
  parameters: AgentWaitParamsSchema,
  
  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    try {
      const result = await agentController.waitAgent(params.childId, params.timeout);

      if (result.status === 'completed' && result.content) {
        // 自动终止
        agentController.terminateAgent(params.childId);
        
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `✅ 分身已完成: ${params.childId}\n\n结果:\n${result.content}`,
          }],
          details: { childId: params.childId, status: result.status, content: result.content },
        };
      } else if (result.status === 'error') {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 分身执行失败: ${params.childId}\n错误: ${result.error || '未知'}`,
          }],
        };
      } else {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `⏱️ 等待超时: ${params.childId}\n状态: ${result.status}`,
          }],
        };
      }
    } catch (error) {
      return errorResult('agent_wait', error);
    }
  },
};

/**
 * 终止分身
 */
const AgentTerminateParamsSchema = z.object({
  childId: z.string().describe('分身智能体 ID'),
});

export const agentTerminateTool: AgentTool<z.infer<typeof AgentTerminateParamsSchema>> = {
  name: 'agent_terminate',
  label: 'terminate child agent',
  description: `终止分身智能体。

参数：
- childId: 分身智能体 ID

示例：
- 终止分身: agent_terminate({ childId: "agent-xxx" })`,
  parameters: AgentTerminateParamsSchema,
  
  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    try {
      agentController.terminateAgent(params.childId);
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 分身已终止: ${params.childId}`,
        }],
      };
    } catch (error) {
      return errorResult('agent_terminate', error);
    }
  },
};

/**
 * 获取智能体状态
 */
const AgentStatusParamsSchema = z.object({});

export const agentStatusTool: AgentTool<z.infer<typeof AgentStatusParamsSchema>> = {
  name: 'agent_status',
  label: 'get all agents status',
  description: `获取所有智能体状态。

返回：
- 每个智能体的 ID、昵称、状态、角色
- 并发状态（活跃数/最大数）

示例：
- 查看状态: agent_status()`,
  parameters: AgentStatusParamsSchema,
  
  async execute(toolCallId, params, signal) {
    if (!agentController) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: 'Agent controller not initialized' }],
      };
    }

    try {
      const allStatus = await agentController.getAllStatus();
      const concurrency = agentController.getConcurrencyStatus();
      
      const agents = Array.from(allStatus.entries()).map(([id, status]) => ({
        id,
        nickname: status.nickname || id.slice(0, 8),
        type: status.type,
        status: status.status,
        role: status.role || 'worker',
      }));
      
      const text = agents.map(a => {
        const statusIcon = a.status === 'idle' ? '🟢' : a.status === 'busy' ? '🟡' : '🔴';
        return `${statusIcon} ${a.nickname} (${a.type}) [${a.status}]\n   ID: ${a.id}\n   角色: ${a.role}`;
      }).join('\n\n');
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `📋 智能体状态 (${agents.length} 个):\n\n${text}\n\n📊 并发: ${concurrency.active}/${concurrency.max}`,
        }],
        details: { agents, concurrency },
      };
    } catch (error) {
      return errorResult('agent_status', error);
    }
  },
};

/**
 * 智能体统筹工具列表
 */
export const agentOrchestratorTools = [
  agentSendTool,
  agentSendAndWaitTool,
  agentSpawnTool,
  agentWaitTool,
  agentTerminateTool,
  agentStatusTool,
];