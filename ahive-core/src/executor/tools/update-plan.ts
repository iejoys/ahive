/**
 * update_plan 工具实现
 * 
 * 用于拆分任务为可追踪的步骤
 * 基于 CODEX 的 update_plan 工具设计
 * 
 * 功能：
 * - 创建任务计划
 * - 更新步骤状态
 * - JSON 文件持久化
 * - 进度追踪
 */

import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { AgentTool, ToolResult } from '../tool-system.js';
import { errorResult } from '../tool-system.js';
import type { TaskPlan, TaskStep, TaskProgress, StepStatus } from './task-plan.js';

// ============ 参数 Schema ============

const StepStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

const PlanItemSchema = z.object({
  step: z.string().min(1, 'Step description cannot be empty'),
  status: StepStatusSchema,
  // 工作流扩展字段（可选）
  agentType: z.enum(['frontend', 'backend', 'fullstack', 'art', 'audio', 'general']).optional(),
  dependsOn: z.array(z.string()).optional(),
  estimatedMinutes: z.number().optional(),
  expectedOutputs: z.array(z.string()).optional(),
});

const UpdatePlanParamsSchema = z.object({
  explanation: z.string().optional(),
  plan: z.array(PlanItemSchema).min(1, 'At least one step required'),
  // 工作流上下文（可选，由动态注入提示词提供）
  taskId: z.string().optional(),
  nodeId: z.string().optional(),
  workflowId: z.string().optional(),
  instanceId: z.string().optional(),
  // 审批状态（工作流场景使用）
  approvalStatus: z.enum(['pending_approval', 'approved', 'rejected']).optional(),
});

type UpdatePlanParams = z.infer<typeof UpdatePlanParamsSchema>;

// ============ 持久化配置 ============

const PLANS_DIR = '.ahive/plans';

// ============ 辅助函数 ============

/**
 * 获取计划存储目录
 */
