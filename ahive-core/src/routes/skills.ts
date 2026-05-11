/**
 * Skills API 路由
 * 
 * GET  /api/skills          - 列出所有技能
 * POST /api/skills/install  - 安装技能
 * POST /api/skills/uninstall - 卸载技能
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { sendJson, sendError, parseBody } from './utils.js';
import { logger } from '../utils/index.js';
import { createSkillManager } from '../memory/skills/manager.js';
import type { SkillManager } from '../memory/skills/manager.js';
import path from 'path';

let skillManager: SkillManager | null = null;

function getSkillManager(): SkillManager {
  if (!skillManager) {
    const skillsDir = path.join(process.cwd(), 'skills');
    skillManager = createSkillManager(skillsDir);
  }
  return skillManager;
}

export async function skillsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || 'GET';

  // GET /api/skills - 列出所有技能
  if (url === '/api/skills' && method === 'GET') {
    try {
      const mgr = getSkillManager();
      await mgr.initialize();
      const list = mgr.list();
      sendJson(res, 200, { success: true, skills: list });
      return true;
    } catch (error) {
      logger.error(`[Skills API] 列出技能失败: ${error}`);
      sendError(res, 500, 'Failed to list skills');
      return true;
    }
  }

  // POST /api/skills/install - 安装技能
  if (url === '/api/skills/install' && method === 'POST') {
    try {
      const body = await parseBody(req) as { id?: string; content?: string };
      if (!body.id || !body.content) {
        sendError(res, 400, 'Missing id or content');
        return true;
      }
      const mgr = getSkillManager();
      await mgr.initialize();
      const skill = await mgr.install(body.id, body.content);
      if (skill) {
        sendJson(res, 200, { success: true, skill: { id: skill.id, name: skill.name, description: skill.description } });
      } else {
        sendError(res, 500, 'Failed to install skill');
      }
      return true;
    } catch (error) {
      logger.error(`[Skills API] 安装技能失败: ${error}`);
      sendError(res, 500, 'Failed to install skill');
      return true;
    }
  }

  // POST /api/skills/uninstall - 卸载技能
  if (url === '/api/skills/uninstall' && method === 'POST') {
    try {
      const body = await parseBody(req) as { id?: string };
      if (!body.id) {
        sendError(res, 400, 'Missing id');
        return true;
      }
      const mgr = getSkillManager();
      await mgr.initialize();
      const ok = mgr.uninstall(body.id);
      sendJson(res, 200, { success: ok });
      return true;
    } catch (error) {
      logger.error(`[Skills API] 卸载技能失败: ${error}`);
      sendError(res, 500, 'Failed to uninstall skill');
      return true;
    }
  }

  return false;
}
