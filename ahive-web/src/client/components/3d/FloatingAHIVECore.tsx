import { useState, useCallback, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../../store/useStore';
import { wsManager } from '../../utils/wsManager';
import { agentCommunicator, AgentType } from '../../utils/agentCommunicator';

/**
 * 全局浮动 AHIVECORE 智能体
 * 
 * 特点：
 * - 3D 世界页面：居中显示
 * - 其他页面：左下角，可拖动
 * - 页面切换时平滑移动
 */

// 工具调用类型
interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  input?: any;
  output?: any;
  error?: string;
  duration?: number;
}

// 消息类型
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'streaming';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  thinking?: string;           // 思考过程
  toolCalls?: ToolCall[];      // 工具调用列表
}

// 3D AHIVECORE 头像组件
function AHIVECoreAvatar({ isWorking }: { isWorking: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  
  useEffect(() => {
    if (!meshRef.current) return;
    const interval = setInterval(() => {
      if (meshRef.current) {
        meshRef.current.rotation.y += 0.01;
      }
      if (ringRef.current) {
        ringRef.current.rotation.z += 0.02;
      }
    }, 16);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <octahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial
          color={isWorking ? '#22c55e' : '#6366f1'}
          emissive={isWorking ? '#22c55e' : '#6366f1'}
          emissiveIntensity={0.5}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
      
      <mesh ref={ringRef} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.0, 0.05, 16, 32]} />
        <meshStandardMaterial
          color="#ffd700"
          emissive="#ffd700"
          emissiveIntensity={1.5}
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>
      
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={isWorking ? 2 : 1}
          transparent
          opacity={0.8}
        />
      </mesh>
    </>
  );
}

