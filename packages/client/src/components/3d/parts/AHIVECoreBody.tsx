import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BASE_COLOR, BASE_EMISSIVE } from '../hooks/useStateConfig';

interface AHIVECoreBodyProps {
  status: string;
  isOffline: boolean;
  color?: string;
  emissive?: string;
}

/**
 * AHIVECORE 母体身体组件 - 蛋形设计 + 手臂
 * 参考小智能体设计，放大版
 */
export function AHIVECoreBody({ 
  status, 
  isOffline,
  color = BASE_COLOR,
  emissive = BASE_EMISSIVE
}: AHIVECoreBodyProps) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  
  const isWorking = status === 'working' && !isOffline;
  
  // 动画
  useFrame((state) => {
    if (!materialRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // 发光强度
    if (isWorking) {
      materialRef.current.emissiveIntensity = 0.6 + Math.sin(time * 5) * 0.2;
    } else {
      materialRef.current.emissiveIntensity = 0.3 + Math.sin(time * 2) * 0.1;
    }
    
    // 手臂轻微摆动
    if (leftArmRef.current && rightArmRef.current) {
      const swing = Math.sin(time * 2) * 0.1;
      leftArmRef.current.rotation.z = -0.15 + swing;
      rightArmRef.current.rotation.z = 0.15 - swing;
    }
  });
  
  return (
    <group position={[0, -0.3, 0]}>
      {/* 主躯干 - 蛋形（椭球） */}
      <mesh>
        <sphereGeometry args={[0.45, 32, 32]} />
        <meshStandardMaterial
          ref={materialRef}
          color={color}
          emissive={emissive}
          emissiveIntensity={0.4}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>
      
      {/* 核心能量区 - 玻璃罩 */}
      <mesh position={[0, 0, 0.35]}>
        <boxGeometry args={[0.25, 0.35, 0.06]} />
        <meshStandardMaterial
          color="#0A1628"
          transparent
          opacity={0.5}
          metalness={0.8}
          roughness={0.1}
        />
      </mesh>
      
      {/* 核心灯阵列 */}
      <CoreLights 
        isOffline={isOffline}
        isWorking={isWorking}
        emissiveColor={emissive}
      />
      
      {/* 左手臂 */}
      <group ref={leftArmRef} position={[-0.5, 0.15, 0]}>
        <mesh position={[0, 0, 0]} rotation={[0, 0, 0.3]}>
          <capsuleGeometry args={[0.06, 0.2, 8, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.3}
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[-0.12, -0.2, 0]} rotation={[0, 0, 0.5]}>
          <capsuleGeometry args={[0.045, 0.15, 8, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.3}
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[-0.2, -0.38, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.4}
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
      </group>
      
      {/* 右手臂 */}
      <group ref={rightArmRef} position={[0.5, 0.15, 0]}>
        <mesh position={[0, 0, 0]} rotation={[0, 0, -0.3]}>
          <capsuleGeometry args={[0.06, 0.2, 8, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.3}
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[0.12, -0.2, 0]} rotation={[0, 0, -0.5]}>
          <capsuleGeometry args={[0.045, 0.15, 8, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.3}
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[0.2, -0.38, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={0.4}
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
      </group>
    </group>
  );
}

/**
 * 核心灯阵列组件
 */
function CoreLights({ 
  isOffline,
  isWorking,
  emissiveColor
}: { 
  isOffline: boolean;
  isWorking: boolean;
  emissiveColor: string;
}) {
  const lightsRef = useRef<THREE.Mesh[]>([]);
  
  const lightPositions: [number, number, number][] = [
    [-0.06, 0.1, 0.4],
    [0, 0.1, 0.4],
    [0.06, 0.1, 0.4],
    [-0.06, 0.03, 0.4],
    [0, 0.03, 0.4],
    [0.06, 0.03, 0.4],
    [-0.06, -0.04, 0.4],
    [0, -0.04, 0.4],
    [0.06, -0.04, 0.4],
  ];
  
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    lightsRef.current.forEach((mesh, i) => {
      if (!mesh || !(mesh.material instanceof THREE.MeshStandardMaterial)) return;
      
      const phase = (i * 0.3) % 1;
      const intensity = isOffline ? 0.2 : 0.5 + Math.sin(time * 3 + phase) * 0.4;
      
      mesh.material.emissiveIntensity = intensity;
    });
  });
  
  const lightColor = isWorking ? '#00D9FF' : emissiveColor;
  
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
            color={isOffline ? BASE_COLOR : lightColor}
            emissive={isOffline ? BASE_EMISSIVE : lightColor}
            emissiveIntensity={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

export default AHIVECoreBody;