/**
 * 工作流编排器（迭代式精化版）
 * 
 * 核心功能：
 * 1. 第一层：生成工作流骨架（节点列表 + 基本连接）
 * 2. 第二层：逐节点精化（补充详细配置）
 * 3. 第三层：连接优化（数据流转逻辑）
 * 4. 第四层：最终验证（完整性检查）
 * 
 * 每层完成后立即保存并通知前端刷新
 * 
 * 设计理念（用户原话）：
 * "AHIVECORE的任务就是生成这个JSON文档并将其存放到客户端工作流文件夹中，
 * 然后使前端加载这个文件展现工作流UI，不过有一点需要再让他执行，
 * 就是一次性生成的JSON文件可能不那么细节化，要让AHIVECORE调用大模型
 * 对每个节点进行复查和调整。整个过程像打印机一样，一层一层的去完美工作流设计。"
 */

import { logger } from '../utils/index.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { ProviderManager } from '../providers/provider-manager.js';
import { getWSClient } from '../monitoring/ws-client.js';

// ==================== 类型定义 ====================

/**
 * 工作流 JSON 结构定义
 */
export interface WorkflowJSON {
  id: string;
  name: string;
  description?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  type: 'variable' | 'agent' | 'review' | 'condition' | 'parallel' | 'loop' | 'output';
  name: string;
  position: { x: number; y: number };
  config: Record<string, any>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: Record<string, any>;
}

/**
 * 工作流生成结果
 */
export interface WorkflowGenerationResult {
  filePath: string;      // JSON 文件路径
  workflowId: string;    // 工作流 ID
  workflowName: string;  // 工作流名称
}

/**
 * 工作流生成事件
 */
export interface WorkflowGenerationEvent {
  type: 'workflow-generation';
  event: string;
  data: any;
  timestamp: number;
  source: 'ahivecore';
}

// ==================== 工作流结构提示词 ====================

/**
 * 工作流 JSON 结构提示词
 * 参考: ahive-1.0/doc/workflow-samples/2d-game-development-workflow.json
 */
