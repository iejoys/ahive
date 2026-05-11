/**
 * 规划节点配置面板
 * 
 * 配置 Planner 节点的参数
 */

import { useState, useEffect } from 'react';
import type { WorkflowNode, Agent } from '../../types';

interface PlannerConfigPanelProps {
  node: WorkflowNode;
  agents: Agent[];
  onUpdate: (node: WorkflowNode) => void;
  language: 'zh' | 'en';
}

export function PlannerConfigPanel({ node, agents, onUpdate, language }: PlannerConfigPanelProps) {
  // 获取当前配置
  const config = node.config?.plannerConfig || {};
  
  // 本地状态
  const [inputKey, setInputKey] = useState(config.inputKey || 'designDoc');
  const [planningPrompt, setPlanningPrompt] = useState(config.planningPrompt || '');
  const [plannerAgentId, setPlannerAgentId] = useState(config.plannerAgent?.agentId || '');
  
  // 同步状态
  useEffect(() => {
    const config = node.config?.plannerConfig || {};
    setInputKey(config.inputKey || 'designDoc');
    setPlanningPrompt(config.planningPrompt || '');
    setPlannerAgentId(config.plannerAgent?.agentId || '');
  }, [node]);
  
  // 更新配置
  const handleUpdate = () => {
    onUpdate({
      ...node,
      config: {
        ...node.config,
        plannerConfig: {
          inputKey,
          planningPrompt,
          outputSchema: {
            type: 'object',
            properties: {
              modules: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    batch: { type: 'number' },
                    priority: { type: 'string' },
                    techPoints: { type: 'array' },
                    dependsOn: { type: 'array' },
                  },
                },
              },
            },
          },
          targetNodeType: 'agent',
          plannerAgent: plannerAgentId ? { agentId: plannerAgentId } : undefined,
        },
      },
    });
  };
  
  return (
    <div className="space-y-4 p-4">
      {/* 输入数据键名 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '输入数据键名' : 'Input Key'}
        </label>
        <input
          type="text"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          onBlur={handleUpdate}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          placeholder={language === 'zh' ? '如: gameDesignDoc' : 'e.g. gameDesignDoc'}
        />
        <p className="text-xs text-gray-500 mt-1">
          {language === 'zh' 
            ? '上游节点输出的数据键名，通常是设计文档' 
            : 'Data key from upstream node output, usually design document'}
        </p>
      </div>
      
      {/* 规划提示词 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '规划提示词' : 'Planning Prompt'}
        </label>
        <textarea
          value={planningPrompt}
          onChange={(e) => setPlanningPrompt(e.target.value)}
          onBlur={handleUpdate}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm min-h-[200px]"
          placeholder={language === 'zh' 
            ? '根据设计文档分析开发需求，拆分为可独立开发的模块...' 
            : 'Analyze development requirements from design doc, split into independent modules...'}
        />
        <p className="text-xs text-gray-500 mt-1">
          {language === 'zh' 
            ? 'LLM将根据此提示词分析设计文档并生成任务列表' 
            : 'LLM will analyze design doc and generate task list based on this prompt'}
        </p>
      </div>
      
      {/* 规划Agent */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '规划Agent（可选）' : 'Planner Agent (Optional)'}
        </label>
        <select
          value={plannerAgentId}
          onChange={(e) => {
            setPlannerAgentId(e.target.value);
            setTimeout(handleUpdate, 0);
          }}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
        >
          <option value="">{language === 'zh' ? '使用默认Agent' : 'Use default agent'}</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.agentId || agent.id}>
              {agent.name || agent.id}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {language === 'zh' 
            ? '指定执行规划的Agent，不选则使用工作流默认Agent' 
            : 'Specify agent for planning, or use workflow default'}
        </p>
      </div>
      
      {/* 说明 */}
      <div className="bg-gray-700/50 rounded p-3 text-sm text-gray-400">
        <div className="font-medium text-gray-300 mb-2">
          {language === 'zh' ? '📋 输出格式说明' : '📋 Output Format'}
        </div>
        <div className="space-y-1">
          <div>• <code className="text-purple-400">modules</code>: {language === 'zh' ? '模块列表' : 'Module list'}</div>
          <div>• <code className="text-purple-400">batch</code>: {language === 'zh' ? '执行批次号' : 'Execution batch number'}</div>
          <div>• <code className="text-purple-400">dependsOn</code>: {language === 'zh' ? '依赖模块' : 'Dependencies'}</div>
        </div>
      </div>
    </div>
  );
}
