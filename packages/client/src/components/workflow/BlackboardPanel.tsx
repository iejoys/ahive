/**
 * 黑板监控面板 V2
 * 实时显示共享变量、任务状态、执行历史
 * 支持变量的编辑和删除
 * 
 * v2.0 新增:
 * - 工作流变量和全局变量分离（选项卡切换）
 * - 工作流切换时自动切换变量数据
 * - 可收缩设计 (collapsed/normal/expanded)
 * - 位置可选 (left/right/bottom)
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';
import { blackboard } from '../../scheduler';
import type { VariableEntry, BlackboardEvent, VariableScope } from '../../scheduler';

// ========== 面板状态类型 ==========

/** 面板显示状态 */
export type PanelState = 'collapsed' | 'normal' | 'expanded';

/** 面板位置 */
export type PanelPosition = 'left' | 'right' | 'bottom';

/** 变量选项卡类型 */
type VariableTab = 'workflow' | 'global';

interface BlackboardPanelProps {
  className?: string;
  /** 初始状态 */
  defaultState?: PanelState;
  /** 面板位置 */
  position?: PanelPosition;
  /** 状态变化回调 */
  onStateChange?: (state: PanelState) => void;
}

/** 系统变量前缀 - 这些变量由系统自动产生，对用户不可见 */
const SYSTEM_PREFIXES = [
  'intent_',          // 意图解析器
  'plan_',            // 动态规划器
  'vote_',            // 投票管理器
  'vote_result_',     // 投票结果
  'swarm_',           // Agent 集群
  'retry_',           // 重试机制
  'recovery_',        // 故障恢复
  'failure_',         // 执行失败记录
  'agent_health_',    // Agent 健康状态
  'cached_',          // 缓存数据（如部门缓存）
];

/** 判断是否为系统变量 */
function isSystemVariable(key: string): boolean {
  return SYSTEM_PREFIXES.some(prefix => key.startsWith(prefix));
}

// ========== 面板宽度配置 ==========

const PANEL_WIDTHS: Record<PanelState, number> = {
  collapsed: 48,
  normal: 320,
  expanded: 480,
};

