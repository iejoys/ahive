export interface AHIVECoreConfig {
  endpoint: string;           // AHIVECORE 端点，默认 http://127.0.0.1:18790
  websocketPort: number;      // WebSocket 端口，默认 3005
  reconnectInterval: number;  // 重连间隔，默认 5000ms
  heartbeatInterval: number;  // 心跳间隔，默认 30000ms
  maxReconnectAttempts: number; // 最大重连次数，默认 10
}

export const defaultConfig: AHIVECoreConfig = {
  endpoint: 'http://127.0.0.1:18790',
  websocketPort: 3005,
  reconnectInterval: 5000,
  heartbeatInterval: 30000,
  maxReconnectAttempts: 10,
};

export function loadConfig(): AHIVECoreConfig {
  // 从环境变量或配置文件加载
  return {
    ...defaultConfig,
    endpoint: process.env.AHIVECORE_ENDPOINT || defaultConfig.endpoint,
    websocketPort: parseInt(process.env.WEBSOCKET_PORT || '3005'),
  };
}