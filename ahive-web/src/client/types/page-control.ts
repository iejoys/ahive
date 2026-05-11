/**
 * 页面控制类型定义（前端）
 * 
 * 与 AHIVECORE 的 src/types/page-control.ts 保持一致
 */

/**
 * 页面控制指令类型
 */
export type PageControlAction = 
  | 'navigate'      // 导航到指定页面
  | 'open-dialog'   // 打开对话框
  | 'close-dialog'  // 关闭对话框
  | 'toggle-panel'  // 切换面板显示/隐藏
  | 'highlight'     // 高亮指定元素
  | 'scroll-to'     // 滚动到指定位置
  | 'update-state'; // 更新状态

/**
 * 页面目标类型
 */
export type PageTarget = 
  | 'world'         // 3D 世界
  | 'workflow'      // 工作流编辑器
  | 'skills'        // 能力中心
  | 'tasks'         // 任务面板
  | 'logs'          // 日志中心
  | 'settings'      // 设置面板
  | 'agents'        // 智能体管理
  | 'departments'   // 部门管理
  | 'blackboard';   // 黑板

/**
 * 页面控制指令
 */
export interface PageControlCommand {
  type: 'page-control';
  action: PageControlAction;
  target?: PageTarget;
  params?: Record<string, unknown>;
  timestamp: number;
  source: 'ahivecore';  // 来源标识
}

/**
 * 页面控制响应
 */
export interface PageControlResponse {
  type: 'page-control-response';
  success: boolean;
  action: PageControlAction;
  target?: PageTarget;
  error?: string;
  timestamp: number;
}

/**
 * 工作流生成事件
 */
export interface WorkflowGenerationEvent {
  type: 'workflow-generation';
  event: 
    | 'layer-start'      // 层开始
    | 'layer-complete'   // 层完成
    | 'node-refining'    // 节点正在精化
    | 'node-refined'     // 节点精化完成
    | 'workflow-update'  // 工作流更新
    | 'workflow-ready';  // 工作流就绪
  data: {
    layer?: number;
    name?: string;
    totalNodes?: number;
    index?: number;
    total?: number;
    nodeId?: string;
    nodeName?: string;
    workflowId?: string;
    workflowName?: string;
    message?: string;
    status?: string;
  };
  timestamp: number;
  source: 'ahivecore';
}

/**
 * 配置同步事件
 */
export interface ConfigSyncEvent {
  type: 'config-sync';
  configKey: string;
  configValue: unknown;
  timestamp: number;
  source: 'ahivecore';
}