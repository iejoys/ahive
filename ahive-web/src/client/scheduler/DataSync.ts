/**
 * 数据同步模块
 * 在 Electron 环境下通过 IPC 同步数据到本地 JSON 文件
 */

import { isElectronEnvironment } from './TaskExecutor';
import type { ScheduledTask, ScheduledTaskRun } from '../types';

/**
 * 从本地存储加载定时任务
 */
export async function loadScheduledTasksFromStorage(): Promise<ScheduledTask[]> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading');
    return [];
  }

  try {
    const tasks = await window.electronAPI!.getScheduledTasks!();
    console.log('[Storage] Loaded tasks from local storage:', tasks.length);
    return tasks;
  } catch (error) {
    console.error('[Storage] Failed to load tasks:', error);
    return [];
  }
}

/**
 * 保存定时任务到本地存储
 */
export async function saveScheduledTaskToStorage(task: ScheduledTask): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveScheduledTask!(task);
    console.log('[Storage] Saved task:', task.id, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to save task:', error);
    return false;
  }
}

/**
 * 删除本地存储的定时任务
 */
export async function deleteScheduledTaskFromStorage(taskId: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.deleteScheduledTask!(taskId);
    console.log('[Storage] Deleted task:', taskId, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to delete task:', error);
    return false;
  }
}

/**
 * 切换定时任务状态
 */
export async function toggleScheduledTaskInStorage(taskId: string, enabled: boolean): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.toggleScheduledTask!(taskId, enabled);
    console.log('[Storage] Toggled task:', taskId, enabled, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to toggle task:', error);
    return false;
  }
}

/**
 * 添加执行记录到本地存储
 */
export async function addTaskRunToStorage(run: ScheduledTaskRun): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.addTaskRun!(run);
    console.log('[Storage] Added task run:', run.id, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to add task run:', error);
    return false;
  }
}

export async function loadAllTaskRunsFromStorage(): Promise<Record<string, ScheduledTaskRun[]>> {
  if (!isElectronEnvironment()) {
    return {};
  }

  try {
    const runs = await window.electronAPI!.getAllTaskRuns!();
    console.log('[Storage] Loaded all task runs');
    return runs;
  } catch (error) {
    console.error('[Storage] Failed to load task runs:', error);
    return {};
  }
}

// ========== 工作流持久化 ==========

/**
 * 从本地存储加载工作流列表
 */
export async function loadWorkflowsFromStorage(): Promise<any[]> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading workflows');
    return [];
  }

  try {
    const workflows = await window.electronAPI!.getWorkflows!();
    console.log('[Storage] Loaded workflows from local storage:', workflows.length);
    return workflows || [];
  } catch (error) {
    console.error('[Storage] Failed to load workflows:', error);
    return [];
  }
}

/**
 * 保存工作流到本地存储
 */
export async function saveWorkflowToStorage(workflow: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveWorkflow!(workflow);
    console.log('[Storage] Saved workflow:', workflow.id, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to save workflow:', error);
    return false;
  }
}

/**
 * 删除工作流
 */
export async function deleteWorkflowFromStorage(workflowId: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.deleteWorkflow!(workflowId);
    console.log('[Storage] Deleted workflow:', workflowId, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to delete workflow:', error);
    return false;
  }
}

/**
 * 重命名工作流
 */
export async function renameWorkflowInStorage(oldName: string, newName: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.renameWorkflow!(oldName, newName);
    console.log('[Storage] Renamed workflow:', oldName, '->', newName, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to rename workflow:', error);
    return false;
  }
}

/**
 * 导入工作流到存储
 */
export async function importWorkflowToStorage(workflow: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveWorkflow!(workflow);
    console.log('[Storage] Imported workflow:', workflow.id, result);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to import workflow:', error);
    return false;
  }
}

/**
 * 检查工作流名称是否已存在
 */
export async function workflowNameExistsInStorage(name: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const workflows = await window.electronAPI!.getWorkflows!();
    return workflows.some((w: any) => w.name === name);
  } catch (error) {
    console.error('[Storage] Failed to check workflow name:', error);
    return false;
  }
}

// ========== 黑板状态持久化（V2 - 分文件存储） ==========

/**
 * 从本地存储加载全局变量
 */
