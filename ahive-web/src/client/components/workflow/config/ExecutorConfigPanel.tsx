/**
 * 执行者配置面板
 * 用于配置多执行者节点的执行策略
 * 
 * v2.1 新增:
 * - 输入映射配置 UI
 * - 输出映射配置 UI
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { blackboard } from '../../../scheduler/Blackboard';
import type { 
  WorkflowNode, 
  Agent,
  Department,
  ExecutorConfig,
  WorkflowNodeConfig,
  InputMapping,
  OutputMapping,
} from '../../../types';

// ========== 类型定义 ==========

export interface ExecutorConfigPanelProps {
  /** 当前节点 */
  node: WorkflowNode;
  /** 可用智能体列表 */
  agents: Agent[];
  /** 可用部门列表 */
  departments?: Department[];
  /** 工作流中所有节点 (用于前置节点选择) */
  workflowNodes?: WorkflowNode[];
  /** 配置更新回调 */
  onUpdate: (config: WorkflowNodeConfig) => void;
}

// ========== 执行模式说明 ==========

const executionModeDescriptions: Record<ExecutorConfig['mode'], { name: string; icon: string; desc: string }> = {
  single: {
    name: '单一执行',
    icon: '1️⃣',
    desc: '只由选中的第一个执行者执行',
  },
  any: {
    name: '任一执行',
    icon: '⚡',
    desc: '并行发送给所有执行者，任意一个完成即可',
  },
  all: {
    name: '全部执行',
    icon: '✓',
    desc: '并行发送给所有执行者，全部完成才算完成',
  },
  vote: {
    name: '投票决策',
    icon: '🗳️',
    desc: '并行发送给所有执行者，根据投票结果决定',
  },
  'round-robin': {
    name: '轮询执行',
    icon: '🔄',
    desc: '按顺序轮流分配给执行者，负载均衡',
  },
};

// ========== 默认任务模板生成器 ==========

function generateDefaultTemplate(node: WorkflowNode, agentName: string): string {
  const templates: Record<string, string> = {
    '代码编写': `## 任务
请编写代码完成以下任务。

## 要求
- 功能完整、逻辑清晰
- 代码风格规范
- 添加必要注释

## 输入
{{inputs}}

请开始编写代码。`,

    '代码审核': `## 审核任务
请对以下内容进行审核并给出评分。

## 审核标准
1. 代码质量 (0-40分)
2. 安全性 (0-30分)  
3. 性能 (0-30分)

## 待审核内容
{{inputs}}

请以以下格式回复：
评分: [总分/100]
理由: [审核意见]
问题: [具体问题列表]
建议: [改进建议]`,

    '文档编写': `## 任务
请编写文档。

## 要求
- 结构清晰
- 内容准确
- 示例完整

## 输入
{{inputs}}

请开始编写文档。`,

    '数据分析': `## 任务
请对以下数据进行分析。

## 输入数据
{{inputs}}

## 分析要求
- 数据概览
- 关键指标
- 趋势分析
- 结论建议

请开始分析。`,
  };
  
  // 根据节点名称匹配合适的模板
  for (const [key, template] of Object.entries(templates)) {
    if (node.name.includes(key)) {
      return template;
    }
  }
  
  // 默认模板
  return `## 任务
{{taskDescription}}

## 输入
{{inputs}}

## 要求
请根据以上信息执行任务，确保结果准确、完整。

请开始执行。`;
}

// ========== 默认配置 ==========

const defaultExecutorConfig: ExecutorConfig = {
  mode: 'single',
  executors: [],
  failureStrategy: {
    action: 'abort',
  },
};

// ========== 默认映射模板 ==========

const defaultInputMapping = (): InputMapping => ({
  name: '',
  source: 'blackboard',
  sourceKey: '',
  required: false,
});

const defaultOutputMapping = (): OutputMapping => ({
  name: '',
  extractPath: '$',
  required: false,
});

// ========== 主组件 ==========

