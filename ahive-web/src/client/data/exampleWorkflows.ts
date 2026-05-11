/**
 * 示例工作流配置
 * 可直接导入测试，展示完整的模板、输入输出映射配置
 */

import type { Workflow, WorkflowNode, WorkflowEdge } from '../types';

/**
 * 示例 1：代码审查工作流
 * 分析 → 诊断 → 修复 三步流程
 */
export const CODE_REVIEW_WORKFLOW: Workflow = {
  id: 'workflow-code-review',
  name: '代码审查流程',
  description: '分析代码问题 → 诊断严重性 → 提供修复建议',
  isActive: true,
  nodes: [
    // ========== 节点 1：代码分析 ==========
    {
      id: 'node-analyze',
      type: 'agent',
      name: '代码分析',
      description: '分析代码结构和潜在问题',
      position: { x: 100, y: 150 },
      config: {
        agentId: 'agent-analyzer', // 需要替换为实际 Agent ID
        
        // 任务模板
        taskTemplate: `你是一位资深代码审查专家。请分析以下代码：

文件名: {{fileName}}
语言: {{language}}

代码内容:
\`\`\`{{language}}
{{code}}
\`\`\`

{{#if focusAreas}}
重点关注:
{{#each focusAreas}}
- {{this}}
{{/each}}
{{/if}}

请从以下维度分析:
1. 代码结构和架构
2. 命名规范
3. 潜在 Bug 和安全问题
4. 性能问题
5. 代码风格

请以 JSON 格式输出:
{
  "score": 0-100的评分,
  "summary": "总体评价",
  "issues": [
    {
      "type": "bug|security|performance|style|architecture",
      "severity": "critical|high|medium|low",
      "line": 行号,
      "message": "问题描述",
      "suggestion": "修复建议"
    }
  ],
  "strengths": ["代码优点"],
  "recommendations": ["改进建议"]
}`,
        
        // 输入映射
        inputs: [
          {
            name: 'fileName',
            source: 'user-input',
            required: true,
            description: '要分析的文件名'
          },
          {
            name: 'language',
            source: 'user-input',
            required: false,
            defaultValue: 'typescript',
            description: '编程语言'
          },
          {
            name: 'code',
            source: 'user-input',
            required: true,
            description: '要分析的代码内容'
          },
          {
            name: 'focusAreas',
            source: 'blackboard',
            sourceKey: 'review.focusAreas',
            required: false,
            description: '关注重点（可选）'
          }
        ],
        
        // 输出映射
        outputs: [
          {
            name: 'analysisResult',
            extractPath: '$',
            description: '完整分析结果',
            required: true
          },
          {
            name: 'issues',
            extractPath: '$.issues',
            description: '发现的问题列表'
          },
          {
            name: 'score',
            extractPath: '$.score',
            description: '代码评分'
          }
        ],
        
        // 执行策略
        timeout: 120000,
        retryCount: 2
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    
    // ========== 节点 2：问题诊断 ==========
    {
      id: 'node-diagnose',
      type: 'agent',
      name: '问题诊断',
      description: '诊断问题严重性和优先级',
      position: { x: 400, y: 150 },
      config: {
        agentId: 'agent-reviewer',
        
        taskTemplate: `基于代码分析结果，请诊断问题的严重性和修复优先级。

发现的问题 (共 {{issueCount}} 个):
{{#each issues}}
{{@index}}. [{{severity}}] 行 {{line}}: {{message}}
   类型: {{type}}
   建议: {{suggestion}}
{{/each}}

请判断:
1. 哪些是真正需要修复的问题
2. 问题优先级排序
3. 是否需要人工介入审核
4. 预估修复时间

输出 JSON:
{
  "criticalIssues": ["必须修复的问题"],
  "mediumIssues": ["建议修复的问题"],
  "lowIssues": ["可选修复的问题"],
  "priority": ["按优先级排序的问题ID"],
  "needsHumanReview": true/false,
  "estimatedTime": "预估修复时间",
  "riskLevel": "high|medium|low"
}`,
        
        inputs: [
          {
            name: 'issues',
            source: 'prev-output',
            sourceKey: 'issues',
            required: true,
            description: '从分析节点获取问题列表'
          },
          {
            name: 'issueCount',
            source: 'prev-output',
            sourceKey: 'issues.length',
            required: false,
            description: '问题数量'
          }
        ],
        
        outputs: [
          {
            name: 'diagnosis',
            extractPath: '$',
            description: '诊断结果'
          },
          {
            name: 'priority',
            extractPath: '$.priority',
            description: '优先级列表'
          }
        ],
        
        timeout: 60000,
        retryCount: 1
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    
    // ========== 节点 3：修复建议 ==========
    {
      id: 'node-fix',
      type: 'agent',
      name: '修复建议',
      description: '生成修复代码和建议',
      position: { x: 700, y: 150 },
      config: {
        agentId: 'agent-coder',
        
        taskTemplate: `根据诊断结果，请提供修复方案。

原始代码:
\`\`\`{{language}}
{{code}}
\`\`\`

需要修复的问题:
{{#each criticalIssues}}
- {{this}}
{{/each}}

诊断结果:
- 风险级别: {{riskLevel}}
- 预估时间: {{estimatedTime}}

请提供:
1. 修复后的完整代码
2. 修改说明（标注修改位置和原因）
3. 测试建议
4. 注意事项

输出 JSON:
{
  "fixedCode": "修复后的代码",
  "changes": [
    {
      "line": 行号,
      "before": "修改前",
      "after": "修改后", 
      "reason": "修改原因"
    }
  ],
  "testSuggestions": ["测试建议"],
  "notes": ["注意事项"],
  "confidence": 0-100的信心度
}`,
        
        inputs: [
          {
            name: 'code',
            source: 'blackboard',
            sourceKey: 'code',
            required: true,
            description: '原始代码'
          },
          {
            name: 'language',
            source: 'blackboard',
            sourceKey: 'language',
            required: false,
            defaultValue: 'typescript'
          },
          {
            name: 'criticalIssues',
            source: 'prev-output',
            sourceKey: 'diagnosis.criticalIssues',
            required: true
          },
          {
            name: 'riskLevel',
            source: 'prev-output',
            sourceKey: 'diagnosis.riskLevel',
            required: false
          },
          {
            name: 'estimatedTime',
            source: 'prev-output',
            sourceKey: 'diagnosis.estimatedTime',
            required: false
          }
        ],
        
        outputs: [
          {
            name: 'fixedCode',
            extractPath: '$.fixedCode',
            description: '修复后的代码'
          },
          {
            name: 'changes',
            extractPath: '$.changes',
            description: '修改列表'
          },
          {
            name: 'fixResult',
            extractPath: '$',
            description: '完整修复结果'
          }
        ],
        
        timeout: 180000,
        retryCount: 2
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  
  edges: [
    {
      id: 'edge-analyze-diagnose',
      source: 'node-analyze',
      target: 'node-diagnose',
      label: '分析完成',
      createdAt: new Date().toISOString()
    },
    {
      id: 'edge-diagnose-fix',
      source: 'node-diagnose',
      target: 'node-fix',
      label: '诊断完成',
      createdAt: new Date().toISOString()
    }
  ],
  
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * 示例 2：简单问答工作流
 * 单节点示例，适合入门测试
 */
export const SIMPLE_QA_WORKFLOW: Workflow = {
  id: 'workflow-simple-qa',
  name: '智能问答',
  description: '简单的单节点问答流程',
  isActive: true,
  nodes: [
    {
      id: 'node-qa',
      type: 'agent',
      name: '智能回答',
      description: '回答用户问题',
      position: { x: 300, y: 150 },
      config: {
        agentId: 'agent-assistant',
        
        taskTemplate: `请回答以下问题：

问题: {{question}}

{{#if context}}
背景信息:
{{context}}
{{/if}}

请提供清晰、准确的回答。如果涉及代码，请使用代码块格式。`,
        
        inputs: [
          {
            name: 'question',
            source: 'user-input',
            required: true,
            description: '用户问题'
          },
          {
            name: 'context',
            source: 'blackboard',
            sourceKey: 'context',
            required: false,
            description: '背景信息（可选）'
          }
        ],
        
        outputs: [
          {
            name: 'answer',
            extractPath: '$.answer',
            description: '回答内容'
          }
        ],
        
        timeout: 60000
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  edges: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * 示例 3：条件分支工作流
 * 展示条件节点的使用
 */
export const CONDITIONAL_WORKFLOW: Workflow = {
  id: 'workflow-conditional',
  name: '条件分支流程',
  description: '根据评分决定执行路径',
  isActive: true,
  nodes: [
    // 分析节点
    {
      id: 'node-check',
      type: 'agent',
      name: '代码检查',
      description: '检查代码质量',
      position: { x: 100, y: 150 },
      config: {
        agentId: 'agent-analyzer',
        taskTemplate: `请检查以下代码的质量并评分 (0-100):

\`\`\`
{{code}}
\`\`\`

输出 JSON: { "score": 数字, "issues": [] }`,
        inputs: [
          { name: 'code', source: 'user-input', required: true }
        ],
        outputs: [
          { name: 'score', extractPath: '$.score' },
          { name: 'checkResult', extractPath: '$' }
        ],
        timeout: 60000
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    
    // 条件节点
    {
      id: 'node-condition',
      type: 'condition',
      name: '质量判断',
      description: '根据评分决定下一步',
      position: { x: 350, y: 150 },
      config: {
        conditions: [
          { expression: 'score >= 80', targetNode: 'node-pass' },
          { expression: 'score >= 60', targetNode: 'node-improve' }
        ],
        defaultNode: 'node-fail'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    
    // 通过分支
    {
      id: 'node-pass',
      type: 'agent',
      name: '质量达标',
      description: '代码质量达标',
      position: { x: 600, y: 50 },
      config: {
        agentId: 'agent-assistant',
        taskTemplate: `代码质量评分 {{score}} 分，已达标！

可以进入下一阶段。`,
        inputs: [
          { name: 'score', source: 'blackboard', sourceKey: 'score' }
        ],
        outputs: [],
        timeout: 30000
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    
    // 改进分支
    {
      id: 'node-improve',
      type: 'agent',
      name: '需要改进',
      description: '代码需要改进',
      position: { x: 600, y: 150 },
      config: {
        agentId: 'agent-coder',
        taskTemplate: `代码质量评分 {{score}} 分，需要改进。

请查看以下问题并修复:
{{#each issues}}
- {{this}}
{{/each}}`,
        inputs: [
          { name: 'score', source: 'blackboard', sourceKey: 'score' },
          { name: 'issues', source: 'blackboard', sourceKey: 'checkResult.issues' }
        ],
        outputs: [],
        timeout: 60000
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    
    // 失败分支
    {
      id: 'node-fail',
      type: 'agent',
      name: '质量不合格',
      description: '代码质量不合格',
      position: { x: 600, y: 250 },
      config: {
        agentId: 'agent-assistant',
        taskTemplate: `代码质量评分 {{score}} 分，不合格！

建议重新审视代码结构。`,
        inputs: [
          { name: 'score', source: 'blackboard', sourceKey: 'score' }
        ],
        outputs: [],
        timeout: 30000
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  
  edges: [
    { id: 'edge-check-cond', source: 'node-check', target: 'node-condition', createdAt: new Date().toISOString() },
    { id: 'edge-cond-pass', source: 'node-condition', target: 'node-pass', createdAt: new Date().toISOString() },
    { id: 'edge-cond-improve', source: 'node-condition', target: 'node-improve', createdAt: new Date().toISOString() },
    { id: 'edge-cond-fail', source: 'node-condition', target: 'node-fail', createdAt: new Date().toISOString() }
  ],
  
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

/**
 * 所有示例工作流
 */
export const EXAMPLE_WORKFLOWS: Workflow[] = [
  SIMPLE_QA_WORKFLOW,
  CODE_REVIEW_WORKFLOW,
  CONDITIONAL_WORKFLOW
];

/**
 * 导出默认示例（最简单的问答流程）
 */
export default SIMPLE_QA_WORKFLOW;