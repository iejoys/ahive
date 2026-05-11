/**
 * 2D游戏开发工作流模拟测试
 * 验证各节点功能和上下文衔接
 */

import { blackboard } from '../scheduler/Blackboard';
import { templateRenderer } from '../scheduler/TemplateRenderer';
import { outputParser } from '../scheduler/OutputParser';
import type { 
  Workflow, 
  WorkflowNode, 
  WorkflowEdge,
  Agent,
  Department 
} from '../types';

// ========== 模拟数据 ==========

const mockAgents: Agent[] = [
  { id: 'agent-pm', name: '产品经理-小明', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-game-designer', name: '游戏设计师-小红', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-character-artist', name: '角色美术-小李', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-bg-artist', name: '背景美术-小王', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-ui-designer', name: 'UI设计师-小张', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-gameplay-dev', name: '游戏程序-小陈', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-ui-dev', name: 'UI程序-小刘', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-backend-dev', name: '后端程序-小赵', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-sound-designer', name: '音效师-小周', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-qa-tester', name: '测试工程师-小吴', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-qa-automation', name: '自动化测试-小郑', status: 'idle', position: { x: 0, y: 0, z: 0 } },
  { id: 'agent-tech-lead', name: '技术负责人-老王', status: 'idle', position: { x: 0, y: 0, z: 0 } },
];

