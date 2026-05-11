/**
 * 工作流模拟执行面板
 * 提供模拟执行的可视化界面
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { 
  WorkflowSimulator, 
  simulateWorkflow,
  type SimulationContext,
  type NodeSimulationResult,
  type SimulationIssue,
  type SimulationReport,
} from '../../scheduler/WorkflowSimulator';
import type { Workflow, Department } from '../../types';

interface SimulationPanelProps {
  onClose: () => void;
}

/** 节点状态图标 */
const NodeStatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case 'success': return <span className="text-green-400">✅</span>;
    case 'failed': return <span className="text-red-400">❌</span>;
    case 'warning': return <span className="text-yellow-400">⚠️</span>;
    case 'skipped': return <span className="text-gray-400">⏭️</span>;
    default: return <span className="text-gray-400">⏳</span>;
  }
};

/** 问题类型图标 */
const IssueIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'error': return <span className="text-red-400">🔴</span>;
    case 'warning': return <span className="text-yellow-400">🟡</span>;
    case 'info': return <span className="text-blue-400">🔵</span>;
    default: return <span className="text-gray-400">⚪</span>;
  }
};

export function SimulationPanel({ onClose }: SimulationPanelProps) {
  const { language, agents, departments, workflows, currentWorkflowId } = useStore();
  
  // 状态 - 必须在条件判断之前调用
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [context, setContext] = useState<SimulationContext | null>(null);
  const [nodeResults, setNodeResults] = useState<NodeSimulationResult[]>([]);
  const [issues, setIssues] = useState<SimulationIssue[]>([]);
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [simulator, setSimulator] = useState<WorkflowSimulator | null>(null);
  const [activeTab, setActiveTab] = useState<'execution' | 'issues' | 'blackboard'>('execution');
  
  // 获取当前工作流
  const workflow = workflows.find(w => w.id === currentWorkflowId);
  
  // 开始模拟
  const startSimulation = useCallback(async () => {
    if (!workflow) return;
    
    setIsRunning(true);
    setIsPaused(false);
    setNodeResults([]);
    setIssues([]);
    setReport(null);
    
    const callbacks = {
      onStateChange: (ctx: SimulationContext) => {
        setContext(ctx);
      },
      onNodeStart: (nodeId: string, nodeName: string) => {
        console.log(`[SimulationPanel] Node started: ${nodeName}`);
      },
      onNodeComplete: (result: NodeSimulationResult) => {
        setNodeResults(prev => [...prev, result]);
      },
      onIssueDetected: (issue: SimulationIssue) => {
        setIssues(prev => [...prev, issue]);
      },
      onComplete: (rep: SimulationReport) => {
        setReport(rep);
        setIsRunning(false);
      },
    };
    
    const sim = new WorkflowSimulator(workflow, agents, departments as Department[], callbacks);
    setSimulator(sim);
    
    try {
      const result = await sim.run();
      setReport(result);
    } catch (error) {
      console.error('[SimulationPanel] Simulation failed:', error);
      setIssues(prev => [...prev, {
        type: 'error',
        code: 'SIMULATION_ERROR',
        message: `模拟执行失败: ${error}`,
      }]);
    }
    
    setIsRunning(false);
  }, [workflow, agents, departments]);
  
  // 暂停/恢复
  const togglePause = useCallback(() => {
    if (!simulator) return;
    
    if (isPaused) {
      simulator.resume();
      setIsPaused(false);
    } else {
      simulator.pause();
      setIsPaused(true);
    }
  }, [simulator, isPaused]);
  
  // 停止
  const stopSimulation = useCallback(() => {
    if (!simulator) return;
    simulator.stop();
    setIsRunning(false);
    setIsPaused(false);
  }, [simulator]);
  
  // 获取节点类型显示名
  const getNodeTypeName = (type: string) => {
    const names: Record<string, { zh: string; en: string }> = {
      agent: { zh: '智能体', en: 'Agent' },
      condition: { zh: '条件分支', en: 'Condition' },
      parallel: { zh: '并行执行', en: 'Parallel' },
      loop: { zh: '循环', en: 'Loop' },
      delay: { zh: '延时', en: 'Delay' },
      variable: { zh: '变量', en: 'Variable' },
      review: { zh: '审核', en: 'Review' },
      notify: { zh: '通知', en: 'Notify' },
      api: { zh: 'API', en: 'API' },
      transform: { zh: '数据转换', en: 'Transform' },
      output: { zh: '输出', en: 'Output' },
      webhook: { zh: 'Webhook', en: 'Webhook' },
      email: { zh: '邮件', en: 'Email' },
      message: { zh: '消息', en: 'Message' },
      department: { zh: '部门', en: 'Department' },
      milestone: { zh: '里程碑', en: 'Milestone' },
      human: { zh: '人工审核', en: 'Human Review' },
      group: { zh: '分组', en: 'Group' },
    };
    const item = names[type] || { zh: type, en: type };
    return language === 'zh' ? item.zh : item.en;
  };
  
  // 如果没有工作流，显示提示
  if (!workflow) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-gray-900 rounded-lg shadow-xl border border-indigo-500/30 w-[400px] p-6">
          <div className="text-center">
            <span className="text-4xl">⚠️</span>
            <p className="text-gray-300 mt-4">
              {language === 'zh' ? '请先选择一个工作流' : 'Please select a workflow first'}
            </p>
            <button
              onClick={onClose}
              className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg"
            >
              {language === 'zh' ? '关闭' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg shadow-xl border border-indigo-500/30 w-[800px] max-h-[90vh] overflow-hidden">
        {/* 头部 */}
        <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 px-4 py-3 border-b border-indigo-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧪</span>
              <div>
                <h2 className="text-lg font-bold text-white">
                  {language === 'zh' ? '工作流模拟执行' : 'Workflow Simulation'}
                </h2>
                <p className="text-sm text-gray-400">{workflow.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* 进度条 */}
        {context && (
          <div className="px-4 py-2 bg-gray-800/50">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">
                {language === 'zh' ? '进度' : 'Progress'}: {context.progress}%
              </span>
              <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${
                    context.status === 'completed' ? 'bg-green-500' :
                    context.status === 'failed' ? 'bg-red-500' :
                    'bg-indigo-500'
                  }`}
                  style={{ width: `${context.progress}%` }}
                />
              </div>
              <span className="text-sm text-gray-400">
                {context.executedNodes}/{context.totalNodes}
              </span>
            </div>
          </div>
        )}
        
        {/* 控制按钮 */}
        <div className="px-4 py-3 bg-gray-800/30 border-b border-gray-700">
          <div className="flex items-center gap-3">
            {!isRunning ? (
              <button
                onClick={startSimulation}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                <span>▶️</span>
                {language === 'zh' ? '开始模拟' : 'Start Simulation'}
              </button>
            ) : (
              <>
                <button
                  onClick={togglePause}
                  className={`${
                    isPaused ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'
                  } text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2`}
                >
                  <span>{isPaused ? '▶️' : '⏸️'}</span>
                  {isPaused 
                    ? (language === 'zh' ? '继续' : 'Resume')
                    : (language === 'zh' ? '暂停' : 'Pause')
                  }
                </button>
                <button
                  onClick={stopSimulation}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                >
                  <span>⏹️</span>
                  {language === 'zh' ? '停止' : 'Stop'}
                </button>
              </>
            )}
            
            {/* 状态指示 */}
            {context && (
              <div className="ml-4 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs ${
                  context.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                  context.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                  context.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                  context.status === 'paused' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {context.status === 'running' ? (language === 'zh' ? '运行中' : 'Running') :
                   context.status === 'completed' ? (language === 'zh' ? '已完成' : 'Completed') :
                   context.status === 'failed' ? (language === 'zh' ? '失败' : 'Failed') :
                   context.status === 'paused' ? (language === 'zh' ? '暂停' : 'Paused') :
                   (language === 'zh' ? '空闲' : 'Idle')}
                </span>
              </div>
            )}
          </div>
        </div>
        
        {/* Tab 切换 */}
        <div className="px-4 py-2 bg-gray-800/20 border-b border-gray-700">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('execution')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                activeTab === 'execution' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              {language === 'zh' ? '执行记录' : 'Execution Log'}
            </button>
            <button
              onClick={() => setActiveTab('issues')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                activeTab === 'issues' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              {language === 'zh' ? '问题报告' : 'Issues'}
              {issues.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs">
                  {issues.filter(i => i.type === 'error').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('blackboard')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                activeTab === 'blackboard' 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              {language === 'zh' ? '黑板变量' : 'Blackboard'}
            </button>
          </div>
        </div>
        
        {/* 内容区域 */}
        <div className="p-4 overflow-y-auto max-h-[400px]">
          {/* 执行记录 */}
          {activeTab === 'execution' && (
            <div className="space-y-2">
              {nodeResults.length === 0 && !isRunning && (
                <div className="text-center text-gray-400 py-8">
                  {language === 'zh' 
                    ? '点击"开始模拟"按钮开始执行' 
                    : 'Click "Start Simulation" to begin'
                  }
                </div>
              )}
              
              {nodeResults.map((result, index) => (
                <div 
                  key={result.nodeId}
                  className={`bg-gray-800/50 rounded-lg p-3 border ${
                    result.status === 'success' ? 'border-green-500/30' :
                    result.status === 'failed' ? 'border-red-500/30' :
                    result.status === 'warning' ? 'border-yellow-500/30' :
                    'border-gray-600/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <NodeStatusIcon status={result.status} />
                      <span className="font-medium text-white">{result.nodeName}</span>
                      <span className="text-xs text-gray-400 px-2 py-0.5 rounded bg-gray-700">
                        {getNodeTypeName(result.nodeType)}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{result.duration}ms</span>
                  </div>
                  
                  <p className="text-sm text-gray-300 mb-2">{result.message}</p>
                  
                  {/* 输入输出 */}
                  {Object.keys(result.inputVariables).length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-gray-400">
                        {language === 'zh' ? '输入' : 'Input'}:
                      </span>
                      <pre className="text-xs text-blue-300 bg-gray-900/50 rounded p-1 mt-1 overflow-x-auto">
                        {JSON.stringify(result.inputVariables, null, 2).slice(0, 200)}
                      </pre>
                    </div>
                  )}
                  
                  {Object.keys(result.outputVariables).length > 0 && (
                    <div>
                      <span className="text-xs text-gray-400">
                        {language === 'zh' ? '输出' : 'Output'}:
                      </span>
                      <pre className="text-xs text-green-300 bg-gray-900/50 rounded p-1 mt-1 overflow-x-auto">
                        {JSON.stringify(result.outputVariables, null, 2).slice(0, 200)}
                      </pre>
                    </div>
                  )}
                  
                  {/* 节点问题 */}
                  {result.issues.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {result.issues.map((issue, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <IssueIcon type={issue.type} />
                          <span className={issue.type === 'error' ? 'text-red-300' : 'text-yellow-300'}>
                            {issue.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              
              {/* 运行中提示 */}
              {isRunning && context?.status === 'running' && (
                <div className="text-center py-4">
                  <div className="inline-flex items-center gap-2 text-blue-400">
                    <span className="animate-spin">⚙️</span>
                    {language === 'zh' ? '正在执行...' : 'Executing...'}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* 问题报告 */}
          {activeTab === 'issues' && (
            <div className="space-y-2">
              {issues.length === 0 && report && (
                <div className="text-center py-8">
                  <span className="text-4xl">🎉</span>
                  <p className="text-green-400 mt-2">
                    {language === 'zh' ? '没有发现问题！' : 'No issues found!'}
                  </p>
                </div>
              )}
              
              {issues.length === 0 && !report && (
                <div className="text-center text-gray-400 py-8">
                  {language === 'zh' 
                    ? '运行模拟后查看问题报告' 
                    : 'Run simulation to see issues'
                  }
                </div>
              )}
              
              {issues.map((issue, index) => (
                <div 
                  key={index}
                  className={`bg-gray-800/50 rounded-lg p-3 border ${
                    issue.type === 'error' ? 'border-red-500/30' :
                    issue.type === 'warning' ? 'border-yellow-500/30' :
                    'border-blue-500/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <IssueIcon type={issue.type} />
                    <span className={`font-medium ${
                      issue.type === 'error' ? 'text-red-400' :
                      issue.type === 'warning' ? 'text-yellow-400' :
                      'text-blue-400'
                    }`}>
                      {issue.code}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">{issue.message}</p>
                  {issue.suggestion && (
                    <p className="text-xs text-gray-400 mt-1">
                      💡 {language === 'zh' ? '建议' : 'Suggestion'}: {issue.suggestion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          
          {/* 黑板变量 */}
          {activeTab === 'blackboard' && (
            <div>
              {!report ? (
                <div className="text-center text-gray-400 py-8">
                  {language === 'zh' 
                    ? '运行模拟后查看黑板变量' 
                    : 'Run simulation to see blackboard'
                  }
                </div>
              ) : (
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">
                      {language === 'zh' ? '变量数量' : 'Variables'}: {Object.keys(report.blackboardSnapshot).length}
                    </span>
                  </div>
                  <pre className="text-xs text-green-300 bg-gray-900/50 rounded p-2 overflow-x-auto max-h-[300px]">
                    {JSON.stringify(report.blackboardSnapshot, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* 底部汇总 */}
        {report && (
          <div className="px-4 py-3 bg-gray-800/50 border-t border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm">
                  <span className="text-green-400">✅ {report.summary.successNodes}</span>
                  <span className="text-gray-400 mx-1">|</span>
                  <span className="text-red-400">❌ {report.summary.failedNodes}</span>
                  <span className="text-gray-400 mx-1">|</span>
                  <span className="text-yellow-400">⚠️ {report.summary.warningNodes}</span>
                </span>
                <span className="text-sm text-gray-400">
                  {language === 'zh' ? '耗时' : 'Time'}: {report.summary.executionTime}ms
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                {report.summary.canRunInProduction ? (
                  <span className="px-3 py-1 rounded bg-green-500/20 text-green-400 text-sm">
                    ✅ {language === 'zh' ? '可以上线' : 'Ready for Production'}
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded bg-red-500/20 text-red-400 text-sm">
                    ❌ {language === 'zh' ? '需要修复' : 'Needs Fix'}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}