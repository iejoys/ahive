/**
 * 页面控制工具定义
 * 
 * 用于 AHIVECORE 指挥官控制 Web 端页面
 */

import { z } from 'zod';
import type { AgentTool } from '../../executor/tool-system.js';
import { getPageController, PageController } from './PageController.js';

// ==================== 参数 Schema ====================

const PageNavigateParamsSchema = z.object({
  target: z.enum([
    'world',
    'workflow',
    'skills',
    'tasks',
    'logs',
    'settings',
    'agents',
    'departments',
    'blackboard',
  ]).describe('目标页面'),
  params: z.record(z.unknown()).optional().describe('附加参数'),
});

const OpenDialogParamsSchema = z.object({
  dialog_type: z.string().describe('对话框类型：create-agent, create-workflow, settings, confirm, alert, custom'),
  title: z.string().optional().describe('对话框标题'),
  content: z.string().optional().describe('对话框内容'),
  modal: z.boolean().optional().default(true).describe('是否模态对话框'),
  data: z.record(z.unknown()).optional().describe('自定义数据'),
});

const CloseDialogParamsSchema = z.object({
  dialog_type: z.string().optional().describe('对话框类型（可选，不指定则关闭当前对话框）'),
});

const TogglePanelParamsSchema = z.object({
  panel_id: z.string().describe('面板 ID：sidebar, task-panel, log-panel, agent-panel, workflow-panel, floating-core'),
  visible: z.boolean().optional().describe('是否显示（不设置则切换）'),
});

const HighlightParamsSchema = z.object({
  element_id: z.string().describe('要高亮的元素 ID'),
  duration: z.number().optional().default(2000).describe('高亮持续时间（毫秒）'),
});

// ==================== 工具定义 ====================

/**
 * 页面导航工具
 */
