/**
 * 页面控制 Hook
 * 监听指挥官的页面控制指令并响应
 * 
 * 使用方式：
 * 在 App.tsx 或其他顶层组件中调用 usePageControl()
 */

import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { wsManager } from '../utils/wsManager';
import { loadWorkflowsFromStorage } from '../scheduler/DataSync';
import { dialog } from '../components/common/DialogProvider';

/**
 * 页面控制指令类型（与 AHIVECORE 定义一致）
 */
interface PageControlCommand {
  type: 'page-control';
  action: PageControlAction;
  target?: PageTarget;
  params?: Record<string, unknown>;
  timestamp: number;
  source: 'ahivecore';
}

type PageControlAction = 
  | 'navigate'      // 导航到指定页面
  | 'open-dialog'   // 打开对话框
  | 'close-dialog'  // 关闭对话框
  | 'toggle-panel'  // 切换面板显示/隐藏
  | 'highlight'     // 高亮指定元素
  | 'scroll-to'     // 滚动到指定位置
  | 'update-state'; // 更新状态

type PageTarget = 
  | 'world'         // 3D 世界
  | 'workflow'      // 工作流编辑器
  | 'skills'        // 能力中心
  | 'tasks'         // 任务面板
  | 'logs'          // 日志中心
  | 'settings'      // 设置面板
  | 'agents'        // 智能体管理（映射到 world + 选中智能体）
  | 'departments'   // 部门管理
  | 'blackboard';   // 黑板

/**
 * 工作流控制响应类型
 */
interface WorkflowControlResponse {
  action: 'execute' | 'pause' | 'resume' | 'stop' | 'list-active';
  workflowId?: string;
  instanceId?: string;
  status: 'processing' | 'completed' | 'failed' | 'error';
  message?: string;
  result?: {
    instances?: Array<{ id: string; workflowId: string; status: string }>;
    instanceId?: string;
  };
}

/**
 * 页面控制 Hook
 * 
 * 监听 WebSocket 中的 page-control 事件
 * 根据指挥官的指令切换页面、打开对话框等
 */
