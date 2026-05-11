import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StateConfig } from '../hooks/useStateConfig';
import { BASE_COLOR, BASE_EMISSIVE } from '../hooks/useStateConfig';

interface AgentBaseProps {
  config: StateConfig;
  isOffline: boolean;
}

/**
 * 智能体悬浮底座组件
 * 
 * 圆盘造型，金属质感
 */
export function AgentBase({ 
  config, 
  isOffline 
}: AgentBaseProps) {
  const ringRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  
  // 底座颜色 - 使用配置颜色
  const baseColor = config.color;
  
  // 光环配置
  const haloConfig = config.halo;
  
  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    // 光环旋转
    if (haloConfig.enabled && haloRef.current) {
      haloRef.current.rotation.z = time * haloConfig.speed;
    }
  });
  
  return (
    <group position={[0, -0.45, 0]}>
      {/* 主底座 - 圆盘 */}
      <mesh>
        <cylinderGeometry args={[0.25, 0.3, 0.08, 16]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={config.emissive}
          emissiveIntensity={0.2}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>
      
      {/* 悬浮环 - 外圈 */}
      <mesh ref={ringRef} position={[0, 0.04, 0]}>
        <torusGeometry args={[0.2, 0.015, 8, 32]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={config.emissive}
          emissiveIntensity={0.4}
          transparent
          opacity={0.8}
        />
      </mesh>
      
      {/* 悬浮环 - 内圈 */}
      <mesh position={[0, 0.02, 0]}>
        <torusGeometry args={[0.12, 0.01, 8, 24]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={config.emissive}
          emissiveIntensity={0.3}
          transparent
          opacity={0.6}
        />
      </mesh>
      
      {/* 光环 - 状态指示环 (工作时显示) */}
      {haloConfig.enabled && (
        <mesh ref={haloRef} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <ringGeometry args={[0.35, 0.4, 32]} />
          <meshBasicMaterial
            color={baseColor}
            transparent
            opacity={haloConfig.opacity}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * 状态指示环组件
 */
export function StatusRing({ 
  status, 
  isOffline,
  position = [0, -0.5, 0]
}: { 
  status: string;
  isOffline: boolean;
  position?: [number, number, number];
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  
  // 颜色 - 使用基础色
  const ringColor = BASE_COLOR;
  
  // 动画
  useFrame((state) => {
    if (!ringRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // 工作状态：脉冲
    if (status === 'working') {
      const pulse = 0.5 + Math.sin(time * 4) * 0.2;
      if (ringRef.current.material instanceof THREE.MeshBasicMaterial) {
        ringRef.current.material.opacity = pulse;
      }
    }
  });
  
  return (
    <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} position={position}>
      <ringGeometry args={[0.35, 0.4, 32]} />
      <meshBasicMaterial
        color={ringColor}
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export default AgentBase;