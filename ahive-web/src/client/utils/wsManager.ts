/**
 * 全局 WebSocket 管理器
 * 
 * 用于 AHIVECORE 和 3D 世界之间的通讯
 * - 内存监控数据
 * - 流式对话事件
 * - 智能体状态更新
 */

type EventHandler = (data: any) => void;

interface WebSocketManager {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
  send: (data: any) => void;
  subscribe: (eventType: string, handler: EventHandler) => () => void;
  getWS: () => WebSocket | null;
}

// 单例
let wsInstance: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let handlers: Map<string, Set<EventHandler>> = new Map();
let connectionCount = 0;
let pendingSubscribe = false;  // 标记是否需要重新订阅

const WS_URL = 'ws://localhost:3005';
const HEARTBEAT_INTERVAL = 25000; // 25秒，小于服务端超时时间（60秒）
let lastActivityTime = Date.now(); // 记录最后活动时间

// 页面可见性变化时的处理
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const backgroundTime = Date.now() - lastActivityTime;
      console.log(`[WSManager] Page became visible, background time: ${Math.round(backgroundTime / 1000)}s`);
      
      // 如果后台时间超过 30 秒，很可能连接已断开，直接重连
      if (backgroundTime > 30000) {
        console.log('[WSManager] Background time too long, forcing reconnect...');
        // 强制关闭旧连接
        if (wsInstance) {
          wsInstance.onclose = null;
          wsInstance.onerror = null;
          try { wsInstance.close(); } catch (e) {}
          wsInstance = null;
        }
        stopHeartbeat();
        connectWS();
        return;
      }
      
      // 页面变为可见时，检查连接状态
      if (wsInstance?.readyState === WebSocket.OPEN) {
        // 发送 ping 验证连接是否真的活着
        try {
          wsInstance.send(JSON.stringify({ type: 'ping' }));
          lastActivityTime = Date.now();
        } catch (e) {
          console.log('[WSManager] Send failed, reconnecting...');
          connectWS();
        }
      } else if (wsInstance?.readyState !== WebSocket.CONNECTING) {
        // 连接不在正常状态，立即重连
        console.log('[WSManager] Connection not in good state, reconnecting...');
        connectWS();
      }
    } else {
      // 页面进入后台时，记录时间
      lastActivityTime = Date.now();
    }
  });
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      try {
        wsInstance.send(JSON.stringify({ type: 'ping' }));
        lastActivityTime = Date.now();
        // console.log('[WSManager] Sent ping');
      } catch (e) {
        console.log('[WSManager] Heartbeat failed');
      }
    }
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function handleReconnect() {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  reconnectTimer = setTimeout(() => {
    console.log('[WSManager] Reconnecting...');
    connectWS();
  }, 5000);
}