const WORKFLOW_SCHEMA_PROMPT = `
## 工作流 JSON 结构说明

请根据用户意图，生成符合以下结构的工作流 JSON：

### 根结构
{
  "id": "workflow-xxx-001",           // 唯一 ID
  "name": "工作流名称",                // 显示名称
  "description": "工作流描述",         // 功能说明
  "version": "1.0.0",
  "createdAt": "ISO时间",
  "updatedAt": "ISO时间",
  "nodes": [...],                     // 节点列表
  "edges": [...]                      // 边列表
}

### 节点类型 (nodes[].type)

1. **variable** - 变量节点（初始化数据，支持多变量打包）
   {
     "id": "node-start",
     "type": "variable",
     "name": "项目初始化",
     "position": { "x": 100, "y": 100 },
     "config": {
       "variableConfig": {
         "version": "v2",
         "packedVariableName": "project",   // 打包后的变量名，存入黑板时使用
         "groups": [
           { "id": "basic", "name": "基本信息", "icon": "📦" },
           { "id": "path", "name": "路径配置", "icon": "📁" }
         ],
         "variables": [
           { "name": "projectName", "value": "我的项目", "type": "string", "group": "basic", "required": true, "description": "项目名称" },
           { "name": "workDir", "value": "./", "type": "directory", "group": "path", "description": "工作目录" },
           { "name": "apiKey", "value": "xxx", "type": "string", "sensitive": true, "agentId": "agent-coder", "description": "专用API密钥" }
         ]
       }
     }
   }
   
   变量节点特性：
   - 支持多变量定义，可自由增删
   - 支持分组管理（basic/path/git/env等）
   - 支持多种类型：string/number/boolean/json/array/object/file/directory
   - 支持专用智能体参数（agentId字段）
   - 支持敏感信息标记（sensitive字段）
   - 所有变量打包为一个JSON对象存入黑板，引用方式：{{project.变量名}}
   - 专用参数存入 {{project._agentPrivate.agentId.变量名}}

2. **agent** - 智能体节点（执行任务）
   {
     "id": "node-xxx",
     "type": "agent",
     "name": "任务名称",
     "position": { "x": 300, "y": 100 },
     "config": {
       "executor": {
         "mode": "single",            // single | any | all | vote | round-robin
         "executors": [{ "type": "agent", "id": "agent-xxx", "weight": 1 }]
       },
       "taskTemplate": "任务描述，支持 {{变量}} 插值",
       "inputs": [
         { "name": "变量名", "source": "blackboard", "sourceKey": "变量名", "required": true }
       ],
       "outputs": [
         { "name": "输出名", "extractPath": "$.字段", "required": true }
       ],
       "timeout": 120000,
       "retryCount": 2
     }
   }

3. **review** - 审核节点
   {
     "id": "node-review",
     "type": "review",
     "name": "审核",
     "position": { "x": 500, "y": 100 },
     "config": {
       "reviewConfig": {
         "reviewType": "score",
         "criteria": [
           { "name": "完整性", "description": "...", "weight": 0.3 }
         ],
         "passThreshold": 70,
         "reviewers": ["agent-xxx"]
       }
     }
   }

4. **condition** - 条件节点（分支）
   {
     "id": "node-condition",
     "type": "condition",
     "name": "条件判断",
     "position": { "x": 700, "y": 100 },
     "config": {
       "conditions": [
         { "label": "条件描述", "expression": "变量 >= 值", "targetNode": "node-xxx" }
       ],
       "defaultNode": "node-xxx"
     }
   }

5. **parallel** - 并行节点
   {
     "id": "node-parallel",
     "type": "parallel",
     "name": "并行执行",
     "position": { "x": 900, "y": 100 },
     "config": {
       "branches": ["node-1", "node-2", "node-3"],
       "mergeType": "all"              // all | any | none
     }
   }

6. **loop** - 循环节点
   {
     "id": "node-loop",
     "type": "loop",
     "name": "循环",
     "position": { "x": 1100, "y": 100 },
     "config": {
       "loopConfig": {
         "type": "condition",          // count | condition | array
         "condition": "变量 > 0",
         "loopBodyNode": "node-xxx"
       }
     }
   }

7. **output** - 输出节点
   {
     "id": "node-output",
     "type": "output",
     "name": "输出",
     "position": { "x": 1300, "y": 100 },
     "config": {
       "outputConfig": {
         "name": "输出名",
         "description": "输出描述",
         "type": "json",
         "isFinalOutput": true
       }
     }
   }

### 边结构 (edges)
   {
     "id": "edge-1",
     "source": "node-start",
     "target": "node-xxx",
     "condition": { "variableName": "xxx", "operator": "gt", "value": 0 }  // 可选
   }

### 可用智能体 ID
根据当前系统配置，可用智能体包括：
- agent-pm (产品经理)
- agent-coder (程序员)
- agent-reviewer (审核员)
- agent-qa (测试员)
- agent-designer (设计师)
- agent-analyzer (分析师)

### 注意事项
1. 节点 position 布局要合理，横向间距 200-300px
2. 边要正确连接 source 和 target
3. taskTemplate 使用 {{变量}} 插值语法
4. outputs.extractPath 使用 JSONPath 语法 ($.字段)
5. 只输出 JSON，不要其他解释文字
`;

// ==================== WorkflowOrchestrator 类 ====================

export class WorkflowOrchestrator {
  private providerManager: ProviderManager;
  private workflowFolder: string;  // 前端工作流文件夹路径
  
  constructor(providerManager: ProviderManager, workflowFolder: string) {
    this.providerManager = providerManager;
    this.workflowFolder = workflowFolder;
  }
  
