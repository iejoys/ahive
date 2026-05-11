/**
 * Auth Middleware - 认证中间件
 * 
 * 功能：
 * - 验证 Agent Token
 * - 提取 Agent ID
 * - 拒绝未授权请求
 */

import { logger } from '../utils/index.js';
import { generateId } from '../utils/index.js';
import crypto from 'crypto';
import { configStore } from '../storage/config-store.js';

// ============ 接口定义 ============

/**
 * Agent 信息
 */
export interface AgentInfo {
  id: string;
  name: string;
  tokenHash: string;
  enabled: boolean;
  createdAt: string;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  agents: Record<string, AgentInfo>;
}

// ============ Agent 注册表（使用配置存储） ============

export class AgentRegistry {
  /**
   * 获取智能体
   */
  get(agentId: string): AgentInfo | undefined {
    const agent = configStore.getAgent(agentId);
    if (!agent) return undefined;

    return {
      id: agent.id,
      name: agent.name,
      tokenHash: agent.tokenHash,
      enabled: agent.enabled,
      createdAt: agent.createdAt,
    };
  }

  /**
   * 列出所有智能体
   */
  list(): AgentInfo[] {
    return configStore.getAllAgents().map(agent => ({
      id: agent.id,
      name: agent.name,
      tokenHash: agent.tokenHash,
      enabled: agent.enabled,
      createdAt: agent.createdAt,
    }));
  }

  /**
   * 验证 Token
   */
  validateToken(agentId: string, token: string): boolean {
    return configStore.validateToken(agentId, token);
  }

  /**
   * 创建智能体
   */
  create(agentId: string, name?: string): { agent: AgentInfo; token: string } {
    const agent = configStore.createAgent(agentId, name);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        tokenHash: agent.tokenHash,
        enabled: agent.enabled,
        createdAt: agent.createdAt,
      },
      token: agent.rawToken!,
    };
  }

  /**
   * 重置 Token
   */
  resetToken(agentId: string): string | undefined {
    return configStore.resetToken(agentId);
  }

  /**
   * 删除智能体
   */
  delete(agentId: string): boolean {
    return configStore.deleteAgent(agentId);
  }
}

// 全局注册表实例
export const agentRegistry = new AgentRegistry();

// ============ 认证中间件 ============

/**
 * HTTP 请求接口（简化）
 */
interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}

/**
 * HTTP 响应接口（简化）
 */
interface HttpResponse {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (data?: string) => void;
}

/**
 * 认证中间件工厂
 */
export function createAuthMiddleware() {
  return async function authMiddleware(
    req: HttpRequest,
    res: HttpResponse,
    next: () => void
  ): Promise<void> {
    const authHeader = req.headers['authorization'];
    const agentIdHeader = req.headers['x-agent-id'];

    // 检查 Authorization 头
    if (!authHeader) {
      logger.warn('⚠️ [Auth] 缺少 Authorization 头');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Missing authorization header',
        code: 'MISSING_AUTH',
      }));
      return;
    }

    // 解析 Bearer Token
    const authHeaderStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!authHeaderStr || !authHeaderStr.startsWith('Bearer ')) {
      logger.warn('⚠️ [Auth] Authorization 格式错误');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid authorization format. Use: Bearer <token>',
        code: 'INVALID_FORMAT',
      }));
      return;
    }

    const token = authHeaderStr.substring(7);

    // 检查 X-Agent-ID 头
    if (!agentIdHeader) {
      logger.warn('⚠️ [Auth] 缺少 X-Agent-ID 头');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Missing X-Agent-ID header',
        code: 'MISSING_AGENT_ID',
      }));
      return;
    }

    const agentId = Array.isArray(agentIdHeader) 
      ? agentIdHeader[0] 
      : agentIdHeader;

    // 验证 Token
    const valid = agentRegistry.validateToken(agentId, token);
    if (!valid) {
      logger.warn(`⚠️ [Auth] Token 验证失败：${agentId}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid agent token',
        code: 'INVALID_TOKEN',
      }));
      return;
    }

    // 认证成功，添加 agentId 到请求对象
    logger.info(`✅ [Auth] 认证成功：${agentId}`);
    (req as any).agentId = agentId;
    next();
  };
}

// ============ 辅助函数 ============

/**
 * 获取所有已注册智能体
 */
export function getRegisteredAgents(): AgentInfo[] {
  return agentRegistry.list();
}

/**
 * 创建新智能体并返回 Token
 */
export function createAgentWithToken(agentId: string, name?: string): { agent: AgentInfo; token: string } {
  return agentRegistry.create(agentId, name);
}

/**
 * 重置智能体 Token
 */
export function resetAgentToken(agentId: string): string | undefined {
  return agentRegistry.resetToken(agentId);
}

/**
 * 删除智能体
 */
export function deleteAgent(agentId: string): boolean {
  return agentRegistry.delete(agentId);
}

/**
 * 验证 Token
 */
export function validateAgentToken(agentId: string, token: string): boolean {
  return agentRegistry.validateToken(agentId, token);
}
