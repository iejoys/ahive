import type { Agent } from '../../../types';
import { AgentCharacterV2 } from './AgentCharacterV2';
import { CuteRobot } from '../CuteRobot';

interface CharacterFactoryProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
}

/**
 * 智能体角色工厂组件
 * 默认使用可爱机器人形象
 * AHIVECORE 核心智能体不在此渲染（已在 AgentWorld 中单独渲染大机器人）
 */
export function CharacterFactory({ agent, isSelected, onClick, onDoubleClick }: CharacterFactoryProps) {
  // AHIVECORE 核心智能体不渲染小的 CuteRobot，它已在 AgentWorld 中作为大机器人渲染
  if (agent.type === 'ahivecore') {
    return null;
  }
  
  // 检查是否离线
  const isOffline = agent.status === 'offline';
  
  return (
    <CuteRobot
      key={agent.id}
      agentId={agent.id}
      status={agent.status}
      isOffline={isOffline}
      position={[agent.position.x, agent.position.y, agent.position.z]}
      interactive={true}
      isSelected={isSelected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}

export default CharacterFactory;