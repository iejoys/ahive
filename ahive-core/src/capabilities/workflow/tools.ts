/**
 * 工作流编排工具定义
 * 
 * 提供指挥官用于创建、修改、管理工作流的工具
 */

import { z } from 'zod';
import type { AgentTool } from '../../executor/tool-system.js';
import { logger } from '../../utils/index.js';
import { getWorkflowOrchestrator, type WorkflowJSON, type WorkflowNode, type WorkflowEdge } from '../../orchestrator/WorkflowOrchestrator.js';
import { getWSClient, type WSMessage } from '../../monitoring/ws-client.js';

// ==================== 工具定义 ====================

/**
 * 创建工作流工具
 */
const CreateWorkflowParamsSchema = z.object({
  user_intent: z.string().describe('用户意图描述，如"创建一个代码审查工作流"'),
  available_agents: z.array(z.string()).optional().describe('可用智能体 ID 列表'),
});

export const createWorkflowTool: AgentTool<z.infer<typeof CreateWorkflowParamsSchema>> = {
  name: 'create_workflow',
  label: 'create workflow',
  description: `创建工作流。根据用户意图，迭代式精化生成工作流 JSON 文件。

流程：
1. 第一层：生成骨架（节点列表 + 基本连接）
2. 第二层：逐节点精化（补充详细配置）
3. 第三层：连接优化（数据流转逻辑）
4. 第四层：最终验证（完整性检查）

每层完成后立即保存并通知前端刷新显示。

参数：
- user_intent: 用户意图描述
- available_agents: 可用智能体 ID 列表（可选）

示例：
- { "user_intent": "创建一个代码审查工作流，包含代码扫描、质量分析、生成报告" }
- { "user_intent": "创建一个游戏开发工作流", "available_agents": ["agent-coder", "agent-designer"] }`,
  parameters: CreateWorkflowParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const orchestrator = getWorkflowOrchestrator();
    
    if (!orchestrator) {
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: '❌ WorkflowOrchestrator 未初始化，请先初始化系统',
        }],
      };
    }
    
    try {
      logger.info('[create_workflow] 开始创建工作流:', params.user_intent);
      
      const result = await orchestrator.generateWorkflowIteratively(
        params.user_intent,
        params.available_agents
      );
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 工作流已创建完成！

工作流 ID: ${result.workflowId}
工作流名称: ${result.workflowName}
文件路径: ${result.filePath}

工作流已保存到客户端文件夹，前端会自动加载并显示。
用户可以在工作流编辑器中查看和修改。`,
        }],
        details: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[create_workflow] 创建失败:', message);
      
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 创建工作流失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 修改工作流工具
 */
const ModifyWorkflowParamsSchema = z.object({
  workflow_id: z.string().describe('工作流 ID'),
  modifications: z.object({
    addNodes: z.array(z.object({
      id: z.string().describe('节点 ID'),
      type: z.enum(['variable', 'agent', 'review', 'condition', 'parallel', 'loop', 'output']).describe('节点类型'),
      name: z.string().describe('节点名称'),
      position: z.object({ x: z.number().describe('X 坐标'), y: z.number().describe('Y 坐标') }).describe('节点位置'),
      config: z.record(z.any()).optional().describe('节点配置'),
    })).optional().describe('要添加的节点'),
    removeNodes: z.array(z.string()).optional().describe('要删除的节点 ID'),
    updateNodes: z.array(z.object({
      id: z.string().describe('节点 ID'),
      config: z.record(z.any()).describe('更新的配置'),
    })).optional().describe('要更新的节点'),
    addEdges: z.array(z.object({
      id: z.string().describe('边 ID'),
      source: z.string().describe('源节点 ID'),
      target: z.string().describe('目标节点 ID'),
      condition: z.record(z.any()).optional().describe('边条件'),
    })).optional().describe('要添加的边'),
    removeEdges: z.array(z.string()).optional().describe('要删除的边 ID'),
  }).describe('修改内容'),
});

// 类型转换辅助函数
function toModifyParams(params: z.infer<typeof ModifyWorkflowParamsSchema>) {
  return {
    addNodes: params.modifications.addNodes?.map(n => ({
      id: n.id,
      type: n.type,
      name: n.name,
      position: n.position,
      config: n.config || {},
    })),
    removeNodes: params.modifications.removeNodes,
    updateNodes: params.modifications.updateNodes?.map(u => ({
      id: u.id,
      config: u.config,
    })),
    addEdges: params.modifications.addEdges?.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      condition: e.condition,
    })),
    removeEdges: params.modifications.removeEdges,
  };
}

export const modifyWorkflowTool: AgentTool<z.infer<typeof ModifyWorkflowParamsSchema>> = {
  name: 'modify_workflow',
  label: 'modify workflow',
  description: `修改现有工作流。可以添加/删除/更新节点和边。

参数：
- workflow_id: 工作流 ID
- modifications: 修改内容
  - add_nodes: 要添加的节点
  - remove_nodes: 要删除的节点 ID
  - update_nodes: 要更新的节点配置
  - add_edges: 要添加的边
  - remove_edges: 要删除的边 ID

示例：
- 添加节点: { "workflow_id": "workflow-xxx", "modifications": { "add_nodes": [{ "id": "node-new", "type": "agent", "name": "新任务", "position": { "x": 500, "y": 100 } }] } }
- 删除节点: { "workflow_id": "workflow-xxx", "modifications": { "remove_nodes": ["node-1"] } }`,
  parameters: ModifyWorkflowParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const orchestrator = getWorkflowOrchestrator();
    
    if (!orchestrator) {
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: '❌ WorkflowOrchestrator 未初始化',
        }],
      };
    }
    
    try {
      const result = await orchestrator.modifyWorkflow(
        params.workflow_id,
        toModifyParams(params)
      );
      
      if (!result) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 工作流不存在: ${params.workflow_id}`,
          }],
        };
      }
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 工作流已修改完成！

