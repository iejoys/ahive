/**
 * 能力更新通知工具
 * 
 * 用于在 MCP 或技能更新后，通知所有运行中的智能体同步状态
 */

import { logger } from './index.js';
import type { App } from '../core/app.js';
import { registerMCPTools } from '../executor/tool-system.js';
import { getCapabilityManager } from '../capabilities/index.js';

/**
 * 通知所有智能体能力已更新
 * 
 * @param app App 实例
 * @param agentId 触发更新的智能体 ID（可选）
 * @param action 动作类型 (update/remove/register)
 * @param payload 消息负载
 */
export function notifyCapabilityUpdate(
  app: App,
  agentId: string = 'system',
  action: string = 'update',
  payload: any
): string[] {
  const notifiedAgents: string[] = [];

  if (!app?.processManager) {
    logger.warn('[CapabilityNotifier] ProcessManager 不可用，跳过通知');
    return notifiedAgents;
  }

  // 1. 同步主进程核心智能体的工具注册表 (AHIVECORE)
  try {
    const ahivecore = (app as any).ahivecore;
    if (ahivecore && typeof ahivecore.getExecutor === 'function') {
      const executor = ahivecore.getExecutor();
      if (executor) {
        const registry = executor.getToolRegistry();
        const capabilityManager = getCapabilityManager();
        const mcpManager = capabilityManager.getMCPManager();

        if (registry) {
          // 处理 MCP 注册/更新
          if (action === 'update' || action === 'refresh') {
            // 处理批量
            if (payload.capabilities && Array.isArray(payload.capabilities)) {
              for (const cap of payload.capabilities) {
                registerMCPTools(cap.server || cap.serverId, cap.tools, registry, mcpManager);
              }
            }
            // 处理单个 (来自 /api/capabilities/mcp 或 payload 就是服务器)
            else if (payload.tools && Array.isArray(payload.tools)) {
              registerMCPTools(payload.serverId || payload.name || 'unknown', payload.tools, registry, mcpManager);
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn('[CapabilityNotifier] 同步主进程核心智能体工具失败:', err);
  }

  try {
    // 获取所有运行中的智能体
    const agents = app.processManager.listAgents();
    // 过滤出活跃或运行中的智能体
    const runningAgents = agents.filter((a: any) =>
      a.status === 'running' || a.status === 'active' || a.status === 'starting'
    );

    if (runningAgents.length === 0) {
      logger.info('[CapabilityNotifier] 没有运行中的智能体需要通知');
      return notifiedAgents;
    }

    const type = action === 'register' ? 'skill_register' : 'capability_update';

    for (const agent of runningAgents) {
      try {
        // 向智能体发送 IPC 消息
        app.processManager.sendRaw(agent.id, {
          type,
          agentId,
          action,
          payload: payload.payload || payload, // 兼容嵌套结构
          skill: payload.skill || (type === 'skill_register' ? payload : undefined),
        });

        notifiedAgents.push(agent.id);
        logger.info(`[CapabilityNotifier] 已通知 Agent ${agent.id} (类型: ${type})`);
      } catch (err) {
        logger.warn(`[CapabilityNotifier] 通知 Agent ${agent.id} 失败:`, err);
      }
    }
  } catch (error) {
    logger.error('[CapabilityNotifier] 广播能力更新失败:', error);
  }

  return notifiedAgents;
}