export function usePageControl() {
  const { 
    setActiveTab, 
    setShowSettingsPanel,
    setCurrentWorkflow,
    selectAgent,
    selectWorkflowNode,
    setWorkflows,
  } = useStore();

  useEffect(() => {
    // 订阅 page-control 事件
    const unsubscribe = wsManager.subscribe('page-control', (data: PageControlCommand) => {
      // 只响应来自 ahivecore 的指令
      if (data.source !== 'ahivecore') {
        console.log('[PageControl] Ignoring non-ahivecore command:', data);
        return;
      }

      console.log('[PageControl] Received command:', data);
      handleCommand(data);
    });

    // 订阅 workflow-generation 事件（工作流生成进度）
    const unsubscribeWorkflow = wsManager.subscribe('workflow-generation', (data: any) => {
      console.log('[PageControl] Workflow generation event:', data);
      handleWorkflowGenerationEvent(data);
    });

    // 订阅 workflow-control-response 事件（工作流控制响应）
    const unsubscribeWorkflowControl = wsManager.subscribe('workflow-control-response', (data: WorkflowControlResponse) => {
      console.log('[PageControl] Workflow control response:', data);
      handleWorkflowControlResponse(data);
    });

    return () => {
      unsubscribe();
      unsubscribeWorkflow();
      unsubscribeWorkflowControl();
    };
  }, []);

  /**
   * 处理页面控制指令
   */
  const handleCommand = (command: PageControlCommand) => {
    switch (command.action) {
      case 'navigate':
        handleNavigate(command.target, command.params);
        break;
      
      case 'open-dialog':
        handleOpenDialog(command.params?.dialogType as string, command.params);
        break;
      
      case 'close-dialog':
        handleCloseDialog(command.params?.dialogType as string);
        break;
      
      case 'toggle-panel':
        handleTogglePanel(command.params?.panelId as string, command.params?.visible as boolean);
        break;
      
      case 'highlight':
        handleHighlight(command.params?.elementId as string);
        break;
      
      case 'scroll-to':
        handleScrollTo(command.params?.position as { x: number; y: number });
        break;
      
      case 'update-state':
        handleUpdateState(command.params);
        break;
      
      default:
        console.warn('[PageControl] Unknown action:', command.action);
    }
  };

  /**
   * 处理导航指令
   */
  const handleNavigate = (target?: PageTarget, params?: Record<string, unknown>) => {
    if (!target) {
      console.warn('[PageControl] Navigate missing target');
      return;
    }

    // 映射 PageTarget 到 TabType
    // 注意：'agents', 'departments', 'blackboard', 'settings' 不是有效的 TabType
    // 需要特殊处理
    const tabMap: Partial<Record<PageTarget, string>> = {
      'world': 'world',
      'workflow': 'workflow',
      'skills': 'skills',
      'tasks': 'tasks',
      'logs': 'logs',
    };

    const tab = tabMap[target];
    
    if (tab) {
      setActiveTab(tab as any);
      console.log(`[PageControl] Navigated to: ${tab}`);
    } else {
      // 特殊处理：agents 导航到 world 并选中智能体
      if (target === 'agents') {
        setActiveTab('world');
        if (params?.agentId) {
          selectAgent(params.agentId as string);
        }
        console.log('[PageControl] Navigated to agents (world view with selection)');
      } else if (target === 'settings') {
        setShowSettingsPanel(true);
        console.log('[PageControl] Opened settings panel');
      } else {
        console.warn('[PageControl] Unknown target:', target);
        return;
      }
    }
    
    // 如果有额外参数，处理它们
    if (params) {
      // 导航到工作流时，可以选择特定工作流
      if (target === 'workflow' && params.workflowId) {
        setCurrentWorkflow(params.workflowId as string);
      }
      
      // 导航到工作流编辑器时，可以选择特定节点
      if (target === 'workflow' && params.nodeId) {
        selectWorkflowNode(params.nodeId as string);
      }
    }
  };

  /**
   * 处理打开对话框指令
   */
  const handleOpenDialog = (dialogType?: string, params?: Record<string, unknown>) => {
    if (!dialogType) {
      console.warn('[PageControl] Open dialog missing type');
      return;
    }

    // 根据对话框类型执行不同操作
    switch (dialogType) {
      case 'settings':
        setShowSettingsPanel(true);
        break;
      
      case 'create-agent':
        // TODO: 实现创建智能体对话框
        console.log('[PageControl] Open create-agent dialog');
        break;
      
      case 'create-workflow':
        // TODO: 实现创建工作流对话框
        console.log('[PageControl] Open create-workflow dialog');
        break;
      
      case 'agent-detail':
        if (params?.agentId) {
          selectAgent(params.agentId as string);
          setActiveTab('world');
        }
        break;
      
      default:
        console.warn('[PageControl] Unknown dialog type:', dialogType);
    }
  };

  /**
   * 处理关闭对话框指令
   */
  const handleCloseDialog = (dialogType?: string) => {
    switch (dialogType) {
      case 'settings':
        setShowSettingsPanel(false);
        break;
      
      case undefined:
        // 关闭所有对话框
        setShowSettingsPanel(false);
        selectAgent(null);
        selectWorkflowNode(null);
        break;
      
      default:
        console.log('[PageControl] Close dialog:', dialogType);
    }
  };

  /**
   * 处理切换面板指令
   */
  const handleTogglePanel = (panelId?: string, visible?: boolean) => {
    if (!panelId) {
      console.warn('[PageControl] Toggle panel missing id');
      return;
    }

    switch (panelId) {
      case 'settings':
        setShowSettingsPanel(visible !== undefined ? visible : !useStore.getState().showSettingsPanel);
        break;
      
      default:
        console.log('[PageControl] Toggle panel:', panelId, visible);
    }
  };

  /**
   * 处理高亮元素指令
   */
  const handleHighlight = (elementId?: string) => {
    if (!elementId) {
      console.warn('[PageControl] Highlight missing element id');
      return;
    }

    // TODO: 实现元素高亮效果
    console.log('[PageControl] Highlight element:', elementId);
    
    // 可以通过 CSS 类或动画实现高亮效果
    const element = document.getElementById(elementId);
    if (element) {
      element.classList.add('ahive-highlight');
      // 3秒后移除高亮
      setTimeout(() => {
        element.classList.remove('ahive-highlight');
      }, 3000);
    }
  };

  /**
   * 处理滚动指令
   */
  const handleScrollTo = (position?: { x: number; y: number }) => {
    if (!position) {
      console.warn('[PageControl] Scroll missing position');
      return;
    }

    window.scrollTo({
      top: position.y,
      left: position.x,
      behavior: 'smooth',
    });
  };

  /**
   * 处理状态更新指令
   */
  const handleUpdateState = (params?: Record<string, unknown>) => {
    if (!params) {
      console.warn('[PageControl] Update state missing params');
      return;
    }

    // 根据参数更新状态
    if (params.activeTab) {
      setActiveTab(params.activeTab as any);
    }
    if (params.showSettingsPanel !== undefined) {
      setShowSettingsPanel(params.showSettingsPanel as boolean);
    }
    if (params.currentWorkflowId) {
      setCurrentWorkflow(params.currentWorkflowId as string);
    }
    if (params.selectedAgentId) {
      selectAgent(params.selectedAgentId as string);
    }
    if (params.selectedWorkflowNodeId) {
      selectWorkflowNode(params.selectedWorkflowNodeId as string);
    }

    console.log('[PageControl] State updated:', params);
  };

  /**
   * 处理工作流生成事件
   */
  const handleWorkflowGenerationEvent = async (data: any) => {
    const { event, data: eventData } = data;
    
    switch (event) {
      case 'layer-start':
        console.log(`[PageControl] 工作流生成 - 第${eventData.layer}层开始: ${eventData.name}`);
        // 可以显示进度提示
        break;
      
      case 'node-refining':
        console.log(`[PageControl] 正在精化节点 ${eventData.index}/${eventData.total}: ${eventData.nodeName}`);
        break;
      
      case 'node-refined':
        console.log(`[PageControl] 节点已精化: ${eventData.nodeName}`);
        break;
      
      case 'layer-complete':
        console.log(`[PageControl] 第${eventData.layer}层完成: ${eventData.name}`);
        break;
      
      case 'workflow-update':
        console.log('[PageControl] 工作流已更新，刷新显示');
        // 触发工作流列表刷新
        try {
          const workflows = await loadWorkflowsFromStorage();
          setWorkflows(workflows);
          console.log('[PageControl] 工作流列表已刷新:', workflows.length);
        } catch (error) {
          console.error('[PageControl] 刷新工作流列表失败:', error);
        }
        break;
      
      case 'workflow-ready':
        console.log(`[PageControl] 工作流已就绪: ${eventData.workflowName}`);
        // 自动导航到工作流编辑器并加载新工作流
        setActiveTab('workflow');
        if (eventData.workflowId) {
          setCurrentWorkflow(eventData.workflowId);
        }
        // 刷新工作流列表
        try {
          const workflows = await loadWorkflowsFromStorage();
          setWorkflows(workflows);
        } catch (error) {
          console.error('[PageControl] 刷新工作流列表失败:', error);
        }
        break;
      
      default:
        console.log('[PageControl] Unknown workflow event:', event);
    }
  };

  /**
   * 处理工作流控制响应
   */
  const handleWorkflowControlResponse = (data: WorkflowControlResponse) => {
    console.log('[PageControl] Workflow control response:', data);
    
    // 根据状态显示 UI 反馈
    if (data.status === 'completed') {
      dialog.success(data.message || '操作成功', '工作流控制');
    } else if (data.status === 'failed' || data.status === 'error') {
      dialog.error(data.message || '操作失败', '工作流控制');
    } else if (data.status === 'processing') {
      // 处理中，可以显示进度提示（可选）
      console.log('[PageControl] Workflow control processing...');
    }
    
    // 如果有结果数据，可以进一步处理
    if (data.result) {
      console.log('[PageControl] Workflow control result:', data.result);
      
      // 如果是 list-active 的结果，可以显示活跃工作流列表
      if (data.action === 'list-active' && data.result.instances) {
        const instances = data.result.instances;
        console.log(`[PageControl] 活跃工作流: ${instances.length} 个`);
        // 可以在这里触发 UI 更新，比如显示工作流状态面板
      }
    }
  };
}

export default usePageControl;