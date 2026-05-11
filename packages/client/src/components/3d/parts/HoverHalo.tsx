import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface HoverHaloProps {
  status: 'idle' | 'working' | 'paused' | 'error' | 'offline';
  isOffline: boolean;
  isSelected?: boolean;
}

/**
 * 悬浮光环组件 - 可爱机器人风格
 * 
 * 底部光环，产生漂浮效果
 * 选中时显示流动光圈动画
 */
export function HoverHalo({ status, isOffline, isSelected = false }: HoverHaloProps) {
  const haloGroupRef = useRef<THREE.Group>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const pulseRingsRef = useRef<THREE.Mesh[]>([]);
  
  // 光环颜色配置
  const haloColors = useMemo(() => ({
    idle: { ring: '#00D4FF', glow: '#00A8CC' },
    working: { ring: '#00FF88', glow: '#00CC6A' },
    paused: { ring: '#FFD700', glow: '#CCAA00' },
    error: { ring: '#FF4444', glow: '#CC0000' },
    offline: { ring: '#444444', glow: '#222222' },
    selected: { ring: '#FFD700', glow: '#FFA500' },
  }), []);
  
  const colors = isSelected ? haloColors.selected : (isOffline ? haloColors.offline : haloColors[status]);
  
  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    if (haloGroupRef.current) {
      // 光环缓慢旋转
      const rotationSpeed = isSelected ? 1.5 : (status === 'working' ? 2 : (status === 'paused' ? 0.3 : 0.5));
      haloGroupRef.current.rotation.y = time * rotationSpeed;
    }
    
    // 呼吸效果
    const breathe = 0.5 + Math.sin(time * 2) * 0.15;
    
    if (glowRef.current && glowRef.current.material instanceof THREE.MeshBasicMaterial) {
      glowRef.current.material.opacity = breathe * (isOffline ? 0.2 : 0.4);
    }
    
    // 选中时的扩散光环动画
    if (isSelected) {
      pulseRingsRef.current.forEach((ring, i) => {
        if (ring && ring.material instanceof THREE.MeshBasicMaterial) {
          const phase = (time * 2 + i * 0.4) % 1;
          const scale = 0.8 + phase * 0.8;
          ring.scale.setScalar(scale);
          ring.material.opacity = 0.8 * (1 - phase);
        }
      });
    }
  });
  
  return (
    <group ref={haloGroupRef} position={[0, -0.55, 0]}>
      {/* 内环 - 发光环 */}
      <mesh ref={innerRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.28, 0.015, 16, 48]} />
        <meshBasicMaterial 
          color={colors.ring}
          toneMapped={false}
        />
      </mesh>
      
      {/* 外环 - 装饰环 */}
      <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.35, 0.008, 16, 48]} />
        <meshStandardMaterial 
          color={colors.glow}
          roughness={0.3}
          metalness={0.7}
          transparent
          opacity={0.6}
        />
      </mesh>
      
      {/* 底部光晕 */}
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.35, 32]} />
        <meshBasicMaterial 
          color={colors.glow}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      
      {/* 选中时的扩散光环 */}
      {isSelected && [0, 1, 2, 3].map((i) => (
        <mesh 
          key={i} 
          ref={(el) => { if (el) pulseRingsRef.current[i] = el; }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.4, 0.45, 64]} />
          <meshBasicMaterial 
            color="#FFD700" 
            transparent 
            opacity={0.8} 
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      
      {/* 地面投影 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial 
          color="#000000"
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

export default HoverHalo;