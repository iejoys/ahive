import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StateConfig, CoreConfig } from '../hooks/useStateConfig';
import { getEmissiveIntensity, BASE_COLOR, BASE_EMISSIVE } from '../hooks/useStateConfig';

interface AgentBodyProps {
  status: string;
  config: StateConfig;
  isOffline: boolean;
}

/**
 * 智能体躯干组件
 * 
 * 圆柱造型，金属质感
 */
export function AgentBody({ 
  status, 
  config, 
  isOffline 
}: AgentBodyProps) {
  const bodyRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  
  // 躯干尺寸
  const bodySize = useMemo(() => ({
    radius: 0.3,
    height: 0.4,
  }), []);
  
  // 颜色 - 使用配置颜色
  const color = config.color;
  const emissive = config.emissive;
  
  // 动画
  useFrame((state) => {
    if (!materialRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // 更新发光强度
    const intensity = getEmissiveIntensity(config, time);
    materialRef.current.emissiveIntensity = intensity * 0.5;
    
    // 摆动动画 (暂停状态)
    if (config.animation.sway?.enabled && bodyRef.current) {
      const { angle, period } = config.animation.sway;
      const sway = Math.sin(time * Math.PI * 2 / period) * (angle * Math.PI / 180);
      bodyRef.current.rotation.z = sway;
    }
  });
  
  return (
    <group position={[0, -0.1, 0]}>
      {/* 主躯干 - 圆柱体 */}
      <mesh ref={bodyRef}>
        <cylinderGeometry args={[bodySize.radius, bodySize.radius * 0.9, bodySize.height, 16]} />
        <meshStandardMaterial
          ref={materialRef}
          color={color}
          emissive={emissive}
          emissiveIntensity={0.3}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>
      
      {/* 核心能量舱 - 玻璃罩 */}
      <mesh position={[0, 0.05, bodySize.radius - 0.05]}>
        <boxGeometry args={[0.2, 0.3, 0.06]} />
        <meshStandardMaterial
          color="#1e293b"
          transparent
          opacity={0.5}
          metalness={0.8}
          roughness={0.1}
        />
      </mesh>
      
      {/* 核心灯阵列 */}
      <CoreLights 
        coreConfig={config.core}
        isOffline={isOffline}
        pulseSpeed={config.core.pulseSpeed}
      />
    </group>
  );
}

/**
 * 核心灯阵列组件
 */
function CoreLights({ 
  coreConfig,
  isOffline,
  pulseSpeed
}: { 
  coreConfig: CoreConfig;
  isOffline: boolean;
  pulseSpeed: number;
}) {
  const lightsRef = useRef<THREE.Mesh[]>([]);
  
  // 灯的位置 (3x2 网格)
  const lightPositions: [number, number, number][] = useMemo(() => [
    [-0.06, 0.12, 0.28],
    [0, 0.12, 0.28],
    [0.06, 0.12, 0.28],
    [-0.06, 0.04, 0.28],
    [0, 0.04, 0.28],
    [0.06, 0.04, 0.28],
  ], []);
  
  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    lightsRef.current.forEach((mesh, i) => {
      if (!mesh || !(mesh.material instanceof THREE.MeshStandardMaterial)) return;
      
      // 呼吸效果
      const phase = (i * 0.3) % 1;
      const intensity = 0.4 + Math.sin(time * Math.PI * 2 / pulseSpeed + phase) * 0.4;
      
      mesh.material.emissiveIntensity = intensity;
    });
  });
  
  // 灯颜色 - 使用配置颜色
  const lightColor = coreConfig.color;
  
  return (
    <group position={[0, 0, 0]}>
      {lightPositions.map((pos, i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) lightsRef.current[i] = el; }}
          position={pos}
        >
          <sphereGeometry args={[0.02, 8, 8]} />
          <meshStandardMaterial
            color={lightColor}
            emissive={lightColor}
            emissiveIntensity={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

export default AgentBody;