工作流 ID: ${result.workflowId}
文件路径: ${result.filePath}

修改内容：
- 添加节点: ${params.modifications.addNodes?.length || 0} 个
- 删除节点: ${params.modifications.removeNodes?.length || 0} 个
- 更新节点: ${params.modifications.updateNodes?.length || 0} 个
- 添加边: ${params.modifications.addEdges?.length || 0} 条
- 删除边: ${params.modifications.removeEdges?.length || 0} 条`,
        }],
        details: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 修改工作流失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 列出工作流工具
 */
const ListWorkflowsParamsSchema = z.object({});

export const listWorkflowsTool: AgentTool<z.infer<typeof ListWorkflowsParamsSchema>> = {
  name: 'list_workflows',
  label: 'list workflows',
  description: '列出所有已创建的工作流。',
  parameters: ListWorkflowsParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const orchestrator = getWorkflowOrchestrator();
    
    if (!orchestrator) {
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: '❌ WorkflowOrchestrator 未初始化',
        }],
      };
    }
    
    try {
      const workflows = await orchestrator.listWorkflows();
      
      if (workflows.length === 0) {
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: '当前没有已创建的工作流。\n\n使用 create_workflow 创建新工作流。',
          }],
        };
      }
      
      const text = workflows.map(w => 
        `- ${w.name} (ID: ${w.id})\n  文件: ${w.filePath}`
      ).join('\n');
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `📋 已创建的工作流 (${workflows.length} 个):\n\n${text}`,
        }],
        details: { workflows },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 列出工作流失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 删除工作流工具
 */
const DeleteWorkflowParamsSchema = z.object({
  workflow_id: z.string().describe('要删除的工作流 ID'),
});

export const deleteWorkflowTool: AgentTool<z.infer<typeof DeleteWorkflowParamsSchema>> = {
  name: 'delete_workflow',
  label: 'delete workflow',
  description: '删除指定的工作流。',
  parameters: DeleteWorkflowParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const orchestrator = getWorkflowOrchestrator();
    
    if (!orchestrator) {
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: '❌ WorkflowOrchestrator 未初始化',
        }],
      };
    }
    
    try {
      const success = await orchestrator.deleteWorkflow(params.workflow_id);
      
      if (!success) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 删除失败，工作流可能不存在: ${params.workflow_id}`,
          }],
        };
      }
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 工作流已删除: ${params.workflow_id}`,
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 删除工作流失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 验证工作流工具
 */
const ValidateWorkflowParamsSchema = z.object({
  workflow_id: z.string().describe('要验证的工作流 ID'),
});

export const validateWorkflowTool: AgentTool<z.infer<typeof ValidateWorkflowParamsSchema>> = {
  name: 'validate_workflow',
  label: 'validate workflow',
  description: '验证工作流的完整性和正确性。',
  parameters: ValidateWorkflowParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const orchestrator = getWorkflowOrchestrator();
    
    if (!orchestrator) {
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: '❌ WorkflowOrchestrator 未初始化',
        }],
      };
    }
    
    try {
      const workflow = await orchestrator.loadWorkflow(params.workflow_id);
      
      if (!workflow) {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `❌ 工作流不存在: ${params.workflow_id}`,
          }],
        };
      }
      
      // 验证逻辑
      const issues: string[] = [];
      
      // 检查孤立节点
      const connectedNodes = new Set<string>();
      workflow.edges.forEach(e => {
        connectedNodes.add(e.source);
        connectedNodes.add(e.target);
      });
      
      const isolatedNodes = workflow.nodes.filter(n => !connectedNodes.has(n.id));
      if (isolatedNodes.length > 0) {
        issues.push(`孤立节点: ${isolatedNodes.map(n => n.name).join(', ')}`);
      }
      
      // 检查配置完整性
      const incompleteNodes = workflow.nodes.filter(n => {
        if (n.type === 'agent' && !n.config.taskTemplate) return true;
        if (n.type === 'variable' && !n.config.variableConfig) return true;
        return false;
      });
      
      if (incompleteNodes.length > 0) {
        issues.push(`配置不完整: ${incompleteNodes.map(n => n.name).join(', ')}`);
      }
      
      // 检查边连接有效性
      const invalidEdges = workflow.edges.filter(e => {
        const sourceExists = workflow.nodes.some(n => n.id === e.source);
        const targetExists = workflow.nodes.some(n => n.id === e.target);
        return !sourceExists || !targetExists;
      });
      
      if (invalidEdges.length > 0) {
        issues.push(`无效连接: ${invalidEdges.length} 条边连接了不存在的节点`);
      }
      
      if (issues.length === 0) {
        return {
          success: true,
          content: [{
            type: 'text' as const,
            text: `✅ 工作流验证通过！