export async function loadGlobalVariablesFromStorage(): Promise<any[]> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading global variables');
    return [];
  }

  try {
    const state = await window.electronAPI!.getGlobalVariables?.();
    if (state && state.variables) {
      console.log('[Storage] Loaded global variables:', state.variables.length);
      return state.variables;
    }
    return [];
  } catch (error) {
    console.error('[Storage] Failed to load global variables:', error);
    return [];
  }
}

/**
 * 保存全局变量到本地存储
 */
export async function saveGlobalVariablesToStorage(variables: any[]): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveGlobalVariables?.({
      version: 1,
      variables,
      lastUpdated: new Date().toISOString(),
    });
    console.log('[Storage] Saved global variables:', variables.length);
    return result ?? true;
  } catch (error) {
    console.error('[Storage] Failed to save global variables:', error);
    return false;
  }
}

/**
 * 从本地存储加载工作流变量
 */
export async function loadWorkflowVariablesFromStorage(workflowId: string): Promise<any[]> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading workflow variables');
    return [];
  }

  try {
    const state = await window.electronAPI!.getWorkflowVariables?.(workflowId);
    if (state && state.variables) {
      console.log('[Storage] Loaded workflow variables for', workflowId, ':', state.variables.length);
      return state.variables;
    }
    return [];
  } catch (error) {
    console.error('[Storage] Failed to load workflow variables:', error);
    return [];
  }
}

/**
 * 保存工作流变量到本地存储
 */
export async function saveWorkflowVariablesToStorage(workflowId: string, variables: any[]): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveWorkflowVariables?.({
      workflowId,
      version: 1,
      variables,
      lastUpdated: new Date().toISOString(),
    });
    console.log('[Storage] Saved workflow variables for', workflowId, ':', variables.length);
    return result ?? true;
  } catch (error) {
    console.error('[Storage] Failed to save workflow variables:', error);
    return false;
  }
}

/**
 * 删除工作流变量目录
 */
export async function deleteWorkflowVariablesFromStorage(workflowId: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.deleteWorkflowDataDir?.(workflowId);
    console.log('[Storage] Deleted workflow data directory for', workflowId);
    return result ?? true;
  } catch (error) {
    console.error('[Storage] Failed to delete workflow data directory:', error);
    return false;
  }
}

/**
 * 获取所有工作流的变量
 */
export async function loadAllWorkflowVariablesFromStorage(): Promise<Record<string, any>> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading all workflow variables');
    return {};
  }

  try {
    const result = await window.electronAPI!.getAllWorkflowVariables?.();
    console.log('[Storage] Loaded all workflow variables');
    return result || {};
  } catch (error) {
    console.error('[Storage] Failed to load all workflow variables:', error);
    return {};
  }
}

// ========== 黑板状态持久化（旧版兼容） ==========

/**
 * 从本地存储加载黑板状态
 */
export async function loadBlackboardStateFromStorage(): Promise<any> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading blackboard');
    return null;
  }

  try {
    const state = await window.electronAPI!.getBlackboardState!();
    console.log('[Storage] Loaded blackboard state');
    return state;
  } catch (error) {
    console.error('[Storage] Failed to load blackboard state:', error);
    return null;
  }
}

/**
 * 保存黑板状态到本地存储
 */
export async function saveBlackboardStateToStorage(state: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveBlackboardState!(state);
    console.log('[Storage] Saved blackboard state, variables:', state.variables?.length || 0);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to save blackboard state:', error);
    return false;
  }
}

/**
 * 更新黑板变量
 */
export async function updateBlackboardVariableInStorage(entry: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.updateBlackboardVariable!(entry);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to update blackboard variable:', error);
    return false;
  }
}

/**
 * 添加黑板事件
 */
export async function addBlackboardEventToStorage(event: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.addBlackboardEvent!(event);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to add blackboard event:', error);
    return false;
  }
}

// ========== 执行状态持久化 ==========

/**
 * 从本地存储加载所有执行状态
 */
export async function loadExecutionStatesFromStorage(): Promise<Record<string, any>> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading execution states');
    return {};
  }

  try {
    const states = await window.electronAPI!.getAllExecutionStates!();
    console.log('[Storage] Loaded execution states from local storage');
    return states || {};
  } catch (error) {
    console.error('[Storage] Failed to load execution states:', error);
    return {};
  }
}

