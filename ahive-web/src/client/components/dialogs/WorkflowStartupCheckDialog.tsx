/**
 * 工作流启动检测弹窗
 * 
 * 在工作流启动前显示检测进度，包括：
 * - 心跳检测已启动
 * - 项目配置检测
 * - Agent 状态检测
 * - 上下文注入
 */

import { useState, useEffect, useRef } from 'react';
import { wsManager } from '../../utils/wsManager';
import { useStore } from '../../store/useStore';

// 检测步骤状态
type CheckStatus = 'pending' | 'checking' | 'success' | 'failed' | 'skipped';

// 检测步骤
interface CheckStep {
  id: string;
  name: string;
  nameEn: string;
  status: CheckStatus;
  details: string[];
  error?: string;
  timestamp: number;
}

// 启动检测结果
interface StartupCheckResult {
  workflowId: string;
  workflowName: string;
  canProceed: boolean;
  steps: CheckStep[];
  timestamp: number;
}

// 步骤图标
const StepIcon = ({ status: s }: { status: CheckStatus }) => {
  switch (s) {
    case 'success': return <span className="text-green-400 text-xl">✓</span>;
    case 'failed': return <span className="text-red-400 text-xl">✗</span>;
    case 'checking': return <span className="text-yellow-400 text-xl animate-spin">⏳</span>;
    case 'skipped': return <span className="text-gray-400 text-xl">○</span>;
    default: return <span className="text-gray-400 text-xl">○</span>;
  }
};

// 步骤详情（检测中和检测完成后都显示）
const StepDetails = ({ status: s, details }: { status: CheckStatus; details: string[] }) => {
  if (details.length === 0) return null;
  
  return (
    <div className="mt-2 pl-6 text-xs space-y-1">
      {details.map((detail, i) => {
        // 根据内容样式区分不同类型的信息
        const isError = detail.includes('✗') || detail.includes('⚠') || detail.includes('未找到') || detail.includes('离线');
        const isSuccess = detail.includes('✓') || detail.includes('正常');
        const isHeader = detail.startsWith('---');
        const isSolution = detail.includes('解决方法');
        
        return (
          <div 
            key={i} 
            className={`${
              s === 'checking' ? 'animate-pulse text-gray-400' : ''
            } ${
              isError ? 'text-red-400' : 
              isSuccess ? 'text-green-400' : 
              isHeader ? 'text-yellow-400 font-bold mt-2' :
              isSolution ? 'text-blue-400' :
              'text-gray-400'
            }`}
          >
            {detail}
          </div>
        );
      })}
    </div>
  );
};

// 步骤错误信息
const StepError = ({ error }: { error?: string }) => {
  if (!error) return null;
  
  return (
    <div className="mt-2 pl-6 text-xs text-red-400 bg-red-900/20 p-2 rounded">
      ⚠️ {error}
    </div>
  );
};

interface Props {
  isOpen: boolean;
  workflowId: string | null;
  workflowName: string;
  onComplete: (success: boolean) => void;
  onCancel: () => void;
  onSkip: () => void;
}