async function getPlansDir(workspace: string): Promise<string> {
  const dir = path.join(workspace, PLANS_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 生成计划 ID
 */
function generatePlanId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `plan-${timestamp}-${random}`;
}

/**
 * 加载计划
 */
async function loadPlan(workspace: string, planId: string): Promise<TaskPlan | null> {
  try {
    const dir = await getPlansDir(workspace);
    const filePath = path.join(dir, `${planId}.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 保存计划
 */
async function savePlan(workspace: string, plan: TaskPlan): Promise<void> {
  const dir = await getPlansDir(workspace);
  const filePath = path.join(dir, `${plan.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * 查找活动计划
 */
async function findActivePlan(
  workspace: string,
  sessionId: string
): Promise<TaskPlan | null> {
  try {
    const dir = await getPlansDir(workspace);
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const plan = await loadPlan(workspace, file.replace('.json', ''));
      if (plan && plan.sessionId === sessionId && plan.status === 'running') {
        return plan;
      }
    }
  } catch {
    // 目录不存在或读取失败
  }
  return null;
}

/**
 * 计算进度
 */
function calculateProgress(plan: TaskPlan): TaskProgress {
  const total = plan.steps.length;
  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const inProgress = plan.steps.filter(s => s.status === 'in_progress').length;
  const pending = plan.steps.filter(s => s.status === 'pending').length;
  return {
    total,
    completed,
    inProgress,
    pending,
    percentage: Math.round((completed / total) * 100),
  };
}

/**
 * 查找下一个步骤
 */
function findNextStep(plan: TaskPlan): TaskStep | null {
  // 优先返回 in_progress 的步骤
  const inProgress = plan.steps.find(s => s.status === 'in_progress');
  if (inProgress) return inProgress;
  
  // 否则返回第一个 pending 的步骤
  return plan.steps.find(s => s.status === 'pending') || null;
}

/**
 * 获取状态图标
 */
function getStatusIcon(status: StepStatus): string {
  switch (status) {
    case 'completed': return '✅';
    case 'in_progress': return '🔄';
    case 'pending': return '⏳';
    case 'failed': return '❌';
  }
}

// ============ 工具定义 ============

export const updatePlanTool: AgentTool<UpdatePlanParams> = {
  name: 'update_plan',
  label: 'update task plan',
  description: `Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.

Usage:
- Create a new plan: call with a list of steps, first one as in_progress
- Update progress: mark completed steps as 'completed', next as 'in_progress'
- Complete task: mark all steps as 'completed'

Step description should be concise (5-7 words max).`,
  parameters: UpdatePlanParamsSchema,

  async execute(toolCallId, params, signal) {
    // 解构所有参数
    const { 
      explanation, 
      plan, 
      taskId, 
      nodeId, 
      workflowId, 
      instanceId, 
      approvalStatus 
    } = params;
    
    // 获取工作区路径
    const workspace = process.cwd();
    
    // 使用 toolCallId 作为唯一标识
    // toolCallId 由调用方生成，格式通常是 UUID
    const sessionId = toolCallId;
    
    try {
      // 检查是否有活动的计划
      let activePlan = await findActivePlan(workspace, sessionId);
      
      if (!activePlan) {
        // 创建新计划
        activePlan = {
          id: generatePlanId(),
          title: plan[0].step.slice(0, 50), // 用第一个步骤作为标题
          steps: plan.map((item, index) => ({
            id: `step-${index + 1}`,
            description: item.step,
            status: item.status as StepStatus,
            // 工作流扩展字段
            agentType: item.agentType,
            dependencies: item.dependsOn,
            estimatedMinutes: item.estimatedMinutes,
            expectedOutputs: item.expectedOutputs,
          })),
          status: approvalStatus === 'pending_approval' ? 'pending_approval' : 'running',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'builtin',  // 内置工具调用
          sessionId,
          // 工作流上下文
          taskId,
          nodeId,
          workflowId,
          instanceId,
          // 审批状态
          approvalStatus: approvalStatus === 'pending_approval' ? 'pending' : approvalStatus,
        };
      } else {
        // 更新现有计划
        activePlan.steps = plan.map((item, index) => {
          const existing = activePlan!.steps[index];
          
          const newStep: TaskStep = {
            id: existing?.id || `step-${index + 1}`,
            description: item.step,
            status: item.status as StepStatus,
            // 工作流扩展字段
            agentType: item.agentType,
            dependencies: item.dependsOn,
            estimatedMinutes: item.estimatedMinutes,
            expectedOutputs: item.expectedOutputs,
          };
          
          // 保留已有的结果和时间戳
          if (existing?.result) {
            newStep.result = existing.result;
          }
          if (existing?.startedAt) {
            newStep.startedAt = existing.startedAt;
          }
          if (existing?.completedAt) {
            newStep.completedAt = existing.completedAt;
          }
          
          // 更新时间戳
          if (item.status === 'in_progress' && !existing?.startedAt) {
            newStep.startedAt = Date.now();
          }
          if (item.status === 'completed' && !existing?.completedAt) {
            newStep.completedAt = Date.now();
          }
          
          return newStep;
        });
        activePlan.updatedAt = Date.now();
        
        // 检查是否全部完成
        const allCompleted = plan.every(item => item.status === 'completed');
        if (allCompleted) {
          activePlan.status = 'completed';
          activePlan.completedAt = Date.now();
        }
      }
      
      // 保存
      await savePlan(workspace, activePlan);
      
      // 生成响应
      const progress = calculateProgress(activePlan);
      const nextStep = findNextStep(activePlan);
      
      let message = `📋 Task plan updated\n\n`;
      message += `**Plan ID**: ${activePlan.id}\n`;
      message += `**Progress**: ${progress.completed}/${progress.total} (${progress.percentage}%)\n\n`;
      
      if (explanation) {
        message += `**Explanation**: ${explanation}\n\n`;
      }
      
      message += `## Steps\n\n`;
      for (const step of activePlan.steps) {
        const icon = getStatusIcon(step.status);
        message += `${icon} [${step.id}] ${step.description}\n`;
      }
      
      if (activePlan.status === 'completed') {
        message += `\n✅ All steps completed!`;
      } else if (nextStep) {
        message += `\n📍 Next: [${nextStep.id}] ${nextStep.description}`;
      }
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: message,
        }],
        details: {
          planId: activePlan.id,
          progress,
          nextStep: nextStep?.id,
        },
      };
    } catch (error) {
      return errorResult('update_plan', error);
    }
  },
};

// ============ 导出辅助函数（供扩展使用）============

export {
  loadPlan,
  savePlan,
  findActivePlan,
  calculateProgress,
  findNextStep,
  getPlansDir,
};
