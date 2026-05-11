import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ParticleWaterfallProps {
  color?: string;
  isOffline?: boolean;
  isWorking?: boolean;
  count?: number;
}

/**
 * 粒子瀑布组件
 * 
 * AHIVECORE 母体的数据流粒子效果
 * - 从上往下流动的粒子
 * - idle: 柔和下落
 * - working: 密集瀑布
 * - offline: 无粒子
 */
export function ParticleWaterfall({ 
  color = '#6366f1', 
  isOffline = false,
  isWorking = false,
  count = 200 
}: ParticleWaterfallProps) {
  const particlesRef = useRef<THREE.Points>(null);
  
  // 粒子初始位置和速度
  const particleData = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      initialY: Math.random() * 1.5 - 0.5,
      speed: 0.3 + Math.random() * 0.3,
      radius: 0.3 + Math.random() * 1.0,
      angle: Math.random() * Math.PI * 2,
      size: 0.01 + Math.random() * 0.02,
    }));
  }, [count]);
  
  // 粒子位置数组
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    particleData.forEach((p, i) => {
      pos[i * 3] = Math.cos(p.angle) * p.radius;
      pos[i * 3 + 1] = p.initialY;
      pos[i * 3 + 2] = Math.sin(p.angle) * p.radius;
    });
    return pos;
  }, [particleData, count]);
  
  // 动画
  useFrame((state) => {
    if (!particlesRef.current || isOffline) return;
    
    const geometry = particlesRef.current.geometry;
    const positionAttribute = geometry.getAttribute('position');
    const time = state.clock.elapsedTime;
    const speedMultiplier = isWorking ? 2 : 1;
    
    particleData.forEach((p, i) => {
      // 下落
      let y = positionAttribute.getY(i);
      y -= p.speed * speedMultiplier * 0.02;
      
      // 重置到顶部
      if (y < -0.5) {
        y = 1.0 + Math.random() * 0.5;
      }
      
      positionAttribute.setY(i, y);
      
      // 轻微旋转
      const angle = p.angle + time * 0.2;
      positionAttribute.setX(i, Math.cos(angle) * p.radius);
      positionAttribute.setZ(i, Math.sin(angle) * p.radius);
    });
    
    positionAttribute.needsUpdate = true;
  });
  
  // 离线时不显示
  if (isOffline) return null;
  
  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={isWorking ? '#22c55e' : color}
        size={0.03}
        transparent
        opacity={isWorking ? 0.8 : 0.5}
        sizeAttenuation
      />
    </points>
  );
}

export default ParticleWaterfall;