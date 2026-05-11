import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HaloRingsProps {
  color?: string;
  isOffline?: boolean;
  isWorking?: boolean;
}

/**
 * 三层光轮配置 - 深海系配色
 */
const RING_CONFIGS = [
  { radius: 0.8, speed: 1, color: '#4ECDC4', opacity: 0.6 },   // 内环 - 深海青
  { radius: 1.0, speed: -0.7, color: '#00D9FF', opacity: 0.5 }, // 中环 - 海洋脉冲
  { radius: 1.2, speed: 0.5, color: '#45B7D1', opacity: 0.4 },  // 外环 - 浅海波光
];

/**
 * 三层光轮组件 - 深海系配色
 * 
 * AHIVECORE 母体的光环系统
 * - 三层不同颜色的环
 * - 不同速度和方向旋转
 * - idle: 缓慢旋转 + 深海青发光
 * - working: 快速旋转 + 海洋脉冲发光
 * - offline: 停止旋转
 */
export function HaloRings({ 
  color = '#4ECDC4', 
  isOffline = false,
  isWorking = false 
}: HaloRingsProps) {
  const ringsRef = useRef<THREE.Mesh[]>([]);
  
  // 动画
  useFrame((state) => {
    if (isOffline) return;
    
    const time = state.clock.elapsedTime;
    const speedMultiplier = isWorking ? 3 : 1;
    
    ringsRef.current.forEach((mesh, i) => {
      if (!mesh) return;
      
      const config = RING_CONFIGS[i];
      mesh.rotation.z = time * config.speed * speedMultiplier;
      
      // 工作状态颜色变化
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        if (isWorking) {
          mesh.material.color.set('#00D9FF');  // 海洋脉冲
        } else {
          mesh.material.color.set(config.color);
        }
      }
    });
  });
  
  return (
    <group position={[0, -0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
      {RING_CONFIGS.map((config, i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) ringsRef.current[i] = el; }}
        >
          <torusGeometry args={[config.radius, 0.02, 8, 64]} />
          <meshBasicMaterial
            color={isOffline ? '#2C3E50' : (isWorking ? '#00D9FF' : config.color)}
            transparent
            opacity={isOffline ? 0.15 : config.opacity}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      
      {/* 光环发光效果 */}
      {!isOffline && (
        <mesh>
          <torusGeometry args={[1.0, 0.15, 8, 64]} />
          <meshBasicMaterial
            color={isWorking ? '#00D9FF' : color}
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

export default HaloRings;