/**
 * 审核节点配置面板
 * 用于配置智能体审核/人工审核流程
 */

import { useState, useEffect } from 'react';
import type { 
  WorkflowNode, 
  Agent, 
  ReviewNodeConfig,
  WorkflowNodeConfig 
} from '../../../types';

// ========== 类型定义 ==========

export interface ReviewConfigPanelProps {
  /** 当前节点 */
  node: WorkflowNode;
  /** 可用智能体列表 */
  agents: Agent[];
  /** 工作流内其他节点 (用于退回目标选择) */
  workflowNodes?: WorkflowNode[];
  /** 配置更新回调 */
  onUpdate: (config: WorkflowNodeConfig) => void;
}

// ========== 默认配置 ==========

// 默认审核报告要求
const defaultReviewReportInstruction = '审核完成后，请生成审核报告文件，保存到与被审核目标文档相同的目录下，命名规范为：{被审核文档名}_审核报告{日期时间}.md，并在汇报审核结果时将该审核报告的路径附在汇报中一起返回。';

const defaultReviewConfig: ReviewNodeConfig = {
  reviewType: 'agent',
  title: '审核任务',
  instruction: '',
  scoreMethod: 'score',
  passCondition: {
    variableName: 'review_score',
    operator: 'gte',
    threshold: 80,
  },
  failAction: {
    type: 'return',
  },
  reviewReportInstruction: defaultReviewReportInstruction,
};

// ========== 主组件 ==========

