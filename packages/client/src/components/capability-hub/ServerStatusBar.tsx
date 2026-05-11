/**
 * ServerStatusBar - Server 状态栏组件
 * 
 * 显示当前选中 Server 的状态和操作按钮
 */

import { ServerTabData } from './ServerTabBar';

interface ServerStatusBarProps {
  server: ServerTabData | null;
  onStart?: (serverId: string) => void;
  onStop?: (serverId: string) => void;
  onRestart?: (serverId: string) => void;
  onRetry?: (serverId: string) => void;
  onViewLog?: (serverId: string) => void;
  isOperating?: boolean;
  language?: 'zh' | 'en';
}

export function ServerStatusBar({
  server,
  onStart,
  onStop,
  onRestart,
  onRetry,
  onViewLog,
  isOperating = false,
  language = 'zh'
}: ServerStatusBarProps) {
  const isZh = language === 'zh';

  if (!server) {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-hive-surface/50 border-b border-hive-border">
        <div className="text-sm text-hive-text-secondary">
          {isZh ? '请选择一个 Server' : 'Select a Server'}
        </div>
      </div>
    );
  }

  const renderStatus = () => {
    switch (server.status) {
      case 'running':
        return (
          <>
            <span className="text-green-400">●</span>
            <span className="text-sm text-hive-text">
              {isZh ? '运行中' : 'Running'} | {server.toolCount || 0} {isZh ? '个工具' : 'tools'}
            </span>
          </>
        );
      case 'error':
        return (
          <>
            <span className="text-red-400">✗</span>
            <span className="text-sm text-red-400">
              {isZh ? '启动失败' : 'Failed to start'}
              {server.error && `: ${server.error.slice(0, 50)}${server.error.length > 50 ? '...' : ''}`}
            </span>
          </>
        );
      case 'starting':
        return (
          <>
            <span className="text-yellow-400 animate-pulse">◐</span>
            <span className="text-sm text-yellow-400">
              {isZh ? '正在启动...' : 'Starting...'}
            </span>
          </>
        );
      case 'stopped':
        return (
          <>
            <span className="text-gray-500">○</span>
            <span className="text-sm text-hive-text-secondary">
              {isZh ? '已停止' : 'Stopped'}
            </span>
          </>
        );
      default:
        return (
          <span className="text-sm text-hive-text-secondary">
            {isZh ? '未知状态' : 'Unknown status'}
          </span>
        );
    }
  };

  const renderActions = () => {
    // 如果服务器状态是 starting，显示启动中提示（优先于 isOperating）
    if (server.status === 'starting') {
      return (
        <span className="text-sm text-hive-text-secondary animate-pulse">
          {isZh ? '启动中，请稍候...' : 'Starting, please wait...'}
        </span>
      );
    }
    
    if (isOperating) {
      return (
        <span className="text-sm text-hive-text-secondary animate-pulse">
          {isZh ? '处理中...' : 'Processing...'}
        </span>
      );
    }

    switch (server.status) {
      case 'running':
        return (
          <>
            <button
              onClick={() => onRestart?.(server.id)}
              className="px-3 py-1 text-xs bg-hive-surface border border-hive-border hover:border-hive-text-secondary rounded text-hive-text-secondary hover:text-hive-text transition-colors"
            >
              {isZh ? '重启' : 'Restart'}
            </button>
            <button
              onClick={() => onStop?.(server.id)}
              className="px-3 py-1 text-xs bg-red-500/20 border border-red-500/50 hover:bg-red-500/30 rounded text-red-400 transition-colors"
            >
              {isZh ? '停止' : 'Stop'}
            </button>
          </>
        );
      case 'error':
        return (
          <>
            {onViewLog && (
              <button
                onClick={() => onViewLog(server.id)}
                className="px-3 py-1 text-xs bg-hive-surface border border-hive-border hover:border-hive-text-secondary rounded text-hive-text-secondary hover:text-hive-text transition-colors"
              >
                {isZh ? '查看日志' : 'View Log'}
              </button>
            )}
            <button
              onClick={() => onRetry?.(server.id)}
              className="px-3 py-1 text-xs bg-hive-primary/20 border border-hive-primary/50 hover:bg-hive-primary/30 rounded text-hive-primary transition-colors"
            >
              {isZh ? '重试' : 'Retry'}
            </button>
          </>
        );
      case 'stopped':
        return (
          <button
            onClick={() => onStart?.(server.id)}
            className="px-3 py-1 text-xs bg-green-500/20 border border-green-500/50 hover:bg-green-500/30 rounded text-green-400 transition-colors"
          >
            {isZh ? '启动' : 'Start'}
          </button>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-hive-surface/50 border-b border-hive-border">
      {/* 左侧状态 */}
      <div className="flex items-center gap-2">
        {renderStatus()}
      </div>
      
      {/* 右侧操作按钮 */}
      <div className="flex items-center gap-2">
        {renderActions()}
      </div>
    </div>
  );
}