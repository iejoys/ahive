/**
 * 角色管理路由
 * 
 * 角色配置仅适用于 OpenClaw 类型智能体
 * 
 * GET /api/roles - 列出所有角色
 * GET /api/roles/:id - 获取角色详情
 * POST /api/roles - 创建新角色
 * PUT /api/roles/:id - 更新角色
 * DELETE /api/roles/:id - 删除角色
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getRolePromptManager, type RoleConfig } from '../core/role-prompts.js';
import { sendJson, parseUrlPath, parseBody } from './utils.js';

export async function rolesRoutes(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const method = req.method?.toUpperCase() || 'GET';
  const urlPath = parseUrlPath(req.url || '/');
  
  const manager = getRolePromptManager();
  
  // GET /api/roles - 列出所有角色
  if (urlPath === '/api/roles' && method === 'GET') {
    const roles = manager.listRoles();
    sendJson(res, 200, {
      success: true,
      description: '角色配置仅适用于 OpenClaw 类型智能体',
      roles,
      defaultRole: manager.getDefaultRole(),
    });
    return true;
  }
  
  // GET /api/roles/:id - 获取角色详情
  const roleMatch = urlPath.match(/^\/api\/roles\/([^/]+)$/);
  if (roleMatch && method === 'GET') {
    const roleId = roleMatch[1];
    const role = manager.getRole(roleId);
    
    if (!role) {
      sendJson(res, 404, { success: false, error: `Role '${roleId}' not found` });
      return true;
    }
    
    sendJson(res, 200, {
      success: true,
      role: {
        id: roleId,
        ...role,
        fullPrompt: manager.getSystemPrompt(roleId),
      },
    });
    return true;
  }
  
  // POST /api/roles - 创建新角色
  if (urlPath === '/api/roles' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { id, name, name_zh, description, systemPrompt } = body;
      
      if (!id || !name || !systemPrompt) {
        sendJson(res, 400, {
          success: false,
          error: 'Missing required fields: id, name, systemPrompt',
        });
        return true;
      }
      
      const roleConfig: RoleConfig = {
        name,
        name_zh: name_zh || name,
        description: description || '',
        systemPrompt,
      };
      
      manager.setRole(id, roleConfig);
      
      sendJson(res, 201, {
        success: true,
        message: `Role '${id}' created (仅适用于 OpenClaw 类型智能体)`,
        role: { id, ...roleConfig },
      });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
  
  // PUT /api/roles/:id - 更新角色
  const updateMatch = urlPath.match(/^\/api\/roles\/([^/]+)$/);
  if (updateMatch && method === 'PUT') {
    try {
      const roleId = updateMatch[1];
      const body = await parseBody(req);
      
      const existing = manager.getRole(roleId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: `Role '${roleId}' not found` });
        return true;
      }
      
      const roleConfig: RoleConfig = {
        name: body.name || existing.name,
        name_zh: body.name_zh || existing.name_zh,
        description: body.description ?? existing.description,
        systemPrompt: body.systemPrompt || existing.systemPrompt,
      };
      
      manager.setRole(roleId, roleConfig);
      
      sendJson(res, 200, {
        success: true,
        message: `Role '${roleId}' updated`,
        role: { id: roleId, ...roleConfig },
      });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
  
  // DELETE /api/roles/:id - 删除角色
  const deleteMatch = urlPath.match(/^\/api\/roles\/([^/]+)$/);
  if (deleteMatch && method === 'DELETE') {
    const roleId = deleteMatch[1];
    const removed = manager.removeRole(roleId);
    
    if (!removed) {
      sendJson(res, 404, { success: false, error: `Role '${roleId}' not found` });
      return true;
    }
    
    sendJson(res, 200, {
      success: true,
      message: `Role '${roleId}' deleted`,
    });
    return true;
  }
  
  return false;
}