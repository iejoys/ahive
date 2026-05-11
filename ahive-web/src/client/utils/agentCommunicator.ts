/**
 * 智能体通信管理器
 * 
 * 统一管理不同类型智能体的通信方式：
 * - AHIVECORE 类型：WebSocket + HTTP POST
 * - A2A 类型：仅 HTTP POST
 * 
 * 支持流式响应和状态订阅
 */

import { wsManager } from './wsManager';

// ========== 类型定义 ==========

/** 智能体类型 */
export type AgentType = 'ahivecore' | 'a2a' | 'unknown';

/** 消息发送选项 */
export interface SendMessageOptions {
  agentId: string;
  agentType: AgentType;
  message: string;
  onStream?: (delta: string) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: Error) => void;
  onThinking?: (delta: string) => void;        // 思考过程回调
  onToolStart?: (data: ToolStartData) => void; // 工具开始回调
  onToolEnd?: (data: ToolEndData) => void;     // 工具结束回调
}

/** 工具开始数据 */
export interface ToolStartData {
  toolCallId: string;
  toolName: string;
  arguments?: any;
}

/** 工具结束数据 */
export interface ToolEndData {
  toolCallId: string;
  success: boolean;
  duration?: number;
  error?: string;
}

/** 消息响应 */
export interface MessageResponse {
  success: boolean;
  response?: string;
  error?: string;
}

// ========== 配置 ==========

const AHIVECORE_API_URL = 'http://127.0.0.1:18790';
const A2A_API_URL = 'http://127.0.0.1:18790';

// ========== 智能体类型检测 ==========

/**
 * 检测智能体类型
 * 
 * AHIVECORE 类型：WebSocket + HTTP
 * A2A 类型：仅 HTTP POST
 */
export function detectAgentType(agentId: string, agent?: any): AgentType {
  // 从 agent 对象检测
  if (agent?.type === 'ahivecore' || agent?.type === 'AHIVECORE') {
    return 'ahivecore';
  }
  
  if (agent?.type === 'a2a' || agent?.type === 'A2A') {
    return 'a2a';
  }
  
  // 从 ID 检测
  if (agentId.toLowerCase().includes('ahivecore') || agentId === 'commander') {
    return 'ahivecore';
  }
  
  // 默认为 A2A
  return 'a2a';
}

// ========== HTTP POST 发送 ==========

/**
 * 通过 HTTP POST 发送消息
 * 
 * 用于 A2A 类型智能体，不支持流式响应
 */
async function sendViaHTTP(
  agentId: string,
  message: string,
  isAHIVECORE: boolean = false
): Promise<MessageResponse> {
  try {
    const endpoint = isAHIVECORE 
      ? `${AHIVECORE_API_URL}/api/chat`
      : `${A2A_API_URL}/api/a2a/sync`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        agentId,
        targetAgentId: agentId, // A2A 格式
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }
    
    const data = await response.json();
    
    return {
      success: true,
      response: data.response || data.message || data.result || '',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========== HTTP 流式发送 ==========

/**
 * 通过 HTTP POST 发送消息（流式）
 * 
 * 用于 AHIVECORE 类型智能体，支持流式响应
 * WebSocket 用于接收流式事件，不用于发送消息
 */
async function sendViaHTTPStream(
  agentId: string,
  message: string,
  onStream?: (delta: string) => void,
  onComplete?: (fullResponse: string) => void,
  onError?: (error: Error) => void,
  onThinking?: (delta: string) => void,
  onToolStart?: (data: ToolStartData) => void,
  onToolEnd?: (data: ToolEndData) => void
): Promise<MessageResponse> {
  console.log('[AgentCommunicator] sendViaHTTPStream called, agentId:', agentId);
  
  // 收集流式响应
  let fullResponse = '';
  let streamComplete = false;
  
  // 订阅 WebSocket 流式事件（用于接收响应）
  const unsubTextDelta = wsManager.subscribe('text-delta', (data) => {
    console.log('[AgentCommunicator] WebSocket text-delta received, data.agentId:', data.agentId, 'expected agentId:', agentId);
    // AHIVECORE 的 agentId 是 'ahivecore'
    if (data.agentId === agentId || data.agentId === 'ahivecore') {
      const delta = data.delta || data.text || '';
      console.log('[AgentCommunicator] Triggering onStream with delta length:', delta.length, 'content:', delta.substring(0, 30));
      fullResponse += delta;
      onStream?.(delta);
    }
  });
  
  const unsubTextDone = wsManager.subscribe('text-done', (data) => {
    if (data.agentId === agentId || data.agentId === 'ahivecore') {
      streamComplete = true;
      onComplete?.(fullResponse);
    }
  });
  
  const unsubDone = wsManager.subscribe('done', (data) => {
    if (data.agentId === agentId || data.agentId === 'ahivecore') {
      streamComplete = true;
      onComplete?.(fullResponse);
    }
  });
  
  try {
    // 通过 HTTP POST 发送消息到 AHIVECORE API
    // 注意：AHIVECORE 核心智能体的专用端点是 /api/ahivecore/chat
    const endpoint = `${AHIVECORE_API_URL}/api/ahivecore/chat`;
    
    console.log(`[AgentCommunicator] Sending HTTP POST to ${endpoint}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,  // AHIVECORE 只需要 message，不需要 agentId
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AgentCommunicator] HTTP error: ${response.status}`, errorText);
      
      // 清理订阅
      unsubTextDelta();
      unsubTextDone();
      unsubDone();
      
      onError?.(new Error(`HTTP ${response.status}: ${errorText}`));
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }
    
    // 检查是否是 SSE 流式响应
    const contentType = response.headers.get('Content-Type') || '';
    const isSSE = contentType.includes('text/event-stream');
    
    if (isSSE) {
      // SSE 流式响应处理
      console.log('[AgentCommunicator] Processing SSE stream...');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('Response body is not readable');
      }
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          
          // 解析 SSE 格式: "data: {...}\n\n"
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === '[DONE]') continue;
              
              try {
                const event = JSON.parse(jsonStr);
                console.log('[AgentCommunicator] SSE event:', event);
                
                // 处理不同类型的事件
                // 注意: text-delta 事件通过 WebSocket 处理,这里不再重复处理
                if (event.type === 'text-delta' && event.delta) {
                  // 已通过 WebSocket 订阅处理,这里只记录日志
                  console.log('[AgentCommunicator] SSE text-delta (handled by WebSocket):', event.delta);
                } else if (event.type === 'thinking-delta' && event.delta) {
                  // 思考过程通过 WebSocket 处理
                  wsManager['handleMessage']?.({ data: JSON.stringify({ type: 'event', payload: event }) });
                } else if (event.type === 'tool-start' || event.type === 'tool-end') {
                  // 工具调用事件通过 WebSocket 处理
                  wsManager['handleMessage']?.({ data: JSON.stringify({ type: 'event', payload: event }) });
                } else if (event.type === 'stream-end' || event.type === 'done') {
                  streamComplete = true;
                  // 🔧 修复: 如果 done 事件包含 response 字段，直接使用它
                  // 这解决了 WebSocket 连接失败时 fullResponse 为空的问题
                  if (event.response) {
                    fullResponse = event.response;
                    // 触发 onStream 让 UI 显示内容
                    onStream?.(event.response);
                  }
                  onComplete?.(fullResponse);
                } else if (event.type === 'stream-error' || event.type === 'error') {
                  throw new Error(event.error || event.message || 'Stream error');
                }
              } catch (parseError) {
                // 忽略解析错误，可能是不完整的 JSON
                if (parseError instanceof SyntaxError) continue;
                throw parseError;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      // 清理订阅
      unsubTextDelta();
      unsubTextDone();
      unsubDone();
      
      return {
        success: true,
        response: fullResponse,
      };
    } else {
      // 普通 JSON 响应处理
      const data = await response.json();
      console.log('[AgentCommunicator] HTTP response:', data);
      
      // 如果有直接响应，使用它
      if (data.response) {
        fullResponse = data.response;
        onStream?.(data.response);
        onComplete?.(data.response);
      } else if (data.content) {
        fullResponse = data.content;
        onStream?.(data.content);
        onComplete?.(data.content);
      }
      
      // 等待 WebSocket 流式事件完成（最多 30 秒）
      const maxWaitTime = 30000;
      const startTime = Date.now();
      
      while (!streamComplete && Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // 清理订阅
      unsubTextDelta();
      unsubTextDone();
      unsubDone();
      
      return {
        success: true,
        response: fullResponse || data.content || '',
      };
    }
  } catch (error) {
    // 清理订阅
    unsubTextDelta();
    unsubTextDone();
    unsubDone();
    
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AgentCommunicator] HTTP error:', errorMsg);
    onError?.(new Error(errorMsg));
    
    return {
      success: false,
      error: errorMsg,
    };
  }
}

