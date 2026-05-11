// AHIVE 国际化配置
export type Language = 'zh' | 'en';

export interface Translations {
  appName: string;
  appSubtitle: string;
  workingAgents: string;
  completedTasks: string;
  totalAgents: string;
  world: string;
  skills: string;
  tasks: string;
  workflow: string;
  logs: string;
  dispatchTask: string;
  selectAgent: string;
  taskDescription: string;
  dispatch: string;
  dispatching: string;
  taskHistory: string;
  noTasks: string;
  taskOutput: string;
  noOutput: string;
  running: string;
  status: {
    idle: string;
    working: string;
    paused: string;
    error: string;
  };
  taskStatus: {
    pending: string;
    running: string;
    completed: string;
    failed: string;
  };
  installs: string;
  loading: string;
  unknown: string;
  language: string;
}

const zh: Translations = {
  appName: 'AHIVE',
  appSubtitle: '智能体集群管理器',
  workingAgents: '工作中的智能体',
  completedTasks: '已完成任务',
  totalAgents: '智能体总数',
  world: '3D 世界',
  skills: '能力中心',
  tasks: '任务',
  workflow: '工作流',
  logs: '执行日志',
  dispatchTask: '派发任务',
  selectAgent: '选择智能体',
  taskDescription: '任务描述',
  dispatch: '派发任务 (Ctrl+Enter)',
  dispatching: '派发中...',
  taskHistory: '任务历史',
  noTasks: '暂无任务',
  taskOutput: '任务输出',
  noOutput: '暂无任务输出，请先创建任务',
  running: '执行中...',
  status: { idle: '空闲', working: '工作中', paused: '已暂停', error: '错误' },
  taskStatus: { pending: '等待中', running: '执行中', completed: '已完成', failed: '失败' },
  installs: '次安装',
  loading: '加载中...',
  unknown: '未知',
  language: '中文',
};

const en: Translations = {
  appName: 'AHIVE',
  appSubtitle: 'Agent Cluster Manager',
  workingAgents: 'Working Agents',
  completedTasks: 'Completed Tasks',
  totalAgents: 'Total Agents',
  world: '3D World',
  skills: 'Capability Hub',
  tasks: 'Tasks',
  workflow: 'Workflow',
  logs: 'Execution Logs',
  dispatchTask: 'Dispatch Task',
  selectAgent: 'Select Agent',
  taskDescription: 'Task Description',
  dispatch: 'Dispatch (Ctrl+Enter)',
  dispatching: 'Dispatching...',
  taskHistory: 'Task History',
  noTasks: 'No tasks',
  taskOutput: 'Task Output',
  noOutput: 'No output, create a task first',
  running: 'Running...',
  status: { idle: 'Idle', working: 'Working', paused: 'Paused', error: 'Error' },
  taskStatus: { pending: 'Pending', running: 'Running', completed: 'Completed', failed: 'Failed' },
  installs: ' installs',
  loading: 'Loading...',
  unknown: 'Unknown',
  language: 'English',
};

export const translations: Record<Language, Translations> = { zh, en };
