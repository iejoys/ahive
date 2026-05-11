/**
 * 页面控制器
 * 
 * 指挥官用于控制 Web 端页面切换
 * 通过 WebSocket 发送指令到前端
 */

import { getWSClient } from '../../monitoring/ws-client.js';
import { logger } from '../../utils/index.js';
import type { 
  PageControlCommand, 
  PageControlAction, 
  PageTarget,
  PageControlParams,
  NavigateOptions,
  DialogOptions,
  PanelOptions
} from '../../types/page-control.js';

/**
 * 页面控制器类
 */
export class PageController {
  private wsClient: ReturnType<typeof getWSClient>;

  constructor() {
    this.wsClient = getWSClient();
  }

  /**
   * 导航到指定页面
   * 
   * @param target 目标页面
   * @param params 附加参数
   */
  navigate(target: PageTarget, params?: Record<string, unknown>): void {
    this.sendCommand({
      type: 'page-control',
      action: 'navigate',
      target,
      params: params ? { custom: params } : undefined,
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Navigate to:', target);
  }

  /**
   * 导航到指定页面（带选项）
   * 
   * @param options 导航选项
   */
  navigateWithOptions(options: NavigateOptions): void {
    this.sendCommand({
      type: 'page-control',
      action: 'navigate',
      target: options.target,
      params: {
        custom: {
          replace: options.replace,
          ...options.params,
        },
      },
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Navigate to:', options.target, 'with options:', options);
  }

  /**
   * 打开对话框
   * 
   * @param dialogType 对话框类型
   * @param options 对话框选项
   */
  openDialog(dialogType: string, options?: DialogOptions): void {
    const params: PageControlParams = {
      dialogType: dialogType as any,
      custom: options ? { ...options } as Record<string, unknown> : undefined,
    };

    this.sendCommand({
      type: 'page-control',
      action: 'open-dialog',
      params,
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Open dialog:', dialogType, options);
  }

  /**
   * 关闭对话框
   * 
   * @param dialogType 对话框类型（可选，不指定则关闭当前对话框）
   */
  closeDialog(dialogType?: string): void {
    this.sendCommand({
      type: 'page-control',
      action: 'close-dialog',
      params: dialogType ? { dialogType: dialogType as any } : undefined,
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Close dialog:', dialogType || 'current');
  }

  /**
   * 切换面板
   * 
   * @param panelId 面板 ID
   * @param visible 是否显示（不设置则切换）
   */
  togglePanel(panelId: string, visible?: boolean): void {
    this.sendCommand({
      type: 'page-control',
      action: 'toggle-panel',
      params: { panelId, visible },
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Toggle panel:', panelId, visible !== undefined ? `visible=${visible}` : 'toggle');
  }

  /**
   * 切换面板（带选项）
   * 
   * @param options 面板选项
   */
  togglePanelWithOptions(options: PanelOptions): void {
    this.sendCommand({
      type: 'page-control',
      action: 'toggle-panel',
      params: {
        panelId: options.panelId,
        visible: options.visible,
        custom: { animate: options.animate },
      },
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Toggle panel:', options.panelId);
  }

  /**
   * 高亮元素
   * 
   * @param elementId 元素 ID
   * @param duration 高亮持续时间（毫秒）
   */
  highlight(elementId: string, duration?: number): void {
    this.sendCommand({
      type: 'page-control',
      action: 'highlight',
      params: {
        elementId,
        custom: { duration },
      },
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Highlight element:', elementId);
  }

  /**
   * 滚动到指定位置
   * 
   * @param x X 坐标
   * @param y Y 坐标
   */
  scrollTo(x: number, y: number): void {
    this.sendCommand({
      type: 'page-control',
      action: 'scroll-to',
      params: {
        scrollPosition: { x, y },
      },
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Scroll to:', x, y);
  }

  /**
   * 更新状态
   * 
   * @param stateData 状态数据
   */
  updateState(stateData: Record<string, unknown>): void {
    this.sendCommand({
      type: 'page-control',
      action: 'update-state',
      params: { stateData },
      timestamp: Date.now(),
      source: 'ahivecore',
    });
    
    logger.info('[PageController] Update state:', stateData);
  }

  /**
   * 发送指令（复用现有 WSClient）
   */
  private sendCommand(command: PageControlCommand): void {
    // 检查连接状态
    const isConnected = this.wsClient.isConnected();
    const queueSize = this.wsClient.getQueueSize();
    
    logger.info('[PageController] sendCommand called:', {
      action: command.action,
      target: command.target,
      isConnected,
      queueSize,
    });
    
    if (!isConnected) {
      logger.warn('[PageController] ⚠️ WebSocket 未连接，消息将被缓存');
      logger.warn('[PageController] 当前队列大小:', queueSize);
    }
    
    // 转换为 WSMessage 格式
    const message = {
      type: 'event' as const,
      payload: {
        type: 'page-control',
        agentId: 'ahivecore',
        agentName: 'AHIVECORE',
        timestamp: command.timestamp,
        data: command,
      },
    };
    
    logger.info('[PageController] 发送消息:', JSON.stringify(message, null, 2));
    
    this.wsClient.send(message);
    
    // 再次检查队列大小，确认消息是否发送成功
    const newQueueSize = this.wsClient.getQueueSize();
    if (newQueueSize > queueSize) {
      logger.warn('[PageController] ⚠️ 消息已缓存到队列，等待连接恢复后发送');
    } else {
      logger.info('[PageController] ✅ 消息已发送');
    }
  }

  /**
   * 获取页面目标列表（用于工具描述）
   */
  static getAvailableTargets(): PageTarget[] {
    return [
      'world',
      'workflow',
      'skills',
      'tasks',
      'logs',
      'settings',
      'agents',
      'departments',
      'blackboard',
    ];
  }

  /**
   * 获取对话框类型列表（用于工具描述）
   */
  static getAvailableDialogTypes(): string[] {
    return [
      'create-agent',
      'edit-agent',
      'create-workflow',
      'edit-workflow',
      'create-department',
      'settings',
      'confirm',
      'alert',
      'custom',
    ];
  }

  /**
   * 获取面板类型列表（用于工具描述）
   */
  static getAvailablePanels(): string[] {
    return [
      'sidebar',
      'header',
      'task-panel',
      'log-panel',
      'agent-panel',
      'workflow-panel',
      'blackboard-panel',
      'floating-core',
    ];
  }
}

// ==================== 单例 ====================

let pageControllerInstance: PageController | null = null;

/**
 * 获取页面控制器实例
 */
export function getPageController(): PageController {
  if (!pageControllerInstance) {
    pageControllerInstance = new PageController();
  }
  return pageControllerInstance;
}

/**
 * 重置页面控制器（用于测试）
 */
export function resetPageController(): void {
  pageControllerInstance = null;
}