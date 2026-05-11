import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent } from '../../../types';
import { useStore } from '../../../store/useStore';
import { AHIVECoreHead } from '../parts/AHIVECoreHead';
import { AHIVECoreBody } from '../parts/AHIVECoreBody';
import { HaloRings } from '../parts/HaloRings';
import { ParticleWaterfall } from '../parts/ParticleWaterfall';
import { STATUS_COLORS } from '../hooks/useStateConfig';

interface AHIVECoreCharacterProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * AHIVECORE 母体形象组件
 * 
 * 系统核心 · 智能中枢 · 母体级存在
 * 
 * 特征：
 * - 庄重的方尖碑造型
 * - 星光冠冕 + 七星核心
 * - 三层光轮系统
 * - 粒子瀑布效果
 * - 智慧之眼
 * 
 * 尺寸：高度 2.0m (是普通智能体的 1.7 倍)
 * 位置：固定位置，不可移动
 */
export function AHIVECoreCharacter({ agent, isSelected, onClick }: AHIVECoreCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  
  // Store
  const { language, offlineAgents } = useStore();
  
  // 离线状态
  const isOffline = offlineAgents.has(agent.id) || agent.status === 'offline';
  const isWorking = agent.status === 'working' && !isOffline;
  
  // 颜色
  const color = useMemo(() => {
    if (isOffline) return '#6b7280';
    if (isWorking) return '#22c55e';
    return STATUS_COLORS[agent.status] || STATUS_COLORS.idle;
  }, [isOffline, isWorking, agent.status]);
  
  // 浮动动画
  useFrame((state) => {
    if (!groupRef.current || isOffline) return;
    
    const time = state.clock.elapsedTime;
    
    // 轻柔悬浮 (母体不移动，只悬浮)
    const floatY = Math.sin(time * 0.5) * 0.1;
    groupRef.current.position.y = (agent.position?.y || 0) + floatY + 0.2; // 额外抬高
  });
  
  // 交互处理
  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (isOffline) return;
    onClick();
  };
  
  // 缩放效果
  const scale = (isSelected || hovered) && !isOffline ? 1.1 : 1;
  
  // 状态标签
  const statusLabels: Record<string, Record<string, string>> = {
    zh: { idle: '空闲', working: '工作中', paused: '已暂停', error: '错误', offline: '离线' },
    en: { idle: 'Idle', working: 'Working', paused: 'Paused', error: 'Error', offline: 'Offline' },
  };
  
  const statusColor = isOffline ? '#6b7280' : color;
  const statusLabel = statusLabels[language]?.[isOffline ? 'offline' : agent.status] || agent.status;
  
  return (
    <group 
      ref={groupRef}
      position={[
        agent.position?.x || 0, 
        (agent.position?.y || 0) + 0.2, 
        agent.position?.z || 0
      ]}
      scale={scale}
    >
      {/* 选中光环 */}
      {isSelected && !isOffline && (
        <mesh>
          <sphereGeometry args={[1.5, 32, 32]} />
          <meshStandardMaterial
            color="#ffd700"
            emissive="#ffd700"
            emissiveIntensity={2}
            transparent
            opacity={0.2}
          />
        </mesh>
      )}
      
      {/* 头部 */}
      <AHIVECoreHead 
        status={agent.status}
        isOffline={isOffline}
        color={color}
      />
      
      {/* 躯干 */}
      <AHIVECoreBody 
        status={agent.status}
        isOffline={isOffline}
        color={color}
      />
      
      {/* 三层光轮 */}
      <HaloRings 
        color={color}
        isOffline={isOffline}
        isWorking={isWorking}
      />
      
      {/* 粒子瀑布 */}
      <ParticleWaterfall 
        color={color}
        isOffline={isOffline}
        isWorking={isWorking}
        count={isWorking ? 300 : 150}
      />
      
      {/* 底座平台 */}
      <mesh position={[0, -1.0, 0]}>
        <cylinderGeometry args={[0.8, 1.0, 0.15, 16]} />
        <meshStandardMaterial
          color={isOffline ? '#1f2937' : color}
          emissive={isOffline ? '#111827' : color}
          emissiveIntensity={isOffline ? 0.1 : 0.3}
          transparent={isOffline}
          opacity={isOffline ? 0.5 : 1}
          metalness={0.5}
          roughness={0.3}
        />
      </mesh>
      
      {/* 状态标签 */}
      <Billboard position={[0, 1.3, 0]}>
        <Html center distanceFactor={8} style={{ zIndex: 10 }}>
          <div 
            className="px-3 py-1.5 rounded-full text-sm font-bold shadow-lg whitespace-nowrap"
            style={{
              backgroundColor: isOffline 
                ? 'rgba(107, 114, 128, 0.95)'
                : agent.status === 'working' 
                  ? 'rgba(34, 197, 94, 0.95)'
                  : agent.status === 'error'
                    ? 'rgba(239, 68, 68, 0.95)'
                    : agent.status === 'paused'
                      ? 'rgba(245, 158, 11, 0.95)'
                      : 'rgba(99, 102, 241, 0.95)',
              color: 'white',
            }}
          >
            {isOffline ? (
              <span>⚫ 离线</span>
            ) : agent.status === 'working' ? (
              <span className="flex items-center gap-1">
                👑 {statusLabel}
                <span className="animate-pulse">...</span>
              </span>
            ) : (
              <span>👑 {statusLabel}</span>
            )}
          </div>
        </Html>
      </Billboard>
      
      {/* 名字标签 */}
      {(hovered || isSelected) && !isOffline && (
        <Billboard position={[0, 1.6, 0]}>
          <Html center distanceFactor={8} style={{ zIndex: 10 }}>
            <div 
              className="px-2 py-1 rounded text-sm font-medium whitespace-nowrap"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                color: '#ffd700',
                textShadow: '0 1px 2px rgba(0,0,0,0.5)'
              }}
            >
              👑 {agent.name}
            </div>
          </Html>
        </Billboard>
      )}
      
      {/* 离线警告 */}
      {isOffline && (
        <Billboard position={[0, 0, 0]}>
          <Html center distanceFactor={10} style={{ zIndex: 10 }}>
            <div className="bg-gray-800 text-yellow-400 px-4 py-2 rounded-lg text-xs font-medium border border-yellow-500">
              ⚠️ 核心已断开连接
            </div>
          </Html>
        </Billboard>
      )}
      
      {/* 交互层 */}
      <mesh
        onClick={handleClick}
        onPointerOver={() => !isOffline && setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[1.2, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

export default AHIVECoreCharacter;