export function ReviewConfigPanel({
  node,
  agents,
  workflowNodes = [],
  onUpdate,
}: ReviewConfigPanelProps) {
  // 从节点配置中获取审核配置，或使用默认值
  const [config, setConfig] = useState<ReviewNodeConfig>(
    node.config?.reviewConfig || defaultReviewConfig
  );
  
  // 当配置变化时通知父组件
  useEffect(() => {
    const newConfig: WorkflowNodeConfig = {
      ...node.config,
      reviewConfig: config,
    };
    onUpdate(newConfig);
  }, [config]);
  
  // 更新配置字段
  const updateConfig = <K extends keyof ReviewNodeConfig>(
    key: K,
    value: ReviewNodeConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };
  
  // 添加评分项
  const addCriteria = () => {
    const criteria = config.criteria || [];
    updateConfig('criteria', [
      ...criteria,
      { name: `评分项${criteria.length + 1}`, description: '', weight: 1 },
    ]);
  };
  
  // 更新评分项
  const updateCriteria = (
    index: number,
    field: 'name' | 'description' | 'weight',
    value: string | number
  ) => {
    const criteria = config.criteria || [];
    criteria[index] = { ...criteria[index], [field]: value };
    updateConfig('criteria', [...criteria]);
  };
  
  // 删除评分项
  const removeCriteria = (index: number) => {
    const criteria = config.criteria || [];
    updateConfig('criteria', criteria.filter((_, i) => i !== index));
  };
  
  // 获取前置节点列表 (用于退回目标选择)
  const getPreviousNodes = () => {
    // 简单实现：返回所有其他节点
    return workflowNodes.filter(n => n.id !== node.id);
  };
  
  return (
    <div className="review-config-panel space-y-4 p-4">
      {/* 审核类型 */}
      <div className="form-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          审核类型
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => updateConfig('reviewType', 'agent')}
            className={`flex-1 px-3 py-2 rounded border transition-colors ${
              config.reviewType === 'agent'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            }`}
          >
            🤖 智能体审核
          </button>
          <button
            type="button"
            onClick={() => updateConfig('reviewType', 'human')}
            className={`flex-1 px-3 py-2 rounded border transition-colors ${
              config.reviewType === 'human'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            }`}
          >
            👤 人工审核
          </button>
        </div>
      </div>
      
      {/* 智能体审核时选择审核者 */}
      {config.reviewType === 'agent' && (
        <div className="form-group">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            审核智能体
          </label>
          <select
            value={config.reviewerAgentId || ''}
            onChange={(e) => updateConfig('reviewerAgentId', e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="">选择审核智能体...</option>
            {agents.map(agent => (
              <option key={agent.id} value={agent.agentId || agent.id}>
                {agent.name} {agent.group ? `(${agent.group})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      
      {/* 审核标题 */}
      <div className="form-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          审核标题
        </label>
        <input
          type="text"
          value={config.title}
          onChange={(e) => updateConfig('title', e.target.value)}
          placeholder="如：代码审核、质量检查"
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      
      {/* 审核说明 */}
      <div className="form-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          审核说明
        </label>
        <textarea
          value={config.instruction}
          onChange={(e) => updateConfig('instruction', e.target.value)}
          placeholder="描述审核要求和标准..."
          rows={3}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:border-indigo-500 focus:outline-none resize-none"
        />
      </div>
      
      {/* 审核报告要求 */}
      <div className="form-group">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">
            审核报告要求
          </label>
          <button
            type="button"
            onClick={() => updateConfig('reviewReportInstruction', defaultReviewReportInstruction)}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            重置为默认
          </button>
        </div>
        <textarea
          value={config.reviewReportInstruction || defaultReviewReportInstruction}
          onChange={(e) => updateConfig('reviewReportInstruction', e.target.value)}
          placeholder="描述审核报告的保存位置和命名规范..."
          rows={3}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:border-indigo-500 focus:outline-none resize-none"
        />
      </div>
      
      {/* 评分方式 */}
      <div className="form-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          评分方式
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => updateConfig('scoreMethod', 'score')}
            className={`flex-1 px-3 py-2 rounded border transition-colors text-sm ${
              config.scoreMethod === 'score'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            }`}
          >
            📊 分数 (0-100)
          </button>
          <button
            type="button"
            onClick={() => updateConfig('scoreMethod', 'stars')}
            className={`flex-1 px-3 py-2 rounded border transition-colors text-sm ${
              config.scoreMethod === 'stars'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            }`}
          >
            ⭐ 星级 (1-5)
          </button>
          <button
            type="button"
            onClick={() => updateConfig('scoreMethod', 'pass_fail')}
            className={`flex-1 px-3 py-2 rounded border transition-colors text-sm ${
              config.scoreMethod === 'pass_fail'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            }`}
          >
            ✓✗ 通过/不通过
          </button>
        </div>
      </div>
      
      {/* 评分项配置 (可选) */}
      <div className="form-group">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">
            评分项 (可选)
          </label>
          <button
            type="button"
            onClick={addCriteria}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            + 添加评分项
          </button>
        </div>
        
        {config.criteria && config.criteria.length > 0 && (
          <div className="space-y-2">
            {config.criteria.map((c, i) => (
              <div 
                key={i} 
                className="bg-gray-700/50 rounded p-3 space-y-2"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={c.name}
                    onChange={(e) => updateCriteria(i, 'name', e.target.value)}
                    placeholder="评分项名称"
                    className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="number"
                    value={c.weight}
                    onChange={(e) => updateCriteria(i, 'weight', Number(e.target.value))}
                    placeholder="权重"
                    min={0.1}
                    step={0.1}
                    className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeCriteria(i)}
                    className="px-2 py-1 text-gray-400 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
                <input
                  type="text"
                  value={c.description}
                  onChange={(e) => updateCriteria(i, 'description', e.target.value)}
                  placeholder="评分项说明"
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* 通过条件 */}
      <div className="form-group border-t border-gray-700 pt-4">
        <label className="block text-sm font-medium text-green-400 mb-2">
          ✓ 通过条件
        </label>
        <div className="flex gap-2 items-center">
          <span className="text-gray-400 text-sm">审核评分</span>
          <select
            value={config.passCondition.operator}
            onChange={(e) => updateConfig('passCondition', {
              ...config.passCondition,
              operator: e.target.value as ReviewNodeConfig['passCondition']['operator'],
            })}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="gte">≥ 大于等于</option>
            <option value="gt">&gt; 大于</option>
            <option value="eq">= 等于</option>
            <option value="lte">≤ 小于等于</option>
            <option value="lt">&lt; 小于</option>
          </select>
          <input
            type="number"
            value={config.passCondition.threshold}
            onChange={(e) => updateConfig('passCondition', {
              ...config.passCondition,
              threshold: Number(e.target.value),
            })}
            placeholder="80"
            min={0}
            max={config.scoreMethod === 'score' ? 100 : config.scoreMethod === 'stars' ? 5 : 1}
            className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>
      
      {/* 不通过处理 */}
      <div className="form-group border-t border-gray-700 pt-4">
        <label className="block text-sm font-medium text-red-400 mb-2">
          ✗ 不通过处理
        </label>
        
        <div className="space-y-2">
          {/* 退回到指定节点 */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="failAction"
              checked={config.failAction.type === 'return'}
              onChange={() => updateConfig('failAction', { ...config.failAction, type: 'return' })}
              className="mt-1"
            />
            <div>
              <span className="text-gray-300">退回到指定节点</span>
              {config.failAction.type === 'return' && (
                <select
                  value={config.failAction.targetNodeId || ''}
                  onChange={(e) => updateConfig('failAction', { 
                    ...config.failAction, 
                    targetNodeId: e.target.value 
                  })}
                  className="ml-2 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                >
                  <option value="">选择退回节点...</option>
                  {getPreviousNodes().map(n => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              )}
            </div>
          </label>
          
          {/* 重试当前节点 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="failAction"
              checked={config.failAction.type === 'retry'}
              onChange={() => updateConfig('failAction', { ...config.failAction, type: 'retry' })}
            />
            <span className="text-gray-300">重试当前节点</span>
            {config.failAction.type === 'retry' && (
              <input
                type="number"
                value={config.failAction.maxRetries || 3}
                onChange={(e) => updateConfig('failAction', { 
                  ...config.failAction, 
                  maxRetries: Number(e.target.value) 
                })}
                placeholder="最大重试次数"
                min={1}
                max={10}
                className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              />
            )}
          </label>
          
          {/* 中止工作流 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="failAction"
              checked={config.failAction.type === 'abort'}
              onChange={() => updateConfig('failAction', { ...config.failAction, type: 'abort' })}
            />
            <span className="text-gray-300">中止工作流</span>
          </label>
          
          {/* 跳转到指定节点 */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="failAction"
              checked={config.failAction.type === 'branch'}
              onChange={() => updateConfig('failAction', { ...config.failAction, type: 'branch' })}
            />
            <div>
              <span className="text-gray-300">跳转到指定节点</span>
              {config.failAction.type === 'branch' && (
                <select
                  value={config.failAction.targetNodeId || ''}
                  onChange={(e) => updateConfig('failAction', { 
                    ...config.failAction, 
                    targetNodeId: e.target.value 
                  })}
                  className="ml-2 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                >
                  <option value="">选择跳转节点...</option>
                  {workflowNodes.filter(n => n.id !== node.id).map(n => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              )}
            </div>
          </label>
        </div>
      </div>
      
      {/* 重试提示词修改 */}
      {(config.failAction.type === 'return' || config.failAction.type === 'retry') && (
        <div className="form-group">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            重试提示词修改
          </label>
          <textarea
            value={config.failAction.retryPromptModifier || ''}
            onChange={(e) => updateConfig('failAction', { 
              ...config.failAction, 
              retryPromptModifier: e.target.value 
            })}
            placeholder="附加到原提示词的内容，如：请根据审核意见改进..."
            rows={2}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 text-sm focus:border-indigo-500 focus:outline-none resize-none"
          />
        </div>
      )}
    </div>
  );
}

export default ReviewConfigPanel;