  /**
   * 主入口：迭代式精化生成工作流
   * 
   * 流程：骨架 → 节点精化 → 连接优化 → 最终验证
   * 每层完成后立即保存并通知前端刷新
   */
  async generateWorkflowIteratively(
    userIntent: string,
    availableAgents?: string[]
  ): Promise<WorkflowGenerationResult> {
    logger.info('[WorkflowOrchestrator] 开始迭代式精化生成工作流');
    logger.info('[WorkflowOrchestrator] 用户意图:', userIntent);
    
    // 确保文件夹存在
    await mkdir(this.workflowFolder, { recursive: true });
    
    // ========== 第一层：骨架生成 ==========
    logger.info('[WorkflowOrchestrator] 第一层：骨架生成');
    this.notifyFrontend('layer-start', { layer: 1, name: '骨架生成' });
    
    const skeleton = await this.generateSkeleton(userIntent, availableAgents);
    const filePath = await this.saveWorkflow(skeleton);
    this.notifyFrontend('workflow-update', { layer: 1, status: 'skeleton-generated', filePath });
    
    logger.info('[WorkflowOrchestrator] 骨架生成完成，节点数:', skeleton.nodes.length);
    this.notifyFrontend('layer-complete', { layer: 1, name: '骨架生成', nodesCount: skeleton.nodes.length });
    
    // ========== 第二层：节点精化 ==========
    logger.info('[WorkflowOrchestrator] 第二层：节点精化');
    this.notifyFrontend('layer-start', { layer: 2, name: '节点精化', totalNodes: skeleton.nodes.length });
    
    for (let i = 0; i < skeleton.nodes.length; i++) {
      const node = skeleton.nodes[i];
      logger.info(`[WorkflowOrchestrator] 精化节点 ${i + 1}/${skeleton.nodes.length}: ${node.name}`);
      this.notifyFrontend('node-refining', { index: i + 1, total: skeleton.nodes.length, nodeId: node.id, nodeName: node.name });
      
      // 调用 LLM 对每个节点进行复查和调整
      const refinedNode = await this.refineNode(node, skeleton, userIntent);
      skeleton.nodes[i] = refinedNode;
      
      // 每个节点精化后立即保存并通知前端
      await this.saveWorkflow(skeleton, filePath);
      this.notifyFrontend('node-refined', { nodeId: node.id, nodeName: node.name });
    }
    
    this.notifyFrontend('layer-complete', { layer: 2, name: '节点精化' });
    
    // ========== 第三层：连接优化 ==========
    logger.info('[WorkflowOrchestrator] 第三层：连接优化');
    this.notifyFrontend('layer-start', { layer: 3, name: '连接优化' });
    
    const optimizedEdges = await this.optimizeConnections(skeleton);
    skeleton.edges = optimizedEdges;
    await this.saveWorkflow(skeleton, filePath);
    this.notifyFrontend('workflow-update', { layer: 3, status: 'connections-optimized' });
    
    this.notifyFrontend('layer-complete', { layer: 3, name: '连接优化' });
    
    // ========== 第四层：最终验证 ==========
    logger.info('[WorkflowOrchestrator] 第四层：最终验证');
    this.notifyFrontend('layer-start', { layer: 4, name: '最终验证' });
    
    const validatedWorkflow = await this.validateWorkflow(skeleton);
    await this.saveWorkflow(validatedWorkflow, filePath);
    
    this.notifyFrontend('workflow-ready', { 
      workflowId: validatedWorkflow.id,
      workflowName: validatedWorkflow.name,
      filePath,
      message: '工作流已就绪，可以开始执行'
    });
    
    logger.info('[WorkflowOrchestrator] 工作流生成完成:', validatedWorkflow.id);
    
    return {
      filePath,
      workflowId: validatedWorkflow.id,
      workflowName: validatedWorkflow.name,
    };
  }
  
