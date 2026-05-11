/**
 * 能力推送服务
 * 
 * 负责向 Agent 推送能力变更通知
 * 支持原生 MCP Server 和 MCPAPI 两种服务类型
 * 
 * 设计原则：
 * 1. 智能体不关心能力是原生 MCP 还是 MCPAPI
 * 2. 智能体只知道 AHIVE 网关地址和调用方式
 * 3. 推送完整的工具 schema，让智能体知道如何调用
 */

import log from 'electron-log';
import { EventEmitter } from 'events';
import { CapabilityManager, CapabilityBinding, CapabilityChangeEvent, capabilityManager } from './CapabilityManager';
import { getProtocolConfig, getMCPApiConfig, type MCPTool } from '../storage';

/**
 * 工具 Schema（推送给智能体）
 * 
 * 包含完整的工具描述，让智能体知道：
 * - 工具是做什么的
 * - 需要什么参数
 * - 何时应该调用
 */
export interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema?: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: any;
    }>;
    required?: string[];
  };
}

/**
 * 能力信息（推送给智能体）
 * 
 * 统一格式，不区分 mcp-server 和 mcp-api
 * 智能体只需要知道 serverId 和工具列表
 */
export interface CapabilityInfo {
  server: string;                              // 服务 ID（用于构建调用 URL）
  serverType?: 'mcp-server' | 'mcp-api';       // 服务类型（仅用于调试，智能体不需要关心）
  tools: MCPToolSchema[];                      // 完整的工具 schema 列表
}

/**
 * 推送消息
 */
interface PushMessage {
  type: 'capability_update';
  agentId: string;
  action: 'add' | 'remove' | 'update';
  payload: {
    apiEndpoint: string;
    agentKey?: string;
    capabilities?: CapabilityInfo[];
    removedCapabilities?: {
      server: string;
      serverType?: 'mcp-server' | 'mcp-api';
      tools: string[];
    };
    // 变更信息：告诉智能体本次新增和移除了哪些能力
    changes?: {
      added?: {
        server: string;
        serverType?: 'mcp-server' | 'mcp-api';
        tools: string[];
      }[];
      removed?: {
        server: string;
        serverType?: 'mcp-server' | 'mcp-api';
        tools: string[];
      }[];
    };
    reason?: string;
    timestamp: string;
    instruction?: {
      usage: string;
      url_pattern: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    };
  };
}

/**
 * Gateway 消息发送接口
 */
interface IGatewayMessenger {
  sendToAgent(agentId: string, message: any): Promise<boolean>;
  broadcast(message: any): Promise<void>;
  getAgentChannel(agentId: string): any;
}

/**
 * MCP Manager 接口（用于获取工具列表）
 */
interface IMCPManager {
  getServerList(): Array<{ id: string; name: string; status: string; toolCount: number }>;
  getServer(serverId: string): { getTools(): MCPTool[] } | null;
}

/**
 * 推送服务配置
 */
interface CapabilityPusherConfig {
  apiEndpoint?: string;
}

/**
 * 能力推送服务
 */
export class CapabilityPusher extends EventEmitter {
  private capabilityManager: CapabilityManager;
  private gatewayMessenger: IGatewayMessenger | null = null;
  private mcpManager: IMCPManager | null = null;
  private apiEndpoint: string;

  constructor(config: CapabilityPusherConfig = {}) {
    super();
    this.capabilityManager = capabilityManager;

    const protocolConfig = getProtocolConfig();
    const baseEndpoint = protocolConfig.mcpApiEndpoint || 'http://127.0.0.1:3002';
    this.apiEndpoint = config.apiEndpoint || (baseEndpoint.endsWith('/mcp') ? baseEndpoint : `${baseEndpoint}/mcp`);

    this.capabilityManager.on('capability-change', (event: CapabilityChangeEvent) => {
      this.handleCapabilityChange(event);
    });
  }

  /**
   * 设置 Gateway 消息发送器
   */
  setGatewayMessenger(messenger: IGatewayMessenger): void {
    this.gatewayMessenger = messenger;
  }

  /**
   * 设置 MCP Manager（用于获取工具 schema）
   */
  setMCPManager(manager: IMCPManager): void {
    this.mcpManager = manager;
  }

  /**
   * 设置 API 端点
   */
  setApiEndpoint(endpoint: string): void {
    this.apiEndpoint = endpoint;
  }

  /**
   * 获取能力管理器
   */
  getCapabilityManager(): CapabilityManager {
    return this.capabilityManager;
  }

  /**
   * 推送能力到指定 Agent
   */
  async pushToAgent(agentId: string): Promise<boolean> {
    const binding = this.capabilityManager.getBinding(agentId);
    if (!binding) {
      log.warn(`[CapabilityPusher] No binding found for ${agentId}`);
      return false;
    }

    return this.sendPushMessage(agentId, 'add', binding);
  }

  /**
   * 推送到所有已绑定的 Agent
   */
  async pushToAll(): Promise<void> {
    const bindings = this.capabilityManager.listBindings();

    for (const binding of bindings) {
      await this.pushToAgent(binding.agentId);
    }

    log.info(`[CapabilityPusher] Pushed to ${bindings.length} agents`);
  }

  /**
   * 处理能力变更事件
   */
  private async handleCapabilityChange(event: CapabilityChangeEvent): Promise<void> {
    log.info(`[CapabilityPusher] Capability change: ${event.type} for ${event.agentId}`);

    const action = event.type as 'add' | 'remove' | 'update';
    await this.sendPushMessage(event.agentId, action, event.binding, event.changes);
  }

  /**
   * 发送推送消息
   */
  private async sendPushMessage(
    agentId: string,
    action: 'add' | 'remove' | 'update',
    binding: CapabilityBinding,
    changes?: CapabilityChangeEvent['changes']
  ): Promise<boolean> {
    if (!this.gatewayMessenger) {
      log.warn('[CapabilityPusher] No gateway messenger set');
      return false;
    }

    const timestamp = new Date().toISOString();

    let payload: PushMessage['payload'];

    if (action === 'remove') {
      payload = {
        apiEndpoint: this.apiEndpoint,
        removedCapabilities: binding.capabilities.map(cap => ({
          server: cap.server,
          serverType: cap.serverType,
          tools: cap.tools
        })),
        reason: 'Agent unbound',
        timestamp,
      };
    } else {
      // 构建完整的能力信息（包含工具 schema）
      const capabilities = this.buildCapabilitiesWithToolSchemas(binding.capabilities);
      
      payload = {
        apiEndpoint: this.apiEndpoint,
        agentKey: binding.agentKey,
        capabilities,
        changes: changes ? {
          added: changes.added?.map(c => ({ server: c.server, serverType: c.serverType, tools: c.tools })),
          removed: changes.removed?.map(c => ({ server: c.server, serverType: c.serverType, tools: c.tools }))
        } : undefined,
        timestamp,
      };
    }

    // 获取智能体的逻辑 ID
    const channelInfo = this.gatewayMessenger.getAgentChannel(agentId);
    const logicalId = channelInfo ? channelInfo.logicalId : agentId;

    // 获取指令模板
    const protocolConfig = getProtocolConfig();
    const currentApiEndpoint = protocolConfig.mcpApiEndpoint || this.apiEndpoint;

    const template = protocolConfig.mcpInstructionTemplate || {
      usage: 'Call MCP tools via HTTP POST requests',
      url_pattern: '{apiEndpoint}/mcp/{serverId}/{toolName}',
      method: 'POST',
      headers: {
        'X-Agent-Key': '{agentKey}',
        'Content-Type': 'application/json'
      },
      body: 'JSON object containing tool parameters'
    };

    const instruction = {
      ...template,
      url_pattern: template.url_pattern.replace('{apiEndpoint}', currentApiEndpoint),
      headers: { ...template.headers }
    };

    if (payload.agentKey) {
      for (const headerKey in instruction.headers) {
        instruction.headers[headerKey] = instruction.headers[headerKey].replace('{agentKey}', payload.agentKey);
      }
    }

    const message: PushMessage = {
      type: 'capability_update',
      agentId: logicalId,
      action,
      payload: {
        ...payload,
        instruction
      },
    };

    try {
      const sent = await this.gatewayMessenger.sendToAgent(agentId, message);

      if (sent) {
        log.info(`[CapabilityPusher] Pushed ${action} to ${agentId}`);
        this.emit('pushed', { agentId, action, success: true });
      } else {
        log.warn(`[CapabilityPusher] Failed to push to ${agentId}`);
        this.emit('pushed', { agentId, action, success: false });
      }

      return sent;
    } catch (error) {
      log.error(`[CapabilityPusher] Error pushing to ${agentId}:`, error);
      this.emit('error', { agentId, error });
      return false;
    }
  }

