import type { IncomingMessage, ServerResponse } from 'http';
import { sendJson, sendError, getQueryParam, parseUrlPath, parseBody } from './utils.js';
import { getMemoryManager } from '../memory/new-integration.js';
import type { AgentType } from '../memory/core/types.js';

function resolveAgentType(agentId: string): AgentType {
    if (agentId === 'ahivecore') return 'core';
    if (agentId.startsWith('ahive-worker')) return 'ahive-worker';
    return 'ahive-coder';
}

export async function memoryRoutes(
    req: IncomingMessage,
    res: ServerResponse,
    app: any,
): Promise<boolean> {
    const method = req.method || 'GET';
    const path = parseUrlPath(req.url || '');

    if (!path.startsWith('/api/memory')) {
        return false;
    }

    const mm = getMemoryManager();
    if (!mm) {
        sendJson(res, 200, { success: false, error: 'Memory system not initialized' });
        return true;
    }

    // GET /api/memory/threads?agentId=xxx
    if (path === '/api/memory/threads' && method === 'GET') {
        try {
            const agentId = getQueryParam(req.url || '', 'agentId') || '';
            if (!agentId) {
                sendError(res, 400, 'Missing agentId');
                return true;
            }
            const threads = mm.getThreadsByAgentId(agentId);
            sendJson(res, 200, { success: true, threads });
        } catch (error) {
            sendError(res, 500, 'Failed to get threads');
        }
        return true;
    }

    // GET /api/memory/rollout?agentId=xxx&threadId=yyy&limit=200
    if (path === '/api/memory/rollout' && method === 'GET') {
        try {
            const agentId = getQueryParam(req.url || '', 'agentId') || '';
            const threadId = getQueryParam(req.url || '', 'threadId') || undefined;
            const limit = parseInt(getQueryParam(req.url || '', 'limit') || '200', 10);
            if (!agentId) {
                sendError(res, 400, 'Missing agentId');
                return true;
            }
            const agentType = resolveAgentType(agentId);
            const items = await mm.getRecentRolloutItems(agentId, agentType, limit, threadId);
            sendJson(res, 200, { success: true, agentId, threadId: threadId || mm.getActiveThreadId(agentId, agentType), items, count: items.length });
        } catch (error) {
            sendError(res, 500, 'Failed to get rollout');
        }
        return true;
    }

    // GET /api/memory/context?agentId=xxx&maxTokens=8000
    if (path === '/api/memory/context' && method === 'GET') {
        try {
            const agentId = getQueryParam(req.url || '', 'agentId') || '';
            const maxTokens = parseInt(getQueryParam(req.url || '', 'maxTokens') || '8000', 10);
            if (!agentId) {
                sendError(res, 400, 'Missing agentId');
                return true;
            }
            const agentType = resolveAgentType(agentId);
            const context = await mm.getMemoryContext(agentId, agentType, maxTokens);
            sendJson(res, 200, { success: true, agentId, context, tokens: context.length });
        } catch (error) {
            sendError(res, 500, 'Failed to get memory context');
        }
        return true;
    }

    // POST /api/memory/new-session  body: { agentId }
    if (path === '/api/memory/new-session' && method === 'POST') {
        try {
            const body = await parseBody(req) as { agentId?: string };
            const agentId = body.agentId || '';
            if (!agentId) {
                sendError(res, 400, 'Missing agentId');
                return true;
            }
            let threadId: string | null = null;
            if (app.ahivecore && typeof app.ahivecore.startNewSession === 'function') {
                threadId = app.ahivecore.startNewSession();
            }
            if (!threadId) {
                const agentType = resolveAgentType(agentId);
                threadId = mm.startNewSession(agentId, agentType);
            }
            sendJson(res, 200, { success: true, agentId, threadId });
        } catch (error) {
            sendError(res, 500, 'Failed to create new session');
        }
        return true;
    }

    // POST /api/memory/set-active-thread  body: { agentId, threadId }
    if (path === '/api/memory/set-active-thread' && method === 'POST') {
        try {
            const body = await parseBody(req) as { agentId?: string; threadId?: string };
            if (!body.agentId || !body.threadId) {
                sendError(res, 400, 'Missing agentId or threadId');
                return true;
            }
            mm.setActiveThreadId(body.agentId, body.threadId);
            sendJson(res, 200, { success: true, agentId: body.agentId, threadId: body.threadId });
        } catch (error) {
            sendError(res, 500, 'Failed to set active thread');
        }
        return true;
    }

    return false;
}
