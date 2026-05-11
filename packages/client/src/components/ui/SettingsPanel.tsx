/**
 * 设置面板组件
 * 包含 MCP Server 和 A2A Agent 配置入口
 * 
 * 支持两种模式:
 * - Electron 模式: 使用 IPC 与主进程通信，配置保存到本地文件
 * - Web 模式: 使用 REST API，配置保存到服务端
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';
import { translations } from '../../i18n';
import { A2AAgentDialog, A2AAgentListItem } from '../dialogs/A2AAgentDialog';
import { MCPApiDialog, MCPApiListItem } from '../dialogs/MCPApiDialog';
import { MCPServerDialog, MCPServerListItem } from '../dialogs/MCPServerDialog';

import type { MCPServerConfig, A2AAgentConfig, MCPTool, A2AAgentCard } from '@ahive/shared';
import { refreshAgentsEvent } from '../../App';

// 判断是否在 Electron 环境
const isElectron = () => typeof window !== 'undefined' && window.electronAPI?.isDesktop;

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'mcp' | 'a2a' | 'mcp-api' | 'general';

// 系统服务状态类型
interface SystemServicesStatus {
  gateway: { status: string; error?: string };
  mcpHttpEndpoint: string;
  a2a: { totalAgents: number; enabledAgents: number };
  openclawInstalled: boolean;
  opencodeInstalled: boolean;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { language } = useStore();
  const dialog = useDialog();
  const tr = translations[language];
  const isZh = language === 'zh';

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [showMCPDialog, setShowMCPDialog] = useState(false);
  const [showA2ADialog, setShowA2ADialog] = useState(false);
  const [showMCPApiDialog, setShowMCPApiDialog] = useState(false);
  const [editingMCPServer, setEditingMCPServer] = useState<MCPServerConfig | null>(null);
  const [editingA2AAgent, setEditingA2AAgent] = useState<A2AAgentConfig | null>(null);
  const [editingMCPApiConfig, setEditingMCPApiConfig] = useState<any>(null);

  // MCP Server 数据
  const [mcpServers, setMcpServers] = useState<Array<MCPServerConfig & { status: string }>>([]);
  const [mcpTools, setMcpTools] = useState<Record<string, MCPTool[]>>({});

  // A2A Agent 数据
  const [a2aAgents, setA2aAgents] = useState<Array<A2AAgentConfig & { card?: A2AAgentCard }>>([]);

  // npm u像源设置
  const [npmRegistry, setNpmRegistry] = useState<'auto' | 'china' | 'official'>('auto');
  const [npmSaveSuccess, setNpmSaveSuccess] = useState(false);

  // MCP API 数据
  const [mcpApiConfigs, setMcpApiConfigs] = useState<any[]>([]);

  // ========== 系统服务状态 ==========
  const [systemStatus, setSystemStatus] = useState<SystemServicesStatus | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<{ status: string; error?: string }>({ status: 'stopped' });
  const [opencodeServeStatus, setOpencodeServeStatus] = useState<{ running: boolean }>({ running: false });
  const [opencodeServePort, setOpencodeServePort] = useState<number>(8095);
  const [mcpEndpoint, setMcpEndpoint] = useState<string>('');
  const [a2aEndpoint, setA2aEndpoint] = useState<string>('');

  // 加载系统服务状态
  const loadSystemStatus = useCallback(async () => {
    if (!isElectron() || !window.electronAPI?.getSystemServicesStatus) return;

    try {
      const status = await window.electronAPI.getSystemServicesStatus();
      setSystemStatus(status);
      setGatewayStatus(status.gateway);
      setMcpEndpoint(status.mcpHttpEndpoint);

      // 获取 A2A endpoint
      if (window.electronAPI?.getA2AEndpoint) {
        const a2aUrl = await window.electronAPI.getA2AEndpoint();
        setA2aEndpoint(a2aUrl);
      }

      // 获取 OpenCode serve 状态
      if (window.electronAPI?.getOpencodeServeStatus) {
        const ocStatus = await window.electronAPI.getOpencodeServeStatus();
        setOpencodeServeStatus(ocStatus);
      }
    } catch (error) {
      console.error('Failed to load system status:', error);
    }
  }, []);

  // 监听网关状态变化
  useEffect(() => {
    if (!isElectron() || !window.electronAPI?.onGatewayStatus) return;

    window.electronAPI.onGatewayStatus((data) => {
      setGatewayStatus(data);
    });
  }, []);

  // 定时刷新系统状态
  useEffect(() => {
    if (isOpen && activeTab === 'general') {
      loadSystemStatus();
      const timer = setInterval(loadSystemStatus, 5000);
      return () => clearInterval(timer);
    }
  }, [isOpen, activeTab, loadSystemStatus]);

  // 网关操作
  const handleStartGateway = async () => {
    if (!isElectron() || !window.electronAPI?.startGateway) return;
    const result = await window.electronAPI.startGateway();
    if (!result.success) {
      await dialog.alert(
        isZh ? `网关启动失败: ${result.error}` : `Gateway start failed: ${result.error}`,
        isZh ? '错误' : 'Error'
      );
    }
    loadSystemStatus();
  };

  const handleStopGateway = async () => {
    if (!isElectron() || !window.electronAPI?.stopGateway) return;
    await window.electronAPI.stopGateway();
    loadSystemStatus();
  };

  // OpenCode serve 操作
  const handleStartOpencodeServe = async () => {
    if (!isElectron() || !window.electronAPI?.startOpencodeServe) return;
    const result = await window.electronAPI.startOpencodeServe(opencodeServePort);
    if (result.success) {
      await dialog.alert(
        isZh ? `OpenCode serve 启动成功\n地址: ${result.endpoint}` : `OpenCode serve started\nEndpoint: ${result.endpoint}`,
        isZh ? '成功' : 'Success'
      );
    } else {
      await dialog.alert(
        isZh ? `OpenCode serve 启动失败: ${result.error}` : `OpenCode serve failed: ${result.error}`,
        isZh ? '错误' : 'Error'
      );
    }
    loadSystemStatus();
  };

  const handleStopOpencodeServe = async () => {
    if (!isElectron() || !window.electronAPI?.stopOpencodeServe) return;
    await window.electronAPI.stopOpencodeServe();
    loadSystemStatus();
  };

  // 复制到剪贴板
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      await dialog.alert(isZh ? '已复制到剪贴板' : 'Copied to clipboard', isZh ? '成功' : 'Success');
    } catch {
      await dialog.alert(isZh ? '复制失败' : 'Copy failed', isZh ? '错误' : 'Error');
    }
  };

  // 加载 MCP Servers
  const loadMCPServers = async () => {
    try {
      if (isElectron() && window.electronAPI?.getMCPServerList) {
        // Electron 模式：使用 IPC 获取带状态的服务器列表
        const data = await window.electronAPI.getMCPServerList() || [];
        setMcpServers(data);
        console.log('[SettingsPanel] Loaded MCP servers from Electron:', data.length);

        // 加载每个已运行服务器的工具
        for (const server of data) {
          if (server.status === 'running') {
            const tools = await window.electronAPI?.getMCPServerTools?.(server.id);
            if (tools) {
              setMcpTools(prev => ({ ...prev, [server.id]: tools }));
            }
          }
        }
      } else if (isElectron() && window.electronAPI?.getMCPServers) {
        // 兼容旧 API
        const data = await window.electronAPI.getMCPServers() || [];
        setMcpServers(data.map((s: any) => ({ ...s, status: 'stopped' })));
      } else {
        // Web 模式：调用 REST API
        const response = await fetch('/api/mcp/servers');
        const data = await response.json();
        setMcpServers(data || []);

        for (const server of data) {
          const toolsRes = await fetch(`/api/mcp/servers/${server.id}/tools`);
          const tools = await toolsRes.json();
          setMcpTools(prev => ({ ...prev, [server.id]: tools }));
        }
      }
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
    }
  };

  // 加载 A2A Agents
  const loadA2AAgents = async () => {
    try {
      if (isElectron() && window.electronAPI?.getA2AAgentList) {
        // Electron 模式：使用 IPC 获取带 Card 的 Agent 列表
        const data = await window.electronAPI.getA2AAgentList() || [];
        setA2aAgents(data);
        console.log('[SettingsPanel] Loaded A2A agents from Electron:', data.length);
      } else if (isElectron() && window.electronAPI?.getA2AAgents) {
        // 兼容旧 API
        const data = await window.electronAPI.getA2AAgents() || [];
        setA2aAgents(data);
      } else {
        // Web 模式：调用 REST API
        const response = await fetch('/api/a2a/agents');
        const data = await response.json();
        setA2aAgents(data || []);
      }
    } catch (error) {
      console.error('Failed to load A2A agents:', error);
    }
  };

  // 加载 MCP API 配置
  const loadMCPApiConfigs = async () => {
    try {
      if (isElectron() && window.electronAPI?.getMCPApiConfigs) {
        const data = await window.electronAPI.getMCPApiConfigs() || [];
        setMcpApiConfigs(data);
        console.log('[SettingsPanel] Loaded MCP API configs:', data.length);
      }
    } catch (error) {
      console.error('Failed to load MCP API configs:', error);
    }
  };

  // 初始加载
  useEffect(() => {
    if (isOpen) {
      // 调试：打印环境检测信息
      console.log('[SettingsPanel] Environment check:', {
        isElectron: isElectron(),
        hasElectronAPI: !!window.electronAPI,
        isDesktop: window.electronAPI?.isDesktop,
        hasGetMCPServers: !!window.electronAPI?.getMCPServers,
        hasSaveMCPServer: !!window.electronAPI?.saveMCPServer
      });
      loadMCPServers();
      loadA2AAgents();
      loadMCPApiConfigs();

      // 加载 npm 镜像源设置
      if (isElectron() && window.electronAPI?.getNpmRegistry) {
        window.electronAPI.getNpmRegistry().then(registry => {
          setNpmRegistry(registry);
        });
      }
    }
  }, [isOpen]);

  // ========== MCP 操作 ==========

  const handleCreateMCP = async (request: { name: string; command: string; args?: string[]; env?: Record<string, string> }) => {
    try {
      if (isElectron() && window.electronAPI?.saveMCPServer) {
        // Electron 模式
        const serverConfig: MCPServerConfig = {
          id: crypto.randomUUID(),
          name: request.name,
          command: request.command,
          args: request.args,
          env: request.env,
          enabled: true
        };
        await window.electronAPI.saveMCPServer(serverConfig);
        console.log('[SettingsPanel] Saved MCP server to Electron storage');
      } else {
        // Web 模式
        await fetch('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        });
      }
      await loadMCPServers();
    } catch (error) {
      console.error('Failed to create MCP server:', error);
      throw error;
    }
  };

  const handleDeleteMCP = async (id: string) => {
    const confirmed = await dialog.confirm(
      isZh ? '确定删除此 MCP Server？' : 'Delete this MCP Server?',
      isZh ? '删除确认' : 'Confirm Delete'
    );
    if (!confirmed) return;
    try {
      // 先停止服务器
      if (isElectron() && window.electronAPI?.stopMCPServer) {
        await window.electronAPI.stopMCPServer(id);
      }

      if (isElectron() && window.electronAPI?.deleteMCPServer) {
        await window.electronAPI.deleteMCPServer(id);
      } else {
        await fetch(`/api/mcp/servers/${id}`, { method: 'DELETE' });
      }
      await loadMCPServers();
    } catch (error) {
      console.error('Failed to delete MCP server:', error);
    }
  };

  const handleRestartMCP = async (id: string) => {
    try {
      if (isElectron() && window.electronAPI?.stopMCPServer && window.electronAPI?.startMCPServer) {
        // Electron 模式：真正的重启
        await window.electronAPI.stopMCPServer(id);
        const status = await window.electronAPI.startMCPServer(id);
        console.log('[SettingsPanel] MCP server restarted:', status);

        // 重新加载工具
        const tools = await window.electronAPI?.getMCPServerTools?.(id);
        if (tools) {
          setMcpTools(prev => ({ ...prev, [id]: tools }));
        }
      } else {
        // Web 模式
        await fetch(`/api/mcp/servers/${id}/restart`, { method: 'POST' });
      }
      await loadMCPServers();
    } catch (error) {
      console.error('Failed to restart MCP server:', error);
    }
  };

  const handleToggleMCP = async (id: string, enabled: boolean) => {
    try {
      if (isElectron() && window.electronAPI?.startMCPServer && window.electronAPI?.stopMCPServer) {
        // Electron 模式：启动/停止服务器
        if (enabled) {
          await window.electronAPI.startMCPServer(id);
        } else {
          await window.electronAPI.stopMCPServer(id);
        }
        // 同时更新存储
        if (window.electronAPI?.toggleMCPServer) {
          await window.electronAPI.toggleMCPServer(id, enabled);
        }
      } else if (isElectron() && window.electronAPI?.toggleMCPServer) {
        // 兼容旧 API
        await window.electronAPI.toggleMCPServer(id, enabled);
      } else {
        // Web 模式
        await fetch(`/api/mcp/servers/${id}/enabled`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled })
        });
      }
      await loadMCPServers();
    } catch (error) {
      console.error('Failed to toggle MCP server:', error);
    }
  };

  // ========== A2A 操作 ==========

  const handleCreateA2A = async (request: {
    id?: string;  // 编辑时传入现有 ID
    name: string;
    endpoint: string;
    agentId: string;
    webhookUrl?: string;
    protocolType: 'a2a-standard' | 'openclaw' | 'opencode' | 'ahivecore';
    customFields?: Record<string, any>;
  }) => {
    try {
      if (isElectron() && window.electronAPI?.saveA2AAgent) {
        // Electron 模式
        // 查找现有 agent 以保留 enabled 状态
        const existingAgent = a2aAgents.find(a => a.id === request.id);
        const agentConfig: A2AAgentConfig = {
          id: request.id || crypto.randomUUID(),  // 使用现有 ID 或生成新 UUID
          name: request.name,
          endpoint: request.endpoint,
          agentId: request.agentId,
          webhookUrl: request.webhookUrl,
          protocolType: request.protocolType,
          apiKey: request.customFields?.apiKey,
          customFields: request.customFields,  // 保存所有自定义字段
          enabled: existingAgent?.enabled ?? true,  // 保留原有 enabled 状态
        };
        await window.electronAPI.saveA2AAgent(agentConfig);
        console.log('[SettingsPanel] Saved A2A agent to Electron storage');
      } else {
        // Web 模式
        await fetch('/api/a2a/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        });
      }
      await loadA2AAgents();
      // 刷新 3D 世界中的 Agents
      refreshAgentsEvent.listeners.forEach(fn => fn());
    } catch (error) {
      console.error('Failed to create A2A agent:', error);
      throw error;
    }
  };

  const handleDeleteA2A = async (id: string) => {
    const confirmed = await dialog.confirm(
      isZh ? '确定删除此 A2A Agent？' : 'Delete this A2A Agent?',
      isZh ? '删除确认' : 'Confirm Delete'
    );
    if (!confirmed) return;
    try {
      if (isElectron() && window.electronAPI?.deleteA2AAgent) {
        // Electron 模式
        await window.electronAPI.deleteA2AAgent(id);
      } else {
        // Web 模式
        await fetch(`/api/a2a/agents/${id}`, { method: 'DELETE' });
      }
      await loadA2AAgents();
      // 刷新 3D 世界中的 Agents
      refreshAgentsEvent.listeners.forEach(fn => fn());
    } catch (error) {
      console.error('Failed to delete A2A agent:', error);
    }
  };

  const handleRefreshA2A = async (id: string) => {
    try {
      if (isElectron() && window.electronAPI?.refreshA2AAgentCard) {
        // Electron 模式：刷新 Agent Card
        const card = await window.electronAPI.refreshA2AAgentCard(id);
        console.log('[SettingsPanel] A2A agent card refreshed:', card);
      } else if (!isElectron()) {
        // Web 模式
        await fetch(`/api/a2a/agents/${id}/refresh`, { method: 'POST' });
      }
      await loadA2AAgents();
    } catch (error) {
      console.error('Failed to refresh A2A agent:', error);
    }
  };

  const handleToggleA2A = async (id: string, enabled: boolean) => {
    try {
      if (isElectron() && window.electronAPI?.toggleA2AAgent) {
        // Electron 模式
        await window.electronAPI.toggleA2AAgent(id, enabled);
      } else {
        // Web 模式
        await fetch(`/api/a2a/agents/${id}/enabled`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled })
        });
      }
      await loadA2AAgents();
      // 刷新 3D 世界中的 Agents
      refreshAgentsEvent.listeners.forEach(fn => fn());
    } catch (error) {
      console.error('Failed to toggle A2A agent:', error);
    }
  };

  if (!isOpen) return null;

  // 获取存储模式描述
  const storageMode = isElectron()
    ? (isZh ? '本地存储 (Electron)' : 'Local Storage (Electron)')
    : (isZh ? '服务端存储 (Web)' : 'Server Storage (Web)');

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 w-[800px] bg-gray-900 z-50 shadow-2xl overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">
            {isZh ? '⚙️ 设置' : '⚙️ Settings'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('mcp')}
            className={`flex-1 py-3 text-center font-medium transition-colors ${activeTab === 'mcp'
                ? 'text-white border-b-2 border-indigo-500 bg-gray-800/50'
                : 'text-gray-400 hover:text-white'
              }`}
          >
            🔌 MCP Server
          </button>
          <button
            onClick={() => setActiveTab('mcp-api')}
            className={`flex-1 py-3 text-center font-medium transition-colors ${activeTab === 'mcp-api'
                ? 'text-white border-b-2 border-purple-500 bg-gray-800/50'
                : 'text-gray-400 hover:text-white'
              }`}
          >
            🔌 MCP API
          </button>
          <button
            onClick={() => setActiveTab('a2a')}
            className={`flex-1 py-3 text-center font-medium transition-colors ${activeTab === 'a2a'
                ? 'text-white border-b-2 border-indigo-500 bg-gray-800/50'
                : 'text-gray-400 hover:text-white'
              }`}
          >
            🤖 A2A Agent
          </button>
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-3 text-center font-medium transition-colors ${activeTab === 'general'
                ? 'text-white border-b-2 border-green-500 bg-gray-800/50'
                : 'text-gray-400 hover:text-white'
              }`}
          >
            ⚙️ {isZh ? '通用' : 'General'}
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'mcp' && (
            <div>
              {/* npm 镜像源设置 */}
              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <h3 className="font-medium text-white mb-3">
                  🌐 {isZh ? 'npm 镜像源' : 'npm Registry'}
                </h3>
                <p className="text-sm text-gray-400 mb-3">
                  {isZh
                    ? '选择 npm 包下载源，影响 MCP Server 启动速度'
                    : 'Select npm registry for MCP Server package downloads'}
                </p>

                {/* 当前选择状态 */}
                <p className="text-xs text-indigo-400 mb-3">
                  {isZh ? '当前选择: ' : 'Current: '}
                  {npmRegistry === 'auto' && (isZh ? '自动检测' : 'Auto Detect')}
                  {npmRegistry === 'china' && (isZh ? '国内镜像' : 'China Mirror')}
                  {npmRegistry === 'official' && (isZh ? '官方源' : 'Official')}
                </p>

                {/* 成功提示 */}
                {npmSaveSuccess && (
                  <p className="text-xs text-green-400 mb-3 animate-pulse">
                    ✅ {isZh ? '设置已保存' : 'Settings saved'}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      if (isElectron() && window.electronAPI?.saveNpmRegistry) {
                        await window.electronAPI.saveNpmRegistry('auto');
                        setNpmRegistry('auto');
                        setNpmSaveSuccess(true);
                        setTimeout(() => setNpmSaveSuccess(false), 2000);
                      }
                    }}
                    className={`flex-1 px-4 py-2 rounded transition-colors ${npmRegistry === 'auto'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                  >
                    🔄 {isZh ? '自动检测' : 'Auto Detect'}
                  </button>
                  <button
                    onClick={async () => {
                      if (isElectron() && window.electronAPI?.saveNpmRegistry) {
                        await window.electronAPI.saveNpmRegistry('china');
                        setNpmRegistry('china');
                        setNpmSaveSuccess(true);
                        setTimeout(() => setNpmSaveSuccess(false), 2000);
                      }
                    }}
                    className={`flex-1 px-4 py-2 rounded transition-colors ${npmRegistry === 'china'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                  >
                    🇨🇳 {isZh ? '国内镜像' : 'China Mirror'}
                  </button>
                  <button
                    onClick={async () => {
                      if (isElectron() && window.electronAPI?.saveNpmRegistry) {
                        await window.electronAPI.saveNpmRegistry('official');
                        setNpmRegistry('official');
                        setNpmSaveSuccess(true);
                        setTimeout(() => setNpmSaveSuccess(false), 2000);
                      }
                    }}
                    className={`flex-1 px-4 py-2 rounded transition-colors ${npmRegistry === 'official'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                  >
                    🌍 {isZh ? '官方源' : 'Official'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-gray-400 text-sm">
                    {isZh
                      ? 'MCP (Model Context Protocol) 让 Agent 能调用外部工具'
                      : 'MCP enables Agents to call external tools'}
                  </p>
                  <p className="text-xs text-indigo-400 mt-1">{storageMode}</p>
                </div>
                <button
                  onClick={() => setShowMCPDialog(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white text-sm font-medium"
                >
                  + {isZh ? '添加 Server' : 'Add Server'}
                </button>
              </div>

              {mcpServers.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <div className="text-4xl mb-2">🔌</div>
                  <p>{isZh ? '暂无 MCP Server' : 'No MCP Servers configured'}</p>
                  <p className="text-sm mt-1">{isZh ? '点击上方按钮添加' : 'Click the button above to add'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mcpServers.map(server => (
                    <MCPServerListItem
                      key={server.id}
                      server={server}
                      tools={mcpTools[server.id] || []}
                      onDelete={handleDeleteMCP}
                      onRestart={handleRestartMCP}
                      onToggle={handleToggleMCP}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'mcp-api' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-gray-400 text-sm">
                    {isZh
                      ? 'MCP API 让你通过 REST API 接入 MCP 服务，支持百炼、OpenAI、Anthropic 等平台'
                      : 'Connect to MCP services via REST API. Supports Bailian, OpenAI, Anthropic'}
                  </p>
                  <p className="text-xs text-purple-400 mt-1">{storageMode}</p>
                </div>
                <button
                  onClick={() => { setEditingMCPApiConfig(null); setShowMCPApiDialog(true); }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-white text-sm font-medium"
                >
                  + {isZh ? '添加 MCP API' : 'Add MCP API'}
                </button>
              </div>

              {mcpApiConfigs.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <div className="text-4xl mb-2">🔌</div>
                  <p>{isZh ? '暂无 MCP API 配置' : 'No MCP API configs'}</p>
                  <p className="text-sm mt-1">{isZh ? '点击上方按钮添加' : 'Click the button above to add'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mcpApiConfigs.map(config => (
                    <MCPApiListItem
                      key={config.id}
                      config={config}
                      onEdit={() => { setEditingMCPApiConfig(config); setShowMCPApiDialog(true); }}
                      onDelete={async () => {
                        const confirmed = await dialog.confirm(
                          isZh ? '确定删除此 MCP API 配置？' : 'Delete this MCP API config?',
                          isZh ? '删除确认' : 'Confirm Delete'
                        );
                        if (!confirmed) return;
                        if (window.electronAPI?.deleteMCPApiConfig) {
                          await window.electronAPI.deleteMCPApiConfig(config.id);
                          loadMCPApiConfigs();
                        }
                      }}
                      onToggle={async (enabled) => {
                        if (window.electronAPI?.toggleMCPApiConfig) {
                          await window.electronAPI.toggleMCPApiConfig(config.id, enabled);
                          loadMCPApiConfigs();
                        }
                      }}
                    />
                  ))}
                </div>

              )}
            </div>
          )}

          {activeTab === 'a2a' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-gray-400 text-sm">
                    {isZh
                      ? 'A2A (Agent-to-Agent) 协议让 Agent 之间可以相互协作'
                      : 'A2A protocol enables Agents to collaborate with each other'}
                  </p>
                  <p className="text-xs text-indigo-400 mt-1">{storageMode}</p>
                </div>
                <button
                  onClick={() => { setEditingA2AAgent(null); setShowA2ADialog(true); }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white text-sm font-medium"
                >
                  + {isZh ? '添加 Agent' : 'Add Agent'}
                </button>
              </div>

              {a2aAgents.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <div className="text-4xl mb-2">🤖</div>
                  <p>{isZh ? '暂无 A2A Agent' : 'No A2A Agents configured'}</p>
                  <p className="text-sm mt-1">{isZh ? '点击上方按钮添加' : 'Click the button above to add'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {a2aAgents.map(agent => (
                    <div key={agent.id} className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-600/20 rounded-lg flex items-center justify-center">
                            <span className="text-xl">🤖</span>
                          </div>
                          <div>
                            <h4 className="text-white font-medium">{agent.name}</h4>
                            <p className="text-gray-400 text-sm">{agent.endpoint}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleA2A(agent.id, !agent.enabled)}
                            className={`px-3 py-1 rounded text-sm ${agent.enabled
                                ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                                : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
                              }`}
                          >
                            {agent.enabled ? (isZh ? '启用' : 'Enabled') : (isZh ? '禁用' : 'Disabled')}
                          </button>
                          <button
                            onClick={() => handleRefreshA2A(agent.id)}
                            className="px-3 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-sm"
                          >
                            {isZh ? '刷新' : 'Refresh'}
                          </button>
                          <button
                            onClick={() => { setEditingA2AAgent(agent); setShowA2ADialog(true); }}
                            className="px-3 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-sm"
                          >
                            {isZh ? '编辑' : 'Edit'}
                          </button>
                          <button
                            onClick={() => handleDeleteA2A(agent.id)}
                            className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-sm"
                          >
                            {isZh ? '删除' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'general' && (
            <div className="space-y-6">
              {/* ========== A2A 服务管理 ========== */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="font-medium text-white mb-3 flex items-center gap-2">
                  <span>🤖</span>
                  {isZh ? 'A2A 服务管理' : 'A2A Service Management'}
                </h3>

                <p className="text-gray-400 text-sm mb-4">
                  {isZh
                    ? '启动外部 Agent 的 HTTP API 服务，让 AHIVE 可以与它们通信'
                    : 'Start external Agent HTTP API services for AHIVE to communicate with them'}
                </p>

                {/* OpenCode Serve */}
                <div className="bg-gray-700/50 rounded-lg p-3 mb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">📦</span>
                      <div>
                        <h4 className="text-white font-medium">OpenCode Serve</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-gray-400 text-xs">{isZh ? '端口:' : 'Port:'}</span>
                          <input
                            type="number"
                            value={opencodeServePort}
                            onChange={(e) => setOpencodeServePort(parseInt(e.target.value) || 8095)}
                            className="w-20 px-2 py-0.5 bg-gray-600 text-white text-xs rounded border border-gray-500 focus:border-indigo-500 focus:outline-none"
                            disabled={opencodeServeStatus.running}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {opencodeServeStatus.running ? (
                        <>
                          <span className="text-green-400 text-sm">{isZh ? '运行中' : 'Running'}</span>
                          <button
                            onClick={handleStopOpencodeServe}
                            className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-sm"
                          >
                            {isZh ? '停止' : 'Stop'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleStartOpencodeServe}
                          className="px-3 py-1 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded text-sm"
                        >
                          {isZh ? '启动' : 'Start'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* OpenClaw Gateway */}
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">🦀</span>
                      <div>
                        <h4 className="text-white font-medium">OpenClaw Gateway</h4>
                        <p className="text-gray-400 text-xs">端口: 18789</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {gatewayStatus.status === 'running' ? (
                        <>
                          <span className="text-green-400 text-sm">{isZh ? '运行中' : 'Running'}</span>
                          <button
                            onClick={handleStopGateway}
                            className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-sm"
                          >
                            {isZh ? '停止' : 'Stop'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleStartGateway}
                          disabled={gatewayStatus.status === 'starting'}
                          className="px-3 py-1 bg-green-600/20 text-green-400 hover:bg-green-600/30 disabled:bg-gray-600/20 disabled:text-gray-400 rounded text-sm"
                        >
                          {gatewayStatus.status === 'starting'
                            ? (isZh ? '启动中...' : 'Starting...')
                            : (isZh ? '启动' : 'Start')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ========== AHIVE 服务接口 ========== */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="font-medium text-white mb-3 flex items-center gap-2">
                  <span>🔌</span>
                  {isZh ? 'AHIVE 服务接口' : 'AHIVE Service Endpoints'}
                </h3>

                <p className="text-gray-400 text-sm mb-4">
                  {isZh
                    ? '这些 URL 供外部 Agent 连接 AHIVE 系统使用'
                    : 'These URLs are for external Agents to connect to AHIVE'}
                </p>

                {/* MCP HTTP 服务 */}
                <div className="bg-gray-700/50 rounded-lg p-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-300 font-medium">🔌 MCP 工具服务</span>
                    <button
                      onClick={() => copyToClipboard(mcpEndpoint || 'http://127.0.0.1:3002')}
                      className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-gray-300"
                    >
                      📋 {isZh ? '复制' : 'Copy'}
                    </button>
                  </div>
                  <code className="text-green-400 text-sm break-all">{mcpEndpoint || 'http://127.0.0.1:3002'}</code>
                  <p className="text-gray-500 text-xs mt-1">
                    {isZh ? '端口 3002 | 智能体调用 MCP 工具的 HTTP 接口' : 'Port 3002 | HTTP endpoint for agents to call MCP tools'}
                  </p>
                  <div className="mt-2 text-gray-600 text-xs space-y-1 border-t border-gray-600 pt-2">
                    <p>GET /mcp/servers - {isZh ? '列出服务器' : 'List servers'}</p>
                    <p>GET /mcp/{"{serverId}"}/tools - {isZh ? '列出工具' : 'List tools'}</p>
                    <p>POST /mcp/{"{serverId}"}/{"{toolName}"} - {isZh ? '调用工具' : 'Call tool'}</p>
                  </div>
                </div>

                {/* A2A 通讯接口 */}
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-300 font-medium">🤝 A2A 通讯服务</span>
                    <button
                      onClick={() => copyToClipboard(a2aEndpoint || 'http://127.0.0.1:3003')}
                      className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded text-gray-300"
                    >
                      📋 {isZh ? '复制' : 'Copy'}
                    </button>
                  </div>
                  <code className="text-blue-400 text-sm break-all">{a2aEndpoint || 'http://127.0.0.1:3003'}</code>
                  <p className="text-gray-500 text-xs mt-1">
                    {isZh ? '端口 3003 | Agent 间通讯的 HTTP 接口（Electron 客户端）' : 'Port 3003 | HTTP endpoint for Agent-to-Agent communication (Electron Client)'}
                  </p>
                  <div className="mt-2 text-gray-600 text-xs space-y-1 border-t border-gray-600 pt-2">
                    <p>GET/POST /a2a - {isZh ? '发送消息' : 'Send message'}</p>
                    <p>GET /a2a/logs - {isZh ? '查询对话日志' : 'Query conversation logs'}</p>
                    <p>GET /a2a/directory - {isZh ? '获取团队通讯录' : 'Get team directory'}</p>
                    <p>GET /a2a/status - {isZh ? '获取智能体状态' : 'Get agent status'}</p>
                  </div>
                </div>
              </div>

              {/* ========== 语言设置 ========== */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="font-medium text-white mb-3">
                  {isZh ? '🌐 语言设置' : '🌐 Language'}
                </h3>
                <div className="flex gap-3">
                  <button
                    onClick={() => useStore.getState().setLanguage('zh')}
                    className={`px-4 py-2 rounded ${language === 'zh' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}
                  >
                    中文
                  </button>
                  <button
                    onClick={() => useStore.getState().setLanguage('en')}
                    className={`px-4 py-2 rounded ${language === 'en' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}
                  >
                    English
                  </button>
                </div>
              </div>

              {/* ========== 系统信息 ========== */}
              <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="font-medium text-white mb-3">
                  {isZh ? '📊 系统信息' : '📊 System Info'}
                </h3>
                <div className="text-sm text-gray-400 space-y-1">
                  <p>Version: 1.0.0</p>
                  <p>{isZh ? '存储模式' : 'Storage'}: {storageMode}</p>
                  <p>Protocol: MCP + A2A</p>
                  {systemStatus && (
                    <>
                      <p>{isZh ? 'A2A Agents' : 'A2A Agents'}: {systemStatus.a2a.enabledAgents}/{systemStatus.a2a.totalAgents} {isZh ? '已启用' : 'enabled'}</p>
                    </>
                  )}
                  {isElectron() && (
                    <p className="text-green-400">
                      {isZh ? '✅ 运行在 Electron 桌面环境' : '✅ Running in Electron desktop'}
                    </p>
                  )}
                </div>
              </div>

              {/* ========== 版权信息 ========== */}
              <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <p className="text-center text-gray-500 text-sm">
                  Copyright (c) 2026 星未来软件工作室 StarFuture Software Studio (AHIVE.CN)
                </p>
                <p className="text-center text-gray-600 text-xs mt-1">
                  {isZh ? '智能体集群管理器' : 'Agent Cluster Manager'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MCP Server 对话框 */}
      <MCPServerDialog
        isOpen={showMCPDialog}
        onClose={() => {
          setShowMCPDialog(false);
          setEditingMCPServer(null);
        }}
        onSave={handleCreateMCP}
        editingServer={editingMCPServer}
      />

      {/* A2A Agent 对话框 */}
      <A2AAgentDialog
        isOpen={showA2ADialog}
        onClose={() => {
          setShowA2ADialog(false);
          setEditingA2AAgent(null);
        }}
        onSave={handleCreateA2A}
        editingAgent={editingA2AAgent}
      />

      {/* MCP API 对话框 */}
      <MCPApiDialog
        isOpen={showMCPApiDialog}
        onClose={() => {
          setShowMCPApiDialog(false);
          setEditingMCPApiConfig(null);
        }}
        onSave={async (config) => {
          if (window.electronAPI?.saveMCPApiConfig) {
            await window.electronAPI.saveMCPApiConfig(config);
            loadMCPApiConfigs();
          }
        }}
        editingConfig={editingMCPApiConfig}
      />
    </>
  );
}