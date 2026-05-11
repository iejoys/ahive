/**
 * 智能体管理路由
 * 处理 /api/unified-agents 相关请求
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { AgentExecutor } from '../executor/interface.js';
import { parseBody, sendJson, sendError, getQueryParam, parseUrlPath } from './utils.js';

/**
  * 智能体路由处理器
  *
  * 注意：AgentExecutor 接口只提供 execute 和 executeStream 方法
  * 智能体管理功能需要通过 UnifiedAgentSystem 或 ProcessManager 直接访问
  */
export class AgentsRouteHandler {
  constructor(
    private executor: AgentExecutor,
    private agentSystem?: any,
    private processManager?: any
  ) { }

  /**
   * 处理 GET /api/unified-agents
   * 获取所有智能体列表
   */
  async handleList(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // 优先从 processManager 获取（隔离模式）
      if (this.processManager && typeof this.processManager.listAgents === 'function') {
        const agents = this.processManager.listAgents();
        sendJson(res, 200, {
          success: true,
          agents
        });
        return;
      }

      // 其次从 agentSystem 获取（普通模式）
      if (this.agentSystem && typeof this.agentSystem.listAgents === 'function') {
        const agents = await this.agentSystem.listAgents();
        sendJson(res, 200, {
          success: true,
          agents
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 200, {
        success: true,
        agents: [
          { id: 'default', type: 'ahive-coder', status: 'active' }
        ]
      });
    } catch (error) {
      console.error('[AgentsRoute] List agents error:', error);
      sendError(res, 500, 'Failed to list agents');
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取已有智能体列表（用于查重）
   */
  private async getExistingAgents(): Promise<any[]> {
    // 从 processManager 获取（隔离模式）
    if (this.processManager && typeof this.processManager.listAgents === 'function') {
      return this.processManager.listAgents() || [];
    }
    // 从 agentSystem 获取（普通模式）
    if (this.agentSystem && typeof this.agentSystem.listAgents === 'function') {
      return await this.agentSystem.listAgents() || [];
    }
    return [];
  }

  /**
   * 处理 POST /api/unified-agents
   * 创建新智能体
   */
  async handleCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await parseBody(req);

      const type = body.type || 'ahive-coder';
      // 兼容 name 和 nickname 两种字段名
      const nickname = body.nickname || body.name || '';
      const roleId = body.roleId;

      // 验证：roleId 仅适用于 AHIVE-WORKER 类型
      if (roleId && type !== 'ahive-worker') {
        sendError(res, 400, 'roleId 仅适用于 ahive-worker 类型智能体');
        return;
      }

      // 获取已有智能体列表进行查重
      const existingAgents = await this.getExistingAgents();

      // 如果提供了 agentId，检查是否重复
      if (body.agentId) {
        const idExists = existingAgents.some((a: any) => a.id === body.agentId);
        if (idExists) {
          sendError(res, 400, `智能体 ID "${body.agentId}" 已存在`);
          return;
        }
      }

      // 检查名称是否重复
      if (nickname) {
        const nameExists = existingAgents.some((a: any) =>
          a.nickname === nickname || a.name === nickname
        );
        if (nameExists) {
          sendError(res, 400, `智能体名称 "${nickname}" 已存在`);
          return;
        }
      }

      // 生成或使用提供的 agentId
      let agentId = body.agentId;
      if (!agentId) {
        // 生成唯一 ID，确保不重复
        let attempts = 0;
        do {
          agentId = this.generateId();
          attempts++;
        } while (existingAgents.some((a: any) => a.id === agentId) && attempts < 10);
      }

      // 如果有 processManager（隔离模式）
      if (this.processManager && typeof this.processManager.spawnAgent === 'function') {
        const config: any = body.config || body.model || {};
        if (roleId) {
          config.roleId = roleId;
        }
        if (nickname) {
          config.nickname = nickname;
        }

        // 处理 Ollama baseUrl 转换为 ollamaHost
        if (body.model?.provider === 'ollama' && body.model?.baseUrl) {
          if (!config.modelConfig) config.modelConfig = {};
          config.modelConfig = {
            ...config.modelConfig,
            provider: 'ollama',
            name: body.model.name,
            ollamaHost: body.model.baseUrl,
            temperature: body.model.temperature,
            maxTokens: body.model.maxTokens,
          };
        }

        await this.processManager.spawnAgent(agentId, type, config);

        // 同步到 agentSystem 以便持久化 (备份到 agents.json)
        if (this.agentSystem && typeof this.agentSystem.createAgent === 'function') {
          try {
            // 构建同步用的配置
            const syncConfig: any = {};
            if (body.model) {
              syncConfig.model = { ...body.model };
              // 确保映射一致
              if (syncConfig.model.provider === 'ollama' && syncConfig.model.baseUrl) {
                syncConfig.model.ollamaHost = syncConfig.model.baseUrl;
              }
            }
            if (roleId) syncConfig.roleId = roleId;
            if (body.config?.maxDepth) syncConfig.maxDepth = body.config.maxDepth;
            if (body.config?.maxSpawns) syncConfig.maxSpawns = body.config.maxSpawns;

            await this.agentSystem.createAgent({
              agentId,
              type,
              nickname: nickname || undefined,
              config: syncConfig
            });
          } catch (e) {
            console.warn(`[AgentsRoute] 隔离模式同步到持久化系统失败: ${e}`);
          }
        }

        sendJson(res, 201, {
          success: true,
          agent: {
            id: agentId,
            type,
            nickname,
            roleId: type === 'ahive-worker' ? roleId : undefined,
            status: 'created'
          },
          agentId: agentId
        });
        return;
      }

      // 如果有 agentSystem，使用它来创建智能体
      if (this.agentSystem && typeof this.agentSystem.createAgent === 'function') {
        // 构建配置对象
        const agentConfig: any = {};

        // 模型配置（从 body.model 或 body.config.model 获取）
        if (body.model) {
          agentConfig.model = { ...body.model };

          // 处理 Ollama baseUrl 转换为 ollamaHost (Normal Mode)
          if (agentConfig.model.provider === 'ollama' && agentConfig.model.baseUrl) {
            agentConfig.model.ollamaHost = agentConfig.model.baseUrl;
          }
        } else if (body.config?.model) {
          agentConfig.model = { ...body.config.model };

          // 处理 Ollama baseUrl 转换为 ollamaHost (Normal Mode)
          if (agentConfig.model.provider === 'ollama' && agentConfig.model.baseUrl) {
            agentConfig.model.ollamaHost = agentConfig.model.baseUrl;
          }
        }

        // roleId（仅适用于 ahive-worker）
        if (roleId) {
          agentConfig.roleId = roleId;
        }

        // 其他配置
        if (body.config?.maxDepth) {
          agentConfig.maxDepth = body.config.maxDepth;
        }
        if (body.config?.maxSpawns) {
          agentConfig.maxSpawns = body.config.maxSpawns;
        }

        const agent = await this.agentSystem.createAgent({
          agentId,
          type,
          nickname: nickname || undefined,  // 确保 undefined 而不是空字符串
          config: agentConfig
        });

        sendJson(res, 201, {
          success: true,
          agent,
          agentId: agent.id
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 201, {
        success: true,
        agent: {
          id: agentId,
          type,
          nickname,
          roleId: type === 'ahive-worker' ? roleId : undefined,
          status: 'created'
        },
        agentId: agentId
      });
    } catch (error) {
      console.error('[AgentsRoute] Create agent error:', error);
      sendError(res, 500, 'Failed to create agent');
    }
  }

  /**
     * 处理 GET /api/unified-agents/active
     * 获取当前活跃智能体
     */
  async handleGetActive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // 从 agentSystem 获取活跃智能体 ID（普通模式）
      if (this.agentSystem && typeof this.agentSystem.getActiveAgent === 'function') {
        const activeAgentId = this.agentSystem.getActiveAgent();

        if (activeAgentId) {
          const agentType = this.agentSystem.getAgentType?.(activeAgentId) || 'ahive-coder';
          const modelConfig = this.agentSystem.getModelConfig?.(activeAgentId);

          sendJson(res, 200, {
            active: true,
            agent_id: activeAgentId,
            type: agentType,
            model: modelConfig || { name: 'default' }
          });
          return;
        }
      }

      // 从 processManager 获取（隔离模式）- 查找第一个 active 状态的智能体
      if (this.processManager && typeof this.processManager.listAgents === 'function') {
        const agents = this.processManager.listAgents();
        const activeAgent = agents.find((a: any) => a.status === 'active');
        if (activeAgent) {
          sendJson(res, 200, {
            active: true,
            agent_id: activeAgent.id,
            type: activeAgent.type,
            model: activeAgent.model || { name: 'default' }
          });
          return;
        }
      }

      // 默认返回 CORE 智能体
      sendJson(res, 200, {
        active: true,
        agent_id: 'ahivecore',
        type: 'core',
        model: { name: 'default' }
      });
    } catch (error) {
      console.error('[AgentsRoute] Get active agent error:', error);
      sendError(res, 500, 'Failed to get active agent');
    }
  }

  /**
    * 处理 GET /api/unified-agents/:agentId
    * 获取单个智能体信息
    */
  async handleGet(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      // 如果有 agentSystem，使用它来获取智能体
      if (this.agentSystem && typeof this.agentSystem.getAgent === 'function') {
        const agent = await this.agentSystem.getAgent(agentId);

        if (!agent) {
          sendError(res, 404, 'Agent not found');
          return;
        }

        sendJson(res, 200, {
          success: true,
          agent
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 200, {
        success: true,
        agent: { id: agentId, type: 'ahive-coder', status: 'active' }
      });
    } catch (error) {
      console.error('[AgentsRoute] Get agent error:', error);
      sendError(res, 500, 'Failed to get agent');
    }
  }

  /**
   * 处理 PUT /api/unified-agents/:agentId
   * 更新智能体配置
   */
  async handleUpdate(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      const body = await parseBody(req);

      // 如果有 agentSystem，使用它来更新智能体
      if (this.agentSystem && typeof this.agentSystem.updateAgent === 'function') {
        // 提取 updateAgent 需要的字段
        const updateConfig: any = {};

        if (body.nickname !== undefined) {
          updateConfig.nickname = body.nickname;
        }

        if (body.model !== undefined) {
          updateConfig.model = { ...body.model };

          // 处理 Ollama baseUrl 转换为 ollamaHost
          if (updateConfig.model.provider === 'ollama' && updateConfig.model.baseUrl) {
            updateConfig.model.ollamaHost = updateConfig.model.baseUrl;
          }
        }

        if (body.role !== undefined) {
          updateConfig.role = body.role;
        }

        if (body.maxSpawns !== undefined) {
          updateConfig.maxSpawns = body.maxSpawns;
        }

        if (body.maxDepth !== undefined) {
          updateConfig.maxDepth = body.maxDepth;
        }

        if (body.spawnModel !== undefined) {
          updateConfig.spawnModel = body.spawnModel;
        }

        const updatedAgent = this.agentSystem.updateAgent(agentId, updateConfig);

        if (!updatedAgent) {
          sendError(res, 404, 'Agent not found');
          return;
        }

        sendJson(res, 200, {
          success: true,
          agent: updatedAgent
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 200, {
        success: true,
        agent: { id: agentId, ...body, status: 'updated' }
      });
    } catch (error) {
      console.error('[AgentsRoute] Update agent error:', error);
      sendError(res, 500, 'Failed to update agent');
    }
  }

  /**
   * 处理 DELETE /api/unified-agents/:agentId
   * 删除智能体
   */
  async handleDelete(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      // 如果有 processManager（隔离模式），停止进程
      if (this.processManager && typeof this.processManager.stopAgent === 'function') {
        try {
          await this.processManager.stopAgent(agentId);
        } catch (e) {
          console.warn(`[AgentsRoute] 停止智能体进程失败: ${e}`);
        }
      }

      // 如果有 agentSystem，使用它来删除智能体
      if (this.agentSystem && typeof this.agentSystem.deleteAgent === 'function') {
        await this.agentSystem.deleteAgent(agentId);
        sendJson(res, 200, {
          success: true,
          message: 'Agent deleted'
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 200, {
        success: true,
        message: 'Agent deleted (simulated)'
      });
    } catch (error) {
      console.error('[AgentsRoute] Delete agent error:', error);
      sendError(res, 500, 'Failed to delete agent');
    }
  }

  /**
   * 处理 POST /api/unified-agents/:agentId/activate
   * 激活智能体（仅更新 agentSystem 状态）
   */
  async handleActivate(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      let agentType = 'ahive-coder';
      let modelInfo = { name: 'default' };

      // 从 processManager 获取智能体信息（隔离模式）
      if (this.processManager && typeof this.processManager.getAgentStatus === 'function') {
        const agentInfo = this.processManager.getAgentStatus(agentId);
        if (agentInfo) {
          agentType = agentInfo.type || 'ahive-coder';
          modelInfo = agentInfo.config?.modelConfig || { name: 'default' };
        }
      }

      // 如果有 agentSystem，调用它的激活方法
      if (this.agentSystem && typeof this.agentSystem.activateAgent === 'function') {
        await this.agentSystem.activateAgent(agentId);
      }

      sendJson(res, 200, {
        success: true,
        agentId,
        type: agentType,
        model: modelInfo,
        status: 'active',
        message: 'Agent activated successfully'
      });
    } catch (error) {
      console.error('[AgentsRoute] Activate agent error:', error);
      sendError(res, 500, 'Failed to activate agent');
    }
  }

  /**
   * 处理 GET/POST /api/unified-agents/:agentId/model
   * 获取或设置智能体模型
   */
  async handleModel(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      const method = req.method || 'GET';

      if (method === 'GET') {
        // 获取智能体模型
        if (this.agentSystem && typeof this.agentSystem.getAgentModel === 'function') {
          const model = await this.agentSystem.getAgentModel(agentId);
          sendJson(res, 200, {
            success: true,
            agentId,
            model
          });
          return;
        }

        // 否则返回默认响应
        sendJson(res, 200, {
          success: true,
          agentId,
          model: {
            provider: 'local',
            modelId: 'default-model',
            modelName: 'Default Model'
          }
        });
      } else if (method === 'POST') {
        // 设置智能体模型
        const body = await parseBody(req);

        if (this.agentSystem && typeof this.agentSystem.setAgentModel === 'function') {
          const result = await this.agentSystem.setAgentModel(agentId, body);
          sendJson(res, 200, {
            success: true,
            agentId,
            model: body,
            result
          });
          return;
        }

        // 否则返回默认响应
        sendJson(res, 200, {
          success: true,
          agentId,
          model: body,
          message: 'Agent model updated successfully'
        });
      }
    } catch (error) {
      console.error('[AgentsRoute] Handle model error:', error);
      sendError(res, 500, 'Failed to handle agent model');
    }
  }

  /**
   * 处理 GET/POST /api/unified-agents/:agentId/prompt
   * 获取或设置智能体提示词
   */
  async handlePrompt(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      const method = req.method || 'GET';

      if (method === 'GET') {
        // 获取智能体提示词
        if (this.agentSystem && typeof this.agentSystem.getAgentPrompt === 'function') {
          const prompt = await this.agentSystem.getAgentPrompt(agentId);
          sendJson(res, 200, {
            success: true,
            agentId,
            prompt
          });
          return;
        }

        // 否则返回默认响应
        sendJson(res, 200, {
          success: true,
          agentId,
          prompt: {
            system: 'You are a helpful AI assistant.',
            temperature: 0.7,
            maxTokens: 4096
          }
        });
      } else if (method === 'POST') {
        // 设置智能体提示词
        const body = await parseBody(req);

        if (this.agentSystem && typeof this.agentSystem.setAgentPrompt === 'function') {
          const result = await this.agentSystem.setAgentPrompt(agentId, body);
          sendJson(res, 200, {
            success: true,
            agentId,
            prompt: body,
            result
          });
          return;
        }

        // 否则返回默认响应
        sendJson(res, 200, {
          success: true,
          agentId,
          prompt: body,
          message: 'Agent prompt updated successfully'
        });
      }
    } catch (error) {
      console.error('[AgentsRoute] Handle prompt error:', error);
      sendError(res, 500, 'Failed to handle agent prompt');
    }
  }

  /**
   * 处理 POST /api/unified-agents/:agentId/spawn-model
   * 生成模型
   */
  async handleSpawnModel(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      const body = await parseBody(req);

      // 如果有 agentSystem，使用它来生成模型
      if (this.agentSystem && typeof this.agentSystem.spawnModel === 'function') {
        const result = await this.agentSystem.spawnModel(agentId, body);
        sendJson(res, 200, {
          success: true,
          agentId,
          spawnResult: result
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 200, {
        success: true,
        agentId,
        spawnResult: {
          modelId: `spawned-${Date.now()}`,
          status: 'spawned',
          config: body
        },
        message: 'Model spawned successfully'
      });
    } catch (error) {
      console.error('[AgentsRoute] Spawn model error:', error);
      sendError(res, 500, 'Failed to spawn model');
    }
  }

  /**
   * 处理 GET /api/unified-agents/:agentId/status
   * 获取智能体状态
   */
  async handleStatus(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      // 如果有 agentSystem，使用它来获取状态
      if (this.agentSystem && typeof this.agentSystem.getAgentStatus === 'function') {
        const status = await this.agentSystem.getAgentStatus(agentId);
        sendJson(res, 200, {
          success: true,
          status
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 200, {
        success: true,
        status: { id: agentId, status: 'active', lastActivity: Date.now() }
      });
    } catch (error) {
      console.error('[AgentsRoute] Get status error:', error);
      sendError(res, 500, 'Failed to get agent status');
    }
  }

  /**
   * 处理 GET /api/unified-agents/:agentId/tools
   * 获取智能体工具列表
   */
  async handleTools(req: IncomingMessage, res: ServerResponse, agentId: string): Promise<void> {
    try {
      // 如果有 agentSystem，使用它来获取工具
      if (this.agentSystem && typeof this.agentSystem.getAgentTools === 'function') {
        const tools = await this.agentSystem.getAgentTools(agentId);
        sendJson(res, 200, {
          success: true,
          tools
        });
        return;
      }

      // 否则返回默认响应
      sendJson(res, 200, {
        success: true,
        tools: [
          { name: 'exec', description: 'Execute shell commands' },
          { name: 'read_file', description: 'Read file contents' },
          { name: 'write_file', description: 'Write file contents' }
        ]
      });
    } catch (error) {
      console.error('[AgentsRoute] Get tools error:', error);
      sendError(res, 500, 'Failed to get agent tools');
    }
  }

  /**
      * 主路由分发
      */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url || '';
    const method = req.method || 'GET';

    // 解析路径（去除查询字符串）
    const path = parseUrlPath(rawUrl);
    const pathParts = path.split('/').filter(Boolean);

    // /api/unified-agents
    if (pathParts.length === 2) {
      if (method === 'GET') {
        return this.handleList(req, res);
      } else if (method === 'POST') {
        return this.handleCreate(req, res);
      }
    }

    // /api/unified-agents/:agentId/...
    if (pathParts.length >= 3) {
      const agentId = pathParts[2];

      // 特殊处理: /api/unified-agents/active
      if (agentId === 'active' && pathParts.length === 3 && method === 'GET') {
        return this.handleGetActive(req, res);
      }

      if (pathParts.length === 3) {
        // /api/unified-agents/:agentId
        if (method === 'GET') {
          return this.handleGet(req, res, agentId);
        } else if (method === 'DELETE') {
          return this.handleDelete(req, res, agentId);
        }
      } else if (pathParts.length === 4) {
        const action = pathParts[3];

        if (action === 'activate' && method === 'POST') {
          return this.handleActivate(req, res, agentId);
        } else if (action === 'model' && (method === 'GET' || method === 'POST')) {
          return this.handleModel(req, res, agentId);
        } else if (action === 'prompt' && (method === 'GET' || method === 'POST')) {
          return this.handlePrompt(req, res, agentId);
        } else if (action === 'spawn-model' && method === 'POST') {
          return this.handleSpawnModel(req, res, agentId);
        } else if (action === 'status' && method === 'GET') {
          return this.handleStatus(req, res, agentId);
        } else if (action === 'tools' && method === 'GET') {
          return this.handleTools(req, res, agentId);
        }
      }
    }

    sendError(res, 404, 'Not found');
  }
}

/**
  * 智能体路由函数
  */
export async function agentsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  executor: AgentExecutor,
  app?: any,
  processManager?: any
): Promise<boolean> {
  const handler = new AgentsRouteHandler(executor, app?.unifiedAgentSystem, processManager);
  await handler.handle(req, res);
  return true;
}

/**
 * 创建智能体路由处理器
 */
export function createAgentsHandler(executor: AgentExecutor, agentSystem?: any): AgentsRouteHandler {
  return new AgentsRouteHandler(executor, agentSystem);
}

/**
 * 创建智能体路由（兼容旧接口）
 */
export function createAgentsRoutes(executor: AgentExecutor, agentSystem?: any): any {
  const handler = createAgentsHandler(executor, agentSystem);
  return handler;
}