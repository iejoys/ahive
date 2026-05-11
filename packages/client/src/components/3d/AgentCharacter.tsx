import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent } from '../../types';
import { useStore } from '../../store/useStore';

interface AgentCharacterProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

// 动画状态类型
type AnimationState = 'idle' | 'working' | 'thinking' | 'talking' | 'walking' | 'celebrating' | 'error';

const STATUS_COLORS = {
  idle: '#6366f1',
  working: '#22c55e',
  paused: '#f59e0b',
  error: '#ef4444',
  offline: '#6b7280', // 灰色
};

// 动画状态颜色
const ANIMATION_STATE_COLORS: Record<AnimationState, string> = {
  idle: '#6366f1',       // 紫色
  working: '#22c55e',    // 绿色
  thinking: '#8b5cf6',   // 深紫色
  talking: '#06b6d4',    // 青色
  walking: '#3b82f6',    // 蓝色
  celebrating: '#f59e0b', // 橙色
  error: '#ef4444',      // 红色
};

const OFFLINE_COLOR = '#6b7280';

const TYPE_ICONS: Record<string, string> = {
  opencode: '💻',
  mcp: '🔌',
  mock: '🎭',
  openclaw: '🦞',
  claude: '🧠',
  custom: '⚙️',
};

export function AgentCharacter({ agent, isSelected, onClick }: AgentCharacterProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const eyesRef = useRef<THREE.Group>(null);
  const sparksRef = useRef<THREE.Points>(null);
  const sparkVelocities = useRef<Float32Array>(new Float32Array(20 * 3));
  const [hovered, setHovered] = useState(false);
  const { language, movementTarget, setMovementTarget, updateAgentPosition, chatMessages, offlineAgents, agentAnimationStates, agentOrbitState } = useStore();
  
  // 获取动画状态 - 需要处理多种 ID 格式
  // 1. agent.id 可能是 "a2a-xxx" 格式
  // 2. agent.agentId 可能是 "xxx" 格式
  // 3. 动画状态的 key 是 "xxx" 格式
  const animationStateKey = agent.agentId || agent.id.replace('a2a-', '').replace('agent-', '');
  const animationState = agentAnimationStates[animationStateKey] || agentAnimationStates[agent.id] || agentAnimationStates[agent.agentId || ''];
  const currentAnimationState: AnimationState = animationState?.state || 'idle';
  const currentAction = animationState?.action || 'idle';
  const currentExpression = animationState?.expression || 'neutral';
  
  // 获取轨道状态 - 使用 ref 确保 useFrame 读取最新值
  const orbitStateRef = useRef(agentOrbitState[agent.id] || agentOrbitState[agent.agentId || '']);
  useEffect(() => {
    orbitStateRef.current = agentOrbitState[agent.id] || agentOrbitState[agent.agentId || ''];
  }, [agentOrbitState, agent.id, agent.agentId]);
  const orbitState = orbitStateRef.current;
  const isOrbiting = !!orbitState;
  
  // 调试日志 - 显示 agentId 匹配情况
  useEffect(() => {
    console.log(`[AgentCharacter] ${agent.name} (id=${agent.id}, agentId=${agent.agentId}, key=${animationStateKey}) animation check`);
    console.log(`[AgentCharacter] agentAnimationStates keys:`, Object.keys(agentAnimationStates));
    console.log(`[AgentCharacter] ${agent.name} animation state: ${currentAnimationState}, action: ${currentAction}, orbiting: ${isOrbiting}`);
  }, [currentAnimationState, currentAction, agent.name, agent.id, agent.agentId, animationStateKey, agentAnimationStates, isOrbiting]);
  
  // 检查智能体是否离线
  const isOffline = offlineAgents.has(agent.id) || agent.status === 'offline';

  const targetPos = useRef<THREE.Vector3 | null>(null);
  const currentPos = useRef(new THREE.Vector3(agent.position.x, agent.position.y, agent.position.z));
  const orbitAngleRef = useRef(0);
  
  // 电焊火花系统
  const sparkCount = 20;
  const sparkGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const sparkMaterialRef = useRef<THREE.PointsMaterial | null>(null);
  const sparkPointsRef = useRef<THREE.Points | null>(null);
  const sparkVelocitiesRef = useRef<Float32Array>(new Float32Array(sparkCount * 3));

  // 初始化火花几何体和材质
  useEffect(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(sparkCount * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: '#fbbf24',
      size: 0.05,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    
    sparkGeometryRef.current = geometry;
    sparkMaterialRef.current = material;
    
    // 初始化粒子位置和速度
    for (let i = 0; i < sparkCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -10; // 初始在视野外
      positions[i * 3 + 2] = 0;
      
      sparkVelocitiesRef.current[i * 3] = 0;
      sparkVelocitiesRef.current[i * 3 + 1] = 0;
      sparkVelocitiesRef.current[i * 3 + 2] = 0;
    }
    
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, []);

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

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    const time = state.clock.elapsedTime;
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

        meshRef.current.lookAt(target);
      } else {
        setMovementTarget(null);
        targetPos.current = null;
      }
    }

    // 轨道运动 - Agent 围绕节点跑圈 + 电焊火花
    // 直接从 store 读取最新状态，避免闭包捕获旧值
    const latestOrbitState = useStore.getState().agentOrbitState[agent.id] || useStore.getState().agentOrbitState[agent.agentId || ''];
    if (latestOrbitState) {
      console.log(`[AgentCharacter] ${agent.name} orbiting:`, latestOrbitState);
      const { centerPosition, radius, speed, angleOffset } = latestOrbitState;
      orbitAngleRef.current += speed * delta;
      
      const angle = orbitAngleRef.current + angleOffset;
      const orbitX = centerPosition.x + Math.cos(angle) * radius;
      const orbitZ = centerPosition.z + Math.sin(angle) * radius;
      const orbitY = centerPosition.y + Math.sin(time * 3) * 0.1; // 轻微上下浮动
      
      updateAgentPosition(agent.id, { x: orbitX, y: orbitY, z: orbitZ });
      
      // 直接设置 mesh 位置（关键修复：只更新 store 不会移动 3D 模型）
      meshRef.current.position.set(orbitX, orbitY, orbitZ);
      
      // 面向轨道运动方向
      const lookAhead = angle + 0.1;
      const lookX = centerPosition.x + Math.cos(lookAhead) * radius;
      const lookZ = centerPosition.z + Math.sin(lookAhead) * radius;
      meshRef.current.lookAt(new THREE.Vector3(lookX, orbitY, lookZ));
      
      // 工作动画：轻微旋转 + 脉动
      meshRef.current.rotation.y += 0.02;
      const workScale = 1 + Math.sin(time * 3) * 0.03;
      meshRef.current.scale.setScalar(workScale);
      
      // 电焊火花动画
      if (sparkPointsRef.current && sparkGeometryRef.current) {
        const positions = sparkGeometryRef.current.attributes.position.array as Float32Array;
        const velocities = sparkVelocitiesRef.current;
        
        for (let i = 0; i < 20; i++) {
          // 更新位置
          positions[i * 3] += velocities[i * 3];
          positions[i * 3 + 1] += velocities[i * 3 + 1];
          positions[i * 3 + 2] += velocities[i * 3 + 2];
          
          // 重力效果
          velocities[i * 3 + 1] -= 0.001;
          
          // 重置粒子（循环使用）
          if (positions[i * 3 + 1] < -0.5 || Math.abs(positions[i * 3]) > 0.5 || Math.abs(positions[i * 3 + 2]) > 0.5) {
            const sparkAngle = Math.random() * Math.PI * 2;
            const sparkRadius = 0.1 + Math.random() * 0.15;
            positions[i * 3] = Math.cos(sparkAngle) * sparkRadius;
            positions[i * 3 + 1] = 0.1 + Math.random() * 0.2;
            positions[i * 3 + 2] = Math.sin(sparkAngle) * sparkRadius;
            
            velocities[i * 3] = (Math.random() - 0.5) * 0.03;
            velocities[i * 3 + 1] = Math.random() * 0.03 + 0.01;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.03;
          }
        }
        
        sparkGeometryRef.current.attributes.position.needsUpdate = true;
      }
    }

    // 基础浮动动画（非轨道运动时）
    if (!isOrbiting && (!targetPos.current || movementTarget?.agentId !== agent.id)) {
      meshRef.current.position.y =
        agent.position.y + Math.sin(time * 2 + agent.position.x) * 0.1;
    }

    // 状态驱动的动画（非轨道运动时）
    if (!isOrbiting) {
      switch (currentAnimationState) {
        case 'thinking':
          // 思考动画：挠头、歪头
          meshRef.current.rotation.z = Math.sin(time * 2) * 0.15;
          meshRef.current.rotation.y = Math.sin(time * 1.5) * 0.1;
          break;
          
        case 'working':
          // 工作动画：轻微旋转 + 脉动
          meshRef.current.rotation.y += 0.02;
          const workScale = 1 + Math.sin(time * 3) * 0.03;
          meshRef.current.scale.setScalar(workScale);
          break;
          
        case 'talking':
          // 对话动画：点头
          meshRef.current.rotation.x = Math.sin(time * 4) * 0.1;
          break;
          
        case 'celebrating':
          // 庆祝动画：跳跃 + 旋转
          meshRef.current.position.y = agent.position.y + Math.abs(Math.sin(time * 4)) * 0.3;
          meshRef.current.rotation.y += 0.05;
          break;
          
        case 'error':
          // 错误动画：摇头
          meshRef.current.rotation.y = Math.sin(time * 5) * 0.3;
          meshRef.current.rotation.z = Math.sin(time * 3) * 0.1;
          break;
          
        case 'walking':
          // 行走动画：上下摆动
          meshRef.current.position.y = agent.position.y + Math.abs(Math.sin(time * 8)) * 0.15;
          break;
          
        case 'idle':
        default:
          // 空闲动画：轻微浮动（已有）
          break;
      }
    }

    // 眼睛动画
    if (eyesRef.current && !isOffline) {
      switch (currentExpression) {
        case 'focused':
        case 'serious':
          // 专注：眼睛稍微眯起
          eyesRef.current.scale.y = 0.8;
          break;
        case 'happy':
        case 'excited':
          // 开心：眼睛放大
          eyesRef.current.scale.setScalar(1.1);
          break;
        case 'confused':
        case 'puzzled':
          // 困惑：眼睛左右移动
          eyesRef.current.position.x = Math.sin(time * 2) * 0.05;
          break;
        default:
          // 默认：正常
          eyesRef.current.scale.setScalar(1);
          eyesRef.current.position.x = 0;
          break;
      }
    }
  });

  const statusLabels: Record<string, Record<string, string>> = {
    zh: { idle: '空闲', working: '工作中', paused: '已暂停', error: '错误', offline: '离线' },
    en: { idle: 'Idle', working: 'Working', paused: 'Paused', error: 'Error', offline: 'Offline' },
  };


  const statusColor = STATUS_COLORS[agent.status];
  const statusLabel = statusLabels[language]?.[agent.status] || agent.status;
  const isMoving = movementTarget?.agentId === agent.id;
  
  // 动画状态颜色（优先使用动画状态颜色）
  const animationColor = ANIMATION_STATE_COLORS[currentAnimationState];
  
  // 动画状态标签
  const animationStateLabels: Record<string, Record<AnimationState, string>> = {
    zh: { 
      idle: '空闲', 
      working: '工作中', 
      thinking: '思考中', 
      talking: '对话中', 
      walking: '移动中', 
      celebrating: '完成!', 
      error: '错误' 
    },
    en: { 
      idle: 'Idle', 
      working: 'Working', 
      thinking: 'Thinking', 
      talking: 'Talking', 
      walking: 'Walking', 
      celebrating: 'Done!', 
      error: 'Error' 
    },
  };
  const animationStateLabel = animationStateLabels[language]?.[currentAnimationState] || currentAnimationState;

  // 获取该智能体的对话消息
  const messages = chatMessages[agent.id] || [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  // 判断是否正在回复（最后一条是用户消息）
  const isTyping = lastMessage && lastMessage.role === 'user';

  // 省略号显示3秒后自动消失
  useEffect(() => {
    if (isTyping) {
      const timer = setTimeout(() => {
        // 3秒后什么都不做，气泡自然消失
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isTyping]);

  return (
    <group position={[agent.position.x, agent.position.y, agent.position.z]}>
      {/* 对话气泡 - 正在回复时显示省略号 */}
      {isTyping && (
        <Html position={[0, 1.5, 0]} center distanceFactor={8} style={{ zIndex: 10 }}>
          <div className="bg-white dark:bg-gray-800 rounded-full shadow-lg px-4 py-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>
        </Html>
      )}

      {/* Main body */}
      <mesh
        key={`agent-mesh-${agent.id}-${isSelected}`}
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          // 离线状态禁止交互
          if (!isOffline) {
            onClick();
          }
        }}
        onPointerOver={() => !isOffline && setHovered(true)}
        onPointerOut={() => setHovered(false)}
        scale={isSelected || hovered ? 1.15 : 1}
      >
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial
          key={`mat-${isSelected}`}
          color={isOffline ? OFFLINE_COLOR : (isSelected ? '#f59e0b' : '#4f46e5')}
          emissive={isOffline ? '#1f2937' : (isSelected ? '#f59e0b' : animationColor)}
          emissiveIntensity={isOffline ? 0.1 : (isSelected ? 2.5 : (isMoving ? 0.6 : 0.3))}
          transparent={isOffline}
          opacity={isOffline ? 0.7 : 1}
        />
        {isSelected && (
          <mesh scale={1.3}>
            <sphereGeometry args={[0.55, 32, 32]} />
            <meshStandardMaterial
              color="#f59e0b"
              emissive="#f59e0b"
              emissiveIntensity={3}
              transparent
              opacity={0.5}
            />
          </mesh>
        )}
      </mesh>

      {/* Eyes - 离线时闭眼 */}



      {/* Eyes - 离线时闭眼 */}
      {!isOffline ? (
        <group ref={eyesRef}>
          <mesh position={[-0.15, 0.15, 0.4]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0.15, 0.15, 0.4]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
          {/* Pupils */}
          <mesh position={[-0.15, 0.15, 0.48]}>
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshStandardMaterial color="#1e1e2e" />
          </mesh>
          <mesh position={[0.15, 0.15, 0.48]}>
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshStandardMaterial color="#1e1e2e" />
          </mesh>
        </group>
      ) : (
        <>
          {/* 闭眼线 */}
          <mesh position={[-0.15, 0.15, 0.45]}>
            <boxGeometry args={[0.12, 0.02, 0.02]} />
            <meshStandardMaterial color="#374151" />
          </mesh>
          <mesh position={[0.15, 0.15, 0.45]}>
            <boxGeometry args={[0.12, 0.02, 0.02]} />
            <meshStandardMaterial color="#374151" />
          </mesh>
        </>
      )}

      {/* Status indicator ring - 使用动画状态颜色 */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
        <ringGeometry args={[0.4, 0.5, 32]} />
        <meshBasicMaterial color={animationColor} transparent opacity={0.8} />
      </mesh>

      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <ringGeometry args={[0.7, 0.8, 32]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.5} />
        </mesh>
      )}

      {/* Movement trail */}
      {isMoving && (
        <>
          <mesh position={[-0.3, 0, 0.3]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshBasicMaterial color="#22c55e" transparent opacity={0.5} />
          </mesh>
          <mesh position={[0.3, 0, 0.3]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshBasicMaterial color="#22c55e" transparent opacity={0.5} />
          </mesh>
        </>
      )}

      {/* 电焊火花特效 - Agent 围绕节点跑圈时产生 */}
      {isOrbiting && (
        <points ref={sparkPointsRef} geometry={sparkGeometryRef.current || undefined} material={sparkMaterialRef.current || undefined} />
      )}

      {/* Status label - 显示动画状态 */}
      <Billboard position={[0, 1.1, 0]} lockX={false} lockY={false} lockZ={false}>
        <Html center distanceFactor={8} style={{ zIndex: 10 }}>
          <div 
            className="px-2 py-1 rounded-full text-xs font-medium shadow-lg whitespace-nowrap"
            style={{
              backgroundColor: isOffline ? 'rgba(107, 114, 128, 0.95)' 
                          : currentAnimationState === 'working' ? 'rgba(34, 197, 94, 0.95)' 
                          : currentAnimationState === 'thinking' ? 'rgba(139, 92, 246, 0.95)'
                          : currentAnimationState === 'talking' ? 'rgba(6, 182, 212, 0.95)'
                          : currentAnimationState === 'celebrating' ? 'rgba(245, 158, 11, 0.95)'
                          : currentAnimationState === 'error' ? 'rgba(239, 68, 68, 0.95)'
                          : currentAnimationState === 'walking' ? 'rgba(59, 130, 246, 0.95)'
                          : 'rgba(99, 102, 241, 0.95)',
              color: 'white',
            }}
          >
            {isOffline ? (
              '离线'
            ) : currentAnimationState === 'working' || currentAnimationState === 'thinking' ? (
              <span className="flex items-center gap-1">
                {animationStateLabel}
                <span className="animate-pulse">...</span>
              </span>
            ) : (
              animationStateLabel
            )}
          </div>
        </Html>
      </Billboard>


      {/* Name label - 只在悬停时显示，选中时不显示（聊天窗口已有名称） */}
      {hovered && (
        <Billboard position={[0, 0.8, 0]} lockX={false} lockY={false} lockZ={false}>
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
      )}
    </group>
  );
}
