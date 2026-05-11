import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';
import { tasksApi } from '../../api/client';
import { translations } from '../../i18n';

type TaskTabType = 'immediate' | 'scheduled';

export function TaskPanel() {
  const [activeTab, setActiveTab] = useState<TaskTabType>('immediate');
  const { agents, tasks, selectedAgentId, addTask, updateTask, language } = useStore();
  const [taskInput, setTaskInput] = useState('');
  const [selectedTaskAgentId, setSelectedTaskAgentId] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const tr = translations[language];

  // Set default agent when selectedAgentId changes
  useEffect(() => {
    if (selectedAgentId && !selectedTaskAgentId) {
      setSelectedTaskAgentId(selectedAgentId);
    }
  }, [selectedAgentId]);

  // Poll for task updates
  useEffect(() => {
    const pollTasks = async () => {
      try {
        const updatedTasks = await tasksApi.getAll();
        updatedTasks.forEach(task => {
          const existing = tasks.find(t => t.id === task.id);
          if (!existing || existing.status !== task.status || existing.output.length !== task.output.length) {
            updateTask(task);
          }
        });
      } catch (error) {
        // Silently fail - using mock data
      }
    };

    const interval = setInterval(pollTasks, 2000);
    return () => clearInterval(interval);
  }, [tasks]);

  // Scroll output to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [tasks]);

  const handleSubmitTask = async () => {
    if (!taskInput.trim() || !selectedTaskAgentId) return;

    setIsCreating(true);
    try {
      const newTask = await tasksApi.create({
        agentId: selectedTaskAgentId,
        task: taskInput.trim(),
      });
      addTask(newTask);
      setTaskInput('');
    } catch (error) {
      console.error('Failed to create task:', error);
      // Fallback to local task
      const localTask = {
        id: `local-${Date.now()}`,
        agentId: selectedTaskAgentId,
        task: taskInput.trim(),
        status: 'pending' as const,
        output: [],
        createdAt: new Date().toISOString(),
      };
      addTask(localTask);
      setTaskInput('');
      
      // Simulate task execution
      simulateTaskExecution(localTask);
    } finally {
      setIsCreating(false);
    }
  };

  const simulateTaskExecution = async (task: any) => {
    // Update to running
    setTimeout(() => {
      updateTask({ ...task, status: 'running', startedAt: new Date().toISOString() });
    }, 500);

    // Simulate output based on language
    const prefix = language === 'zh' ? '[模拟]' : '[Mock]';
    const outputs = language === 'zh' 
      ? [
          `${prefix} 开始执行任务...`,
          `${prefix} 分析任务要求...`,
          `${prefix} 准备执行环境...`,
          `${prefix} 正在处理...`,
          `${prefix} 任务完成! ✅`,
        ]
      : [
          `${prefix} Starting task...`,
          `${prefix} Analyzing requirements...`,
          `${prefix} Preparing environment...`,
          `${prefix} Processing...`,
          `${prefix} Task completed! ✅`,
        ];

    for (const output of outputs) {
      await new Promise(resolve => setTimeout(resolve, 800));
      updateTask({
        ...task,
        status: 'running',
        output: [...task.output, output],
      });
    }

    // Complete
    const finalOutput = language === 'zh' 
      ? `${prefix} 最终输出: ${task.task}` 
      : `${prefix} Final output: ${task.task}`;
    updateTask({
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString(),
      output: [...task.output, finalOutput],
    });
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      pending: 'bg-yellow-500',
      running: 'bg-blue-500',
      completed: 'bg-green-500',
      failed: 'bg-red-500',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs text-white ${colors[status as keyof typeof colors]}`}>
        {tr.taskStatus[status as keyof typeof tr.taskStatus]}
      </span>
    );
  };

  const getAgentName = (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    return agent?.name || tr.unknown;
  };

  const getStatusLabel = (status: string) => {
    return tr.status[status as keyof typeof tr.status] || status;
  };

  const selectedTask = tasks[0]; // Show latest task

  return (
    <div className="flex h-full flex-col">
      {/* 子标签切换 */}
      <div className="flex border-b border-hive-border bg-hive-surface">
        <button
          onClick={() => setActiveTab('immediate')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'immediate'
              ? 'text-hive-primary border-b-2 border-hive-primary'
              : 'text-hive-text-secondary hover:text-hive-text'
          }`}
        >
          {language === 'zh' ? '即时任务' : 'Immediate Tasks'}
        </button>
        <button
          onClick={() => setActiveTab('scheduled')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'scheduled'
              ? 'text-hive-primary border-b-2 border-hive-primary'
              : 'text-hive-text-secondary hover:text-hive-text'
          }`}
        >
          {language === 'zh' ? '定时任务' : 'Scheduled Tasks'}
        </button>
      </div>
      
      {/* 内容区 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'scheduled' ? (
          <ScheduledTaskPanel />
        ) : (
          <div className="flex h-full">
      {/* Left: Task List */}
      <div className="w-1/3 border-r border-hive-border flex flex-col">
        {/* Task Input */}
        <div className="p-4 border-b border-hive-border">
          <h3 className="text-lg font-medium text-hive-text mb-3">{tr.dispatchTask}</h3>
          
          <div className="mb-3">
            <label className="block text-sm text-hive-text-secondary mb-1">{tr.selectAgent}</label>
            <select
              value={selectedTaskAgentId}
              onChange={(e) => setSelectedTaskAgentId(e.target.value)}
              className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text"
            >
              <option value="">{tr.selectAgent}...</option>
              {agents.map(agent => (
                <option key={agent.id} value={agent.agentId || agent.id}>
                  {agent.name} ({agent.type}) - {getStatusLabel(agent.status)}
                </option>
              ))}
            </select>
          </div>
          
          <div className="mb-3">
            <label className="block text-sm text-hive-text-secondary mb-1">{tr.taskDescription}</label>
            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder={tr.taskDescription + '...'}
              className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text resize-none"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  handleSubmitTask();
                }
              }}
            />
          </div>
          
          <button
            onClick={handleSubmitTask}
            disabled={!taskInput.trim() || !selectedTaskAgentId || isCreating}
            className="w-full py-2 bg-hive-primary hover:bg-hive-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isCreating ? tr.dispatching : tr.dispatch}
          </button>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <h4 className="text-sm text-hive-text-secondary px-2 mb-2">{tr.taskHistory}</h4>
            {tasks.length === 0 ? (
              <div className="text-center text-hive-text-secondary py-8">
                {tr.noTasks}
              </div>
            ) : (
              tasks.map(task => (
                <div
                  key={task.id}
                  className="p-2 mb-1 rounded hover:bg-hive-hover cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-hive-text truncate">{task.task}</span>
                    {getStatusBadge(task.status)}
                  </div>
                  <div className="text-xs text-hive-text-secondary mt-1">
                    {getAgentName(task.agentId)} • {new Date(task.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right: Task Output */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-hive-border">
          <h3 className="text-lg font-medium text-hive-text">{tr.taskOutput}</h3>
          {selectedTask && (
            <div className="text-sm text-hive-text-secondary mt-1">
              {selectedTask.task}
            </div>
          )}
        </div>
        
        <div 
          ref={outputRef}
          className="flex-1 p-4 overflow-y-auto bg-gray-900 font-mono text-sm"
        >
          {!selectedTask ? (
            <div className="text-gray-500">{tr.noOutput}</div>
          ) : (
            selectedTask.output.map((line, i) => (
              <div key={i} className={`mb-1 ${
                line.includes('[ERROR]') ? 'text-red-400' :
                line.includes('[模拟]') || line.includes('[Mock]') ? 'text-yellow-400' :
                'text-green-400'
              }`}>
                {line}
              </div>
            ))
          )}
          
          {selectedTask?.status === 'running' && (
            <div className="text-blue-400 animate-pulse">▋ {tr.running}</div>
          )}
        </div>
      </div>
    </div>
    )}
  </div>
</div>
  );
}

// 完整的定时任务面板组件
function ScheduledTaskPanel() {
  const dialog = useDialog();
  const { 
    scheduledTasks, 
    scheduledTaskRuns, 
    agents, 
    workflows,
    addScheduledTask, 
    updateScheduledTask, 
    deleteScheduledTask, 
    toggleScheduledTask,
    language 
  } = useStore();
  
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    targetType: 'agent' as 'workflow' | 'agent',
    agentId: '',
    workflowId: '',
    taskPrompt: '',
    triggerType: 'interval' as 'once' | 'interval' | 'cron',
    intervalMs: 24 * 60 * 60 * 1000, // 默认每天
    cronExpression: '',
    scheduledTime: '',
  });

  const isZh = language === 'zh';

  const selectedTask = scheduledTasks.find(t => t.id === selectedTaskId);
  const selectedTaskRuns = selectedTaskId ? (scheduledTaskRuns[selectedTaskId] || []) : [];

  // 预设间隔选项
  const intervalOptions = [
    { label: isZh ? '每 5 分钟' : 'Every 5 min', value: 5 * 60 * 1000 },
    { label: isZh ? '每 30 分钟' : 'Every 30 min', value: 30 * 60 * 1000 },
    { label: isZh ? '每小时' : 'Every hour', value: 60 * 60 * 1000 },
    { label: isZh ? '每天' : 'Every day', value: 24 * 60 * 60 * 1000 },
    { label: isZh ? '每周' : 'Every week', value: 7 * 24 * 60 * 60 * 1000 },
  ];

  const handleSave = () => {
    if (!formData.name.trim()) return;

    const task = {
      id: selectedTaskId || `st-${Date.now()}`,
      name: formData.name.trim(),
      description: formData.description.trim(),
      targetType: formData.targetType,
      agentId: formData.targetType === 'agent' ? formData.agentId : undefined,
      workflowId: formData.targetType === 'workflow' ? formData.workflowId : undefined,
      taskPrompt: formData.targetType === 'agent' ? formData.taskPrompt : undefined,
      triggerType: formData.triggerType,
      intervalMs: formData.triggerType === 'interval' ? formData.intervalMs : undefined,
      cronExpression: formData.triggerType === 'cron' ? formData.cronExpression : undefined,
      scheduledTime: formData.triggerType === 'once' ? formData.scheduledTime : undefined,
      enabled: true,
      runCount: selectedTask?.runCount || 0,
      createdAt: selectedTask?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextRunAt: calculateNextRun(formData),
    };

    if (selectedTaskId) {
      updateScheduledTask(task as any);
    } else {
      addScheduledTask(task as any);
    }

    resetForm();
  };

  const resetForm = () => {
    setSelectedTaskId(null);
    setIsCreating(false);
    setFormData({
      name: '',
      description: '',
      targetType: 'agent',
      agentId: '',
      workflowId: '',
      taskPrompt: '',
      triggerType: 'interval',
      intervalMs: 24 * 60 * 60 * 1000,
      cronExpression: '',
      scheduledTime: '',
    });
  };

  const handleEdit = (task: any) => {
    setSelectedTaskId(task.id);
    setIsCreating(true);
    setFormData({
      name: task.name,
      description: task.description || '',
      targetType: task.targetType,
      agentId: task.agentId || '',
      workflowId: task.workflowId || '',
      taskPrompt: task.taskPrompt || '',
      triggerType: task.triggerType,
      intervalMs: task.intervalMs || 24 * 60 * 60 * 1000,
      cronExpression: task.cronExpression || '',
      scheduledTime: task.scheduledTime || '',
    });
  };

  const getTriggerLabel = (task: any) => {
    if (task.triggerType === 'once') {
      return isZh ? '一次性' : 'Once';
    } else if (task.triggerType === 'interval') {
      const opt = intervalOptions.find(o => o.value === task.intervalMs);
      return opt?.label || (isZh ? '间隔' : 'Interval');
    } else {
      return `Cron: ${task.cronExpression}`;
    }
  };

  const getTargetLabel = (task: any) => {
    if (task.targetType === 'agent') {
      const agent = agents.find(a => a.id === task.agentId);
      return agent?.name || (isZh ? '未知智能体' : 'Unknown Agent');
    } else {
      const workflow = workflows.find(w => w.id === task.workflowId);
      return workflow?.name || (isZh ? '未知工作流' : 'Unknown Workflow');
    }
  };

  return (
    <div className="flex h-full">
      {/* 左侧：任务列表 */}
      <div className="w-1/3 border-r border-hive-border flex flex-col">
        <div className="p-4 border-b border-hive-border flex justify-between items-center">
          <h3 className="text-lg font-medium text-hive-text">
            {isZh ? '定时任务' : 'Scheduled Tasks'}
          </h3>
          <button
            onClick={() => { setIsCreating(true); setSelectedTaskId(null); }}
            className="px-3 py-1 bg-hive-primary hover:bg-hive-primary-hover text-white text-sm rounded"
          >
            + {isZh ? '新建' : 'New'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {scheduledTasks.length === 0 ? (
            <div className="p-4 text-center text-hive-text-secondary">
              {isZh ? '暂无定时任务' : 'No scheduled tasks'}
            </div>
          ) : (
            scheduledTasks.map(task => (
              <div
                key={task.id}
                onClick={() => { setSelectedTaskId(task.id); setIsCreating(false); }}
                className={`p-3 border-b border-hive-border cursor-pointer hover:bg-hive-hover ${
                  selectedTaskId === task.id ? 'bg-hive-hover' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-hive-text font-medium">{task.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    task.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {task.enabled ? (isZh ? '启用' : 'On') : (isZh ? '禁用' : 'Off')}
                  </span>
                </div>
                <div className="text-xs text-hive-text-secondary mt-1">
                  {getTriggerLabel(task)} | {getTargetLabel(task)} | {isZh ? '运行' : 'Runs'}: {task.runCount}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧：任务详情/表单 */}
      <div className="flex-1 flex flex-col">
        {isCreating ? (
          /* 创建/编辑表单 */
          <div className="p-4 overflow-y-auto">
            <h3 className="text-lg font-medium text-hive-text mb-4">
              {selectedTaskId ? (isZh ? '编辑任务' : 'Edit Task') : (isZh ? '新建任务' : 'New Task')}
            </h3>

            {/* 名称 */}
            <div className="mb-4">
              <label className="block text-sm text-hive-text-secondary mb-1">
                {isZh ? '任务名称' : 'Task Name'}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text"
                placeholder={isZh ? '例如：每日代码审查' : 'e.g., Daily Code Review'}
              />
            </div>

            {/* 执行目标类型 */}
            <div className="mb-4">
              <label className="block text-sm text-hive-text-secondary mb-1">
                {isZh ? '执行目标' : 'Target'}
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={formData.targetType === 'agent'}
                    onChange={() => setFormData({ ...formData, targetType: 'agent' })}
                    className="mr-2"
                  />
                  {isZh ? '智能体' : 'Agent'}
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={formData.targetType === 'workflow'}
                    onChange={() => setFormData({ ...formData, targetType: 'workflow' })}
                    className="mr-2"
                  />
                  {isZh ? '工作流' : 'Workflow'}
                </label>
              </div>
            </div>

            {/* 智能体选择 */}
            {formData.targetType === 'agent' && (
              <>
                <div className="mb-4">
                  <label className="block text-sm text-hive-text-secondary mb-1">
                    {isZh ? '选择智能体' : 'Select Agent'}
                  </label>
                  <select
                    value={formData.agentId}
                    onChange={e => setFormData({ ...formData, agentId: e.target.value })}
                    className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text"
                  >
                    <option value="">{isZh ? '请选择...' : 'Select...'}</option>
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.agentId || agent.id}>{agent.name}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block text-sm text-hive-text-secondary mb-1">
                    {isZh ? '任务提示' : 'Task Prompt'}
                  </label>
                  <textarea
                    value={formData.taskPrompt}
                    onChange={e => setFormData({ ...formData, taskPrompt: e.target.value })}
                    className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text resize-none"
                    rows={3}
                    placeholder={isZh ? '发送给智能体的任务描述...' : 'Task description for the agent...'}
                  />
                </div>
              </>
            )}

            {/* 工作流选择 */}
            {formData.targetType === 'workflow' && (
              <div className="mb-4">
                <label className="block text-sm text-hive-text-secondary mb-1">
                  {isZh ? '选择工作流' : 'Select Workflow'}
                </label>
                <select
                  value={formData.workflowId}
                  onChange={e => setFormData({ ...formData, workflowId: e.target.value })}
                  className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text"
                >
                  <option value="">{isZh ? '请选择...' : 'Select...'}</option>
                  {workflows.map(wf => (
                    <option key={wf.id} value={wf.id}>{wf.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 触发方式 */}
            <div className="mb-4">
              <label className="block text-sm text-hive-text-secondary mb-1">
                {isZh ? '触发方式' : 'Trigger Type'}
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={formData.triggerType === 'interval'}
                    onChange={() => setFormData({ ...formData, triggerType: 'interval' })}
                    className="mr-2"
                  />
                  {isZh ? '间隔' : 'Interval'}
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={formData.triggerType === 'once'}
                    onChange={() => setFormData({ ...formData, triggerType: 'once' })}
                    className="mr-2"
                  />
                  {isZh ? '一次性' : 'Once'}
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    checked={formData.triggerType === 'cron'}
                    onChange={() => setFormData({ ...formData, triggerType: 'cron' })}
                    className="mr-2"
                  />
                  Cron
                </label>
              </div>
            </div>

            {/* 间隔选择 */}
            {formData.triggerType === 'interval' && (
              <div className="mb-4">
                <label className="block text-sm text-hive-text-secondary mb-1">
                  {isZh ? '时间间隔' : 'Interval'}
                </label>
                <select
                  value={formData.intervalMs}
                  onChange={e => setFormData({ ...formData, intervalMs: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text"
                >
                  {intervalOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 一次性时间 */}
            {formData.triggerType === 'once' && (
              <div className="mb-4">
                <label className="block text-sm text-hive-text-secondary mb-1">
                  {isZh ? '执行时间' : 'Scheduled Time'}
                </label>
                <input
                  type="datetime-local"
                  value={formData.scheduledTime}
                  onChange={e => setFormData({ ...formData, scheduledTime: e.target.value })}
                  className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text"
                />
              </div>
            )}

            {/* Cron 表达式 */}
            {formData.triggerType === 'cron' && (
              <div className="mb-4">
                <label className="block text-sm text-hive-text-secondary mb-1">
                  Cron {isZh ? '表达式' : 'Expression'}
                </label>
                <input
                  type="text"
                  value={formData.cronExpression}
                  onChange={e => setFormData({ ...formData, cronExpression: e.target.value })}
                  className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text"
                  placeholder="0 9 * * *"
                />
                <div className="text-xs text-hive-text-secondary mt-1">
                  {isZh ? '格式: 分 时 日 月 周' : 'Format: min hour day month weekday'}
                </div>
              </div>
            )}

            {/* 按钮 */}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-hive-primary hover:bg-hive-primary-hover text-white rounded-lg"
              >
                {isZh ? '保存' : 'Save'}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg"
              >
                {isZh ? '取消' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : selectedTask ? (
          /* 任务详情 */
          <div className="p-4 overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-medium text-hive-text">{selectedTask.name}</h3>
                <p className="text-sm text-hive-text-secondary">{selectedTask.description}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleScheduledTask(selectedTask.id, !selectedTask.enabled)}
                  className={`px-3 py-1 rounded text-sm ${
                    selectedTask.enabled 
                      ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' 
                      : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  }`}
                >
                  {selectedTask.enabled ? (isZh ? '禁用' : 'Disable') : (isZh ? '启用' : 'Enable')}
                </button>
                <button
                  onClick={() => handleEdit(selectedTask)}
                  className="px-3 py-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded text-sm"
                >
                  {isZh ? '编辑' : 'Edit'}
                </button>
                <button
                  onClick={async () => {
                    const confirmed = await dialog.confirm(
                      isZh ? '确定删除此任务？' : 'Delete this task?',
                      isZh ? '删除确认' : 'Confirm Delete'
                    );
                    if (confirmed) {
                      deleteScheduledTask(selectedTask.id);
                      setSelectedTaskId(null);
                    }
                  }}
                  className="px-3 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-sm"
                >
                  {isZh ? '删除' : 'Delete'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-hive-surface p-3 rounded-lg">
                <div className="text-xs text-hive-text-secondary">{isZh ? '执行目标' : 'Target'}</div>
                <div className="text-hive-text">{getTargetLabel(selectedTask)}</div>
              </div>
              <div className="bg-hive-surface p-3 rounded-lg">
                <div className="text-xs text-hive-text-secondary">{isZh ? '触发方式' : 'Trigger'}</div>
                <div className="text-hive-text">{getTriggerLabel(selectedTask)}</div>
              </div>
              <div className="bg-hive-surface p-3 rounded-lg">
                <div className="text-xs text-hive-text-secondary">{isZh ? '运行次数' : 'Run Count'}</div>
                <div className="text-hive-text">{selectedTask.runCount}</div>
              </div>
              <div className="bg-hive-surface p-3 rounded-lg">
                <div className="text-xs text-hive-text-secondary">{isZh ? '下次执行' : 'Next Run'}</div>
                <div className="text-hive-text">
                  {selectedTask.nextRunAt 
                    ? new Date(selectedTask.nextRunAt).toLocaleString() 
                    : (isZh ? '未安排' : 'Not scheduled')}
                </div>
              </div>
            </div>

            {/* 执行历史 */}
            <div>
              <h4 className="text-sm font-medium text-hive-text mb-2">
                {isZh ? '执行历史' : 'Run History'}
              </h4>
              {selectedTaskRuns.length === 0 ? (
                <div className="text-hive-text-secondary text-sm">
                  {isZh ? '暂无执行记录' : 'No runs yet'}
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedTaskRuns.slice(-10).reverse().map(run => (
                    <div key={run.id} className="bg-hive-surface p-3 rounded-lg text-sm">
                      <div className="flex justify-between">
                        <span className={
                          run.status === 'completed' ? 'text-green-400' :
                          run.status === 'failed' ? 'text-red-400' :
                          'text-blue-400'
                        }>
                          {run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : '⏳'}
                          {' '}{new Date(run.startedAt).toLocaleString()}
                        </span>
                        {run.duration && (
                          <span className="text-hive-text-secondary">
                            {(run.duration / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>
                      {run.error && <div className="text-red-400 mt-1">{run.error}</div>}
                      {/* 显示智能体反馈内容 */}
                      {run.output && run.output.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-hive-border">
                          <div className="text-xs text-hive-text-secondary mb-1">
                            {isZh ? '执行输出:' : 'Output:'}
                          </div>
                          <div className="bg-gray-900 p-2 rounded text-xs font-mono max-h-40 overflow-y-auto">
                            {run.output.map((line, i) => {
                              const displayText = extractOutputText(line);
                              return (
                              <div key={i} className={`whitespace-pre-wrap ${
                                displayText.includes('[ERROR]') || displayText.includes('error') ? 'text-red-400' :
                                displayText.includes('[WARN]') ? 'text-yellow-400' :
                                'text-green-400'
                              }`}>
                                {displayText}
                              </div>
                            );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-hive-text-secondary">
            <div className="text-center">
              <div className="text-4xl mb-4">📋</div>
              <div>{isZh ? '选择或创建定时任务' : 'Select or create a scheduled task'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 计算下次执行时间
function calculateNextRun(formData: any): string {
  if (formData.triggerType === 'interval') {
    return new Date(Date.now() + formData.intervalMs).toISOString();
  } else if (formData.triggerType === 'once' && formData.scheduledTime) {
    return new Date(formData.scheduledTime).toISOString();
  }
  return new Date().toISOString();
}

/**
 * 从输出行中提取智能体回复文本
 * 处理 JSON 格式的旧数据
 */
function extractOutputText(line: string): string {
  // 尝试解析 JSON
  if (line.startsWith('{') || line.startsWith('"')) {
    try {
      const parsed = JSON.parse(line);
      // OpenClaw 格式: payloads[].text
      if (parsed.payloads && Array.isArray(parsed.payloads)) {
        const texts = parsed.payloads
          .filter((p: any) => p.text)
          .map((p: any) => p.text);
        return texts.join('\n') || line;
      }
      // 其他格式
      if (parsed.text) return parsed.text;
      if (parsed.message) return parsed.message;
    } catch {
      // 不是 JSON，返回原文
    }
  }
  return line;
}
