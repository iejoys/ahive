/**
 * EmptyState - 空状态引导组件
 * 
 * 显示各种空状态的引导提示
 */

interface EmptyStateProps {
  type: 'no-server' | 'no-tools' | 'no-agent' | 'loading';
  onAction?: () => void;
  language?: 'zh' | 'en';
}

export function EmptyState({ type, onAction, language = 'zh' }: EmptyStateProps) {
  const isZh = language === 'zh';

  const states = {
    'no-server': {
      icon: '🔌',
      title: isZh ? '暂无 MCP Server 配置' : 'No MCP Server configured',
      description: isZh
        ? 'MCP Server 可以让 Agent 使用外部工具能力'
        : 'MCP Server enables Agents to use external tools',
      actionText: isZh ? '前往设置面板添加 Server' : 'Add Server in Settings'
    },
    'no-tools': {
      icon: '🔧',
      title: isZh ? '暂无可用工具' : 'No tools available',
      description: isZh
        ? '当前 Server 没有提供任何工具'
        : 'The current Server does not provide any tools',
      actionText: undefined
    },
    'no-agent': {
      icon: '👈',
      title: isZh ? '请选择一个智能体' : 'Select an Agent',
      description: isZh
        ? '从左侧选择一个智能体来配置其技能'
        : 'Select an Agent from the left to configure skills',
      actionText: undefined
    },
    'loading': {
      icon: '⏳',
      title: isZh ? '加载中...' : 'Loading...',
      description: isZh
        ? '正在获取工具列表'
        : 'Fetching tool list',
      actionText: undefined
    }
  };

  const state = states[type];

  return (
    <div className="flex flex-col items-center justify-center h-full text-hive-text-secondary p-8">
      <div className="text-5xl mb-4">{state.icon}</div>
      <h3 className="text-lg font-medium text-hive-text mb-2">{state.title}</h3>
      <p className="text-sm text-center max-w-xs mb-4">{state.description}</p>
      {state.actionText && onAction && (
        <button
          onClick={onAction}
          className="px-4 py-2 bg-hive-primary hover:bg-hive-primary-hover rounded text-white text-sm font-medium transition-colors"
        >
          {state.actionText}
        </button>
      )}
    </div>
  );
}