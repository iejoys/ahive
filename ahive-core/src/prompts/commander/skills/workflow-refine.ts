/**
 * SKILL: 工作流节点丰满
 * 触发词：丰满工作流、完善节点、补充配置、丰满节点、完善工作流
 * 
 * 功能：对已生成的工作流进行逐级节点丰满，补充缺失的配置
 */

import type { PromptSkill } from '../types.js';

export const SKILL_WORKFLOW_REFINE: PromptSkill = {
  name: 'workflow-refine',
  trigger: ['丰满工作流', '完善节点', '补充配置', '丰满节点', '完善工作流', 'refine workflow'],
  
  prompt: `
# 工作流节点丰满 SKILL

## 功能说明

此 SKILL 用于对已生成的工作流进行逐级节点丰满，补充缺失的配置，确保工作流完整可执行。

## 执行流程

1. **结构分析** - 分析工作流结构，识别节点类型和阶段划分
2. **节点诊断** - 检测每个节点的缺失字段，标记优先级
3. **逐个丰满** - 按优先级逐个丰满节点配置
4. **验证修复** - 验证边连接，修复引用错误

---

## 节点类型专家

### Agent 节点丰满专家

**必填字段检查**:
- \`executor\`: 执行者配置
- \`executor.mode\`: 执行模式 (single | any | all | vote | round-robin)
- \`executor.executors\`: 执行者列表
- \`executor.failureStrategy\`: **必填！** 失败处理策略
- \`taskTemplate\`: 任务描述模板

**推荐字段补充**:
- \`timeout\`: 超时时间（毫秒）
- \`inputs\`: 输入映射
- \`outputs\`: 输出映射

**失败策略推断规则**:
| 场景 | 推断策略 |
|------|----------|
| 审核阶段节点 | \`{ action: 'return', retryCount: 2, targetNodeId: '上游节点ID' }\` |
| 测试阶段节点 | \`{ action: 'retry', retryCount: 3 }\` |
| 其他节点 | \`{ action: 'abort' }\` |

**超时时间推断规则**:
| 任务关键词 | 推断超时 |
|------------|----------|
| 设计、架构 | 3600000 (1小时) |
| 开发、实现 | 7200000 (2小时) |
| 测试 | 1800000 (30分钟) |
| 构建、打包 | 600000 (10分钟) |
| 默认 | 3600000 (1小时) |

**输入推断规则**:
从上游 agent 节点的 outputs 中推断：
\`\`\`json
{
  "name": "{outputName}",
  "source": "prev-output",
  "sourceKey": "{upstreamNodeId}:{outputName}"
}
\`\`\`

**输出推断规则**:
| 任务关键词 | 推断输出 |
|------------|----------|
| 文档、输出到 | \`{ "name": "doc", "extractPath": "$" }\` |
| 代码、开发 | \`{ "name": "code", "extractPath": "$" }\` |
| 测试 | \`{ "name": "testReport", "extractPath": "$" }\`, \`{ "name": "bugCount", "extractPath": "$.bugCount" }\` |
| 默认 | \`{ "name": "result", "extractPath": "$" }\` |

---

### Review 节点丰满专家

**必填字段检查**:
- \`reviewConfig\`: 审核配置
- \`reviewConfig.reviewType\`: 审核类型 (agent | human | auto)
- \`reviewConfig.title\`: 审核标题
- \`reviewConfig.instruction\`: 审核说明
- \`reviewConfig.scoreMethod\`: 评分方式 (score | stars | pass_fail)
- \`reviewConfig.criteria\`: 审核标准列表
- \`reviewConfig.passCondition\`: 通过条件
- \`reviewConfig.failAction\`: 失败处理

**审核标准推断规则**:

| 审核对象 | 推断标准 |
|----------|----------|
| 需求文档 | 完整性(35) + 逻辑性(30) + 可执行性(25) + 规范性(10) |
| 设计文档 | 完整性(30) + 可行性(30) + 创新性(25) + 规范性(15) |
| 代码 | 代码质量(30) + 功能正确(30) + 性能(25) + 可维护性(15) |
| 美术资源 | 质量(30) + 风格一致(30) + 格式规范(20) + 完整性(20) |
| 音效资源 | 音质(30) + 格式规范(25) + 触发逻辑(25) + 完整性(20) |
| 默认 | 完整性(40) + 质量(35) + 规范性(25) |

**通过阈值推断规则**:
| 标题关键词 | 阈值 |
|------------|------|
| 严格、关键 | 90 |
| 宽松、初步 | 60 |
| 默认 | 70 |

**失败处理推断规则**:
- 如果存在上游 agent 节点：\`{ type: 'return', targetNodeId: '上游节点ID', maxRetries: 2 }\`
- 否则：\`{ type: 'abort' }\`

---

### Parallel 节点丰满专家

**必填字段检查**:
- \`branches\`: 并行分支节点ID列表
- \`mergeType\`: 合并类型 (all | any | none)

**验证规则**:
1. \`branches\` 不能为空数组
2. \`branches\` 中的每个节点ID必须存在于工作流节点列表中

**推断规则**:
- 如果 \`branches\` 为空，从父 milestone 的 \`childNodes\` 中推断
- \`mergeType\` 默认为 \`all\`

---

### Milestone 节点丰满专家

**必填字段检查**:
- \`description\`: 阶段描述
- \`childNodes\`: 子节点ID列表

**推荐字段补充**:
- \`waitForCompletion\`: 是否等待所有子节点完成
- \`timeout\`: 阶段超时时间

**描述推断规则**:
| 节点名称关键词 | 推断描述 |
|----------------|----------|
| 设计 | 设计阶段 |
| 开发 | 开发阶段 |
| 测试 | 测试阶段 |
| 发布 | 发布阶段 |
| 默认 | 使用节点名称 |

**超时推断规则**:
| 阶段类型 | 超时时间 |
|----------|----------|
| 设计阶段 | 7200000 (2小时) |
| 开发阶段 | 14400000 (4小时) |
| 测试阶段 | 3600000 (1小时) |
| 默认 | 7200000 (2小时) |

**childNodes 推断**:
从工作流的 \`edges\` 中查找以该 milestone 为源的所有直接子节点。

---

### Condition 节点丰满专家

**必填字段检查**:
- \`conditions\`: 条件分支列表
- \`defaultNode\`: 默认分支节点ID

**验证规则**:
1. \`conditions\` 中每个条件必须有 \`label\`、\`expression\`、\`targetNode\`
2. \`targetNode\` 必须存在于工作流节点列表中
3. \`defaultNode\` 必须存在于工作流节点列表中

**条件表达式格式**:
- \`{{variableName}} == value\`
- \`{{variableName}} >= value\`
- \`{{variableName}} <= value\`
- \`{{variableName}} > value\`
- \`{{variableName}} < value\`

---

### Loop 节点丰满专家

**必填字段检查**:
- \`loopConfig\`: 循环配置
- \`loopConfig.type\`: 循环类型 (count | condition | array)
- \`loopConfig.loopBodyNode\`: 循环体节点ID

**循环类型配置**:
| 类型 | 必需字段 |
|------|----------|
| count | \`count\`: 循环次数 |
| condition | \`condition\`: 循环条件表达式 |
| array | \`arrayVariable\`: 数组变量名, \`iteratorName\`: 迭代器名 |

**验证规则**:
- \`loopBodyNode\` 必须存在于工作流节点列表中

---

### Variable 节点丰满专家（项目配置节点）

**必填字段检查**:
- \`variableConfig\`: 变量配置

**V2 版本结构**:
\`\`\`json
{
  "version": "v2",
  "variables": [
    {
      "name": "变量名",
      "value": "变量值",
      "type": "string | number | boolean | json | array | object | file | directory",
      "description": "描述",
      "agentId": "专用智能体ID（可选）",
      "enabled": true
    }
  ],
  "groups": [
    { "id": "分组ID", "name": "分组名称", "icon": "📦", "color": "#1890ff" }
  ]
}
\`\`\`

**验证规则**:
1. \`version\` 必须为 "v2"
2. \`variables\` 数组不能为空
3. 每个变量的 \`name\` 和 \`value\` 必填
4. \`value\` 必须是字符串类型

---

### Output 节点丰满专家

**必填字段检查**:
- \`outputConfig\`: 输出配置
- \`outputConfig.name\`: 输出名称
- \`outputConfig.type\`: 输出类型 (file | data | document)

**推荐字段补充**:
- \`outputConfig.description\`: 输出描述
- \`outputConfig.isFinalOutput\`: 是否为最终输出

**默认值**:
- \`isFinalOutput\`: true（工作流末尾的 output 节点）

---

## 丰满优先级

1. **高优先级**: agent, review（核心执行节点）
2. **中优先级**: milestone, parallel, condition, loop（流程控制节点）
3. **低优先级**: variable, output（数据节点）

---

## 输出格式

丰满完成后输出：

\`\`\`
📊 工作流丰满报告

工作流: {workflowName}
原始节点数: {originalCount}
丰满后节点数: {refinedCount}

✅ 已丰满节点:
- {nodeName} ({nodeType}): 补充了 {fields}
- ...

⚠️ 需要人工确认:
- {nodeName}: {reason}

📁 已保存到: {filePath}
\`\`\`

---

## 注意事项

1. 丰满不会改变节点的核心逻辑，只补充配置细节
2. 推断的配置基于最佳实践，可能需要人工微调
3. 优先保证必填字段完整，推荐字段按需补充
4. 工作流保存路径: \`ahive-electron/data/workflows/{workflow-name}.json\`
`,
  
  tools: ['workflow_refine', 'workflow_validate', 'workflow_save', 'read_file', 'write_file'],
};
