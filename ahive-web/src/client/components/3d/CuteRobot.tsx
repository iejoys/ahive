import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RobotHead } from './parts/RobotHead';
import { RobotBody } from './parts/RobotBody';
import { HoverHalo } from './parts/HoverHalo';
import { useStore } from '../../store/useStore';

/**
 * 名字标签组件 - 使用 Canvas 绘制文字纹理，不依赖外部字体
 */
function NameLabel({ name, isThinking, position }: { name: string; isThinking: boolean; position: [number, number, number] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  
  useEffect(() => {
    if (!meshRef.current) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 透明背景
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制文字阴影（发光效果）
    ctx.shadowColor = isThinking ? '#00D4FF' : '#000000';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // 绘制文字 - 字体放大
    ctx.fillStyle = isThinking ? '#00D4FF' : '#FFFFFF';
    ctx.font = 'bold 48px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayText = name.length > 10 ? name.substring(0, 9) + '..' : name;
    ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);
    
    // 思考中添加指示符
    if (isThinking) {
      ctx.shadowColor = '#00FF88';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#00FF88';
      ctx.beginPath();
      ctx.arc(canvas.width - 40, canvas.height / 2, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // 更新纹理
    if (textureRef.current) {
      textureRef.current.dispose();
    }
    textureRef.current = new THREE.CanvasTexture(canvas);
    textureRef.current.needsUpdate = true;
    
    // 应用到材质
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    material.map = textureRef.current;
    material.transparent = true;
    material.depthTest = false;
    material.needsUpdate = true;
    
    return () => {
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
    };
  }, [name, isThinking]);
  
  return (
    <mesh ref={meshRef} position={position}>
      <planeGeometry args={[3.0, 0.8]} />
      <meshBasicMaterial transparent side={THREE.DoubleSide} depthTest={false} />
    </mesh>
  );
}

interface CuteRobotProps {
  agentId: string;
  status: 'idle' | 'working' | 'paused' | 'error' | 'offline';
  isOffline: boolean;
  position?: [number, number, number];
  interactive?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

/**
 * 可爱机器人组件
 */
export function CuteRobot({ 
  agentId,
  status,
  isOffline,
  position = [0, 0, 0],
  interactive = true,
  isSelected = false,
  onClick,
  onDoubleClick
}: CuteRobotProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const { camera } = useThree();
  const { agents, movementTarget, setMovementTarget, updateAgentPosition, offlineAgents, agentTypingStatus, agentAnimationStates } = useStore();
  
  // 获取智能体名字
  const agent = useMemo(() => agents.find(a => a.id === agentId), [agents, agentId]);
  
  // 获取动画状态 - 处理 ID 格式匹配
  const animationStateKey = agent?.agentId || agentId.replace('a2a-', '').replace('agent-', '');
  const animationState = agentAnimationStates[animationStateKey] || agentAnimationStates[agentId];
  const currentAnimationState = animationState?.state || 'idle';
  
  // 名字获取逻辑
  const agentName = useMemo(() => {
    if (!agent) return 'Robot';
    if (agent.name && agent.name.trim()) return agent.name;
    if (agentId.startsWith('a2a-')) {
      const extracted = agentId.replace('a2a-', '');
      try {
        return decodeURIComponent(extracted) || 'A2A Agent';
      } catch {
        return extracted || 'A2A Agent';
      }
    }
    return 'Robot';
  }, [agent, agentId]);
  
  // 检查是否离线
  const actualIsOffline = offlineAgents.has(agentId) || isOffline;
  
  // 是否正在工作/思考（使用 agentTypingStatus 或动画状态）
  const isThinking = ((agentTypingStatus[agentId] || status === 'working') || currentAnimationState === 'thinking' || currentAnimationState === 'working') && !actualIsOffline;
  
  // 移动逻辑
  const targetPos = useRef<THREE.Vector3 | null>(null);
  const currentPos = useRef(new THREE.Vector3(position[0], position[1], position[2]));
  
  useEffect(() => {
    if (movementTarget && movementTarget.agentId === agentId && !actualIsOffline) {
      targetPos.current = new THREE.Vector3(
        movementTarget.targetPosition.x,
        movementTarget.targetPosition.y,
        movementTarget.targetPosition.z
      );
    }
  }, [movementTarget, agentId, actualIsOffline]);
  
  // 动画
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    const time = state.clock.elapsedTime;
    
    // 移动动画
    if (targetPos.current && !actualIsOffline) {
      const target = targetPos.current;
      const current = currentPos.current;
      const distance = current.distanceTo(target);
      
      if (distance > 0.1) {
        const direction = new THREE.Vector3().subVectors(target, current).normalize();
        const speed = 3 * delta;
        current.add(direction.multiplyScalar(speed));
        groupRef.current.position.x = current.x;
        groupRef.current.position.z = current.z;
      } else {
        targetPos.current = null;
        setMovementTarget({ agentId: '', targetPosition: { x: 0, y: 0, z: 0 } });
        updateAgentPosition(agentId, { x: current.x, y: current.y, z: current.z });
      }
    } else {
      groupRef.current.position.x = position[0];
      groupRef.current.position.z = position[2];
      currentPos.current.set(position[0], position[1], position[2]);
    }
    
    // 悬浮效果
    const floatY = Math.sin(time * 0.8) * 0.05;
    groupRef.current.position.y = position[1] + floatY;
    
    // 状态驱动的动画效果
    switch (currentAnimationState) {
      case 'thinking':
        // 思考动画：歪头
        groupRef.current.rotation.z = Math.sin(time * 2) * 0.15;
        groupRef.current.rotation.y = Math.sin(time * 1.5) * 0.1;
        break;
      case 'working':
        // 工作动画：轻微旋转
        groupRef.current.rotation.z = Math.sin(time * 0.5) * 0.03;
        groupRef.current.rotation.y += 0.01;
        break;
      case 'talking':
        // 对话动画：点头
        groupRef.current.rotation.x = Math.sin(time * 3) * 0.1;
        groupRef.current.rotation.z = Math.sin(time * 0.5) * 0.03;
        break;
      case 'celebrating':
        // 庆祝动画：跳跃
        groupRef.current.position.y = position[1] + Math.abs(Math.sin(time * 4)) * 0.3;
        groupRef.current.rotation.z = Math.sin(time * 2) * 0.2;
        break;
      case 'error':
        // 错误动画：抖动
        groupRef.current.rotation.z = Math.sin(time * 10) * 0.1;
        break;
      default:
        // 默认：轻微摇摆
        groupRef.current.rotation.z = Math.sin(time * 0.5) * 0.03;
    }
  });
  
  // 双击检测
  const lastClickTimeRef = useRef(0);
  const DOUBLE_CLICK_THRESHOLD = 300; // 300ms 内两次点击算双击

  const handleClick = (e: any) => {
    e.stopPropagation();
    const now = Date.now();
    const timeDiff = now - lastClickTimeRef.current;
    
    if (timeDiff < DOUBLE_CLICK_THRESHOLD && timeDiff > 0) {
      // 双击
      console.log('[CuteRobot] double clicked:', agentId);
      if (interactive && onDoubleClick) {
        onDoubleClick();
      }
      lastClickTimeRef.current = 0;
    } else {
      // 单击
      console.log('[CuteRobot] clicked:', agentId);
      if (interactive && onClick) {
        onClick();
      }
      lastClickTimeRef.current = now;
    }
  };
  
  return (
    <group 
      ref={groupRef}
      position={position}
      onClick={handleClick}
      onPointerOver={(e) => {
        if (interactive) {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'default';
      }}
    >
      {/* 名字标签 - 使用 Canvas 纹理绘制文字 */}
      <NameLabel 
        name={agentName} 
        isThinking={isThinking} 
        position={[0, 0.58, 0]} 
      />
      
      {/* 点击检测区域 - 透明的包围盒，专门用于接收点击 */}
      <mesh position={[0, 0.2, 0]} onClick={handleClick} onPointerOver={(e) => {
        if (interactive) {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }
      }} onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'default';
      }}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      
      {/* 悬浮指示器 */}
      {hovered && !isSelected && (
        <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.45, 0.5, 32]} />
          <meshBasicMaterial color="#00D4FF" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
      
      {/* 头部 */}
      <RobotHead status={status} isOffline={actualIsOffline} />
      
      {/* 躯干 */}
      <RobotBody status={status} isOffline={actualIsOffline} />
      
      {/* 悬浮光环 - 脚下的圈，选中时显示流动动画 */}
      <HoverHalo status={status} isOffline={actualIsOffline} isSelected={isSelected} />
    </group>
  );
}

export default CuteRobot;