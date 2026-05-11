/**
 * 定时任务调度器
 * 支持: 一次性、间隔、Cron 表达式三种触发方式
 */

import CronExpressionParser from 'cron-parser';
import type { ScheduledTask, ScheduledTaskRun, Agent } from '../types';

export type TaskExecutor = (
  task: ScheduledTask,
  agents: Agent[]
) => Promise<{ success: boolean; output: string[]; error?: string }>;

interface ScheduledTimer {
  taskId: string;
  timer: ReturnType<typeof setTimeout>;
  nextRunAt: Date;
}

class TaskScheduler {
  private timers: Map<string, ScheduledTimer> = new Map();
  private executor: TaskExecutor | null = null;
  private onTaskRun: ((run: ScheduledTaskRun) => void) | null = null;
  private onTaskUpdate: ((task: ScheduledTask) => void) | null = null;

  /**
   * 设置任务执行器
   */
  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  /**
   * 设置任务运行回调
   */
  setOnTaskRun(callback: (run: ScheduledTaskRun) => void): void {
    this.onTaskRun = callback;
  }

  /**
   * 设置任务更新回调
   */
  setOnTaskUpdate(callback: (task: ScheduledTask) => void): void {
    this.onTaskUpdate = callback;
  }

  /**
   * 调度任务
   */
  schedule(task: ScheduledTask, agents: Agent[]): void {
    // 先取消已有的调度
    this.cancel(task.id);

    if (!task.enabled) {
      console.log(`[Scheduler] Task ${task.name} is disabled, skipping`);
      return;
    }

    const delay = this.calculateDelay(task);
    if (delay === null) {
      console.warn(`[Scheduler] Cannot calculate delay for task ${task.name}`);
      return;
    }

    const nextRunAt = new Date(Date.now() + delay);
    console.log(`[Scheduler] Scheduling task ${task.name}, next run at ${nextRunAt.toLocaleString()}`);

    const timer = setTimeout(() => {
      this.executeTask(task, agents);
    }, delay);

    this.timers.set(task.id, {
      taskId: task.id,
      timer,
      nextRunAt,
    });
  }

  /**
   * 取消任务调度
   */
  cancel(taskId: string): void {
    const scheduled = this.timers.get(taskId);
    if (scheduled) {
      clearTimeout(scheduled.timer);
      this.timers.delete(taskId);
      console.log(`[Scheduler] Cancelled task ${taskId}`);
    }
  }

  /**
   * 取消所有调度
   */
  cancelAll(): void {
    for (const scheduled of this.timers.values()) {
      clearTimeout(scheduled.timer);
    }

    this.timers.clear();
    console.log('[Scheduler] Cancelled all tasks');
  }

  /**
   * 获取下次执行时间
   */
  getNextRunTime(task: ScheduledTask): Date | null {
    const delay = this.calculateDelay(task);
    if (delay === null) return null;
    return new Date(Date.now() + delay);
  }

  /**
   * 获取所有已调度的任务
   */
  getScheduledTasks(): string[] {
    return Array.from(this.timers.keys());
  }

  /**
   * 计算下次执行的延迟时间 (毫秒)
   */
  private calculateDelay(task: ScheduledTask): number | null {
    const now = Date.now();

    switch (task.triggerType) {
      case 'once': {
        if (!task.scheduledTime) return null;
        const targetTime = new Date(task.scheduledTime).getTime();
        return Math.max(1000, targetTime - now); // 最小1秒
      }

      case 'interval': {
        if (!task.intervalMs) return null;
        return Math.max(1000, task.intervalMs);
      }

      case 'cron': {
        if (!task.cronExpression) return null;
        try {
          const interval = CronExpressionParser.parse(task.cronExpression);
          const nextDate = interval.next();
          return Math.max(1000, nextDate.getTime() - now);
        } catch (error) {
          console.error(`[Scheduler] Invalid cron expression: ${task.cronExpression}`, error);
          return null;
        }
      }

      default:
        return null;
    }
  }

  /**
   * 执行任务
   */
  private async executeTask(task: ScheduledTask, agents: Agent[]): Promise<void> {
    console.log(`[Scheduler] Executing task ${task.name}`);

    // 创建执行记录
    const run: ScheduledTaskRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      scheduledTaskId: task.id,
      startedAt: new Date().toISOString(),
      status: 'running',
      output: [],
    };

    // 任务开始时不通知，只在完成时通知

    try {
      if (!this.executor) {
        throw new Error('Task executor not configured');
      }

      const result = await this.executor(task, agents);

      run.status = result.success ? 'completed' : 'failed';
      run.output = result.output;
      run.error = result.error;
      run.completedAt = new Date().toISOString();
      run.duration = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();

    } catch (error: any) {
      run.status = 'failed';
      run.error = error.message || 'Unknown error';
      run.completedAt = new Date().toISOString();
      run.duration = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
      console.error(`[Scheduler] Task ${task.name} failed:`, error);
    }

    // 通知任务运行完成
    this.onTaskRun?.(run);

    // 更新任务统计
    const updatedTask: ScheduledTask = {
      ...task,
      lastRunAt: run.startedAt,
      runCount: task.runCount + 1,
      nextRunAt: this.getNextRunTime(task)?.toISOString(),
    };
    this.onTaskUpdate?.(updatedTask);

    // 重新调度 (一次性任务不重新调度)
    if (task.triggerType !== 'once') {
      this.schedule(updatedTask, agents);
    } else {
      // 一次性任务完成后禁用
      updatedTask.enabled = false;
      this.onTaskUpdate?.(updatedTask);
      this.timers.delete(task.id);
    }
  }
}

// 单例导出
export const taskScheduler = new TaskScheduler();