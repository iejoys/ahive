import { useState, useMemo } from 'react';
import type { Edge } from 'reactflow';
import { useStore } from '../../store/useStore';
import { blackboard } from '../../scheduler/Blackboard';
import type { EdgeCondition, WorkflowEdge } from '../../types';

interface WorkflowEdgePanelProps {
  edge: Edge;
  onUpdate: (edge: WorkflowEdge) => void;
  onDelete: (edgeId: string) => void;
}

/** 判断连接线类型: normal=正常流程, fail=失败退回 */
function getEdgeType(targetHandle?: string): 'normal' | 'fail' {
  // 左侧连接点 = 失败退回线
  if (targetHandle === 'left') return 'fail';
  return 'normal';
}

export function WorkflowEdgePanel({ edge, onUpdate, onDelete }: WorkflowEdgePanelProps) {
  const { language } = useStore();
  
  // 获取连接点信息
  const targetHandle = edge.targetHandle as 'top' | 'left' | undefined;
  const edgeType = getEdgeType(targetHandle);
  
  // 解析现有条件
  const existingCondition = (edge.data?.failCondition || edge.data?.condition) as EdgeCondition | undefined;
  
  // 状态
  const [label, setLabel] = useState<string>(String(edge.label || ''));
  const [variableName, setVariableName] = useState(existingCondition?.variableName || '');
  const [operator, setOperator] = useState<EdgeCondition['operator']>(
    existingCondition?.operator || 'gte'
  );
  const [value, setValue] = useState<string>(String(existingCondition?.value ?? ''));
  
  // 获取黑板变量列表 (只显示用户变量)
  const blackboardVars = useMemo(() => {
    const state = blackboard.export();
    const allVars = Object.keys(state.variables || {});
    // 过滤系统变量
    const systemPrefixes = ['intent_', 'plan_', 'vote_', 'vote_result_', 'swarm_', 'retry_', 'recovery_', 'failure_', 'agent_health_'];
    return allVars.filter(key => !systemPrefixes.some(prefix => key.startsWith(prefix)));
  }, []);
  
  const t = {
    zh: {
      title: '编辑连接',
      edgeType: '连接类型',
      normal: '正常流程',
      fail: '失败退回',
      label: '标签',
      failCondition: '失败退回条件',
      variable: '黑板变量',
      operator: '判断条件',
      value: '阈值',
      gte: '≥ 大于等于',
      gt: '> 大于',
      eq: '= 等于',
      lte: '≤ 小于等于',
      lt: '< 小于',
      save: '保存',
      delete: '删除',
      variablePlaceholder: '输入变量名或选择',
      valuePlaceholder: '输入数值',
      normalDesc: '执行成功后继续',
      failDesc: '当条件不满足时退回此节点',
      failConditionHint: '当以下条件不满足时退回：',
      example: '例如: score < 80 时退回',
    },
    en: {
      title: 'Edit Connection',
      edgeType: 'Connection Type',
      normal: 'Normal Flow',
      fail: 'Fail Return',
      label: 'Label',
      failCondition: 'Fail Condition',
      variable: 'Variable',
      operator: 'Operator',
      value: 'Value',
      gte: '≥ Greater or Equal',
      gt: '> Greater',
      eq: '= Equal',
      lte: '≤ Less or Equal',
      lt: '< Less',
      save: 'Save',
      delete: 'Delete',
      variablePlaceholder: 'Enter variable name',
      valuePlaceholder: 'Enter value',
      normalDesc: 'Continue after success',
      failDesc: 'Return to this node when condition fails',
      failConditionHint: 'Return when condition is NOT met:',
      example: 'e.g.: Return when score < 80',
    },
  }[language];
  
  // 获取类型描述
  const getTypeDesc = () => {
    return edgeType === 'normal' ? t.normalDesc : t.failDesc;
  };
  
  // 获取类型颜色
  const getTypeColor = () => {
    return edgeType === 'normal' ? 'text-indigo-400' : 'text-red-400';
  };
  
  const handleSave = () => {
    const updatedEdge: WorkflowEdge = {
      id: edge.id,
      source: edge.source,
      sourceHandle: 'bottom',
      target: edge.target,
      targetHandle: targetHandle || 'top',
      label: label.length > 0 ? label : undefined,
      createdAt: new Date().toISOString(),
    };
    
    // 失败退回线需要保存条件
    if (edgeType === 'fail' && variableName && value) {
      updatedEdge.failCondition = {
        variableName,
        operator,
        value: isNaN(Number(value)) ? value : Number(value),
      };
    }
    
    onUpdate(updatedEdge);
  };
  
  const handleDelete = () => {
    onDelete(edge.id);
  };
  
  return (
    <div className="bg-gray-800 rounded-lg p-4 shadow-lg border border-gray-700 w-72">
      <h3 className="text-white font-medium mb-3">{t.title}</h3>
      
      {/* 连接类型显示 */}
      <div className="mb-3">
        <label className="text-gray-400 text-xs block mb-1">{t.edgeType}</label>
        <div className={`text-sm font-medium ${getTypeColor()}`}>
          {edgeType === 'normal' ? t.normal : t.fail}
        </div>
        <p className="text-gray-500 text-xs mt-1">{getTypeDesc()}</p>
      </div>
      
      {/* 标签 */}
      <div className="mb-3">
        <label className="text-gray-400 text-xs block mb-1">{t.label}</label>
        <input
          type="text"
          value={label || ''}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
          placeholder={language === 'zh' ? '如：审核通过' : 'e.g.: Approved'}
        />
      </div>
      
      {/* 失败条件配置 - 仅失败退回线显示 */}
      {edgeType === 'fail' && (
        <div className="space-y-3 pl-4 border-l-2 border-red-700">
          <div className="text-gray-400 text-xs">{t.failCondition}</div>
          <p className="text-gray-500 text-xs">{t.failConditionHint}</p>
          
          {/* 变量名 */}
          <div>
            <label className="text-gray-400 text-xs block mb-1">{t.variable}</label>
            <input
              type="text"
              list="blackboard-vars"
              value={variableName}
              onChange={(e) => setVariableName(e.target.value)}
              className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
              placeholder={t.variablePlaceholder}
            />
            {blackboardVars.length > 0 && (
              <datalist id="blackboard-vars">
                {blackboardVars.map(v => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            )}
          </div>
          
          {/* 操作符 */}
          <div>
            <label className="text-gray-400 text-xs block mb-1">{t.operator}</label>
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as EdgeCondition['operator'])}
              className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
            >
              <option value="gte">{t.gte}</option>
              <option value="gt">{t.gt}</option>
              <option value="eq">{t.eq}</option>
              <option value="lte">{t.lte}</option>
              <option value="lt">{t.lt}</option>
            </select>
          </div>
          
          {/* 值 */}
          <div>
            <label className="text-gray-400 text-xs block mb-1">{t.value}</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
              placeholder={t.valuePlaceholder}
            />
          </div>
          
          <p className="text-gray-500 text-xs italic">{t.example}</p>
        </div>
      )}
      
      {/* 操作按钮 */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={handleSave}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-1.5 rounded transition-colors"
        >
          {t.save}
        </button>
        <button
          onClick={handleDelete}
          className="bg-red-600 hover:bg-red-700 text-white text-sm py-1.5 px-3 rounded transition-colors"
        >
          {t.delete}
        </button>
      </div>
    </div>
  );
}