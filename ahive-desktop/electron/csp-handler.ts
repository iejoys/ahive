/**
 * CSP（内容安全策略）处理器
 *
 * 功能：
 * - 根据 webUrl 动态生成 CSP
 * - 支持开发环境（localhost）和生产环境（服务器域名）
 * - 通过 Electron session.webRequest 动态注入 CSP
 */

import { session, Session } from 'electron';

/**
 * 根据 webUrl 生成 CSP（内容安全策略）
 */
export function generateCSP(webUrl: string, apiUrl: string): string {
  let host = 'localhost';
  let protocol = 'http';
  let wsProtocol = 'ws';

  try {
    const url = new URL(webUrl);
    host = url.hostname;
    protocol = url.protocol.replace(':', '');
    wsProtocol = protocol === 'https' ? 'wss' : 'ws';
  } catch {
    console.warn('Invalid webUrl, using defaults');
  }

  // 开发环境（localhost）允许更多权限
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';

  if (isLocalhost) {
    // 开发模式：允许 localhost 任意端口的 HMR 和 WebSocket
    // 注意：必须允许 blob: 和 data: 用于 Vite 模块加载和 React Refresh
    return `default-src 'self' http://localhost:* https://localhost:* data: blob: filesystem:; ` +
           `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' http://localhost:* https://localhost:* data: blob:; ` +
           `style-src 'self' 'unsafe-inline' http://localhost:* https://localhost:* data: blob:; ` +
           `img-src 'self' data: blob: https: http://localhost:* filesystem:; ` +
           `font-src 'self' data: http://localhost:* https://localhost:*; ` +
           `connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:* ${apiUrl} blob:; ` +
           `worker-src 'self' blob: data:; ` +
           `child-src 'self' blob: data:; ` +
           `frame-src 'self' blob: data: http://localhost:*; ` +
           `object-src 'self' blob: data:;`;
  } else {
    // 生产模式：只允许配置的域名
    const allowedHost = `${protocol}://${host}`;
    const allowedWsHost = `${wsProtocol}://${host}`;
    return `default-src 'self' ${allowedHost} ${protocol}: blob: data:; ` +
           `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${allowedHost} ${protocol}: data:; ` +
           `style-src 'self' 'unsafe-inline' ${allowedHost} ${protocol}: data:; ` +
           `img-src 'self' data: blob: https: http:; ` +
           `font-src 'self' data: ${allowedHost} ${protocol}:; ` +
           `connect-src 'self' ${allowedWsHost} ${wsProtocol}: ${allowedHost} ${protocol}: ${apiUrl}; ` +
           `worker-src 'self' blob: data:; ` +
           `frame-src 'self' blob: data:;`;
  }
}

/**
 * 为 Session 注册 CSP 注入处理器
 */
export function registerCSPHandler(sess: Session, cspPolicy: string): void {
  sess.webRequest.onHeadersReceived((details: any, callback: any) => {
    // 只处理主框架的 HTML 请求
    if (details.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    // 动态注入 CSP，覆盖 HTML 中的静态 CSP
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'content-security-policy': [cspPolicy],
      },
    });
  });
}

/**
 * 移除 CSP 处理器（用于清理）
 */
export function unregisterCSPHandler(sess: Session): void {
  // 注意：Electron 不提供直接移除单个监听器的方法
  // 如果需要移除，需要重新创建 session 或在应用退出时清理
}
