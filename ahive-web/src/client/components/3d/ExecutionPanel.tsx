import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';

export interface ExecutionLog {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  type: 'tool_call' | 'tool_result' | 'message' | 'thinking' | 'error' | 'system' | 'agent_chat';
  content: string;
  details?: Record<string, any>;
}

interface ExecutionPanelProps {
  onClear?: () => void;
}

export function ExecutionPanel({ onClear }: ExecutionPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [width, setWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  
  // 从 Store 读取执行日志（全局累积）
  const executionLogs = useStore((state) => state.executionLogs) || [];
  const clearExecutionLogs = useStore((state) => state.clearExecutionLogs);
  
  // 调试日志
  useEffect(() => {
    console.log('[ExecutionPanel] executionLogs updated:', executionLogs.length, 'logs');
  }, [executionLogs]);
  
  const { language } = useStore();
  const isZh = language === 'zh';

  // 清空日志
  const handleClear = () => {
    clearExecutionLogs();
    onClear?.();
  };
  
  // 自动滚动
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [executionLogs, autoScroll]);
  
  // 检测用户滚动
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    setAutoScroll(isAtBottom);
  };
  
  // 拖拽调整宽度
  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const delta = dragStartX.current - e.clientX;
      const newWidth = Math.max(280, Math.min(600, dragStartWidth.current + delta));
      setWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);
  
  // 格式化时间
  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  // 获取类型图标和颜色
  const getTypeStyle = (type: ExecutionLog['type']) => {
    switch (type) {
      case 'tool_call': return { icon: '🔧', color: 'text-blue-400', bg: 'bg-blue-900/30' };
      case 'tool_result': return { icon: '✅', color: 'text-green-400', bg: 'bg-green-900/30' };
      case 'message': return { icon: '💬', color: 'text-purple-400', bg: 'bg-purple-900/30' };
      case 'thinking': return { icon: '🤔', color: 'text-yellow-400', bg: 'bg-yellow-900/30' };
      case 'error': return { icon: '❌', color: 'text-red-400', bg: 'bg-red-900/30' };
      case 'system': return { icon: '⚙️', color: 'text-gray-400', bg: 'bg-gray-800/50' };
      case 'agent_chat': return { icon: '🗣️', color: 'text-cyan-400', bg: 'bg-cyan-900/30' };
      default: return { icon: '📄', color: 'text-gray-400', bg: 'bg-gray-800/50' };
    }
  };
  
  // 收缩状态：只显示展开按钮
  if (isCollapsed) {
    return (
      <div 
        className="absolute right-0 top-16 bottom-48 w-10 bg-gray-900/95 border-l border-gray-700 flex flex-col items-center py-3 cursor-pointer hover:bg-gray-800/95 transition-colors"
        onClick={() => setIsCollapsed(false)}
        style={{ zIndex: 100 }}
      >
        <div className="text-gray-400 text-lg mb-2">◀</div>
        <div className="text-gray-500 text-xs writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>
          {isZh ? '执行日志' : 'Logs'}
        </div>
        {executionLogs.length > 0 && (
          <div className="mt-2 px-2 py-1 bg-indigo-600 rounded-full text-xs text-white">
            {executionLogs.length > 99 ? '99+' : executionLogs.length}
          </div>
        )}
      </div>
    );
  }
  
  return (
    <div 
      className="absolute right-0 top-16 bottom-48 bg-gray-900/95 border-l border-gray-700 flex flex-col overflow-hidden"
      style={{ width: `${width}px`, zIndex: 100 }}
    >
      {/* 左边缘拖拽手柄 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-indigo-500 transition-colors"
        style={{ backgroundColor: isDragging ? '#6366f1' : 'transparent' }}
        onMouseDown={handleDragStart}
      />
      
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-2">
          <span className="text-gray-300">📋</span>
          <span className="text-sm font-medium text-white">
            {isZh ? '执行日志' : 'Execution Log'}
          </span>
          {executionLogs.length > 0 && (
            <span className="px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
              {executionLogs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {handleClear && executionLogs.length > 0 && (
            <button
              onClick={handleClear}
              className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-gray-300"
              title={isZh ? '清空' : 'Clear'}
            >
              🗑️
            </button>
          )}
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-gray-300"
            title={isZh ? '收起' : 'Collapse'}
          >
            ▶
          </button>
        </div>
      </div>
      
      {/* 日志内容 */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={handleScroll}
      >
        {executionLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            {isZh ? '暂无执行记录' : 'No execution logs'}
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {executionLogs.map((log) => {
              const style = getTypeStyle(log.type);
              return (
                <div 
                  key={log.id}
                  className={`rounded p-2 ${style.bg} border border-gray-700/50`}
                >
                  {/* 头部：时间 + 智能体 + 类型 */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs">{style.icon}</span>
                    <span className="text-xs text-gray-500">{formatTime(log.timestamp)}</span>
                    <span className="text-xs text-indigo-400 font-medium">[{log.agentName}]</span>
                  </div>
                  
                  {/* 内容 */}
                  <div className={`text-xs ${style.color} break-words`} style={{ whiteSpace: 'pre-wrap' }}>
                    {log.content.length > 500 
                      ? log.content.substring(0, 500) + '...' 
                      : log.content
                    }
                  </div>
                  
                  {/* 详情（可展开） */}
                  {log.details && Object.keys(log.details).length > 0 && (
                    <details className="mt-1">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                        {isZh ? '详情' : 'Details'}
                      </summary>
                      <pre className="mt-1 p-1 bg-gray-800 rounded text-xs text-gray-400 overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
      
      {/* 底部状态栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-700 bg-gray-800/50 text-xs text-gray-500">
        <span>
          {autoScroll 
            ? (isZh ? '自动滚动' : 'Auto-scroll') 
            : (isZh ? '已暂停滚动' : 'Scroll paused')
          }
        </span>
        {!autoScroll && (
          <button 
            onClick={() => {
              setAutoScroll(true);
              logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-400"
          >
            {isZh ? '跳到最新' : 'Jump to latest'}
          </button>
        )}
      </div>
    </div>
  );
}

export default ExecutionPanel;