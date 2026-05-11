import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { StateConfig } from '../hooks/useStateConfig';
import { getEmissiveIntensity, BASE_COLOR, BASE_EMISSIVE } from '../hooks/useStateConfig';
import { Eyes } from './Eyes';

interface AgentHeadProps {
  status: string;
  config: StateConfig;
  isOffline: boolean;
  isSelected?: boolean;
}

/**
 * 智能体头部组件
 * 
 * 圆球造型，金属质感
 */
export function AgentHead({ 
  status, 
  config, 
  isOffline,
  isSelected = false 
}: AgentHeadProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  
  // 颜色和发光
  const color = useMemo(() => {
    if (isSelected) return '#f59e0b';  // 选中时金色
    return config.color;
  }, [isSelected, config.color]);
  
  const emissive = useMemo(() => {
    if (isSelected) return '#f59e0b';
    return config.emissive;
  }, [isSelected, config.emissive]);
  
  // 动画更新
  useFrame((state) => {
    if (!materialRef.current) return;
    
    // 更新发光强度
    const time = state.clock.elapsedTime;
    const intensity = getEmissiveIntensity(config, time);
    
    if (isSelected) {
      materialRef.current.emissiveIntensity = 1.5;
    } else {
      materialRef.current.emissiveIntensity = intensity;
    }
    
    // 抖动动画 (错误状态)
    if (config.animation.shake?.enabled && meshRef.current) {
      const { amplitude, period } = config.animation.shake;
      const shake = Math.sin(time * Math.PI * 2 / period) * amplitude;
      meshRef.current.position.x = shake;
    }
  });
  
  return (
    <group position={[0, 0.5, 0]}>
      {/* 主头部 - 圆球 */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.45, 32, 32]} />
        <meshStandardMaterial
          ref={materialRef}
          color={color}
          emissive={emissive}
          emissiveIntensity={0.4}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
      
      {/* 选中光环 */}
      {isSelected && (
        <mesh scale={1.2}>
          <sphereGeometry args={[0.45, 32, 32]} />
          <meshStandardMaterial
            color="#f59e0b"
            emissive="#f59e0b"
            emissiveIntensity={2}
            transparent
            opacity={0.3}
          />
        </mesh>
      )}
      
      {/* 眼睛 */}
      <Eyes 
        config={config.eyes}
        isOffline={isOffline}
        status={status}
        position={[0, 0.05, 0.35]}
        scale={1}
      />
      
      {/* 嘴巴状态条 */}
      <MouthBar 
        status={status}
        isOffline={isOffline}
        position={[0, -0.15, 0.38]}
      />
    </group>
  );
}

/**
 * 嘴巴状态条
 */
function MouthBar({ 
  status, 
  isOffline,
  position 
}: { 
  status: string;
  isOffline: boolean;
  position: [number, number, number];
}) {
  const barRef = useRef<THREE.Mesh>(null);
  
  // 嘴巴颜色 - 根据状态
  const barColor = useMemo(() => {
    if (isOffline) return BASE_COLOR;  // 离线保持银色
    switch (status) {
      case 'working': return '#22c55e';
      case 'paused': return '#f59e0b';
      case 'error': return '#ef4444';
      default: return BASE_EMISSIVE;
    }
  }, [status, isOffline]);
  
  // 动画
  useFrame((state) => {
    if (!barRef.current || isOffline) return;
    
    const t = state.clock.elapsedTime;
    
    // 工作状态：嘴巴脉冲
    if (status === 'working') {
      const pulse = 0.8 + Math.sin(t * 4) * 0.2;
      barRef.current.scale.x = pulse;
    }
    
    // 错误状态：嘴巴闪烁
    if (status === 'error') {
      const blink = Math.sin(t * 8) > 0 ? 1 : 0.5;
      if (barRef.current.material instanceof THREE.MeshStandardMaterial) {
        barRef.current.material.emissiveIntensity = blink;
      }
    }
  });
  
  return (
    <mesh ref={barRef} position={position}>
      <boxGeometry args={[0.15, 0.025, 0.02]} />
      <meshStandardMaterial 
        color={barColor}
        emissive={isOffline ? BASE_EMISSIVE : barColor}
        emissiveIntensity={isOffline ? 0.2 : 0.5}
      />
    </mesh>
  );
}

export default AgentHead;