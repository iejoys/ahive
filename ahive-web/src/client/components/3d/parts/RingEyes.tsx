import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface RingEyesProps {
  status: 'idle' | 'working' | 'paused' | 'error' | 'offline';
  isOffline: boolean;
}

/**
 * 圆环眼睛状态颜色配置
 */
const EYE_COLORS = {
  idle: { ring: '#00D4FF', iris: '#00A8CC' },
  working: { ring: '#00FF88', iris: '#00CC6A' },
  paused: { ring: '#FFD700', iris: '#CCAA00' },
  error: { ring: '#FF4444', iris: '#CC0000' },
  offline: { ring: '#666666', iris: '#444444' },
};

/**
 * 圆环眼睛组件 - 可爱机器人风格
 */
export function RingEyes({ status, isOffline }: RingEyesProps) {
  const leftRingRef = useRef<THREE.Mesh>(null);
  const rightRingRef = useRef<THREE.Mesh>(null);
  
  const actualStatus = isOffline ? 'offline' : status;
  const colors = EYE_COLORS[actualStatus];
  
  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const blinkSpeed = actualStatus === 'working' ? 4 : (actualStatus === 'paused' ? 1 : 2);
    
    [leftRingRef.current, rightRingRef.current].forEach(ref => {
      if (ref && ref.material instanceof THREE.MeshBasicMaterial) {
        ref.material.color.set(colors.ring);
      }
    });
  });
  
  // 眼睛配置 - 面罩中心 Z=0.26，半径 0.18，最前端 = 0.44
  // 眼睛必须在 Z > 0.44 才能不被遮挡
  const eyeSpacing = 0.10;      // 眼间距
  const eyeY = 0.18;            // Y位置
  const eyeZ = 0.46;            // Z位置 - 在面罩前方！
  const eyeRadius = 0.048;      // 眼睛半径
  const pupilRadius = 0.034;    // 瞳孔半径
  
  // 离线时显示闭眼
  if (actualStatus === 'offline') {
    return (
      <group position={[0, eyeY, eyeZ]}>
        <mesh position={[-eyeSpacing, 0, 0]}>
          <boxGeometry args={[0.07, 0.01, 0.01]} />
          <meshBasicMaterial color="#666666" />
        </mesh>
        <mesh position={[eyeSpacing, 0, 0]}>
          <boxGeometry args={[0.07, 0.01, 0.01]} />
          <meshBasicMaterial color="#666666" />
        </mesh>
      </group>
    );
  }
  
  return (
    <group position={[0, eyeY, eyeZ]}>
      {/* 左眼圆环 */}
      <mesh ref={leftRingRef} position={[-eyeSpacing, 0, 0]}>
        <torusGeometry args={[eyeRadius, 0.01, 16, 32]} />
        <meshBasicMaterial color={colors.ring} toneMapped={false} />
      </mesh>
      
      {/* 左眼白色眼白 */}
      <mesh position={[-eyeSpacing, 0, 0.003]}>
        <circleGeometry args={[pupilRadius, 32]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      
      {/* 左眼虹膜 */}
      <mesh position={[-eyeSpacing, 0, 0.005]}>
        <circleGeometry args={[pupilRadius * 0.6, 32]} />
        <meshBasicMaterial color={colors.iris} />
      </mesh>
      
      {/* 左眼高光 */}
      <mesh position={[-eyeSpacing + 0.01, 0.01, 0.007]}>
        <circleGeometry args={[0.006, 16]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      
      {/* 右眼圆环 */}
      <mesh ref={rightRingRef} position={[eyeSpacing, 0, 0]}>
        <torusGeometry args={[eyeRadius, 0.01, 16, 32]} />
        <meshBasicMaterial color={colors.ring} toneMapped={false} />
      </mesh>
      
      {/* 右眼白色眼白 */}
      <mesh position={[eyeSpacing, 0, 0.003]}>
        <circleGeometry args={[pupilRadius, 32]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      
      {/* 右眼虹膜 */}
      <mesh position={[eyeSpacing, 0, 0.005]}>
        <circleGeometry args={[pupilRadius * 0.6, 32]} />
        <meshBasicMaterial color={colors.iris} />
      </mesh>
      
      {/* 右眼高光 */}
      <mesh position={[eyeSpacing - 0.01, 0.01, 0.007]}>
        <circleGeometry args={[0.006, 16]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
    </group>
  );
}

export default RingEyes;