// 调整大小的方向
type ResizeDirection = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// 聊天窗口组件
function ChatWindow({ 
  isOpen, 
  onClose, 
  onMinimize,
  onExpand,
  isExpanded,
  position,
  onDrag,
  size,
  onResize,
  messages,
  inputValue,
  onInputChange,
  onSend,
  isTyping,
  wsConnected,
  agentInfo,
  onInterrupt,
  onUserInput,
  isWorking,
  isInterrupting,
}: {
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  isExpanded: boolean;
  position: { x: number; y: number };
  onDrag: (pos: { x: number; y: number }) => void;
  size: { width: number; height: number };
  onResize: (size: { width: number; height: number }, pos?: { x: number; y: number }) => void;
  messages: Message[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  isTyping: boolean;
  wsConnected: boolean;
  agentInfo?: { name: string; type: AgentType; id: string };
  onInterrupt?: () => void;
  onUserInput?: () => void;
  isWorking?: boolean;
  isInterrupting?: boolean;
}) {
  const windowRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 调整大小状态
  const isResizing = useRef(false);
  const resizeDirection = useRef<ResizeDirection>('right');
  const resizeStartPos = useRef({ x: 0, y: 0 });
  const resizeStartSize = useRef({ width: 0, height: 0 });
  const resizeStartWindowPos = useRef({ x: 0, y: 0 });
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.chat-header-controls')) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    isDragging.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);
  
  // 调整大小 - mousedown
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, direction: ResizeDirection) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    resizeDirection.current = direction;
    resizeStartPos.current = { x: e.clientX, y: e.clientY };
    resizeStartSize.current = { width: size.width, height: size.height };
    resizeStartWindowPos.current = { x: position.x, y: position.y };
  }, [size, position]);
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // 拖动窗口
      if (isDragging.current) {
        onDrag({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
        return;
      }
      
      // 调整大小
      if (isResizing.current) {
        const deltaX = e.clientX - resizeStartPos.current.x;
        const deltaY = e.clientY - resizeStartPos.current.y;
        const dir = resizeDirection.current;
        
        let newWidth = resizeStartSize.current.width;
        let newHeight = resizeStartSize.current.height;
        let newX = resizeStartWindowPos.current.x;
        let newY = resizeStartWindowPos.current.y;
        
        // 最小尺寸限制
        const minWidth = 300;
        const minHeight = 400;
        
        // 根据方向调整
        if (dir.includes('right')) {
          newWidth = Math.max(minWidth, resizeStartSize.current.width + deltaX);
        }
        if (dir.includes('left')) {
          const potentialWidth = resizeStartSize.current.width - deltaX;
          if (potentialWidth >= minWidth) {
            newWidth = potentialWidth;
            newX = resizeStartWindowPos.current.x + deltaX;
          }
        }
        if (dir.includes('bottom')) {
          newHeight = Math.max(minHeight, resizeStartSize.current.height + deltaY);
        }
        if (dir.includes('top')) {
          const potentialHeight = resizeStartSize.current.height - deltaY;
          if (potentialHeight >= minHeight) {
            newHeight = potentialHeight;
            newY = resizeStartWindowPos.current.y + deltaY;
          }
        }
        
        // 最大尺寸限制（不超过屏幕）
        const maxWidth = window.innerWidth - 100;
        const maxHeight = window.innerHeight - 100;
        newWidth = Math.min(maxWidth, newWidth);
        newHeight = Math.min(maxHeight, newHeight);
        
        // 边界检查
        newX = Math.max(0, Math.min(window.innerWidth - newWidth, newX));
        newY = Math.max(0, Math.min(window.innerHeight - newHeight, newY));
        
        onResize({ width: newWidth, height: newHeight }, { x: newX, y: newY });
      }
    };
    
    const handleMouseUp = () => {
      isDragging.current = false;
      isResizing.current = false;
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onDrag, onResize]);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // 如果任务正在执行,回车触发插话
      if (isWorking && onUserInput) {
        onUserInput();
      } else {
        // 否则正常发送
        onSend();
      }
    }
  }, [onSend, onUserInput, isWorking]);
  
  if (!isOpen) return null;
  
  const displayName = agentInfo?.name || 'AHIVECORE';
  const agentTypeLabel = agentInfo?.type === 'a2a' ? 'A2A' : 'CORE';
  
  return (
    <div
      ref={windowRef}
      className="fixed bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex: 10000,
        border: '1px solid rgba(99, 102, 241, 0.3)',
      }}
    >
      {/* 调整大小的边缘 handles */}
      {/* 左边 */}
      <div 
        className="resize-handle absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-indigo-500/20"
        onMouseDown={(e) => handleResizeMouseDown(e, 'left')}
      />
      {/* 右边 */}
      <div 
        className="resize-handle absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-indigo-500/20"
        onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
      />
      {/* 上边 */}
      <div 
        className="resize-handle absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-indigo-500/20"
        onMouseDown={(e) => handleResizeMouseDown(e, 'top')}
      />
      {/* 下边 */}
      <div 
        className="resize-handle absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-indigo-500/20"
        onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')}
      />
      {/* 四个角 */}
      <div 
        className="resize-handle absolute top-0 left-0 w-4 h-4 cursor-nwse-resize hover:bg-indigo-500/30 rounded-tl-2xl"
        onMouseDown={(e) => handleResizeMouseDown(e, 'top-left')}
      />
      <div 
        className="resize-handle absolute top-0 right-0 w-4 h-4 cursor-nesw-resize hover:bg-indigo-500/30 rounded-tr-2xl"
        onMouseDown={(e) => handleResizeMouseDown(e, 'top-right')}
      />
      <div 
        className="resize-handle absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize hover:bg-indigo-500/30 rounded-bl-2xl"
        onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-left')}
      />
      <div 
        className="resize-handle absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-indigo-500/30 rounded-br-2xl"
        onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')}
      />
      
      <div
        className="bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-3 cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-lg">👑</span>
            </div>
            <div>
              <div className="text-white font-bold text-sm">{displayName}</div>
              <div className="text-white/70 text-xs flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-gray-400'}`} />
                {wsConnected ? '在线' : '离线'}
                <span className="text-white/50 ml-1">[{agentTypeLabel}]</span>
              </div>
            </div>
          </div>
          
          <div className="chat-header-controls flex items-center gap-2">
            <button
              onClick={onMinimize}
              className="w-6 h-6 rounded-full bg-yellow-500 hover:bg-yellow-400 flex items-center justify-center text-xs text-black/70"
            >
              −
            </button>
            <button
              onClick={onExpand}
              className="w-6 h-6 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-xs text-white/70"
              title={isExpanded ? '还原' : '放大'}
            >
              {isExpanded ? '▣' : '▢'}
            </button>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center text-xs text-white/70"
            >
              ×
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-800/50">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">
            <div className="text-4xl mb-3">👑</div>
            <div>你好！我是 {displayName}</div>
            <div className="text-xs mt-1 text-gray-500">有什么可以帮助你的吗？</div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id}>
              {/* 思考过程 - 动画样式 */}
              {msg.thinking && (
                <div className="flex justify-start mb-3">
                  <div className="bg-gradient-to-r from-gray-700 to-gray-600 px-4 py-3 rounded-2xl rounded-bl-sm">
                    {/* 旋转的指挥官图标 */}
                    <div className="relative w-6 h-6">
                      <div className="absolute inset-0 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                      <div className="absolute inset-1 border-2 border-purple-400 border-b-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* 消息气泡 - 只在有内容、工具调用或用户消息时显示 */}
              {(msg.content || (msg.toolCalls && msg.toolCalls.length > 0) || msg.role === 'user') && (
                <div
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : msg.isStreaming
                          ? 'bg-gray-600 text-gray-100 rounded-bl-sm border border-indigo-500/50'
                          : 'bg-gray-700 text-gray-100 rounded-bl-sm'
                    }`}
                  >
                {/* 工具调用 - IDE风格 */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {msg.toolCalls.map((tool) => (
                      <details 
                        key={tool.id} 
                        className={`rounded border overflow-hidden ${
                          tool.status === 'running' 
                            ? 'border-yellow-500/50 bg-yellow-500/5' 
                            : tool.status === 'success' 
                              ? 'border-green-500/50 bg-green-500/5' 
                              : 'border-red-500/50 bg-red-500/5'
                        }`}
                      >
                        <summary className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${
                          tool.status === 'running' 
                            ? 'bg-yellow-500/10 text-yellow-400' 
                            : tool.status === 'success' 
                              ? 'bg-green-500/10 text-green-400' 
                              : 'bg-red-500/10 text-red-400'
                        }`}>
                          {tool.status === 'running' ? (
                            <>
                              <span className="animate-spin">⏳</span>
                              <span className="font-medium">执行中: {tool.name}</span>
                            </>
                          ) : tool.status === 'success' ? (
                            <>
                              <span>✅</span>
                              <span className="font-medium">{tool.name}</span>
                              {tool.duration && (
                                <span className="text-gray-500 ml-auto">{tool.duration}ms</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span>❌</span>
                              <span className="font-medium">{tool.name}</span>
                            </>
                          )}
                        </summary>
                        
                        {/* 工具详情 - 默认收起 */}
                        <div className="px-3 py-2 text-xs space-y-1 border-t border-gray-700/50">
                          {tool.input && (
                            <div>
                              <span className="text-gray-500">输入参数:</span>
                              <pre className="mt-1 p-2 bg-gray-800/50 rounded text-gray-400 overflow-x-auto">
                                {JSON.stringify(tool.input, null, 2)}
                              </pre>
                            </div>
                          )}
                          {tool.output && (
                            <div>
                              <span className="text-gray-500">输出结果:</span>
                              <pre className="mt-1 p-2 bg-gray-800/50 rounded text-gray-400 overflow-x-auto">
                                {typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2)}
                              </pre>
                            </div>
                          )}
                          {tool.status === 'error' && tool.error && (
                            <div className="text-red-400">
                              <span className="text-red-500">错误信息:</span>
                              <pre className="mt-1 p-2 bg-red-500/10 rounded overflow-x-auto">
                                {tool.error}
                              </pre>
                            </div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
                
                {/* 回复内容 - IDE风格 */}
                {msg.content && (
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content
                      // 过滤掉工具调用标记
                      .replace(/```tool\n[\s\S]*?```/g, '')
                      // 过滤掉多余的空行
                      .replace(/\n{3,}/g, '\n\n')
                      .trim()
                    }
                    {msg.isStreaming && <span className="ml-1 animate-pulse text-indigo-400">▊</span>}
                  </div>
                )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        
        {isTyping && messages.length > 0 && !messages.some(m => m.isStreaming && m.content) && (
          <div className="flex justify-start">
            <div className="bg-gradient-to-r from-gray-700 to-gray-600 px-4 py-3 rounded-2xl rounded-bl-sm">
              {/* 旋转的指挥官图标 */}
              <div className="relative w-6 h-6">
                <div className="absolute inset-0 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                <div className="absolute inset-1 border-2 border-purple-400 border-b-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      <div className="p-3 bg-gray-900 border-t border-gray-700">
        <div className="flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isWorking ? "输入消息后回车插话..." : "输入消息..."}
            className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-4 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={2}
            disabled={!wsConnected}
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={onSend}
              disabled={!inputValue.trim() || !wsConnected || isTyping}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
            >
              发送
            </button>
            {isWorking && (
              <button
                onClick={onInterrupt}
                disabled={isInterrupting}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
                title="终止任务"
              >
                {isInterrupting ? '⏳ 终止中...' : '⏹️ 终止任务'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 主组件
export function FloatingAHIVECore() {
  // 从 store 获取当前页面
  const activeTab = useStore((state) => state.activeTab);
  const isInWorld = activeTab === 'world';
  
  // 状态
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatPosition, setChatPosition] = useState({ x: 100, y: 100 });
  const [isWorking, setIsWorking] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);  // 终止中
  const [isInterrupted, setIsInterrupted] = useState(false);  // 已终止
  
  // 放大状态
  const [isExpanded, setIsExpanded] = useState(false);
  const [chatSize, setChatSize] = useState({ width: 380, height: 520 });
  
  // 默认尺寸和放大尺寸
  const DEFAULT_SIZE = { width: 380, height: 520 };
  const EXPANDED_SIZE = { 
    width: Math.floor(window.innerWidth / 2), 
    height: Math.floor(window.innerHeight * 0.8) 
  };
  
  // 头像位置状态
  const [avatarPosition, setAvatarPosition] = useState(() => {
    const saved = localStorage.getItem('ahivecore-avatar-position');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return { x: 20, y: 100 };
      }
    }
    return { x: 20, y: 100 };
  });
  
  // 使用 ref 跟踪当前位置，避免 useEffect 依赖问题
  const currentPositionRef = useRef(avatarPosition);
  currentPositionRef.current = avatarPosition;
  
  // 拖动状态
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const avatarStartPos = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false); // 用于控制 transition
  
  const { wsConnected, agents } = useStore();
  
  // 获取 AHIVECORE 智能体
  const ahiveCoreAgent = agents.find(a => 
    a.name.toLowerCase().includes('ahivecore') || 
    a.id.toLowerCase().includes('ahivecore') ||
    a.type === 'ahivecore'
  );
  
  const agentType: AgentType = ahiveCoreAgent 
    ? agentCommunicator.detectType(ahiveCoreAgent.id, ahiveCoreAgent)
    : 'unknown';
  
  const agentInfo = ahiveCoreAgent ? {
    name: ahiveCoreAgent.name,
    type: agentType,
    id: ahiveCoreAgent.id,
  } : undefined;
  
  // 点击头像
  const handleClick = useCallback(() => {
    if (isMinimized) {
      setIsMinimized(false);
      setIsChatOpen(true);
    } else if (isChatOpen) {
      setIsChatOpen(false);
    } else {
      setChatPosition({ x: 100, y: window.innerHeight - 520 - 20 });
      setIsChatOpen(true);
    }
  }, [isChatOpen, isMinimized]);
  
  const handleClose = useCallback(() => {
    setIsChatOpen(false);
    setIsMinimized(false);
  }, []);
  
  const handleMinimize = useCallback(() => {
    setIsChatOpen(false);
    setIsMinimized(true);
  }, []);
  
  // 放大/还原窗口
  const handleExpand = useCallback(() => {
    if (isExpanded) {
      // 还原到默认大小
      setIsExpanded(false);
      setChatSize(DEFAULT_SIZE);
      // 恢复位置到左下角附近
      setChatPosition({ x: 100, y: window.innerHeight - DEFAULT_SIZE.height - 20 });
    } else {
      // 放大到屏幕一半
      setIsExpanded(true);
      setChatSize(EXPANDED_SIZE);
      // 居中显示
      setChatPosition({
        x: (window.innerWidth - EXPANDED_SIZE.width) / 2,
        y: (window.innerHeight - EXPANDED_SIZE.height) / 2
      });
    }
  }, [isExpanded]);
  
  // 调整窗口大小
  const handleResize = useCallback((newSize: { width: number; height: number }, newPos?: { x: number; y: number }) => {
    setChatSize(newSize);
    if (newPos) {
      setChatPosition(newPos);
    }
    // 如果手动调整了大小，标记为非放大状态
    if (isExpanded && (newSize.width !== EXPANDED_SIZE.width || newSize.height !== EXPANDED_SIZE.height)) {
      setIsExpanded(false);
    }
  }, [isExpanded]);
  
  // 发送消息
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !wsConnected || isTyping) return;
    if (!ahiveCoreAgent) return;
    
    const userMessage = inputValue.trim();
    setInputValue('');
    
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);
    setIsWorking(true);
    
    const streamingMsgId = `streaming-${Date.now()}`;
    streamingMsgIdRef.current = streamingMsgId;  // 保存当前流式消息 ID
    
    // 提前检测智能体类型，确保与 sendMessage 使用的类型一致
    const agentType = agentCommunicator.detectType(ahiveCoreAgent.id, ahiveCoreAgent);
    
    // 为 AHIVECore 智能体添加流式消息占位
    if (agentType === 'ahivecore') {
      setMessages(prev => [...prev, {
        id: streamingMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      }]);
    }
    
    try {
      await agentCommunicator.sendMessage({
        agentId: ahiveCoreAgent.id,
        agentType,
        message: userMessage,
        onStream: (delta: string) => {
          console.log('[FloatingAHIVECore] onStream called with delta:', delta.substring(0, 30));
          setMessages(prev => {
            const updated = prev.map(msg => 
              msg.id === streamingMsgId 
                ? { ...msg, content: msg.content + delta }
                : msg
            );
            console.log('[FloatingAHIVECore] Messages updated, streamingMsgId:', streamingMsgId);
            return updated;
          });
        },
        onComplete: (fullResponse: string) => {
          setMessages(prev => prev.map(msg => 
            msg.id === streamingMsgId 
              ? { ...msg, content: fullResponse, isStreaming: false }
              : msg
          ));
          setIsTyping(false);
          setIsWorking(false);
        },
        onError: (error: Error) => {
          console.error('[FloatingAHIVECore] Message error:', error);
          setMessages(prev => [
            ...prev.filter(m => m.id !== streamingMsgId),
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: '抱歉，我暂时无法响应。请稍后再试。',
              timestamp: new Date(),
            }
          ]);
          setIsTyping(false);
          setIsWorking(false);
        },
      });
    } catch (error) {
      console.error('[FloatingAHIVECore] Send failed:', error);
      setMessages(prev => [
        ...prev.filter(m => m.id !== streamingMsgId),
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: '连接失败，请检查 AHIVECORE 服务是否运行。',
          timestamp: new Date(),
        }
      ]);
      setIsTyping(false);
      setIsWorking(false);
    }
  }, [inputValue, wsConnected, isTyping, ahiveCoreAgent, agentInfo]);
  
  // 插话功能
  const handleInterrupt = useCallback(async () => {
    if (!ahiveCoreAgent || isInterrupting) return;
    
    setIsInterrupting(true);
    console.log('[FloatingAHIVECore] Sending interrupt...');
    
    try {
      const response = await fetch('http://127.0.0.1:18790/api/ahivecore/interrupt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      const data = await response.json();
      console.log('[FloatingAHIVECore] Interrupt response:', data);
      
      if (data.success) {
        setIsInterrupted(true);
        setIsWorking(false);
        setIsTyping(false);
        setMessages(prev => [...prev, {
          id: `interrupt-${Date.now()}`,
          role: 'assistant',
          content: '⚠️ 任务已终止',
          timestamp: new Date(),
        }]);
      }
    } catch (error) {
      console.error('[FloatingAHIVECore] Interrupt failed:', error);
    } finally {
      setIsInterrupting(false);
    }
  }, [ahiveCoreAgent, isInterrupting]);
  
  // 插话功能(发送消息而不终止)
  const handleUserInput = useCallback(async () => {
    if (!ahiveCoreAgent || !inputValue.trim()) return;
    
    const message = inputValue.trim();
    console.log('[FloatingAHIVECore] Sending user input:', message);
    
    try {
      const response = await fetch('http://127.0.0.1:18790/api/ahivecore/user-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      
      const data = await response.json();
      console.log('[FloatingAHIVECore] User input response:', data);
      
      if (data.success) {
        // 添加用户插话到消息列表
        setMessages(prev => [...prev, {
          id: `user-input-${Date.now()}`,
          role: 'user',
          content: `💬 插话: ${message}`,
          timestamp: new Date(),
        }]);
        setInputValue('');
      }
    } catch (error) {
      console.error('[FloatingAHIVECore] User input failed:', error);
    }
  }, [ahiveCoreAgent, inputValue]);
  
  const streamingMsgIdRef = useRef<string | null>(null);
  
  // 用于缓存 text-delta 的增量文本（text-done/done 时刷新）
  const pendingDeltaRef = useRef<string>('');
  
  // 监听 WebSocket 消息
  useEffect(() => {
    if (!ahiveCoreAgent) return;
    
    // 🔧 修复: 直接订阅 text-delta 事件，不再依赖 agentCommunicator 的临时订阅
    // 之前的临时订阅在 HTTP 请求完成后立即清理，可能错过事件
    
    // 文本增量事件（核心修复）
    const unsubTextDelta = wsManager.subscribe('text-delta', (data) => {
      console.log('[FloatingAHIVECore] text-delta received:', data);
      if (data.agentId === ahiveCoreAgent.id || data.agentId === 'ahivecore') {
        const msgId = streamingMsgIdRef.current;
        if (msgId && data.delta) {
          // 🔧 关键修复: 实时更新 UI，而不是只缓存
          setMessages(prev => prev.map(msg => 
            msg.id === msgId 
              ? { ...msg, content: msg.content + data.delta }
              : msg
          ));
          console.log('[FloatingAHIVECore] Updated message content, delta:', data.delta.substring(0, 30));
        }
      }
    });
    
    // 思考过程增量事件
    const unsubThinkingDelta = wsManager.subscribe('thinking-delta', (data) => {
      if (data.agentId === ahiveCoreAgent.id || data.agentId === 'ahivecore') {
        const msgId = streamingMsgIdRef.current;
        if (msgId && data.delta) {
          setMessages(prev => prev.map(msg => 
            msg.id === msgId 
              ? { ...msg, thinking: (msg.thinking || '') + data.delta }
              : msg
          ));
        }
      }
    });
    
    // 工具开始事件
    const unsubToolStart = wsManager.subscribe('tool-start', (data) => {
      console.log('[FloatingAHIVECore] tool-start received:', data);
      if (data.agentId === ahiveCoreAgent.id || data.agentId === 'ahivecore') {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          setMessages(prev => prev.map(msg => {
            if (msg.id !== msgId) return msg;
            const toolCall: ToolCall = {
              id: data.toolCallId || `tool-${Date.now()}`,
              name: data.toolName || 'unknown',
              status: 'running',
              input: data.arguments,
            };
            console.log('[FloatingAHIVECore] Adding tool call:', toolCall.id, toolCall.name);
            return { 
              ...msg, 
              toolCalls: [...(msg.toolCalls || []), toolCall] 
            };
          }));
        }
      }
    });
    
    // 工具结束事件
    const unsubToolEnd = wsManager.subscribe('tool-end', (data) => {
      console.log('[FloatingAHIVECore] tool-end received:', data);
      if (data.agentId === ahiveCoreAgent.id || data.agentId === 'ahivecore') {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          setMessages(prev => prev.map(msg => {
            if (msg.id !== msgId) return msg;
            const updatedToolCalls = (msg.toolCalls || []).map(tc => {
              if (tc.id === data.toolCallId) {
                console.log('[FloatingAHIVECore] Updating tool call:', tc.id, 'to', data.success ? 'success' : 'error');
                return { 
                  ...tc, 
                  status: data.success ? 'success' : 'error',
                  duration: data.duration,
                  error: data.error,
                };
              }
              return tc;
            });
            return {
              ...msg,
              toolCalls: updatedToolCalls,
            };
          }));
        }
      }
    });
    
    // 用户插话事件
    const unsubUserInterrupt = wsManager.subscribe('user-interrupt', (data) => {
      console.log('[FloatingAHIVECore] user-interrupt received:', data);
      if (data.agentId === ahiveCoreAgent.id || data.agentId === 'ahivecore') {
        // 显示插话已发送
        setMessages(prev => [...prev, {
          id: `interrupt-sent-${Date.now()}`,
          role: 'assistant',
          content: `💬 插话已发送: "${data.message}"`,
          timestamp: new Date(),
        }]);
      }
    });
    
    // 文本完成事件
    const unsubTextDone = wsManager.subscribe('text-done', (data) => {
      if (data.agentId === ahiveCoreAgent.id || data.agentId === 'ahivecore') {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          // 处理剩余的增量文本
          if (pendingDeltaRef.current) {
            const delta = pendingDeltaRef.current;
            pendingDeltaRef.current = '';
            setMessages(prev => prev.map(msg => 
              msg.id === msgId 
                ? { ...msg, content: msg.content + delta, isStreaming: false }
                : msg
            ));
          } else {
            setMessages(prev => prev.map(msg => 
              msg.id === msgId 
                ? { ...msg, isStreaming: false }
                : msg
            ));
          }
        }
        setIsWorking(false);
        streamingMsgIdRef.current = null;
      }
    });
    
    // 完成事件
    const unsubDone = wsManager.subscribe('done', (data) => {
      if (data.agentId === ahiveCoreAgent.id || data.agentId === 'ahivecore') {
        const msgId = streamingMsgIdRef.current;
        if (msgId) {
          // 处理剩余的增量文本
          if (pendingDeltaRef.current) {
            const delta = pendingDeltaRef.current;
            pendingDeltaRef.current = '';
            setMessages(prev => prev.map(msg => 
              msg.id === msgId 
                ? { ...msg, content: msg.content + delta, isStreaming: false }
                : msg
            ));
          } else {
            setMessages(prev => prev.map(msg => 
              msg.id === msgId 
                ? { ...msg, isStreaming: false }
                : msg
            ));
          }
        }
        setIsWorking(false);
        streamingMsgIdRef.current = null;
      }
    });
    
    return () => {
      unsubThinkingDelta();
      unsubToolStart();
      unsubToolEnd();
      unsubTextDone();
      unsubDone();
      unsubUserInterrupt();
    };
  }, [ahiveCoreAgent]);
  
  // 初始化位置（左下角或用户保存的位置）
  useEffect(() => {
    const saved = localStorage.getItem('ahivecore-avatar-position');
    if (saved) {
      try {
        const pos = JSON.parse(saved);
        // 确保位置在屏幕范围内
        const validX = Math.max(0, Math.min(window.innerWidth - 64, pos.x));
        const validY = Math.max(0, Math.min(window.innerHeight - 64, pos.y));
        setAvatarPosition({ x: validX, y: validY });
      } catch {
        setAvatarPosition({ x: 20, y: window.innerHeight - 100 });
      }
    } else {
      setAvatarPosition({ x: 20, y: window.innerHeight - 100 });
    }
  }, []); // 只在初始化时执行一次
  
  // 拖动事件处理 - 只绑定一次，不依赖 avatarPosition
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      
      const deltaX = e.clientX - dragStartPos.current.x;
      const deltaY = e.clientY - dragStartPos.current.y;
      
      // 检测是否移动了
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance > 5) {
        hasMoved.current = true;
      }
      
      let newX = avatarStartPos.current.x + deltaX;
      let newY = avatarStartPos.current.y + deltaY;
      
      // 边界限制
      const size = 64;
      newX = Math.max(0, Math.min(window.innerWidth - size, newX));
      newY = Math.max(0, Math.min(window.innerHeight - size, newY));
      
      setAvatarPosition({ x: newX, y: newY });
      currentPositionRef.current = { x: newX, y: newY };
    };
    
    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDraggingState(false); // 更新 state 以移除 transition
        // 使用 ref 获取最新位置并保存
        localStorage.setItem('ahivecore-avatar-position', JSON.stringify(currentPositionRef.current));
        
        // 如果没有移动，触发点击
        if (!hasMoved.current) {
          handleClick();
        }
        hasMoved.current = false;
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleClick]); // 依赖 handleClick
  
  // 拖动头像 - mousedown
  const handleAvatarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsDraggingState(true); // 开始拖动时禁用 transition
    hasMoved.current = false;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    // 使用 ref 获取最新位置
    avatarStartPos.current = { ...currentPositionRef.current };
  }, [handleClick]);
  
  return (
    <>
      {/* 浮动头像 */}
      <div
        className="fixed group cursor-grab active:cursor-grabbing"
        style={{ 
          zIndex: 10001,
          left: avatarPosition.x,
          top: avatarPosition.y,
          transition: isDraggingState ? 'none' : 'left 0.5s ease-out, top 0.5s ease-out',
        }}
        onMouseDown={handleAvatarMouseDown}
      >
        {/* 3D 头像 */}
        <div 
          className={`
            w-16 h-16 rounded-full overflow-hidden
            shadow-lg shadow-indigo-500/30
            border-2 border-indigo-400/50
            bg-gray-900
            transition-all duration-300
            ${isChatOpen ? 'ring-4 ring-indigo-500/50' : 'hover:ring-4 hover:ring-indigo-500/30'}
            ${isWorking ? 'animate-pulse' : ''}
          `}
        >
          <Canvas>
            <PerspectiveCamera makeDefault position={[0, 0, 4]} />
            <OrbitControls enableZoom={false} enablePan={false} enableRotate={false} />
            <AHIVECoreAvatar isWorking={isWorking} />
          </Canvas>
        </div>
        
        {/* 在线状态指示 */}
        <div 
          className={`
            absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-gray-900
            ${wsConnected ? 'bg-green-500' : 'bg-gray-500'}
          `}
        />
        
        {/* 未读/最小化提示 */}
        {isMinimized && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs">1</span>
          </div>
        )}
        
        {/* Hover 提示 */}
        <div 
          className="absolute left-full ml-3 top-1/2 -translate-y-1/2 
            bg-gray-800 text-white text-sm px-3 py-1.5 rounded-lg
            opacity-0 group-hover:opacity-100 transition-opacity
            whitespace-nowrap pointer-events-none"
        >
          {agentInfo?.name || 'AHIVECORE'} {wsConnected ? '· 在线' : '· 离线'}
          <div className="text-xs text-gray-400">
            点击打开聊天 · 拖动移动
          </div>
        </div>
      </div>
      
      {/* 聊天窗口 */}
      <ChatWindow
        isOpen={isChatOpen && !isMinimized}
        onClose={handleClose}
        onMinimize={handleMinimize}
        onExpand={handleExpand}
        isExpanded={isExpanded}
        position={chatPosition}
        onDrag={setChatPosition}
        size={chatSize}
        onResize={handleResize}
        messages={messages}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={handleSend}
        isTyping={isTyping}
        wsConnected={wsConnected}
        agentInfo={agentInfo}
        onInterrupt={handleInterrupt}
        onUserInput={handleUserInput}
        isWorking={isWorking}
        isInterrupting={isInterrupting}
      />
    </>
  );
}

export default FloatingAHIVECore;