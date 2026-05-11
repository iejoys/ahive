/**
 * 示例工作流数据
 * 2D游戏开发完整流程演示
 */

import type { Workflow } from '../types';

/**
 * 2D游戏开发工作流示例
 */
export const gameDevWorkflow: Workflow = {
  id: 'workflow-2d-game-dev-demo',
  name: '2D游戏开发流程',
  description: '由智能体团队协作完成2D游戏开发的完整工作流示例',
  nodes: [
    // ========== 项目初始化 ==========
    {
      id: 'node-init',
      type: 'variable',
      name: '项目初始化',
      description: '初始化游戏项目参数',
      position: { x: 100, y: 300 },
      config: {
        variableConfig: {
          name: 'projectConfig',
          value: JSON.stringify({
            gameName: '星际冒险',
            gameType: '2D横版动作游戏',
            targetPlatform: 'Web/Mobile'
          }),
          type: 'json'
        }
      }
    },
    
    // ========== 需求分析阶段 ==========
    {
      id: 'node-requirement',
      type: 'agent',
      name: '需求分析',
      description: '产品经理分析游戏需求',
      position: { x: 300, y: 300 },
      config: {
        executor: {
          mode: 'single',
          executors: [{ type: 'agent', id: 'agent-pm', weight: 1 }],
          failureStrategy: { action: 'abort' }
        },
        taskTemplate: `## 任务：游戏需求分析

### 项目信息
游戏名称：星际冒险
游戏类型：2D横版动作游戏

### 要求
1. 分析目标用户群体
2. 定义核心玩法机制
3. 列出功能需求清单`,
        outputs: [
          { name: 'requirementDoc', extractPath: '$.requirementDoc' },
          { name: 'featureList', extractPath: '$.features' }
        ]
      }
    },
    
    // ========== 需求审核 ==========
    {
      id: 'node-review-req',
      type: 'review',
      name: '需求审核',
      description: '审核需求文档',
      position: { x: 500, y: 300 },
      config: {
        reviewConfig: {
          reviewType: 'auto',
          title: '需求审核',
          instruction: '审核需求文档质量',
          scoreMethod: 'score',
          passCondition: {
            variableName: 'reviewScore',
            operator: 'gte',
            threshold: 70
          },
          failAction: {
            type: 'return'
          }
        }
      }
    },
    
    // ========== 游戏设计 ==========
    {
      id: 'node-design',
      type: 'agent',
      name: '游戏设计',
      description: '游戏设计师输出设计文档',
      position: { x: 700, y: 300 },
      config: {
        executor: {
          mode: 'single',
          executors: [{ type: 'agent', id: 'agent-game-designer', weight: 1 }],
          failureStrategy: { action: 'abort' }
        },
        taskTemplate: `## 任务：游戏设计

### 设计内容
1. 游戏世界观和剧情
2. 角色设计
3. 关卡设计`,
        outputs: [
          { name: 'designDoc', extractPath: '$.designDoc' },
          { name: 'characterList', extractPath: '$.characters' }
        ]
      }
    },
    
    // ========== 并行开发 ==========
    {
      id: 'node-parallel',
      type: 'parallel',
      name: '并行开发',
      description: '美术、程序、音效团队同时开发',
      position: { x: 900, y: 300 },
      config: {
        branches: ['node-art', 'node-code', 'node-audio'],
        mergeType: 'all'
      }
    },
    
    // ========== 美术开发分支 ==========
    {
      id: 'node-art',
      type: 'agent',
      name: '美术设计',
      description: '美术团队制作游戏资源',
      position: { x: 1100, y: 150 },
      config: {
        executor: {
          mode: 'all',
          executors: [
            { type: 'agent', id: 'agent-character-artist', weight: 1 },
            { type: 'agent', id: 'agent-bg-artist', weight: 1 }
          ],
          failureStrategy: { action: 'continue' }
        },
        taskTemplate: `## 任务：美术资源制作

### 制作清单
1. 主角精灵图
2. 敌人精灵图
3. 背景图层`,
        outputs: [
          { name: 'artAssets', extractPath: '$.assets' }
        ]
      }
    },
    
    // ========== 程序开发分支 ==========
    {
      id: 'node-code',
      type: 'agent',
      name: '程序开发',
      description: '程序员实现游戏核心逻辑',
      position: { x: 1100, y: 300 },
      config: {
        executor: {
          mode: 'all',
          executors: [
            { type: 'agent', id: 'agent-gameplay-dev', weight: 1 },
            { type: 'agent', id: 'agent-ui-dev', weight: 1 }
          ],
          failureStrategy: { action: 'continue' }
        },
        taskTemplate: `## 任务：程序开发

### 开发任务
1. 玩家控制模块
2. 物理碰撞系统
3. 敌人AI系统`,
        outputs: [
          { name: 'codeModules', extractPath: '$.modules' }
        ]
      }
    },
    
    // ========== 音效开发分支 ==========
    {
      id: 'node-audio',
      type: 'agent',
      name: '音效制作',
      description: '音效师制作游戏音效',
      position: { x: 1100, y: 450 },
      config: {
        executor: {
          mode: 'single',
          executors: [{ type: 'agent', id: 'agent-sound-designer', weight: 1 }],
          failureStrategy: { action: 'continue' }
        },
        taskTemplate: `## 任务：音效制作

### 制作清单
1. 背景音乐
2. 音效`,
        outputs: [
          { name: 'audioAssets', extractPath: '$.assets' }
        ]
      }
    },
    
    // ========== 资源整合 ==========
    {
      id: 'node-integrate',
      type: 'agent',
      name: '资源集成',
      description: '技术负责人集成所有资源',
      position: { x: 1300, y: 300 },
      config: {
        executor: {
          mode: 'single',
          executors: [{ type: 'agent', id: 'agent-tech-lead', weight: 1 }],
          failureStrategy: { action: 'abort' }
        },
        taskTemplate: `## 任务：资源集成

### 集成任务
1. 资源导入配置
2. 模块联调
3. 构建测试版本`,
        outputs: [
          { name: 'buildVersion', extractPath: '$.version' }
        ]
      }
    },
    
    // ========== 测试阶段 ==========
    {
      id: 'node-test',
      type: 'agent',
      name: '测试执行',
      description: '测试工程师执行测试',
      position: { x: 1500, y: 300 },
      config: {
        executor: {
          mode: 'all',
          executors: [
            { type: 'agent', id: 'agent-qa-tester', weight: 1 },
            { type: 'agent', id: 'agent-qa-automation', weight: 1 }
          ],
          failureStrategy: { action: 'continue' }
        },
        taskTemplate: `## 任务：游戏测试

### 测试范围
1. 功能测试
2. 兼容性测试
3. 性能测试`,
        outputs: [
          { name: 'testReport', extractPath: '$.report' },
          { name: 'bugCount', extractPath: '$.bugCount' }
        ]
      }
    },
    
    // ========== 条件判断 ==========
    {
      id: 'node-condition',
      type: 'condition',
      name: 'Bug检查',
      description: '检查是否还有未修复的Bug',
      position: { x: 1700, y: 300 },
      config: {
        conditions: [
          { label: '有Bug需修复', expression: 'bugCount > 0', targetNode: 'node-fix' },
          { label: '测试通过', expression: 'bugCount == 0', targetNode: 'node-final-review' }
        ],
        defaultNode: 'node-final-review'
      }
    },
    
    // ========== Bug修复 ==========
    {
      id: 'node-fix',
      type: 'agent',
      name: 'Bug修复',
      description: '开发团队修复Bug',
      position: { x: 1700, y: 450 },
      config: {
        executor: {
          mode: 'any',
          executors: [
            { type: 'agent', id: 'agent-gameplay-dev', weight: 1 },
            { type: 'agent', id: 'agent-ui-dev', weight: 1 }
          ],
          failureStrategy: { action: 'retry', retryCount: 2 }
        },
        taskTemplate: `## 任务：修复Bug`,
        outputs: [
          { name: 'fixReport', extractPath: '$.fixReport' }
        ]
      }
    },
    
    // ========== 最终审核 ==========
    {
      id: 'node-final-review',
      type: 'review',
      name: '最终审核',
      description: '项目经理最终审核游戏质量',
      position: { x: 1900, y: 300 },
      config: {
        reviewConfig: {
          reviewType: 'auto',
          title: '最终审核',
          instruction: '审核游戏整体质量',
          scoreMethod: 'score',
          passCondition: {
            variableName: 'reviewScore',
            operator: 'gte',
            threshold: 80
          },
          failAction: {
            type: 'return'
          }
        }
      }
    },
    
    // ========== 发布通知 ==========
    {
      id: 'node-notify',
      type: 'notify',
      name: '发布通知',
      description: '通知发布',
      position: { x: 2100, y: 300 },
      config: {
        notifyConfig: {
          channels: ['email', 'dingtalk'],
          recipients: ['team@gamecompany.com'],
          template: '🎉 游戏发布通知：星际冒险已通过审核'
        }
      }
    },
    
    // ========== 项目输出 ==========
    {
      id: 'node-output',
      type: 'output',
      name: '项目输出',
      description: '输出最终项目成果',
      position: { x: 2300, y: 300 },
      config: {
        outputConfig: {
          name: 'finalDelivery',
          type: 'json',
          isFinalOutput: true
        }
      }
    }
  ],
  
  edges: [
    { id: 'edge-1', source: 'node-init', target: 'node-requirement' },
    { id: 'edge-2', source: 'node-requirement', target: 'node-review-req' },
    { id: 'edge-3', source: 'node-review-req', target: 'node-design' },
    { id: 'edge-4', source: 'node-design', target: 'node-parallel' },
    { id: 'edge-5', source: 'node-parallel', target: 'node-integrate' },
    { id: 'edge-6', source: 'node-integrate', target: 'node-test' },
    { id: 'edge-7', source: 'node-test', target: 'node-condition' },
    { id: 'edge-8', source: 'node-condition', target: 'node-fix' },
    { id: 'edge-9', source: 'node-condition', target: 'node-final-review' },
    { id: 'edge-10', source: 'node-fix', target: 'node-test' },
    { id: 'edge-11', source: 'node-final-review', target: 'node-notify' },
    { id: 'edge-12', source: 'node-notify', target: 'node-output' }
  ],
  isActive: true
};

