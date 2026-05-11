import { useRef, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorkflowNode } from '../../types';

type NodeStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'rejected';

interface WorkflowNode3DProps {
  node: WorkflowNode;
  status: NodeStatus;
  position: [number, number, number];
  isActive?: boolean;
  onClick?: () => void;
}

const statusColors: Record<NodeStatus, string> = {
  pending: '#71717a',
  running: '#f59e0b',
  waiting: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  rejected: '#f97316',
};

export function WorkflowNode3D({ 
  node, 
  status, 
  position,
  isActive = false,
  onClick 
}: WorkflowNode3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const color = statusColors[status] || statusColors.pending;
  const isGroup = node.type === 'group';
  
  useFrame((state) => {
    if (meshRef.current) {
      if (status === 'running' || status === 'waiting') {
        const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.05;
        meshRef.current.scale.setScalar(scale);
      }
      
      if (isActive) {
        meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      }
    }
  });
  
  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={onClick}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
      >
        {isGroup ? (
          <boxGeometry args={[1.5, 0.8, 1.5]} />
        ) : (
          <sphereGeometry args={[0.6, 32, 32]} />
        )}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isActive ? 0.5 : 0.2}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>
      
      <mesh position={[0, isGroup ? 0.6 : 0.8, 0]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
      </mesh>
      
      <Html
        position={[0, isGroup ? -0.7 : -0.9, 0]}
        center
        distanceFactor={10}
        style={{ pointerEvents: 'none', zIndex: 10 }}
      >
        <div style={{ 
          backgroundColor: 'rgba(17, 24, 39, 0.95)', 
          padding: '4px 8px', 
          borderRadius: '4px',
          color: 'white',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          border: '1px solid #374151'
        }}>
          {node.name}
        </div>
      </Html>
    </group>
  );
}

interface WorkflowConnectionProps {
  start: [number, number, number];
  end: [number, number, number];
  status: 'pending' | 'active' | 'completed';
}

export function WorkflowConnection({ start, end, status }: WorkflowConnectionProps) {
  const color = status === 'completed' ? '#22c55e' : 
                status === 'active' ? '#f59e0b' : '#4b5563';
  
  const points = useMemo(() => {
    const midY = (start[1] + end[1]) / 2 + 0.5;
    return [
      new THREE.Vector3(start[0], start[1], start[2]),
      new THREE.Vector3(start[0], midY, start[2]),
      new THREE.Vector3(end[0], midY, end[2]),
      new THREE.Vector3(end[0], end[1], end[2]),
    ];
  }, [start, end]);
  
  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={points.length}
            array={new Float32Array(points.flatMap(p => [p.x, p.y, p.z]))}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </line>
    </group>
  );
}

interface Workflow3DDisplayProps {
  nodes: WorkflowNode[];
  edges: { source: string; target: string }[];
  currentNodeId: string | null;
  executionPath: string[];
  status: 'idle' | 'running' | 'paused' | 'waiting_review' | 'completed' | 'failed';
  onNodeClick?: (nodeId: string) => void;
}

export function Workflow3DDisplay({
  nodes,
  edges,
  currentNodeId,
  executionPath,
  status,
  onNodeClick,
}: Workflow3DDisplayProps) {
  const radius = 4;
  
  const nodePositions = useMemo(() => {
    return nodes.map((_node, index) => {
      const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
      return [
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
      ] as [number, number, number];
    });
  }, [nodes]);
  
  const getNodeStatus = (nodeId: string): NodeStatus => {
    const pathIndex = executionPath.indexOf(nodeId);
    const currentIndex = executionPath.indexOf(currentNodeId || '');
    
    if (pathIndex === -1) return 'pending';
    if (pathIndex < currentIndex) return 'completed';
    if (nodeId === currentNodeId) {
      return status === 'waiting_review' ? 'waiting' : 'running';
    }
    return 'pending';
  };
  
  const getConnectionStatus = (source: string, target: string): 'pending' | 'active' | 'completed' => {
    const sourceIndex = executionPath.indexOf(source);
    const targetIndex = executionPath.indexOf(target);
    
    if (sourceIndex < targetIndex) return 'completed';
    if (sourceIndex === targetIndex - 1 && source === currentNodeId) return 'active';
    return 'pending';
  };
  
  return (
    <group>
      {edges.map((edge, idx) => {
        const sourceIndex = nodes.findIndex(n => n.id === edge.source);
        const targetIndex = nodes.findIndex(n => n.id === edge.target);
        
        if (sourceIndex === -1 || targetIndex === -1) return null;
        
        return (
          <WorkflowConnection
            key={`edge-${idx}`}
            start={nodePositions[sourceIndex]}
            end={nodePositions[targetIndex]}
            status={getConnectionStatus(edge.source, edge.target)}
          />
        );
      })}
      
      {nodes.map((node, index) => (
        <WorkflowNode3D
          key={node.id}
          node={node}
          position={nodePositions[index]}
          status={getNodeStatus(node.id)}
          isActive={node.id === currentNodeId}
          onClick={() => onNodeClick?.(node.id)}
        />
      ))}
    </group>
  );
}
