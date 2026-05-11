import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';
import { AgentHead } from './parts/AgentHead';
import { AgentBody } from './parts/AgentBody';
import { AgentBase } from './parts/AgentBase';
import { BASE_COLOR, BASE_EMISSIVE, WORKING_COLOR, WORKING_EMISSIVE } from './hooks/useStateConfig';

interface AHIVECoreProps {
  position?: [number, number, number];
}

/**
 * AHIVECORE 母体组件
 * 
 * 直接复用小智能体组件，放大1.8倍，加头顶金色光环
 */
export function AHIVECore({ position = [0, 0, 0] }: AHIVECoreProps) {
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  
  // 母体状态
  const [status, setStatus] = useState<'idle' | 'working' | 'paused' | 'error' | 'offline'>('idle');
  const [isOffline, setIsOffline] = useState(false);
  const isWorking = status === 'working' && !isOffline;
  
  // 颜色
  const color = isWorking ? WORKING_COLOR : BASE_COLOR;
  const emissive = isWorking ? WORKING_EMISSIVE : BASE_EMISSIVE;
  
  // 配置（复用小智能体的配置结构）
  const config = useMemo(() => ({
    color,
    emissive,
    emissiveIntensity: isWorking ? { min: 0.6, max: 1.0 } : { min: 0.3, max: 0.6 },
    opacity: 1.0,
    
    eyes: {
      shape: 'open' as const,
      expression: isWorking ? 'focused' as const : 'calm' as const,
      glow: isWorking,
    },
    
    core: {
      glow: true,
      pulseSpeed: isWorking ? 0.5 : 3,
      color: emissive,
    },
    
    animation: {
      float: { enabled: true, amplitude: 0.05, period: 2 },
      rotate: isWorking ? { speed: 0.02 } : false,
    },
    
    particles: false,
    halo: { enabled: false, speed: 0, opacity: 0 },
    
    isOffline,
    interactive: true,
  }), [color, emissive, isWorking, isOffline]);

  // 浮动 + 光环旋转动画
  useFrame((state) => {
    if (!groupRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // 悬浮
    const floatY = Math.sin(time * 0.5) * 0.1;
    groupRef.current.position.y = position[1] + floatY + 0.8;
    
    // 头顶光环旋转
    if (haloRef.current) {
      haloRef.current.rotation.z = time * 0.5;
    }
  });
  
  // 放大比例
  const scale = 1.8;
  
  return (
    <group 
      ref={groupRef}
      position={[position[0], position[1] + 0.8, position[2]]}
      scale={scale}
    >
      {/* 头顶金色光环 - 在头部上方 */}
      <group position={[0, 1.15, 0]}>
        <mesh ref={haloRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.18, 0.02, 16, 32]} />
          <meshStandardMaterial
            color="#FFD700"
            emissive="#FFD700"
            emissiveIntensity={isOffline ? 0.3 : 1.5}
            metalness={0.9}
            roughness={0.1}
          />
        </mesh>
        {/* 光环上的星点 */}
        {[0, 1, 2, 3].map((i) => (
          <mesh 
            key={i} 
            position={[
              Math.cos((i * Math.PI) / 2) * 0.18,
              0,
              Math.sin((i * Math.PI) / 2) * 0.18
            ]}
          >
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshStandardMaterial
              color="#FFFFFF"
              emissive="#FFFFFF"
              emissiveIntensity={isOffline ? 0.2 : 1.2}
            />
          </mesh>
        ))}
      </group>
      
      {/* 头部 - 复用小智能体 */}
      <AgentHead 
        status={status}
        config={config}
        isOffline={isOffline}
      />
      
      {/* 躯干 - 复用小智能体 */}
      <AgentBody 
        status={status}
        config={config}
        isOffline={isOffline}
      />
      
      {/* 底座 - 复用小智能体 */}
      <AgentBase 
        config={config}
        isOffline={isOffline}
      />
      
      {/* 名字标签 */}
      <Billboard position={[0, 1.2, 0]}>
        <Html center distanceFactor={8} style={{ zIndex: 10 }}>
          <div 
            className="px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              color: '#FFD700',
              textShadow: '0 2px 4px rgba(0,0,0,0.5)',
              border: '1px solid rgba(255, 215, 0, 0.3)'
            }}
          >
            👑 AHIVECORE
          </div>
        </Html>
      </Billboard>
      
      {/* 离线警告 */}
      {isOffline && (
        <Billboard position={[0, 1.5, 0]}>
          <Html center distanceFactor={8} style={{ zIndex: 10 }}>
            <div 
              className="px-2 py-1 rounded text-xs whitespace-nowrap"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.9)',
                color: '#fff',
              }}
            >
              ⚠️ 离线
            </div>
          </Html>
        </Billboard>
      )}
    </group>
  );
}

export default AHIVECore;