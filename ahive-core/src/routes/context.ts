/**
 * 上下文路由
 *
 * 提供 Agent 内存中上下文的查询接口
 * GET /api/context/:agentId - 获取指定 Agent 的上下文信息
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { App } from '../core/app.js';
import { sendJson, parseUrlPath } from './utils.js';
import { logger } from '../utils/index.js';
import { approxTokenCount } from '../memory/core/utils.js';

/**
 * 处理上下文路由
 */
export async function contextRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  app: App
): Promise<boolean> {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const path = parseUrlPath(url);

  // GET /api/context/:agentId
  if (path.startsWith('/api/context/') && method === 'GET') {
    const agentId = path.split('/api/context/')[1];
    if (!agentId) {
      sendJson(res, 400, { success: false, error: 'agentId is required' });
      return true;
    }
    return await handleGetContext(req, res, agentId, app);
  }

  return false;
}

/**
 * 获取 Agent 上下文信息 - 直接读取 UnifiedAgentSystem 内存中的 sessionMessages
 */
async function handleGetContext(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string,
  app: App
): Promise<boolean> {
  try {
    let rawContext = '';
    let tokenCount = 0;
    let contextSource = 'unknown';

    // 直接读取 UnifiedAgentSystem 内存中的完整上下文数据
    if (app.unifiedAgentSystem) {
      try {
        // 直接访问私有属性 agents Map
        const agents = (app.unifiedAgentSystem as any).agents;
        if (agents && agents instanceof Map) {
          const agent = agents.get(agentId);
          if (agent) {
            const contextParts: string[] = [];
            
            // 1. 读取 messages（系统上下文 + 工具调用 + 思考过程）
            if (agent.messages && Array.isArray(agent.messages) && agent.messages.length > 0) {
              const messagesText = agent.messages.map((m: any) =>
                `[${m.type} from:${m.fromAgentId} to:${m.toAgentId || 'broadcast'}]\n${m.content || ''}`
              ).join('\n\n');
              contextParts.push(`=== 系统上下文 (${agent.messages.length} 条) ===\n${messagesText}`);
            }
            
            // 2. 读取 sessionMessages（对话历史）
            if (agent.sessionMessages && Array.isArray(agent.sessionMessages) && agent.sessionMessages.length > 0) {
              const sessionText = agent.sessionMessages.map((m: any) =>
                `[${m.role}]\n${m.content || ''}`
              ).join('\n\n');
              contextParts.push(`=== 对话历史 (${agent.sessionMessages.length} 条) ===\n${sessionText}`);
            }
            
            // 3. 读取其他可能的数据
            if (agent.result) {
              contextParts.push(`=== 最终结果 ===\n${agent.result}`);
            }
            
      
            
            if (contextParts.length > 0) {
              rawContext = contextParts.join('\n\n');
              tokenCount = approxTokenCount(rawContext);
              contextSource = 'unifiedAgentSystem';
              logger.info(`[Context] 读取 UnifiedAgentSystem.agents.get("${agentId}"): messages=${agent.messages?.length || 0}, sessionMessages=${agent.sessionMessages?.length || 0}`);
              
              sendJson(res, 200, {
                success: true,
                context: {
                  raw: rawContext,
                  tokens: tokenCount,
                  source: contextSource,
                },
              });
              return true;
            }
          }
        }
        logger.info(`[Context] UnifiedAgentSystem 中没有找到 agentId="${agentId}" 或所有上下文为空`);
      } catch (e) {
        logger.warn(`[Context] 直接读取 UnifiedAgentSystem 内存失败: ${e}`);
      }
    }

    // 兜底：从 SessionMemory 获取
    if (app.sessionMemory) {
      const messages = app.sessionMemory.getHistory(agentId) || [];
      if (messages.length > 0) {
        rawContext = messages.map((m: any) =>
          `[${m.role}]\n${m.content || ''}`
        ).join('\n\n');
        tokenCount = approxTokenCount(rawContext);
        contextSource = 'sessionMemory';
        logger.info(`[Context] 从 SessionMemory 获取到 ${messages.length} 条消息 (agentId: ${agentId})`);
        
        sendJson(res, 200, {
          success: true,
          context: {
            raw: rawContext,
            tokens: tokenCount,
            source: contextSource,
          },
        });
        return true;
      }
    }

    // 如果没有任何上下文
    rawContext = '暂无上下文';
    contextSource = 'empty';
    tokenCount = 0;
    
    sendJson(res, 200, {
      success: true,
      context: {
        raw: rawContext,
        tokens: tokenCount,
        source: contextSource,
      },
    });

  } catch (error) {
    logger.error(`[Context] 获取上下文失败: ${error}`);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}
