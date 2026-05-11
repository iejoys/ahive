import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent } from '../../../types';
import { useStore } from '../../../store/useStore';
import { useStateConfig } from '../hooks/useStateConfig';
import { AgentHead } from '../parts/AgentHead';
import { AgentBody } from '../parts/AgentBody';
import { AgentBase } from '../parts/AgentBase';
import { StatusEffects, SelectionGlow } from '../parts/StatusEffects';

interface AgentCharacterV2Props {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * 智能体角色组件 V2
 * 
 * 设计：
 * - 圆球头部 + 金属银色质感
 * - 空闲：睁眼，不变色
 * - 工作：变色发光
 * - 离线：闭眼，禁止交互，不变色
 * - 名字始终显示在头顶
 */
export function AgentCharacterV2({ agent, isSelected, onClick }: AgentCharacterV2Props) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  
  // Store
  const { 
    movementTarget, 
    setMovementTarget, 
    updateAgentPosition, 
    chatMessages,
    offlineAgents 
  } = useStore();
  
  // 状态配置
  const config = useStateConfig(agent);
  const { isOffline, interactive } = config;
  
  // 移动状态
  const targetPos = useRef<THREE.Vector3 | null>(null);
  const currentPos = useRef(new THREE.Vector3(
    agent.position.x, 
    agent.position.y, 
    agent.position.z
  ));
  
  // 更新移动目标
  useEffect(() => {
    if (movementTarget && movementTarget.agentId === agent.id && !isOffline) {
      targetPos.current = new THREE.Vector3(
        movementTarget.targetPosition.x,
        movementTarget.targetPosition.y,
        movementTarget.targetPosition.z
      );
    } else {
      targetPos.current = null;
    }
  }, [movementTarget, agent.id, isOffline]);
  
  // 动画循环
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    // 更新当前位置引用
    currentPos.current.set(agent.position.x, agent.position.y, agent.position.z);
    
    // 移动动画
    if (targetPos.current && movementTarget?.agentId === agent.id) {
      const target = targetPos.current;
      const current = currentPos.current;
      const distance = current.distanceTo(target);
      
      if (distance > 0.1) {
        const direction = new THREE.Vector3().subVectors(target, current).normalize();
        const speed = 3;
        const moveDistance = Math.min(speed * delta, distance);
        
        const newPos = current.add(direction.multiplyScalar(moveDistance));
        updateAgentPosition(agent.id, { x: newPos.x, y: newPos.y, z: newPos.z });
        
        groupRef.current.lookAt(target);
      } else {
        setMovementTarget(null);
        targetPos.current = null;
      }
    } else {
      // 浮动动画 (非移动时)
      const floatConfig = config.animation.float;
      if (!isOffline && floatConfig && typeof floatConfig === 'object' && floatConfig.enabled) {
        const { amplitude, period } = floatConfig;
        const floatY = Math.sin(state.clock.elapsedTime * Math.PI * 2 / period) * amplitude;
        groupRef.current.position.y = agent.position.y + floatY;
      }
    }
    
    // 旋转动画 (工作时)
    if (!isOffline && config.animation.rotate) {
      const rotateSpeed = typeof config.animation.rotate === 'object' 
        ? config.animation.rotate.speed 
        : 0.02;
      groupRef.current.rotation.y += rotateSpeed;
    }
  });
  
  // 交互处理
  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!interactive) return;
    onClick();
  };
  
  const handlePointerOver = () => {
    if (interactive) setHovered(true);
  };
  
  const handlePointerOut = () => {
    setHovered(false);
  };
  
  // 缩放效果
  const scale = (isSelected || hovered) && !isOffline ? 1.1 : 1;
  
  // 判断是否正在回复
  const messages = chatMessages[agent.id] || [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const isTyping = lastMessage && lastMessage.role === 'user' && !isOffline;
  
  return (
    <group 
      ref={groupRef}
      position={[agent.position.x, agent.position.y, agent.position.z]}
      scale={scale}
    >
      {/* 对话气泡 - 正在回复时显示省略号 */}
      {isTyping && (
        <Html position={[0, 1.3, 0]} center distanceFactor={8} style={{ zIndex: 10 }}>
          <div className="bg-white dark:bg-gray-800 rounded-full shadow-lg px-4 py-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>
        </Html>
      )}
      
      {/* 选中光晕 */}
      <SelectionGlow isSelected={isSelected} />
      
      {/* 头部 */}
      <AgentHead 
        status={agent.status}
        config={config}
        isOffline={isOffline}
        isSelected={isSelected}
      />
      
      {/* 躯干 */}
      <AgentBody 
        status={agent.status}
        config={config}
        isOffline={isOffline}
      />
      
      {/* 底座 */}
      <AgentBase 
        config={config}
        isOffline={isOffline}
      />
      
      {/* 状态特效 */}
      {!isOffline && (
        <StatusEffects 
          status={agent.status}
          config={config}
          isMoving={movementTarget?.agentId === agent.id}
        />
      )}
      
      {/* 名字标签 - 始终显示在头顶 */}
      <Billboard position={[0, 1.0, 0]}>
        <Html center distanceFactor={8} style={{ zIndex: 10 }}>
          <div 
            className="px-2 py-1 rounded text-sm font-medium whitespace-nowrap"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              color: 'white',
              textShadow: '0 1px 2px rgba(0,0,0,0.5)'
            }}
          >
            {agent.name}
          </div>
        </Html>
      </Billboard>
      {/* 交互层 - 透明球体用于检测点击 */}
      <mesh
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[0.7, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

export default AgentCharacterV2;