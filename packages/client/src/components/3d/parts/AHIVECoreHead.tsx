import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BASE_COLOR, BASE_EMISSIVE } from '../hooks/useStateConfig';

interface AHIVECoreHeadProps {
  status: string;
  isOffline: boolean;
  color?: string;
  emissive?: string;
}

/**
 * AHIVECORE 母体头部组件 - 基于小智能体设计，放大版
 * 
 * 圆球造型 + 眼睛 + 嘴巴 + 头顶光环
 */
export function AHIVECoreHead({ 
  status, 
  isOffline,
  color = BASE_COLOR,
  emissive = BASE_EMISSIVE
}: AHIVECoreHeadProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  
  const isWorking = status === 'working' && !isOffline;
  
  // 动画
  useFrame((state) => {
    if (!materialRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // 发光强度
    if (isWorking) {
      materialRef.current.emissiveIntensity = 0.8 + Math.sin(time * 5) * 0.3;
    } else {
      materialRef.current.emissiveIntensity = 0.4 + Math.sin(time * 2) * 0.1;
    }
    
    // 光环旋转
    if (haloRef.current) {
      haloRef.current.rotation.z = time * 0.5;
    }
  });
  
  // 眼睛颜色
  const eyeColor = isOffline ? BASE_COLOR : '#4ECDC4';
  const eyeEmissive = isOffline ? BASE_EMISSIVE : (isWorking ? '#00D9FF' : '#4ECDC4');
  
  return (
    <group position={[0, 0.9, 0]}>
      {/* 主头部 - 圆球（放大版） */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.55, 32, 32]} />
        <meshStandardMaterial
          ref={materialRef}
          color={color}
          emissive={emissive}
          emissiveIntensity={0.4}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
      
      {/* 头顶光环 - 浮在头顶上方 */}
      <group position={[0, 0.85, 0]}>
        <mesh ref={haloRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.25, 0.025, 16, 32]} />
          <meshStandardMaterial
            color={isWorking ? '#00D9FF' : '#FFD700'}
            emissive={isWorking ? '#00D9FF' : '#FFD700'}
            emissiveIntensity={isOffline ? 0.3 : 1.2}
            metalness={0.9}
            roughness={0.1}
          />
        </mesh>
        {/* 光环上的小星点 */}
        {[0, 1, 2, 3].map((i) => (
          <mesh 
            key={i} 
            position={[
              Math.cos((i * Math.PI) / 2) * 0.25,
              0,
              Math.sin((i * Math.PI) / 2) * 0.25
            ]}
          >
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial
              color="#FFFFFF"
              emissive="#FFFFFF"
              emissiveIntensity={isOffline ? 0.2 : 1}
            />
          </mesh>
        ))}
      </group>
      
      {/* 眼睛 */}
      <group position={[0, 0.05, 0]}>
        {/* 左眼 */}
        <mesh position={[-0.2, 0.05, 0.48]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial
            color={eyeColor}
            emissive={eyeEmissive}
            emissiveIntensity={isOffline ? 0.2 : 0.8}
          />
        </mesh>
        {/* 左眼瞳孔 */}
        <mesh position={[-0.2, 0.05, 0.56]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial
            color={isOffline ? '#2C3E50' : '#1A3A4A'}
            emissive={eyeEmissive}
            emissiveIntensity={isOffline ? 0.3 : 1}
          />
        </mesh>
        
        {/* 右眼 */}
        <mesh position={[0.2, 0.05, 0.48]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial
            color={eyeColor}
            emissive={eyeEmissive}
            emissiveIntensity={isOffline ? 0.2 : 0.8}
          />
        </mesh>
        {/* 右眼瞳孔 */}
        <mesh position={[0.2, 0.05, 0.56]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial
            color={isOffline ? '#2C3E50' : '#1A3A4A'}
            emissive={eyeEmissive}
            emissiveIntensity={isOffline ? 0.3 : 1}
          />
        </mesh>
        
        {/* 离线时闭眼 */}
        {isOffline && (
          <>
            <mesh position={[-0.2, 0.05, 0.58]}>
              <boxGeometry args={[0.15, 0.02, 0.01]} />
              <meshStandardMaterial color="#2C3E50" emissive="#2C3E50" emissiveIntensity={0.3} />
            </mesh>
            <mesh position={[0.2, 0.05, 0.58]}>
              <boxGeometry args={[0.15, 0.02, 0.01]} />
              <meshStandardMaterial color="#2C3E50" emissive="#2C3E50" emissiveIntensity={0.3} />
            </mesh>
          </>
        )}
      </group>
      
      {/* 嘴巴状态条 */}
      <mesh position={[0, -0.15, 0.5]}>
        <boxGeometry args={[0.25, 0.03, 0.02]} />
        <meshStandardMaterial 
          color={isOffline ? BASE_COLOR : (isWorking ? '#22c55e' : emissive)}
          emissive={isOffline ? BASE_EMISSIVE : (isWorking ? '#22c55e' : emissive)}
          emissiveIntensity={0.5}
        />
      </mesh>
    </group>
  );
}

export default AHIVECoreHead;