/**
 * 保存执行状态到本地存储
 */
export async function saveExecutionStateToStorage(state: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveExecutionState!(state);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to save execution state:', error);
    return false;
  }
}

/**
 * 删除本地存储的执行状态
 */
export async function deleteExecutionStateFromStorage(instanceId: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.deleteExecutionState!(instanceId);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to delete execution state:', error);
    return false;
  }
}

/**
 * 清理过期的执行状态
 */
export async function cleanupExecutionStatesInStorage(): Promise<number> {
  if (!isElectronEnvironment()) {
    return 0;
  }

  try {
    const count = await window.electronAPI!.cleanupExecutionStates!();
    console.log('[Storage] Cleaned up expired execution states:', count);
    return count;
  } catch (error) {
    console.error('[Storage] Failed to cleanup execution states:', error);
    return 0;
  }
}

// ========== 工作流执行日志持久化 ==========

/**
 * 保存工作流执行日志
 */
export async function saveWorkflowExecutionLogToStorage(log: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveWorkflowExecutionLog!(log);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to save workflow execution log:', error);
    return false;
  }
}

/**
 * 获取工作流执行日志
 */
export async function getWorkflowExecutionLogFromStorage(logId: string): Promise<any | null> {
  if (!isElectronEnvironment()) {
    return null;
  }

  try {
    const log = await window.electronAPI!.getWorkflowExecutionLog!(logId);
    return log || null;
  } catch (error) {
    console.error('[Storage] Failed to get workflow execution log:', error);
    return null;
  }
}

/**
 * 获取工作流执行日志列表
 */
export async function getWorkflowExecutionLogsFromStorage(options?: {
  workflowId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  if (!isElectronEnvironment()) {
    return [];
  }

  try {
    const logs = await window.electronAPI!.getWorkflowExecutionLogs!(options);
    return logs || [];
  } catch (error) {
    console.error('[Storage] Failed to get workflow execution logs:', error);
    return [];
  }
}

/**
 * 删除工作流执行日志
 */
export async function deleteWorkflowExecutionLogFromStorage(logId: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.deleteWorkflowExecutionLog!(logId);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to delete workflow execution log:', error);
    return false;
  }
}

// ========== 部门持久化 ==========

/**
 * 从本地存储加载部门数据
 */
export async function loadDepartmentsFromStorage(): Promise<any[]> {
  if (!isElectronEnvironment()) {
    console.log('[Storage] Not in Electron environment, skip loading departments');
    return [];
  }

  try {
    const departments = await window.electronAPI!.getDepartments!();
    console.log('[Storage] Loaded departments from local storage:', departments?.length || 0);
    return departments || [];
  } catch (error) {
    console.error('[Storage] Failed to load departments:', error);
    return [];
  }
}

/**
 * 保存部门数据到本地存储
 */
export async function saveDepartmentsToStorage(departments: any[]): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveDepartments!(departments);
    console.log('[Storage] Saved departments:', departments.length);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to save departments:', error);
    return false;
  }
}

/**
 * 保存单个部门到本地存储
 */
export async function saveDepartmentToStorage(department: any): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.saveDepartment!(department);
    console.log('[Storage] Saved department:', department.id);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to save department:', error);
    return false;
  }
}

/**
 * 删除部门
 */
export async function deleteDepartmentFromStorage(departmentId: string): Promise<boolean> {
  if (!isElectronEnvironment()) {
    return false;
  }

  try {
    const result = await window.electronAPI!.deleteDepartment!(departmentId);
    console.log('[Storage] Deleted department:', departmentId);
    return result;
  } catch (error) {
    console.error('[Storage] Failed to delete department:', error);
    return false;
  }
}

/**
 * 获取数据目录路径
 */
export function getDataDirectory(): string {
  if (!isElectronEnvironment()) {
    return '';
  }
  
  // 同步调用需要特殊处理，这里返回空字符串
  // 实际使用时应该使用异步版本
  return '';
}

/**
 * 异步获取数据目录路径
 */
export async function getDataDirectoryAsync(): Promise<string> {
  if (!isElectronEnvironment()) {
    return '';
  }

  try {
    const dir = await window.electronAPI!.getDataDirectory!();
    return dir || '';
  } catch (error) {
    console.error('[Storage] Failed to get data directory:', error);
    return '';
  }
}