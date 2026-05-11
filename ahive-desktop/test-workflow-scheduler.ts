/**
 * 测试 WorkflowScheduler
 */

import { WorkflowScheduler, type WorkflowSchedulerConfig } from './electron/workflow';
import type { Agent, Workflow } from './electron/workflow/types';

// 模拟 WebSocket 服务器
const mockWsServer = {
  broadcastAll: (data: any) => console.log('[MockWS] broadcast:', data),
  on: (_event: string, _callback: any) => console.log('[MockWS] on:', _event),
  getClientCount: () => 0,
};

// 模拟 Agent 数据
const mockAgents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    status: 'idle',
    avatar: '',
    skills: [],
    type: 'custom',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

// 模拟 Workflow 数据
const mockWorkflows: Workflow[] = [
  {
    id: 'workflow-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    nodes: [
      {
        id: 'node-1',
        type: 'agent',
        name: 'Start Node',
        position: { x: 0, y: 0 },
        agentId: 'agent-1',
      }
    ],
    edges: [],
    isActive: true,
  }
];

// 模拟 callAgent
async function mockCallAgent(agent: Agent, _prompt: string, _timeout?: number) {
  console.log(`[MockCallAgent] Calling agent: ${agent.name}`);
  return {
    success: true,
    output: 'This is a mock response from the agent.',
  };
}

// 模拟 getWorkflow
function getWorkflow(workflowId: string): Workflow | undefined {
  console.log(`[getWorkflow] Looking for workflow: ${workflowId}`);
  const workflow = mockWorkflows.find(w => w.id === workflowId);
  console.log(`[getWorkflow] Found:`, workflow ? workflow.name : 'NOT FOUND');
  return workflow;
}

// 创建调度器配置
const schedulerConfig: WorkflowSchedulerConfig = {
  wsServer: mockWsServer as any,
  getAgents: () => mockAgents,
  getWorkflow: getWorkflow,
  callAgent: mockCallAgent,
  stateDir: './test-data/workflow-states',
};

// 创建调度器
console.log('[Test] Creating WorkflowScheduler...');
const scheduler = new WorkflowScheduler(schedulerConfig);

// 测试执行工作流
async function testExecute() {
  console.log('\n[Test] Starting test...');
  
  try {
    // 启动调度器
    await scheduler.start();
    console.log('[Test] Scheduler started');
    
    // 测试1: 执行不存在的工作流
    console.log('\n[Test 1] Executing non-existent workflow...');
    const result1 = await scheduler.execute('non-existent-workflow');
    console.log('[Test 1] Result:', result1);
    if (!result1.success && result1.error) {
      console.log('[Test 1] ✅ Correctly returned error:', result1.error);
    } else {
      console.log('[Test 1] ❌ Should have returned error');
    }
    
    // 测试2: 执行正常工作流
    console.log('\n[Test 2] Executing workflow-1...');
    const result2 = await scheduler.execute('workflow-1', { testVar: 'testValue' });
    console.log('[Test 2] Execute result:', result2);
    
    // 等待一下
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 获取状态
    const state = scheduler.getState(result2.instanceId);
    console.log('[Test 2] State:', state);
    
    // 停止调度器
    await scheduler.stop();
    console.log('[Test] Scheduler stopped');
    
  } catch (error) {
    console.error('[Test] Error:', error);
  }
}

testExecute();