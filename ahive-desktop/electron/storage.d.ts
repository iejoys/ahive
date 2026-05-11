/**
 * 数据存储模块
 * 负责将定时任务、智能体配置等数据持久化到本地 JSON 文件
 */
export interface ScheduledTaskData {
    id: string;
    name: string;
    description?: string;
    targetType: 'workflow' | 'agent';
    workflowId?: string;
    agentId?: string;
    taskPrompt?: string;
    triggerType: 'once' | 'interval' | 'cron';
    cronExpression?: string;
    intervalMs?: number;
    scheduledTime?: string;
    nextRunAt?: string;
    enabled: boolean;
    lastRunAt?: string;
    runCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface ScheduledTaskRunData {
    id: string;
    scheduledTaskId: string;
    startedAt: string;
    completedAt?: string;
    status: 'running' | 'completed' | 'failed';
    output: string[];
    error?: string;
    duration?: number;
}
export interface AppData {
    scheduledTasks: ScheduledTaskData[];
    scheduledTaskRuns: Record<string, ScheduledTaskRunData[]>;
    lastUpdated: string;
}
/**
 * 读取所有数据
 */
export declare function loadData(): AppData;
/**
 * 保存所有数据
 */
export declare function saveData(data: AppData): boolean;
/**
 * 获取所有定时任务
 */
export declare function getScheduledTasks(): ScheduledTaskData[];
/**
 * 保存定时任务
 */
export declare function saveScheduledTask(task: ScheduledTaskData): boolean;
/**
 * 删除定时任务
 */
export declare function deleteScheduledTask(taskId: string): boolean;
/**
 * 切换定时任务状态
 */
export declare function toggleScheduledTask(taskId: string, enabled: boolean): boolean;
/**
 * 获取执行记录
 */
export declare function getTaskRuns(taskId: string): ScheduledTaskRunData[];
/**
 * 添加执行记录
 */
export declare function addTaskRun(run: ScheduledTaskRunData): boolean;
export declare function getDataDirectory(): string;
