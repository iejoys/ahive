import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface WeldingEffectProps {
  position: [number, number, number];
  active: boolean;
}

/**
 * 电焊特效组件
 * 在运行中的工作流节点周围产生粒子火花效果
 */
export function WeldingEffect({ position, active }: WeldingEffectProps) {
  const particlesRef = useRef<THREE.Points>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  // 创建粒子系统
  const particleCount = 30;
  const geometry = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      // 随机分布在节点周围
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const radius = 0.3 + Math.random() * 0.5;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) + 0.5;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      // 随机速度
      velocities[i * 3] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 1] = Math.random() * 0.02 + 0.01;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    (geom as any).userData.velocities = velocities;
    return geom;
  }, []);

  // 粒子材质
  const material = useMemo(() => {
    return new THREE.PointsMaterial({
      color: 0xf59e0b,
      size: 0.08,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);

  // 动画更新
  useFrame((state) => {
    if (!active || !particlesRef.current) return;

    const time = state.clock.elapsedTime;
    const positions = geometry.attributes.position.array as Float32Array;
    const velocities = (geometry as any).userData.velocities as Float32Array;

    for (let i = 0; i < particleCount; i++) {
      // 更新位置
      positions[i * 3] += velocities[i * 3];
      positions[i * 3 + 1] += velocities[i * 3 + 1];
      positions[i * 3 + 2] += velocities[i * 3 + 2];

      // 重力效果
      velocities[i * 3 + 1] -= 0.0005;

      // 重置粒子（循环使用）
      if (positions[i * 3 + 1] < 0 || Math.abs(positions[i * 3]) > 1 || Math.abs(positions[i * 3 + 2]) > 1) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const radius = 0.3 + Math.random() * 0.3;

        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = 0.5 + radius * Math.cos(phi);
        positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

        velocities[i * 3] = (Math.random() - 0.5) * 0.02;
        velocities[i * 3 + 1] = Math.random() * 0.02 + 0.01;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
      }
    }

    geometry.attributes.position.needsUpdate = true;

    // 发光效果闪烁
    if (glowRef.current) {
      const intensity = 0.3 + Math.sin(time * 8) * 0.2;
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = intensity;
      glowRef.current.scale.setScalar(1 + Math.sin(time * 4) * 0.1);
    }
  });

  if (!active) return null;

  return (
    <group position={position}>
      {/* 粒子系统 */}
      <points ref={particlesRef} geometry={geometry} material={material} />

      {/* 发光球体 */}
      <mesh ref={glowRef} position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.4, 16, 16]} />
        <meshBasicMaterial
          color="#f59e0b"
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