/**
 * 简化版示例工作流
 */
export const simpleWorkflow: Workflow = {
  id: 'workflow-simple-demo',
  name: '简单任务流程',
  description: '基础工作流示例',
  nodes: [
    {
      id: 's-node-1',
      type: 'variable',
      name: '输入参数',
      position: { x: 100, y: 200 },
      config: {
        variableConfig: {
          name: 'inputData',
          value: JSON.stringify({ task: '示例任务' }),
          type: 'json'
        }
      }
    },
    {
      id: 's-node-2',
      type: 'agent',
      name: '任务执行',
      position: { x: 300, y: 200 },
      config: {
        executor: {
          mode: 'single',
          executors: [{ type: 'agent', id: 'agent-pm', weight: 1 }],
          failureStrategy: { action: 'abort' }
        },
        taskTemplate: '执行任务',
        outputs: [{ name: 'result', extractPath: '$.result' }]
      }
    },
    {
      id: 's-node-3',
      type: 'output',
      name: '输出结果',
      position: { x: 500, y: 200 },
      config: {
        outputConfig: {
          name: 'taskResult',
          type: 'json',
          isFinalOutput: true
        }
      }
    }
  ],
  edges: [
    { id: 's-edge-1', source: 's-node-1', target: 's-node-2' },
    { id: 's-edge-2', source: 's-node-2', target: 's-node-3' }
  ],
  isActive: true
};

/**
 * 获取所有示例工作流
 */
export function getDemoWorkflows(): Workflow[] {
  return [simpleWorkflow, gameDevWorkflow];
}

export default { simpleWorkflow, gameDevWorkflow, getDemoWorkflows };