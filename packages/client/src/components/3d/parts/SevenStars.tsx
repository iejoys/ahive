import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SevenStarsProps {
  color?: string;
  isOffline?: boolean;
  isWorking?: boolean;
}

/**
 * 七星核心 - 能力映射
 */
const STAR_ABILITIES = [
  { name: 'thinking', label: '思考', position: [0, 0.15, 0.15] as [number, number, number] },
  { name: 'memory', label: '记忆', position: [-0.12, 0.05, 0.12] as [number, number, number] },
  { name: 'learning', label: '学习', position: [0.12, 0.05, 0.12] as [number, number, number] },
  { name: 'reasoning', label: '推理', position: [-0.12, -0.05, 0.12] as [number, number, number] },
  { name: 'creativity', label: '创造', position: [0.12, -0.05, 0.12] as [number, number, number] },
  { name: 'collaboration', label: '协作', position: [-0.12, -0.15, 0.12] as [number, number, number] },
  { name: 'decision', label: '决策', position: [0.12, -0.15, 0.12] as [number, number, number] },
];

/**
 * 七星核心组件 - 深海系配色
 * 
 * AHIVECORE 母体的核心能量系统
 * - 7个能量节点代表核心能力
 * - 星座连线连接各节点
 * - idle: 呼吸发光 + 微光连线
 * - working: 全亮 + 连线闪耀
 * - offline: 暗淡 + 无连线
 */
export function SevenStars({ 
  color = '#4ECDC4', 
  isOffline = false,
  isWorking = false 
}: SevenStarsProps) {
  const starsRef = useRef<THREE.Mesh[]>([]);
  const linesRef = useRef<THREE.LineSegments>(null);
  
  // 连接线位置（连接相邻的星）
  const linePositions = useMemo(() => {
    const points: number[] = [];
    
    // 顶部连接
    points.push(...STAR_ABILITIES[0].position); // thinking
    points.push(...STAR_ABILITIES[1].position); // memory
    points.push(...STAR_ABILITIES[0].position); // thinking
    points.push(...STAR_ABILITIES[2].position); // learning
    
    // 中层连接
    points.push(...STAR_ABILITIES[1].position); // memory
    points.push(...STAR_ABILITIES[2].position); // learning
    points.push(...STAR_ABILITIES[1].position); // memory
    points.push(...STAR_ABILITIES[3].position); // reasoning
    points.push(...STAR_ABILITIES[2].position); // learning
    points.push(...STAR_ABILITIES[4].position); // creativity
    
    // 底层连接
    points.push(...STAR_ABILITIES[3].position); // reasoning
    points.push(...STAR_ABILITIES[4].position); // creativity
    points.push(...STAR_ABILITIES[3].position); // reasoning
    points.push(...STAR_ABILITIES[5].position); // collaboration
    points.push(...STAR_ABILITIES[4].position); // creativity
    points.push(...STAR_ABILITIES[6].position); // decision
    points.push(...STAR_ABILITIES[5].position); // collaboration
    points.push(...STAR_ABILITIES[6].position); // decision
    
    // 垂直连接
    points.push(...STAR_ABILITIES[1].position); // memory
    points.push(...STAR_ABILITIES[3].position); // reasoning
    points.push(...STAR_ABILITIES[2].position); // learning
    points.push(...STAR_ABILITIES[4].position); // creativity
    points.push(...STAR_ABILITIES[3].position); // reasoning
    points.push(...STAR_ABILITIES[5].position); // collaboration
    points.push(...STAR_ABILITIES[4].position); // creativity
    points.push(...STAR_ABILITIES[6].position); // decision
    
    return points;
  }, []);
  
  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    // 星星动画
    starsRef.current.forEach((mesh, i) => {
      if (!mesh || !(mesh.material instanceof THREE.MeshStandardMaterial)) return;
      
      const phase = i * 0.3;
      
      if (isOffline) {
        // 离线状态：暗淡
        mesh.material.emissiveIntensity = 0.1;
        mesh.scale.setScalar(0.8);
      } else if (isWorking) {
        // 工作状态：全部点亮
        const pulse = 1.2 + Math.sin(time * 5 + phase) * 0.3;
        mesh.scale.setScalar(pulse);
        mesh.material.emissiveIntensity = 1.5 + Math.sin(time * 6 + phase) * 0.5;
      } else {
        // 空闲状态：呼吸
        const breathe = 0.9 + Math.sin(time * 2 + phase) * 0.1;
        mesh.scale.setScalar(breathe);
        mesh.material.emissiveIntensity = 0.5 + Math.sin(time * 2 + phase) * 0.2;
      }
    });
    
    // 连接线动画
    if (linesRef.current && linesRef.current.material instanceof THREE.LineBasicMaterial) {
      if (isOffline) {
        linesRef.current.visible = false;
      } else {
        linesRef.current.visible = true;
        linesRef.current.material.opacity = isWorking ? 0.8 : 0.3;
      }
    }
  });
  
  // 颜色 - 深海系配色
  const starColor = isOffline ? '#2C3E50' : (isWorking ? '#00D9FF' : color);
  
  return (
    <group position={[0, 0, 0]}>
      {/* 七颗星 */}
      {STAR_ABILITIES.map((star, i) => (
        <mesh
          key={star.name}
          ref={(el) => { if (el) starsRef.current[i] = el; }}
          position={star.position}
        >
          <octahedronGeometry args={[0.04, 0]} />
          <meshStandardMaterial
            color={starColor}
            emissive={isOffline ? '#1A3A4A' : (isWorking ? '#00D9FF' : starColor)}
            emissiveIntensity={isOffline ? 0.1 : 0.8}
            metalness={0.7}
            roughness={0.3}
            transparent={isOffline}
            opacity={isOffline ? 0.5 : 1}
          />
        </mesh>
      ))}
      
      {/* 星座连线 */}
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={linePositions.length / 3}
            array={new Float32Array(linePositions)}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial 
          color={starColor} 
          transparent 
          opacity={isOffline ? 0 : (isWorking ? 0.8 : 0.3)}
        />
      </lineSegments>
      
      {/* 中心核心 */}
      <mesh position={[0, 0, 0.1]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial
          color={starColor}
          emissive={isOffline ? '#1A3A4A' : (isWorking ? '#00D9FF' : starColor)}
          emissiveIntensity={isOffline ? 0.1 : (isWorking ? 1.2 : 0.6)}
          transparent={isOffline}
          opacity={isOffline ? 0.5 : 1}
          metalness={0.6}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

export default SevenStars;