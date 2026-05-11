import { useState, useMemo, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Stars, Html } from '@react-three/drei';
import { useFrame, useThree as useThreeFiber } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterFactory } from './characters';
import { AHIVECore } from './AHIVECore';
import { WorkflowTree } from '../workflow/WorkflowTree';
import { useStore, handleWorkflowEvent } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';
import { CreateAgentDialog } from '../dialogs/CreateAgentDialog';
import { LLMConfigDialog } from '../dialogs/LLMConfigDialog';
import { WorkflowStartupCheckDialog } from '../dialogs/WorkflowStartupCheckDialog';
import { useSceneLoader, SceneElements, getCameraConfig } from './SceneLoader';
import { ExecutionPanel } from './ExecutionPanel';
import { MemoryMonitorBar } from './MemoryMonitorBar';
import { WorkflowExecution3D, MilestonePanel } from './WorkflowExecution3D';
import type { Agent } from '../../types';

// Electron API 类型声明已在 TaskExecutor.ts 中定义
// Ground click handler for right-click movement
function GroundClickHandler() {
  const { selectedAgentId, setMovementTarget, activeTab, offlineAgents, agents } = useStore();
  const { camera, raycaster, pointer } = useThreeFiber();

  const handleContextMenu = (event: any) => {
    if (activeTab !== 'world' || !selectedAgentId) return;
    
    // 离线智能体禁止移动
    const agent = agents.find(a => a.id === selectedAgentId);
    if (offlineAgents.has(selectedAgentId) || agent?.status === 'offline') {
      return;
    }

    event.stopPropagation();

    raycaster.setFromCamera(pointer, camera);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(groundPlane, intersectPoint)) {
      setMovementTarget({
        agentId: selectedAgentId,
        targetPosition: { x: intersectPoint.x, y: 0, z: intersectPoint.z }
      });
    }
  };

  if (activeTab !== 'world' || !selectedAgentId) return null;

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.49, 0]}
      onContextMenu={handleContextMenu}
    >
      <planeGeometry args={[100, 100]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}


function DestinationMarker() {
  const { movementTarget, activeTab } = useStore();

  if (activeTab !== 'world' || !movementTarget) return null;

  return (
    <mesh position={[movementTarget.targetPosition.x, 0.02, movementTarget.targetPosition.z]}>
      <ringGeometry args={[0.3, 0.4, 32]} />
      <meshBasicMaterial color="#22c55e" side={THREE.DoubleSide} transparent opacity={0.8} />
    </mesh>
  );
}

interface GroupZoneProps {
  name: string;
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  agentCount: number;
}

