/**
 * AHIVECORE 监控模块
 * 
 * 统一导出 WebSocket 客户端和内存监控
 */

// WebSocket 客户端
export {
  WSClient,
  getWSClient,
  startWSClient,
  stopWSClient,
  resetWSClient,
  getWSClientHealth,
  MessageType,
} from './ws-client.js';

export type {
  WSClientConfig,
  WSMessage,
  MemoryUpdateData,
  AgentWorkData,
  A2AMessageData,
} from './ws-client.js';

// 内存监控
export {
  MemoryMonitor,
  getMemoryMonitor,
  startMemoryMonitor,
  stopMemoryMonitor,
} from './memory-monitor.js';

export type {
  MemoryUsage,
  MemoryStats,
  MemoryMonitorConfig,
} from './memory-monitor.js';