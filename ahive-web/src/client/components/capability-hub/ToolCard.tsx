/**
 * ToolCard - 工具卡片组件
 * 
 * 显示单个 MCP 工具的可选卡片
 */

import type { MCPTool } from '@/shared';

interface ToolCardProps {
  tool: MCPTool;
  isSelected: boolean;
  onToggle: (toolName: string) => void;
  language?: 'zh' | 'en';
}

export function ToolCard({
  tool,
  isSelected,
  onToggle,
  language = 'zh'
}: ToolCardProps) {
  const isZh = language === 'zh';

  return (
    <button
      onClick={() => onToggle(tool.name)}
      className={`
        w-full p-3 rounded-lg border text-left transition-all
        ${isSelected
          ? 'bg-hive-primary/20 border-hive-primary text-hive-text'
          : 'bg-hive-surface border-hive-border text-hive-text-secondary hover:border-hive-text-secondary hover:text-hive-text'}
      `}
    >
      <div className="flex items-start gap-3">
        {/* 勾选框 */}
        <span
          className={`
            w-5 h-5 mt-0.5 rounded border flex items-center justify-center text-xs flex-shrink-0 transition-all
            ${isSelected
              ? 'bg-hive-primary border-hive-primary text-white'
              : 'border-gray-600 group-hover:border-gray-500'}
          `}
        >
          {isSelected ? '✓' : ''}
        </span>

        {/* 工具信息 */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-hive-text truncate">
            {tool.name}
          </div>
          <p className="text-xs text-hive-text-secondary mt-0.5 line-clamp-2">
            {tool.description || (isZh ? '暂无描述' : 'No description')}
          </p>
        </div>
      </div>
    </button>
  );
}