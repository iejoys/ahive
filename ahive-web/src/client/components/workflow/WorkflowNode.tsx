import { Handle, Position } from 'reactflow';
import type { WorkflowNode as WorkflowNodeType, Agent, WorkflowNodeType as NodeTypeName } from '../../types';
import { useStore } from '../../store/useStore';

interface WorkflowNodeProps {
  data: WorkflowNodeType & { agents?: Agent[] };
  selected: boolean;
}

// 节点类型配置
const nodeTypeConfig: Record<NodeTypeName, { icon: string; color: string; labelZh: string; labelEn: string }> = {
  agent: { icon: '🤖', color: '#6366f1', labelZh: '智能体', labelEn: 'Agent' },
  milestone: { icon: '🚩', color: '#10b981', labelZh: '里程碑', labelEn: 'Milestone' },
  department: { icon: '👥', color: '#22c55e', labelZh: '部门', labelEn: 'Department' },
  api: { icon: '📞', color: '#f59e0b', labelZh: 'API', labelEn: 'API' },
  condition: { icon: '◇', color: '#8b5cf6', labelZh: '条件分支', labelEn: 'Condition' },
  parallel: { icon: '⚡', color: '#ec4899', labelZh: '并行', labelEn: 'Parallel' },
  loop: { icon: '🔄', color: '#14b8a6', labelZh: '循环', labelEn: 'Loop' },
  delay: { icon: '⏱️', color: '#64748b', labelZh: '延时', labelEn: 'Delay' },
  variable: { icon: '📋', color: '#06b6d4', labelZh: '项目配置', labelEn: 'Project Config' },
  transform: { icon: '🔄', color: '#84cc16', labelZh: '转换', labelEn: 'Transform' },
  output: { icon: '📤', color: '#f43f5e', labelZh: '输出', labelEn: 'Output' },
  human: { icon: '✋', color: '#eab308', labelZh: '人工审核', labelEn: 'Human Review' },
  review: { icon: '📝', color: '#f97316', labelZh: '审核评分', labelEn: 'Review' },
  notify: { icon: '🔔', color: '#0ea5e9', labelZh: '通知', labelEn: 'Notify' },
  webhook: { icon: '🪝', color: '#7c3aed', labelZh: 'Webhook', labelEn: 'Webhook' },
  email: { icon: '📨', color: '#dc2626', labelZh: '邮件', labelEn: 'Email' },
  message: { icon: '💬', color: '#2563eb', labelZh: '消息', labelEn: 'Message' },
  group: { icon: '👥', color: '#22c55e', labelZh: '分组', labelEn: 'Group' },
  planner: { icon: '📋', color: '#8b5cf6', labelZh: '规划节点', labelEn: 'Planner' },
  'dynamic-parallel': { icon: '🔀', color: '#ec4899', labelZh: '动态并行', labelEn: 'Dynamic Parallel' },
};

export function WorkflowNode({ data, selected }: WorkflowNodeProps) {
  const { agents, language } = useStore();
  
  // 获取节点类型配置
  const typeConfig = nodeTypeConfig[data.type] || { 
    icon: '❓', 
    color: '#71717a', 
    labelZh: '未知', 
    labelEn: 'Unknown' 
  };
  
  // 里程碑节点特殊样式
  const isMilestone = data.type === 'milestone';
  
  // 如果是 agent 类型，显示关联的 Agent 信息
  const linkedAgent = data.type === 'agent' && data.agentId 
    ? agents.find(a => a.id === data.agentId) 
    : null;
  
  // 如果有执行者配置，显示执行者
  const executor = data.config?.executor;
  const executorCount = executor?.executors?.length || 0;
  
  const color = typeConfig.color;
  
  const getTypeLabel = () => {
    return language === 'zh' ? typeConfig.labelZh : typeConfig.labelEn;
  };
  
  // 获取执行模式图标
  const getModeIcon = (mode: string) => {
    const modeIcons: Record<string, string> = {
      single: '1️⃣',
      any: '⚡',
      all: '✓',
      vote: '🗳️',
      'round-robin': '🔄',
    };
    return modeIcons[mode] || '';
  };
  
  // 里程碑节点：更大的尺寸、虚线边框、渐变背景
  if (isMilestone) {
    return (
      <div 
        className={`px-6 py-4 rounded-xl bg-gray-800 min-w-[280px] transition-all ${
          selected ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''
        }`}
        style={{ 
          border: selected ? '3px solid #fff' : `3px dashed ${color}`,
          boxShadow: selected ? `0 0 30px ${color}60` : `0 0 20px ${color}20`,
          background: `linear-gradient(135deg, ${color}10 0%, transparent 100%)`
        }}
      >
        {/* 顶部连接点 */}
        <Handle 
          type="target" 
          position={Position.Top} 
          id="top"
          className="!bg-emerald-500 !w-4 !h-4"
        />
        
        <div className="flex items-center gap-3">
          <span className="text-3xl">{typeConfig.icon}</span>
          <div className="flex-1">
            <div className="text-white font-bold text-lg">{data.name}</div>
            {data.config?.milestoneConfig?.description && (
              <div className="text-gray-400 text-sm mt-1">
                {data.config.milestoneConfig.description}
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-3 flex items-center justify-between">
          <span 
            className="text-sm px-3 py-1 rounded-full font-medium"
            style={{ backgroundColor: color + '30', color }}
          >
            {getTypeLabel()}
          </span>
          {data.config?.milestoneConfig?.timeout && (
            <span className="text-xs text-gray-500">
              ⏱️ {Math.round(data.config.milestoneConfig.timeout / 60000)} 分钟
            </span>
          )}
        </div>
        
        {/* 底部连接点 */}
        <Handle 
          type="source" 
          position={Position.Bottom} 
          id="bottom"
          className="!bg-emerald-500 !w-4 !h-4"
        />
      </div>
    );
  }
  
  // 普通节点
  return (
    <div 
      className={`px-4 py-3 rounded-lg bg-gray-800 border-2 min-w-[200px] transition-all ${
        selected ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''
      }`}
      style={{ 
        borderColor: selected ? '#fff' : color,
        boxShadow: selected ? `0 0 20px ${color}40` : 'none'
      }}
    >
      {/* 顶部连接点 - 正常流程进入 */}
      <Handle 
        type="target" 
        position={Position.Top} 
        id="top"
        className="!bg-indigo-500 !w-3 !h-3"
      />
      
      {/* 左侧连接点 - 失败退回 */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="left"
        className="!bg-red-500 !w-3 !h-3"
      />
      
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">{typeConfig.icon}</span>
        <div className="flex-1">
          <div className="text-white font-medium">{data.name}</div>
          {linkedAgent && (
            <div className="text-gray-400 text-xs">→ {linkedAgent.name}</div>
          )}
          {executor && executorCount > 0 && (
            <div className="text-gray-400 text-xs flex items-center gap-1">
              <span>{getModeIcon(executor.mode)}</span>
              <span>{executorCount} 个执行者</span>
            </div>
          )}
        </div>
      </div>
      
      <div className="flex items-center justify-between">
        <span 
          className="text-xs px-2 py-0.5 rounded"
          style={{ backgroundColor: color + '20', color }}
        >
          {getTypeLabel()}
        </span>
        {data.description && (
          <span className="text-xs text-gray-500 truncate max-w-[100px]">
            {data.description}
          </span>
        )}
      </div>
      
      {/* 底部连接点 - 正常流程继续 (成功) */}
      <Handle 
        type="source" 
        position={Position.Bottom} 
        id="bottom"
        className="!bg-indigo-500 !w-3 !h-3"
      />
    </div>
  );
}