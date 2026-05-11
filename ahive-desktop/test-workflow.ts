/**
 * 工作流执行测试脚本
 * 验证 WorkflowEngine 和 WorkflowScheduler 的初始化是否正确
 */

import { WorkflowEngine, WorkflowEngineConfig } from './electron/workflow/core/WorkflowEngine';
import { WorkflowScheduler, WorkflowSchedulerConfig } from './electron/workflow/core/WorkflowScheduler';
import type { Workflow, Agent } from './electron/workflow/types';

// 测试数据
const testWorkflow: Workflow = {
  id: 'test-workflow-001',
  name: '测试工作流',
  description: '用于验证 WorkflowEngine 初始化',
  nodes: [
    {
      id: 'node-1',
      type: 'agent',
      name: '开始节点',
      position: { x: 100, y: 100 },
      agentId: 'agent-001',
      config: {
        taskTemplate: '你好，请执行任务',
      },
    },
    {
      id: 'node-2',
      type: 'agent',
      name: '结束节点',
      position: { x: 300, y: 100 },
      agentId: 'agent-002',
      config: {
        taskTemplate: '任务完成',
      },
    },
  ],
  edges: [
    {
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
    },
  ],
  isActive: true,
};

const testAgents: Agent[] = [
  {
    id: 'agent-001',
    name: '测试Agent1',
    description: '第一个测试Agent',
    status: 'idle',
    avatar: '',
    agentId: 'agent-001',
    agentType: 'a2a',
    skills: ['test'],
    type: 'a2a',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'agent-002',
    name: '测试Agent2',
    description: '第二个测试Agent',
    status: 'idle',
    avatar: '',
    agentId: 'agent-002',
    agentType: 'a2a',
    skills: ['test'],
    type: 'a2a',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// 模拟 callAgent 函数
const mockCallAgent = async (
  agent: Agent,
  prompt: string,
  _timeout?: number
): Promise<{ success: boolean; output: string; error?: string }> => {
  console.log(`[MockCallAgent] Calling agent: ${agent.name} with prompt: ${prompt}`);
  return {
    success: true,
    output: `Agent ${agent.name} executed successfully`,
  };
};

// 测试 WorkflowEngine 创建
async function testWorkflowEngineCreation() {
  console.log('\n=== 测试 WorkflowEngine 创建 ===\n');
  
  try {
    const config: WorkflowEngineConfig = {
      workflow: testWorkflow,
      agents: testAgents,
      callAgent: mockCallAgent,
      stateDir: './test-data/workflow-states',
    };
    
    console.log('创建 WorkflowEngine...');
    const engine = new WorkflowEngine(config);
    
    console.log('✅ WorkflowEngine 创建成功');
    console.log(`   - Workflow ID: ${testWorkflow.id}`);
    console.log(`   - Workflow Name: ${testWorkflow.name}`);
    
    // 获取上下文验证
    const context = engine.getContext();
    console.log('✅ 执行上下文获取成功');
    console.log(`   - Instance ID: ${context.instanceId}`);
    console.log(`   - Workflow ID: ${context.workflowId}`);
    console.log(`   - Status: ${context.status}`);
    
    return true;
  } catch (error: any) {
    console.error('❌ WorkflowEngine 创建失败:', error.message);
    console.error('   Stack:', error.stack);
    return false;
  }
}

// 测试 WorkflowScheduler 创建
async function testWorkflowSchedulerCreation() {
  console.log('\n=== 测试 WorkflowScheduler 创建 ===\n');
  
  try {
    // 模拟 WebSocketServer
    const mockWsServer = {
      broadcastAll: (data: any) => {
        console.log('[MockWsServer] Broadcasting:', JSON.stringify(data));
      },
    };
    
    const config: WorkflowSchedulerConfig = {
      wsServer: mockWsServer as any,
      getAgents: () => testAgents,
      getWorkflow: (workflowId: string) => {
        if (workflowId === testWorkflow.id) {
          return testWorkflow;
        }
        return undefined;
      },
      callAgent: mockCallAgent,
      stateDir: './test-data/workflow-states',
    };
    
    console.log('创建 WorkflowScheduler...');
    const scheduler = new WorkflowScheduler(config);
    
    console.log('✅ WorkflowScheduler 创建成功');
    
    // 测试 execute 方法
    console.log('\n测试 execute 方法...');
    const result = await scheduler.execute(testWorkflow.id, { testVar: 'testValue' });
    
    if (result.success) {
      console.log('✅ WorkflowScheduler.execute 成功');
      console.log(`   - Instance ID: ${result.instanceId}`);
    } else {
      console.log('❌ WorkflowScheduler.execute 失败');
      console.log(`   - Instance ID: ${result.instanceId}`);
    }
    
    return result.success;
  } catch (error: any) {
    console.error('❌ WorkflowScheduler 创建/执行失败:', error.message);
    console.error('   Stack:', error.stack);
    return false;
  }
}

// 主测试函数
async function main() {
  console.log('========================================');
  console.log('    工作流执行测试');
  console.log('========================================');
  
  const engineResult = await testWorkflowEngineCreation();
  const schedulerResult = await testWorkflowSchedulerCreation();
  
  console.log('\n========================================');
  console.log('    测试结果汇总');
  console.log('========================================');
  console.log(`WorkflowEngine 创建: ${engineResult ? '✅ 成功' : '❌ 失败'}`);
  console.log(`WorkflowScheduler 执行: ${schedulerResult ? '✅ 成功' : '❌ 失败'}`);
  
  if (engineResult && schedulerResult) {
    console.log('\n🎉 所有测试通过！修复正确。');
  } else {
    console.log('\n⚠️ 存在失败的测试，需要进一步修复。');
  }
}

main().catch(console.error);