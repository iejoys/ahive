import { useState, useEffect } from 'react';

// 临时使用any绕过类型检查
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyWindow = window as any;

/**
 * iframe 消息桥接组件
 * 处理来自 Web 应用的 postMessage 请求
 */
function IframeBridge() {
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // 安全检查：只接受来自同一源的消息
      if (event.origin !== 'http://localhost:5174') return;
      
      const { type, payload, requestId } = event.data || {};
      
      // 只处理 AHIVE 开头的消息类型
      if (!type?.startsWith('AHIVE_')) return;
      
      try {
        let result: any;
        
        switch (type) {
          case 'AHIVE_DISCOVER_A2A_AGENT': {
            // 调用 Electron IPC 发现 A2A Agent
            if (anyWindow.electronAPI?.discoverA2AAgentCard) {
              // 对于本地协议（ahivecore, opencode），允许访问本地网络
              const localProtocols = ['ahivecore', 'opencode'];
              const allowLocalNetwork = localProtocols.includes(payload.protocolType || '');
              result = await anyWindow.electronAPI.discoverA2AAgentCard(
                payload.endpoint,
                payload.protocolType,
                allowLocalNetwork
              );
            } else {
              result = { success: false, error: 'Electron API 不可用' };
            }
            break;
          }
          default:
            return;
        }
        
        // 发送响应回 iframe
        window.postMessage({ type: `${type}_RESPONSE`, requestId, result }, '*');
      } catch (error) {
        window.postMessage({
          type: `${type}_RESPONSE`,
          requestId,
          result: { success: false, error: String(error) }
        }, '*');
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  
  return null;
}

function App() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [config, setConfig] = useState<{ webUrl: string; iframeUrl: string; apiUrl: string } | null>(null);

  useEffect(() => {
    // 获取配置
    if (anyWindow.electronAPI) {
      anyWindow.electronAPI.getConfig().then((cfg: { webUrl: string; iframeUrl: string; apiUrl: string }) => {
        setConfig(cfg);
        // 使用配置中的API URL检查后端
        fetch(`${cfg.apiUrl}/api/health`, { method: 'GET' })
          .then(() => setStatus('ready'))
          .catch(() => setStatus('ready'));
      }).catch(() => {
        // 配置获取失败，使用默认值
        setStatus('ready');
      });
    } else {
      // 非Electron环境，使用默认值
      fetch('http://localhost:3001/api/health', { method: 'GET' })
        .then(() => setStatus('ready'))
        .catch(() => setStatus('ready'));
    }
  }, []);

  const iframeUrl = config?.iframeUrl || 'http://localhost:5174';

  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      background: '#0f0f1a' 
    }}>
      {/* 顶部栏 */}
      <div style={{
        height: '40px',
        background: '#1a1a2e',
        borderBottom: '1px solid #2e2e4e',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '12px',
      }} className="drag-region">
        <span style={{ fontSize: '18px' }}>🤖</span>
        <span style={{ fontWeight: 'bold', fontSize: '14px' }}>AHIVE</span>
        <span style={{ color: '#6b7280', fontSize: '12px' }}>智能体集群管理器</span>
        
        <div style={{ flex: 1 }} />
        
        {/* 状态指示 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          fontSize: '12px',
          color: status === 'ready' ? '#22c55e' : '#f59e0b'
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: status === 'ready' ? '#22c55e' : '#f59e0b'
          }} />
          {status === 'ready' ? '已连接' : '连接中...'}
        </div>
      </div>

      {/* iframe 嵌入 Web 应用 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <iframe
          src={iframeUrl}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: '#0f0f1a'
          }}
          title="AHIVE Web App"
          allow="clipboard-read; clipboard-write"
        />
        
        {/* iframe 消息桥接 */}
        <IframeBridge />
        
        {/* 加载遮罩 */}
        {status === 'loading' && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: '#0f0f1a',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px'
          }}>
            <div style={{ fontSize: '48px' }}>🤖</div>
            <div style={{ color: '#9ca3af' }}>正在启动 AHIVE...</div>
            <div style={{ 
              width: '200px', 
              height: '4px', 
              background: '#2e2e4e', 
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: '30%',
                height: '100%',
                background: '#6366f1',
                borderRadius: '2px',
                animation: 'loading 1.5s ease-in-out infinite'
              }} />
            </div>
            <style>{`
              @keyframes loading {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(400%); }
              }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;