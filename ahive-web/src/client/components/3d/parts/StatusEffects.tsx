import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { StateConfig, ParticleConfig } from '../hooks/useStateConfig';

interface StatusEffectsProps {
  status: string;
  config: StateConfig;
  isMoving?: boolean;
}

/**
 * 状态特效组件
 * 
 * 包含：
 * - 粒子效果 (工作中)
 * - 警告波纹 (错误)
 * - 睡眠图标 (暂停)
 * - 移动轨迹
 */
export function StatusEffects({ 
  status, 
  config,
  isMoving = false
}: StatusEffectsProps) {
  return (
    <group>
      {/* 粒子效果 */}
      {config.particles && typeof config.particles !== 'boolean' && config.particles.enabled && (
        <ParticleEffect 
          config={config.particles}
          color={config.color}
        />
      )}
      
      {/* 警告波纹 */}
      {config.warningRipple && (
        <WarningRipple color={config.color} />
      )}
      
      {/* 睡眠图标 */}
      {config.sleepIcon && (
        <SleepIcon />
      )}
      
      {/* 移动轨迹 */}
      {isMoving && (
        <MovementTrail color="#22c55e" />
      )}
    </group>
  );
}

/**
 * 粒子效果组件
 */
function ParticleEffect({ 
  config,
  color 
}: { 
  config: ParticleConfig;
  color: string;
}) {
  const particlesRef = useRef<THREE.Group>(null);
  const particleCount = config.count || 50;
  
  // 生成随机粒子位置
  const particles = useMemo(() => {
    return Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      initialY: -0.3 - Math.random() * 0.3,
      speed: 0.5 + Math.random() * 0.5,
      offset: Math.random() * Math.PI * 2,
      radius: 0.1 + Math.random() * 0.15,
      angle: Math.random() * Math.PI * 2,
    }));
  }, [particleCount]);
  
  // 动画
  useFrame((state) => {
    if (!particlesRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    particlesRef.current.children.forEach((child, i) => {
      const particle = particles[i];
      if (!particle) return;
      
      // 向上移动
      const y = particle.initialY + (time * particle.speed) % 1.2;
      child.position.y = y;
      
      // 水平旋转
      const angle = particle.angle + time * 0.5;
      child.position.x = Math.cos(angle) * particle.radius;
      child.position.z = Math.sin(angle) * particle.radius;
      
      // 透明度渐变
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.opacity = y > 0.5 ? 1 - (y - 0.5) * 2 : 1;
      }
    });
  });
  
  return (
    <group ref={particlesRef}>
      {particles.map((p) => (
        <mesh key={p.id} position={[0, p.initialY, 0]}>
          <sphereGeometry args={[0.02, 6, 6]} />
          <meshBasicMaterial 
            color={color} 
            transparent 
            opacity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 警告波纹组件
 */
function WarningRipple({ color }: { color: string }) {
  const ripplesRef = useRef<THREE.Mesh[]>([]);
  
  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    ripplesRef.current.forEach((mesh, i) => {
      if (!mesh) return;
      
      // 错开相位
      const phase = (time + i * 0.3) % 1;
      
      // 扩展半径
      const scale = 1 + phase * 2;
      mesh.scale.set(scale, scale, scale);
      
      // 透明度衰减
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.opacity = (1 - phase) * 0.5;
      }
    });
  });
  
  return (
    <group rotation={[Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) ripplesRef.current[i] = el; }}
        >
          <ringGeometry args={[0.5, 0.55, 32]} />
          <meshBasicMaterial 
            color={color} 
            transparent 
            opacity={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 睡眠图标组件 (Z字符)
 */
function SleepIcon() {
  const z1Ref = useRef<THREE.Group>(null);
  const z2Ref = useRef<THREE.Group>(null);
  const z3Ref = useRef<THREE.Group>(null);
  
  // 动画
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    
    // Z字符上升动画
    [
      { ref: z1Ref, delay: 0 },
      { ref: z2Ref, delay: 0.5 },
      { ref: z3Ref, delay: 1 },
    ].forEach(({ ref, delay }) => {
      if (!ref.current) return;
      
      const phase = ((time + delay) % 2) / 2;
      const y = 0.8 + phase * 0.6;
      const opacity = 1 - phase;
      
      ref.current.position.y = y;
      ref.current.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = opacity;
        }
      });
    });
  });
  
  return (
    <group>
      <ZCharacter ref={z1Ref} position={[0.2, 0.8, 0]} scale={0.15} />
      <ZCharacter ref={z2Ref} position={[0.35, 0.9, 0]} scale={0.12} />
      <ZCharacter ref={z3Ref} position={[0.45, 1.0, 0]} scale={0.1} />
    </group>
  );
}

/**
 * Z 字符组件
 */
const ZCharacter = ({ 
  position, 
  scale,
  ref 
}: { 
  position: [number, number, number];
  scale: number;
  ref: React.Ref<THREE.Group>;
}) => {
  return (
    <group ref={ref} position={position}>
      {/* Z 的三条线 */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[scale * 0.8, scale * 0.08, scale * 0.02]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={1} />
      </mesh>
      <mesh position={[0, 0, 0]} rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[scale * 1.1, scale * 0.08, scale * 0.02]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={1} />
      </mesh>
      <mesh position={[0, -0.04, 0]}>
        <boxGeometry args={[scale * 0.8, scale * 0.08, scale * 0.02]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={1} />
      </mesh>
    </group>
  );
};

/**
 * 移动轨迹组件
 */
function MovementTrail({ color }: { color: string }) {
  const trailRef = useRef<THREE.Group>(null);
  
  // 动画
  useFrame((state) => {
    if (!trailRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    trailRef.current.children.forEach((child, i) => {
      const phase = (time * 2 + i * 0.5) % 1;
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.opacity = 0.5 - phase * 0.3;
        child.scale.setScalar(1 - phase * 0.5);
      }
    });
  });
  
  return (
    <group ref={trailRef}>
      {/* 轨迹粒子 */}
      <mesh position={[-0.3, -0.3, 0.3]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      <mesh position={[0.3, -0.3, 0.3]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      <mesh position={[0, -0.35, 0.4]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/**
 * 选中光晕组件
 */
export function SelectionGlow({ isSelected }: { isSelected: boolean }) {
  const glowRef = useRef<THREE.Mesh>(null);
  
  // 动画
  useFrame((state) => {
    if (!glowRef.current || !isSelected) return;
    
    const time = state.clock.elapsedTime;
    const pulse = 1.2 + Math.sin(time * 3) * 0.1;
    glowRef.current.scale.setScalar(pulse);
  });
  
  if (!isSelected) return null;
  
  return (
    <mesh ref={glowRef}>
      <sphereGeometry args={[0.6, 16, 16]} />
      <meshStandardMaterial
        color="#f59e0b"
        emissive="#f59e0b"
        emissiveIntensity={2}
        transparent
        opacity={0.3}
      />
    </mesh>
  );
}

export default StatusEffects;