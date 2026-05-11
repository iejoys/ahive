import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface RobotBodyProps {
  status: 'idle' | 'working' | 'paused' | 'error' | 'offline';
  isOffline: boolean;
}

/**
 * 机器人躯干组件 - 可爱机器人风格
 * 
 * 白色蛋形体，圆润可爱
 */
export function RobotBody({ status, isOffline }: RobotBodyProps) {
  const bodyRef = useRef<THREE.Mesh>(null);
  
  // 微浮动动画（与头部同步）
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    if (bodyRef.current) {
      // 轻微呼吸浮动
      bodyRef.current.position.y = Math.sin(time * 1.5) * 0.01;
      bodyRef.current.rotation.z = Math.sin(time * 0.8) * 0.015;
    }
  });
  
  return (
    <group position={[0, -0.25, 0]}>
      {/* 主躯干 - 蛋形体 */}
      <mesh ref={bodyRef}>
        <sphereGeometry args={[0.25, 32, 32]} />
        <meshPhysicalMaterial
          color="#FFFFFF"
          roughness={0.15}
          metalness={0.1}
          clearcoat={1}
          clearcoatRoughness={0.1}
          reflectivity={0.5}
          ior={1.5}
          thickness={0.5}
        />
      </mesh>
      
      {/* 胸口状态指示灯 */}
      
      {/* 胸口状态指示灯 */}
      <mesh position={[0, 0.12, 0.22]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial
          color={isOffline ? '#444444' : (status === 'working' ? '#00FF88' : '#00D4FF')}
          emissive={isOffline ? '#222222' : (status === 'working' ? '#00FF88' : '#00D4FF')}
          emissiveIntensity={isOffline ? 0.2 : (status === 'working' ? 0.8 : 0.5)}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export default RobotBody;