  /**
   * 第一层：生成工作流骨架
   * 只生成基本节点列表和边连接，不包含详细配置
   */
  private async generateSkeleton(
    userIntent: string,
    availableAgents?: string[]
  ): Promise<WorkflowJSON> {
    const skeletonPrompt = `
## 任务：生成工作流骨架

请根据用户意图，生成工作流的骨架结构。

### 要求
1. 只生成基本节点列表（id, type, name, position）
2. 只生成基本边连接（id, source, target）
3. **不要**生成详细的 config 配置
4. 节点类型参考：
   - variable: 变量节点（初始化数据）
   - agent: 智能体节点（执行任务）
   - review: 审核节点
   - condition: 条件节点（分支）
   - parallel: 并行节点
   - loop: 循环节点
   - output: 输出节点

### 用户意图
${userIntent}

### 可用智能体
${availableAgents ? availableAgents.map(a => `- ${a}`).join('\n') : '- agent-coder\n- agent-reviewer\n- agent-qa'}

### 输出格式
只输出 JSON，不要其他文字。
`;

    const response = await this.providerManager.chat([
      { role: 'system', content: '你是工作流设计专家。生成骨架结构，不包含详细配置。' },
      { role: 'user', content: skeletonPrompt },
    ]);

    const jsonContent = this.extractJSON(response.content);
    if (!jsonContent) {
      throw new Error('LLM 未返回有效的骨架 JSON');
    }

    const skeleton = JSON.parse(jsonContent);
    
    // 补充必要字段
    skeleton.id = skeleton.id || `workflow-${Date.now()}`;
    skeleton.createdAt = skeleton.createdAt || new Date().toISOString();
    skeleton.updatedAt = new Date().toISOString();
    skeleton.version = skeleton.version || '1.0.0';
    
    // 确保每个节点有基本结构
    skeleton.nodes = skeleton.nodes.map((node: any, index: number) => ({
      id: node.id || `node-${index + 1}`,
      type: node.type || 'agent',
      name: node.name || `节点 ${index + 1}`,
      position: node.position || { x: 100 + index * 250, y: 100 },
      config: node.config || {},  // 骨架阶段 config 为空
    }));
    
    // 确保每条边有基本结构
    skeleton.edges = skeleton.edges.map((edge: any, index: number) => ({
      id: edge.id || `edge-${index + 1}`,
      source: edge.source,
      target: edge.target,
    }));
    
    return skeleton;
  }
  
  /**
   * 第二层：精化单个节点
   * 调用 LLM 对节点进行复查和调整，补充详细配置
   */
  private async refineNode(
    node: WorkflowNode,
    workflow: WorkflowJSON,
    userIntent: string
  ): Promise<WorkflowNode> {
    // 根据节点类型选择精化策略
    const refinePrompt = this.buildNodeRefinePrompt(node, workflow, userIntent);
    
    const response = await this.providerManager.chat([
      { role: 'system', content: '你是工作流节点配置专家。请为节点补充详细配置。' },
      { role: 'user', content: refinePrompt },
    ]);

    const jsonContent = this.extractJSON(response.content);
    if (!jsonContent) {
      // 如果 LLM 没返回 JSON，保留原节点
      logger.warn(`[WorkflowOrchestrator] 节点 ${node.id} 精化失败，保留原配置`);
      return node;
    }

    try {
      const refinedConfig = JSON.parse(jsonContent);
      
      // 合并配置
      return {
        ...node,
        config: {
          ...node.config,
          ...refinedConfig,
        },
      };
    } catch (e) {
      logger.warn(`[WorkflowOrchestrator] 节点 ${node.id} 配置解析失败，保留原配置`);
      return node;
    }
  }
  