export function BlackboardPanel({ 
  className = '', 
  defaultState = 'normal',
  position = 'right',
  onStateChange,
}: BlackboardPanelProps) {
  const { language, currentWorkflowId, workflows, executionInstance } = useStore();
  const dialog = useDialog();
  const [panelState, setPanelState] = useState<PanelState>(defaultState);
  const [activeTab, setActiveTab] = useState<VariableTab>('workflow');
  const [activeSubTab, setActiveSubTab] = useState<'variables' | 'events' | 'stats'>('variables');
  const [workflowVariables, setWorkflowVariables] = useState<VariableEntry[]>([]);
  const [globalVariables, setGlobalVariables] = useState<VariableEntry[]>([]);
  const [events, setEvents] = useState<BlackboardEvent[]>([]);
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [showSystemVars, setShowSystemVars] = useState(false);
  
  // 获取当前工作流信息
  const currentWorkflow = workflows.find(w => w.id === currentWorkflowId);
  const isExecuting = executionInstance?.status === 'running';
  
  // 更新变量列表
  const refreshVariables = useCallback(() => {
    // 获取工作流变量
    const wfVars = blackboard.getWorkflowVariables();
    setWorkflowVariables(wfVars);
    
    // 获取全局变量
    const gVars = blackboard.getAllGlobalVariables();
    setGlobalVariables(gVars);
  }, []);
  
  // 监听工作流切换
  useEffect(() => {
    // 切换活动工作流
    blackboard.setActiveWorkflow(currentWorkflowId || null);
    refreshVariables();
  }, [currentWorkflowId, refreshVariables]);
  
  // 订阅黑板事件
  useEffect(() => {
    refreshVariables();
    
    const unsubscribe = blackboard.subscribeEvent((event) => {
      setEvents(prev => [event, ...prev].slice(0, 100));
      if (event.type === 'variable-set' || event.type === 'variable-deleted') {
        refreshVariables();
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [refreshVariables]);
  
  // 切换变量展开状态
  const toggleExpand = (key: string) => {
    setExpandedVars(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  
  // 删除变量
  const handleDelete = async (key: string, scope: VariableScope) => {
    const isSystem = isSystemVariable(key);
    const confirmMsg = isSystem 
      ? (language === 'zh' ? `确定要删除系统变量 "${key}" 吗？可能会影响正在运行的任务。` : `Delete system variable "${key}"? May affect running tasks.`)
      : (language === 'zh' ? `确定要删除变量 "${key}" 吗？` : `Delete variable "${key}"?`);
    
    const confirmed = await dialog.confirm(confirmMsg, language === 'zh' ? '删除确认' : 'Confirm Delete');
    if (confirmed) {
      if (scope === 'global') {
        blackboard.deleteGlobalVariable(key);
      } else {
        blackboard.deleteWorkflowVariable(key);
      }
      refreshVariables();
    }
  };
  
  // 开始编辑
  const startEdit = (entry: VariableEntry) => {
    setEditingKey(entry.key);
    setEditValue(typeof entry.value === 'object' 
      ? JSON.stringify(entry.value, null, 2) 
      : String(entry.value ?? ''));
  };
  
  // 保存编辑
  const saveEdit = (scope: VariableScope) => {
    if (!editingKey) return;
    
    try {
      // 尝试解析 JSON
      let value: unknown;
      try {
        value = JSON.parse(editValue);
      } catch {
        // 不是 JSON，作为字符串保存
        value = editValue;
      }
      
      const existing = scope === 'global' 
        ? blackboard.getGlobalVariable(editingKey)
        : blackboard.getWorkflowVariable(editingKey);
      
      if (scope === 'global') {
        blackboard.setGlobalVariable(editingKey, value, { 
          owner: existing?.owner || 'user',
          description: existing?.description,
        });
      } else {
        blackboard.setWorkflowVariable(editingKey, value, undefined, { 
          owner: existing?.owner || 'user',
          description: existing?.description,
        });
      }
      
      setEditingKey(null);
      setEditValue('');
      refreshVariables();
    } catch (e) {
      alert(language === 'zh' ? '保存失败：值格式错误' : 'Save failed: Invalid value format');
    }
  };
  
  // 取消编辑
  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };
  
  // 清空当前选项卡的变量
  const handleClear = async () => {
    const scopeName = activeTab === 'workflow' 
      ? (language === 'zh' ? '工作流变量' : 'workflow variables')
      : (language === 'zh' ? '全局变量' : 'global variables');
    
    const confirmed = await dialog.confirm(
      language === 'zh' 
        ? `确定要清空${scopeName}吗？` 
        : `Clear ${scopeName}?`,
      language === 'zh' ? '清空确认' : 'Confirm Clear'
    );
    if (confirmed) {
      if (activeTab === 'workflow') {
        blackboard.clearWorkflowVariables();
      } else {
        // 清空全局变量需要逐个删除
        globalVariables.forEach(v => blackboard.deleteGlobalVariable(v.key));
      }
      refreshVariables();
    }
  };
  
  // 获取变量类型图标
  const getTypeIcon = (value: unknown): string => {
    if (value === null || value === undefined) return '∅';
    if (Array.isArray(value)) return '[]';
    if (typeof value === 'object') {
      // 检查是否为文件引用
      if (value && typeof value === 'object' && 'path' in value && 'type' in value) {
        return '📄'; // 文件引用图标
      }
      return '{}';
    }
    if (typeof value === 'string') return '"';
    if (typeof value === 'number') return '#';
    if (typeof value === 'boolean') return '◐';
    return '?';
  };
  
  // 检查是否为文件引用
  const isFileReference = (value: unknown): boolean => {
    return value !== null && 
           typeof value === 'object' && 
           value !== null &&
           'path' in value && 
           'type' in value;
  };
  
  // 格式化值显示
  const formatValue = (value: unknown, expanded: boolean): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    
    if (typeof value === 'string') {
      return expanded ? value : value.length > 50 ? `${value.slice(0, 50)}...` : value;
    }
    
    if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value, null, expanded ? 2 : 0);
        return expanded ? json : json.length > 100 ? `${json.slice(0, 100)}...` : json;
      } catch {
        return '[Object]';
      }
    }
    
    return String(value);
  };
  
  // 获取事件类型颜色
  const getEventColor = (type: BlackboardEvent['type']): string => {
    switch (type) {
      case 'variable-set': return 'text-green-400';
      case 'variable-deleted': return 'text-red-400';
      case 'task-created': return 'text-blue-400';
      case 'task-completed': return 'text-green-400';
      case 'task-failed': return 'text-red-400';
      case 'agent-state-changed': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };
  
  const stats = blackboard.getStats();
  
  // 过滤变量
  const currentVariables = activeTab === 'workflow' ? workflowVariables : globalVariables;
  const filteredVariables = showSystemVars 
    ? currentVariables 
    : currentVariables.filter(v => !isSystemVariable(v.key));
  
  const userVarCount = currentVariables.filter(v => !isSystemVariable(v.key)).length;
  const systemVarCount = currentVariables.filter(v => isSystemVariable(v.key)).length;
  
  const t = {
    zh: {
      sharedBlackboard: '共享黑板',
      workflowVariables: '工作流变量',
      globalVariables: '全局变量',
      currentWorkflow: '当前工作流',
      noWorkflow: '未选择工作流',
      executing: '执行中',
      paused: '已暂停',
      completed: '已完成',
      refresh: '刷新',
      clear: '清空',
      variables: '变量',
      events: '事件',
      stats: '统计',
      noVariables: '暂无变量',
      globalVariablesTip: '这些变量在所有工作流中共享，适合存储项目配置、API密钥等',
      subscribers: '订阅者',
      showSystemVars: '显示系统变量',
      userVars: '用户',
      systemVars: '系统',
      key: '变量名',
      value: '值',
      set: '设置',
      edit: '编辑',
      delete: '删除',
      save: '保存',
      cancel: '取消',
      variableCount: '变量数量',
      taskCount: '任务数量',
      agentCount: 'Agent 数量',
      eventCount: '事件数量',
      expand: '展开',
      collapse: '收起',
      addVariable: '添加变量',
      realTimeSync: '实时同步中',
      lastUpdate: '最后更新',
    },
    en: {
      sharedBlackboard: 'Shared Blackboard',
      workflowVariables: 'Workflow',
      globalVariables: 'Global',
      currentWorkflow: 'Current Workflow',
      noWorkflow: 'No workflow selected',
      executing: 'Executing',
      paused: 'Paused',
      completed: 'Completed',
      refresh: 'Refresh',
      clear: 'Clear',
      variables: 'Variables',
      events: 'Events',
      stats: 'Stats',
      noVariables: 'No variables',
      globalVariablesTip: 'These variables are shared across all workflows, suitable for project configs, API keys, etc.',
      subscribers: 'Subscribers',
      showSystemVars: 'Show system variables',
      userVars: 'User',
      systemVars: 'System',
      key: 'Key',
      value: 'Value',
      set: 'Set',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      variableCount: 'Variables',
      taskCount: 'Tasks',
      agentCount: 'Agents',
      eventCount: 'Events',
      expand: 'Expand',
      collapse: 'Collapse',
      addVariable: 'Add Variable',
      realTimeSync: 'Real-time sync',
      lastUpdate: 'Last update',
    },
  }[language];
  
  // 切换面板状态
  const togglePanelState = () => {
    const states: PanelState[] = ['collapsed', 'normal', 'expanded'];
    const currentIndex = states.indexOf(panelState);
    const nextIndex = (currentIndex + 1) % states.length;
    const newState = states[nextIndex];
    setPanelState(newState);
    onStateChange?.(newState);
  };
  
  // 展开面板
  const expandPanel = () => {
    setPanelState('normal');
    onStateChange?.('normal');
  };
  
  // 获取位置样式
  const getPositionStyle = (): React.CSSProperties => {
    const width = PANEL_WIDTHS[panelState];
    
    switch (position) {
      case 'left':
        return { left: 0, top: '50%', transform: 'translateY(-50%)' };
      case 'right':
        return { right: 0, top: '50%', transform: 'translateY(-50%)' };
      case 'bottom':
        return { bottom: 0, left: '50%', transform: 'translateX(-50%)' };
    }
  };
  
  // 获取执行状态显示
  const getExecutionStatus = () => {
    if (!executionInstance) return null;
    
    const statusMap: Record<string, { color: string; text: string }> = {
      running: { color: 'text-green-400', text: t.executing },
      paused: { color: 'text-yellow-400', text: t.paused },
      completed: { color: 'text-blue-400', text: t.completed },
      failed: { color: 'text-red-400', text: 'Failed' },
    };
    
    const status = statusMap[executionInstance.status] || { color: 'text-gray-400', text: executionInstance.status };
    
    return (
      <div className={`flex items-center gap-1 text-xs ${status.color}`}>
        <span className="animate-pulse">●</span>
        <span>{status.text}</span>
      </div>
    );
  };
  
  // 收缩状态 - 只显示图标
  if (panelState === 'collapsed') {
    return (
      <div 
        className={`fixed z-40 bg-gray-900 border border-gray-700 cursor-pointer hover:bg-gray-800 transition-all ${className}`}
        style={{ 
          ...getPositionStyle(),
          width: PANEL_WIDTHS.collapsed,
          borderRadius: position === 'left' ? '0 8px 8px 0' : position === 'right' ? '8px 0 0 8px' : '8px 8px 0 0',
        }}
        onClick={expandPanel}
        title={t.expand}
      >
        <div className="flex flex-col items-center justify-center py-4">
          <span className="text-2xl">📋</span>
          <span className="text-gray-400 text-xs mt-2 writing-mode-vertical">
            {userVarCount > 0 && `${userVarCount}`}
          </span>
        </div>
      </div>
    );
  }
  
  // 展开状态
  
  return (
    <div 
      className={`fixed z-40 bg-gray-900 border border-gray-700 transition-all duration-300 flex flex-col ${className}`}
      style={{ 
        ...getPositionStyle(),
        width: PANEL_WIDTHS[panelState],
        borderRadius: position === 'left' ? '0 8px 8px 0' : position === 'right' ? '8px 0 0 8px' : '8px 8px 0 0',
        maxHeight: '80vh',
      }}
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0">
        <h3 className="text-white font-medium flex items-center gap-2 text-sm">
          <span>📋</span>
          {t.sharedBlackboard}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={togglePanelState}
            className="text-gray-400 hover:text-white px-1 py-1 text-xs"
            title={panelState === 'expanded' ? t.collapse : t.expand}
          >
            {panelState === 'expanded' ? '⊐' : '⊏'}
          </button>
          <button
            onClick={() => {
              setPanelState('collapsed');
              onStateChange?.('collapsed');
            }}
            className="text-gray-400 hover:text-white px-1 py-1 text-xs"
            title={t.collapse}
          >
            ◀
          </button>
          <button
            onClick={refreshVariables}
            className="text-gray-400 hover:text-white px-1 py-1 text-xs"
            title={t.refresh}
          >
            🔄
          </button>
          <button
            onClick={handleClear}
            className="text-red-400 hover:text-red-300 px-1 py-1 text-xs"
            title={t.clear}
          >
            🗑️
          </button>
        </div>
      </div>
      
      {/* 变量空间选项卡 */}
      <div className="flex border-b border-gray-700 shrink-0">
        <button
          onClick={() => setActiveTab('workflow')}
          className={`flex-1 px-3 py-2 text-sm flex items-center justify-center gap-1 ${
            activeTab === 'workflow'
              ? 'text-white bg-gray-800 border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
          }`}
        >
          <span>🔄</span>
          {t.workflowVariables}
          <span className="text-xs text-gray-500">({workflowVariables.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('global')}
          className={`flex-1 px-3 py-2 text-sm flex items-center justify-center gap-1 ${
            activeTab === 'global'
              ? 'text-white bg-gray-800 border-b-2 border-green-500'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
          }`}
        >
          <span>🌐</span>
          {t.globalVariables}
          <span className="text-xs text-gray-500">({globalVariables.length})</span>
        </button>
      </div>
      
      {/* 工作流信息栏（仅工作流变量选项卡显示） */}
      {activeTab === 'workflow' && (
        <div className="px-3 py-2 bg-gray-800/50 border-b border-gray-700 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs">{t.currentWorkflow}:</span>
              <span className="text-white text-sm font-medium">
                {currentWorkflow?.name || t.noWorkflow}
              </span>
            </div>
            {getExecutionStatus()}
          </div>
        </div>
      )}
      
      {/* 全局变量提示（仅全局变量选项卡显示） */}
      {activeTab === 'global' && (
        <div className="px-3 py-2 bg-gray-800/50 border-b border-gray-700 shrink-0">
          <p className="text-gray-400 text-xs">{t.globalVariablesTip}</p>
        </div>
      )}
      
      {/* 子选项卡 */}
      <div className="flex border-b border-gray-700 shrink-0">
        <button
          onClick={() => setActiveSubTab('variables')}
          className={`px-3 py-1.5 text-xs ${
            activeSubTab === 'variables'
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          {t.variables}
        </button>
        <button
          onClick={() => setActiveSubTab('events')}
          className={`px-3 py-1.5 text-xs ${
            activeSubTab === 'events'
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          {t.events} ({events.length})
        </button>
        <button
          onClick={() => setActiveSubTab('stats')}
          className={`px-3 py-1.5 text-xs ${
            activeSubTab === 'stats'
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          {t.stats}
        </button>
      </div>
      
      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {activeSubTab === 'variables' && (
          <div className="space-y-2">
            {/* 过滤选项 */}
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={showSystemVars}
                onChange={(e) => setShowSystemVars(e.target.checked)}
                className="rounded"
              />
              {t.showSystemVars}
              <span className="text-gray-500">({t.userVars}: {userVarCount}, {t.systemVars}: {systemVarCount})</span>
            </label>
            
            {filteredVariables.length === 0 ? (
              <div className="text-gray-500 text-center py-4 text-sm">
                {t.noVariables}
              </div>
            ) : (
              filteredVariables.map((entry) => {
                const isExpanded = expandedVars.has(entry.key);
                const isSystem = isSystemVariable(entry.key);
                const isEditing = editingKey === entry.key;
                const scope: VariableScope = activeTab;
                
                return (
                  <div
                    key={entry.key}
                    className={`bg-gray-800 rounded p-2 ${isSystem ? 'border-l-2 border-yellow-600' : ''}`}
                  >
                    {/* 变量名和操作 */}
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 font-mono text-xs">
                        {getTypeIcon(entry.value)}
                      </span>
                      <span 
                        className={`font-medium cursor-pointer text-sm ${isSystem ? 'text-yellow-400' : 'text-indigo-400'}`}
                        onClick={() => toggleExpand(entry.key)}
                      >
                        {entry.key}
                      </span>
                      <span className="text-gray-500 text-xs">v{entry.version}</span>
                      {entry.owner && (
                        <span className="text-gray-600 text-xs">
                          [{entry.owner}]
                        </span>
                      )}
                      <span className="text-gray-500 text-xs ml-auto">
                        {new Date(entry.updatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    
                    {/* 值显示或编辑 */}
                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full bg-gray-700 text-white text-xs font-mono rounded p-2 border border-gray-600 min-h-[60px]"
                          rows={3}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(scope)}
                            className="bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs"
                          >
                            {t.save}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs"
                          >
                            {t.cancel}
                          </button>
                        </div>
                      </div>
                    ) : isFileReference(entry.value) ? (
                      // 文件引用特殊显示
                      <div 
                        className="mt-1 text-xs cursor-pointer"
                        onClick={() => toggleExpand(entry.key)}
                      >
                        <div className="flex items-center gap-2 text-gray-300">
                          <span className="text-green-400">📁</span>
                          <span className="font-mono">{(entry.value as any).path}</span>
                        </div>
                        {(entry.value as any).description && (
                          <div className="text-gray-500 mt-1">
                            {(entry.value as any).description}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div 
                        className={`mt-1 font-mono text-xs ${isExpanded ? 'whitespace-pre-wrap' : 'truncate'} cursor-pointer`}
                        onClick={() => toggleExpand(entry.key)}
                      >
                        <span className="text-gray-300">
                          {formatValue(entry.value, isExpanded)}
                        </span>
                      </div>
                    )}
                    
                    {/* 操作按钮 */}
                    {!isEditing && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => startEdit(entry)}
                          className="text-blue-400 hover:text-blue-300 text-xs"
                        >
                          ✏️ {t.edit}
                        </button>
                        <button
                          onClick={() => handleDelete(entry.key, scope)}
                          className={`text-xs ${isSystem ? 'text-yellow-400 hover:text-yellow-300' : 'text-red-400 hover:text-red-300'}`}
                        >
                          🗑️ {t.delete}
                        </button>
                      </div>
                    )}
                    
                    {entry.subscribers && entry.subscribers.length > 0 && (
                      <div className="mt-1 text-xs text-gray-500">
                        {t.subscribers}: {entry.subscribers.join(', ')}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
        
        {activeSubTab === 'events' && (
          <div className="space-y-1">
            {events.length === 0 ? (
              <div className="text-gray-500 text-center py-4 text-sm">
                {language === 'zh' ? '暂无事件' : 'No events'}
              </div>
            ) : (
              events.map((event, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-xs py-1 border-b border-gray-800"
                >
                  <span className={getEventColor(event.type)}>
                    {event.type}
                  </span>
                  <span className="text-gray-400 truncate flex-1">
                    {JSON.stringify(event.data).slice(0, 50)}
                  </span>
                  <span className="text-gray-600">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        
        {activeSubTab === 'stats' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs">{t.variableCount}</div>
              <div className="text-white text-xl font-bold">{stats.globalVariableCount + stats.workflowVariableCount}</div>
              <div className="text-gray-500 text-xs mt-1">
                {language === 'zh' ? `全局: ${stats.globalVariableCount}, 工作流: ${stats.workflowVariableCount}` : `Global: ${stats.globalVariableCount}, Workflow: ${stats.workflowVariableCount}`}
              </div>
            </div>
            <div className="bg-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs">{t.taskCount}</div>
              <div className="text-white text-xl font-bold">{stats.taskCount}</div>
            </div>
            <div className="bg-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs">{t.agentCount}</div>
              <div className="text-white text-xl font-bold">{stats.agentCount}</div>
            </div>
            <div className="bg-gray-800 rounded p-3">
              <div className="text-gray-400 text-xs">{t.eventCount}</div>
              <div className="text-white text-xl font-bold">{stats.eventCount}</div>
            </div>
          </div>
        )}
      </div>
      
      {/* 添加变量 */}
      <div className="p-2 border-t border-gray-700 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={t.key}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs"
            id="bb-key-input"
          />
          <input
            type="text"
            placeholder={t.value}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs"
            id="bb-value-input"
          />
          <button
            onClick={() => {
              const keyInput = document.getElementById('bb-key-input') as HTMLInputElement;
              const valueInput = document.getElementById('bb-value-input') as HTMLInputElement;
              if (keyInput?.value && valueInput?.value) {
                if (activeTab === 'global') {
                  blackboard.setGlobalVariable(keyInput.value, valueInput.value, { owner: 'user' });
                } else {
                  blackboard.setWorkflowVariable(keyInput.value, valueInput.value, undefined, { owner: 'user' });
                }
                refreshVariables();
                keyInput.value = '';
                valueInput.value = '';
              }
            }}
            className={`px-3 py-1 rounded text-xs text-white whitespace-nowrap ${
              activeTab === 'global' 
                ? 'bg-green-600 hover:bg-green-500' 
                : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {t.set}
          </button>
        </div>
      </div>
      
      {/* 状态栏 */}
      <div className="px-3 py-1 border-t border-gray-700 text-xs text-gray-500 shrink-0">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1">
            <span className="text-green-400">●</span>
            {t.realTimeSync}
          </span>
          <span>
            {t.lastUpdate}: {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  );
}