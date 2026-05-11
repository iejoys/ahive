/**
 * 节点配置面板
 * 根据节点类型显示不同的配置界面
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { blackboard } from '../../scheduler/Blackboard';
import { useDialog } from '../common/DialogProvider';
import type { 
  WorkflowNode, 
  WorkflowNodeConfig, 
  InputMapping, 
  OutputMapping,
  Agent,
  WorkflowNodeType,
  LoopNodeConfig,
  DelayNodeConfig,
  VariableNodeConfig,
  VariableItem,
  VariableGroup,
  VariableNodeConfigV2,
} from '../../types';

// 导入专用配置面板
import { ReviewConfigPanel } from './config/ReviewConfigPanel';
import { ExecutorConfigPanel } from './config/ExecutorConfigPanel';
import { DepartmentNodeConfigPanel } from './config/DepartmentNodeConfigPanel';
import { PlannerConfigPanel } from './config/PlannerConfigPanel';
import { DynamicParallelConfigPanel } from './config/DynamicParallelConfigPanel';

interface NodeConfigPanelProps {
  node: WorkflowNode | null;
  agents: Agent[];
  /** 其他工作流节点 (用于审核退回选择) */
  workflowNodes?: WorkflowNode[];
  onUpdate: (node: WorkflowNode) => void;
  onDelete?: (nodeId: string) => void;
  onClose: () => void;
}

// 节点类型配置
const nodeTypeConfig: Record<WorkflowNodeType, { icon: string; color: string; labelZh: string; labelEn: string }> = {
  agent: { icon: '🤖', color: '#6366f1', labelZh: '智能体节点', labelEn: 'Agent Node' },
  department: { icon: '👥', color: '#22c55e', labelZh: '部门节点', labelEn: 'Department Node' },
  api: { icon: '📞', color: '#f59e0b', labelZh: 'API节点', labelEn: 'API Node' },
  condition: { icon: '◇', color: '#8b5cf6', labelZh: '条件分支', labelEn: 'Condition' },
  parallel: { icon: '⚡', color: '#ec4899', labelZh: '并行节点', labelEn: 'Parallel' },
  loop: { icon: '🔄', color: '#14b8a6', labelZh: '循环节点', labelEn: 'Loop' },
  delay: { icon: '⏱️', color: '#64748b', labelZh: '延时节点', labelEn: 'Delay' },
  variable: { icon: '📋', color: '#06b6d4', labelZh: '项目配置', labelEn: 'Project Config' },
  transform: { icon: '🔄', color: '#84cc16', labelZh: '转换节点', labelEn: 'Transform' },
  output: { icon: '📤', color: '#f43f5e', labelZh: '输出节点', labelEn: 'Output' },
  human: { icon: '✋', color: '#eab308', labelZh: '人工审核', labelEn: 'Human Review' },
  review: { icon: '📝', color: '#f97316', labelZh: '审核评分', labelEn: 'Review' },
  notify: { icon: '🔔', color: '#0ea5e9', labelZh: '通知节点', labelEn: 'Notify' },
  webhook: { icon: '🪝', color: '#7c3aed', labelZh: 'Webhook', labelEn: 'Webhook' },
  email: { icon: '📨', color: '#dc2626', labelZh: '邮件节点', labelEn: 'Email' },
  message: { icon: '💬', color: '#2563eb', labelZh: '消息节点', labelEn: 'Message' },
  group: { icon: '👥', color: '#22c55e', labelZh: '分组节点', labelEn: 'Group' },
  milestone: { icon: '🏁', color: '#10b981', labelZh: '里程碑', labelEn: 'Milestone' },
  planner: { icon: '📋', color: '#8b5cf6', labelZh: '规划节点', labelEn: 'Planner' },
  'dynamic-parallel': { icon: '🔀', color: '#ec4899', labelZh: '动态并行', labelEn: 'Dynamic Parallel' },
};