const mockDepartments: Department[] = [
  {
    id: 'dept-game-dev',
    name: '游戏开发部',
    icon: '🎮',
    members: [
      { agentId: 'agent-gameplay-dev', role: 'member' },
      { agentId: 'agent-ui-dev', role: 'member' },
      { agentId: 'agent-character-artist', role: 'member' },
    ],
    internalWorkflows: [],
    blackboard: {},
    settings: {
      autoAssign: true,
      assignStrategy: 'round-robin',
      notifyOnTask: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

// ========== 测试结果记录 ==========

interface TestResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'passed' | 'failed' | 'skipped';
  message: string;
  inputContext?: Record<string, unknown>;
  outputContext?: Record<string, unknown>;
  duration?: number;
  error?: string;
}

const testResults: TestResult[] = [];

// ========== 模拟执行函数 ==========

/**
 * 模拟智能体响应
 */
function mockAgentResponse(agent: Agent, task: string): { output: string; data: Record<string, unknown> } {
  const responses: Record<string, { output: string; data: Record<string, unknown> }> = {
    'agent-pm': {
      output: '需求分析完成',
      data: {
        requirementDoc: {
          title: '星际冒险 需求文档',
          targetUsers: '18-35岁游戏玩家',
          coreMechanics: ['平台跳跃', '战斗系统', '收集系统'],
          features: [
            { name: '角色控制', priority: 'P0' },
            { name: '关卡系统', priority: 'P0' },
            { name: '敌人AI', priority: 'P1' },
            { name: '存档系统', priority: 'P1' },
            { name: '成就系统', priority: 'P2' },
          ]
        },
        features: ['角色控制', '关卡系统', '敌人AI', '存档系统', '成就系统']
      }
    },
    'agent-game-designer': {
      output: '游戏设计文档完成',
      data: {
        designDoc: {
          worldSetting: '2150年，人类在外星球探险',
          protagonist: '宇航员Alex',
          levels: ['新手教程', '森林关卡', '沙漠关卡', 'Boss关卡'],
        },
        characters: ['Alex(主角)', '外星生物(敌人)', 'NPC向导'],
        levels: [
          { name: 'Level 1 - 新手教程', difficulty: 1 },
          { name: 'Level 2 - 神秘森林', difficulty: 2 },
          { name: 'Level 3 - 炽热沙漠', difficulty: 3 },
        ]
      }
    },
    'agent-character-artist': {
      output: '角色美术完成',
      data: {
        assets: ['主角idle.png', '主角walk.png', '主角jump.png', '外星生物.png']
      }
    },
    'agent-bg-artist': {
      output: '背景美术完成',
      data: {
        assets: ['森林背景.png', '沙漠背景.png', '洞穴背景.png']
      }
    },
    'agent-ui-designer': {
      output: 'UI设计完成',
      data: {
        assets: ['主菜单.png', 'HUD.png', '暂停界面.png', '按钮组.png']
      }
    },
    'agent-gameplay-dev': {
      output: '游戏逻辑开发完成',
      data: {
        modules: ['PlayerController', 'PhysicsEngine', 'EnemyAI', 'LevelManager'],
        progress: 85
      }
    },
    'agent-ui-dev': {
      output: 'UI系统开发完成',
      data: {
        modules: ['UIMenu', 'HUDSystem', 'DialogueSystem'],
        progress: 90
      }
    },
    'agent-backend-dev': {
      output: '后端服务完成',
      data: {
        modules: ['SaveSystem', 'LeaderboardAPI'],
        progress: 80
      }
    },
    'agent-sound-designer': {
      output: '音效制作完成',
      data: {
        assets: ['BGM_Menu.mp3', 'BGM_Game.mp3', 'SFX_Jump.wav', 'SFX_Attack.wav']
      }
    },
    'agent-qa-tester': {
      output: '测试报告完成',
      data: {
        report: {
          coverage: 85,
          passRate: 92,
        },
        bugs: [
          { id: 'BUG-001', severity: 'high', description: '跳跃高度不一致' },
          { id: 'BUG-002', severity: 'medium', description: 'UI按钮响应延迟' },
        ],
        bugCount: 2
      }
    },
    'agent-qa-automation': {
      output: '自动化测试完成',
      data: {
        report: {
          testCases: 150,
          passed: 147,
          failed: 3,
        },
        bugs: [],
        bugCount: 0
      }
    },
    'agent-tech-lead': {
      output: '技术审核完成',
      data: {
        version: 'v1.0.0-beta',
        status: 'ready for release',
        modules: ['PlayerController', 'PhysicsEngine', 'EnemyAI', 'LevelManager', 'UIMenu', 'HUDSystem']
      }
    },
  };
  
  return responses[agent.id] || { output: '任务完成', data: {} };
}

// ========== 测试用例 ==========

class WorkflowSimulationTest {
  private workflow: Workflow;
  private currentNodeId: string = '';
  private executionPath: string[] = [];
  private iteration: number = 0;
  
  constructor(workflow: Workflow) {
    this.workflow = workflow;
  }
  
  /**
   * 运行完整测试
   */
  async runFullTest(): Promise<void> {
    console.log('\n========================================');
    console.log('🎮 2D游戏开发工作流模拟测试');
    console.log('========================================\n');
    
    // 初始化黑板
    blackboard.clear();
    blackboard.setVariable('cached_departments', mockDepartments, { owner: 'test' });
    
    // 找到起始节点
    const targetIds = new Set(this.workflow.edges.map(e => e.target));
    const startNode = this.workflow.nodes.find(n => !targetIds.has(n.id)) || this.workflow.nodes[0];
    
    if (!startNode) {
      console.error('❌ 无法找到起始节点');
      return;
    }
    
    this.currentNodeId = startNode.id;
    
    // 顺序执行所有节点
    let maxIterations = 20;
    while (this.currentNodeId && this.iteration < maxIterations) {
      const node = this.workflow.nodes.find(n => n.id === this.currentNodeId);
      if (!node) break;
      
      await this.executeNode(node);
      this.executionPath.push(node.id);
      this.iteration++;
      
      // 找下一个节点
      const nextEdge = this.workflow.edges.find(e => e.source === this.currentNodeId);
      if (nextEdge) {
        this.currentNodeId = nextEdge.target;
      } else {
        break;
      }
    }
    
    // 输出测试结果
    this.printResults();
  }
  
  /**
   * 执行单个节点
   */
  private async executeNode(node: WorkflowNode): Promise<void> {
    const startTime = Date.now();
    console.log(`\n📌 执行节点: ${node.name} (${node.type})`);
    
    try {
      let result: TestResult = {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        status: 'passed',
        message: '',
      };
      
      switch (node.type) {
        case 'variable':
          result = this.testVariableNode(node);
          break;
        case 'agent':
          result = this.testAgentNode(node);
          break;
        case 'review':
          result = this.testReviewNode(node);
          break;
        case 'parallel':
          result = this.testParallelNode(node);
          break;
        case 'transform':
          result = this.testTransformNode(node);
          break;
        case 'condition':
          result = this.testConditionNode(node);
          break;
        case 'loop':
          result = this.testLoopNode(node);
          break;
        case 'notify':
          result = this.testNotifyNode(node);
          break;
        case 'output':
          result = this.testOutputNode(node);
          break;
        case 'department':
          result = this.testDepartmentNode(node);
          break;
        default:
          result.status = 'skipped';
          result.message = `节点类型 ${node.type} 暂无测试`;
      }
      
      result.duration = Date.now() - startTime;
      testResults.push(result);
      
      const statusIcon = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
      console.log(`  ${statusIcon} ${result.message}`);
      
      if (result.outputContext) {
        console.log(`  📤 输出: ${JSON.stringify(result.outputContext).slice(0, 100)}...`);
      }
      
    } catch (error) {
      testResults.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        status: 'failed',
        message: `执行错误: ${error}`,
        error: String(error),
        duration: Date.now() - startTime,
      });
      console.log(`  ❌ 执行错误: ${error}`);
    }
  }
  
  /**
   * 测试变量节点
   */
  private testVariableNode(node: WorkflowNode): TestResult {
    const config = node.config?.variableConfig;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少变量配置' };
    }
    
    // 设置变量到黑板
    blackboard.setVariable(config.name, config.value, { owner: node.id });
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `变量 "${config.name}" 已设置`,
      outputContext: { [config.name]: config.value },
    };
  }
  
  /**
   * 测试智能体节点
   */
  private testAgentNode(node: WorkflowNode): TestResult {
    const config = node.config;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少节点配置' };
    }
    
    // 获取输入
    const inputs = this.gatherInputs(config);
    
    // 渲染任务模板
    const taskTemplate = config.taskTemplate || `执行任务: ${node.name}`;
    const prompt = templateRenderer.render(taskTemplate, inputs);
    
    // 获取执行者
    const executorConfig = config.executor;
    let agents: Agent[] = [];
    
    if (executorConfig && executorConfig.executors.length > 0) {
      agents = executorConfig.executors
        .map(e => mockAgents.find(a => a.id === e.id))
        .filter((a): a is Agent => a !== undefined);
    }
    
    if (agents.length === 0) {
      return { ...this.createBaseResult(node), status: 'failed', message: '未找到执行者' };
    }
    
    // 模拟执行
    const primaryAgent = agents[0];
    const response = mockAgentResponse(primaryAgent, prompt);
    
    // 写入输出到黑板
    for (const [key, value] of Object.entries(response.data)) {
      blackboard.setVariable(key, value, { owner: node.id });
    }
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `智能体 "${primaryAgent.name}" 执行完成 (模式: ${executorConfig?.mode || 'single'})`,
      inputContext: inputs,
      outputContext: response.data,
    };
  }
  
  /**
   * 测试审核节点
   */
  private testReviewNode(node: WorkflowNode): TestResult {
    const config = node.config?.reviewConfig;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少审核配置' };
    }
    
    // 模拟审核评分
    const score = Math.floor(Math.random() * 30) + 70; // 70-100分
    const passed = score >= (config.passThreshold || 70);
    
    blackboard.setVariable('reviewScore', score, { owner: node.id });
    blackboard.setVariable('reviewPassed', passed, { owner: node.id });
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `审核完成: ${score}分 (${passed ? '通过' : '未通过'})`,
      outputContext: { score, passed, threshold: config.passThreshold },
    };
  }
  
  /**
   * 测试并行节点
   */
  private testParallelNode(node: WorkflowNode): TestResult {
    const config = node.config;
    const branches = config?.branches || [];
    
    if (branches.length === 0) {
      return { ...this.createBaseResult(node), status: 'failed', message: '未配置并行分支' };
    }
    
    // 模拟并行执行结果
    const results: Record<string, unknown> = {};
    
    for (const branchId of branches) {
      const branchNode = this.workflow.nodes.find(n => n.id === branchId);
      if (branchNode) {
        results[branchId] = { status: 'completed', nodeName: branchNode.name };
      }
    }
    
    blackboard.setVariable('parallelResults', results, { owner: node.id });
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `并行执行 ${branches.length} 个分支`,
      outputContext: { branchCount: branches.length, results },
    };
  }
  
  /**
   * 测试数据转换节点
   */
  private testTransformNode(node: WorkflowNode): TestResult {
    const config = node.config?.transformConfig;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少转换配置' };
    }
    
    // 获取输入
    const inputValue = blackboard.getVariableValue(config.inputVariable);
    
    // 模拟转换
    let outputValue: unknown = inputValue;
    
    if (config.type === 'jsonpath') {
      // 简单的 JSONPath 模拟
      outputValue = { transformed: true, source: config.inputVariable };
    }
    
    blackboard.setVariable(config.outputVariable, outputValue, { owner: node.id });
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `数据转换: ${config.inputVariable} → ${config.outputVariable}`,
      inputContext: { [config.inputVariable]: inputValue },
      outputContext: { [config.outputVariable]: outputValue },
    };
  }
  
  /**
   * 测试条件节点
   */
  private testConditionNode(node: WorkflowNode): TestResult {
    const config = node.config;
    const conditions = config?.conditions || [];
    
    // 评估条件
    let matchedCondition = null;
    
    for (const condition of conditions) {
      // 简单的条件评估模拟
      const value = blackboard.getVariableValue('bugCount') || blackboard.getVariableValue('reviewScore');
      
      if (condition.expression.includes('bugCount') && Number(value) === 0) {
        matchedCondition = condition;
        break;
      }
      if (condition.expression.includes('reviewScore') && Number(value) >= 80) {
        matchedCondition = condition;
        break;
      }
    }
    
    const targetNode = matchedCondition?.targetNode || config?.defaultNode;
    
    if (targetNode) {
      this.currentNodeId = targetNode;
    }
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: matchedCondition 
        ? `条件匹配: ${matchedCondition.label} → ${targetNode}` 
        : `使用默认分支 → ${targetNode}`,
      outputContext: { matchedCondition: matchedCondition?.label, targetNode },
    };
  }
  
  /**
   * 测试循环节点
   */
  private testLoopNode(node: WorkflowNode): TestResult {
    const config = node.config?.loopConfig;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少循环配置' };
    }
    
    // 模拟循环
    const iterations = 2; // 模拟迭代次数
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `循环类型: ${config.type}, 迭代次数: ${iterations}`,
      outputContext: { iterations, type: config.type },
    };
  }
  
  /**
   * 测试通知节点
   */
  private testNotifyNode(node: WorkflowNode): TestResult {
    const config = node.config?.notifyConfig;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少通知配置' };
    }
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `通知已发送到: ${config.channels.join(', ')}`,
      outputContext: { channels: config.channels, recipients: config.recipients },
    };
  }
  
  /**
   * 测试输出节点
   */
  private testOutputNode(node: WorkflowNode): TestResult {
    const config = node.config?.outputConfig;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少输出配置' };
    }
    
    const value = blackboard.getVariableValue(config.name);
    const outputKey = config.isFinalOutput ? `final_output_${config.name}` : `output_${config.name}`;
    
    blackboard.setVariable(outputKey, value, { owner: node.id });
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `输出变量: ${config.name} (最终输出: ${config.isFinalOutput})`,
      outputContext: { [outputKey]: value },
    };
  }
  
  /**
   * 测试部门节点
   */
  private testDepartmentNode(node: WorkflowNode): TestResult {
    const config = node.config?.departmentConfig;
    if (!config) {
      return { ...this.createBaseResult(node), status: 'failed', message: '缺少部门配置' };
    }
    
    const department = mockDepartments.find(d => d.id === config.departmentId);
    
    if (!department) {
      return { ...this.createBaseResult(node), status: 'failed', message: '未找到部门' };
    }
    
    return {
      ...this.createBaseResult(node),
      status: 'passed',
      message: `部门任务已分配: ${department.name}`,
      outputContext: { departmentId: config.departmentId, memberCount: department.members.length },
    };
  }
  
  /**
   * 收集输入变量
   */
  private gatherInputs(config: Record<string, unknown>): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const mappings = (config.inputs as Array<{ name: string; source: string; sourceKey?: string }>) || [];
    
    for (const mapping of mappings) {
      let value: unknown;
      
      switch (mapping.source) {
        case 'blackboard':
          value = blackboard.getVariableValue(mapping.sourceKey || mapping.name);
          break;
        case 'prev-output':
          // 支持指定节点格式: "nodeId:variableName"
          if (mapping.sourceKey?.includes(':')) {
            const [nodeId, varName] = mapping.sourceKey.split(':');
            value = blackboard.getVariableValue(varName);
          } else {
            value = blackboard.getVariableValue(mapping.sourceKey || mapping.name);
          }
          break;
        default:
          value = blackboard.getVariableValue(mapping.name);
      }
      
      inputs[mapping.name] = value;
    }
    
    return inputs;
  }
  
  /**
   * 创建基础结果
   */
  private createBaseResult(node: WorkflowNode): TestResult {
    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      status: 'passed',
      message: '',
    };
  }
  
  /**
   * 打印测试结果
   */
  private printResults(): void {
    console.log('\n========================================');
    console.log('📊 测试结果汇总');
    console.log('========================================\n');
    
    const passed = testResults.filter(r => r.status === 'passed').length;
    const failed = testResults.filter(r => r.status === 'failed').length;
    const skipped = testResults.filter(r => r.status === 'skipped').length;
    
    console.log(`总计: ${testResults.length} 个节点`);
    console.log(`✅ 通过: ${passed}`);
    console.log(`❌ 失败: ${failed}`);
    console.log(`⏭️ 跳过: ${skipped}`);
    
    console.log('\n📋 执行路径:');
    console.log(this.executionPath.map(id => {
      const node = this.workflow.nodes.find(n => n.id === id);
      return node ? `${node.name}(${node.type})` : id;
    }).join(' → '));
    
    console.log('\n📊 黑板最终状态:');
    const allVars = blackboard.getAllVariables();
    console.log(`变量数量: ${allVars.length}`);
    allVars.forEach(v => {
      console.log(`  - ${v.key}: ${JSON.stringify(v.value).slice(0, 50)}...`);
    });
  }
}

