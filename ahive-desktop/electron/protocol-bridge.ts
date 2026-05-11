/**
 * Electron 客户端 MCP/A2A 桥接
 * 
 * 文档: MCP_A2A_INTEGRATION_DESIGN.md
 * 创建日期: 2026-03-05
 */

import { ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';
import { randomUUID } from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';

// 类型定义
interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface A2AAgentConfig {
  id: string;
  name: string;
  endpoint: string;
  agentId: string;
  webhookUrl?: string;
  enabled: boolean;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP/A2A 桥接管理器
 * 在 Electron 主进程中管理 MCP Server 进程和 A2A Agent 连接
 */
export class ProtocolBridge {
  private mcpProcesses: Map<string, ChildProcess> = new Map();
  private mcpTools: Map<string, MCPTool[]> = new Map();
  private a2aConnections: Map<string, { endpoint: string }> = new Map();

  constructor() {
    this.registerIPC();
  }

  /**
   * 注册 IPC 处理器
   */
  private registerIPC(): void {
    // ===== MCP 相关 =====
    
    // 启动 MCP Server
    ipcMain.handle('mcp:start', async (_, config: MCPServerConfig) => {
      return this.startMCPServer(config);
    });

    // 停止 MCP Server
    ipcMain.handle('mcp:stop', async (_, serverId: string) => {
      return this.stopMCPServer(serverId);
    });

    // 获取 MCP Server 工具列表
    ipcMain.handle('mcp:get-tools', async (_, serverId: string) => {
      return this.mcpTools.get(serverId) || [];
    });

    // 调用 MCP 工具
    ipcMain.handle('mcp:call-tool', async (_, serverId: string, toolName: string, params: unknown) => {
      return this.callMCPTool(serverId, toolName, params);
    });

    // 获取所有 MCP Server 状态
    ipcMain.handle('mcp:get-status', async () => {
      return this.getAllMCPStatus();
    });

    // ===== A2A 相关 =====
    
    // 添加 A2A Agent
    ipcMain.handle('a2a:add', async (_, config: A2AAgentConfig) => {
      return this.addA2AAgent(config);
    });

    // 移除 A2A Agent
    ipcMain.handle('a2a:remove', async (_, agentId: string) => {
      return this.removeA2AAgent(agentId);
    });

    // 发送 A2A 任务
    ipcMain.handle('a2a:send-task', async (_, agentId: string, task: string, asyncMode: boolean) => {
      return this.sendA2ATask(agentId, task, asyncMode);
    });

    // 获取 A2A Agent 状态
    ipcMain.handle('a2a:get-status', async () => {
      return this.getAllA2AStatus();
    });

    log.info('[ProtocolBridge] IPC handlers registered');
  }

  // ===== MCP 方法 =====

  /**
   * 启动 MCP Server
   */
  async startMCPServer(config: MCPServerConfig): Promise<{ success: boolean; error?: string; tools?: MCPTool[] }> {
    try {
      if (this.mcpProcesses.has(config.id)) {
        return { success: true, tools: this.mcpTools.get(config.id) };
      }

      log.info(`[ProtocolBridge] Starting MCP server: ${config.name}`);
      
      const proc = spawn(config.command, config.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...config.env }
      });

      this.mcpProcesses.set(config.id, proc);

      // 处理进程事件
      proc.stderr?.on('data', (data) => {
        log.warn(`[MCP ${config.name}] stderr: ${data}`);
      });

      proc.on('error', (error) => {
        log.error(`[MCP ${config.name}] Error:`, error);
        this.mcpProcesses.delete(config.id);
      });

      proc.on('exit', (code) => {
        log.info(`[MCP ${config.name}] Exited with code ${code}`);
        this.mcpProcesses.delete(config.id);
        this.mcpTools.delete(config.id);
      });

      // 等待初始化并获取工具列表
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const tools = await this.listMCPTools(config.id);
      this.mcpTools.set(config.id, tools);

      return { success: true, tools };
    } catch (error) {
      log.error(`[ProtocolBridge] Failed to start MCP server ${config.name}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 停止 MCP Server
   */
  async stopMCPServer(serverId: string): Promise<{ success: boolean }> {
    const proc = this.mcpProcesses.get(serverId);
    
    if (proc && !proc.killed) {
      proc.stdin?.end();
      await new Promise<void>(resolve => {
        proc.on('exit', () => resolve());
        setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 3000);
      });
    }
    
    this.mcpProcesses.delete(serverId);
    this.mcpTools.delete(serverId);
    
    return { success: true };
  }

  /**
   * 获取 MCP Server 工具列表
   */
  private async listMCPTools(serverId: string): Promise<MCPTool[]> {
    // 简化实现：返回空数组，实际应通过 JSON-RPC 获取
    // 完整实现需要与 MCP Server 进行协议通信
    return [];
  }

  /**
   * 调用 MCP 工具
   */
  async callMCPTool(serverId: string, toolName: string, params: unknown): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const proc = this.mcpProcesses.get(serverId);
    
    if (!proc || proc.killed) {
      return { success: false, error: 'MCP Server not running' };
    }

    // 简化实现：发送 JSON-RPC 请求
    // 完整实现需要处理请求-响应匹配
    try {
      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: params }
      };
      
      proc.stdin?.write(JSON.stringify(request) + '\n');
      
      // 简化：等待一段时间后返回成功
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return { success: true, result: { message: 'Tool call sent' } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 获取所有 MCP Server 状态
   */
  getAllMCPStatus(): Array<{ id: string; running: boolean; toolCount: number }> {
    return Array.from(this.mcpProcesses.entries()).map(([id, proc]) => ({
      id,
      running: !proc.killed,
      toolCount: this.mcpTools.get(id)?.length || 0
    }));
  }

  // ===== A2A 方法 =====

  /**
   * 添加 A2A Agent
   */
  async addA2AAgent(config: A2AAgentConfig): Promise<{ success: boolean; card?: unknown; error?: string }> {
    try {
      // 测试连接
      const response = await fetch(`${config.endpoint}/.well-known/agent.json`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch agent card: ${response.statusText}`);
      }
      
      const card = await response.json();
      
      this.a2aConnections.set(config.id, { endpoint: config.endpoint });
      
      return { success: true, card };
    } catch (error) {
      log.error(`[ProtocolBridge] Failed to add A2A agent ${config.name}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 移除 A2A Agent
   */
  async removeA2AAgent(agentId: string): Promise<{ success: boolean }> {
    this.a2aConnections.delete(agentId);
    return { success: true };
  }

  /**
   * 发送 A2A 任务
   */
  async sendA2ATask(agentId: string, task: string, asyncMode: boolean): Promise<{ success: boolean; taskId?: string; result?: unknown; error?: string }> {
    const conn = this.a2aConnections.get(agentId);
    
    if (!conn) {
      return { success: false, error: 'A2A Agent not found' };
    }

    try {
      const taskId = randomUUID();
      
      const response = await fetch(`${conn.endpoint}/tasks/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          message: { role: 'user', content: task }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to send task: ${response.statusText}`);
      }

      const data = await response.json();

      if (asyncMode) {
        return { success: true, taskId: data.id || taskId };
      } else {
        // 同步模式：轮询等待结果
        const result = await this.pollA2AResult(conn.endpoint, data.id || taskId);
        return { success: true, taskId: data.id || taskId, result };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 轮询 A2A 任务结果
   */
  private async pollA2AResult(endpoint: string, taskId: string, maxAttempts = 60): Promise<unknown> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${endpoint}/tasks/${taskId}`);
        const data = await response.json();

        if (data.status === 'completed' || data.status === 'failed') {
          return data;
        }
      } catch {
        // 忽略错误，继续轮询
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    return { status: 'timeout' };
  }

  /**
   * 获取所有 A2A Agent 状态
   */
  getAllA2AStatus(): Array<{ id: string; connected: boolean }> {
    return Array.from(this.a2aConnections.keys()).map(id => ({
      id,
      connected: this.a2aConnections.has(id)
    }));
  }

  /**
   * 清理所有资源
   */
  async cleanup(): Promise<void> {
    // 停止所有 MCP Server
    for (const [id] of this.mcpProcesses) {
      await this.stopMCPServer(id);
    }

    // 清理 A2A 连接
    this.a2aConnections.clear();

    log.info('[ProtocolBridge] Cleanup complete');
  }
}

// 单例导出
export const protocolBridge = new ProtocolBridge();