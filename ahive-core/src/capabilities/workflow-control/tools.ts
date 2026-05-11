/**
 * 工作流控制工具定义
 * 
 * 用于 AHIVECORE 指挥官控制工作流执行状态
 */

import { z } from 'zod';
import type { AgentTool } from '../../executor/tool-system.js';
import { getWorkflowController } from './WorkflowController.js';

// ==================== 参数 Schema ====================

const WorkflowPauseParamsSchema = z.object({
  instance_id: z.string().describe('工作流实例 ID'),
  reason: z.string().optional().describe('暂停原因'),
});

const WorkflowResumeParamsSchema = z.object({
  instance_id: z.string().describe('工作流实例 ID'),
});

const WorkflowStopParamsSchema = z.object({
  instance_id: z.string().describe('工作流实例 ID'),
  reason: z.string().optional().describe('停止原因'),
});

const WorkflowExecuteParamsSchema = z.object({
  workflow_id: z.string().describe('工作流 ID（必填）'),
  variables: z.record(z.unknown()).optional().describe('工作流变量（可选）'),
});

const WorkflowListActiveParamsSchema = z.object({});

// ==================== 工具定义 ====================

/**
 * 暂停工作流工具
 */
export const workflowPauseTool: AgentTool<z.infer<typeof WorkflowPauseParamsSchema>> = {
  name: 'workflow_pause',
  label: 'pause workflow',
  description: `暂停正在执行的工作流实例。

使用场景：
- 用户说"暂停工作流"
- 用户说"暂停当前执行"
- 用户说"先停一下工作流"

参数：
- instance_id: 工作流实例 ID（必填）
- reason: 暂停原因（可选）

示例：
用户说"暂停工作流 exec-12345" → 调用 workflow_pause(instance_id="exec-12345")`,
  parameters: WorkflowPauseParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getWorkflowController();
    return controller.pause(params.instance_id, params.reason);
  },
};

/**
 * 恢复工作流工具
 */
export const workflowResumeTool: AgentTool<z.infer<typeof WorkflowResumeParamsSchema>> = {
  name: 'workflow_resume',
  label: 'resume workflow',
  description: `恢复已暂停的工作流实例。

使用场景：
- 用户说"恢复工作流"
- 用户说"继续执行"
- 用户说"重新开始工作流"

参数：
- instance_id: 工作流实例 ID（必填）

示例：
用户说"恢复工作流 exec-12345" → 调用 workflow_resume(instance_id="exec-12345")`,
  parameters: WorkflowResumeParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getWorkflowController();
    return controller.resume(params.instance_id);
  },
};

/**
 * 停止工作流工具
 */
export const workflowStopTool: AgentTool<z.infer<typeof WorkflowStopParamsSchema>> = {
  name: 'workflow_stop',
  label: 'stop workflow',
  description: `停止工作流实例（终止执行，不可恢复）。

使用场景：
- 用户说"停止工作流"
- 用户说"终止工作流"
- 用户说"关闭工作流"
- 用户说"取消执行"

参数：
- instance_id: 工作流实例 ID（必填）
- reason: 停止原因（可选）

示例：
用户说"停止工作流 exec-12345" → 调用 workflow_stop(instance_id="exec-12345", reason="用户请求停止")`,
  parameters: WorkflowStopParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getWorkflowController();
    return controller.stop(params.instance_id, params.reason);
  },
};

/**
 * 获取活跃工作流列表工具
 */
export const workflowListActiveTool: AgentTool<z.infer<typeof WorkflowListActiveParamsSchema>> = {
  name: 'workflow_list_active',
  label: 'list active workflows',
  description: `获取当前活跃的工作流实例列表。

使用场景：
- 用户说"查看正在运行的工作流"
- 用户说"有哪些工作流在执行"
- 用户说"显示活跃工作流"

返回：活跃工作流实例列表，包含实例 ID、工作流名称、状态等信息。

示例：
用户说"查看活跃工作流" → 调用 workflow_list_active()`,
  parameters: WorkflowListActiveParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getWorkflowController();
    return controller.listActive();
  },
};

/**
 * 启动工作流工具
 */
export const workflowExecuteTool: AgentTool<z.infer<typeof WorkflowExecuteParamsSchema>> = {
  name: 'workflow_execute',
  label: 'execute workflow',
  description: `启动工作流执行。

使用场景：
- 用户说"启动工作流"
- 用户说"执行工作流"
- 用户说"运行工作流"
- 用户说"开始工作流 xxx"

参数：
- workflow_id: 工作流 ID（必填）
- variables: 工作流变量（可选，JSON 对象）

示例：
用户说"启动工作流 wf-12345" → 调用 workflow_execute(workflow_id="wf-12345")
用户说"执行工作流 wf-12345，参数 name=测试" → 调用 workflow_execute(workflow_id="wf-12345", variables={"name": "测试"})`,
  parameters: WorkflowExecuteParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getWorkflowController();
    return controller.execute(params.workflow_id, params.variables);
  },
};

// ==================== 导出所有工具 ====================

/**
 * 工作流控制工具列表
 */
export const workflowControlTools = [
  workflowExecuteTool,
  workflowPauseTool,
  workflowResumeTool,
  workflowStopTool,
  workflowListActiveTool,
];