export function ExecutorConfigPanel({ 
  node, 
  agents, 
  departments = [], 
  workflowNodes = [],
  onUpdate 
}: ExecutorConfigPanelProps) {
  const [config, setConfig] = useState<ExecutorConfig>(
    node.config?.executor || defaultExecutorConfig
  );
  
  // 任务模板
  const [taskTemplate, setTaskTemplate] = useState(node.config?.taskTemplate || '');
  
  // 输入映射
  const [inputMappings, setInputMappings] = useState<InputMapping[]>(
    node.config?.inputs || []
  );
  
  // 输出映射
  const [outputMappings, setOutputMappings] = useState<OutputMapping[]>(
    node.config?.outputs || []
  );
  
  // 获取黑板变量（用户变量）
  const blackboardVars = useMemo(() => {
    const vars = blackboard.getAllVariables();
    const systemPrefixes = ['intent_', 'plan_', 'vote_', 'vote_result_', 'swarm_', 'retry_', 'recovery_', 'failure_', 'agent_health_', 'protocol_', 'broadcast_', 'department_', 'email_', 'message_', 'webhook_', 'api_'];
    return vars
      .filter(v => !systemPrefixes.some(prefix => v.key.startsWith(prefix)))
      .map(v => ({ key: v.key, value: v.value }));
  }, []);
  
  // 当配置变化时通知父组件
  useEffect(() => {
    onUpdate({
      ...node.config,
      executor: config,
      taskTemplate,
      inputs: inputMappings,
      outputs: outputMappings,
    });
  }, [config, taskTemplate, inputMappings, outputMappings]);
  
  // 更新配置字段
  const updateConfig = <K extends keyof ExecutorConfig>(
    key: K,
    value: ExecutorConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };
  
  // ========== 输入映射操作 ==========
  
  const addInputMapping = useCallback(() => {
    setInputMappings(prev => [...prev, defaultInputMapping()]);
  }, []);
  
  const removeInputMapping = useCallback((index: number) => {
    setInputMappings(prev => prev.filter((_, i) => i !== index));
  }, []);
  
  const updateInputMapping = useCallback(<K extends keyof InputMapping>(
    index: number,
    key: K,
    value: InputMapping[K]
  ) => {
    setInputMappings(prev => prev.map((mapping, i) => 
      i === index ? { ...mapping, [key]: value } : mapping
    ));
  }, []);
  
  // ========== 输出映射操作 ==========
  
  const addOutputMapping = useCallback(() => {
    setOutputMappings(prev => [...prev, defaultOutputMapping()]);
  }, []);
  
  const removeOutputMapping = useCallback((index: number) => {
    setOutputMappings(prev => prev.filter((_, i) => i !== index));
  }, []);
  
  const updateOutputMapping = useCallback(<K extends keyof OutputMapping>(
    index: number,
    key: K,
    value: OutputMapping[K]
  ) => {
    setOutputMappings(prev => prev.map((mapping, i) => 
      i === index ? { ...mapping, [key]: value } : mapping
    ));
  }, []);
  
  // 自动生成模板
  const handleGenerateTemplate = () => {
    const executorName = config.executors[0] 
      ? getExecutorName(config.executors[0].type, config.executors[0].id)
      : '智能体';
    const template = generateDefaultTemplate(node, executorName);
    setTaskTemplate(template);
  };
  
  // 清空模板
  const handleClearTemplate = () => {
    setTaskTemplate('');
  };
  
  // 插入变量
  const insertVariable = (varName: string) => {
    const insertion = `{{${varName}}}`;
    setTaskTemplate(prev => prev + insertion);
  };
  
  // 添加执行者
  const addExecutor = (type: 'agent' | 'department', id: string) => {
    if (!id) return;
    
    // 检查是否已存在
    if (config.executors.some(e => e.id === id)) return;
    
    updateConfig('executors', [
      ...config.executors,
      { type, id, weight: 1 },
    ]);
  };
  
  // 移除执行者
  const removeExecutor = (id: string) => {
    updateConfig('executors', config.executors.filter(e => e.id !== id));
  };
  
  // 更新执行者权重
  const updateExecutorWeight = (id: string, weight: number) => {
    updateConfig('executors', 
      config.executors.map(e => 
        e.id === id ? { ...e, weight } : e
      )
    );
  };
  
  // 获取执行者名称（兼容 id 和 agentId 匹配）
  const getExecutorName = (type: 'agent' | 'department', id: string) => {
    if (type === 'agent') {
      const agent = agents.find(a => a.id === id || a.agentId === id);
      return agent?.name || id;
    } else {
      const dept = departments.find(d => d.id === id);
      return dept?.name || id;
    }
  };
  
  return (
    <div className="executor-config-panel space-y-4 p-4">
      {/* ========== 输入映射配置（高级功能） ========== */}
      <div className="form-group">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <span>📥</span>
            输入映射
            <span className="text-xs text-gray-500 font-normal">(高级)</span>
          </label>
          <button
            type="button"
            onClick={addInputMapping}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
          >
            + 添加
          </button>
        </div>
        
        <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2 mb-2">
          <div className="text-blue-400 text-xs">
            💡 模板中的变量会自动从黑板获取，无需配置。此功能用于：
          </div>
          <ul className="text-gray-400 text-xs mt-1 ml-4 list-disc">
            <li>从前置节点输出获取数据</li>
            <li>变量重命名（如：黑板变量 → 模板变量）</li>
            <li>设置默认值或必填验证</li>
          </ul>
        </div>
        
        {inputMappings.length > 0 ? (
          <div className="space-y-2">
            {inputMappings.map((mapping, index) => (
              <div key={index} className="bg-gray-700/50 rounded p-3 border border-gray-600">
                <div className="grid grid-cols-2 gap-2">
                  {/* 变量名 */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">
                      变量名 <span className="text-gray-500">(模板中使用)</span>
                    </label>
                    <input
                      type="text"
                      value={mapping.name}
                      onChange={(e) => updateInputMapping(index, 'name', e.target.value)}
                      placeholder="myVariable"
                      className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  
                  {/* 数据来源 */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">数据来源</label>
                    <select
                      value={mapping.source}
                      onChange={(e) => updateInputMapping(index, 'source', e.target.value as InputMapping['source'])}
                      className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="blackboard">黑板变量</option>
                      <option value="prev-output">前置节点输出</option>
                      <option value="user-input">用户输入</option>
                    </select>
                  </div>
                </div>
                
                {/* 根据来源类型显示不同配置 */}
                {mapping.source === 'blackboard' && (
                  <div className="mt-2">
                    <label className="text-xs text-gray-400 block mb-1">黑板变量名</label>
                    <select
                      value={mapping.sourceKey || ''}
                      onChange={(e) => updateInputMapping(index, 'sourceKey', e.target.value)}
                      className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">-- 选择变量 --</option>
                      {blackboardVars.map(v => (
                        <option key={v.key} value={v.key}>{v.key}</option>
                      ))}
                    </select>
                  </div>
                )}
                
                {mapping.source === 'prev-output' && (
                  <div className="mt-2">
                    <label className="text-xs text-gray-400 block mb-1">
                      来源节点:变量名 <span className="text-gray-500">(格式: nodeId:varName)</span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={mapping.sourceKey?.split(':')[0] || ''}
                        onChange={(e) => {
                          const varName = mapping.sourceKey?.split(':')[1] || '';
                          updateInputMapping(index, 'sourceKey', e.target.value ? `${e.target.value}:${varName}` : '');
                        }}
                        className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">-- 选择节点 --</option>
                        {workflowNodes
                          .filter(n => n.id !== node.id)
                          .map(n => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                          ))
                        }
                      </select>
                      <input
                        type="text"
                        value={mapping.sourceKey?.split(':')[1] || ''}
                        onChange={(e) => {
                          const nodeId = mapping.sourceKey?.split(':')[0] || '';
                          updateInputMapping(index, 'sourceKey', e.target.value ? `${nodeId}:${e.target.value}` : nodeId);
                        }}
                        placeholder="变量名"
                        className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm font-mono focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
                
                {/* 默认值和必填 */}
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">默认值 (可选)</label>
                    <input
                      type="text"
                      value={mapping.defaultValue !== undefined ? String(mapping.defaultValue) : ''}
                      onChange={(e) => updateInputMapping(index, 'defaultValue', e.target.value || undefined)}
                      placeholder="默认值"
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-gray-300 mt-4">
                    <input
                      type="checkbox"
                      checked={mapping.required || false}
                      onChange={(e) => updateInputMapping(index, 'required', e.target.checked)}
                      className="rounded"
                    />
                    必填
                  </label>
                  <button
                    type="button"
                    onClick={() => removeInputMapping(index)}
                    className="text-red-400 hover:text-red-300 text-xs mt-4"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm text-center py-2 bg-gray-700/30 rounded border border-gray-600">
            ✓ 模板变量将自动从黑板获取，如需从前置节点获取请添加映射
          </div>
        )}
      </div>
      
      {/* ========== 任务模板编辑 ========== */}
      <div className="form-group border-t border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <span>📝</span>
            任务模板（提示词）
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleGenerateTemplate}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded"
            >
              ✨ 自动生成
            </button>
            <button
              type="button"
              onClick={handleClearTemplate}
              className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
            >
              清空
            </button>
          </div>
        </div>
        
        {/* 模板编辑区 */}
        <div className="relative">
          <textarea
            value={taskTemplate}
            onChange={(e) => setTaskTemplate(e.target.value)}
            placeholder="输入任务提示词，使用 {{变量名}} 插入黑板变量..."
            rows={6}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono focus:border-indigo-500 focus:outline-none resize-y"
          />
          
          {/* 变量快捷插入 */}
          {blackboardVars.length > 0 && (
            <div className="mt-2 p-2 bg-gray-800 rounded border border-gray-700">
              <div className="text-gray-400 text-xs mb-1">📋 可用变量 (点击插入):</div>
              <div className="flex flex-wrap gap-1">
                {blackboardVars.slice(0, 10).map(v => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVariable(v.key)}
                    className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded font-mono"
                    title={`值: ${JSON.stringify(v.value).slice(0, 50)}`}
                  >
                    {v.key}
                  </button>
                ))}
                {blackboardVars.length > 10 && (
                  <span className="text-gray-500 text-xs">+{blackboardVars.length - 10} 更多</span>
                )}
              </div>
            </div>
          )}
          
          {/* 模板语法提示 */}
          <div className="mt-2 text-xs text-gray-500">
            💡 支持 <code className="bg-gray-700 px-1 rounded">{'{{变量名}}'}</code> 插值、
            <code className="bg-gray-700 px-1 rounded">{'{{#if 条件}}'}</code> 条件、
            <code className="bg-gray-700 px-1 rounded">{'{{#each 数组}}'}</code> 循环
          </div>
        </div>
      </div>
      
      {/* ========== 输出映射配置 ========== */}
      <div className="form-group border-t border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <span>📤</span>
            输出映射
          </label>
          <button
            type="button"
            onClick={addOutputMapping}
            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
          >
            + 添加输出
          </button>
        </div>
        
        <div className="text-gray-500 text-xs mb-2">
          定义如何从 Agent 回复中提取数据存入黑板
        </div>
        
        {outputMappings.length > 0 ? (
          <div className="space-y-2">
            {outputMappings.map((mapping, index) => (
              <div key={index} className="bg-gray-700/50 rounded p-3 border border-gray-600">
                <div className="grid grid-cols-2 gap-2">
                  {/* 变量名 */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">
                      变量名 <span className="text-gray-500">(存入黑板)</span>
                    </label>
                    <input
                      type="text"
                      value={mapping.name}
                      onChange={(e) => updateOutputMapping(index, 'name', e.target.value)}
                      placeholder="myResult"
                      className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  
                  {/* 提取路径 */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">
                      提取路径 <span className="text-gray-500">(JSONPath)</span>
                    </label>
                    <input
                      type="text"
                      value={mapping.extractPath}
                      onChange={(e) => updateOutputMapping(index, 'extractPath', e.target.value)}
                      placeholder="$.result.data"
                      className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                
                {/* 提取路径示例 */}
                <div className="mt-2 text-xs text-gray-500">
                  <span className="text-gray-400">示例:</span>{' '}
                  <code className="bg-gray-700 px-1 rounded">$.name</code>、
                  <code className="bg-gray-700 px-1 rounded">$.items[0]</code>、
                  <code className="bg-gray-700 px-1 rounded">$.data.result</code>
                </div>
                
                {/* 描述 */}
                <div className="mt-2">
                  <label className="text-xs text-gray-400 block mb-1">说明 (可选)</label>
                  <input
                    type="text"
                    value={mapping.description || ''}
                    onChange={(e) => updateOutputMapping(index, 'description', e.target.value)}
                    placeholder="变量用途说明"
                    className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                
                {/* 必填和删除 */}
                <div className="mt-2 flex items-center gap-4">
                  <label className="flex items-center gap-1 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={mapping.required || false}
                      onChange={(e) => updateOutputMapping(index, 'required', e.target.checked)}
                      className="rounded"
                    />
                    必须提取成功
                  </label>
                  <button
                    type="button"
                    onClick={() => removeOutputMapping(index)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-orange-500/80 text-sm text-center py-3 bg-orange-500/10 rounded border border-orange-500/30">
            ⚠️ 未配置输出映射，Agent 的回复将不会写入黑板
          </div>
        )}
      </div>
      
      {/* ========== 执行者选择 ========== */}
      <div className="form-group border-t border-gray-700 pt-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          🤖 执行者
        </label>
        <div className="space-y-2">
          {(Object.keys(executionModeDescriptions) as ExecutorConfig['mode'][]).map(mode => {
            const info = executionModeDescriptions[mode];
            return (
              <label
                key={mode}
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  config.mode === mode
                    ? 'bg-indigo-600/20 border-indigo-500'
                    : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'
                }`}
              >
                <input
                  type="radio"
                  name="executionMode"
                  checked={config.mode === mode}
                  onChange={() => updateConfig('mode', mode)}
                  className="mt-0.5"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span>{info.icon}</span>
                    <span className="text-white font-medium">{info.name}</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">{info.desc}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>
      
      {/* 执行者列表 */}
      <div className="form-group">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">
            执行者列表
          </label>
          <div className="flex gap-2">
            {/* 添加智能体 */}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  addExecutor('agent', e.target.value);
                  e.target.value = '';
                }
              }}
              className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">+ 添加智能体</option>
              {agents
                .filter(a => !config.executors.some(e => e.id === a.id || e.id === a.agentId))
                .map(agent => (
                  <option key={agent.id} value={agent.agentId || agent.id}>
                    {agent.name}
                  </option>
                ))
              }
            </select>
            
            {/* 添加部门 */}
            {departments.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addExecutor('department', e.target.value);
                    e.target.value = '';
                  }
                }}
                className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="">+ 添加部门</option>
                {departments
                  .filter(d => !config.executors.some(e => e.id === d.id))
                  .map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.icon} {dept.name}
                    </option>
                  ))
                }
              </select>
            )}
          </div>
        </div>
        
        {/* 已添加的执行者 */}
        {config.executors.length > 0 ? (
          <div className="space-y-2">
            {config.executors.map((executor, index) => (
              <div
                key={executor.id}
                className="flex items-center gap-2 bg-gray-700/50 rounded p-2"
              >
                <span className="text-gray-500 text-xs w-4">{index + 1}</span>
                <span className="text-lg">
                  {executor.type === 'agent' ? '🤖' : '👥'}
                </span>
                <span className="text-white text-sm flex-1">
                  {getExecutorName(executor.type, executor.id)}
                </span>
                
                {/* 投票模式显示权重 */}
                {config.mode === 'vote' && (
                  <input
                    type="number"
                    value={executor.weight || 1}
                    onChange={(e) => updateExecutorWeight(executor.id, Number(e.target.value))}
                    placeholder="权重"
                    min={1}
                    max={10}
                    className="w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm text-center"
                  />
                )}
                
                <button
                  type="button"
                  onClick={() => removeExecutor(executor.id)}
                  className="text-gray-400 hover:text-red-400 px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm text-center py-4 bg-gray-700/30 rounded">
            请添加至少一个执行者
          </div>
        )}
      </div>
      
      {/* 投票配置 (仅投票模式显示) */}
      {config.mode === 'vote' && (
        <div className="form-group border-t border-gray-700 pt-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            🗳️ 投票配置
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs">投票方法</label>
              <select
                value={config.voteConfig?.method || 'majority'}
                onChange={(e) => updateConfig('voteConfig', {
                  ...config.voteConfig,
                  method: e.target.value as 'majority' | 'unanimous' | 'weighted',
                  timeout: config.voteConfig?.timeout || 60000,
                })}
                className="w-full mt-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              >
                <option value="majority">简单多数 (&gt;50%)</option>
                <option value="unanimous">一致同意 (100%)</option>
                <option value="weighted">加权投票</option>
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs">投票超时 (秒)</label>
              <input
                type="number"
                value={(config.voteConfig?.timeout || 60000) / 1000}
                onChange={(e) => updateConfig('voteConfig', {
                  ...config.voteConfig,
                  method: config.voteConfig?.method || 'majority',
                  timeout: Number(e.target.value) * 1000,
                })}
                min={10}
                max={600}
                className="w-full mt-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              />
            </div>
          </div>
        </div>
      )}
      
      {/* 失败策略 */}
      <div className="form-group border-t border-gray-700 pt-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          ⚠️ 失败策略
        </label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'abort', label: '中止工作流', icon: '⏹️' },
            { value: 'continue', label: '继续执行', icon: '▶️' },
            { value: 'retry', label: '重试', icon: '🔄' },
            { value: 'fallback', label: '降级执行', icon: '⬇️' },
          ].map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateConfig('failureStrategy', {
                ...config.failureStrategy,
                action: option.value as ExecutorConfig['failureStrategy']['action'],
              })}
              className={`px-3 py-2 rounded border text-sm transition-colors ${
                config.failureStrategy.action === option.value
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {option.icon} {option.label}
            </button>
          ))}
        </div>
        
        {/* 重试次数 (重试策略时显示) */}
        {config.failureStrategy.action === 'retry' && (
          <div className="mt-3">
            <label className="text-gray-400 text-xs">最大重试次数</label>
            <input
              type="number"
              value={config.failureStrategy.retryCount || 3}
              onChange={(e) => updateConfig('failureStrategy', {
                ...config.failureStrategy,
                retryCount: Number(e.target.value),
              })}
              min={1}
              max={10}
              className="w-24 mt-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
            />
          </div>
        )}
        
        {/* 降级执行者 (降级策略时显示) */}
        {config.failureStrategy.action === 'fallback' && (
          <div className="mt-3">
            <label className="text-gray-400 text-xs">降级执行者</label>
            <select
              value={config.failureStrategy.fallbackExecutorId || ''}
              onChange={(e) => updateConfig('failureStrategy', {
                ...config.failureStrategy,
                fallbackExecutorId: e.target.value,
              })}
              className="w-full mt-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
            >
              <option value="">选择降级执行者...</option>
              {agents
                .filter(a => !config.executors.some(e => e.id === a.id || e.id === a.agentId))
                .map(agent => (
                  <option key={agent.id} value={agent.agentId || agent.id}>
                    {agent.name}
                  </option>
                ))
              }
            </select>
          </div>
        )}
      </div>
      
      {/* 执行预览 */}
      {config.executors.length > 0 && (
        <div className="form-group border-t border-gray-700 pt-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            📊 执行预览
          </label>
          <div className="bg-gray-700/30 rounded p-3 text-sm">
            <div className="flex items-center gap-2 text-gray-300">
              <span>{executionModeDescriptions[config.mode].icon}</span>
              <span>{executionModeDescriptions[config.mode].name}</span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              {config.executors.map((e, i) => (
                <span key={e.id} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className="text-gray-500 mx-1">
                      {config.mode === 'all' || config.mode === 'vote' ? '&' : 
                       config.mode === 'any' ? '|' : '→'}
                    </span>
                  )}
                  <span className="bg-gray-600 px-2 py-0.5 rounded text-xs">
                    {getExecutorName(e.type, e.id)}
                  </span>
                </span>
              ))}
            </div>
            
            {/* 输入输出预览 */}
            {(inputMappings.length > 0 || outputMappings.length > 0) && (
              <div className="mt-2 pt-2 border-t border-gray-600 text-xs">
                {inputMappings.length > 0 && (
                  <div className="text-gray-400">
                    <span className="text-green-400">输入:</span>{' '}
                    {inputMappings.filter(m => m.name).map(m => m.name).join(', ') || '(未配置)'}
                  </div>
                )}
                {outputMappings.length > 0 && (
                  <div className="text-gray-400 mt-1">
                    <span className="text-blue-400">输出:</span>{' '}
                    {outputMappings.filter(m => m.name).map(m => m.name).join(', ') || '(未配置)'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ExecutorConfigPanel;