工作流: ${workflow.name}
节点数: ${workflow.nodes.length}
边数: ${workflow.edges.length}

所有检查项均通过：
- 无孤立节点
- 所有节点配置完整
- 所有边连接有效`,
          }],
          details: { workflow },
        };
      } else {
        return {
          success: false,
          content: [{
            type: 'text' as const,
            text: `⚠️ 工作流存在问题：

${issues.map(i => `- ${i}`).join('\n')}

建议使用 modify_workflow 修复这些问题。`,
          }],
          details: { workflow, issues },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 验证工作流失败: ${message}`,
        }],
      };
    }
  },
};

// ==================== 工作流状态报告工具 ====================

/**
 * 指挥官专用工具：向工作流引擎发送任务状态报告
 * 
 * 设计思想：
 * - 指挥官与工作流引擎之间：格式化 JSON 数据
 * - 指挥官与任务 Agent 之间：自然语言消息（使用 send_message）
 */
const WorkflowReportParamsSchema = z.object({
  report_type: z.enum([
    'task_ack', 
    'task_progress', 
    'task_error', 
    'task_complete',
    // 任务拆解相关报告类型
    'task_decompose',           // 提案提交
    'task_decompose_approved',  // 提案批准
    'task_decompose_rejected',  // 提案驳回
    'sub_task_start',           // 子任务开始
    'sub_task_complete',        // 子任务完成
    'task_merge',               // 任务合并完成
  ])
    .describe('报告类型：task_ack(任务确认), task_progress(进度更新), task_error(异常报告), task_complete(完成报告), task_decompose(拆解提案), task_decompose_approved(提案批准), task_decompose_rejected(提案驳回), sub_task_start(子任务开始), sub_task_complete(子任务完成), task_merge(合并完成)'),
  
  task_id: z.string().describe('任务 ID（从任务消息中提取）'),
  
  node_id: z.string().optional().describe('节点 ID'),
  
  agent_id: z.string().optional().describe('执行任务的 Agent ID'),
  
  success: z.boolean().optional().describe('是否成功（task_complete 时必填）'),
  
  progress: z.number().min(0).max(100).optional().describe('进度百分比（0-100，task_progress 时使用）'),
  
  outputs: z.record(z.unknown()).optional().describe('输出结果（task_complete 时使用）'),
  
  error: z.string().optional().describe('错误信息（task_error 时必填）'),
  
  summary: z.string().optional().describe('任务摘要'),
  
  // ========== 拆解相关参数（新增） ==========
  
  /** 提案 ID（task_decompose/approved/rejected 时必填） */
  proposal_id: z.string().optional().describe('提案唯一标识'),
  
  /** 方案文件路径（task_decompose 时使用） */
  plan_path: z.string().optional().describe('拆解方案 Markdown 文件路径'),
  
  /** 方案摘要（task_decompose 时使用） */
  plan_summary: z.object({
    sub_tasks_count: z.number().describe('子任务数量'),
    estimated_time: z.number().describe('预估总耗时（分钟）'),
    risk_level: z.enum(['low', 'medium', 'high']).describe('风险等级'),
    execution_mode: z.enum(['sequential', 'parallel', 'mixed']).optional().describe('执行方式'),
  }).optional().describe('拆解方案摘要'),
  
  /** 审批状态（task_decompose 时使用） */
  status: z.enum(['pending_approval', 'approved', 'rejected', 'executing', 'merged']).optional().describe('拆解状态'),
  
  /** 授权子 Agent 数量（task_decompose_approved 时使用） */
  approved_sub_agents: z.number().optional().describe('批准的子 Agent 数量'),
  
  /** 审批意见（approved/rejected 时使用） */
  notes: z.string().optional().describe('审批意见'),
  
  /** 驳回原因（task_decompose_rejected 时必填） */
  rejection_reason: z.string().optional().describe('驳回原因'),
  
  /** 修改建议（rejected 时使用） */
  suggestions: z.string().optional().describe('修改建议'),
  
  /** 子任务 ID（sub_task_start/complete 时必填） */
  sub_task_id: z.string().optional().describe('子任务 ID'),
  
  /** 子任务名称（sub_task_start/complete 时使用） */
  sub_task_name: z.string().optional().describe('子任务名称'),
  
  /** 子任务状态（sub_task_start/complete 时使用） */
  sub_task_status: z.enum(['pending', 'running', 'completed', 'failed']).optional().describe('子任务执行状态'),
  
  /** 子任务进度（sub_task 执行中时使用） */
  sub_task_progress: z.number().min(0).max(100).optional().describe('子任务进度百分比'),
  
  /** 子任务 Agent ID（sub_task_start/complete 时使用） */
  sub_task_agent_id: z.string().optional().describe('执行子任务的 Agent ID'),
  
  /** 合并输出（task_merge 时使用） */
  merged_output: z.record(z.unknown()).optional().describe('合并后的输出结果'),
});