function connectWS() {
  // 如果连接已存在且正在打开或已打开，不重复连接
  if (wsInstance && (wsInstance.readyState === WebSocket.CONNECTING || wsInstance.readyState === WebSocket.OPEN)) {
    return;
  }

  // 如果连接正在关闭，等待关闭后再重连
  if (wsInstance && wsInstance.readyState === WebSocket.CLOSING) {
    console.log('[WSManager] Connection is closing, waiting...');
    setTimeout(() => connectWS(), 100);
    return;
  }

  try {
    wsInstance = new WebSocket(WS_URL);

    wsInstance.onopen = () => {
      console.log('[WSManager] Connected');
      lastActivityTime = Date.now();
      
      // 总是重新发送订阅（确保重连后订阅生效）
      if (wsInstance) {
        wsInstance.send(JSON.stringify({
          type: 'command',
          payload: { type: 'subscribe', agentId: '*' }
        }));
      }
      console.log('[WSManager] Sent subscribe command');
      
      // 启动心跳
      startHeartbeat();
      
      // 通知所有订阅者连接成功
      handlers.get('connection')?.forEach(h => h({ connected: true }));
    };

    wsInstance.onmessage = (event) => {
      lastActivityTime = Date.now(); // 收到消息时更新活动时间
      try {
        const message = JSON.parse(event.data);
        
        // 分发到对应的处理器
        if (message.type === 'event' && message.payload) {
          const eventType = message.payload.type;
          const agentId = message.payload.agentId;
          // 从 payload.data 获取数据，如果没有 data 则使用整个 payload
          const payloadData = message.payload.data || message.payload;
          
          console.log(`[WSManager] Received event: type=${eventType}, agentId=${agentId}`);
          
          // 分发时传递所有字段：data 内容 + payload 顶层字段（如 agentName, timestamp）
          const eventData = {
            ...payloadData,
            agentId,
            agentName: message.payload.agentName,
            timestamp: message.payload.timestamp,
          };
          
          // 按事件类型分发（只分发一次）
          handlers.get(eventType)?.forEach(h => h(eventData));
          
          // 内存事件特殊处理
          if (payloadData?.category === 'memory') {
            handlers.get('memory')?.forEach(h => h(payloadData));
          }
          
          // text-done 事件特殊处理（基于 text 字段检测）
          // 注意：text-delta 已经通过 eventType 分发，不再重复分发
          if (payloadData?.text && eventType !== 'text-done') {
            handlers.get('text-done')?.forEach(h => h({ ...payloadData, agentId }));
          }
        }
        
        // 也分发原始消息
        handlers.get('message')?.forEach(h => h(message));
      } catch (error) {
        console.error('[WSManager] Parse error:', error);
      }
    };

    wsInstance.onclose = () => {
      console.log('[WSManager] Disconnected');
      stopHeartbeat();
      handlers.get('connection')?.forEach(h => h({ connected: false }));
      handleReconnect();
    };

    wsInstance.onerror = (error) => {
      console.error('[WSManager] Error:', error);
    };
  } catch (error) {
    console.error('[WSManager] Connect failed:', error);
    handleReconnect();
  }
}

function disconnectWS() {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (wsInstance) {
    wsInstance.onclose = null;
    wsInstance.onerror = null;
    wsInstance.close();
    wsInstance = null;
  }
}

export const wsManager: WebSocketManager = {
  connect: () => {
    connectionCount++;
    console.log(`[WSManager] connect() called, count=${connectionCount}, readyState=${wsInstance?.readyState}`);
    
    // 检查当前连接状态
    if (wsInstance?.readyState === WebSocket.OPEN) {
      // 连接已打开，确保发送订阅命令
      console.log('[WSManager] Connection already open, sending subscribe command');
      wsInstance.send(JSON.stringify({
        type: 'command',
        payload: { type: 'subscribe', agentId: '*' }
      }));
      // 确保心跳在运行
      startHeartbeat();
    } else if (wsInstance?.readyState === WebSocket.CLOSED || wsInstance === null) {
      // 连接已关闭或不存在，立即重连
      console.log('[WSManager] Connection closed or null, reconnecting...');
      connectWS();
    } else if (wsInstance?.readyState === WebSocket.CLOSING) {
      // 正在关闭，等待关闭后重连
      console.log('[WSManager] Connection is closing, will reconnect...');
      setTimeout(() => connectWS(), 200);
    } else if (connectionCount === 1) {
      // 首次连接，延迟连接避免 StrictMode 问题
      setTimeout(() => connectWS(), 100);
    }
  },

  disconnect: () => {
    connectionCount = Math.max(0, connectionCount - 1);
    console.log(`[WSManager] disconnect() called, count=${connectionCount}`);
    if (connectionCount === 0) {
      // 不要断开连接，保持共享连接
      // disconnectWS();
      console.log('[WSManager] Keeping connection alive for other components');
    }
  },

  isConnected: () => {
    return wsInstance?.readyState === WebSocket.OPEN;
  },

  send: (data: any) => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      wsInstance.send(JSON.stringify(data));
    }
  },

  subscribe: (eventType: string, handler: EventHandler) => {
    if (!handlers.has(eventType)) {
      handlers.set(eventType, new Set());
    }
    handlers.get(eventType)!.add(handler);

    // 返回取消订阅函数
    return () => {
      handlers.get(eventType)?.delete(handler);
    };
  },

  getWS: () => wsInstance,
};

export default wsManager;