  /**
   * 构建节点精化提示词
   */
  private buildNodeRefinePrompt(
    node: WorkflowNode,
    workflow: WorkflowJSON,
    userIntent: string
  ): string {
    const nodeTypeConfigGuide: Record<string, string> = {
      variable: `
配置结构：
{
  "variableConfig": {
    "name": "变量名",
    "value": { ... },  // JSON 对象或字符串
    "type": "json"     // json | string | number
  }
}`,
      agent: `
配置结构：
{
  "executor": {
    "mode": "single",  // single | any | all | vote | round-robin
    "executors": [{ "type": "agent", "id": "agent-xxx", "weight": 1 }]
  },
  "taskTemplate": "任务描述，支持 {{变量}} 插值",
  "inputs": [
    { "name": "输入名", "source": "blackboard", "sourceKey": "变量名", "required": true }
  ],
  "outputs": [
    { "name": "输出名", "extractPath": "$.字段", "required": true }
  ],
  "timeout": 120000,
  "retryCount": 2
}`,
      review: `
配置结构：
{
  "reviewConfig": {
    "reviewType": "score",
    "criteria": [
      { "name": "完整性", "description": "...", "weight": 0.3 }
    ],
    "passThreshold": 70,
    "reviewers": ["agent-xxx"]
  }
}`,
      condition: `
配置结构：
{
  "conditions": [
    { "label": "条件描述", "expression": "变量 >= 值", "targetNode": "node-xxx" }
  ],
  "defaultNode": "node-xxx"
}`,
      parallel: `
配置结构：
{
  "branches": ["node-1", "node-2", "node-3"],
  "mergeType": "all"  // all | any | none
}`,
      loop: `
配置结构：
{
  "loopConfig": {
    "type": "condition",  // count | condition | array
    "condition": "变量 > 0",
    "loopBodyNode": "node-xxx"
  }
}`,
      output: `
配置结构：
{
  "outputConfig": {
    "name": "输出名",
    "description": "输出描述",
    "type": "json",
    "isFinalOutput": true
  }
}`,
    };

    return `
## 任务：精化节点配置

### 工作流上下文
- 工作流名称：${workflow.name || '未命名'}
- 用户意图：${userIntent}
- 其他节点：${workflow.nodes.map(n => `${n.id}(${n.type})`).join(', ')}

### 当前节点
- ID: ${node.id}
- 类型: ${node.type}
- 名称: ${node.name}

### 需要补充的配置
${nodeTypeConfigGuide[node.type] || '请补充合适的配置'}

### 要求
1. 根据节点类型和工作流上下文，补充详细配置
2. taskTemplate 要具体、可执行
3. inputs/outputs 要与其他节点数据流转匹配
4. 只输出配置 JSON，不要其他文字
`;
  }
  
  /**
   * 第三层：优化连接关系
   * 检查数据流转逻辑，优化边的连接
   */
  private async optimizeConnections(workflow: WorkflowJSON): Promise<WorkflowEdge[]> {
    const optimizePrompt = `
## 任务：优化工作流连接

### 当前工作流
${JSON.stringify(workflow, null, 2)}

### 要求
1. 检查节点间的数据流转是否合理
2. 补充条件分支的条件表达式
3. 确保每个 agent 节点的输入输出与上下游匹配
4. 只输出 edges 数组 JSON，不要其他文字

### 输出格式
[
  { "id": "edge-1", "source": "node-xxx", "target": "node-xxx", "condition": { ... } }
]
`;

    const response = await this.providerManager.chat([
      { role: 'system', content: '你是工作流连接优化专家。优化边的连接关系。' },
      { role: 'user', content: optimizePrompt },
    ]);

    const jsonContent = this.extractJSON(response.content);
    if (!jsonContent) {
      logger.warn('[WorkflowOrchestrator] 连接优化失败，保留原连接');
      return workflow.edges;
    }

    try {
      return JSON.parse(jsonContent);
    } catch (e) {
      logger.warn('[WorkflowOrchestrator] 连接解析失败，保留原连接');
      return workflow.edges;
    }
  }
  
