/**
 * 任务拆解状态 3D 可视化组件
 * 
 * 功能：
 * - 显示节点裂变动画（节点分裂成多个子节点）
 * - 显示子任务进度条
 * - 显示审批状态（assessing/proposing/reviewing/approved/rejected/executing/merged）
 */

import { useState, useRef, useMemo, useEffect } from 'react';
import { Html, Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store/useStore';

// ========== 类型定义 ==========

type DecompositionStatus = 'assessing' | 'proposing' | 'reviewing' | 'approved' | 'rejected' | 'executing' | 'merged';

interface SubTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  agentId?: string;
  agentName?: string;
  progress?: number;
}

interface DecompositionState {
  taskId: string;
  nodeId: string;
  nodeName: string;
  proposalId?: string;
  status: DecompositionStatus;
  subTasks?: SubTask[];
  position?: [number, number, number];
}

// ========== 节点裂变动画组件 ==========

interface NodeFissionProps {
  parentPosition: [number, number, number];
  subTasks: SubTask[];
  status: DecompositionStatus;
  onAnimationComplete?: () => void;
}

function NodeFission({ parentPosition, subTasks, status, onAnimationComplete }: NodeFissionProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // 计算子节点目标位置（围绕父节点分布）
  const subTaskPositions = useMemo(() => {
    const count = subTasks.length;
    const radius = 1.5;
    const positions: [number, number, number][] = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      positions.push([
        parentPosition[0] + Math.cos(angle) * radius,
        parentPosition[1] + 0.5,
        parentPosition[2] + Math.sin(angle) * radius,
      ]);
    }

    return positions;
  }, [parentPosition, subTasks.length]);

  // 开始裂变动画
  useEffect(() => {
    if (status === 'approved' && subTasks.length > 0) {
      setIsAnimating(true);
      setAnimationProgress(0);
    }
  }, [status, subTasks.length]);

  // 动画帧
  useFrame((state) => {
    if (isAnimating && groupRef.current) {
      const newProgress = Math.min(animationProgress + 0.02, 1);
      setAnimationProgress(newProgress);

      if (newProgress >= 1) {
        setIsAnimating(false);
        onAnimationComplete?.();
      }
    }
  });

  // 状态颜色
  const statusColors: Record<DecompositionStatus, string> = {
    assessing: '#9ca3af',    // 灰色 - 评估中
    proposing: '#f59e0b',    // 橙色 - 提案中
    reviewing: '#8b5cf6',    // 紫色 - 审批中
    approved: '#22c55e',     // 绿色 - 已批准
    rejected: '#ef4444',     // 红色 - 已驳回
    executing: '#3b82f6',    // 蓝色 - 执行中
    merged: '#10b981',       // 青色 - 已合并
  };

  const mainColor = statusColors[status];

  // 裂变动画：子节点从父节点位置向外扩散
  const getSubTaskPosition = (index: number): [number, number, number] => {
    const target = subTaskPositions[index];
    if (!target) return parentPosition;

    // 动画进度：从父节点位置到目标位置
    const progress = animationProgress;
    return [
      parentPosition[0] + (target[0] - parentPosition[0]) * progress,
      parentPosition[1] + (target[1] - parentPosition[1]) * progress,
      parentPosition[2] + (target[2] - parentPosition[2]) * progress,
    ];
  };

  // 子任务状态颜色
  const subTaskStatusColors: Record<string, string> = {
    pending: '#6b7280',
    running: '#f59e0b',
    completed: '#22c55e',
    failed: '#ef4444',
  };

  return (
    <group ref={groupRef}>
      {/* 父节点（裂变中逐渐变小） */}
      <mesh position={parentPosition}>
        <boxGeometry args={[1 * (1 - animationProgress * 0.5), 1.5 * (1 - animationProgress * 0.5), 0.1]} />
        <meshStandardMaterial
          color={mainColor}
          emissive={mainColor}
          emissiveIntensity={0.3}
          transparent
          opacity={1 - animationProgress * 0.3}
        />
      </mesh>

      {/* 裂变光效 */}
      {isAnimating && (
        <mesh position={parentPosition}>
          <ringGeometry args={[0.5 + animationProgress * 1, 0.6 + animationProgress * 1, 32]} />
          <meshBasicMaterial color={mainColor} transparent opacity={0.5 - animationProgress * 0.3} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 子节点（裂变动画后显示） */}
      {animationProgress > 0.3 && subTasks.map((subTask, index) => {
        const pos = getSubTaskPosition(index);
        const subColor = subTaskStatusColors[subTask.status];
        const scale = Math.max(0.3, (animationProgress - 0.3) * 1.5);

        return (
          <group key={subTask.id} position={pos}>
            {/* 子节点卡片 */}
            <mesh scale={[scale, scale, scale]}>
              <boxGeometry args={[0.8, 1, 0.08]} />
              <meshStandardMaterial
                color={subColor}
                emissive={subColor}
                emissiveIntensity={subTask.status === 'running' ? 0.5 : 0.2}
              />
            </mesh>

            {/* 子节点名称 */}
            <Billboard position={[0, 0.6 * scale, 0]}>
              <Html center distanceFactor={10} style={{ zIndex: 10 }}>
                <div
                  style={{
                    backgroundColor: 'rgba(17, 24, 39, 0.9)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    color: 'white',
                    fontSize: '10px',
                    whiteSpace: 'nowrap',
                    border: `1px solid ${subColor}`,
                  }}
                >
                  {subTask.name}
                </div>
              </Html>
            </Billboard>

            {/* 进度条 */}
            {subTask.status === 'running' && subTask.progress !== undefined && (
              <Billboard position={[0, -0.5 * scale, 0]}>
                <Html center distanceFactor={12} style={{ zIndex: 10 }}>
                  <div
                    style={{
                      width: '60px',
                      height: '6px',
                      backgroundColor: '#374151',
                      borderRadius: '3px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${subTask.progress}%`,
                        height: '100%',
                        backgroundColor: subColor,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </Html>
              </Billboard>
            )}

            {/* 连接线（从父节点到子节点） */}
            {animationProgress > 0.5 && (
              <primitive
                object={new THREE.Line(
                  new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(parentPosition[0], parentPosition[1], parentPosition[2]),
                    new THREE.Vector3(pos[0], pos[1], pos[2]),
                  ]),
                  new THREE.LineBasicMaterial({ color: mainColor, transparent: true, opacity: 0.5 })
                )}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

// ========== 拆解状态指示器 ==========

interface DecompositionIndicatorProps {
  position: [number, number, number];
  status: DecompositionStatus;
  proposalId?: string;
}

function DecompositionIndicator({ position, status, proposalId }: DecompositionIndicatorProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  // 状态颜色和图标
  const statusConfig: Record<DecompositionStatus, { color: string; icon: string; label: string }> = {
    assessing: { color: '#9ca3af', icon: '🔍', label: '评估中' },
    proposing: { color: '#f59e0b', icon: '📝', label: '提案中' },
    reviewing: { color: '#8b5cf6', icon: '⏳', label: '审批中' },
    approved: { color: '#22c55e', icon: '✅', label: '已批准' },
    rejected: { color: '#ef4444', icon: '❌', label: '已驳回' },
    executing: { color: '#3b82f6', icon: '⚡', label: '执行中' },
    merged: { color: '#10b981', icon: '🔗', label: '已合并' },
  };

  const config = statusConfig[status];
  const isAnimating = status === 'reviewing' || status === 'executing';

  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;

    if (meshRef.current && isAnimating) {
      // 脉动效果
      const pulse = 0.8 + Math.sin(time * 3) * 0.2;
      meshRef.current.scale.setScalar(pulse);
    }

    if (ringRef.current && status === 'reviewing') {
      // 审批中：旋转等待环
      ringRef.current.rotation.z = time;
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(time * 2) * 0.2;
    }
  });

  return (
    <group position={[position[0], position[1] + 2, position[2]]}>
      {/* 主指示器 */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={config.color} />
      </mesh>

      {/* 审批中：等待环 */}
      {status === 'reviewing' && (
        <mesh ref={ringRef} position={[0, 0, 0]}>
          <ringGeometry args={[0.2, 0.25, 32]} />
          <meshBasicMaterial color={config.color} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 状态标签 */}
      <Billboard>
        <Html center distanceFactor={8} style={{ zIndex: 10 }}>
          <div
            style={{
              backgroundColor: `rgba(${hexToRgb(config.color)}, 0.9)`,
              padding: '4px 10px',
              borderRadius: '6px',
              color: 'white',
              fontSize: '11px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              boxShadow: `0 0 10px ${config.color}40`,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>{config.icon}</span>
            <span>{config.label}</span>
          </div>
        </Html>
      </Billboard>

      {/* 提案 ID */}
      {proposalId && (
        <Billboard position={[0, -0.4, 0]}>
          <Html center distanceFactor={10} style={{ zIndex: 10 }}>
            <div
              style={{
                backgroundColor: 'rgba(17, 24, 39, 0.8)',
                padding: '2px 6px',
                borderRadius: '4px',
                color: '#9ca3af',
                fontSize: '9px',
                whiteSpace: 'nowrap',
              }}
            >
              ID: {proposalId.slice(0, 8)}
            </div>
          </Html>
        </Billboard>
      )}
    </group>
  );
}

// 辅助函数：hex to rgb
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '0, 0, 0';
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

// ========== 主组件 ==========

export function DecompositionStatus3D() {
  // 从 Store 获取拆解状态
  const decompositionStatesMap = useStore((state) => state.decompositionStates);
  const workflowNodePositions = useStore((state) => state.workflowNodePositions);

  // 将 Record 转换为数组
  const decompositionStates = useMemo(() => {
    return Object.entries(decompositionStatesMap).map(([taskId, state]) => ({
      taskId,
      nodeId: state.nodeId,
      nodeName: state.nodeId, // 使用 nodeId 作为名称回退
      proposalId: state.proposalId,
      status: state.status,
      subTasks: state.subTasks,
    }));
  }, [decompositionStatesMap]);

  // 如果没有拆解状态，不渲染
  if (decompositionStates.length === 0) {
    return null;
  }

  return (
    <group>
      {decompositionStates.map((decomp) => {
        // 获取节点位置
        const position = decomp.position || workflowNodePositions?.[decomp.nodeId] || [0, 0, 0];

        return (
          <group key={decomp.taskId}>
            {/* 状态指示器 */}
            <DecompositionIndicator
              position={position}
              status={decomp.status}
              proposalId={decomp.proposalId}
            />

            {/* 节点裂变动画（已批准且有子任务） */}
            {decomp.status === 'approved' && decomp.subTasks && decomp.subTasks.length > 0 && (
              <NodeFission
                parentPosition={position}
                subTasks={decomp.subTasks}
                status={decomp.status}
              />
            )}

            {/* 执行中：显示子任务进度 */}
            {decomp.status === 'executing' && decomp.subTasks && decomp.subTasks.length > 0 && (
              <SubTaskProgressPanel
                position={[position[0] + 2, position[1] + 1, position[2]]}
                subTasks={decomp.subTasks}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

// ========== 子任务进度面板 ==========

interface SubTaskProgressPanelProps {
  position: [number, number, number];
  subTasks: SubTask[];
}

function SubTaskProgressPanel({ position, subTasks }: SubTaskProgressPanelProps) {
  const language = useStore((state) => state.language);
  const isZh = language === 'zh';

  // 计算总体进度
  const totalProgress = useMemo(() => {
    const completed = subTasks.filter(s => s.status === 'completed').length;
    return Math.round((completed / subTasks.length) * 100);
  }, [subTasks]);

  // 状态颜色
  const statusColors: Record<string, string> = {
    pending: '#6b7280',
    running: '#f59e0b',
    completed: '#22c55e',
    failed: '#ef4444',
  };

  return (
    <Html position={position} distanceFactor={8} transform style={{ zIndex: 10 }}>
      <div
        className="bg-gray-900/95 border border-blue-500 rounded-xl overflow-hidden shadow-2xl"
        style={{
          width: '180px',
          maxHeight: '300px',
          pointerEvents: 'auto',
        }}
      >
        {/* 标题 */}
        <div className="p-2 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-white font-bold text-xs">
            ⚡ {isZh ? '子任务进度' : 'Sub Tasks'}
          </h3>
          <span className="text-blue-400 text-xs font-bold">{totalProgress}%</span>
        </div>

        {/* 总进度条 */}
        <div className="px-2 py-1">
          <div
            style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#374151',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${totalProgress}%`,
                height: '100%',
                backgroundColor: '#3b82f6',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>

        {/* 子任务列表 */}
        <div className="overflow-y-auto p-1.5 space-y-1" style={{ maxHeight: '200px' }}>
          {subTasks.map((subTask) => (
            <div
              key={subTask.id}
              className={`p-1.5 rounded-lg ${
                subTask.status === 'running'
                  ? 'bg-blue-600/20 border border-blue-500'
                  : subTask.status === 'completed'
                    ? 'bg-green-600/20 border border-green-600/50'
                    : subTask.status === 'failed'
                      ? 'bg-red-600/20 border border-red-600/50'
                      : 'bg-gray-800/50 border border-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    subTask.status === 'completed' ? 'bg-green-500' :
                    subTask.status === 'running' ? 'bg-blue-500 animate-pulse' :
                    subTask.status === 'failed' ? 'bg-red-500' :
                    'bg-gray-500'
                  }`}
                />
                <span className="text-white text-[10px] font-medium truncate">{subTask.name}</span>
              </div>

              {/* Agent 名称 */}
              {subTask.agentName && (
                <div className="text-gray-400 text-[9px] mt-0.5 truncate">
                  🤖 {subTask.agentName}
                </div>
              )}

              {/* 进度条 */}
              {subTask.status === 'running' && subTask.progress !== undefined && (
                <div className="mt-1">
                  <div
                    style={{
                      width: '100%',
                      height: '4px',
                      backgroundColor: '#374151',
                      borderRadius: '2px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${subTask.progress}%`,
                        height: '100%',
                        backgroundColor: statusColors[subTask.status],
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Html>
  );
}

export default DecompositionStatus3D;

// 别名导出（用于兼容不同的导入方式）
export const DecompositionPanel = SubTaskProgressPanel;