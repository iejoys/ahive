/**
 * ServerTabBar - Server TAB 栏组件
 * 
 * 可滑动的 Server 标签栏，显示所有 MCP Server 状态
 */

import { useRef, useState, useEffect } from 'react';

export interface ServerTabData {
  id: string;
  name: string;
  status: 'starting' | 'running' | 'error' | 'stopped';
  toolCount?: number;
  error?: string;
  // 新增：服务类型区分
  serviceType?: 'mcp-server' | 'mcp-api';
  platformType?: 'bailian' | 'openai' | 'anthropic';
}

interface ServerTabBarProps {
  servers: ServerTabData[];
  selectedServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onAddServer?: () => void;
  onRefresh?: () => void;  // 新增：刷新回调
  language?: 'zh' | 'en';
}

export function ServerTabBar({
  servers,
  selectedServerId,
  onSelectServer,
  onAddServer,
  onRefresh,
  language = 'zh'
}: ServerTabBarProps) {
  const isZh = language === 'zh';
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // 检查滚动状态
  const checkScroll = () => {
    const container = tabContainerRef.current;
    if (!container) return;
    
    const { scrollLeft, scrollWidth, clientWidth } = container;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [servers]);

  const scrollLeft = () => {
    const container = tabContainerRef.current;
    if (container) {
      container.scrollBy({ left: -150, behavior: 'smooth' });
      setTimeout(checkScroll, 300);
    }
  };

  const scrollRight = () => {
    const container = tabContainerRef.current;
    if (container) {
      container.scrollBy({ left: 150, behavior: 'smooth' });
      setTimeout(checkScroll, 300);
    }
  };

  const handleTabClick = (server: ServerTabData) => {
    onSelectServer(server.id);
  };

  // 获取状态显示
  const getStatusDisplay = (server: ServerTabData) => {
    switch (server.status) {
      case 'running':
        return {
          icon: '●',
          label: server.toolCount?.toString() || '0',
          colorClass: 'text-green-400'
        };
      case 'error':
        return {
          icon: '✗',
          label: '',
          colorClass: 'text-red-400'
        };
      case 'starting':
        return {
          icon: '◐',
          label: '',
          colorClass: 'text-yellow-400 animate-pulse'
        };
      default:
        return {
          icon: '○',
          label: '',
          colorClass: 'text-gray-500'
        };
    }
  };

  return (
    <div className="flex items-center gap-1 px-2 py-2 bg-hive-surface border-b border-hive-border">
      {/* 左箭头 */}
      {canScrollLeft && (
        <button
          onClick={scrollLeft}
          className="p-1 hover:bg-hive-hover rounded text-hive-text-secondary hover:text-hive-text transition-colors flex-shrink-0"
          title={isZh ? '向左滚动' : 'Scroll left'}
        >
          ‹
        </button>
      )}

      {/* TAB 容器 */}
      <div
        ref={tabContainerRef}
        className="flex gap-1.5 overflow-x-auto scrollbar-hide flex-1"
        onScroll={checkScroll}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {servers.map(server => {
          const statusDisplay = getStatusDisplay(server);
          const isSelected = selectedServerId === server.id;
          
          return (
            <button
              key={server.id}
              onClick={() => handleTabClick(server)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all flex-shrink-0
                ${isSelected 
                  ? 'bg-hive-primary/20 border-hive-primary text-hive-text' 
                  : 'bg-hive-surface border-hive-border text-hive-text-secondary hover:border-hive-text-secondary hover:text-hive-text'}
              `}
              title={server.error || server.name}
            >
              {/* 状态指示器 */}
              <span className={`text-xs font-bold ${statusDisplay.colorClass}`}>
                {statusDisplay.icon}
                {statusDisplay.label && (
                  <span className="ml-0.5">{statusDisplay.label}</span>
                )}
              </span>
              
              {/* Server 名称 */}
              <span className="text-sm whitespace-nowrap">
                {/* 服务类型图标 */}
                {server.serviceType === 'mcp-api' ? '🌐 ' : '📡 '}
                {server.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* 右箭头 */}
      {canScrollRight && (
        <button
          onClick={scrollRight}
          className="p-1 hover:bg-hive-hover rounded text-hive-text-secondary hover:text-hive-text transition-colors flex-shrink-0"
          title={isZh ? '向右滚动' : 'Scroll right'}
        >
          ›
        </button>
      )}

      {/* 刷新按钮 */}
      <button
        onClick={onRefresh}
        className="p-1.5 hover:bg-hive-hover rounded text-hive-text-secondary hover:text-hive-text transition-colors flex-shrink-0"
        title={isZh ? '刷新服务列表' : 'Refresh service list'}
      >
        🔄
      </button>

      {/* 添加按钮 */}
      <button
        onClick={onAddServer}
        className="p-1.5 hover:bg-hive-hover rounded text-hive-text-secondary hover:text-hive-text transition-colors flex-shrink-0 border border-dashed border-hive-border hover:border-hive-text-secondary"
        title={isZh ? '添加 MCP Server' : 'Add MCP Server'}
      >
        +
      </button>
    </div>
  );
}