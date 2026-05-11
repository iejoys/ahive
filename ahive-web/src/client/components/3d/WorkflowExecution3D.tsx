import { useState, useRef, useMemo, useEffect } from 'react';
import { Html, Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store/useStore';
import type { Workflow, WorkflowNode, Agent } from '../../types';
import { WeldingEffect } from './WeldingEffect';
import { DecompositionStatus3D } from './DecompositionStatus3D';

// ========== 类型定义 ==========

type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';
type MilestoneStatus = 'pending' | 'running' | 'completed';

interface Milestone {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  status: MilestoneStatus;
}

// ========== 卡牌节点组件 ==========

interface CardNodeProps {
  node: WorkflowNode;
  position: [number, number, number];
  status: NodeStatus;
  isActive: boolean;
  workingAgents: Agent[];
  executionLogs: Array<{ agentName: string; content: string }>;
}

function CardNode({ node, position, status, isActive, workingAgents, executionLogs }: CardNodeProps) {
  const meshRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const cardRef = useRef<THREE.Mesh>(null);
  const indicatorRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  
  // 动画状态追踪
  const prevStatusRef = useRef<NodeStatus>(status);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // 状态颜色
  const statusColors: Record<NodeStatus, string> = {
    pending: '#6b7280',    // 灰色
    running: '#f59e0b',    // 橙色
    completed: '#22c55e',  // 绿色
    failed: '#ef4444',     // 红色
  };

  const color = statusColors[status];
  
  // 检测状态变化
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      setIsTransitioning(true);
      prevStatusRef.current = status;
      // 1秒后结束过渡动画
      const timer = setTimeout(() => setIsTransitioning(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    if (meshRef.current) {
      // 运行状态：脉动效果 + 轻微旋转
      if (status === 'running') {
        const scale = 1 + Math.sin(time * 3) * 0.08;
        meshRef.current.scale.setScalar(scale);
        meshRef.current.rotation.y = Math.sin(time * 1.5) * 0.05;
      }
      
      // 完成状态：庆祝动画
      if (status === 'completed') {
        const bounce = Math.abs(Math.sin(time * 2)) * 0.1;
        meshRef.current.position.y = bounce;
      }
      
      // 失败状态：抖动
      if (status === 'failed') {
        meshRef.current.rotation.z = Math.sin(time * 10) * 0.05;
      }
      
      // 状态过渡动画
      if (isTransitioning) {
        const transitionScale = 1 + Math.sin(time * 8) * 0.1;
        meshRef.current.scale.setScalar(transitionScale);
      }
      
      // 悬停效果
      if (hovered && status !== 'running') {
        meshRef.current.rotation.y = Math.sin(time * 2) * 0.1;
      }
      
      // 非活跃状态时重置
      if (status === 'pending') {
        meshRef.current.rotation.y = 0;
        meshRef.current.rotation.z = 0;
        meshRef.current.scale.setScalar(1);
      }
    }
    
    // 卡牌呼吸效果
    if (cardRef.current && status === 'running') {
      const breathe = 1 + Math.sin(time * 2) * 0.02;
      cardRef.current.scale.set(breathe, breathe, 1);
    }
    
    // 状态指示灯动画
    if (indicatorRef.current) {
      if (status === 'running') {
        // 运行时闪烁
        const pulse = 0.5 + Math.sin(time * 5) * 0.5;
        indicatorRef.current.scale.setScalar(pulse);
      } else if (status === 'completed') {
        // 完成时放大
        indicatorRef.current.scale.setScalar(1.2);
      } else {
        indicatorRef.current.scale.setScalar(1);
      }
    }
    
    // 发光效果
    if (glowRef.current && isActive) {
      const intensity = 0.5 + Math.sin(time * 4) * 0.3;
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = intensity;
      
      // 发光圈旋转
      glowRef.current.rotation.z = time * 0.5;
    }
  });

  // 最新日志（用于气泡显示）
  const latestLog = executionLogs[executionLogs.length - 1];

  return (
    <group position={position}>
      {/* 卡牌主体 */}
      <group
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        {/* 卡牌底座 */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1.2, 0.1, 0.8]} />
          <meshStandardMaterial color="#1e1e2e" metalness={0.8} roughness={0.2} />
        </mesh>

        {/* 卡牌主体 - 站立的卡片 */}
        <mesh ref={cardRef} position={[0, 0.8, 0]} rotation={[0, 0, 0]}>
          <boxGeometry args={[1, 1.5, 0.1]} />
          <meshStandardMaterial
            color={status === 'pending' ? '#374151' : color}
            emissive={color}
            emissiveIntensity={isActive ? 0.5 : 0.2}
            metalness={0.3}
            roughness={0.7}
          />
        </mesh>

        {/* 状态指示灯 */}
        <mesh ref={indicatorRef} position={[0, 1.6, 0]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>

        {/* 活跃状态发光圈 */}
        {isActive && (
          <mesh ref={glowRef} position={[0, 0.8, -0.1]}>
            <ringGeometry args={[0.6, 0.7, 32]} />
            <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
          </mesh>
        )}
        
        {/* 完成状态特效 - 星星 */}
        {status === 'completed' && (
          <group position={[0, 1.2, 0]}>
            {[0, 1, 2, 3, 4].map((i) => (
              <mesh key={i} position={[
                Math.cos(i * Math.PI * 0.4) * 0.5,
                Math.sin(i * Math.PI * 0.4) * 0.3,
                0.1
              ]}>
                <sphereGeometry args={[0.05, 8, 8]} />
                <meshBasicMaterial color="#fbbf24" />
              </mesh>
            ))}
          </group>
        )}
        
        {/* 失败状态特效 - 警告符号 */}
        {status === 'failed' && (
          <mesh position={[0, 0.8, 0.1]}>
            <ringGeometry args={[0.2, 0.25, 32]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
        )}
      </group>

      {/* 节点名称标签 - 始终面向观众 */}
      <Billboard position={[0, 2, 0]}>
        <Html center distanceFactor={8} style={{ zIndex: 10 }}>
          <div
            style={{
              backgroundColor: 'rgba(17, 24, 39, 0.95)',
              padding: '4px 12px',
              borderRadius: '6px',
              color: 'white',
              fontSize: '12px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              border: `2px solid ${color}`,
              boxShadow: `0 0 10px ${color}40`,
            }}
          >
            {node.name}
          </div>
        </Html>
      </Billboard>

      {/* 工作中的智能体 */}
      {workingAgents.length > 0 && (
        <group position={[1.5, 0, 0]}>
          {workingAgents.map((agent, index) => (
            <WorkingAgent
              key={agent.id}
              agent={agent}
              position={[0, 0, index * 0.5]}
              isWorking={isActive}
            />
          ))}
        </group>
      )}

      {/* 对话气泡 - 显示执行日志 */}
      {isActive && latestLog && (
        <Billboard position={[1.8, 1.5, 0]}>
          <Html center distanceFactor={10} style={{ zIndex: 10 }}>
            <div
              style={{
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                padding: '8px 12px',
                borderRadius: '8px',
                color: 'white',
                fontSize: '11px',
                maxWidth: '200px',
                border: '1px solid #4b5563',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              <div style={{ color: '#9ca3af', fontSize: '10px', marginBottom: '4px' }}>
                {latestLog.agentName}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {latestLog.content.length > 100 
                  ? latestLog.content.substring(0, 100) + '...' 
                  : latestLog.content}
              </div>
            </div>
          </Html>
        </Billboard>
      )}
    </group>
  );
}

// ========== 工作中的智能体组件 ==========

interface WorkingAgentProps {
  agent: Agent;
  position: [number, number, number];
  isWorking: boolean;
}

function WorkingAgent({ agent, position, isWorking }: WorkingAgentProps) {
  const meshRef = useRef<THREE.Group>(null);

  // 工作动画
  useFrame((state) => {
    if (meshRef.current && isWorking) {
      // 上下浮动
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      // 轻微旋转
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.2;
    }
  });

  return (
    <group ref={meshRef} position={position}>
      {/* 智能体身体 */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.15, 0.2, 0.4, 8]} />
        <meshStandardMaterial color="#6366f1" metalness={0.5} roughness={0.5} />
      </mesh>
      
      {/* 智能体头部 */}
      <mesh position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#818cf8" metalness={0.3} roughness={0.7} />
      </mesh>

      {/* 工作状态指示 */}
      {isWorking && (
        <mesh position={[0, 0.85, 0]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#22c55e" />
        </mesh>
      )}

      {/* 智能体名称 */}
      <Billboard position={[0, 1, 0]}>
        <Html center distanceFactor={10} style={{ zIndex: 10 }}>
          <div
            style={{
              backgroundColor: 'rgba(99, 102, 241, 0.9)',
              padding: '2px 8px',
              borderRadius: '4px',
              color: 'white',
              fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.name}
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

// ========== 连接线组件 ==========

interface ConnectionLineProps {
  start: [number, number, number];
  end: [number, number, number];
  isActive: boolean;
}

function ConnectionLine({ start, end, isActive }: ConnectionLineProps) {
  const glowRef = useRef<THREE.Mesh>(null);
  const [progress, setProgress] = useState(0);

  // 曲线路径
  const curve = useMemo(() => {
    const midY = Math.max(start[1], end[1]) + 0.5;
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(start[0], start[1], start[2]),
      new THREE.Vector3(start[0], midY, start[2]),
      new THREE.Vector3(end[0], midY, end[2]),
      new THREE.Vector3(end[0], end[1], end[2]),
    ]);
  }, [start, end]);

  // 动画
  useFrame((state) => {
    if (isActive) {
      setProgress((state.clock.elapsedTime % 2) / 2);
    }
  });

  // 获取流动球位置
  const spherePosition = useMemo(() => {
    return curve.getPoint(progress);
  }, [curve, progress]);

  const color = isActive ? '#22c55e' : '#4b5563';

  return (
    <group>
      {/* 连接线 - 使用 primitive */}
      <primitive object={new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(20)),
        new THREE.LineBasicMaterial({ color })
      )} />

      {/* 活跃状态的流动光球 */}
      {isActive && (
        <mesh ref={glowRef} position={[spherePosition.x, spherePosition.y, spherePosition.z]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      )}

      {/* 端点 */}
      <mesh position={start}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={end}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// ========== 主组件 ==========

export function WorkflowExecution3D() {
  // 从 Store 获取数据
  const workflows = useStore((state) => state.workflows);
  const currentWorkflowId = useStore((state) => state.currentWorkflowId);
  const executionInstance = useStore((state) => state.executionInstance);
  const agents = useStore((state) => state.agents);
  const executionLogs = useStore((state) => state.executionLogs);

  const workflow = workflows.find((w: Workflow) => w.id === currentWorkflowId);

  if (!workflow) return null;

  const currentNodeId = executionInstance?.currentNodeId || null;
  const executionPath = executionInstance?.executionPath || [];

  // 获取节点的工作智能体
  const getWorkingAgents = (node: WorkflowNode): Agent[] => {
    const executorIds: string[] = [];
    
    // 从 config.executor 获取执行者
    if (node.config?.executor?.executors) {
      node.config.executor.executors.forEach((exec: { type: string; id: string }) => {
        if (exec.type === 'agent') {
          executorIds.push(exec.id);
        }
      });
    }
    
    // 兼容旧版 agentId
    if (node.agentId && !executorIds.includes(node.agentId)) {
      executorIds.push(node.agentId);
    }

    return agents.filter((a: Agent) => executorIds.includes(a.id) || executorIds.includes(a.agentId || ''));
  };

  // 获取节点的执行日志
  const getNodeLogs = (nodeId: string) => {
    return executionLogs
      .filter((log: { agentId: string; agentName: string; content: string }) => {
        const node = workflow.nodes.find((n: WorkflowNode) => n.id === nodeId);
        if (!node) return false;
        // 检查日志是否属于该节点的执行者
        const nodeAgents = getWorkingAgents(node);
        return nodeAgents.some((a: Agent) => a.name === log.agentName || a.id === log.agentId);
      })
      .map((log: { agentName: string; content: string }) => ({
        agentName: log.agentName,
        content: log.content,
      }));
  };

  // 获取节点状态（统一方法）
  const getNodeStatus = (nodeId: string): NodeStatus => {
    // 当前正在执行的节点
    if (nodeId === currentNodeId) {
      return 'running';
    }
    
    // 检查是否在执行路径中，并且在当前节点之前
    const pathIndex = executionPath.indexOf(nodeId);
    const currentIndex = executionPath.indexOf(currentNodeId || '');
    
    // 在执行路径中且在当前节点之前 = 已完成
    if (pathIndex !== -1 && pathIndex < currentIndex) {
      return 'completed';
    }
    
    // 检查工作流是否已完成
    if (executionInstance?.status === 'completed') {
      // 工作流完成时，所有在执行路径中的节点都是已完成
      if (pathIndex !== -1) {
        return 'completed';
      }
    }
    
    // 检查工作流是否失败
    if (executionInstance?.status === 'failed') {
      if (nodeId === currentNodeId) {
        return 'failed';
      }
    }
    
    return 'pending';
  };

  // 里程碑数据 - 使用 config.childNodes 字段关联子节点
  const milestones = useMemo(() => {
    const groups: { id: string; name: string; nodes: WorkflowNode[]; status: NodeStatus }[] = [];
    
    // 收集所有里程碑节点
    const milestoneNodes = workflow.nodes.filter((n: WorkflowNode) => n.type === 'milestone');
    
    // 收集所有非里程碑节点（用于创建节点查找映射）
    const taskNodesMap = new Map<string, WorkflowNode>();
    workflow.nodes.filter((n: WorkflowNode) => n.type !== 'milestone').forEach((n: WorkflowNode) => {
      taskNodesMap.set(n.id, n);
    });

    if (milestoneNodes.length === 0) {
      // 没有里程碑，创建一个默认组
      groups.push({
        id: 'default',
        name: 'All Tasks',
        nodes: Array.from(taskNodesMap.values()),
        status: 'pending',
      });
    } else {
      // 有里程碑，使用 config.childNodes 字段获取子节点
      milestoneNodes.forEach((milestone) => {
        // 从 config.childNodes 获取子节点 ID 列表（里程碑节点直接在 config 下存储配置）
        const config = milestone.config as { childNodes?: string[] } | undefined;
        const childNodeIds: string[] = config?.childNodes || [];
        
        // 根据 ID 列表获取实际的节点对象
        const childNodes = childNodeIds
          .map((id: string) => taskNodesMap.get(id))
          .filter((n): n is WorkflowNode => n !== undefined);
        
        groups.push({
          id: milestone.id,
          name: milestone.name,
          nodes: childNodes,
          status: 'pending',
        });
      });
    }

    // 更新里程碑状态
    groups.forEach((group) => {
      const groupNodes = group.nodes;
      
      // 计算里程碑状态 - 修复：正确判断已完成节点
      const completedCount = groupNodes.filter((n: WorkflowNode) => {
        const nodePathIndex = executionPath.indexOf(n.id);
        // 已完成：在执行路径中
        // 如果当前有正在执行的节点（currentNodeId 不为空），还需要在当前节点之前
        // 如果 currentNodeId 为空（节点刚完成），executionPath 中所有节点都算已完成
        if (nodePathIndex === -1) return false;
        if (!currentNodeId) return true; // 没有正在执行的节点，所有在路径中的都算完成
        const currentIdx = executionPath.indexOf(currentNodeId);
        return currentIdx === -1 || nodePathIndex < currentIdx;
      }).length;
      
      const runningCount = groupNodes.filter((n: WorkflowNode) => 
        n.id === currentNodeId
      ).length;
      
      if (groupNodes.length > 0 && completedCount === groupNodes.length) {
        group.status = 'completed';
      } else if (runningCount > 0 || completedCount > 0) {
        group.status = 'running';
      }
    });

    return groups;
  }, [workflow.nodes, currentNodeId, executionPath, executionInstance?.status]);

  // 找到当前里程碑
  const currentMilestone = useMemo(() => {
    if (milestones.length === 0) return null;
    
    // 找到第一个未完成的里程碑
    const runningMilestone = milestones.find(m => m.status === 'running');
    if (runningMilestone) return runningMilestone;
    
    // 如果没有运行中的，找第一个待执行的
    const pendingMilestone = milestones.find(m => m.status === 'pending');
    if (pendingMilestone) return pendingMilestone;
    
    // 否则返回最后一个（已完成的）
    return milestones[milestones.length - 1];
  }, [milestones]);

  // 过滤节点：只显示当前里程碑下的节点
  const visibleNodes = useMemo(() => {
    // 如果没有里程碑或只有一个默认里程碑，显示所有非里程碑节点
    if (milestones.length === 1 && milestones[0].id === 'default') {
      return workflow.nodes.filter((n: WorkflowNode) => n.type !== 'milestone');
    }
    
    // 如果没有开始执行，默认显示第一个里程碑的子节点
    if (!executionInstance || executionPath.length === 0) {
      const firstMilestone = milestones[0];
      if (firstMilestone) {
        return firstMilestone.nodes;
      }
      return workflow.nodes.filter((n: WorkflowNode) => n.type !== 'milestone');
    }
    
    // 只显示当前里程碑下的节点
    if (currentMilestone) {
      return currentMilestone.nodes;
    }
    
    return workflow.nodes.filter((n: WorkflowNode) => n.type !== 'milestone');
  }, [workflow.nodes, milestones, currentMilestone, executionInstance, executionPath]);

  // 计算节点位置：当前里程碑的节点在圆形上等距分布
  const nodePositions = useMemo(() => {
    const positions: Record<string, [number, number, number]> = {};
    const radius = 4;
    
    // 只计算当前显示的节点位置（等距分布在整个圆上）
    const count = visibleNodes.length;
    
    if (count > 0) {
      visibleNodes.forEach((node: WorkflowNode, index: number) => {
        // 在整个圆上等距分布
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        positions[node.id] = [
          Math.cos(angle) * radius,
          0.5,
          Math.sin(angle) * radius,
        ];
      });
    }
    
    // 同时为所有里程碑的其他节点计算备用位置（用于动画过渡）
    milestones.forEach((milestone) => {
      milestone.nodes.forEach((node: WorkflowNode) => {
        if (!positions[node.id]) {
          // 使用节点在所有任务节点中的索引作为备用位置
          const allTaskNodes = workflow.nodes.filter((n: WorkflowNode) => n.type !== 'milestone');
          const globalIndex = allTaskNodes.findIndex(n => n.id === node.id);
          const totalCount = allTaskNodes.length;
          if (globalIndex >= 0 && totalCount > 0) {
            const angle = (globalIndex / totalCount) * Math.PI * 2 - Math.PI / 2;
            positions[node.id] = [
              Math.cos(angle) * radius,
              0.5,
              Math.sin(angle) * radius,
            ];
          }
        }
      });
    });

    return positions;
  }, [workflow.nodes, visibleNodes, milestones]);

  // 同步节点位置到 store（供 handleWorkflowEvent 使用）
  const setWorkflowNodePositions = useStore((state) => state.setWorkflowNodePositions);
  useEffect(() => {
    setWorkflowNodePositions(nodePositions);
  }, [nodePositions, setWorkflowNodePositions]);

  // 获取拆解状态
  const decompositionStates = useStore((state) => state.decompositionStates);
  
  return (
    <group>
      {/* 拆解状态可视化 */}
      {Object.entries(decompositionStates).map(([taskId, decompState]) => (
        <DecompositionStatus3D
          key={taskId}
          taskId={taskId}
          nodeId={decompState.nodeId}
          status={decompState.status}
          subTasks={decompState.subTasks}
          nodePositions={nodePositions}
        />
      ))}
      
      {/* 节点 */}
      {visibleNodes.map((node: WorkflowNode) => {
        const position = nodePositions[node.id];
        if (!position) return null;

        const status = getNodeStatus(node.id);
        const isActive = node.id === currentNodeId;
        const workingAgents = getWorkingAgents(node);
        const nodeLogs = getNodeLogs(node.id);

        return (
          <group key={node.id}>
            <CardNode
              node={node}
              position={position}
              status={status}
              isActive={isActive}
              workingAgents={workingAgents}
              executionLogs={nodeLogs}
            />
            {status === 'running' && (
              <WeldingEffect position={[position[0], position[1] + 0.5, position[2]]} active={true} />
            )}
          </group>
        );
      })}

      {/* 连接线 - 只显示当前里程碑内的边 */}
      {(() => {
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
        const visibleEdges = workflow.edges.filter(
          (edge: { source: string; target: string }) => 
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        );
        
        return visibleEdges.map((edge: { id: string; source: string; target: string }, idx: number) => {
          const sourcePos = nodePositions[edge.source];
          const targetPos = nodePositions[edge.target];
          if (!sourcePos || !targetPos) return null;

          const isActive = executionPath.includes(edge.source) && 
            (executionPath.indexOf(edge.target) === executionPath.indexOf(edge.source) + 1 ||
             executionPath.indexOf(edge.source) === executionPath.length - 1);

          return (
            <ConnectionLine
              key={`edge-${idx}`}
              start={sourcePos}
              end={targetPos}
              isActive={isActive}
            />
          );
        });
      })()}
    </group>
  );
}

// ========== 里程碑面板组件（纯 HTML 版本，用于 Canvas 外部） ==========

export interface MilestonePanelProps {
  workflow: Workflow;
  currentNodeId: string | null;
  executionPath: string[];
  className?: string;
}

export function MilestonePanel({ workflow, currentNodeId, executionPath, className = '' }: MilestonePanelProps) {
  const language = useStore((state) => state.language);
  const isZh = language === 'zh';

  // 按里程碑分组节点 - 使用与 WorkflowExecution3D 相同的逻辑
  const milestones = useMemo(() => {
    const groups: { id: string; name: string; nodes: WorkflowNode[]; status: NodeStatus }[] = [];
    
    // 收集所有里程碑节点
    const milestoneNodes = workflow.nodes.filter((n: WorkflowNode) => n.type === 'milestone');
    
    // 收集所有非里程碑节点
    const taskNodes = workflow.nodes.filter((n: WorkflowNode) => n.type !== 'milestone');

    if (milestoneNodes.length === 0) {
      // 没有里程碑，创建一个默认组
      groups.push({
        id: 'default',
        name: isZh ? '所有任务' : 'All Tasks',
        nodes: taskNodes,
        status: 'pending',
      });
    } else {
      // 有里程碑，按顺序分配子节点
      milestoneNodes.forEach((milestone) => {
        groups.push({
          id: milestone.id,
          name: milestone.name,
          nodes: [],
          status: 'pending',
        });
      });

      // 使用里程碑节点的 config.childNodes 字段获取子节点
      milestoneNodes.forEach((milestoneNode) => {
        const group = groups.find(g => g.id === milestoneNode.id);
        if (!group) return;
        
        // 从 config.childNodes 获取子节点 ID 列表
        const childNodeIds = (milestoneNode.config as { childNodes?: string[] })?.childNodes || [];
        
        // 根据 ID 找到对应的节点对象
        group.nodes = childNodeIds
          .map(nodeId => taskNodes.find(n => n.id === nodeId))
          .filter((n): n is WorkflowNode => n !== undefined);
      });
    }

    // 更新里程碑状态
    groups.forEach((group) => {
      const groupNodes = group.nodes;
      
      // 计算里程碑状态 - 使用正确的状态判断
      const currentIndex = executionPath.indexOf(currentNodeId || '');
      
      const completedCount = groupNodes.filter((n: WorkflowNode) => {
        const nodePathIndex = executionPath.indexOf(n.id);
        // 已完成：在执行路径中，且在当前节点之前
        return nodePathIndex !== -1 && nodePathIndex < currentIndex;
      }).length;
      
      const runningCount = groupNodes.filter((n: WorkflowNode) => 
        n.id === currentNodeId
      ).length;
      
      if (groupNodes.length > 0 && completedCount === groupNodes.length) {
        group.status = 'completed';
      } else if (runningCount > 0 || completedCount > 0) {
        group.status = 'running';
      }
    });

    return groups;
  }, [workflow.nodes, workflow.edges, currentNodeId, executionPath, isZh]);

  return (
    <div className={`mt-3 pt-3 border-t border-gray-700 ${className}`}>
      <div className="text-gray-400 text-xs mb-2 flex items-center gap-1">
        <span>📍</span>
        <span>{isZh ? '里程碑' : 'Milestones'}</span>
      </div>
      
      <div className="space-y-1.5 max-h-32 overflow-y-auto">
        {milestones.map((milestone) => (
          <div
            key={milestone.id}
            className={`p-2 rounded-lg transition-all ${
              milestone.status === 'running' 
                ? 'bg-indigo-600/30 border border-indigo-500' 
                : milestone.status === 'completed'
                  ? 'bg-green-600/20 border border-green-600/50'
                  : 'bg-gray-800/50 border border-gray-700'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${
                milestone.status === 'completed' ? 'bg-green-500' :
                milestone.status === 'running' ? 'bg-indigo-500 animate-pulse' :
                'bg-gray-500'
              }`} />
              <span className="text-white text-xs font-medium truncate">{milestone.name}</span>
            </div>
            
            <div className="mt-1 flex items-center gap-1">
              {milestone.nodes.slice(0, 8).map((node: WorkflowNode) => (
                <span
                  key={node.id}
                  className={`w-2 h-2 rounded-full ${
                    executionPath.includes(node.id) && node.id !== currentNodeId
                      ? 'bg-green-500'
                      : node.id === currentNodeId
                        ? 'bg-indigo-500 animate-pulse'
                        : 'bg-gray-600'
                  }`}
                  title={node.name}
                />
              ))}
              {milestone.nodes.length > 8 && (
                <span className="text-gray-500 text-[10px]">+{milestone.nodes.length - 8}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== 里程碑面板组件（3D 版本，用于 Canvas 内部） ==========

export function MilestonePanel3D({ workflow, currentNodeId, executionPath }: MilestonePanelProps) {
  const language = useStore((state) => state.language);
  const isZh = language === 'zh';

  // 按里程碑分组节点 - 使用 config.childNodes 字段
  const milestones = useMemo(() => {
    const groups: { id: string; name: string; nodes: WorkflowNode[]; status: NodeStatus }[] = [];
    
    // 收集所有里程碑节点
    const milestoneNodes = workflow.nodes.filter((n: WorkflowNode) => n.type === 'milestone');
    
    // 收集所有非里程碑节点
    const taskNodes = workflow.nodes.filter((n: WorkflowNode) => n.type !== 'milestone');

    if (milestoneNodes.length === 0) {
      // 没有里程碑，创建一个默认组
      groups.push({
        id: 'default',
        name: isZh ? '所有任务' : 'All Tasks',
        nodes: taskNodes,
        status: 'pending',
      });
    } else {
      // 有里程碑，使用 config.childNodes 字段获取子节点
      milestoneNodes.forEach((milestone) => {
        // 从 config.childNodes 获取子节点 ID 列表
        const childNodeIds: string[] = milestone.config?.childNodes || [];
        
        // 根据子节点 ID 找到对应的节点对象
        const childNodes = childNodeIds
          .map((id: string) => taskNodes.find((n: WorkflowNode) => n.id === id))
          .filter((n): n is WorkflowNode => n !== undefined);
        
        groups.push({
          id: milestone.id,
          name: milestone.name,
          nodes: childNodes,
          status: 'pending',
        });
      });
    }

    // 更新里程碑状态
    groups.forEach((group) => {
      const groupNodes = group.nodes;
      
      // 计算里程碑状态 - 使用正确的状态判断
      const currentIndex = executionPath.indexOf(currentNodeId || '');
      
      const completedCount = groupNodes.filter((n: WorkflowNode) => {
        const nodePathIndex = executionPath.indexOf(n.id);
        // 已完成：在执行路径中，且在当前节点之前
        return nodePathIndex !== -1 && nodePathIndex < currentIndex;
      }).length;
      
      const runningCount = groupNodes.filter((n: WorkflowNode) => 
        n.id === currentNodeId
      ).length;
      
      if (groupNodes.length > 0 && completedCount === groupNodes.length) {
        group.status = 'completed';
      } else if (runningCount > 0 || completedCount > 0) {
        group.status = 'running';
      }
    });

    return groups;
  }, [workflow.nodes, currentNodeId, executionPath, isZh]);

  return (
    <Html position={[-6, 3, 0]} distanceFactor={8} transform style={{ zIndex: 10 }}>
      <div
        className="bg-gray-900/95 border border-indigo-500 rounded-xl overflow-hidden shadow-2xl"
        style={{ 
          width: '220px', 
          maxHeight: '400px',
          pointerEvents: 'auto',
        }}
      >
        <div className="p-2 border-b border-gray-700">
          <h3 className="text-white font-bold text-xs">
            📍 {isZh ? '里程碑' : 'Milestones'}
          </h3>
        </div>
        
        <div className="overflow-y-auto p-1.5 space-y-1.5" style={{ maxHeight: '250px' }}>
          {milestones.map((milestone) => (
            <div
              key={milestone.id}
              className={`p-1.5 rounded-lg transition-all ${
                milestone.status === 'running' 
                  ? 'bg-indigo-600/30 border border-indigo-500' 
                  : milestone.status === 'completed'
                    ? 'bg-green-600/20 border border-green-600/50'
                    : 'bg-gray-800/50 border border-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  milestone.status === 'completed' ? 'bg-green-500' :
                  milestone.status === 'running' ? 'bg-indigo-500 animate-pulse' :
                  'bg-gray-500'
                }`} />
                <span className="text-white text-[10px] font-medium truncate">{milestone.name}</span>
              </div>
              
              <div className="mt-1 flex items-center gap-0.5">
                {milestone.nodes.slice(0, 5).map((node: WorkflowNode) => (
                  <span
                    key={node.id}
                    className={`w-1 h-1 rounded-full ${
                      executionPath.includes(node.id) && node.id !== currentNodeId
                        ? 'bg-green-500'
                        : node.id === currentNodeId
                          ? 'bg-indigo-500 animate-pulse'
                          : 'bg-gray-600'
                    }`}
                    title={node.name}
                  />
                ))}
                {milestone.nodes.length > 5 && (
                  <span className="text-gray-500 text-[8px]">+{milestone.nodes.length - 5}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Html>
  );
}

export default WorkflowExecution3D;