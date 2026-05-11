import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RingEyes } from './RingEyes';

interface RobotHeadProps {
  status: 'idle' | 'working' | 'paused' | 'error' | 'offline';
  isOffline: boolean;
}

/**
 * 机器人头部组件
 */
export function RobotHead({ status, isOffline }: RobotHeadProps) {
  const headGroupRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (headGroupRef.current) {
      headGroupRef.current.position.y = Math.sin(time * 1.5) * 0.01;
      headGroupRef.current.rotation.z = Math.sin(time * 0.8) * 0.02;
    }
  });
  
  return (
    <group ref={headGroupRef}>
      {/* 头部外壳 - 白色圆球 */}
      <mesh position={[0, 0.15, 0]}>
        <sphereGeometry args={[0.35, 32, 32]} />
        <meshPhysicalMaterial
          color="#FFFFFF"
          roughness={0.15}
          metalness={0.1}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>
      
      {/* 黑色面罩 - 椭圆形，贴在脸前 */}
      <mesh position={[0, 0.16, 0.26]}>
        <sphereGeometry args={[0.18, 32, 32]} />
        <meshPhysicalMaterial
          color="#0A0A0A"
          roughness={0.1}
          metalness={0.8}
          clearcoat={1}
        />
      </mesh>
      
      {/* 头部侧边装饰 */}
      <mesh position={[-0.28, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.1, 0.12, 16]} />
        <meshPhysicalMaterial color="#1A1A1A" roughness={0.2} metalness={0.6} />
      </mesh>
      <mesh position={[0.28, 0.15, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.1, 0.12, 16]} />
        <meshPhysicalMaterial color="#1A1A1A" roughness={0.2} metalness={0.6} />
      </mesh>
      
      {/* 圆环眼睛 - 在面罩前方 */}
      <RingEyes status={status} isOffline={isOffline} />
    </group>
  );
}

export default RobotHead;