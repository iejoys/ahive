/**
 * 定时任务执行器
 * 根据环境选择执行方式：Electron IPC 或 Web API
 */

import type { ScheduledTask, Agent } from '../types';

export interface ExecutionResult {
  success: boolean;
  output: string[];
  error?: string;
}

/**
 * 检测是否在 Electron 环境
 */
export function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.isDesktop === true;
}

/**
 * 执行定时任务
 */
export async function executeScheduledTask(
  task: ScheduledTask,
  agents: Agent[]
): Promise<ExecutionResult> {
  console.log(`[Executor] Executing task: ${task.name}, targetType: ${task.targetType}`);

  if (task.targetType === 'agent') {
    return executeAgentTask(task, agents);
  } else if (task.targetType === 'workflow') {
    return executeWorkflowTask(task);
  }

  return {
    success: false,
    output: [],
    error: `Unknown target type: ${task.targetType}`,
  };
}

/**
 * 执行智能体任务
 */
async function executeAgentTask(
  task: ScheduledTask,
  agents: Agent[]
): Promise<ExecutionResult> {
  if (!task.agentId) {
    return { success: false, output: [], error: 'No agent specified' };
  }

  const agent = agents.find((a) => a.id === task.agentId);
  if (!agent) {
    return { success: false, output: [], error: `Agent not found: ${task.agentId}` };
  }

  const message = task.taskPrompt || `Execute scheduled task: ${task.name}`;

  if (isElectronEnvironment()) {
    return executeViaElectronIPC(agent.name, message);
  } else {
    return executeViaAPI(task.agentId, message);
  }
}

/**
 * 提取智能体回复文本
 */
function extractAgentReply(data: any): string[] {
  const output: string[] = [];
  
  if (!data) {
    return output;
  }
  
  // OpenClaw 返回格式: result.payloads[].text
  if (data.result?.payloads && Array.isArray(data.result.payloads)) {
    for (const payload of data.result.payloads) {
      if (payload.text) {
        output.push(payload.text);
      }
    }
  } else if (typeof data === 'string') {
    output.push(data);
  } else if (data.text) {
    output.push(data.text);
  } else if (data.message) {
    output.push(data.message);
  }
  
  return output;
}

/**
 * 通过 Electron IPC 执行
 */
async function executeViaElectronIPC(
  agentName: string,
  message: string
): Promise<ExecutionResult> {
  console.log(`[Executor] Using Electron IPC for agent: ${agentName}`);

  try {
    const result = await window.electronAPI!.sendMessageToAgent(agentName, message);

    if (!result.success) {
      return {
        success: false,
        output: [result.stderr || result.error || 'Unknown error'],
        error: result.error,
      };
    }

    // 提取智能体回复文本
    let output = extractAgentReply(result.data);
    
    // 兜底：从 raw 或 stdout 提取
    if (output.length === 0) {
      if (result.raw) {
        output.push(result.raw);
      } else if (result.stdout) {
        output.push(result.stdout);
      } else {
        output.push('[执行成功]');
      }
    }

    return { success: true, output };
  } catch (error: any) {
    return {
      success: false,
      output: [],
      error: error.message || 'Electron IPC error',
    };
  }
}

/**
 * 通过 Web API 执行
 */
async function executeViaAPI(
  agentId: string,
  message: string
): Promise<ExecutionResult> {
  console.log(`[Executor] Using Web API for agent: ${agentId}`);

  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, task: message }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        output: [],
        error: errorData.error || `HTTP ${response.status}`,
      };
    }

    const task = await response.json();
    const output = task.output || ['Task executed successfully'];

    return {
      success: task.status === 'completed',
      output: Array.isArray(output) ? output : [output],
      error: task.status === 'failed' ? 'Task failed' : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      output: [],
      error: error.message || 'API request failed',
    };
  }
}

/**
 * 执行工作流任务
 */
async function executeWorkflowTask(task: ScheduledTask): Promise<ExecutionResult> {
  if (!task.workflowId) {
    return { success: false, output: [], error: 'No workflow specified' };
  }

  console.log(`[Executor] Starting workflow: ${task.workflowId}`);

  return {
    success: true,
    output: [`Workflow ${task.workflowId} executed (mock)`],
  };
}