export const pageNavigateTool: AgentTool<z.infer<typeof PageNavigateParamsSchema>> = {
  name: 'page_navigate',
  label: 'navigate to page',
  description: `导航到指定页面。用于快速切换用户界面。

可用页面：
- world: 3D 世界视图（智能体工作直播）
- workflow: 工作流编辑器
- skills: 能力中心（MCP 工具）
- tasks: 任务面板
- logs: 日志中心
- settings: 设置面板
- agents: 智能体管理
- departments: 部门管理
- blackboard: 黑板（工作流变量）

示例：
用户说"打开工作流编辑器" → 调用 page_navigate(target="workflow")
用户说"去智能体管理" → 调用 page_navigate(target="agents")`,
  parameters: PageNavigateParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getPageController();
    
    try {
      controller.navigate(params.target, params.params);
      
      const targetNames: Record<string, string> = {
        world: '3D 世界',
        workflow: '工作流编辑器',
        skills: '能力中心',
        tasks: '任务面板',
        logs: '日志中心',
        settings: '设置面板',
        agents: '智能体管理',
        departments: '部门管理',
        blackboard: '黑板',
      };
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 已导航到「${targetNames[params.target] || params.target}」页面`,
        }],
        details: {
          target: params.target,
          params: params.params,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 页面导航失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 打开对话框工具
 */
export const openDialogTool: AgentTool<z.infer<typeof OpenDialogParamsSchema>> = {
  name: 'open_dialog',
  label: 'open dialog',
  description: `打开对话框。用于弹出创建、编辑、确认等对话框。

可用对话框类型：
- create-agent: 创建智能体
- edit-agent: 编辑智能体
- create-workflow: 创建工作流
- edit-workflow: 编辑工作流
- create-department: 创建部门
- settings: 设置
- confirm: 确认对话框
- alert: 提示对话框
- custom: 自定义对话框

示例：
用户说"创建一个新智能体" → 调用 open_dialog(dialog_type="create-agent")
用户说"确认删除" → 调用 open_dialog(dialog_type="confirm", title="确认删除", content="确定要删除吗？")`,
  parameters: OpenDialogParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getPageController();
    
    try {
      controller.openDialog(params.dialog_type, {
        type: params.dialog_type as any,
        title: params.title,
        content: params.content,
        modal: params.modal,
        data: params.data,
      });
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 已打开「${params.dialog_type}」对话框${params.title ? `：${params.title}` : ''}`,
        }],
        details: {
          dialogType: params.dialog_type,
          title: params.title,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 打开对话框失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 关闭对话框工具
 */
export const closeDialogTool: AgentTool<z.infer<typeof CloseDialogParamsSchema>> = {
  name: 'close_dialog',
  label: 'close dialog',
  description: `关闭对话框。用于关闭当前或指定类型的对话框。

参数：
- dialog_type: 对话框类型（可选，不指定则关闭当前对话框）

示例：
用户说"关闭对话框" → 调用 close_dialog()
用户说"关闭设置窗口" → 调用 close_dialog(dialog_type="settings")`,
  parameters: CloseDialogParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getPageController();
    
    try {
      controller.closeDialog(params.dialog_type);
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 已关闭${params.dialog_type ? `「${params.dialog_type}」` : '当前'}对话框`,
        }],
        details: {
          dialogType: params.dialog_type,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 关闭对话框失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 切换面板工具
 */
export const togglePanelTool: AgentTool<z.infer<typeof TogglePanelParamsSchema>> = {
  name: 'toggle_panel',
  label: 'toggle panel',
  description: `切换面板显示/隐藏。用于控制侧边栏、任务面板等。

可用面板：
- sidebar: 侧边栏
- task-panel: 任务面板
- log-panel: 日志面板
- agent-panel: 智能体面板
- workflow-panel: 工作流面板
- floating-core: 浮动指挥官窗口

参数：
- panel_id: 面板 ID
- visible: 是否显示（不设置则切换）

示例：
用户说"显示任务面板" → 调用 toggle_panel(panel_id="task-panel", visible=true)
用户说"隐藏侧边栏" → 调用 toggle_panel(panel_id="sidebar", visible=false)
用户说"切换日志面板" → 调用 toggle_panel(panel_id="log-panel")`,
  parameters: TogglePanelParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getPageController();
    
    try {
      controller.togglePanel(params.panel_id, params.visible);
      
      const actionText = params.visible === undefined 
        ? '已切换' 
        : params.visible ? '已显示' : '已隐藏';
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ ${actionText}「${params.panel_id}」面板`,
        }],
        details: {
          panelId: params.panel_id,
          visible: params.visible,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 切换面板失败: ${message}`,
        }],
      };
    }
  },
};

/**
 * 高亮元素工具
 */
export const highlightTool: AgentTool<z.infer<typeof HighlightParamsSchema>> = {
  name: 'highlight',
  label: 'highlight element',
  description: `高亮指定元素。用于引导用户关注特定界面元素。

参数：
- element_id: 要高亮的元素 ID
- duration: 高亮持续时间（毫秒，默认 2000）

示例：
用户说"高亮工作流按钮" → 调用 highlight(element_id="workflow-button")`,
  parameters: HighlightParamsSchema,
  
  async execute(toolCallId, params, signal) {
    const controller = getPageController();
    
    try {
      controller.highlight(params.element_id, params.duration);
      
      return {
        success: true,
        content: [{
          type: 'text' as const,
          text: `✅ 已高亮元素「${params.element_id}」，持续 ${params.duration}ms`,
        }],
        details: {
          elementId: params.element_id,
          duration: params.duration,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: [{
          type: 'text' as const,
          text: `❌ 高亮元素失败: ${message}`,
        }],
      };
    }
  },
};

// ==================== 导出所有工具 ====================

/**
 * 页面控制工具列表
 */
export const pageControlTools = [
  pageNavigateTool,
  openDialogTool,
  closeDialogTool,
  togglePanelTool,
  highlightTool,
];