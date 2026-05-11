/**
 * 页面控制类型定义
 * 
 * 用于 AHIVECORE 指挥官控制 Web 端页面切换
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
 * 对话框类型
 */
export type DialogType = 
  | 'create-agent'      // 创建智能体
  | 'edit-agent'        // 编辑智能体
  | 'create-workflow'   // 创建工作流
  | 'edit-workflow'     // 编辑工作流
  | 'create-department' // 创建部门
  | 'settings'          // 设置
  | 'confirm'           // 确认对话框
  | 'alert'             // 提示对话框
  | 'custom';           // 自定义对话框

/**
 * 面板类型
 */
export type PanelType = 
  | 'sidebar'       // 侧边栏
  | 'header'        // 头部
  | 'task-panel'    // 任务面板
  | 'log-panel'     // 日志面板
  | 'agent-panel'   // 智能体面板
  | 'workflow-panel' // 工作流面板
  | 'blackboard-panel' // 黑板面板
  | 'floating-core' // 浮动指挥官窗口
  | 'custom';       // 自定义面板

/**
 * 面板 ID（别名，用于兼容）
 */
export type PanelId = PanelType | string;

/**
 * 页面控制事件数据（用于 WebSocket payload.data）
 */
export interface PageControlEventData {
  action: PageControlAction;
  target?: PageTarget;
  params?: PageControlParams;
  source: 'ahivecore';
}

/**
 * 页面控制指令
 */
export interface PageControlCommand {
  type: 'page-control';
  action: PageControlAction;
  target?: PageTarget;
  params?: PageControlParams;
  timestamp: number;
  source: 'ahivecore';  // 来源标识
}

/**
 * 页面控制参数
 */
export interface PageControlParams {
  /** 对话框类型 */
  dialogType?: DialogType;
  /** 面板 ID */
  panelId?: PanelType | string;
  /** 是否显示 */
  visible?: boolean;
  /** 高亮元素 ID */
  elementId?: string;
  /** 滚动位置 */
  scrollPosition?: { x: number; y: number };
  /** 状态更新数据 */
  stateData?: Record<string, unknown>;
  /** 自定义参数 */
  custom?: Record<string, unknown>;
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
 * 页面控制事件（用于 WebSocket 广播）
 */
export interface PageControlEvent {
  type: 'event';
  payload: PageControlCommand;
}

/**
 * 页面导航选项
 */
export interface NavigateOptions {
  /** 目标页面 */
  target: PageTarget;
  /** 是否替换历史 */
  replace?: boolean;
  /** 附加参数 */
  params?: Record<string, unknown>;
}

/**
 * 对话框选项
 */
export interface DialogOptions {
  /** 对话框类型 */
  type: DialogType;
  /** 对话框标题 */
  title?: string;
  /** 对话框内容 */
  content?: string;
  /** 对话框宽度 */
  width?: number | string;
  /** 对话框高度 */
  height?: number | string;
  /** 是否模态 */
  modal?: boolean;
  /** 是否可关闭 */
  closable?: boolean;
  /** 自定义数据 */
  data?: Record<string, unknown>;
}

/**
 * 面板切换选项
 */
export interface PanelOptions {
  /** 面板 ID */
  panelId: PanelType | string;
  /** 是否显示（不设置则切换） */
  visible?: boolean;
  /** 是否动画 */
  animate?: boolean;
}