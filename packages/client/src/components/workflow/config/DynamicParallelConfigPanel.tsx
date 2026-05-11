/**
 * 动态并行节点配置面板
 * 
 * 配置 Dynamic-Parallel 节点的参数
 */

import { useState, useEffect } from 'react';
import type { WorkflowNode } from '../../types';

interface DynamicParallelConfigPanelProps {
  node: WorkflowNode;
  workflowNodes: WorkflowNode[];
  onUpdate: (node: WorkflowNode) => void;
  language: 'zh' | 'en';
}

export function DynamicParallelConfigPanel({ 
  node, 
  workflowNodes, 
  onUpdate, 
  language 
}: DynamicParallelConfigPanelProps) {
  // 获取当前配置
  const config = node.config || {};
  
  // 本地状态
  const [sourceNode, setSourceNode] = useState(config.sourceNode || '');
  const [sourceKey, setSourceKey] = useState(config.sourceKey || 'modules');
  const [batchField, setBatchField] = useState(config.batchField || 'batch');
  const [maxConcurrency, setMaxConcurrency] = useState(config.maxConcurrency || 3);
  const [mergeStrategy, setMergeStrategy] = useState(config.mergeStrategy || 'all');
  const [failureAction, setFailureAction] = useState(config.failureStrategy?.action || 'continue');
  const [taskTemplate, setTaskTemplate] = useState(config.nodeTemplate?.config?.taskTemplate || '');
  
  // 同步状态
  useEffect(() => {
    const config = node.config || {};
    setSourceNode(config.sourceNode || '');
    setSourceKey(config.sourceKey || 'modules');
    setBatchField(config.batchField || 'batch');
    setMaxConcurrency(config.maxConcurrency || 3);
    setMergeStrategy(config.mergeStrategy || 'all');
    setFailureAction(config.failureStrategy?.action || 'continue');
    setTaskTemplate(config.nodeTemplate?.config?.taskTemplate || '');
  }, [node]);
  
  // 更新配置
  const handleUpdate = () => {
    onUpdate({
      ...node,
      config: {
        sourceNode,
        sourceKey,
        batchField,
        maxConcurrency,
        mergeStrategy,
        failureStrategy: {
          action: failureAction,
        },
        nodeTemplate: {
          type: 'agent',
          config: {
            taskTemplate,
            timeout: 3600000,
          },
        },
      },
    });
  };
  
  // 过滤出 planner 类型的节点
  const plannerNodes = workflowNodes.filter(n => n.type === 'planner');
  
  return (
    <div className="space-y-4 p-4">
      {/* 数据来源节点 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '数据来源节点' : 'Source Node'}
        </label>
        <select
          value={sourceNode}
          onChange={(e) => {
            setSourceNode(e.target.value);
            setTimeout(handleUpdate, 0);
          }}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
        >
          <option value="">{language === 'zh' ? '选择规划节点' : 'Select planner node'}</option>
          {plannerNodes.map(n => (
            <option key={n.id} value={n.id}>
              {n.name || n.id}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
          {language === 'zh' 
            ? '选择上游的规划节点，获取其输出的模块列表' 
            : 'Select upstream planner node to get module list'}
        </p>
      </div>
      
      {/* 数据键名 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '数据键名' : 'Source Key'}
        </label>
        <input
          type="text"
          value={sourceKey}
          onChange={(e) => setSourceKey(e.target.value)}
          onBlur={handleUpdate}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          placeholder="modules"
        />
      </div>
      
      {/* 批次字段 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '批次字段名' : 'Batch Field'}
        </label>
        <input
          type="text"
          value={batchField}
          onChange={(e) => setBatchField(e.target.value)}
          onBlur={handleUpdate}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          placeholder="batch"
        />
      </div>
      
      {/* 最大并发数 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '每批次最大并发数' : 'Max Concurrency per Batch'}
        </label>
        <input
          type="number"
          value={maxConcurrency}
          onChange={(e) => setMaxConcurrency(parseInt(e.target.value) || 1)}
          onBlur={handleUpdate}
          min={1}
          max={10}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
        />
      </div>
      
      {/* 合并策略 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '合并策略' : 'Merge Strategy'}
        </label>
        <select
          value={mergeStrategy}
          onChange={(e) => {
            setMergeStrategy(e.target.value);
            setTimeout(handleUpdate, 0);
          }}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
        >
          <option value="all">{language === 'zh' ? '全部完成' : 'All Complete'}</option>
          <option value="any">{language === 'zh' ? '任一完成' : 'Any Complete'}</option>
          <option value="first">{language === 'zh' ? '首个完成' : 'First Complete'}</option>
        </select>
      </div>
      
      {/* 失败处理 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '失败处理' : 'Failure Action'}
        </label>
        <select
          value={failureAction}
          onChange={(e) => {
            setFailureAction(e.target.value);
            setTimeout(handleUpdate, 0);
          }}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
        >
          <option value="continue">{language === 'zh' ? '继续执行' : 'Continue'}</option>
          <option value="abort">{language === 'zh' ? '中止工作流' : 'Abort'}</option>
          <option value="retry">{language === 'zh' ? '重试' : 'Retry'}</option>
        </select>
      </div>
      
      {/* 任务模板 */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          {language === 'zh' ? '任务模板' : 'Task Template'}
        </label>
        <textarea
          value={taskTemplate}
          onChange={(e) => setTaskTemplate(e.target.value)}
          onBlur={handleUpdate}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm min-h-[120px]"
          placeholder={language === 'zh' 
            ? '开发模块: {{item.name}}\n描述: {{item.description}}' 
            : 'Develop module: {{item.name}}\nDescription: {{item.description}}'}
        />
        <p className="text-xs text-gray-500 mt-1">
          {language === 'zh' 
            ? '支持变量: {{item.name}}, {{item.description}}, {{item.batch}}, {{context.xxx}}' 
            : 'Variables: {{item.name}}, {{item.description}}, {{item.batch}}, {{context.xxx}}'}
        </p>
      </div>
      
      {/* 说明 */}
      <div className="bg-gray-700/50 rounded p-3 text-sm text-gray-400">
        <div className="font-medium text-gray-300 mb-2">
          {language === 'zh' ? '🔀 执行说明' : '🔀 Execution Info'}
        </div>
        <div className="space-y-1">
          <div>• {language === 'zh' ? '同批次内模块并行执行' : 'Modules in same batch execute in parallel'}</div>
          <div>• {language === 'zh' ? '不同批次顺序执行' : 'Different batches execute sequentially'}</div>
          <div>• {language === 'zh' ? 'batch=1 先执行，batch=2 等待 batch=1 完成后执行' : 'batch=1 first, batch=2 waits for batch=1'}</div>
        </div>
      </div>
    </div>
  );
}