function GroupZone({ name, position, size, color, agentCount }: GroupZoneProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <group position={position}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[size[0], size[2]]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={hovered ? 0.4 : 0.2}
          emissive={color}
          emissiveIntensity={hovered ? 0.3 : 0.1}
        />
      </mesh>

      <lineSegments position={[0, 0.02, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(size[0], 0.1, size[2])]} />
        <lineBasicMaterial color={color} />
      </lineSegments>

      {/* 分组名字 - hover 时显示竖着的名称 */}
      {hovered && (
        <Html position={[0, 1, 0]} center distanceFactor={15} style={{ zIndex: 10 }}>
          <div className="text-center pointer-events-none">
            <div className="text-white font-bold text-sm bg-black/80 px-3 py-1.5 rounded-lg whitespace-nowrap">{name}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

interface PipelineProps {
  start: [number, number, number];
  end: [number, number, number];
  active: boolean;
  progress: number;
}

function Pipeline({ start, end, active, progress }: PipelineProps) {
  const glowRef = useRef<THREE.Mesh>(null);

  const color = active ? '#22c55e' : '#4b5563';

  const points = useMemo(() => {
    const midY = Math.max(start[1], end[1]) + 1;
    return [
      new THREE.Vector3(start[0], start[1], start[2]),
      new THREE.Vector3(start[0], midY, start[2]),
      new THREE.Vector3(end[0], midY, end[2]),
      new THREE.Vector3(end[0], end[1], end[2]),
    ];
  }, [start, end]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);

  const spherePos = useMemo(() => {
    const t = Math.min(1, Math.max(0, progress));
    return curve.getPoint(t);
  }, [curve, progress]);

  useFrame((state) => {
    if (glowRef.current && active) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 5) * 0.3;
      glowRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={curve.getPoints(20).length}
            array={new Float32Array(curve.getPoints(20).flatMap(p => [p.x, p.y, p.z]))}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </line>

      {active && (
        <mesh position={[spherePos.x, spherePos.y, spherePos.z]} ref={glowRef}>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      )}

      <mesh position={start}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={end}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#6366f1" />

      <Stars radius={100} depth={50} count={1000} factor={4} saturation={0} fade speed={1} />

      <Grid
        position={[0, -0.5, 0]}
        args={[30, 30]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#1e1e2e"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#2e2e4e"
        fadeDistance={50}
        fadeStrength={1}
        followCamera={false}
      />
    </>
  );
}

// 独立智能体渲染组件 - 确保在场景切换后也能响应状态变化
interface AgentsRendererProps {
  onEditAgent?: (agent: Agent) => void;
}

function AgentsRenderer({ onEditAgent }: AgentsRendererProps) {
  const { agents, selectedAgentId, selectAgent, activeTab } = useStore();

  if (activeTab !== 'world') return null;

  return (
    <>
      {agents && agents.map((agent) => {
        const isSelected = selectedAgentId === agent.id;
        return (
          <CharacterFactory
            key={agent.id}
            agent={agent}
            isSelected={isSelected}
            onClick={() => { console.log('click', agent.id, selectedAgentId); selectAgent(agent.id); }}
            onDoubleClick={() => {
              // 双击打开编辑界面（仅限 AHIVECORE 类型智能体）
              if (agent.type === 'ahive-coder' || agent.type === 'ahive-worker' || agent.agentType === 'ahive-coder' || agent.agentType === 'ahive-worker') {
                onEditAgent?.(agent);
              }
            }}
          />
        );
      })}
    </>
  );
}

export function AgentWorld({ currentScene = 'default' }: { currentScene?: string }) {
  const { sceneConfig } = useSceneLoader(currentScene);
  
  // 从场景配置获取相机参数
  const cameraSettings = useMemo(() => getCameraConfig(sceneConfig?.camera), [sceneConfig?.camera]);

  const {
    language,
    activeTab,
    workflows,
    currentWorkflowId,
    executionInstance,
    startExecution,
    pauseExecution,
    resumeExecution,
    stopExecution,
    selectedAgentId,
    agents,
    selectAgent,
    chatTargetId,
    blackboardVariables,
    clearExecutionLogs,
  } = useStore();
  
  // LLM 配置检测状态
  const [showLLMConfig, setShowLLMConfig] = useState(false);
  const [isCheckingLLM, setIsCheckingLLM] = useState(true);
  
  // 检测 AHIVECORE 是否有 LLM 配置
  useEffect(() => {
    if (activeTab !== 'world') return;
    
    const checkLLMConfig = async () => {
      setIsCheckingLLM(true);
      try {
        const response = await fetch('http://127.0.0.1:18790/api/provider');
        const data = await response.json();
        
        // 检查是否有有效的 provider 配置
        const config = data.current?.config;
        const providerType = data.current?.type || config?.type;
        
        // 根据不同 provider 类型判断是否配置完整
        let isConfigured = false;
        
        if (providerType === 'openai') {
          // 云端 API：需要 apiKey, apiEndpoint, apiModel
          // 注意：apiKey 为 '******' 表示已配置（被隐藏），也算有效
          const hasApiKey = config?.apiKey && config.apiKey.length > 0;
          const hasEndpoint = config?.apiEndpoint && config.apiEndpoint.length > 0;
          const hasModel = config?.apiModel && config.apiModel.length > 0;
          isConfigured = hasApiKey && hasEndpoint && hasModel;
        } else if (providerType === 'ollama') {
          // Ollama 本地：需要 ollamaHost, ollamaModel（或 apiModel）
          const hasHost = config?.ollamaHost && config.ollamaHost.length > 0;
          const hasModel = (config?.ollamaModel && config.ollamaModel.length > 0) || 
                          (config?.apiModel && config.apiModel.length > 0);
          isConfigured = hasHost && hasModel;
        } else if (providerType === 'local') {
          // 本地模型：需要 modelPath
          const hasModelPath = config?.modelPath && config.modelPath.length > 0;
          isConfigured = hasModelPath;
        } else if (providerType === 'bailian') {
          // 百炼 API：需要 apiKey, apiEndpoint, apiModel
          const hasApiKey = config?.apiKey && config.apiKey.length > 0;
          const hasEndpoint = config?.apiEndpoint && config.apiEndpoint.length > 0;
          const hasModel = config?.apiModel && config.apiModel.length > 0;
          isConfigured = hasApiKey && hasEndpoint && hasModel;
        } else if (providerType === 'anthropic') {
          // Anthropic API：需要 apiKey, apiEndpoint, apiModel
          const hasApiKey = config?.apiKey && config.apiKey.length > 0;
          const hasEndpoint = config?.apiEndpoint && config.apiEndpoint.length > 0;
          const hasModel = config?.apiModel && config.apiModel.length > 0;
          isConfigured = hasApiKey && hasEndpoint && hasModel;
        }
        
        if (!data.success || !data.current || !isConfigured) {
          console.log('[AgentWorld] 未检测到完整的 LLM 配置，弹出配置对话框');
          setShowLLMConfig(true);
        } else {
          console.log('[AgentWorld] LLM 配置已存在:', providerType, config?.presetId || '');
          setShowLLMConfig(false);
        }
      } catch (error) {
        console.warn('[AgentWorld] 检测 LLM 配置失败:', error);
        // AHIVECORE 可能未启动，不弹出配置对话框
        setShowLLMConfig(false);
      } finally {
        setIsCheckingLLM(false);
      }
    };
    
    checkLLMConfig();
  }, [activeTab]);
  
  // 保存 LLM 配置到 AHIVECORE
  const handleSaveLLMConfig = async (config: any) => {
    try {
      const providerType = config.providerType || 'openai';
      let requestBody: any = {
        type: providerType,
        config: {
          temperature: config.temperature ?? 0.3,
          maxTokens: config.maxTokens ?? 200000,
        },
      };

      // 根据不同类型构建配置
      if (providerType === 'openai') {
        // 云端 API 配置
        requestBody.config = {
          ...requestBody.config,
          type: 'openai',
          presetId: config.presetId || 'custom',
          apiEndpoint: config.apiEndpoint,
          apiKey: config.apiKey,
          apiModel: config.apiModel,
        };
      } else if (providerType === 'ollama') {
        // Ollama 本地配置
        requestBody.config = {
          ...requestBody.config,
          type: 'ollama',
          ollamaHost: config.ollamaHost || 'http://localhost:11434',
          apiModel: config.ollamaModel,
          modelName: config.ollamaModel,
        };
      } else if (providerType === 'local') {
        // 本地 GGUF 模型配置
        requestBody.config = {
          ...requestBody.config,
          type: 'local',
          modelPath: config.modelPath,
          modelName: config.modelName || config.modelPath?.split('/').pop()?.replace('.gguf', '') || 'local-model',
          gpuLayers: config.gpuLayers ?? 0,
          threads: config.threads ?? 4,
          contextSize: config.contextSize ?? 4096,
        };
      }

      console.log('[AgentWorld] 保存 LLM 配置:', { type: providerType, preset: config.presetId || config.ollamaModel || config.modelName });
      
      // 调用 AHIVECORE 的 provider 切换接口
      const response = await fetch('http://127.0.0.1:18790/api/provider/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || '保存配置失败');
      }
      
      console.log('[AgentWorld] LLM 配置保存成功');
      setShowLLMConfig(false);
    } catch (error) {
      console.error('[AgentWorld] 保存 LLM 配置失败:', error);
      throw error;
    }
  };
  
  // 导入新的执行函数
  const [isExecuting, setIsExecuting] = useState(false);
  
  // 工作流控制 TAB 状态
  const [workflowControlTab, setWorkflowControlTab] = useState<'control' | 'instances'>('control');
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // 从 store 获取未完成的实例、对话框状态和启动检测状态
  const { 
    incompleteInstances, 
    selectedInstanceDetails, 
    loadIncompleteInstances, 
    loadInstanceDetails,
    openInstanceDetailDialog,
    // 启动检测全局状态
    showStartupCheckDialog,
    pendingStartupWorkflowId,
    pendingStartupWorkflowName,
    setShowStartupCheckDialog,
    triggerStartupCheck,
    // 工作流启动检测状态（指挥官启动时使用）
    workflowStartupCheckStatus,
    workflowStartupCheckWorkflowId,
    workflowStartupCheckResult,
    setWorkflowStartupCheckStatus,
    setWorkflowStartupCheckWorkflowId,
    setWorkflowStartupCheckResult,
  } = useStore();
  
  // 语言设置 - 必须在 calculateDuration 之前定义
  const isZh = language === 'zh';
  
  // 计算运行时长 - 纯函数，不依赖 Date.now()（除非 running 状态）
  const calculateDuration = (instance: { startedAt: string; status?: string; completedAt?: string; pausedAt?: string; interruptAt?: string; updatedAt?: string }): string => {
    const start = new Date(instance.startedAt).getTime();
    
    // 根据状态选择结束时间 - 非 running 状态绝不使用 Date.now()
    let endTime: number | null = null;
    
    if (instance.status === 'completed') {
      // 完成状态：必须有结束时间
      endTime = instance.completedAt ? new Date(instance.completedAt).getTime() 
        : instance.updatedAt ? new Date(instance.updatedAt).getTime() 
        : null;
    } else if (instance.status === 'failed') {
      // 失败状态：使用中断时间或更新时间
      endTime = instance.interruptAt ? new Date(instance.interruptAt).getTime() 
        : instance.updatedAt ? new Date(instance.updatedAt).getTime() 
        : null;
    } else if (instance.status === 'paused') {
      // 暂停状态：使用暂停时间或更新时间
      endTime = instance.pausedAt ? new Date(instance.pausedAt).getTime() 
        : instance.interruptAt ? new Date(instance.interruptAt).getTime() 
        : instance.updatedAt ? new Date(instance.updatedAt).getTime() 
        : null;
    }
    
    // 如果无法确定结束时间，返回 "未知" 而不是实时计算
    if (endTime === null) {
      return isZh ? '未知' : 'Unknown';
    }
    
    const seconds = Math.floor((endTime - start) / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };
  
  // 缓存每个实例的时长计算结果 - 避免每次渲染重新计算
  const durationCache = useMemo(() => {
    const cache: Record<string, string> = {};
    incompleteInstances.forEach(instance => {
      // 只有 running 状态才需要实时计算，其他状态缓存结果
      if (instance.status !== 'running') {
        cache[instance.instanceId] = calculateDuration(instance);
      }
    });
    return cache;
  }, [incompleteInstances, isZh]);
  
  // 获取时长显示 - running 状态实时计算，其他状态使用缓存
  const getDuration = (instance: { instanceId: string; startedAt: string; status?: string; completedAt?: string; pausedAt?: string; interruptAt?: string; updatedAt?: string }): string => {
    if (instance.status === 'running') {
      // running 状态：实时计算
      return calculateDuration(instance);
    }
    // 其他状态：使用缓存
    return durationCache[instance.instanceId] || calculateDuration(instance);
  };
  
  // 启动工作流 - 先显示检测弹窗
  const handleStartWorkflow = (workflowId: string) => {
    if (isExecuting) return;
    
    const wf = workflows.find(w => w.id === workflowId);
    if (!wf) return;
    
    // 显示启动检测弹窗（使用全局状态）
    triggerStartupCheck(workflowId, wf.name);
  };
  
  // 启动检测完成 - 执行工作流
  const handleStartupCheckComplete = async (success: boolean) => {
    setShowStartupCheckDialog(false);
    
    if (!success || !pendingStartupWorkflowId) {
      return;
    }
    
    // 检测通过，开始执行
    setIsExecuting(true);
    try {
      const { executeWorkflow } = await import('../../store/useStore');
      await executeWorkflow(pendingStartupWorkflowId, blackboardVariables);
    } catch (error) {
      console.error('[AgentWorld] Failed to execute workflow:', error);
    } finally {
      setIsExecuting(false);
    }
  };
  
  // 取消启动检测
  const handleStartupCheckCancel = () => {
    setShowStartupCheckDialog(false);
  };
  
  // 跳过检测，直接执行
  const handleStartupCheckSkip = async () => {
    setShowStartupCheckDialog(false);
    
    if (!pendingStartupWorkflowId) return;
    
    setIsExecuting(true);
    try {
      const { executeWorkflow } = await import('../../store/useStore');
      await executeWorkflow(pendingStartupWorkflowId, blackboardVariables);
    } catch (error) {
      console.error('[AgentWorld] Failed to execute workflow:', error);
    } finally {
      setIsExecuting(false);
    }
  };
  
  // 旧方法保留兼容
  const handleExecuteWorkflow = handleStartWorkflow;
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);

  const workflow = workflows.find(w => w.id === currentWorkflowId);

  const flowProgress = useMemo(() => {
    if (!executionInstance || executionInstance.status !== 'running') return 0;
    return (Date.now() % 3000) / 3000;
  }, [executionInstance?.status]);

  const groupPositions = useMemo(() => {
    if (!workflow) return {};
    const positions: Record<string, { position: [number, number, number]; nodes: typeof workflow.nodes }> = {};

    workflow.nodes.forEach((node, index) => {
      const key = node.groupId || node.agentId || node.id;
      if (!positions[key]) {
        const angle = (index / workflow.nodes.length) * Math.PI * 2 - Math.PI / 2;
        const radius = 6;
        positions[key] = {
          position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
          nodes: []
        };
      }
      positions[key].nodes.push(node);
    });

    return positions;
  }, [workflow]);

  const zoneColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

  const statusText = isZh ? {
    idle: '空闲', running: '执行中', paused: '已暂停',
    waiting_review: '等待审核', completed: '已完成', failed: '已失败'
  } : {
    idle: 'Idle', running: 'Running', paused: 'Paused',
    waiting_review: 'Waiting', completed: 'Completed', failed: 'Failed'
  };

  // ===== 工作流标签页 - 编辑器 =====
  if (activeTab === 'workflow') {
    return (
      <div className="w-full h-full">
        <WorkflowTree />
      </div>
    );
  }

  // ===== 3D世界标签页 =====
  return (
    <div className="w-full h-full relative" style={{ zIndex: 0 }}>
      {/* Instructions */}
      {activeTab === 'world' && (
        <div className="absolute top-12 right-4 z-50 bg-gray-900/90 p-3 rounded-lg border border-gray-700 text-xs text-gray-400">
          <div>🖱️ 左键: 选中智能体</div>
          <div>🖱️ 右键: 移动到目标点</div>
        </div>
      )}

      {activeTab === 'world' && workflow && (
        <div className="absolute top-12 left-4 z-50 w-64 bg-gray-900/95 p-4 rounded-xl border-2 border-indigo-500 shadow-2xl">
          <div className="text-white font-bold text-lg mb-3 flex items-center gap-2">
            <span>🎮</span>
            <span>{isZh ? '工作流控制' : 'Workflow'}</span>
          </div>
          
          {/* TAB 卡 */}
          <div className="flex gap-1 mb-3 bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setWorkflowControlTab('control')}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                workflowControlTab === 'control'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {isZh ? '控制' : 'Control'}
            </button>
            <button
              onClick={() => {
                setWorkflowControlTab('instances');
                loadIncompleteInstances();
              }}
              className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                workflowControlTab === 'instances'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {isZh ? '实例' : 'Instances'}
              {incompleteInstances.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 rounded-full">
                  {incompleteInstances.length}
                </span>
              )}
            </button>
          </div>
          
          {/* TAB 1: 工作流控制 */}
          {workflowControlTab === 'control' && (
            <>
              <div className="mb-3">
                <div className="text-gray-400 text-xs">{isZh ? '当前流程' : 'Workflow'}</div>
                <div className="text-white font-medium">{workflow.name}</div>
              </div>

              <div className="mb-3">
                <div className="text-gray-400 text-xs">{isZh ? '状态' : 'Status'}</div>
                <div className="inline-block px-3 py-1 rounded-full text-sm font-medium bg-gray-700 text-white">
                  {executionInstance ? statusText[executionInstance.status] : statusText.idle}
                </div>
              </div>

              <div className="flex gap-2">
                {/* 检测中状态 */}
                {workflowStartupCheckStatus === 'checking' && workflowStartupCheckWorkflowId === workflow.id && (
                  <button
                    disabled
                    className="flex-1 px-4 py-2 bg-yellow-600/50 text-white font-bold rounded-lg animate-pulse cursor-not-allowed"
                  >
                    🔍 {isZh ? '检测中...' : 'Checking...'}
                  </button>
                )}
                
                {/* 检测失败状态 */}
                {workflowStartupCheckStatus === 'failed' && workflowStartupCheckWorkflowId === workflow.id && (
                  <button
                    onClick={() => handleExecuteWorkflow(workflow.id)}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg"
                  >
                    ⚠️ {isZh ? '检测失败，点击重试' : 'Check failed, retry'}
                  </button>
                )}
                
                {/* 正常状态：未执行或已完成/失败 */}
                {(workflowStartupCheckStatus === 'idle' || workflowStartupCheckWorkflowId !== workflow.id) && 
                (!executionInstance || executionInstance.status === 'completed' || executionInstance.status === 'failed') && (
                  <button
                    onClick={() => handleExecuteWorkflow(workflow.id)}
                    disabled={isExecuting}
                    className={`flex-1 px-4 py-2 text-white font-bold rounded-lg ${
                      isExecuting 
                        ? 'bg-gray-600 cursor-not-allowed' 
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {isExecuting 
                      ? (isZh ? '启动中...' : 'Starting...')
                      : (executionInstance?.status === 'failed' 
                          ? (isZh ? '↺ 重试' : '↺ Retry')
                          : `▶ ${isZh ? '启动' : 'Start'}`)
                    }
                  </button>
                )}
                
                {/* 执行中状态 */}
                {executionInstance && executionInstance.status !== 'completed' && executionInstance.status !== 'failed' && (
                  <>
                    {executionInstance.status === 'running' && (
                      <button onClick={pauseExecution} className="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-bold rounded-lg">
                        ⏸ {isZh ? '暂停' : 'Pause'}
                      </button>
                    )}
                    {executionInstance.status === 'paused' && (
                      <button onClick={resumeExecution} className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg">
                        ▶ {isZh ? '继续' : 'Resume'}
                      </button>
                    )}
                    {executionInstance.status === 'waiting_review' && (
                      <button className="px-3 py-2 bg-blue-600 animate-pulse text-white font-bold rounded-lg">
                        📋
                      </button>
                    )}
                  </>
                )}
              </div>

              {executionInstance && (
                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="text-gray-400 text-xs">{isZh ? '当前节点' : 'Current'}</div>
                  <div className="text-indigo-400 font-medium">
                    {workflow.nodes.find(n => n.id === executionInstance.currentNodeId)?.name || '-'}
                  </div>
                </div>
              )}

              {/* 里程碑进度 */}
              <MilestonePanel 
                workflow={workflow} 
                currentNodeId={executionInstance?.currentNodeId || null}
                executionPath={executionInstance?.executionPath || []}
              />
            </>
          )}
          
          {/* TAB 2: 工作流实例管理 */}
          {workflowControlTab === 'instances' && (
            <div className="max-h-96 overflow-y-auto">
              {incompleteInstances.length > 0 ? (
                <div className="space-y-2">
                  {incompleteInstances.map((instance) => (
                    <div
                      key={instance.instanceId}
                      onClick={() => {
                        if (selectedInstanceId === instance.instanceId) {
                          setSelectedInstanceId(null);
                        } else {
                          setSelectedInstanceId(instance.instanceId);
                          loadInstanceDetails(instance.instanceId);
                        }
                      }}
                      onDoubleClick={() => {
                        // 双击打开详情对话框
                        openInstanceDetailDialog(instance.instanceId, instance.workflowId);
                      }}
                      className={`p-2 rounded-lg cursor-pointer transition-all ${
                        selectedInstanceId === instance.instanceId
                          ? 'bg-indigo-600/30 border border-indigo-500'
                          : 'bg-gray-800/50 border border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">
                          {instance.status === 'running' ? '🔄' : 
                           instance.status === 'paused' ? '⏸️' : 
                           instance.status === 'failed' ? '❌' : '⏳'}
                        </span>
                        <span className="text-white text-sm font-medium truncate flex-1">
                          {instance.workflowName}
                        </span>
                      </div>
                      
                      <div className="text-gray-400 text-xs mb-1">
                        {isZh ? '当前节点' : 'Current'}: {instance.currentNodeName || instance.currentNodeId}
                      </div>
                      
                      <div className="text-gray-400 text-xs">
                        {isZh ? '运行时长' : 'Duration'}: {getDuration(instance)}
                      </div>

                      {/* 双击提示 */}
                      <div className="text-gray-500 text-xs mt-1">
                        {isZh ? '双击查看详情' : 'Double-click for details'}
                      </div>

                      {/* 展开详情 */}
                      {selectedInstanceId === instance.instanceId && selectedInstanceDetails && (
                        <div className="mt-2 pt-2 border-t border-gray-700">
                          <div className="text-gray-400 text-xs mb-1">{isZh ? '节点进度' : 'Node Progress'}:</div>
                          <div className="space-y-1">
                            {selectedInstanceDetails.nodeStates.map((node, idx) => (
                              <div key={`${node.nodeId}-${idx}`} className="flex items-center gap-2 text-xs">
                                <span>
                                  {node.status === 'completed' ? '✓' :
                                   node.status === 'running' ? '⏳' :
                                   node.status === 'failed' ? '✗' : '○'}
                                </span>
                                <span className="text-gray-300 truncate flex-1">
                                  {node.nodeName || node.nodeId}
                                </span>
                                {node.duration && (
                                  <span className="text-gray-500">
                                    {Math.floor(node.duration / 1000)}s
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-400 py-4">
                  {isZh ? '暂无未完成的实例' : 'No incomplete instances'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Canvas camera={{ position: cameraSettings.position, fov: cameraSettings.fov }}>
        {/* 场景元素 - 加载时用SceneElements，否则用Scene */}
        {sceneConfig && sceneConfig.elements ? (
          <SceneElements config={sceneConfig} />
        ) : (
          <Scene />
        )}

        {/* AHIVECORE 母体 - 已与浮动智能体合体，不再单独渲染 */}
        {/* {activeTab === 'world' && <AHIVECore position={[0, 0, 0]} />} */}

        {/* 工作流执行演绎 - 卡牌节点 + 智能体移动 */}
        {activeTab === 'world' && workflow && (
          <WorkflowExecution3D />
        )}

        {/* 智能体 */}
        <AgentsRenderer 
          onEditAgent={(agent) => {
            setEditAgent(agent);
            setIsDialogOpen(true);
          }}
        />

        {/* 右键移动 */}
        {activeTab === 'world' && selectedAgentId && <GroundClickHandler />}
        {activeTab === 'world' && <DestinationMarker />}

        {/* 轨道控制 */}
        <OrbitControls
          makeDefault
          minDistance={cameraSettings.minDistance}
          maxDistance={cameraSettings.maxDistance}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2 - 0.1}
          enablePan={true}
          panSpeed={0.5}
        />
      </Canvas>

      {/* 内存监控进度条 - 顶部状态栏 */}
      {activeTab === 'world' && (
        <MemoryMonitorBar />
      )}

      {/* 执行日志面板 - 右侧可收缩面板 */}
      {activeTab === 'world' && (
        <ExecutionPanel 
          onClear={clearExecutionLogs}
        />
      )}

      {/* 对话输入框 - 仅在选中智能体时显示 */}
      {activeTab === 'world' && (selectedAgentId || chatTargetId === null || chatTargetId) && (
        <ChatInput agentId={chatTargetId === null ? '__broadcast__' : (chatTargetId || selectedAgentId || '')} />
      )}

      <CreateAgentDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setEditAgent(null);
        }}
        editAgent={editAgent}
        onCreated={() => {
          setEditAgent(null);
        }}
      />

      {/* LLM 配置对话框 - 首次配置 AHIVECORE */}
      <LLMConfigDialog
        isOpen={showLLMConfig}
        onClose={() => setShowLLMConfig(false)}
        onSave={handleSaveLLMConfig}
      />

      {/* 工作流启动检测弹窗 */}
      <WorkflowStartupCheckDialog
        isOpen={showStartupCheckDialog}
        workflowId={pendingStartupWorkflowId}
        workflowName={pendingStartupWorkflowName}
        onComplete={handleStartupCheckComplete}
        onCancel={handleStartupCheckCancel}
        onSkip={handleStartupCheckSkip}
      />
    </div>
  );
}

// 对话输入框组件
function ChatInput({ agentId }: { agentId: string }) {
  // 使用全局 store 管理每个智能体的等待状态
  const { language, agents, chatMessages, addChatMessage, clearChatMessages, agentTypingStatus, setAgentTyping, setChatTargetId, offlineAgents, updateChatMessage, addExecutionLog } = useStore();
  const dialog = useDialog();
  const isTyping = agentTypingStatus[agentId] || false;
  // 检查智能体是否离线
  const isAgentOffline = agentId !== '__broadcast__' && (offlineAgents.has(agentId) || agents.find(a => a.id === agentId)?.status === 'offline');
  
  // 选择智能体或全体
  const handleSelectAgent = (id: string | null) => {
    setChatTargetId(id);
  };
  const [selectorOpen, setSelectorOpen] = useState(false);

  const [input, setInput] = useState('');
  const [isHidden, setIsHidden] = useState(false);
  const [chatHeight, setChatHeight] = useState(200); // 聊天区高度
  const [opacity, setOpacity] = useState(0.95); // 透明度
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const isZh = language === 'zh';
  
  // 流式消息累积
  const streamingMessageRef = useRef<string>('');
  const streamingMessageIdRef = useRef<string>('');

  const agent = agents.find(a => a.id === agentId);
  const messages = chatMessages[agentId] || [];

  // 从 Store 读取流式消息
  const streamingMessages = useStore((state) => state.streamingMessages);
  const currentStreamMessage = streamingMessages[agentId];
  const prevContentRef = useRef<string>('');

  // 监听流式消息变化，更新聊天消息（使用累积+批量更新避免高频渲染）
  useEffect(() => {
    if (currentStreamMessage && streamingMessageIdRef.current) {
      const newContent = currentStreamMessage.content;
      // 只有内容实际变化时才更新
      if (newContent !== prevContentRef.current) {
        prevContentRef.current = newContent;
        // 使用 requestAnimationFrame 批量更新，减少重渲染次数
        const id = requestAnimationFrame(() => {
          updateChatMessage(agentId, streamingMessageIdRef.current, newContent);
        });
        return () => cancelAnimationFrame(id);
      }
    }
  }, [currentStreamMessage, agentId, updateChatMessage]);

  // 监听 agent-chat 消息
  const agentChatMessages = useStore((state) => state.agentChatMessages);
  useEffect(() => {
    // 显示最新的 agent-chat 消息
    const lastMessage = agentChatMessages[agentChatMessages.length - 1];
    if (lastMessage) {
      const fromId = lastMessage.fromAgentId;
      const fromName = lastMessage.fromAgentName;
      const toId = lastMessage.toAgentId;
      const toName = lastMessage.toAgentName;
      const message = lastMessage.message;

      // 在发送方的对话框中显示
      addChatMessage(fromId, 'assistant', `→ ${toName}: ${message}`);

      // 如果接收方也是当前对话的智能体，也在其对话框中显示
      if (toId && agents.find(a => a.agentId === toId || a.id === `a2a-${toId}`)) {
        const toAgentUiId = `a2a-${toId}`;
        addChatMessage(toAgentUiId, 'assistant', `← ${fromName}: ${message}`);
      }
    }
  }, [agentChatMessages, agents, addChatMessage]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { setIsHidden(false); }, [agentId]);

  // 拖拽调整高度（无限制）
  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = chatHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const delta = dragStartY.current - e.clientY;
      const newHeight = Math.max(50, dragStartHeight.current + delta);
      setChatHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 清空聊天
  const handleClearChat = async () => {
    const shouldSave = await dialog.confirm(
      isZh ? '是否保存聊天记录？' : 'Save chat history?',
      isZh ? '保存聊天记录' : 'Save Chat History'
    );
    if (shouldSave) {
      // 保存聊天记录
      const content = messages.map(m =>
        `${m.role === 'user' ? '👤 ' : '🤖 '}${m.content}`
      ).join('\n\n');

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat_${agent?.name || 'agent'}_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
    clearChatMessages(agentId);
  };

  // 判断是否为 AHIVECORE 类型智能体
  const isAHIVECOREAgent = (ag: typeof agents[0] | undefined): boolean => {
    if (!ag) return false;
    // AHIVECORE 类型包括：ahive-coder, ahive-worker, 或 protocolType 为 ahivecore
    const agentType = ag.type || ag.agentType || ag.protocolType;
    return agentType === 'ahive-coder' || 
           agentType === 'ahive-worker' || 
           agentType === 'ahivecore' ||
           ag.protocolType === 'ahivecore';
  };

  // STOP - 停止等待 / 中断任务
  const handleStop = async () => {
    if (agentId === '__broadcast__') {
      // 广播模式：停止所有智能体的等待
      agents.forEach(ag => setAgentTyping(ag.id, false));
    } else {
      setAgentTyping(agentId, false);
      
      // 只有 AHIVECORE 类型才调用 interrupt API
      if (isAHIVECOREAgent(agent)) {
        const realAgentId = agent?.agentId || agentId.replace('a2a-', '').replace('agent-', '');
        
        if (window.electronAPI?.interruptAHIVECORE) {
          try {
            const result = await window.electronAPI.interruptAHIVECORE(realAgentId);
            if (result.success) {
              console.log(`[AgentWorld] Interrupted AHIVECORE agent: ${realAgentId}`);
              addExecutionLog({
                agentId: agentId,
                agentName: agent?.name || agentId,
                type: 'system',
                content: isZh ? '⏹️ 任务已中断' : '⏹️ Task interrupted',
              });
            } else {
              console.warn(`[AgentWorld] Interrupt failed: ${result.error}`);
            }
          } catch (err) {
            console.error('[AgentWorld] Interrupt error:', err);
          }
        }
      }
      // 其他类型智能体：仅停止等待状态，不调用 interrupt API
    }
  };

  // 插话 - 在任务执行中插入用户消息（仅 AHIVECORE 类型）
  const handleInterruptInput = async () => {
    if (!input.trim() || agentId === '__broadcast__') return;
    
    // 只有 AHIVECORE 类型才能插话
    if (!isAHIVECOREAgent(agent)) {
      console.warn('[AgentWorld] 插话功能仅支持 AHIVECORE 类型智能体');
      return;
    }
    
    const message = input.trim();
    const realAgentId = agent?.agentId || agentId.replace('a2a-', '').replace('agent-', '');
    
    // 调用 AHIVECORE user-input API
    if (window.electronAPI?.sendUserInput) {
      try {
        const result = await window.electronAPI.sendUserInput(realAgentId, message);
        if (result.success) {
          console.log(`[AgentWorld] User input sent to AHIVECORE agent: ${realAgentId}`);
          addChatMessage(agentId, 'user', message);
          setInput('');
          addExecutionLog({
            type: 'system',
            agentId: agentId,
            agentName: agent?.name || agentId,
            content: isZh ? `💬 插话: ${message.substring(0, 50)}...` : `💬 Interrupt: ${message.substring(0, 50)}...`,
          });
        } else {
          console.warn(`[AgentWorld] Send user input failed: ${result.error}`);
        }
      } catch (err) {
        console.error('[AgentWorld] Send user input error:', err);
      }
    }
  };



  // 发送消息到单个 Agent（根据类型选择不同调用方式）
  const sendToAgent = async (ag: typeof agents[0], message: string, targetId: string) => {
    setAgentTyping(ag.id, true);
    
    try {
      // 根据 Agent 类型选择调用方式
      if (ag.type === 'a2a' && window.electronAPI?.sendA2ATaskSync) {
        // A2A Agent: 使用 A2A 协议同步调用
        const a2aAgentId = ag.id.replace('a2a-', ''); // 去掉前缀
        const result = await window.electronAPI.sendA2ATaskSync(a2aAgentId, message);
        
        if (result.success && result.result) {
          // A2A 返回结果处理
          const reply = typeof result.result === 'string' 
            ? result.result 
            : (result.result as any).message?.content || JSON.stringify(result.result);
          addChatMessage(targetId, 'assistant', `[${ag.name}] ${reply}`);
        } else {
          addChatMessage(targetId, 'assistant', `[${ag.name}] 错误: ${result.error || '调用失败'}`);
        }
      } else if (window.electronAPI?.sendMessageToAgent) {
        // OpenClaw Agent: 使用 Gateway 调用
        const result = await window.electronAPI.sendMessageToAgent(ag.name, message);
        
        if (result.success && result.data) {
          const payloads = result.data.result?.payloads || result.data.payloads;
          const reply = payloads?.[0]?.text || result.data.message || result.data.text || '无回复';
          addChatMessage(targetId, 'assistant', `[${ag.name}] ${reply}`);
        } else if (result.error) {
          addChatMessage(targetId, 'assistant', `[${ag.name}] 错误: ${result.error}`);
        }
      } else {
        // 模拟模式
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        addChatMessage(targetId, 'assistant', `[${ag.name}] [模拟回复] 收到消息: ${message}`);
      }
    } catch (err: any) {
      addChatMessage(targetId, 'assistant', `[${ag.name}] 调用失败: ${err.message}`);
    } finally {
      setAgentTyping(ag.id, false);
    }
  };

  // 广播模式：向所有智能体发送消息
  const handleBroadcastSend = async (message: string) => {
    addChatMessage('__broadcast__', 'user', message);
    setInput('');
    
    // 并行向所有智能体发送消息
    const sendPromises = agents.map(ag => sendToAgent(ag, message, '__broadcast__'));
    await Promise.all(sendPromises);
  };

  // 单智能体发送消息
  const handleSingleSend = async (message: string) => {
    if (!agent) return;
    
    addChatMessage(agentId, 'user', message);
    setInput('');
    setAgentTyping(agentId, true);

    // 创建流式消息占位符
    const streamMsgId = `msg-${Date.now()}-stream`;
    streamingMessageIdRef.current = streamMsgId;
    streamingMessageRef.current = '';
    
    // 添加一个空的 assistant 消息，使用指定的 ID
    addChatMessage(agentId, 'assistant', '...', streamMsgId);

    // 协议类型 - 优先使用 protocolType，其次使用 type
    const protocolType = agent.protocolType || (agent.type === 'a2a' ? 'ahivecore' : agent.type);

    // 获取配置 ID（去掉前缀）
    const getConfigId = (agent: typeof agents[0]): string => {
      const id = agent.id;
      if (id.startsWith('a2a-')) return id.replace('a2a-', '');
      if (id.startsWith('agent-')) return id.replace('agent-', '');
      return id;
    };

    // 获取真实 ID（用于 AHIVECORE）
    const getRealAgentId = (agent: typeof agents[0]): string => {
      return agent.agentId || getConfigId(agent);
    };

    try {
      // AHIVECORE 流式模式 - 传真实 ID
      if (protocolType === 'ahivecore' && window.electronAPI?.startAHIVECOREStream) {
        const realAgentId = getRealAgentId(agent);
        await window.electronAPI.startAHIVECOREStream(realAgentId, message);
        // WebSocket 会自动接收流式事件
      } 
      // A2A 同步模式（外部 Agent）- 传配置 ID
      else if (window.electronAPI?.sendA2ATaskSync) {
        const configId = getConfigId(agent);
        console.log('[AgentWorld] A2A sendTaskSync start, configId:', configId);
        const startTime = Date.now();
        const result = await window.electronAPI.sendA2ATaskSync(configId, message);
        console.log('[AgentWorld] A2A sendTaskSync done, elapsed:', Date.now() - startTime, 'ms');
        console.log('[AgentWorld] A2A result:', result);
        
        if (result.success && result.result) {
          const reply = typeof result.result === 'string' 
            ? result.result 
            : (result.result as any).message?.content || JSON.stringify(result.result);
          console.log('[AgentWorld] Updating chat with reply:', reply.substring(0, 50));
          updateChatMessage(agentId, streamMsgId, reply);
          console.log('[AgentWorld] Chat updated');
        } else {
          // 修复 undefined 错误显示
          const errorMsg = result.error || '调用失败';
          updateChatMessage(agentId, streamMsgId, `错误: ${errorMsg}`);
        }
        setAgentTyping(agentId, false);
      } 
      // OpenClaw Agent: 使用 Gateway 调用（已废弃，保留兼容）
      else if (window.electronAPI?.sendMessageToAgent) {
        const result = await window.electronAPI.sendMessageToAgent(agent.name, message);

        if (result.success && result.data) {
          const payloads = result.data.result?.payloads || result.data.payloads;
          const reply = payloads?.[0]?.text || result.data.message || result.data.text || JSON.stringify(result.data, null, 2);
          updateChatMessage(agentId, streamMsgId, reply);
        } else if (result.raw) {
          updateChatMessage(agentId, streamMsgId, result.raw);
        } else {
          const errorMsg = result.error || '调用失败';
          updateChatMessage(agentId, streamMsgId, `错误: ${errorMsg}`);
        }
        setAgentTyping(agentId, false);
      } else {
        // 模拟模式
        setTimeout(() => {
          updateChatMessage(agentId, streamMsgId, `[模拟回复] 收到消息: ${message}`);
        }, 1000);
      }
    } catch (err: any) {
      // 修复 undefined 错误
      const errorMsg = err?.message || '未知错误';
      updateChatMessage(agentId, streamMsgId, `调用失败: ${errorMsg}`);
    }

    setAgentTyping(agentId, false);
  };

  // 发送消息入口
  const handleSend = async () => {
    if (!input.trim()) return;
    
    // 离线智能体禁止对话
    if (isAgentOffline) {
      alert('该智能体当前离线，无法对话');
      return;
    }
    
    const message = input.trim();
    
    if (agentId === '__broadcast__') {
      await handleBroadcastSend(message);
    } else {
      await handleSingleSend(message);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isHidden) return null;

  return (

    <div
      className="absolute left-0 right-0 bottom-0 flex flex-col border-t border-gray-700"
      style={{
        padding: '12px 16px',
        height: `${chatHeight}px`,
        backgroundColor: opacity >= 1 ? '#111827' : `rgba(17, 24, 39, ${opacity})`,
        transition: isDragging ? 'none' : 'background-color 0.3s ease',
        zIndex: 9999
      }}
    >
      {/* 拖拽手柄 */}
      <div
        className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-indigo-500 transition-colors"
        style={{ backgroundColor: isDragging ? '#6366f1' : 'transparent' }}
        onMouseDown={handleDragStart}
        title={isZh ? '拖拽调整高度' : 'Drag to resize'}
      />

      {/* 顶部栏 */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span>💬</span>
          <span className="text-sm text-gray-400">{isZh ? '与' : 'With'}</span>
          {/* 智能体下拉选择器 */}
          <div className="relative">
            <button
              onClick={() => setSelectorOpen(!selectorOpen)}
              className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-white font-medium"
            >
              {agentId === '__broadcast__' ? '🌐 全体' : (agent?.name || '选择智能体')}
              <span className="text-xs">▼</span>
            </button>
            
            {/* 下拉列表 */}
            {selectorOpen && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[150px]">
                {/* 全体选项 */}
                <button
                  onClick={() => { handleSelectAgent(null); setSelectorOpen(false); }}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-700 flex items-center gap-2 ${agentId === '__broadcast__' ? 'bg-indigo-600' : ''}`}
                >
                  🌐 {isZh ? '全体' : 'All'}
                  {agentId === '__broadcast__' && <span className="ml-auto">✓</span>}
                </button>
                
                <div className="border-t border-gray-600" />
                
                {/* 智能体列表 */}
                {agents.map(ag => (
                  <button
                    key={ag.id}
                    onClick={() => { handleSelectAgent(ag.id); setSelectorOpen(false); }}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-700 flex items-center gap-2 ${agentId === ag.id ? 'bg-indigo-600' : ''}`}
                  >
                    🔵 {ag.name}
                    {agentId === ag.id && <span className="ml-auto">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* 广播模式等待状态显示 */}
        {agentId === '__broadcast__' && agents.some(a => agentTypingStatus[a.id]) && (
          <div className="flex items-center gap-1 ml-2">
            {agents.filter(a => agentTypingStatus[a.id]).map(a => (
              <span key={a.id} className="text-xs text-yellow-400">{a.name}◡◡</span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* 透明度滑块 */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">☀</span>
            <input
              type="range"
              min="0.6"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-16 h-1 accent-indigo-500"
              title={isZh ? '透明度' : 'Opacity'}
            />
          </div>

          {/* 清空按钮 */}
          <button
            onClick={handleClearChat}
            className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
            title={isZh ? '清空聊天' : 'Clear chat'}
          >
            🗑️
          </button>

          {/* STOP按钮 */}
          <button
            onClick={handleStop}
            disabled={!isTyping}
            className={`p-1.5 rounded text-gray-300 ${isTyping ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700'}`}
            title={isZh ? '停止等待' : 'STOP'}
          >
            ⏹️
          </button>

          {/* 收起按钮 */}
          <button
            onClick={() => setIsHidden(true)}
            className="p-1.5 bg-gray-700 hover:bg-red-600 rounded text-gray-300"
            title={isZh ? '隐藏' : 'Hide'}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto min-h-0 max-w-4xl mx-auto w-full">
        {messages.length > 0 ? (
          <div className="space-y-2">
            {messages.slice(-50).map((msg) => (
              <div key={msg.id} className={`text-sm ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <span
                  className={`inline-block px-3 py-2 rounded-lg ${msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-700 text-gray-200'
                    }`}
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '80%' }}
                >
                  {msg.role === 'user' ? '👤 ' : '🤖 '}{msg.content}
                </span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="text-gray-500 text-sm text-center py-4">
            {isZh ? '发送消息开始对话...' : 'Send a message to start...'}
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="flex gap-2 mt-2 flex-shrink-0 max-w-4xl mx-auto w-full">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={isZh ? '输入消息...' : 'Type...'}
          className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        {/* 插话按钮 - 智能体正在执行时显示 */}
        {isTyping && (
          <button
            onClick={handleInterruptInput}
            disabled={!input.trim()}
            className="px-4 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-white rounded-lg disabled:cursor-not-allowed flex-shrink-0"
            title={isZh ? '插话：打断当前任务并加入新消息' : 'Interrupt: Add message to current task'}
          >
            {isZh ? '插话' : 'Interrupt'}
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={!input.trim() || isTyping}
          className="px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white rounded-lg disabled:cursor-not-allowed flex-shrink-0"
        >
          {isZh ? '发送' : 'Send'}
        </button>
      </div>
    </div>
  );
}
