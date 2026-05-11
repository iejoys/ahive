import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface CrownProps {
  color?: string;
  isOffline?: boolean;
  isWorking?: boolean;
}

/**
 * 星光冠冕组件
 * 
 * AHIVECORE 母体的冠冕，5颗主星环绕
 * - idle: 星光缓慢闪烁
 * - working: 星芒爆发效果
 * - offline: 无冠冕
 */
export function Crown({ 
  color = '#ffd700', 
  isOffline = false,
  isWorking = false 
}: CrownProps) {
  const groupRef = useRef<THREE.Group>(null);
  const starsRef = useRef<THREE.Mesh[]>([]);
  
  // 5颗主星的位置（五角星排列）
  const starPositions = useMemo(() => {
    const positions: [number, number, number][] = [];
    const radius = 0.4;
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2 / 5) - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 0.9 + Math.random() * 0.1;
      positions.push([x, y, z]);
    }
    return positions;
  }, []);
  
  // 连接线（星座风格）
  const linePositions = useMemo(() => {
    const points: THREE.Vector3[] = [];
    starPositions.forEach((pos, i) => {
      const nextPos = starPositions[(i + 1) % 5];
      points.push(new THREE.Vector3(...pos));
      points.push(new THREE.Vector3(...nextPos));
    });
    return points;
  }, [starPositions]);
  
  // 动画
  useFrame((state) => {
    if (isOffline) return;
    
    const time = state.clock.elapsedTime;
    
    // 星星闪烁
    starsRef.current.forEach((mesh, i) => {
      if (!mesh || !(mesh.material instanceof THREE.MeshStandardMaterial)) return;
      
      const phase = i * 0.5;
      
      if (isWorking) {
        // 工作状态：爆发效果
        const burst = 1 + Math.sin(time * 8 + phase) * 0.5;
        mesh.scale.setScalar(burst);
        mesh.material.emissiveIntensity = 1.5 + Math.sin(time * 10 + phase) * 0.5;
      } else {
        // 空闲状态：缓慢闪烁
        const twinkle = 0.8 + Math.sin(time * 2 + phase) * 0.2;
        mesh.scale.setScalar(twinkle);
        mesh.material.emissiveIntensity = 0.5 + Math.sin(time * 2 + phase) * 0.3;
      }
    });
    
    // 冠冕缓慢旋转
    if (groupRef.current) {
      groupRef.current.rotation.y = time * 0.2;
    }
  });
  
  // 离线时不显示冠冕
  if (isOffline) return null;
  
  return (
    <group ref={groupRef} position={[0, 0.2, 0]}>
      {/* 星星 */}
      {starPositions.map((pos, i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) starsRef.current[i] = el; }}
          position={pos}
        >
          <octahedronGeometry args={[0.08, 0]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.8}
            metalness={0.8}
            roughness={0.2}
          />
        </mesh>
      ))}
      
      {/* 星座连线 */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={linePositions.length}
            array={new Float32Array(linePositions.flatMap(p => [p.x, p.y, p.z]))}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial 
          color={color} 
          transparent 
          opacity={isWorking ? 0.8 : 0.4}
        />
      </lineSegments>
      
      {/* 中心发光点 */}
      <mesh position={[0, 0.95, 0]}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isWorking ? 1.5 : 0.6}
          transparent
          opacity={0.9}
        />
      </mesh>
      
      {/* 工作状态额外光束 */}
      {isWorking && (
        <group>
          {/* 向上的光束 */}
          <mesh position={[0, 1.1, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.01, 0.3, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.6} />
          </mesh>
          {/* 四周的光束 */}
          {[0, 1, 2, 3, 4].map((i) => {
            const angle = (i * Math.PI * 2 / 5);
            return (
              <mesh 
                key={i}
                position={[Math.cos(angle) * 0.3, 1.0, Math.sin(angle) * 0.3]}
                rotation={[Math.PI / 6, 0, angle]}
              >
                <cylinderGeometry args={[0.015, 0.005, 0.2, 6]} />
                <meshBasicMaterial color={color} transparent opacity={0.4} />
              </mesh>
            );
          })}
        </group>
      )}
    </group>
  );
}

export default Crown;