export const workflowReportTool: AgentTool<z.infer<typeof WorkflowReportParamsSchema>> = {
  name: 'workflow_report',
  label: 'report to workflow engine',
  description: `指挥官专用工具：向工作流引擎发送任务状态报告。

【重要】此工具用于指挥官与工作流引擎之间的通信，发送格式化 JSON 数据。

报告类型：
- task_ack: 任务确认接收（任务 Agent 确认收到任务后，指挥官向引擎汇报）
- task_progress: 任务进度更新
- task_error: 任务异常报告
- task_complete: 任务完成报告

参数说明：
- report_type: 报告类型（必填）
- task_id: 任务 ID（必填，从任务消息中提取）
- node_id: 节点 ID（可选）
- agent_id: 执行任务的 Agent ID（可选）
- success: 是否成功（task_complete 时必填）
- progress: 进度百分比（task_progress 时使用，0-100）
- outputs: 输出结果（task_complete 时使用）
- error: 错误信息（task_error 时必填）
- summary: 任务摘要（可选）

使用流程：
1. 工作流引擎发送任务分配给指挥官
2. 指挥官下发任务给任务 Agent（使用 send_message，自然语言）
3. 任务 Agent 回复确认给指挥官（使用 send_message，自然语言）
4. 指挥官调用 workflow_report(task_ack) 向引擎汇报
5. 任务完成后，指挥官调用 workflow_report(task_complete) 向引擎汇报

示例：
- 任务确认：workflow_report({ report_type: 'task_ack', task_id: 'task_xxx', agent_id: 'coder-001' })
- 进度更新：workflow_report({ report_type: 'task_progress', task_id: 'task_xxx', progress: 50 })
- 异常报告：workflow_report({ report_type: 'task_error', task_id: 'task_xxx', error: '文件不存在' })
- 任务完成：workflow_report({ report_type: 'task_complete', task_id: 'task_xxx', success: true, outputs: { result: 'done' } })`,
  
  parameters: WorkflowReportParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const wsClient = getWSClient();
    
    // 检查 WebSocket 连接状态
    if (!wsClient.isConnected()) {
      return {
        success: false,
        content: [{ type: 'text' as const, text: '❌ WebSocket 未连接，无法发送报告到工作流引擎' }],
      };
    }
    
    // 构建发送给工作流引擎的消息（使用正确的 WSMessage 类型）
    const message: WSMessage = {
      type: 'event' as const,
      payload: {
        type: 'workflow_report',
        agentId: 'ahivecore',
        timestamp: Date.now(),
        data: params,
      },
    };
    
    try {
      // 发送消息
      wsClient.send(message);
      
      logger.info('[workflow_report] 已发送报告:', {
        report_type: params.report_type,
        task_id: params.task_id,
        agent_id: params.agent_id,
      });
      
      // 根据报告类型返回不同的提示信息
      const reportTypeMessages = {
        task_ack: `✅ 任务确认报告已发送\n任务ID: ${params.task_id}\n执行Agent: ${params.agent_id || '未知'}`,
        task_progress: `✅ 进度更新报告已发送\n任务ID: ${params.task_id}\n进度: ${params.progress}%`,
        task_error: `✅ 异常报告已发送\n任务ID: ${params.task_id}\n错误: ${params.error}`,
        task_complete: `✅ 任务完成报告已发送\n任务ID: ${params.task_id}\n成功: ${params.success ? '是' : '否'}\n摘要: ${params.summary || '无'}`,
      };
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: reportTypeMessages[params.report_type],
        }],
        details: {
          report_type: params.report_type,
          task_id: params.task_id,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[workflow_report] 发送失败:', errorMessage);
      
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 发送报告失败: ${errorMessage}`,
        }],
      };
    }
  },
};

// ==================== 导出 ====================

/**
 * 工作流编排工具列表
 */
export const workflowTools: AgentTool[] = [
  createWorkflowTool,
  modifyWorkflowTool,
  listWorkflowsTool,
  deleteWorkflowTool,
  validateWorkflowTool,
  workflowReportTool,  // 新增：工作流状态报告工具
];