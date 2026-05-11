/**
 * MCPToolPanel - MCP 工具技能配置面板
 * 
 * 左侧显示 Agent 列表（可滑动）
 * 右侧显示 Server TAB 栏（可滑动）+ 工具列表
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store/useStore';
import type { Agent } from '../../types';
import type { MCPTool, MCPServerConfig } from '@ahive/shared';
import { ServerTabBar, ServerTabData } from './ServerTabBar';
import { ServerStatusBar } from './ServerStatusBar';
import { ToolCard } from './ToolCard';
import { EmptyState } from './EmptyState';

// 判断是否在 Electron 环境
const isElectron = () => typeof window !== 'undefined' && window.electronAPI?.isDesktop;

interface MCPServerWithTools extends Partial<MCPServerConfig> {
  id: string;
  name: string;
  status: 'starting' | 'running' | 'error' | 'stopped';
  tools: MCPTool[];
  toolCount?: number;
  error?: string;
  // 服务类型区分
  serviceType?: 'mcp-server' | 'mcp-api';
  platformType?: 'bailian' | 'openai' | 'anthropic';
}

// Avatar 图标映射
const AVATAR_ICONS: Record<string, string> = {
  coder: '🦞',
  searcher: '🔍',
  analyzer: '📊',
  general: '🤖',
};

// 状态颜色
const STATUS_COLORS: Record<string, string> = {
  idle: '●',
  working: '🟡',
  paused: '🟠',
  error: '🔴',
};

export function MCPToolPanel() {
  const { agents, language, setShowSettingsPanel, mcpStatusVersion } = useStore();
  const isZh = language === 'zh';

  // 选中的 Agent
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // MCP Server 数据
  const [mcpServers, setMcpServers] = useState<MCPServerWithTools[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOperating, setIsOperating] = useState<string | null>(null);

  // 选中的 Server Tab
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  // 选中的工具
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());

  // 搜索过滤
  const [searchQuery, setSearchQuery] = useState('');

  // Agent 列表滚动
  const agentListRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // 加载 MCP Servers 和工具 - 仅在版本号变化时触发
  useEffect(() => {
    loadMCPServers();
  }, [mcpStatusVersion]);

  // 监听 Electron IPC 事件
  useEffect(() => {
    const handleMCPStatusChanged = () => {
      loadMCPServers();
    };
    
    // Electron IPC 事件监听
    if (isElectron()) {
      window.electronAPI?.onMCPStatusChanged?.(handleMCPStatusChanged);
    }
    
    return () => {
      if (isElectron()) {
        window.electronAPI?.removeMCPStatusChangedListener?.();
      }
    };
  }, []);


  // 当切换 Agent 时，加载该 Agent 的已装备技能
  useEffect(() => {
    if (selectedAgentId) {
      const agent = agents.find(a => a.id === selectedAgentId);
      if (agent?.equippedSkills && agent.equippedSkills.length > 0) {
        setSelectedTools(new Set(agent.equippedSkills));
        console.log('[MCPToolPanel] Loaded skills for agent:', agent.name, agent.equippedSkills);
      } else {
        setSelectedTools(new Set());
      }
    }
  }, [selectedAgentId, agents]);

  // 自动选中第一个运行中的 Server
  useEffect(() => {
    if (mcpServers.length > 0 && !selectedServerId) {
      const runningServer = mcpServers.find(s => s.status === 'running');
      if (runningServer) {
        setSelectedServerId(runningServer.id);
      } else {
        setSelectedServerId(mcpServers[0].id);
      }
    }
  }, [mcpServers, selectedServerId]);

  // 检查 Agent 列表滚动状态
  const checkAgentScroll = () => {
    const container = agentListRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setCanScrollUp(scrollTop > 0);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1);
  };

  useEffect(() => {
    checkAgentScroll();
    window.addEventListener('resize', checkAgentScroll);
    return () => window.removeEventListener('resize', checkAgentScroll);
  }, [agents]);

  const loadMCPServers = async () => {
    setIsLoading(true);
    try {
      if (isElectron() && window.electronAPI?.getMCPServerList) {
        // 1. 加载原生 MCPServer
        const servers = await window.electronAPI.getMCPServerList();
        
        // 2. 加载 MCPAPI 配置
        const mcpApiConfigs = await window.electronAPI.getMCPApiConfigs?.() || [];
        
        // 3. 加载 MCPServer 工具（仅对运行中的服务器）
        const serversWithTools: MCPServerWithTools[] = await Promise.all(
          servers.map(async (server: any) => {
            let tools: MCPTool[] = [];
            const toolCount = server.toolCount || 0;
            
            if (server.status === 'running') {
              try {
                tools = await window.electronAPI?.getMCPServerTools?.(server.id) || [];
              } catch (e) {
                console.error(`Failed to load tools for ${server.name}:`, e);
              }
            }
            return { 
              ...server, 
              tools,
              toolCount,
              error: server.error || server.lastError,
              serviceType: 'mcp-server' as const
            };
          })
        );
        
        // 4. 加载 MCPAPI 工具（加载所有配置，不管 enabled 状态）
        const mcpApiServers: MCPServerWithTools[] = await Promise.all(
          mcpApiConfigs.map(async (config: any) => {
            let tools: MCPTool[] = [];
            // 只对已启用的配置加载工具
            if (config.enabled) {
              try {
                tools = await window.electronAPI?.getMCPApiTools?.(config.id) || [];
              } catch (e) {
                console.error(`Failed to load tools for ${config.name}:`, e);
              }
            }
            return {
              id: config.id,
              name: config.name,
              // 根据 enabled 状态设置 status
              status: config.enabled ? 'running' : 'stopped',
              tools,
              toolCount: tools.length,
              error: undefined,
              serviceType: 'mcp-api' as const,
              platformType: config.platformType
            };
          })
        );
        
        // 5. 合并服务列表
        setMcpServers([...serversWithTools, ...mcpApiServers]);
      }
    } catch (error) {
      console.error('Failed to load MCP services:', error);
    } finally {
      setIsLoading(false);
    }
  };


  // Server 操作
  const handleStartServer = async (serverId: string) => {
    // 查找服务类型
    const server = mcpServers.find(s => s.id === serverId);
    const isMcpApi = server?.serviceType === 'mcp-api';
    
    setIsOperating(serverId);
    try {
      if (isMcpApi) {
        // MCPAPI: 调用 toggleMCPApiConfig 启用
        await window.electronAPI?.toggleMCPApiConfig?.(serverId, true);
      } else {
        // MCPServer: 调用 startMCPServer
        await window.electronAPI?.startMCPServer?.(serverId);
      }
      // 刷新状态
      await loadMCPServers();
    } catch (error) {
      console.error('Failed to start server:', error);
    } finally {
      setIsOperating(null);
    }
  };
  
  const handleStopServer = async (serverId: string) => {
    // 查找服务类型
    const server = mcpServers.find(s => s.id === serverId);
    const isMcpApi = server?.serviceType === 'mcp-api';
    
    setIsOperating(serverId);
    try {
      if (isMcpApi) {
        // MCPAPI: 调用 toggleMCPApiConfig 禁用
        await window.electronAPI?.toggleMCPApiConfig?.(serverId, false);
      } else {
        // MCPServer: 调用 stopMCPServer
        await window.electronAPI?.stopMCPServer?.(serverId);
      }
      await loadMCPServers();
    } catch (error) {
      console.error('Failed to stop server:', error);
    } finally {
      setIsOperating(null);
    }
  };

  const handleRestartServer = async (serverId: string) => {
    setIsOperating(serverId);
    try {
      await window.electronAPI?.stopMCPServer?.(serverId);
      await new Promise(resolve => setTimeout(resolve, 500));
      await window.electronAPI?.startMCPServer?.(serverId);
      await loadMCPServers();
    } catch (error) {
      console.error('Failed to restart server:', error);
    } finally {
      setIsOperating(null);
    }
  };

  const handleRetryServer = async (serverId: string) => {
    await handleStartServer(serverId);
  };

  const handleViewLog = async (serverId: string) => {
    const server = mcpServers.find(s => s.id === serverId);
    if (!server) return;
    
    // 在 Electron 环境中，打开系统日志面板并过滤该 server
    if (isElectron() && (window as any).electronAPI?.getSystemLogStatus) {
      try {
        // 获取系统日志文件列表
        const status = await (window as any).electronAPI.getSystemLogStatus();
        console.log('[MCPToolPanel] System log status:', status);
        
        // 显示提示，引导用户到日志中心查看
        alert(
          isZh 
            ? `请在左侧导航栏点击"日志中心"，在"系统日志"标签页中搜索 "${server.name}" 查看该服务的日志。`
            : `Please click "Log Center" in the left navigation, then search "${server.name}" in "System Logs" tab to view this server's logs.`
        );
      } catch (error) {
        console.error('[MCPToolPanel] Failed to get log status:', error);
        alert(isZh ? '获取日志状态失败' : 'Failed to get log status');
      }
    } else {
      // 非 Electron 环境，显示提示
      console.log('View log for server:', serverId, server.name);
      alert(
        isZh
          ? `MCP Server "${server.name}" 的日志记录在 Electron 客户端的系统日志中。请在桌面版中查看。`
          : `MCP Server "${server.name}" logs are available in Electron client's system logs. Please use the desktop version.`
      );
    }
  };

  // 打开设置面板
  const handleAddServer = () => {
    setShowSettingsPanel(true);
  };


  // 转换 Server 数据为 TAB 数据
  const serverTabData: ServerTabData[] = useMemo(() => {
    return mcpServers.map(server => ({
      id: server.id,
      name: server.name,
      status: server.status,
      toolCount: (server as any).toolCount ?? server.tools?.length ?? 0,
      error: server.error,
      serviceType: server.serviceType,
      platformType: server.platformType
    }));
  }, [mcpServers]);


  // 当前选中的 Server
  const selectedServer = useMemo(() => {
    return mcpServers.find(s => s.id === selectedServerId) || null;
  }, [mcpServers, selectedServerId]);

  // 当前 Server 的工具列表（过滤搜索）
  const filteredTools = useMemo(() => {
    if (!selectedServer || selectedServer.status !== 'running') return [];
    let tools = selectedServer.tools || [];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tools = tools.filter(tool => 
        tool.name.toLowerCase().includes(query) ||
        tool.description?.toLowerCase().includes(query)
      );
    }
    return tools;
  }, [selectedServer, searchQuery]);

  // 切换工具选中状态
  const toggleTool = (toolName: string) => {
    setSelectedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
  };

  // 保存技能配置
  const saveSkills = async () => {
    if (!selectedAgentId) return;

    const agent = agents.find(a => a.id === selectedAgentId);
    if (!agent) return;

    // 更新本地状态
    useStore.getState().updateAgentSkills(selectedAgentId, Array.from(selectedTools));
    console.log('[MCPToolPanel] Skills saved for agent:', selectedAgentId, 'tools:', Array.from(selectedTools));

    // 构建 MCP 能力绑定数据（包含服务类型）
    const capabilities: { server: string; serverType: 'mcp-server' | 'mcp-api'; tools: string[] }[] = [];
    
    // 遍历所有服务器，找出选中的工具所属的服务器
    for (const server of mcpServers) {
      if (server.status !== 'running' || !server.tools) continue;
      
      const serverTools: string[] = [];
      for (const tool of server.tools) {
        if (selectedTools.has(tool.name)) {
          serverTools.push(tool.name);
        }
      }
      
      if (serverTools.length > 0) {
        capabilities.push({
          server: server.id,
          serverType: server.serviceType || 'mcp-server',
          tools: serverTools,
        });
      }
    }

    // 调用 MCP 能力绑定 API（仅 Electron 环境）
    if (isElectron() && window.electronAPI?.bindAgentCapabilities && capabilities.length > 0) {
      try {
        const result = await window.electronAPI.bindAgentCapabilities(selectedAgentId, capabilities);
        
        if (result?.success) {
          console.log('[MCPToolPanel] MCP capabilities bound:', result.binding);
          alert(isZh ? '技能配置已保存并推送到 Agent' : 'Skills saved and pushed to Agent');
        } else {
          console.error('[MCPToolPanel] Failed to bind capabilities:', result?.error);
          alert(isZh ? `推送失败: ${result?.error || '未知错误'}` : `Push failed: ${result?.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('[MCPToolPanel] Error binding capabilities:', error);
        alert(isZh ? '推送过程发生错误' : 'Error occurred during push');
      }
    } else {
      alert(isZh ? '技能配置已保存' : 'Skills saved');
    }
  };

  // 重置选中
  const resetSkills = () => {
    setSelectedTools(new Set());
  };

  // 估算 token 消耗
  const estimatedTokens = selectedTools.size * 150;

  // 当前选中的 Agent
  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  // 渲染内容区域
  const renderContent = () => {
    if (isLoading) {
      return <EmptyState type="loading" language={language} />;
    }

    if (!selectedAgentId) {
      return <EmptyState type="no-agent" language={language} />;
    }

    if (mcpServers.length === 0) {
      return <EmptyState type="no-server" language={language} onAction={handleAddServer} />;
    }

    if (!selectedServer) {
      return <EmptyState type="no-server" language={language} onAction={handleAddServer} />;
    }

    if (selectedServer.status !== 'running') {
      // 非运行状态，显示状态栏的操作提示
      return (
        <div className="flex flex-col items-center justify-center h-full text-hive-text-secondary">
          <div className="text-4xl mb-4">
            {selectedServer.status === 'error' ? '✗' : '○'}
          </div>
          <p className="text-lg">
            {selectedServer.status === 'error' 
              ? (isZh ? 'Server 启动失败' : 'Server failed to start')
              : (isZh ? 'Server 已停止' : 'Server stopped')}
          </p>
          <p className="text-sm mt-2 text-hive-text-secondary">
            {isZh ? '请使用上方按钮启动 Server' : 'Use the buttons above to start the Server'}
          </p>
        </div>
      );
    }

    if (filteredTools.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-hive-text-secondary">
          <div className="text-4xl mb-4">🔍</div>
          <p>{isZh ? '未找到匹配的工具' : 'No matching tools found'}</p>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-sm text-hive-primary hover:underline"
            >
              {isZh ? '清除搜索' : 'Clear search'}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-2 p-4">
        {filteredTools.map(tool => (
          <ToolCard
            key={tool.name}
            tool={tool}
            isSelected={selectedTools.has(tool.name)}
            onToggle={toggleTool}
            language={language}
          />
        ))}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-hive-bg">
        <div className="text-hive-text">{isZh ? '加载中...' : 'Loading...'}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-hive-bg">
      {/* 左侧 Agent 列表（可滑动） */}
      <div className="w-52 bg-hive-surface border-r border-hive-border flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-hive-border flex-shrink-0">
          <h3 className="text-sm font-medium text-hive-text">
            {isZh ? '智能体' : 'Agents'}
          </h3>
        </div>
        
        {/* 滚动阴影提示（顶部） */}
        {canScrollUp && (
          <div className="h-2 bg-gradient-to-b from-hive-surface to-transparent pointer-events-none flex-shrink-0" />
        )}
        
        {/* 可滚动的 Agent 列表 */}
        <div
          ref={agentListRef}
          className="flex-1 overflow-y-auto overflow-x-hidden"
          onScroll={checkAgentScroll}
        >
          {agents.length === 0 ? (
            <div className="p-4 text-center text-hive-text-secondary text-sm">
              {isZh ? '暂无智能体' : 'No agents'}
            </div>
          ) : (
            agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`w-full p-3 flex items-center gap-2 border-b border-hive-border transition-colors ${
                  selectedAgentId === agent.id
                    ? 'bg-hive-primary/20 border-l-2 border-l-hive-primary'
                    : 'hover:bg-hive-hover'
                }`}
              >
                <span className="text-2xl flex-shrink-0">
                  {AVATAR_ICONS[agent.avatar] || agent.avatar || '🤖'}
                </span>
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-medium text-hive-text truncate">
                    {agent.name}
                  </div>
                  <div className="text-xs text-hive-text-secondary flex items-center gap-1">
                    <span className={agent.status === 'idle' ? 'text-green-400' : 'text-yellow-400'}>
                      {STATUS_COLORS[agent.status] || '●'}
                    </span>
                    <span>
                      {agent.equippedSkills?.length || 0} {isZh ? '技能' : 'skills'}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        
        {/* 滚动阴影提示（底部） */}
        {canScrollDown && (
          <div className="h-2 bg-gradient-to-t from-hive-surface to-transparent pointer-events-none flex-shrink-0" />
        )}
      </div>

      {/* 右侧工具区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 头部：Agent 信息 + 操作按钮 */}
        <div className="p-4 border-b border-hive-border flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            {selectedAgent ? (
              <>
                <h2 className="text-lg font-bold text-hive-text flex items-center gap-2">
                  <span className="text-2xl">{AVATAR_ICONS[selectedAgent.avatar] || '🤖'}</span>
                  <span className="truncate">{selectedAgent.name}</span>
                </h2>
                <p className="text-sm text-hive-text-secondary mt-1">
                  {isZh 
                    ? `已装备 ${selectedTools.size} 个工具` 
                    : `Equipped ${selectedTools.size} tools`}
                </p>
              </>
            ) : (
              <h2 className="text-lg font-bold text-hive-text-secondary">
                {isZh ? '请选择一个智能体' : 'Select an agent'}
              </h2>
            )}
          </div>
          
          {selectedAgentId && (
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-sm text-hive-text-secondary">
                {isZh ? `Token: ~${estimatedTokens}` : `Est. tokens: ~${estimatedTokens}`}
              </span>
              <button
                onClick={resetSkills}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm text-hive-text transition-colors"
              >
                {isZh ? '重置' : 'Reset'}
              </button>
              <button
                onClick={saveSkills}
                className="px-4 py-1.5 bg-hive-primary hover:bg-hive-primary-hover rounded text-sm text-white font-medium transition-colors"
              >
                {isZh ? '保存' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {/* Server TAB 栏 */}
        {mcpServers.length > 0 && (
          <ServerTabBar
            servers={serverTabData}
            selectedServerId={selectedServerId}
            onSelectServer={setSelectedServerId}
            onAddServer={handleAddServer}
            onRefresh={loadMCPServers}
            language={language}
          />
        )}

        {/* Server 状态栏 */}
        {selectedServer && (
          <ServerStatusBar
            server={selectedServer}
            onStart={handleStartServer}
            onStop={handleStopServer}
            onRestart={handleRestartServer}
            onRetry={handleRetryServer}
            onViewLog={handleViewLog}
            isOperating={isOperating === selectedServer.id}
            language={language}
          />
        )}

        {/* 搜索框 */}
        {selectedServer?.status === 'running' && (selectedServer.tools?.length || 0) > 0 && (
          <div className="p-2 border-b border-hive-border flex-shrink-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isZh ? '🔍 搜索工具...' : '🔍 Search tools...'}
              className="w-full px-3 py-1.5 bg-hive-surface border border-hive-border rounded text-sm text-hive-text placeholder-hive-text-secondary focus:outline-none focus:border-hive-primary"
            />
          </div>
        )}

        {/* 工具列表 */}
        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>

        {/* 底部状态栏 */}
        {selectedAgentId && selectedServer?.status === 'running' && (
          <div className="px-4 py-2 border-t border-hive-border bg-hive-surface/50 flex items-center justify-between flex-shrink-0">
            <span className="text-sm text-hive-text-secondary">
              {isZh 
                ? `已选择 ${selectedTools.size} 个工具 | Token: ~${estimatedTokens}` 
                : `Selected ${selectedTools.size} tools | Est. tokens: ~${estimatedTokens}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}