// ========== 统一发送接口 ==========

/**
 * 发送消息到智能体
 * 
 * 根据智能体类型自动选择通信方式：
 * - AHIVECORE：WebSocket（优先）+ HTTP（回退）
 * - A2A：HTTP POST
 */
export async function sendMessageToAgent(options: SendMessageOptions): Promise<MessageResponse> {
  const { agentId, agentType, message, onStream, onComplete, onError } = options;
  
  console.log(`[AgentCommunicator] Sending message to ${agentId} (type: ${agentType})`);
  
  // 根据智能体类型选择通信方式
  if (agentType === 'ahivecore') {
    // AHIVECORE 类型：HTTP POST + WebSocket 流式事件
    return sendViaHTTPStream(agentId, message, onStream, onComplete, onError);
  } else {
    // A2A 类型：仅 HTTP POST
    const response = await sendViaHTTP(agentId, message, false);
    
    if (response.success && response.response) {
      onComplete?.(response.response);
    } else if (response.error) {
      onError?.(new Error(response.error));
    }
    
    return response;
  }
}

// ========== 状态订阅 ==========

/**
 * 订阅智能体状态更新
 */
export function subscribeAgentStatus(
  agentId: string,
  handler: (data: { status: string; isTyping: boolean }) => void
): () => void {
  return wsManager.subscribe('agent-status', (data) => {
    if (data.agentId === agentId || agentId === '*') {
      handler({
        status: data.status || 'idle',
        isTyping: data.isTyping || false,
      });
    }
  });
}

/**
 * 订阅智能体工作状态
 */
export function subscribeAgentWorking(
  agentId: string,
  handler: (data: { isWorking: boolean }) => void
): () => void {
  let isWorking = false;
  
  const unsubTextDelta = wsManager.subscribe('text-delta', (data) => {
    if (data.agentId === agentId || agentId === '*') {
      if (!isWorking) {
        isWorking = true;
        handler({ isWorking: true });
      }
    }
  });
  
  const unsubDone = wsManager.subscribe('done', (data) => {
    if (data.agentId === agentId || agentId === '*') {
      if (isWorking) {
        isWorking = false;
        handler({ isWorking: false });
      }
    }
  });
  
  // 返回取消订阅函数
  return () => {
    unsubTextDelta();
    unsubDone();
  };
}

// ========== 导出 ==========

export const agentCommunicator = {
  sendMessage: sendMessageToAgent,
  detectType: detectAgentType,
  getAgentType: detectAgentType, // 别名，方便使用
  subscribeStatus: subscribeAgentStatus,
  subscribeWorking: subscribeAgentWorking,
};

export default agentCommunicator;