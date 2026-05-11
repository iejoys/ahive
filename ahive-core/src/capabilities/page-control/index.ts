/**
 * 页面控制能力模块
 * 
 * 指挥官用于控制 Web 端页面切换
 */

export { PageController, getPageController } from './PageController.js';
export { pageControlTools } from './tools.js';
export type {
  PageControlAction,
  PageTarget,
  DialogType,
  PanelType,
  PageControlCommand,
  PageControlResponse,
  PageControlEvent,
  PageControlParams,
  DialogOptions,
  PanelOptions,
  NavigateOptions,
} from '../../types/page-control.js';