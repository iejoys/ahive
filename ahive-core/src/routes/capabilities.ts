/**
 * 能力管理 API 路由
 * 
 * GET    /api/capabilities              # 获取所有能力
 * GET    /api/capabilities/mcp          # 获取 MCP 服务器列表
 * GET    /api/capabilities/mcp/:id      # 获取指定 MCP 服务器
 * DELETE /api/capabilities/mcp/:id      # 删除 MCP 服务器
 * GET    /api/capabilities/skills       # 获取所有技能
 * POST   /api/capabilities/skills       # 注册新技能
 * PUT    /api/capabilities/skills/:id   # 更新技能
 * DELETE /api/capabilities/skills/:id   # 删除技能
 * POST   /api/capabilities/skills/:id/enable  # 启用技能
 * POST   /api/capabilities/skills/:id/disable # 禁用技能
 * 
 * @created 2026-03-21
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { App } from '../core/app.js';
import { getCapabilityManager } from '../capabilities/index.js';
import { sendJson, sendError, parseUrlPath, parseBody } from './utils.js';
import { logger, notifyCapabilityUpdate } from '../utils/index.js';

/**
 * 能力管理路由
 */
export async function capabilitiesRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  app?: App
): Promise<boolean> {
  const method = req.method?.toUpperCase() || 'GET';
  const urlPath = parseUrlPath(req.url || '/');
  const pathParts = urlPath.split('/');

  const manager = getCapabilityManager();

  // ========== 总览 ==========

  // GET /api/capabilities - 获取所有能力
  if (urlPath === '/api/capabilities' && method === 'GET') {
    const stats = manager.getStats();
    const servers = manager.getMCPServers();
    const skills = manager.getSkills();

    sendJson(res, 200, {
      success: true,
      stats,
      mcp: {
        servers: servers.map(s => ({
          id: s.serverId,
          type: s.serverType,
          toolCount: s.tools.length,
          updatedAt: s.updatedAt,
        })),
      },
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        triggers: s.triggers,
        enabled: s.enabled,
        updatedAt: s.updatedAt,
      })),
    });
    return true;
  }

  // ========== MCP 服务器 ==========

  // GET /api/capabilities/mcp - 获取 MCP 服务器列表
  if (urlPath === '/api/capabilities/mcp' && method === 'GET') {
    const servers = manager.getMCPServers();
    sendJson(res, 200, {
      success: true,
      servers,
    });
    return true;
  }

  // POST /api/capabilities/mcp - 注册新 MCP 服务器
  if (urlPath === '/api/capabilities/mcp' && method === 'POST') {
    try {
      const payload = await parseBody(req);
      const agentId = payload.agentKey || payload.agentId || 'system';
      const agentIds = payload.agentIds || (agentId !== 'system' ? [agentId] : []);
      if (agentIds.length > 0) {
        payload.agentIds = agentIds;
      }
      manager.handleCapabilityUpdate(agentId, 'add', payload);

      logger.info(`[CapabilitiesRoute] 已注册 MCP 服务器: ${payload.name || payload.serverId}, agentIds: ${JSON.stringify(agentIds)}`);

      if (app) {
        notifyCapabilityUpdate(app, agentId, 'add', payload);
      }

      sendJson(res, 200, {
        success: true,
        message: 'MCP server registered and agents notified'
      });
    } catch (error) {
      logger.error('[CapabilitiesRoute] MCP 注册失败:', error);
      sendError(res, 500, `Failed to register MCP server: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }

  // GET /api/capabilities/mcp/:id - 获取指定 MCP 服务器
  const mcpDetailMatch = urlPath.match(/^\/api\/capabilities\/mcp\/([^/]+)$/);
  if (mcpDetailMatch && method === 'GET') {
    const serverId = mcpDetailMatch[1];
    const server = manager.getMCPServer(serverId);

    if (!server) {
      sendError(res, 404, `MCP Server ${serverId} not found`);
      return true;
    }

    sendJson(res, 200, { success: true, server });
    return true;
  }

  // DELETE /api/capabilities/mcp/:id - 删除 MCP 服务器
  if (mcpDetailMatch && method === 'DELETE') {
    const serverId = mcpDetailMatch[1];
    const removed = manager.removeMCPServer(serverId);

    if (!removed) {
      sendJson(res, 404, { success: false, error: `MCP 服务器不存在: ${serverId}` });
      return true;
    }

    logger.info(`[CapabilitiesRoute] 已删除 MCP 服务器: ${serverId}`);
    if (app) {
      notifyCapabilityUpdate(app, 'system', 'remove', { serverId });
    }

    sendJson(res, 200, { success: true, message: `MCP 服务器已删除: ${serverId}` });
    return true;
  }

  // ========== 技能管理 ==========

  // GET /api/capabilities/skills - 获取所有技能
  if (urlPath === '/api/capabilities/skills' && method === 'GET') {
    const skills = manager.getSkills();
    sendJson(res, 200, {
      success: true,
      skills,
    });
    return true;
  }

  // POST /api/capabilities/skills - 注册新技能
  if (urlPath === '/api/capabilities/skills' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { id, name, triggers } = body;

      if (!id || !name || !triggers || !Array.isArray(triggers)) {
        sendJson(res, 400, {
          success: false,
          error: '缺少必填字段: id, name, triggers',
        });
        return true;
      }

      const skill = manager.registerSkill(body);
      logger.info(`[CapabilitiesRoute] 已注册技能: ${skill.name}`);

      if (app) {
        notifyCapabilityUpdate(app, 'system', 'register', skill);
      }

      sendJson(res, 201, {
        success: true,
        message: `技能已注册: ${name}`,
        skill,
      });
    } catch (error) {
      logger.error(`[CapabilitiesRoutes] 注册技能失败: ${error}`);
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  // PUT /api/capabilities/skills/:id - 更新技能
  const skillUpdateMatch = urlPath.match(/^\/api\/capabilities\/skills\/([^/]+)$/);
  if (skillUpdateMatch && method === 'PUT') {
    try {
      const skillId = skillUpdateMatch[1];
      const body = await parseBody(req);

      const updated = manager.updateSkill(skillId, body);

      if (!updated) {
        sendJson(res, 404, { success: false, error: `技能不存在: ${skillId}` });
        return true;
      }

      logger.info(`[CapabilitiesRoute] 已更新技能: ${skillId}`);
      if (app) {
        notifyCapabilityUpdate(app, 'system', 'update_skill', updated);
      }

      sendJson(res, 200, { success: true, skill: updated });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  // DELETE /api/capabilities/skills/:id - 删除技能
  if (skillUpdateMatch && method === 'DELETE') {
    const skillId = skillUpdateMatch[1];
    const removed = manager.removeSkill(skillId);

    if (!removed) {
      sendJson(res, 404, { success: false, error: `技能不存在: ${skillId}` });
      return true;
    }

    logger.info(`[CapabilitiesRoute] 已删除技能: ${skillId}`);
    if (app) {
      notifyCapabilityUpdate(app, 'system', 'remove_skill', { skillId });
    }

    sendJson(res, 200, { success: true, message: `技能已删除: ${skillId}` });
    return true;
  }

  // POST /api/capabilities/skills/:id/enable - 启用技能
  const skillEnableMatch = urlPath.match(/^\/api\/capabilities\/skills\/([^/]+)\/enable$/);
  if (skillEnableMatch && method === 'POST') {
    const skillId = skillEnableMatch[1];
    const success = manager.getSkillManager().setSkillEnabled(skillId, true);

    if (!success) {
      sendJson(res, 404, { success: false, error: `技能不存在: ${skillId}` });
      return true;
    }

    logger.info(`[CapabilitiesRoute] 已启用技能: ${skillId}`);
    if (app) {
      const skill = manager.getSkill(skillId);
      notifyCapabilityUpdate(app, 'system', 'update_skill', skill);
    }

    sendJson(res, 200, { success: true, message: `技能已启用: ${skillId}` });
    return true;
  }

  // POST /api/capabilities/skills/:id/disable - 禁用技能
  const skillDisableMatch = urlPath.match(/^\/api\/capabilities\/skills\/([^/]+)\/disable$/);
  if (skillDisableMatch && method === 'POST') {
    const skillId = skillDisableMatch[1];
    const success = manager.getSkillManager().setSkillEnabled(skillId, false);

    if (!success) {
      sendJson(res, 404, { success: false, error: `技能不存在: ${skillId}` });
      return true;
    }

    logger.info(`[CapabilitiesRoute] 已禁用技能: ${skillId}`);
    if (app) {
      const skill = manager.getSkill(skillId);
      notifyCapabilityUpdate(app, 'system', 'update_skill', skill);
    }

    sendJson(res, 200, { success: true, message: `技能已禁用: ${skillId}` });
    return true;
  }

  return false;
}