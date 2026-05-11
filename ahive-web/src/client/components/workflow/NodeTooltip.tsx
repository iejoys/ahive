/**
 * 节点工具提示浮层组件
 * 可复用的悬停提示组件，支持多种位置和样式
 */

import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// ========== 类型定义 ==========

/** 提示位置 */
export type TooltipPosition = 'top' | 'right' | 'bottom' | 'left' | 'auto';

/** 提示内容 */
export interface TooltipContent {
  /** 标题 */
  title: string;
  /** 图标 */
  icon?: string;
  /** 颜色主题 */
  color?: string;
  /** 分类标签 */
  category?: string;
  /** 简介 */
  description: string;
  /** 使用场景列表 */
  useCases?: string[];
  /** 配置要点 */
  configTips?: string;
  /** 快捷键 */
  shortcut?: string;
}

export interface NodeTooltipProps {
  /** 提示内容 (与 node 二选一) */
  content?: TooltipContent | null;
  /** 节点数据 (与 content 二选一) */
  node?: {
    name: string;
    icon: string;
    color: string;
    description: string;
    useCases?: string[];
    configTips?: string;
    shortcut?: string;
  } | null;
  /** 触发元素的引用 */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 固定位置 (auto 时自动计算) */
  position?: TooltipPosition;
  /** 最大宽度 */
  maxWidth?: number;
  /** 自定义类名 */
  className?: string;
  /** 显示遮罩层 (默认 false，避免遮挡工具箱) */
  showBackdrop?: boolean;
  /** 鼠标进入回调 */
  onMouseEnter?: () => void;
  /** 鼠标离开回调 */
  onMouseLeave?: () => void;
  /** 语言 */
  language?: 'zh' | 'en';
}

// ========== 主组件 ==========

