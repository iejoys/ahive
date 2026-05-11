import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EyeConfig } from '../hooks/useStateConfig';
import { BASE_EMISSIVE } from '../hooks/useStateConfig';

interface EyesProps {
  config: EyeConfig;
  isOffline: boolean;
  status: string;
  position?: [number, number, number];
  scale?: number;
}

/**
 * 眼睛系统组件 - 深海系配色
 */
export function Eyes({ 
  config, 
  isOffline, 
  status,
  position = [0, 0.15, 0.4],
  scale = 1 
}: EyesProps) {
  const { shape, glow, color } = config;
  
  const leftEyePos: [number, number, number] = [position[0] - 0.15, position[1], position[2]];
  const rightEyePos: [number, number, number] = [position[0] + 0.15, position[1], position[2]];
  
  return (
    <group scale={scale}>
      {shape === 'open' && (
        <OpenEyes 
          leftPos={leftEyePos} 
          rightPos={rightEyePos}
          glow={glow}
          isWorking={status === 'working'}
        />
      )}
      
      {shape === 'half-open' && (
        <HalfOpenEyes 
          leftPos={leftEyePos} 
          rightPos={rightEyePos}
        />
      )}
      
      {shape === 'closed' && (
        <ClosedEyes 
          leftPos={leftEyePos} 
          rightPos={rightEyePos}
        />
      )}
      
      {shape === 'x' && (
        <XEyes 
          leftPos={leftEyePos} 
          rightPos={rightEyePos}
          color={color || '#FF6B9D'}
        />
      )}
    </group>
  );
}

/**
 * 睁眼状态 - 深海系配色
 */
function OpenEyes({ 
  leftPos, 
  rightPos, 
  glow,
  isWorking 
}: { 
  leftPos: [number, number, number]; 
  rightPos: [number, number, number];
  glow: boolean;
  isWorking: boolean;
}) {
  const pupilRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (pupilRef.current && isWorking) {
      const t = state.clock.elapsedTime;
      pupilRef.current.position.x = Math.sin(t * 3) * 0.02;
    }
  });
  
  // 深海系配色：工作时海洋脉冲，默认深海青
  const eyeColor = glow ? '#00D9FF' : '#4ECDC4';
  const pupilColor = glow ? '#00A8CC' : '#1A3A4A';
  
  return (
    <>
      <group position={leftPos}>
        <mesh>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial 
            color={eyeColor} 
            emissive={glow ? '#00D9FF' : '#4ECDC4'}
            emissiveIntensity={glow ? 0.6 : 0.3}
          />
        </mesh>
        <mesh ref={pupilRef} position={[0, 0, 0.06]}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial 
            color={pupilColor}
            emissive={glow ? '#00D9FF' : '#4ECDC4'}
            emissiveIntensity={glow ? 1 : 0.4}
          />
        </mesh>
      </group>
      
      <group position={rightPos}>
        <mesh>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial 
            color={eyeColor} 
            emissive={glow ? '#00D9FF' : '#4ECDC4'}
            emissiveIntensity={glow ? 0.6 : 0.3}
          />
        </mesh>
        <mesh position={[0, 0, 0.06]}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial 
            color={pupilColor}
            emissive={glow ? '#00D9FF' : '#4ECDC4'}
            emissiveIntensity={glow ? 1 : 0.4}
          />
        </mesh>
      </group>
    </>
  );
}

/**
 * 半闭眼状态 - 深海系配色
 */
function HalfOpenEyes({ 
  leftPos, 
  rightPos 
}: { 
  leftPos: [number, number, number]; 
  rightPos: [number, number, number];
}) {
  return (
    <>
      <group position={leftPos}>
        <mesh scale={[1, 0.5, 1]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#4ECDC4" emissive="#4ECDC4" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.06]}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshStandardMaterial color="#1A3A4A" />
        </mesh>
        <mesh position={[0, 0.05, 0.02]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.18, 0.04, 0.06]} />
          <meshStandardMaterial color="#2C3E50" transparent opacity={0.6} />
        </mesh>
      </group>
      
      <group position={rightPos}>
        <mesh scale={[1, 0.5, 1]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#4ECDC4" emissive="#4ECDC4" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.06]}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshStandardMaterial color="#1A3A4A" />
        </mesh>
        <mesh position={[0, 0.05, 0.02]} rotation={[0.3, 0, 0]}>
          <boxGeometry args={[0.18, 0.04, 0.06]} />
          <meshStandardMaterial color="#2C3E50" transparent opacity={0.6} />
        </mesh>
      </group>
    </>
  );
}

/**
 * 闭眼状态 (离线) - 深海系配色
 */
function ClosedEyes({ 
  leftPos, 
  rightPos 
}: { 
  leftPos: [number, number, number]; 
  rightPos: [number, number, number];
}) {
  return (
    <>
      <mesh position={[leftPos[0], leftPos[1], leftPos[2] + 0.02]}>
        <boxGeometry args={[0.12, 0.02, 0.02]} />
        <meshStandardMaterial 
          color={BASE_EMISSIVE}
          emissive={BASE_EMISSIVE}
          emissiveIntensity={0.3}
        />
      </mesh>
      
      <mesh position={[rightPos[0], rightPos[1], rightPos[2] + 0.02]}>
        <boxGeometry args={[0.12, 0.02, 0.02]} />
        <meshStandardMaterial 
          color={BASE_EMISSIVE}
          emissive={BASE_EMISSIVE}
          emissiveIntensity={0.3}
        />
      </mesh>
    </>
  );
}

/**
 * X形眼睛 (错误状态) - 深海系配色，珊瑚警报
 */
function XEyes({ 
  leftPos, 
  rightPos,
  color 
}: { 
  leftPos: [number, number, number]; 
  rightPos: [number, number, number];
  color: string;
}) {
  const leftRef = useRef<THREE.Group>(null);
  const rightRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const intensity = 0.5 + Math.sin(t * 10) * 0.5;
    
    if (leftRef.current) {
      leftRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = intensity;
        }
      });
    }
    if (rightRef.current) {
      rightRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = intensity;
        }
      });
    }
  });
  
  return (
    <>
      <group ref={leftRef} position={leftPos}>
        <mesh position={[0, 0, 0.03]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.12, 0.025, 0.025]} />
          <meshStandardMaterial 
            color={color} 
            emissive={color}
            emissiveIntensity={1}
          />
        </mesh>
        <mesh position={[0, 0, 0.03]} rotation={[0, 0, -Math.PI / 4]}>
          <boxGeometry args={[0.12, 0.025, 0.025]} />
          <meshStandardMaterial 
            color={color} 
            emissive={color}
            emissiveIntensity={1}
          />
        </mesh>
      </group>
      
      <group ref={rightRef} position={rightPos}>
        <mesh position={[0, 0, 0.03]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.12, 0.025, 0.025]} />
          <meshStandardMaterial 
            color={color} 
            emissive={color}
            emissiveIntensity={1}
          />
        </mesh>
        <mesh position={[0, 0, 0.03]} rotation={[0, 0, -Math.PI / 4]}>
          <boxGeometry args={[0.12, 0.025, 0.025]} />
          <meshStandardMaterial 
            color={color} 
            emissive={color}
            emissiveIntensity={1}
          />
        </mesh>
      </group>
    </>
  );
}

export default Eyes;