// ========== 导出测试函数 ==========

export async function runWorkflowSimulation(): Promise<void> {
  // 加载工作流定义
  const workflowPath = '../doc/workflow-samples/2d-game-development-workflow.json';
  
  // 这里使用硬编码的工作流进行测试
  const workflow: Workflow = {
    id: 'workflow-2d-game-dev-001',
    name: '2D游戏开发完整流程',
    nodes: [
      { id: 'node-start', type: 'variable', name: '项目初始化', position: { x: 0, y: 0 }, config: { variableConfig: { name: 'projectInit', value: { gameName: '星际冒险' }, type: 'json' } } },
      { id: 'node-requirement-analysis', type: 'agent', name: '需求分析', position: { x: 100, y: 0 }, config: { executor: { mode: 'single', executors: [{ type: 'agent', id: 'agent-pm', weight: 1 }] }, taskTemplate: '分析需求', outputs: [{ name: 'requirementDoc', extractPath: '$.requirementDoc' }] } },
      { id: 'node-game-design', type: 'agent', name: '游戏设计', position: { x: 200, y: 0 }, config: { executor: { mode: 'single', executors: [{ type: 'agent', id: 'agent-game-designer', weight: 1 }] }, taskTemplate: '设计游戏', inputs: [{ name: 'requirementDoc', source: 'prev-output', sourceKey: 'requirementDoc' }], outputs: [{ name: 'designDoc', extractPath: '$.designDoc' }] } },
      { id: 'node-parallel-dev', type: 'parallel', name: '并行开发', position: { x: 300, y: 0 }, config: { branches: ['node-art', 'node-code'], mergeType: 'all' } },
      { id: 'node-art', type: 'agent', name: '美术设计', position: { x: 400, y: -50 }, config: { executor: { mode: 'single', executors: [{ type: 'agent', id: 'agent-character-artist', weight: 1 }] }, taskTemplate: '美术制作', outputs: [{ name: 'artAssets', extractPath: '$.assets' }] } },
      { id: 'node-code', type: 'agent', name: '程序开发', position: { x: 400, y: 50 }, config: { executor: { mode: 'all', executors: [{ type: 'agent', id: 'agent-gameplay-dev', weight: 1 }, { type: 'agent', id: 'agent-ui-dev', weight: 1 }] }, taskTemplate: '代码开发', outputs: [{ name: 'codeModules', extractPath: '$.modules' }] } },
      { id: 'node-integration', type: 'agent', name: '资源集成', position: { x: 500, y: 0 }, config: { executor: { mode: 'single', executors: [{ type: 'agent', id: 'agent-tech-lead', weight: 1 }] }, taskTemplate: '集成资源', inputs: [{ name: 'artAssets', source: 'prev-output', sourceKey: 'node-art:artAssets' }, { name: 'codeModules', source: 'prev-output', sourceKey: 'node-code:codeModules' }], outputs: [{ name: 'buildVersion', extractPath: '$.version' }] } },
      { id: 'node-testing', type: 'agent', name: '测试执行', position: { x: 600, y: 0 }, config: { executor: { mode: 'all', executors: [{ type: 'agent', id: 'agent-qa-tester', weight: 1 }] }, taskTemplate: '执行测试', outputs: [{ name: 'bugCount', extractPath: '$.bugCount' }] } },
      { id: 'node-condition', type: 'condition', name: 'Bug检查', position: { x: 700, y: 0 }, config: { conditions: [{ label: '有Bug', expression: 'bugCount > 0', targetNode: 'node-testing' }, { label: '无Bug', expression: 'bugCount == 0', targetNode: 'node-review' }], defaultNode: 'node-review' } },
      { id: 'node-review', type: 'review', name: '最终审核', position: { x: 800, y: 0 }, config: { reviewConfig: { passThreshold: 80 } } },
      { id: 'node-notify', type: 'notify', name: '发布通知', position: { x: 900, y: 0 }, config: { notifyConfig: { channels: ['email'], recipients: ['team@example.com'], template: '游戏已发布' } } },
      { id: 'node-output', type: 'output', name: '项目输出', position: { x: 1000, y: 0 }, config: { outputConfig: { name: 'finalDelivery', type: 'json', isFinalOutput: true } } },
    ],
    edges: [
      { id: 'e1', source: 'node-start', target: 'node-requirement-analysis' },
      { id: 'e2', source: 'node-requirement-analysis', target: 'node-game-design' },
      { id: 'e3', source: 'node-game-design', target: 'node-parallel-dev' },
      { id: 'e4', source: 'node-parallel-dev', target: 'node-integration' },
      { id: 'e5', source: 'node-integration', target: 'node-testing' },
      { id: 'e6', source: 'node-testing', target: 'node-condition' },
      { id: 'e7', source: 'node-condition', target: 'node-review' },
      { id: 'e8', source: 'node-review', target: 'node-notify' },
      { id: 'e9', source: 'node-notify', target: 'node-output' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  const test = new WorkflowSimulationTest(workflow);
  await test.runFullTest();
}

// 执行测试
runWorkflowSimulation().catch(console.error);