  /**
   * 第四层：最终验证
   * 整体审查工作流完整性
   */
  private async validateWorkflow(workflow: WorkflowJSON): Promise<WorkflowJSON> {
    const validatePrompt = `
## 任务：验证工作流完整性

### 当前工作流
${JSON.stringify(workflow, null, 2)}

### 验证清单
1. 所有节点配置是否完整？
2. 数据流转逻辑是否正确？
3. 输入输出是否匹配？
4. 是否有孤立节点？
5. 是否有死循环？

### 要求
1. 检查并修复问题
2. 输出完整的工作流 JSON
3. 不要其他文字
`;

    const response = await this.providerManager.chat([
      { role: 'system', content: '你是工作流验证专家。检查并修复问题。' },
      { role: 'user', content: validatePrompt },
    ]);

    const jsonContent = this.extractJSON(response.content);
    if (!jsonContent) {
      logger.warn('[WorkflowOrchestrator] 验证失败，保留原工作流');
      return workflow;
    }

    try {
      const validated = JSON.parse(jsonContent);
      validated.updatedAt = new Date().toISOString();
      return validated;
    } catch (e) {
      logger.warn('[WorkflowOrchestrator] 验证解析失败，保留原工作流');
      return workflow;
    }
  }
  
  /**
   * 保存工作流 JSON 到文件
   */
  private async saveWorkflow(workflow: WorkflowJSON, existingPath?: string): Promise<string> {
    const filePath = existingPath || join(this.workflowFolder, `${workflow.id}.json`);
    
    // 确保目录存在
    await mkdir(dirname(filePath), { recursive: true });
    
    await writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf-8');
    logger.info('[WorkflowOrchestrator] 工作流已保存:', filePath);
    return filePath;
  }
  
  /**
   * 通知前端刷新显示
   */
  private notifyFrontend(eventType: string, data: any): void {
    const wsClient = getWSClient();
    wsClient.send({
      type: 'event',
      payload: {
        type: 'workflow-generation',
        agentId: 'ahivecore',
        agentName: 'AHIVECORE',
        timestamp: Date.now(),
        data: {
          event: eventType,
          ...data,
          source: 'ahivecore',
        },
      },
    });
  }
  
  /**
   * 从 LLM 响应中提取 JSON
   */
  private extractJSON(content: string): string | null {
    // 尝试匹配 JSON 块
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    
    // 尝试匹配代码块中的 JSON
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    
    // 尝试匹配数组
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return arrayMatch[0];
    }
    