export function NodeTooltip({
  content: contentProp,
  node,
  anchorRef,
  visible,
  onClose,
  position = 'auto',
  maxWidth = 320,
  className = '',
  showBackdrop = false,
  onMouseEnter,
  onMouseLeave,
}: NodeTooltipProps) {
  // 兼容 node 和 content 两种属性
  const content: TooltipContent | null = contentProp || (node ? {
    title: node.name,
    icon: node.icon,
    color: node.color,
    description: node.description,
    useCases: node.useCases,
    configTips: node.configTips,
    shortcut: node.shortcut,
  } : null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [computedPosition, setComputedPosition] = useState<'top' | 'right' | 'bottom' | 'left'>('right');
  
  // 计算最佳显示位置
  useEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return;
    
    if (position !== 'auto') {
      setComputedPosition(position);
      return;
    }
    
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // 计算各方向可用空间
    const spaceRight = viewportWidth - anchorRect.right;
    const spaceLeft = anchorRect.left;
    const spaceTop = anchorRect.top;
    const spaceBottom = viewportHeight - anchorRect.bottom;
    
    // 优先级: right > left > bottom > top
    if (spaceRight >= tooltipRect.width + 20) {
      setComputedPosition('right');
    } else if (spaceLeft >= tooltipRect.width + 20) {
      setComputedPosition('left');
    } else if (spaceBottom >= tooltipRect.height + 20) {
      setComputedPosition('bottom');
    } else if (spaceTop >= tooltipRect.height + 20) {
      setComputedPosition('top');
    } else {
      // 默认右侧，即使空间不足
      setComputedPosition('right');
    }
  }, [visible, anchorRef, position]);
  
  // 点击空白处关闭
  useEffect(() => {
    if (!visible || !showBackdrop) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    
    // 延迟添加监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [visible, onClose, anchorRef, showBackdrop]);
  
  // ESC 键关闭
  useEffect(() => {
    if (!visible) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);
  
  if (!visible || !content) return null;
  
  // 计算位置样式
  const getPositionStyle = (): React.CSSProperties => {
    if (!anchorRef.current) return {};
    
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const tooltipWidth = maxWidth;
    const tooltipHeight = 280; // 预估高度
    
    switch (computedPosition) {
      case 'right':
        return {
          position: 'fixed',
          left: anchorRect.right + 12,
          top: Math.max(16, Math.min(anchorRect.top, window.innerHeight - tooltipHeight - 16)),
          maxWidth: tooltipWidth,
        };
      case 'left':
        return {
          position: 'fixed',
          right: window.innerWidth - anchorRect.left + 12,
          top: Math.max(16, Math.min(anchorRect.top, window.innerHeight - tooltipHeight - 16)),
          maxWidth: tooltipWidth,
        };
      case 'bottom':
        return {
          position: 'fixed',
          left: Math.max(16, Math.min(anchorRect.left, window.innerWidth - tooltipWidth - 16)),
          top: anchorRect.bottom + 12,
          maxWidth: tooltipWidth,
        };
      case 'top':
        return {
          position: 'fixed',
          left: Math.max(16, Math.min(anchorRect.left, window.innerWidth - tooltipWidth - 16)),
          bottom: window.innerHeight - anchorRect.top + 12,
          maxWidth: tooltipWidth,
        };
    }
  };
  
  const color = content?.color || '#6366f1';
   
  return createPortal(
    <>
      {/* 遮罩层 */}
      {showBackdrop && (
        <div 
          className="fixed inset-0 z-40"
          onClick={onClose}
        />
      )}
      
      {/* 提示框 */}
      <div
        ref={tooltipRef}
        className={`z-50 animate-fadeIn ${className}`}
        style={getPositionStyle()}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="bg-gray-800 rounded-lg border border-gray-600 shadow-xl overflow-hidden">
          {/* 标题栏 */}
          <div 
            className="px-4 py-2.5 flex items-center gap-2"
            style={{ backgroundColor: color + '15' }}
          >
            {content.icon && (
              <span className="text-xl">{content.icon}</span>
            )}
            <span className="text-white font-medium">{content.title}</span>
            {content.category && (
              <span 
                className="ml-auto text-xs px-2 py-0.5 rounded"
                style={{ backgroundColor: color + '25', color }}
              >
                {content.category}
              </span>
            )}
          </div>
          
          {/* 内容区 */}
          <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
            {/* 简介 */}
            <div>
              <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                <span>📖</span> 简介
              </div>
              <div className="text-white text-sm leading-relaxed">
                {content.description}
              </div>
            </div>
            
            {/* 使用场景 */}
            {content.useCases && content.useCases.length > 0 && (
              <div>
                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                  <span>💡</span> 使用场景
                </div>
                <ul className="text-gray-300 text-sm space-y-1">
                  {content.useCases.map((uc, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-green-400 mt-0.5">•</span>
                      <span>{uc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* 配置要点 */}
            {content.configTips && (
              <div>
                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                  <span>⚙️</span> 配置要点
                </div>
                <div className="bg-gray-900 rounded p-2 text-xs text-gray-300 font-mono leading-relaxed">
                  {content.configTips}
                </div>
              </div>
            )}
            
            {/* 快捷键 */}
            {content.shortcut && (
              <div className="pt-1 border-t border-gray-700">
                <span className="text-xs text-gray-500">
                  ⌨️ 快捷键: 
                  <kbd className="ml-1 bg-gray-700 px-1.5 py-0.5 rounded text-gray-300">
                    {content.shortcut}
                  </kbd>
                </span>
              </div>
            )}
          </div>
          
          {/* 底部提示 */}
          <div className="px-4 py-2 bg-gray-900/50 text-xs text-gray-500 flex justify-between items-center">
            <span>拖拽到画布使用</span>
            <button 
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              关闭 (Esc)
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// ========== 简化版 Hook ==========

/**
 * 使用节点提示的 Hook
 * 简化组件中的提示状态管理
 */
export function useNodeTooltip() {
  const [tooltipState, setTooltipState] = useState<{
    visible: boolean;
    content: TooltipContent | null;
    anchorRef: React.RefObject<HTMLElement | null>;
  }>({
    visible: false,
    content: null,
    anchorRef: { current: null },
  });
  
  const showTooltip = (
    content: TooltipContent,
    anchorElement: HTMLElement
  ) => {
    setTooltipState({
      visible: true,
      content,
      anchorRef: { current: anchorElement },
    });
  };
  
  const hideTooltip = () => {
    setTooltipState(prev => ({ ...prev, visible: false }));
  };
  
  return {
    tooltipState,
    showTooltip,
    hideTooltip,
    TooltipComponent: tooltipState.visible ? (
      <NodeTooltip
        content={tooltipState.content}
        anchorRef={tooltipState.anchorRef}
        visible={tooltipState.visible}
        onClose={hideTooltip}
      />
    ) : null,
  };
}

// ========== 导出 ==========

export default NodeTooltip;