export function WorkflowStartupCheckDialog({
  isOpen,
  workflowId,
  workflowName,
  onComplete,
  onCancel,
  onSkip,
}: Props) {
  const { language } = useStore();
  const isZh = language === 'zh';
  
  // 检测结果状态
  const [checkResult, setCheckResult] = useState<StartupCheckResult | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  
  // ✅ 防止重复触发检测
  const isCheckingRef = useRef(false);
  
  // ✅ 拖动位置状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  
  // WebSocket 订阅清理
  const unsubscribeRef = useRef<(() => void) | null>(null);
  
  // ✅ 超时定时器
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // ✅ 拖动处理
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };
  
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  // 初始化检测步骤
  const initSteps = (): CheckStep[] => [
    { id: 'heartbeat', name: '心跳检测已启动', nameEn: 'Heartbeat Started', status: 'pending', details: [], timestamp: Date.now() },
    { id: 'project-config', name: '项目配置检测', nameEn: 'Project Config', status: 'pending', details: [], timestamp: Date.now() },
    { id: 'agent-status', name: 'Agent 状态检测', nameEn: 'Agent Status', status: 'pending', details: [], timestamp: Date.now() },
    { id: 'context-inject', name: '上下文注入', nameEn: 'Context Injection', status: 'pending', details: [], timestamp: Date.now() },
  ];
  
  // 调用后端 API 触发检测
  const triggerStartupCheck = async (wfId: string) => {
    try {
      // 调用后端 IPC 接口
      if (window.electronAPI?.workflowStartupCheck) {
        console.log('[WorkflowStartupCheckDialog] Triggering startup check for:', wfId);
        const result = await window.electronAPI.workflowStartupCheck(wfId);
        console.log('[WorkflowStartupCheckDialog] Startup check result:', result);
        
        // 如果后端返回了完整结果，直接更新状态
        if (result && result.steps) {
          setCheckResult({
            workflowId: wfId,
            workflowName,
            canProceed: result.canProceed,
            steps: result.steps.map((s: any) => ({
              id: s.id,
              name: s.name,
              nameEn: s.nameEn || s.name,
              status: s.status,
              details: s.details || [],
              error: s.error,
              timestamp: s.timestamp || Date.now(),
            })),
            timestamp: result.timestamp || Date.now(),
          });
          
          // 检查是否完成 - 不自动关闭，让用户手动确认
          const allComplete = result.steps.every((s: any) => 
            s.status === 'success' || s.status === 'failed' || s.status === 'skipped'
          );
          if (allComplete) {
            setIsComplete(true);
            // 不自动调用 onComplete，让用户手动点击按钮
          }
        } else {
          // ✅ 显示真实错误，而不是模拟
          console.error('[WorkflowStartupCheckDialog] Invalid result from backend:', result);
          setCheckResult(prev => {
            if (!prev) return null;
            return {
              ...prev,
              steps: prev.steps.map(s => ({
                ...s,
                status: 'failed' as const,
                error: result?.error || '检测失败：后端返回无效结果',
              })),
              canProceed: false,
            };
          });
          setIsComplete(true);
        }
      } else {
        // ✅ 明确提示 API 不可用
        console.error('[WorkflowStartupCheckDialog] electronAPI.workflowStartupCheck not available');
        setCheckResult(prev => {
          if (!prev) return null;
          return {
            ...prev,
            steps: prev.steps.map(s => ({
              ...s,
              status: 'failed' as const,
              error: 'Electron API 不可用',
            })),
            canProceed: false,
          };
        });
        setIsComplete(true);
      }
    } catch (error) {
      // ✅ 显示真实错误
      console.error('[WorkflowStartupCheckDialog] Failed to trigger startup check:', error);
      setCheckResult(prev => {
        if (!prev) return null;
        return {
          ...prev,
          steps: prev.steps.map(s => ({
            ...s,
            status: 'failed' as const,
            error: error instanceof Error ? error.message : String(error),
          })),
          canProceed: false,
        };
      });
      setIsComplete(true);
    }
  };
  
  // 模拟检测（开发环境或 API 不可用时）
  const simulateStartupCheck = async (wfId: string) => {
    const steps = initSteps();
    
    for (let i = 0; i < steps.length; i++) {
      // 更新为 checking
      setCheckResult(prev => {
        if (!prev) return null;
        const newSteps = [...prev.steps];
        newSteps[i] = { ...newSteps[i], status: 'checking', details: ['正在检测...'] };
        return { ...prev, steps: newSteps };
      });
      
      // 等待 500ms
      await new Promise(r => setTimeout(r, 500));
      
      // 更新为 success
      setCheckResult(prev => {
        if (!prev) return null;
        const newSteps = [...prev.steps];
        newSteps[i] = { ...newSteps[i], status: 'success', details: [] };
        return { ...prev, steps: newSteps };
      });
    }
    
    // 所有完成 - 不自动关闭，让用户手动确认
    setIsComplete(true);
  };
  
  // 监听 WebSocket 事件 + 触发检测
  useEffect(() => {
    if (!isOpen || !workflowId) return;
    
    // ✅ 防止重复触发
    if (isCheckingRef.current) {
      console.log('[WorkflowStartupCheckDialog] Already checking, skip...');
      return;
    }
    isCheckingRef.current = true;
    
    // ✅ 确保 WebSocket 已连接
    if (!wsManager.isConnected()) {
      console.log('[WorkflowStartupCheckDialog] WebSocket not connected, connecting...');
      wsManager.connect();
    }
    
    // 初始化检测结果
    setCheckResult({
      workflowId,
      workflowName,
      canProceed: false,
      steps: initSteps(),
      timestamp: Date.now(),
    });
    setIsComplete(false);
    
    // 订阅 workflow-startup-check 事件
    // 后端发送完整的 StartupCheckResult（包含 steps 数组）
    unsubscribeRef.current = wsManager.subscribe('workflow-startup-check', (event: any) => {
      console.log('[WorkflowStartupCheckDialog] Received event:', event);
      
      // event.data 是完整的 StartupCheckResult
      const data = event.data || event;
      
      if (data.workflowId !== workflowId) return;
      
      // 更新检测结果
      setCheckResult(prev => {
        if (!prev) return null;
        
        // 如果后端发送了完整的 steps 数组，直接使用
        if (data.steps && Array.isArray(data.steps)) {
          const newSteps = data.steps.map((s: any) => ({
            id: s.id,
            name: s.name || s.id,
            nameEn: s.nameEn || s.id,
            status: s.status,
            details: s.details || [],
            error: s.error,
            timestamp: s.timestamp || Date.now(),
          }));
          
          // 检查是否所有步骤完成
          const allComplete = newSteps.every(s => 
            s.status === 'success' || s.status === 'failed' || s.status === 'skipped' || s.status === 'warning'
          );
          const allSuccess = newSteps.every(s => 
            s.status === 'success' || s.status === 'skipped' || s.status === 'warning'
          );
          
          if (allComplete) {
            setIsComplete(true);
            // 不自动完成，让用户手动点击按钮
          }
          
          return {
            ...prev,
            steps: newSteps,
            canProceed: data.canProceed !== undefined ? data.canProceed : allSuccess,
          };
        }
        
        // 兼容旧格式：单个步骤更新
        const newSteps = prev.steps.map(step => {
          if (step.id === data.step?.id) {
            return {
              ...step,
              ...data.step,
              timestamp: Date.now(),
            };
          }
          return step;
        });
        
        return {
          ...prev,
          steps: newSteps,
          canProceed: data.canProceed || prev.canProceed,
        };
      });
    });
    
    // 触发后端检测
    triggerStartupCheck(workflowId);
    
    // ✅ 添加超时检测（30秒）
    timeoutRef.current = setTimeout(() => {
      setIsComplete(prev => {
        if (!prev) {
          console.warn('[WorkflowStartupCheckDialog] Startup check timeout after 30s');
          setCheckResult(prevResult => {
            if (!prevResult) return null;
            return {
              ...prevResult,
              steps: prevResult.steps.map(s => ({
                ...s,
                status: (s.status === 'pending' || s.status === 'checking') ? 'failed' as const : s.status,
                error: (s.status === 'pending' || s.status === 'checking') ? '检测超时（30秒）' : s.error,
              })),
              canProceed: false,
            };
          });
          return true;
        }
        return prev;
      });
    }, 30000);
    
    // 清理订阅
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      // ✅ 清理超时定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // ✅ 重置检测状态
      isCheckingRef.current = false;
    };
  }, [isOpen, workflowId]); // ✅ 移除 onComplete 依赖，避免重复执行
  
  // 不显示时返回 null
  if (!isOpen || !checkResult) return null;
  
  // 计算进度
  const completedSteps = checkResult.steps.filter(s => 
    s.status === 'success' || s.status === 'failed' || s.status === 'skipped'
  ).length;
  const progress = Math.round((completedSteps / checkResult.steps.length) * 100);
  
  return (
    <div 
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div 
        className="bg-gray-900 border-2 border-indigo-500 rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
          cursor: isDragging ? 'grabbing' : 'default',
        }}
      >
        {/* 标题栏 - 固定，可拖动 */}
        <div 
          className="bg-indigo-600 px-6 py-4 flex items-center justify-between flex-shrink-0 cursor-grab select-none"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <div>
              <h2 className="text-white font-bold text-lg">
                {isZh ? '工作流启动检测' : 'Workflow Startup Check'}
              </h2>
              <p className="text-indigo-200 text-sm">
                {workflowName}
              </p>
            </div>
          </div>
          
          {/* 进度指示 */}
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 bg-indigo-900 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${
                  checkResult.canProceed ? 'bg-green-400' : 'bg-indigo-400'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-white text-sm font-medium">{progress}%</span>
          </div>
        </div>
        
        {/* 检测步骤列表 - 可滚动 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {checkResult.steps.map((step, index) => (
            <div 
              key={step.id}
              className={`p-4 rounded-lg border transition-all duration-300 ${
                step.status === 'success' 
                  ? 'bg-green-900/20 border-green-500/50' 
                  : step.status === 'failed'
                    ? 'bg-red-900/20 border-red-500/50'
                    : step.status === 'checking'
                      ? 'bg-yellow-900/20 border-yellow-500/50 animate-pulse'
                      : 'bg-gray-800 border-gray-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <StepIcon status={step.status} />
                <div className="flex-1">
                  <div className="text-white font-medium">
                    {isZh ? step.name : step.nameEn}
                  </div>
                  <div className="text-gray-400 text-xs mt-1">
                    {step.status === 'success' && (isZh ? '检测通过' : 'Passed')}
                    {step.status === 'failed' && (isZh ? '检测失败' : 'Failed')}
                    {step.status === 'checking' && (isZh ? '正在检测...' : 'Checking...')}
                    {step.status === 'skipped' && (isZh ? '已跳过' : 'Skipped')}
                    {step.status === 'pending' && (isZh ? '等待检测' : 'Pending')}
                  </div>
                </div>
                <div className="text-gray-500 text-xs">
                  #{index + 1}
                </div>
              </div>
              
              {/* 检测详情 - 始终显示 */}
              <StepDetails status={step.status} details={step.details} />
              
              {/* 错误信息 */}
              <StepError error={step.error} />
            </div>
          ))}
        </div>
        
        {/* 底部操作栏 - 固定 */}
        <div className="border-t border-gray-700 px-6 py-4 flex items-center justify-between bg-gray-800 flex-shrink-0">
          <div className="text-gray-400 text-sm">
            {isComplete 
              ? (checkResult.canProceed 
                ? (isZh ? '✅ 所有检测通过，即将开始执行...' : '✅ All checks passed, starting...')
                : (isZh ? '❌ 检测未通过，请检查问题' : '❌ Checks failed, please review'))
              : (isZh ? '正在执行启动检测...' : 'Running startup checks...')}
          </div>
          
          <div className="flex gap-3">
            {/* 取消按钮 - 始终可用，让用户可以随时取消 */}
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-white"
            >
              {isZh ? '取消启动' : 'Cancel'}
            </button>
            
            {/* 跳过检测按钮 */}
            <button
              onClick={onSkip}
              disabled={isComplete}
              className={`px-4 py-2 rounded-lg font-medium ${
                isComplete
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-yellow-600 hover:bg-yellow-500 text-white'
              }`}
            >
              {isZh ? '跳过检测' : 'Skip Checks'}
            </button>
            
            {/* 手动确认按钮（检测完成后显示） */}
            {isComplete && checkResult.canProceed && (
              <button
                onClick={() => onComplete(true)}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium"
              >
                {isZh ? '开始执行' : 'Start Now'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorkflowStartupCheckDialog;