/**
 * MCP 工具 Prompt 注入服务
 * 
 * 将 Agent 已装备的 MCP 工具信息注入到任务 Prompt 中
 */

import type { Agent } from '../types';
import type { MCPTool } from '@ahive/shared';

// 判断是否在 Electron 环境
const isElectron = () => typeof window !== 'undefined' && window.electronAPI?.isDesktop;

// 工具信息缓存
const toolsCache: Map<string, { tools: MCPTool[]; timestamp: number }> = new Map();
const CACHE_TTL = 60000; // 1 分钟缓存

/**
 * 获取 MCP Server 的工具列表
 */
async function getMCPServerTools(serverId: string): Promise<MCPTool[]> {
  // 检查缓存
  const cached = toolsCache.get(serverId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.tools;
  }

  try {
    if (isElectron() && window.electronAPI?.getMCPServerTools) {
      const tools = await window.electronAPI.getMCPServerTools(serverId);
      toolsCache.set(serverId, { tools, timestamp: Date.now() });
      return tools;
    }
  } catch (error) {
    console.error(`[MCPToolPrompt] Failed to get tools for ${serverId}:`, error);
  }

  return [];
}

/**
 * 获取所有运行中 MCP Server 的工具
 */
async function getAllAvailableTools(): Promise<Map<string, MCPTool[]>> {
  const toolsByServer = new Map<string, MCPTool[]>();

  try {
    if (isElectron() && window.electronAPI?.getMCPServerList) {
      const servers = await window.electronAPI.getMCPServerList();
      
      for (const server of servers) {
        if (server.status === 'running') {
          const tools = await getMCPServerTools(server.id);
          if (tools.length > 0) {
            toolsByServer.set(server.name, tools);
          }
        }
      }
    }
  } catch (error) {
    console.error('[MCPToolPrompt] Failed to get available tools:', error);
  }

  return toolsByServer;
}

/**
 * 构建 MCP 工具 Prompt
 */
export async function buildMCPToolsPrompt(agent: Agent): Promise<string> {
  const equippedSkills = agent.equippedSkills;
  
  if (!equippedSkills || equippedSkills.length === 0) {
    return '';
  }

  // 获取所有可用工具
  const toolsByServer = await getAllAvailableTools();
  
  // 筛选出 Agent 已装备的工具
  const equippedTools: Array<{ tool: MCPTool; serverName: string }> = [];
  
  for (const [serverName, tools] of toolsByServer) {
    for (const tool of tools) {
      if (equippedSkills.includes(tool.name)) {
        equippedTools.push({ tool, serverName });
      }
    }
  }

  if (equippedTools.length === 0) {
    return '';
  }

  // 构建 Prompt
  const lines: string[] = [
    '## Available Tools',
    '',
    'You have access to the following external tools. To use them, include a tool call in your response:',
    '',
    '<CALL_TOOL: server="server_name", tool="tool_name", params={...}>',
    '',
    '### Tools List:',
    '',
  ];

  // 按 Server 分组
  const groupedByServer = new Map<string, MCPTool[]>();
  for (const { tool, serverName } of equippedTools) {
    if (!groupedByServer.has(serverName)) {
      groupedByServer.set(serverName, []);
    }
    groupedByServer.get(serverName)!.push(tool);
  }

  // 列出工具
  for (const [serverName, tools] of groupedByServer) {
    lines.push(`**${serverName}:**`);
    for (const tool of tools) {
      lines.push(`- \`${tool.name}\`: ${tool.description}`);
      
      // 简化的参数说明
      if (tool.inputSchema && typeof tool.inputSchema === 'object') {
        const schema = tool.inputSchema as { properties?: Record<string, unknown> };
        if (schema.properties) {
          const params = Object.keys(schema.properties);
          if (params.length > 0) {
            lines.push(`  Parameters: ${params.join(', ')}`);
          }
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 注入 MCP 工具信息到 Prompt
 */
export async function injectMCPToolsIntoPrompt(
  agent: Agent,
  originalPrompt: string
): Promise<string> {
  const toolsPrompt = await buildMCPToolsPrompt(agent);
  
  if (!toolsPrompt) {
    return originalPrompt;
  }

  // 将工具信息追加到原始 prompt 后面
  return `${originalPrompt}\n\n---\n\n${toolsPrompt}`;
}

/**
 * 估算工具 prompt 的 token 数量
 */
export function estimateToolTokens(skillCount: number): number {
  // 每个工具约 100-150 tokens
  const BASE_TOKENS_PER_TOOL = 125;
  const HEADER_TOKENS = 50;
  
  return HEADER_TOKENS + (skillCount * BASE_TOKENS_PER_TOOL);
}