    return null;
  }
  
  /**
   * 加载现有工作流
   */
  async loadWorkflow(workflowId: string): Promise<WorkflowJSON | null> {
    const filePath = join(this.workflowFolder, `${workflowId}.json`);
    
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn('[WorkflowOrchestrator] 加载工作流失败:', workflowId);
      return null;
    }
  }
  
  /**
   * 修改现有工作流
   */
  async modifyWorkflow(
    workflowId: string,
    modifications: {
      addNodes?: Array<{
        id?: string;
        type?: string;
        name?: string;
        position?: { x?: number; y?: number };
        config?: Record<string, any>;
      }>;
      removeNodes?: string[];
      updateNodes?: { id: string; config: Record<string, any> }[];
      addEdges?: Array<{
        id?: string;
        source?: string;
        target?: string;
        condition?: Record<string, any>;
      }>;
      removeEdges?: string[];
    }
  ): Promise<WorkflowGenerationResult | null> {
    const workflow = await this.loadWorkflow(workflowId);
    if (!workflow) {
      logger.error('[WorkflowOrchestrator] 工作流不存在:', workflowId);
      return null;
    }
    
    // 应用修改
    if (modifications.addNodes) {
      // 过滤并转换节点，确保必填字段存在
      const validNodes = modifications.addNodes
        .filter(n => n.id && n.type && n.name && n.position)
        .map(n => ({
          id: n.id!,
          type: n.type!,
          name: n.name!,
          position: n.position!,
          config: n.config || {},
        })) as WorkflowNode[];
      workflow.nodes.push(...validNodes);
    }
    
    if (modifications.removeNodes) {
      workflow.nodes = workflow.nodes.filter(n => !modifications.removeNodes!.includes(n.id));
      workflow.edges = workflow.edges.filter(e => 
        !modifications.removeNodes!.includes(e.source) && 
        !modifications.removeNodes!.includes(e.target)
      );
    }
    
    if (modifications.updateNodes) {
      for (const update of modifications.updateNodes) {
        const node = workflow.nodes.find(n => n.id === update.id);
        if (node) {
          node.config = { ...node.config, ...update.config };
        }
      }
    }
    
    if (modifications.addEdges) {
      // 过滤并转换边，确保必填字段存在
      const validEdges = modifications.addEdges
        .filter(e => e.id && e.source && e.target)
        .map(e => ({
          id: e.id!,
          source: e.source!,
          target: e.target!,
          condition: e.condition,
        })) as WorkflowEdge[];
      workflow.edges.push(...validEdges);
    }
    
    if (modifications.removeEdges) {
      workflow.edges = workflow.edges.filter(e => !modifications.removeEdges!.includes(e.id));
    }
    
    // 更新时间戳
    workflow.updatedAt = new Date().toISOString();
    
    // 保存
    const filePath = await this.saveWorkflow(workflow);
    
    this.notifyFrontend('workflow-modified', { 
      workflowId: workflow.id,
      workflowName: workflow.name,
      filePath,
      modifications,
    });
    
    return {
      filePath,
      workflowId: workflow.id,
      workflowName: workflow.name,
    };
  }
  
  /**
   * 删除工作流
   */
  async deleteWorkflow(workflowId: string): Promise<boolean> {
    const filePath = join(this.workflowFolder, `${workflowId}.json`);
    
    try {
      const { unlink } = await import('fs/promises');
      await unlink(filePath);
      
      this.notifyFrontend('workflow-deleted', { workflowId });
      
      logger.info('[WorkflowOrchestrator] 工作流已删除:', workflowId);
      return true;
    } catch (error) {
      logger.error('[WorkflowOrchestrator] 删除工作流失败:', workflowId);
      return false;
    }
  }
  
  /**
   * 列出所有工作流
   */
  async listWorkflows(): Promise<Array<{ id: string; name: string; filePath: string }>> {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(this.workflowFolder);
      
      const workflows: Array<{ id: string; name: string; filePath: string }> = [];
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = join(this.workflowFolder, file);
          try {
            const content = await readFile(filePath, 'utf-8');
            const workflow = JSON.parse(content);
            workflows.push({
              id: workflow.id,
              name: workflow.name,
              filePath,
            });
          } catch (e) {
            // 跳过无法解析的文件
          }
        }
      }
      
      return workflows;
    } catch (error) {
      logger.warn('[WorkflowOrchestrator] 列出工作流失败');
      return [];
    }
  }
}

// ==================== 单例 ====================

let workflowOrchestratorInstance: WorkflowOrchestrator | null = null;

/**
 * 获取 WorkflowOrchestrator 实例
 */
export function getWorkflowOrchestrator(
  providerManager?: ProviderManager,
  workflowFolder?: string
): WorkflowOrchestrator {
  if (!workflowOrchestratorInstance && providerManager && workflowFolder) {
    workflowOrchestratorInstance = new WorkflowOrchestrator(providerManager, workflowFolder);
  }
  return workflowOrchestratorInstance!;
}

/**
 * 初始化 WorkflowOrchestrator
 */
export function initializeWorkflowOrchestrator(
  providerManager: ProviderManager,
  workflowFolder: string
): WorkflowOrchestrator {
  workflowOrchestratorInstance = new WorkflowOrchestrator(providerManager, workflowFolder);
  return workflowOrchestratorInstance;
}