  /**
   * 构建能力信息（包含完整的工具 schema）
   */
  private buildCapabilitiesWithToolSchemas(
    capabilities: { server: string; serverType?: 'mcp-server' | 'mcp-api'; tools: string[] }[]
  ): CapabilityInfo[] {
    return capabilities.map(cap => {
      const toolSchemas = this.getToolSchemas(cap.server, cap.serverType || 'mcp-server', cap.tools);
      
      return {
        server: cap.server,
        serverType: cap.serverType,
        tools: toolSchemas
      };
    });
  }

  /**
   * 获取工具 Schema 列表
   */
  private getToolSchemas(
    serverId: string,
    serverType: 'mcp-server' | 'mcp-api',
    toolNames: string[]
  ): MCPToolSchema[] {
    if (serverType === 'mcp-server') {
      return this.getNativeMCPToolSchemas(serverId, toolNames);
    } else {
      return this.getMCPApiToolSchemas(serverId, toolNames);
    }
  }

  /**
   * 获取原生 MCP Server 的工具 Schema
   */
  private getNativeMCPToolSchemas(serverId: string, toolNames: string[]): MCPToolSchema[] {
    if (!this.mcpManager) {
      log.warn('[CapabilityPusher] MCPManager not set, returning empty tool schemas');
      return toolNames.map(name => ({
        name,
        description: `Tool: ${name}`,
        inputSchema: { type: 'object', properties: {} }
      }));
    }

    const server = this.mcpManager.getServer(serverId);
    if (!server) {
      log.warn(`[CapabilityPusher] MCP server not found: ${serverId}`);
      return toolNames.map(name => ({
        name,
        description: `Tool: ${name}`,
        inputSchema: { type: 'object', properties: {} }
      }));
    }

    const allTools = server.getTools();
    const schemas: MCPToolSchema[] = [];

    for (const toolName of toolNames) {
      const tool = allTools.find(t => t.name === toolName);
      if (tool) {
        schemas.push({
          name: tool.name,
          description: tool.description || `Tool: ${tool.name}`,
          inputSchema: tool.inputSchema || { type: 'object', properties: {} }
        });
      } else {
        // 工具未找到，返回基本信息
        schemas.push({
          name: toolName,
          description: `Tool: ${toolName}`,
          inputSchema: { type: 'object', properties: {} }
        });
      }
    }

    log.info(`[CapabilityPusher] Got ${schemas.length} tool schemas for MCP server ${serverId}`);
    return schemas;
  }

  /**
   * 获取 MCPAPI 的工具 Schema
   * 
   * MCPAPI 的工具 schema 需要从配置或动态发现获取
   * 目前返回基本信息，后续可实现动态发现
   */
  private getMCPApiToolSchemas(configId: string, toolNames: string[]): MCPToolSchema[] {
    const config = getMCPApiConfig(configId);
    
    if (!config) {
      log.warn(`[CapabilityPusher] MCPAPI config not found: ${configId}`);
      return toolNames.map(name => ({
        name,
        description: `MCPAPI Tool: ${name}`,
        inputSchema: { type: 'object', properties: {} }
      }));
    }

    const schemas: MCPToolSchema[] = [];
    const mcpServers = config.mcpServers || [];

    for (const toolName of toolNames) {
      // 尝试从 mcpServers 中找到匹配的服务描述
      const server = mcpServers.find(s => s.label === toolName);
      
      if (server) {
        schemas.push({
          name: toolName,
          description: server.description || `MCPAPI Tool: ${toolName}`,
          // MCPAPI 的工具参数需要动态发现或预定义
          // 目前返回通用格式，后续可通过 MCP 协议动态获取
          inputSchema: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: 'Input for the tool'
              }
            }
          }
        });
      } else {
        schemas.push({
          name: toolName,
          description: `MCPAPI Tool: ${toolName}`,
          inputSchema: { type: 'object', properties: {} }
        });
      }
    }

    log.info(`[CapabilityPusher] Got ${schemas.length} tool schemas for MCPAPI ${configId}`);
    return schemas;
  }
}

// 单例导出
export const capabilityPusher = new CapabilityPusher();