export function NodeConfigPanel({ 
  node, 
  agents, 
  workflowNodes = [],
  onUpdate, 
  onDelete, 
  onClose 
}: NodeConfigPanelProps) {
  const { language, departments } = useStore();
  const dialog = useDialog();
  
  // 本地状态
  const [name, setName] = useState(node?.name || '');
  const [description, setDescription] = useState(node?.description || '');
  
  // 面板展开状态（用于变量节点等复杂面板）
  const [isExpanded, setIsExpanded] = useState(node?.type === 'variable');
  
  // 使用 ref 保存当前正在编辑的节点 ID 和原始名称，防止切换节点时保存错误数据
  const editingNodeIdRef = useRef<string | null>(null);
  const originalNameRef = useRef<string>('');
  const originalDescriptionRef = useRef<string>('');
  
  // VariableConfigPanel 的保存状态管理
  const [variableHasChanges, setVariableHasChanges] = useState(false);
  const variableSaveRef = useRef<(() => void) | null>(null);
  
  // 同步节点变化
  useEffect(() => {
    if (node) {
      // 只有当节点 ID 改变时才更新状态
      if (editingNodeIdRef.current !== node.id) {
        // 保存新节点的原始值
        editingNodeIdRef.current = node.id;
        originalNameRef.current = node.name;
        originalDescriptionRef.current = node.description || '';
        setName(node.name);
        setDescription(node.description || '');
      }
    }
  }, [node]);
  
  // 获取节点类型配置
  const typeConfig = useMemo(() => {
    if (!node) return null;
    return nodeTypeConfig[node.type] || nodeTypeConfig.agent;
  }, [node?.type]);
  
  // 保存基础配置
  const handleSaveBasic = () => {
    if (!node) return;
    
    // 检查节点 ID 是否匹配，防止切换节点时保存错误数据
    if (editingNodeIdRef.current !== node.id) {
      return;
    }
    
    // 只有当名称或描述真正改变时才保存
    if (name === originalNameRef.current && description === originalDescriptionRef.current) {
      return;
    }
    
    // 更新原始值引用
    originalNameRef.current = name;
    originalDescriptionRef.current = description;
    
    const updatedNode: WorkflowNode = {
      ...node,
      name,
      description,
      updatedAt: new Date().toISOString(),
    };
    
    onUpdate(updatedNode);
  };
  
  // 保存节点配置 (来自专用配置面板)
  const handleConfigUpdate = (config: WorkflowNodeConfig) => {
    if (!node) return;
    
    const updatedNode: WorkflowNode = {
      ...node,
      name,
      description,
      config: {
        ...node.config,
        ...config,
      },
      updatedAt: new Date().toISOString(),
    };
    
    onUpdate(updatedNode);
  };
  
  if (!node) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 text-gray-400 w-96">
        {language === 'zh' ? '选择一个节点进行配置' : 'Select a node to configure'}
      </div>
    );
  }
  
  // 根据节点类型渲染配置面板
  const renderConfigPanel = () => {
    switch (node.type) {
      case 'agent':
        return (
          <ExecutorConfigPanel
            key={node.id}
            node={node}
            agents={agents}
            departments={departments}
            workflowNodes={workflowNodes}
            onUpdate={handleConfigUpdate}
          />
        );
        
      case 'department':
        return (
          <DepartmentNodeConfigPanel
            key={node.id}
            node={node}
            departments={departments}
            onUpdate={handleConfigUpdate}
          />
        );
        
      case 'review':
      case 'human':
        return (
          <ReviewConfigPanel
            key={node.id}
            node={node}
            agents={agents}
            workflowNodes={workflowNodes}
            onUpdate={handleConfigUpdate}
          />
        );
        
      case 'condition':
        return <ConditionConfigPanel key={node.id} node={node} workflowNodes={workflowNodes} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'loop':
        return <LoopConfigPanel key={node.id} node={node} workflowNodes={workflowNodes} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'delay':
        return <DelayConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'variable':
        return (
          <ProjectConfigPanel 
            key={node.id} 
            node={node} 
            onUpdate={handleConfigUpdate} 
            language={language} 
            agents={agents}
            onHasChangesChange={setVariableHasChanges}
            onSaveRef={(saveFn: () => void) => { variableSaveRef.current = saveFn; }}
          />
        );
        
      case 'parallel':
        return <ParallelConfigPanel key={node.id} node={node} workflowNodes={workflowNodes} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'api':
        return <ApiConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'notify':
        return <NotifyConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'transform':
        return <TransformConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'output':
        return <OutputConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'webhook':
        return <WebhookConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'email':
        return <EmailConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'message':
        return <MessageConfigPanel key={node.id} node={node} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'milestone':
        return <MilestoneConfigPanel key={node.id} node={node} workflowNodes={workflowNodes} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'planner':
        return <PlannerConfigPanel key={node.id} node={node} agents={agents} onUpdate={handleConfigUpdate} language={language} />;
        
      case 'dynamic-parallel':
        return <DynamicParallelConfigPanel key={node.id} node={node} workflowNodes={workflowNodes} onUpdate={handleConfigUpdate} language={language} />;
        
      default:
        return (
          <div className="p-4 text-gray-400 text-center">
            {language === 'zh' ? '此节点类型暂无配置选项' : 'No config for this node type'}
          </div>
        );
    }
  };
  
  // 根据节点类型和展开状态决定面板尺寸
  const getPanelSize = () => {
    if (isExpanded) {
      return 'w-[800px] h-[85vh]';  // 展开时大面板
    }
    // 变量节点默认使用较大面板
    if (node?.type === 'variable') {
      return 'w-[640px] min-h-[500px] max-h-[85vh]';
    }
    return 'w-96 max-h-[90vh]';  // 默认尺寸
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 - 不允许点击关闭，防止误丢数据 */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm" 
      />
      
      {/* 面板主体 */}
      <div className={`relative bg-gray-900 rounded-lg border border-gray-700 flex flex-col transition-all duration-200 shadow-2xl ${getPanelSize()}`}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            {typeConfig && (
              <span 
                className="text-xl px-2 py-1 rounded"
                style={{ backgroundColor: typeConfig.color + '20' }}
              >
                {typeConfig.icon}
              </span>
            )}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSaveBasic}
              className="bg-transparent text-white font-medium focus:outline-none"
              placeholder={language === 'zh' ? '节点名称' : 'Node Name'}
            />
          </div>
          <div className="flex items-center gap-2">
            {/* 放大/缩小按钮 */}
            <button 
              onClick={() => setIsExpanded(!isExpanded)} 
              className="text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
              title={isExpanded ? (language === 'zh' ? '缩小' : 'Collapse') : (language === 'zh' ? '放大' : 'Expand')}
            >
              {isExpanded ? '⊖' : '⊕'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              ✕
            </button>
          </div>
        </div>
      
      {/* 类型标签 */}
      {typeConfig && (
        <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50 shrink-0">
          <span 
            className="text-xs px-2 py-1 rounded"
            style={{ backgroundColor: typeConfig.color + '20', color: typeConfig.color }}
          >
            {language === 'zh' ? typeConfig.labelZh : typeConfig.labelEn}
          </span>
        </div>
      )}
      
      {/* 配置内容区 */}
      <div className="flex-1 overflow-y-auto">
        {renderConfigPanel()}
      </div>
      
      {/* 底部操作按钮 */}
      <div className="flex justify-end gap-2 p-3 border-t border-gray-700 shrink-0">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-gray-400 hover:text-white text-sm"
        >
          {language === 'zh' ? '关闭' : 'Close'}
        </button>
        {onDelete && (
          <button
            onClick={async () => {
              const confirmed = await dialog.confirm(
                language === 'zh' ? '确定删除此节点？' : 'Delete this node?',
                language === 'zh' ? '删除确认' : 'Delete Confirmation'
              );
              if (confirmed) {
                onDelete(node.id);
                onClose();
              }
            }}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-sm"
          >
            {language === 'zh' ? '删除' : 'Delete'}
          </button>
        )}
        {/* 变量节点的保存按钮 */}
        {node.type === 'variable' && variableHasChanges && (
          <button
            onClick={() => {
              if (variableSaveRef.current) {
                variableSaveRef.current();
              }
            }}
            className="bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1.5 rounded text-sm"
          >
            {language === 'zh' ? '保存' : 'Save'}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

// ========== 简易配置面板组件 ==========

// 条件配置面板 - 纯判断节点，条件在边上配置
function ConditionConfigPanel({ node, workflowNodes, onUpdate, language }: { 
  node: WorkflowNode; 
  workflowNodes: WorkflowNode[];
  onUpdate: (c: WorkflowNodeConfig) => void; 
  language: string 
}) {
  const [defaultNode, setDefaultNode] = useState(node.config?.defaultNode || '');
  
  // 获取黑板变量列表 (只显示用户变量)
  const blackboardVars = useMemo(() => {
    const vars = blackboard.getAllVariables();
    const systemPrefixes = ['intent_', 'plan_', 'vote_', 'vote_result_', 'swarm_', 'retry_', 'recovery_', 'failure_', 'agent_health_'];
    return vars
      .filter(v => !systemPrefixes.some(prefix => v.key.startsWith(prefix)))
      .map(v => v.key);
  }, []);
  
  const updateDefaultNode = (value: string) => {
    setDefaultNode(value);
    onUpdate({ defaultNode: value });
  };
  
  return (
    <div className="p-4 space-y-4">
      {/* 使用说明 */}
      <div className="bg-purple-600/10 border border-purple-500/30 rounded p-3">
        <div className="text-purple-400 text-xs mb-2 flex items-center gap-1">
          <span>💡</span>
          <span>{language === 'zh' ? '使用说明' : 'How to use'}</span>
        </div>
        <ul className="text-gray-300 text-xs space-y-1.5">
          <li>1. {language === 'zh' ? '从本节点拖出连线到目标节点' : 'Drag connection from this node to target'}</li>
          <li>2. {language === 'zh' ? '点击连线配置条件（从黑板选变量）' : 'Click connection to set condition'}</li>
          <li>3. {language === 'zh' ? '可拖多条线，每条代表一个条件分支' : 'Multiple connections = multiple branches'}</li>
        </ul>
      </div>
      
      {/* 默认分支 */}
      <div className="space-y-2">
        <label className="text-yellow-400 text-sm font-medium block">
          {language === 'zh' ? '默认分支' : 'Default Branch'}
        </label>
        <p className="text-gray-500 text-xs">
          {language === 'zh' 
            ? '当所有条件都不满足时执行' 
            : 'Executed when no condition matches'}
        </p>
        <select
          value={defaultNode}
          onChange={(e) => updateDefaultNode(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="">{language === 'zh' ? '不设置（中止工作流）' : 'None (abort workflow)'}</option>
          {workflowNodes.filter(n => n.id !== node.id).map(n => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
      </div>
      
      {/* 可用变量下拉 */}
      <div className="border-t border-gray-700 pt-4">
        <label className="text-gray-400 text-xs block mb-2">
          {language === 'zh' ? '可用黑板变量' : 'Available Variables'}
        </label>
        <select 
          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) {
              navigator.clipboard?.writeText(e.target.value).catch(() => {});
            }
          }}
        >
          <option value="">
            {blackboardVars.length > 0 
              ? (language === 'zh' ? '-- 选择变量 --' : '-- Select Variable --')
              : (language === 'zh' ? '暂无变量' : 'No variables')
            }
          </option>
          {blackboardVars.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <p className="text-gray-500 text-xs mt-1">
          {language === 'zh' ? '选择变量后复制到剪贴板，在连线配置中粘贴' : 'Select to copy, paste in connection config'}
        </p>
      </div>
      
      {/* 示例说明 */}
      <div className="border-t border-gray-700 pt-4">
        <label className="text-gray-400 text-xs block mb-2">
          {language === 'zh' ? '典型用法' : 'Typical Usage'}
        </label>
        <div className="bg-gray-800 rounded p-2 text-xs text-gray-300 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-green-400">✓</span>
            <span>{language === 'zh' ? '审核通过 (score ≥ 80)' : 'Approved (score ≥ 80)'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-red-400">✗</span>
            <span>{language === 'zh' ? '审核不通过 → 退回修改' : 'Rejected → Return for revision'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// 循环配置面板
function LoopConfigPanel({ node, workflowNodes, onUpdate, language }: { node: WorkflowNode; workflowNodes: WorkflowNode[]; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [loopConfig, setLoopConfig] = useState<LoopNodeConfig>(node.config?.loopConfig || { type: 'count', count: 1, loopBodyNode: '' });
  
  const updateConfig = (updates: Partial<LoopNodeConfig>) => {
    const newConfig = { ...loopConfig, ...updates } as LoopNodeConfig;
    setLoopConfig(newConfig);
    onUpdate({ loopConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">循环类型</label>
        <select 
          value={loopConfig.type} 
          onChange={(e) => updateConfig({ type: e.target.value as 'count' | 'condition' | 'array' })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="count">{language === 'zh' ? '固定次数' : 'Fixed Count'}</option>
          <option value="condition">{language === 'zh' ? '条件循环' : 'Condition Loop'}</option>
          <option value="array">{language === 'zh' ? '数组遍历' : 'Array Iteration'}</option>
        </select>
      </div>
      
      {loopConfig.type === 'count' && (
        <div>
          <label className="text-gray-400 text-xs">{language === 'zh' ? '循环次数' : 'Loop Count'}</label>
          <input
            type="number"
            value={loopConfig.count || 1}
            onChange={(e) => updateConfig({ count: Number(e.target.value) })}
            min={1}
            className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
          />
        </div>
      )}
      
      <div>
        <label className="text-gray-400 text-xs">{language === 'zh' ? '循环体节点' : 'Loop Body Node'}</label>
        <select
          value={loopConfig.loopBodyNode || ''}
          onChange={(e) => updateConfig({ loopBodyNode: e.target.value })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
        >
          <option value="">{language === 'zh' ? '选择节点...' : 'Select node...'}</option>
          {workflowNodes.filter(n => n.id !== node.id).map(n => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// 延时配置面板
function DelayConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [delayConfig, setDelayConfig] = useState(node.config?.delayConfig || { duration: 10, unit: 'seconds' as const });
  
  const updateConfig = (updates: Partial<typeof delayConfig>) => {
    const newConfig = { ...delayConfig, ...updates };
    setDelayConfig(newConfig);
    onUpdate({ delayConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '延时时长' : 'Delay Duration'}</label>
        <div className="flex gap-2 mt-1">
          <input
            type="number"
            value={delayConfig.duration}
            onChange={(e) => updateConfig({ duration: Number(e.target.value) })}
            min={1}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
          />
          <select
            value={delayConfig.unit}
            onChange={(e) => updateConfig({ unit: e.target.value as 'seconds' | 'minutes' | 'hours' })}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
          >
            <option value="seconds">{language === 'zh' ? '秒' : 'Seconds'}</option>
            <option value="minutes">{language === 'zh' ? '分钟' : 'Minutes'}</option>
            <option value="hours">{language === 'zh' ? '小时' : 'Hours'}</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// 里程碑配置面板 - 用于3D世界的阶段分组展示
function MilestoneConfigPanel({ node, workflowNodes, onUpdate, language }: { 
  node: WorkflowNode; 
  workflowNodes: WorkflowNode[]; 
  onUpdate: (c: WorkflowNodeConfig) => void; 
  language: string 
}) {
  // 直接从 config.childNodes 读取（与3D世界保持一致）
  const [childNodes, setChildNodes] = useState<string[]>(
    node.config?.childNodes || []
  );
  
  // 更新子节点列表
  const updateChildNodes = (newNodes: string[]) => {
    setChildNodes(newNodes);
    // 直接存储到 config.childNodes（与3D世界读取位置一致）
    onUpdate({ childNodes: newNodes });
  };
  
  // 切换子节点选择
  const toggleChildNode = (nodeId: string) => {
    const newNodes = childNodes.includes(nodeId)
      ? childNodes.filter(id => id !== nodeId)
      : [...childNodes, nodeId];
    updateChildNodes(newNodes);
  };
  
  // 可选的节点列表（排除自身和其他里程碑节点）
  const availableNodes = workflowNodes.filter(n => 
    n.id !== node.id && n.type !== 'milestone'
  );
  
  // 已选择的节点数量
  const selectedCount = childNodes.length;
  
  return (
    <div className="p-4 space-y-4">
      {/* 使用说明 */}
      <div className="bg-green-600/10 border border-green-500/30 rounded p-3">
        <div className="text-green-400 text-xs mb-2 flex items-center gap-1">
          <span>💡</span>
          <span>{language === 'zh' ? '里程碑用途' : 'Milestone Usage'}</span>
        </div>
        <ul className="text-gray-300 text-xs space-y-1">
          <li>• {language === 'zh' ? '用于3D世界的阶段分组展示' : 'Used for stage grouping in 3D world'}</li>
          <li>• {language === 'zh' ? '工作流执行时自动切换到对应里程碑舞台' : 'Auto-switch to milestone stage during execution'}</li>
          <li>• {language === 'zh' ? '选择属于此阶段的任务节点' : 'Select task nodes belonging to this stage'}</li>
        </ul>
      </div>
      
      {/* 子节点选择 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-gray-300 text-sm font-medium">
            {language === 'zh' ? '子节点管理' : 'Child Nodes'}
          </label>
          <span className="text-xs text-gray-400">
            {language === 'zh' ? `已选 ${selectedCount} 个` : `${selectedCount} selected`}
          </span>
        </div>
        
        {/* 快捷操作 */}
        <div className="flex gap-2">
          <button
            onClick={() => updateChildNodes(availableNodes.map(n => n.id))}
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
          >
            {language === 'zh' ? '全选' : 'Select All'}
          </button>
          <button
            onClick={() => updateChildNodes([])}
            className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
          >
            {language === 'zh' ? '清空' : 'Clear All'}
          </button>
        </div>
        
        {/* 节点列表 */}
        <div className="bg-gray-800/50 rounded border border-gray-700 max-h-[300px] overflow-y-auto">
          {availableNodes.length === 0 ? (
            <div className="p-3 text-gray-500 text-sm text-center">
              {language === 'zh' ? '暂无可用节点' : 'No available nodes'}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {availableNodes.map(n => {
                const isSelected = childNodes.includes(n.id);
                const nodeTypeIcon = nodeTypeConfig[n.type]?.icon || '📦';
                return (
                  <label
                    key={n.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      isSelected 
                        ? 'bg-green-600/20 border border-green-500/50' 
                        : 'hover:bg-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleChildNode(n.id)}
                      className="w-4 h-4 rounded border-gray-600 text-green-500 focus:ring-green-500 focus:ring-offset-0"
                    />
                    <span className="text-sm">{nodeTypeIcon}</span>
                    <span className={`text-sm ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                      {n.name}
                    </span>
                    <span className="text-xs text-gray-500 ml-auto">
                      {n.type}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 项目配置面板 - 支持多配置项、分组、打包存储
function ProjectConfigPanel({ node, onUpdate, language, agents, onHasChangesChange, onSaveRef }: { 
  node: WorkflowNode; 
  onUpdate: (c: WorkflowNodeConfig) => void; 
  language: string;
  agents: Agent[];
  /** 当 hasChanges 状态变化时通知父组件 */
  onHasChangesChange?: (hasChanges: boolean) => void;
  /** 父组件传递的保存函数引用 */
  onSaveRef?: (saveFn: () => void) => void;
}) {
  const dialog = useDialog();
  
  // 迁移旧版配置到新版
  const migrateToV2 = (oldConfig: any): VariableNodeConfigV2 => {
    if (oldConfig?.version === 'v2') {
      return oldConfig;
    }
    // 旧版格式转换
    if (oldConfig?.name && oldConfig?.value) {
      return {
        version: 'v2',
        variables: [{
          name: oldConfig.name,
          value: oldConfig.value,
          type: oldConfig.type || 'string',
          enabled: true,
        }],
        groups: [],
        packedVariableName: 'project',
      };
    }
    // 默认空配置
    return {
      version: 'v2',
      variables: [],
      groups: [],
      packedVariableName: 'project',
    };
  };

  const [config, setConfig] = useState<VariableNodeConfigV2>(
    migrateToV2(node.config?.variableConfig)
  );
  
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState<boolean>(false);  // 跟踪是否有未保存的更改
  
  // 本地编辑状态 - 用于输入框，避免每次输入都触发重新渲染
  // key: `${index}_${field}`, value: 编辑中的值
  const [editingValues, setEditingValues] = useState<Map<string, string>>(new Map());
  
  // 分组编辑状态 - key: `${groupId}_${field}`, value: 编辑中的值
  const [editingGroupValues, setEditingGroupValues] = useState<Map<string, string>>(new Map());

  // 通知主面板 hasChanges 状态变化
  useEffect(() => {
    if (onHasChangesChange) {
      onHasChangesChange(hasChanges);
    }
  }, [hasChanges, onHasChangesChange]);

  // 传递保存函数给主面板
  useEffect(() => {
    if (onSaveRef) {
      onSaveRef(saveChanges);
    }
  }, [onSaveRef, hasChanges, config]);

  // 本地更新配置（不触发保存）
  const updateConfigLocal = (updates: Partial<VariableNodeConfigV2>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    setHasChanges(true);  // 标记有更改
  };

  // 保存所有更改
  const saveChanges = () => {
    if (hasChanges) {
      onUpdate({ variableConfig: config });
      setHasChanges(false);
    }
  };

  // 添加变量
  const addVariable = (group?: string) => {
    const newVar: VariableItem = {
      name: `var_${config.variables.length + 1}`,
      value: '',
      type: 'string',
      group: group && group !== 'all' ? group : undefined,
      enabled: true,
    };
    updateConfigLocal({ variables: [...config.variables, newVar] });
    setExpandedVars(prev => new Set([...prev, newVar.name]));
  };

  // 删除变量
  const removeVariable = (index: number) => {
    const newVars = config.variables.filter((_, i) => i !== index);
    updateConfigLocal({ variables: newVars });
  };

  // 获取编辑中的值（优先使用本地编辑状态）
  const getEditingValue = (index: number, field: string, originalValue: string): string => {
    const key = `${index}_${field}`;
    return editingValues.has(key) ? editingValues.get(key)! : originalValue;
  };

  // 更新编辑中的值（只更新本地状态，不触发重新渲染）
  const setEditingValue = (index: number, field: string, value: string) => {
    const key = `${index}_${field}`;
    setEditingValues(prev => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
  };

  // 提交编辑值到 config（在 onBlur 时调用）
  const commitEditingValue = (index: number, field: string) => {
    const key = `${index}_${field}`;
    if (editingValues.has(key)) {
      const value = editingValues.get(key)!;
      const newVars = [...config.variables];
      newVars[index] = { ...newVars[index], [field]: value };
      setConfig(prev => ({ ...prev, variables: newVars }));
      setHasChanges(true);
      // 清除编辑状态
      setEditingValues(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // 更新单个变量（用于 checkbox、select 等不需要焦点保持的控件）
  const updateVariableImmediate = (index: number, updates: Partial<VariableItem>) => {
    const newVars = [...config.variables];
    newVars[index] = { ...newVars[index], ...updates };
    setConfig(prev => ({ ...prev, variables: newVars }));
    setHasChanges(true);
  };

  // 添加分组
  const addGroup = () => {
    const newGroup: VariableGroup = {
      id: `group_${Date.now()}`,
      name: language === 'zh' ? '新分组' : 'New Group',
      icon: '📁',
    };
    updateConfigLocal({ groups: [...(config.groups || []), newGroup] });
  };

  // 删除分组
  const removeGroup = (groupId: string) => {
    const newGroups = config.groups?.filter(g => g.id !== groupId) || [];
    // 将该分组的变量移到无分组
    const newVars = config.variables.map(v => 
      v.group === groupId ? { ...v, group: undefined } : v
    );
    updateConfigLocal({ groups: newGroups, variables: newVars });
    if (activeGroup === groupId) setActiveGroup('all');
  };

  // 获取分组编辑中的值
  const getEditingGroupValue = (groupId: string, field: string, originalValue: string): string => {
    const key = `${groupId}_${field}`;
    return editingGroupValues.has(key) ? editingGroupValues.get(key)! : originalValue;
  };

  // 更新分组编辑中的值（只更新本地状态）
  const setEditingGroupValue = (groupId: string, field: string, value: string) => {
    const key = `${groupId}_${field}`;
    setEditingGroupValues(prev => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
  };

  // 提交分组编辑值到 config（在 onBlur 时调用）
  const commitEditingGroupValue = (groupId: string, field: string) => {
    const key = `${groupId}_${field}`;
    if (editingGroupValues.has(key)) {
      const value = editingGroupValues.get(key)!;
      const newGroups = config.groups?.map(g => 
        g.id === groupId ? { ...g, [field]: value } : g
      ) || [];
      setConfig(prev => ({ ...prev, groups: newGroups }));
      setHasChanges(true);
      // 清除编辑状态
      setEditingGroupValues(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // 更新分组（用于不需要焦点保持的操作）
  const updateGroupImmediate = (groupId: string, updates: Partial<VariableGroup>) => {
    const newGroups = config.groups?.map(g => 
      g.id === groupId ? { ...g, ...updates } : g
    ) || [];
    setConfig(prev => ({ ...prev, groups: newGroups }));
    setHasChanges(true);
  };

  // 按分组筛选变量
  const filteredVars = activeGroup === 'all' 
    ? config.variables 
    : config.variables.filter(v => v.group === activeGroup);

  // 获取分组变量数量
  const getGroupVarCount = (groupId: string) => 
    config.variables.filter(v => v.group === groupId).length;

  // 类型图标映射
  const typeIcons: Record<string, string> = {
    string: '📝',
    number: '🔢',
    boolean: '✓',
    json: '{ }',
    array: '[ ]',
    object: '📦',
    file: '📄',
    directory: '📁',
  };

  // 从IPC加载的模板列表
  const [loadedTemplates, setLoadedTemplates] = useState<Array<{
    id: string;
    name: string;
    description?: string;
    icon?: string;
    category?: string;
  }>>([]);
  
  // 加载模板列表
  useEffect(() => {
    const loadTemplates = async () => {
      console.log('[ProjectConfigPanel] 开始加载模板, isDesktop:', window.electronAPI?.isDesktop);
      if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) {
        try {
          const templates = await window.electronAPI.getProjectConfigTemplates(language as 'zh' | 'en');
          console.log('[ProjectConfigPanel] 加载到的模板数量:', templates?.length, templates);
          setLoadedTemplates(templates || []);
        } catch (error) {
          console.error('[ProjectConfigPanel] 加载模板失败:', error);
        }
      } else {
        console.log('[ProjectConfigPanel] 非桌面环境，跳过模板加载');
      }
    };
    loadTemplates();
  }, [language]);

  // 应用模板（带确认对话框）
  const applyTemplate = async (templateId: string) => {
    // 如果已有变量，先确认
    if (config.variables.length > 0 || (config.groups && config.groups.length > 0)) {
      const confirmed = await dialog.confirm(
        language === 'zh' 
          ? '应用模板会覆盖当前所有变量和分组配置，是否继续？' 
          : 'Applying template will overwrite all current variables and groups. Continue?',
        language === 'zh' ? '确认覆盖' : 'Confirm Overwrite'
      );
      if (!confirmed) {
        return; // 用户取消
      }
    }
    
    // 从IPC获取完整模板
    if (typeof window !== 'undefined' && window.electronAPI?.isDesktop) {
      try {
        const template = await window.electronAPI.getProjectConfigTemplate(templateId, language as 'zh' | 'en');
        if (template) {
          updateConfigLocal({
            groups: template.groups,
            variables: template.variables.map((v: any) => ({ ...v, enabled: true })),
          });
        }
      } catch (error) {
        console.error('[ProjectConfigPanel] 应用模板失败:', error);
      }
    }
  };

  return (
    <div className="flex h-full min-h-[400px]">
      {/* 左侧分组导航 - 使用固定高度布局 */}
      <div className="w-36 border-r border-gray-700 bg-gray-800/50 flex flex-col shrink-0">
        {/* 标题 - 固定在顶部 */}
        <div className="p-2 border-b border-gray-700 shrink-0">
          <span className="text-xs text-gray-400">{language === 'zh' ? '分组导航' : 'Groups'}</span>
        </div>
        
        {/* 分组列表 - 可滚动区域 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
          {/* 全部 */}
          <button
            onClick={() => setActiveGroup('all')}
            className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
              activeGroup === 'all' ? 'bg-cyan-600/20 text-cyan-400' : 'text-gray-400 hover:bg-gray-700'
            }`}
          >
            <span>📋</span>
            <span>{language === 'zh' ? '全部' : 'All'}</span>
            <span className="text-xs text-gray-500 ml-auto">{config.variables.length}</span>
          </button>
          
          {/* 分组列表 */}
          {config.groups?.map(group => (
            <div
              key={group.id}
              className={`w-full rounded text-sm flex items-center gap-1 ${
                activeGroup === group.id ? 'bg-cyan-600/20 text-cyan-400' : 'text-gray-400 hover:bg-gray-700'
              }`}
            >
              {/* 分组图标 */}
              <input
                type="text"
                value={getEditingGroupValue(group.id, 'icon', group.icon || '📁')}
                onChange={(e) => setEditingGroupValue(group.id, 'icon', e.target.value)}
                onBlur={() => commitEditingGroupValue(group.id, 'icon')}
                className="w-5 bg-transparent text-center px-0 py-1 text-sm"
                title={language === 'zh' ? '点击修改图标' : 'Click to change icon'}
              />
              {/* 分组名称 */}
              <input
                type="text"
                value={getEditingGroupValue(group.id, 'name', group.name)}
                onChange={(e) => setEditingGroupValue(group.id, 'name', e.target.value)}
                onBlur={() => commitEditingGroupValue(group.id, 'name')}
                onClick={() => setActiveGroup(group.id)}
                className="flex-1 bg-transparent px-1 py-1 text-sm truncate cursor-pointer"
                title={language === 'zh' ? '点击修改名称' : 'Click to change name'}
              />
              {/* 变量数量 */}
              <span className="text-xs text-gray-500 px-1">{getGroupVarCount(group.id)}</span>
              {/* 删除按钮 */}
              <button
                onClick={() => removeGroup(group.id)}
                className="text-red-400 hover:text-red-300 px-1 opacity-50 hover:opacity-100"
                title={language === 'zh' ? '删除分组' : 'Delete group'}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        
        {/* 添加分组按钮 - 固定在底部 */}
        <div className="p-2 border-t border-gray-700 shrink-0 bg-gray-800/80">
          <button
            onClick={addGroup}
            className="w-full text-xs text-gray-500 hover:text-cyan-400 py-1.5 rounded hover:bg-gray-700 transition-colors"
          >
            + {language === 'zh' ? '添加分组' : 'Add Group'}
          </button>
        </div>
      </div>
      
      {/* 右侧变量列表 */}
      <div className="flex-1 flex flex-col">
        {/* 工具栏 */}
        <div className="p-2 border-b border-gray-700 flex items-center gap-2">
          {/* 打包变量名 */}
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-400">{language === 'zh' ? '打包名:' : 'Pack:'}</label>
            <input
              type="text"
              value={config.packedVariableName || 'project'}
              onChange={(e) => updateConfigLocal({ packedVariableName: e.target.value })}
              className="bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white font-mono w-20"
            />
          </div>
          
          {/* 模板选择 */}
          <select
            onChange={(e) => e.target.value && applyTemplate(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white"
            defaultValue=""
          >
            <option value="">{language === 'zh' ? '选择模板...' : 'Template...'}</option>
            {loadedTemplates.map(t => (
              <option key={t.id} value={t.id}>
                {t.icon ? `${t.icon} ` : ''}{t.name}
              </option>
            ))}
          </select>
          
          {/* 添加变量按钮 */}
          <button
            onClick={() => addVariable(activeGroup !== 'all' ? activeGroup : undefined)}
            className="bg-cyan-600 hover:bg-cyan-700 text-white px-2 py-0.5 rounded text-xs"
          >
            + {language === 'zh' ? '添加变量' : 'Add Var'}
          </button>
        </div>
        
        {/* 变量列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filteredVars.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {language === 'zh' ? '暂无变量，点击上方按钮添加' : 'No variables. Click button above to add.'}
            </div>
          ) : (
            filteredVars.map((varItem, index) => {
              const actualIndex = config.variables.findIndex(v => v.name === varItem.name);
              const isExpanded = expandedVars.has(varItem.name);
              
              return (
                <div key={varItem.name} className="bg-gray-800 rounded border border-gray-700">
                  {/* 简要信息行 */}
                  <div className="flex items-center gap-2 p-2">
                    {/* 启用开关 */}
                    <input
                      type="checkbox"
                      checked={varItem.enabled ?? true}
                      onChange={(e) => updateVariableImmediate(actualIndex, { enabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    
                    {/* 变量名 */}
                    <input
                      type="text"
                      value={getEditingValue(actualIndex, 'name', varItem.name)}
                      onChange={(e) => setEditingValue(actualIndex, 'name', e.target.value)}
                      onBlur={() => commitEditingValue(actualIndex, 'name')}
                      placeholder={language === 'zh' ? '变量名' : 'Name'}
                      className="flex-1 bg-gray-700 rounded px-2 py-1 text-sm font-mono text-white min-w-0"
                    />
                    
                    {/* 类型图标 */}
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 flex-shrink-0">
                      {typeIcons[varItem.type] || '📝'}
                    </span>
                    
                    {/* 敏感标记 */}
                    {varItem.sensitive && (
                      <span className="text-xs text-red-400 flex-shrink-0">🔒</span>
                    )}
                    
                    {/* 专用Agent标记 */}
                    {varItem.agentId && (
                      <span className="text-xs text-purple-400 flex-shrink-0">👤</span>
                    )}
                    
                    {/* 必填标记 */}
                    {varItem.required && (
                      <span className="text-xs text-yellow-400 flex-shrink-0">★</span>
                    )}
                    
                    {/* 展开/折叠 */}
                    <button 
                      onClick={() => setExpandedVars(prev => {
                        const next = new Set(prev);
                        if (next.has(varItem.name)) next.delete(varItem.name);
                        else next.add(varItem.name);
                        return next;
                      })} 
                      className="text-gray-400 hover:text-white flex-shrink-0"
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                    
                    {/* 删除 */}
                    <button 
                      onClick={() => removeVariable(actualIndex)} 
                      className="text-red-400 hover:text-red-300 flex-shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                  
                  {/* 详细配置区（可折叠） */}
                  {isExpanded && (
                    <div className="p-3 border-t border-gray-700 space-y-3">
                      {/* 变量值 */}
                      <div>
                        <label className="text-gray-400 text-xs">{language === 'zh' ? '值' : 'Value'}</label>
                        {varItem.type === 'json' || varItem.type === 'object' ? (
                          <textarea
                            value={getEditingValue(actualIndex, 'value', varItem.value)}
                            onChange={(e) => setEditingValue(actualIndex, 'value', e.target.value)}
                            onBlur={() => commitEditingValue(actualIndex, 'value')}
                            placeholder='{ "key": "value" }'
                            rows={3}
                            className="w-full mt-1 bg-gray-700 rounded px-2 py-1 text-sm font-mono text-white"
                          />
                        ) : varItem.type === 'boolean' ? (
                          <select
                            value={varItem.value}
                            onChange={(e) => updateVariableImmediate(actualIndex, { value: e.target.value })}
                            className="w-full mt-1 bg-gray-700 rounded px-2 py-1 text-sm text-white"
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input
                            type={varItem.sensitive ? 'password' : 'text'}
                            value={getEditingValue(actualIndex, 'value', varItem.value)}
                            onChange={(e) => setEditingValue(actualIndex, 'value', e.target.value)}
                            onBlur={() => commitEditingValue(actualIndex, 'value')}
                            placeholder={language === 'zh' ? '值或 {{变量}}' : 'Value or {{var}}'}
                            className="w-full mt-1 bg-gray-700 rounded px-2 py-1 text-sm font-mono text-white"
                          />
                        )}
                      </div>
                      
                      {/* 类型选择 */}
                      <div>
                        <label className="text-gray-400 text-xs">{language === 'zh' ? '类型' : 'Type'}</label>
                        <select
                          value={varItem.type}
                          onChange={(e) => updateVariableImmediate(actualIndex, { type: e.target.value as any })}
                          className="w-full mt-1 bg-gray-700 rounded px-2 py-1 text-sm text-white"
                        >
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="boolean">Boolean</option>
                          <option value="json">JSON</option>
                          <option value="array">Array</option>
                          <option value="object">Object</option>
                          <option value="file">File Path</option>
                          <option value="directory">Directory Path</option>
                        </select>
                      </div>
                      
                      {/* 描述 */}
                      <div>
                        <label className="text-gray-400 text-xs">{language === 'zh' ? '描述' : 'Description'}</label>
                        <input
                          type="text"
                          value={getEditingValue(actualIndex, 'description', varItem.description || '')}
                          onChange={(e) => setEditingValue(actualIndex, 'description', e.target.value)}
                          onBlur={() => commitEditingValue(actualIndex, 'description')}
                          placeholder={language === 'zh' ? '参数说明...' : 'Description...'}
                          className="w-full mt-1 bg-gray-700 rounded px-2 py-1 text-sm text-white"
                        />
                      </div>
                      
                      {/* 分组 */}
                      <div>
                        <label className="text-gray-400 text-xs">{language === 'zh' ? '分组' : 'Group'}</label>
                        <select
                          value={varItem.group || ''}
                          onChange={(e) => updateVariableImmediate(actualIndex, { group: e.target.value || undefined })}
                          className="w-full mt-1 bg-gray-700 rounded px-2 py-1 text-sm text-white"
                        >
                          <option value="">{language === 'zh' ? '无分组' : 'No Group'}</option>
                          {config.groups?.map(g => (
                            <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
                          ))}
                        </select>
                      </div>
                      
                      {/* 专用Agent */}
                      <div>
                        <label className="text-gray-400 text-xs">{language === 'zh' ? '专用智能体' : 'Private Agent'}</label>
                        <select
                          value={varItem.agentId || ''}
                          onChange={(e) => updateVariableImmediate(actualIndex, { agentId: e.target.value || undefined })}
                          className="w-full mt-1 bg-gray-700 rounded px-2 py-1 text-sm text-white"
                        >
                          <option value="">{language === 'zh' ? '公共参数' : 'Public'}</option>
                          {agents.map(a => (
                            <option key={a.id} value={a.agentId || a.id}>{a.name}</option>
                          ))}
                        </select>
                        <p className="text-gray-500 text-xs mt-1">
                          {language === 'zh' 
                            ? '设置后仅该智能体可访问此参数' 
                            : 'Only this agent can access this param'}
                        </p>
                      </div>
                      
                      {/* 验证规则 */}
                      <div className="border-t border-gray-700 pt-2">
                        <label className="text-gray-400 text-xs">{language === 'zh' ? '验证规则' : 'Validation'}</label>
                        <div className="flex gap-3 mt-1">
                          <label className="flex items-center gap-1 text-xs text-gray-300">
                            <input
                              type="checkbox"
                              checked={varItem.required || false}
                              onChange={(e) => updateVariableImmediate(actualIndex, { required: e.target.checked })}
                            />
                            {language === 'zh' ? '必填' : 'Required'}
                          </label>
                          <label className="flex items-center gap-1 text-xs text-gray-300">
                            <input
                              type="checkbox"
                              checked={varItem.sensitive || false}
                              onChange={(e) => updateVariableImmediate(actualIndex, { sensitive: e.target.checked })}
                            />
                            {language === 'zh' ? '敏感' : 'Sensitive'}
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        
        {/* 底部提示 */}
        <div className="p-2 border-t border-gray-700 bg-gray-800/50 shrink-0">
          <div className="text-xs text-gray-500">
            💡 {language === 'zh' 
              ? `所有变量将打包为 "${config.packedVariableName}" 存入黑板，引用方式: {{${config.packedVariableName}.变量名}}`
              : `All vars packed as "${config.packedVariableName}", reference: {{${config.packedVariableName}.varName}}`}
          </div>
          {config.variables.some(v => v.agentId) && (
            <div className="text-xs text-purple-400 mt-1">
              👤 {language === 'zh' 
                ? '专用参数存入 _agentPrivate 子对象'
                : 'Private params stored in _agentPrivate'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 并行配置面板
function ParallelConfigPanel({ node, workflowNodes, onUpdate, language }: { node: WorkflowNode; workflowNodes: WorkflowNode[]; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [branches, setBranches] = useState(node.config?.branches || []);
  const [mergeType, setMergeType] = useState(node.config?.mergeType || 'all');
  
  const addBranch = (nodeId: string) => {
    if (!nodeId || branches.includes(nodeId)) return;
    const newBranches = [...branches, nodeId];
    setBranches(newBranches);
    onUpdate({ branches: newBranches, mergeType });
  };
  
  const removeBranch = (nodeId: string) => {
    const newBranches = branches.filter(id => id !== nodeId);
    setBranches(newBranches);
    onUpdate({ branches: newBranches, mergeType });
  };
  
  const updateMergeType = (type: 'all' | 'any' | 'none') => {
    setMergeType(type);
    onUpdate({ branches, mergeType: type });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '合并策略' : 'Merge Strategy'}</label>
        <div className="flex gap-2 mt-2">
          <button 
            onClick={() => updateMergeType('all')}
            className={`flex-1 px-2 py-1.5 rounded text-sm ${mergeType === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          >
            {language === 'zh' ? '全部完成' : 'All Complete'}
          </button>
          <button 
            onClick={() => updateMergeType('any')}
            className={`flex-1 px-2 py-1.5 rounded text-sm ${mergeType === 'any' ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}
          >
            {language === 'zh' ? '任一完成' : 'Any Complete'}
          </button>
        </div>
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '并行分支' : 'Parallel Branches'}</label>
        <select 
          onChange={(e) => { addBranch(e.target.value); e.target.value = ''; }}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="">{language === 'zh' ? '+ 添加分支' : '+ Add Branch'}</option>
          {workflowNodes.filter(n => n.id !== node.id && !branches.includes(n.id)).map(n => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
      </div>
      
      {branches.length > 0 && (
        <div className="space-y-1">
          {branches.map((branchId, i) => {
            const branchNode = workflowNodes.find(n => n.id === branchId);
            return (
              <div key={branchId} className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5">
                <span className="text-gray-400 text-xs">{i + 1}</span>
                <span className="text-white text-sm flex-1">{branchNode?.name || branchId}</span>
                <button onClick={() => removeBranch(branchId)} className="text-red-400 hover:text-red-300">✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// API 配置面板
function ApiConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [apiConfig, setApiConfig] = useState(node.config?.apiConfig || {
    url: '',
    method: 'GET' as const,
    headers: {},
    body: '',
    authType: 'none' as const,
    authValue: '',
    timeout: 30000,
  });
  
  const updateConfig = (updates: Partial<typeof apiConfig>) => {
    const newConfig = { ...apiConfig, ...updates };
    setApiConfig(newConfig);
    onUpdate({ apiConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">URL</label>
        <input
          type="text"
          value={apiConfig.url}
          onChange={(e) => updateConfig({ url: e.target.value })}
          placeholder="https://api.example.com/endpoint"
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '方法' : 'Method'}</label>
        <select
          value={apiConfig.method}
          onChange={(e) => updateConfig({ method: e.target.value as 'GET' | 'POST' | 'PUT' | 'DELETE' })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '认证类型' : 'Auth Type'}</label>
        <select
          value={apiConfig.authType || 'none'}
          onChange={(e) => updateConfig({ authType: e.target.value as 'none' | 'bearer' | 'basic' | 'api-key' })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="none">{language === 'zh' ? '无认证' : 'None'}</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="api-key">API Key</option>
        </select>
      </div>
      
      {apiConfig.authType !== 'none' && (
        <div>
          <label className="text-gray-300 text-sm font-medium">
            {apiConfig.authType === 'bearer' ? 'Token' : 
             apiConfig.authType === 'basic' ? (language === 'zh' ? 'Base64 凭证' : 'Base64 Credentials') : 
             (language === 'zh' ? 'API Key' : 'API Key')}
          </label>
          <input
            type="password"
            value={apiConfig.authValue || ''}
            onChange={(e) => updateConfig({ authValue: e.target.value })}
            placeholder={apiConfig.authType === 'bearer' ? 'your-token-here' : ''}
            className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
          />
        </div>
      )}
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '超时时间 (秒)' : 'Timeout (seconds)'}</label>
        <input
          type="number"
          value={(apiConfig.timeout || 30000) / 1000}
          onChange={(e) => updateConfig({ timeout: Number(e.target.value) * 1000 })}
          min={1}
          max={300}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '请求体' : 'Body (JSON)'}</label>
        <textarea
          value={apiConfig.body || ''}
          onChange={(e) => updateConfig({ body: e.target.value })}
          placeholder='{"key": "value"}'
          rows={3}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm font-mono"
        />
      </div>
    </div>
  );
}

// 通知配置面板
function NotifyConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  // 渠道可用状态：企业微信已实现，其他暂不可用
  const CHANNEL_STATUS: Record<string, { available: boolean; labelZh: string; labelEn: string }> = {
    wecom: { available: true, labelZh: '企业微信', labelEn: 'WeCom' },
    dingtalk: { available: false, labelZh: '钉钉', labelEn: 'DingTalk' },
    feishu: { available: false, labelZh: '飞书', labelEn: 'Feishu' },
    email: { available: false, labelZh: '邮件', labelEn: 'Email' },
    sms: { available: false, labelZh: '短信', labelEn: 'SMS' },
  };
  
  const [notifyConfig, setNotifyConfig] = useState(node.config?.notifyConfig || {
    // 默认选择企业微信
    channels: ['wecom'],
    recipients: [],
    template: '',
  });
  
  const updateConfig = (updates: Partial<typeof notifyConfig>) => {
    const newConfig = { ...notifyConfig, ...updates };
    setNotifyConfig(newConfig);
    onUpdate({ notifyConfig: newConfig });
  };
  
  // 按可用性排序：可用渠道在前
  const channels = Object.keys(CHANNEL_STATUS);
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '通知渠道' : 'Channels'}</label>
        <div className="flex flex-wrap gap-2 mt-2">
          {channels.map(ch => {
            const status = CHANNEL_STATUS[ch];
            const isSelected = notifyConfig.channels.includes(ch);
            const isDisabled = !status.available;
            
            return (
              <label 
                key={ch} 
                className={`flex items-center gap-1.5 text-sm px-2 py-1 rounded cursor-pointer
                  ${isDisabled ? 'text-gray-500 bg-gray-800 cursor-not-allowed' : 
                    isSelected ? 'text-green-400 bg-green-600/20 border border-green-500' : 
                    'text-gray-300 bg-gray-700 hover:bg-gray-600'}
                `}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={(e) => {
                    if (isDisabled) return;
                    const newChannels = e.target.checked
                      ? [...notifyConfig.channels, ch]
                      : notifyConfig.channels.filter(c => c !== ch);
                    updateConfig({ channels: newChannels });
                  }}
                  className={isDisabled ? 'opacity-50' : ''}
                />
                <span>{language === 'zh' ? status.labelZh : status.labelEn}</span>
                {isDisabled && (
                  <span className="text-xs text-gray-500 ml-1">
                    ({language === 'zh' ? '暂不可用' : 'Unavailable'})
                  </span>
                )}
                {status.available && isSelected && (
                  <span className="text-xs text-green-400 ml-1">✓</span>
                )}
              </label>
            );
          })}
        </div>
      </div>
      
      {notifyConfig.channels.includes('email') && (
        <div>
          <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '收件人 (逗号分隔)' : 'Recipients (comma separated)'}</label>
          <input
            type="text"
            value={notifyConfig.recipients?.join(', ') || ''}
            onChange={(e) => updateConfig({ 
              recipients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
            })}
            placeholder="user@example.com, admin@example.com"
            className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
          />
        </div>
      )}
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '消息模板' : 'Message Template'}</label>
        <textarea
          value={notifyConfig.template}
          onChange={(e) => updateConfig({ template: e.target.value })}
          placeholder={language === 'zh' ? '通知内容，支持 {{变量}} 插值...' : 'Message content, supports {{variable}} interpolation...'}
          rows={4}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
        <p className="text-gray-500 text-xs mt-1">
          {language === 'zh' ? '支持 {{变量名}} 语法插入黑板变量' : 'Use {{variable}} syntax to insert blackboard variables'}
        </p>
      </div>
      
      <div className="bg-blue-600/10 border border-blue-500/30 rounded p-3">
        <div className="text-blue-400 text-sm flex items-start gap-2">
          <span>💡</span>
          <div>
            <p className="font-medium">{language === 'zh' ? '配置说明' : 'Configuration Tips'}</p>
            <p className="text-gray-400 text-xs mt-1">
              {language === 'zh' 
                ? '钉钉/企微/飞书通知需要在黑板中配置对应的 webhook_url' 
                : 'DingTalk/WeCom/Feishu require webhook_url in blackboard'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// 数据转换配置面板
function TransformConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [transformConfig, setTransformConfig] = useState(node.config?.transformConfig || {
    type: 'jsonpath' as const,
    inputVariable: '',
    outputVariable: '',
    expression: '',
  });
  
  const updateConfig = (updates: Partial<typeof transformConfig>) => {
    const newConfig = { ...transformConfig, ...updates };
    setTransformConfig(newConfig);
    onUpdate({ transformConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '转换类型' : 'Transform Type'}</label>
        <select
          value={transformConfig.type}
          onChange={(e) => updateConfig({ type: e.target.value as 'jsonpath' | 'jq' | 'template' | 'script' })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="jsonpath">JSONPath</option>
          <option value="template">{language === 'zh' ? '模板渲染' : 'Template'}</option>
          <option value="script">{language === 'zh' ? '脚本表达式' : 'Script'}</option>
        </select>
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '输入变量' : 'Input Variable'}</label>
        <input
          type="text"
          value={transformConfig.inputVariable}
          onChange={(e) => updateConfig({ inputVariable: e.target.value })}
          placeholder="sourceData"
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm font-mono"
        />
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '输出变量' : 'Output Variable'}</label>
        <input
          type="text"
          value={transformConfig.outputVariable}
          onChange={(e) => updateConfig({ outputVariable: e.target.value })}
          placeholder="result"
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm font-mono"
        />
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '转换表达式' : 'Expression'}</label>
        <textarea
          value={transformConfig.expression}
          onChange={(e) => updateConfig({ expression: e.target.value })}
          placeholder={transformConfig.type === 'jsonpath' ? '$.data.items[0]' : '{{input}}'}
          rows={3}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm font-mono"
        />
      </div>
    </div>
  );
}

// 输出配置面板
function OutputConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [outputConfig, setOutputConfig] = useState(node.config?.outputConfig || {
    name: '',
    description: '',
    type: 'string' as const,
    isFinalOutput: true,
  });
  
  const updateConfig = (updates: Partial<typeof outputConfig>) => {
    const newConfig = { ...outputConfig, ...updates };
    setOutputConfig(newConfig);
    onUpdate({ outputConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '输出变量名' : 'Output Variable Name'}</label>
        <input
          type="text"
          value={outputConfig.name}
          onChange={(e) => updateConfig({ name: e.target.value })}
          placeholder="result"
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm font-mono"
        />
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '输出类型' : 'Output Type'}</label>
        <select
          value={outputConfig.type}
          onChange={(e) => updateConfig({ type: e.target.value as 'string' | 'number' | 'boolean' | 'json' })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="json">JSON</option>
        </select>
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '描述' : 'Description'}</label>
        <textarea
          value={outputConfig.description || ''}
          onChange={(e) => updateConfig({ description: e.target.value })}
          placeholder={language === 'zh' ? '输出说明...' : 'Output description...'}
          rows={2}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
      </div>
      
      <label className="flex items-center gap-2 text-gray-300 text-sm">
        <input
          type="checkbox"
          checked={outputConfig.isFinalOutput}
          onChange={(e) => updateConfig({ isFinalOutput: e.target.checked })}
        />
        {language === 'zh' ? '标记为工作流最终输出' : 'Mark as final output'}
      </label>
    </div>
  );
}

// Webhook 配置面板
function WebhookConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [webhookConfig, setWebhookConfig] = useState(node.config?.webhookConfig || {
    path: `webhook/${node.id}`,
    method: 'POST' as const,
    requireAuth: false,
    authToken: '',
    responseTemplate: '{"success": true}',
  });
  
  const updateConfig = (updates: Partial<typeof webhookConfig>) => {
    const newConfig = { ...webhookConfig, ...updates };
    setWebhookConfig(newConfig);
    onUpdate({ webhookConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '端点路径' : 'Endpoint Path'}</label>
        <input
          type="text"
          value={webhookConfig.path}
          onChange={(e) => updateConfig({ path: e.target.value })}
          placeholder="/webhook/my-endpoint"
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm font-mono"
        />
        <p className="text-gray-500 text-xs mt-1">
          {language === 'zh' ? '完整 URL: /api/webhook/{path}' : 'Full URL: /api/webhook/{path}'}
        </p>
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">HTTP Method</label>
        <select
          value={webhookConfig.method}
          onChange={(e) => updateConfig({ method: e.target.value as 'GET' | 'POST' })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
      </div>
      
      <label className="flex items-center gap-2 text-gray-300 text-sm">
        <input
          type="checkbox"
          checked={webhookConfig.requireAuth}
          onChange={(e) => updateConfig({ requireAuth: e.target.checked })}
        />
        {language === 'zh' ? '需要认证' : 'Require Authentication'}
      </label>
      
      {webhookConfig.requireAuth && (
        <div>
          <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '认证令牌' : 'Auth Token'}</label>
          <input
            type="password"
            value={webhookConfig.authToken || ''}
            onChange={(e) => updateConfig({ authToken: e.target.value })}
            className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
          />
        </div>
      )}
    </div>
  );
}

// 邮件配置面板
function EmailConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [emailConfig, setEmailConfig] = useState(node.config?.emailConfig || {
    to: [],
    cc: [],
    subject: '',
    body: '',
    isHtml: false,
  });
  
  const updateConfig = (updates: Partial<typeof emailConfig>) => {
    const newConfig = { ...emailConfig, ...updates };
    setEmailConfig(newConfig);
    onUpdate({ emailConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '收件人 (逗号分隔)' : 'To (comma separated)'}</label>
        <input
          type="text"
          value={emailConfig.to.join(', ')}
          onChange={(e) => updateConfig({ to: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          placeholder="user@example.com"
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '主题' : 'Subject'}</label>
        <input
          type="text"
          value={emailConfig.subject}
          onChange={(e) => updateConfig({ subject: e.target.value })}
          placeholder={language === 'zh' ? '邮件主题' : 'Email subject'}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '正文' : 'Body'}</label>
        <textarea
          value={emailConfig.body}
          onChange={(e) => updateConfig({ body: e.target.value })}
          rows={4}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
      </div>
      
      <label className="flex items-center gap-2 text-gray-300 text-sm">
        <input
          type="checkbox"
          checked={emailConfig.isHtml}
          onChange={(e) => updateConfig({ isHtml: e.target.checked })}
        />
        HTML {language === 'zh' ? '格式' : 'Format'}
      </label>
    </div>
  );
}

// 消息配置面板
function MessageConfigPanel({ node, onUpdate, language }: { node: WorkflowNode; onUpdate: (c: WorkflowNodeConfig) => void; language: string }) {
  const [messageConfig, setMessageConfig] = useState(node.config?.messageConfig || {
    type: 'wecom' as const,  // 企业微信为默认
    recipients: [],
    content: '',
  });
  
  // 渠道可用性配置
  const channelAvailability: Record<string, { available: boolean; labelZh: string; labelEn: string }> = {
    wecom: { available: true, labelZh: '企业微信', labelEn: 'WeCom' },
    dingtalk: { available: false, labelZh: '钉钉', labelEn: 'DingTalk' },
    feishu: { available: false, labelZh: '飞书', labelEn: 'Feishu' },
    slack: { available: false, labelZh: 'Slack', labelEn: 'Slack' },
  };
  
  const updateConfig = (updates: Partial<typeof messageConfig>) => {
    const newConfig = { ...messageConfig, ...updates };
    setMessageConfig(newConfig);
    onUpdate({ messageConfig: newConfig });
  };
  
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '消息类型' : 'Message Type'}</label>
        <select
          value={messageConfig.type}
          onChange={(e) => updateConfig({ type: e.target.value as 'dingtalk' | 'wecom' | 'feishu' | 'slack' })}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        >
          {Object.entries(channelAvailability).map(([key, info]) => (
            <option key={key} value={key} disabled={!info.available}>
              {language === 'zh' ? info.labelZh : info.labelEn}
              {!info.available && (language === 'zh' ? ' (暂不可用)' : ' (Unavailable)')}
            </option>
          ))}
        </select>
        {/* 可用性提示 */}
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(channelAvailability).map(([key, info]) => (
            <span 
              key={key}
              className={`text-xs px-2 py-1 rounded ${info.available 
                ? 'bg-green-600/20 text-green-400 border border-green-500/30' 
                : 'bg-gray-600/20 text-gray-500 border border-gray-500/30'}`}
            >
              {info.available ? '✓' : '○'} {language === 'zh' ? info.labelZh : info.labelEn}
            </span>
          ))}
        </div>
      </div>
      
      <div>
        <label className="text-gray-300 text-sm font-medium">{language === 'zh' ? '消息内容' : 'Message Content'}</label>
        <textarea
          value={messageConfig.content}
          onChange={(e) => updateConfig({ content: e.target.value })}
          rows={4}
          className="w-full mt-1 bg-gray-700 border border-gray-600 rounded px-2 py-2 text-white text-sm"
        />
      </div>
      
      {/* 企业微信配置提示 */}
      {messageConfig.type === 'wecom' && (
        <div className="bg-green-600/10 border border-green-500/30 rounded p-3">
          <div className="text-green-400 text-sm flex items-start gap-2">
            <span>✅</span>
            <div>
              <p className="font-medium">{language === 'zh' ? '企业微信已集成' : 'WeCom Integrated'}</p>
              <p className="text-gray-400 text-xs mt-1">
                {language === 'zh' 
                  ? '消息将通过企业微信机器人发送，请确保配置了 webhook_url' 
                  : 'Messages will be sent via WeCom bot, please configure webhook_url'}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* 未实现渠道提示 */}
      {!channelAvailability[messageConfig.type]?.available && (
        <div className="bg-red-600/10 border border-red-500/30 rounded p-3">
          <div className="text-red-400 text-sm flex items-start gap-2">
            <span>⚠️</span>
            <div>
              <p className="font-medium">{language === 'zh' ? '渠道暂未实现' : 'Channel Not Implemented'}</p>
              <p className="text-gray-400 text-xs mt-1">
                {language === 'zh' 
                  ? '此消息渠道尚未实现发送功能，请选择企业微信' 
                  : 'This channel is not implemented, please use WeCom'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default NodeConfigPanel;