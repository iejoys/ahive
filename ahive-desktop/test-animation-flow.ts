/**
 * 动画流程测试脚本
 * 测试从工作流事件到前端动画状态更新的完整链路
 */

// 模拟测试环境
console.log('========== 动画流程测试 ==========\n');

// 1. 测试 AgentAnimationManager
import { getAgentAnimationManager, updateAnimationFromWorkflowEvent } from './electron/workflow/animation/AgentAnimation';

const manager = getAgentAnimationManager();

// 设置广播回调来捕获事件
let broadcastEvents: any[] = [];
manager.setBroadcastCallback((event) => {
  broadcastEvents.push(event);
  console.log(`[TEST] Broadcast event: type=${event.type}, agentId=${event.agentId}, state=${event.data.currentState}`);
});

console.log('\n--- 测试 1: 注册智能体 ---');
manager.registerAgent({ agentId: 'test-agent-1', position: { x: 0, y: 0, z: 0 } });
console.log('Registered agents:', manager.getAllStates().map(a => a.agentId));

console.log('\n--- 测试 2: 通过 updateAnimationFromWorkflowEvent 更新状态 ---');
broadcastEvents = [];
updateAnimationFromWorkflowEvent('test-agent-1', 'agent-chat', {});
console.log('Broadcast events after agent-chat:', broadcastEvents.length);

console.log('\n--- 测试 3: 测试自动注册 ---');
broadcastEvents = [];
updateAnimationFromWorkflowEvent('unregistered-agent', 'thinking', {});
console.log('Broadcast events after thinking (auto-register):', broadcastEvents.length);
console.log('Registered agents after auto-register:', manager.getAllStates().map(a => a.agentId));

console.log('\n--- 测试 4: 测试不同事件类型 ---');
const eventTypes = [
  'workflow_task_start',
  'workflow_task_complete',
  'thinking',
  'text-delta',
  'text-done',
  'agent-chat',
  'workflow_report',
  'workflow-completed',
  'workflow-error'
];

for (const eventType of eventTypes) {
  broadcastEvents = [];
  updateAnimationFromWorkflowEvent('test-agent-1', eventType, {});
  console.log(`Event: ${eventType} -> State: ${broadcastEvents[0]?.data?.currentState || 'no event'}`);
}

console.log('\n--- 测试 5: 检查状态最小持续时间 ---');
// 快速连续更新应该被忽略
broadcastEvents = [];
manager.updateState('test-agent-1', 'idle');
console.log('First update (idle):', broadcastEvents.length, 'events');

broadcastEvents = [];
manager.updateState('test-agent-1', 'working'); // 应该被忽略（状态变化太快）
console.log('Second update (working) - should be ignored:', broadcastEvents.length, 'events');

console.log('\n--- 测试 6: 模拟 WebSocketServer 的 extractAgentIdsFromEvent ---');
// 模拟事件
const mockEvents = [
  { type: 'agent-chat', agentId: 'ahivecore', data: { toAgentId: 'mmutn7fs-7w2qpo' } },
  { type: 'workflow_task_start', agentId: 'workflow-engine', data: { agentId: 'test-agent-1' } },
  { type: 'thinking', agentId: 'test-agent-1' },
];

function extractAgentIdsFromEvent(event: any): string[] {
  const agentIds: string[] = [];
  
  if (event.agentId && event.agentId !== 'workflow-engine' && event.agentId !== 'workflow-scheduler') {
    agentIds.push(event.agentId);
  }
  
  if (event.data) {
    if (event.data.agentId) {
      agentIds.push(event.data.agentId);
    }
    if (event.data.toAgentId) {
      agentIds.push(event.data.toAgentId);
    }
  }
  
  return [...new Set(agentIds)];
}

for (const event of mockEvents) {
  const agentIds = extractAgentIdsFromEvent(event);
  console.log(`Event: ${event.type}, agentId=${event.agentId} -> Extracted: [${agentIds.join(', ')}]`);
  
  // 模拟更新动画
  for (const agentId of agentIds) {
    broadcastEvents = [];
    updateAnimationFromWorkflowEvent(agentId, event.type, event);
    console.log(`  -> ${agentId} state: ${broadcastEvents[0]?.data?.currentState || 'no change'}`);
  }
}

console.log('\n--- 测试 7: 最终状态检查 ---');
const agents = manager.getAllStates();
for (const data of agents) {
  console.log(`Agent: ${data.agentId}, State: ${data.state}, Action: ${data.currentAction}`);
}

console.log('\n========== 测试完成 ==========');
