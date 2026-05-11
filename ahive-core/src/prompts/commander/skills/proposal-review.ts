/**
 * SKILL: 任务计划审批
 * 触发词：[PLAN_SUBMIT]
 * 
 * 功能：审批执行 Agent 使用 update_plan 创建的任务计划
 */

import type { PromptSkill } from '../types.js';

export const SKILL_PROPOSAL_REVIEW: PromptSkill = {
  name: 'proposal-review',
  trigger: ['[PLAN_SUBMIT]', 'plan submit', '任务计划审批'],
  
  prompt: `
# 任务计划审批

触发条件：收到执行 Agent 发送的 \`[PLAN_SUBMIT]\` 消息

---

## 消息格式

执行 Agent 发送：
\`\`\`
[PLAN_SUBMIT]
Plan ID: {planId}
Task ID: {taskId}
Node ID: {nodeId}
Steps: {步骤数量}
\`\`\`

---

## 审批步骤

### 1. 读取计划文件

计划文件路径：\`.ahive/plans/{planId}.json\`

\`\`\`
read_file({ path: ".ahive/plans/{planId}.json", encoding: "utf-8" })
\`\`\`

### 2. 评估计划

检查项：
- 步骤是否合理（粒度适中，无过度拆分）
- 依赖关系是否清晰（无循环依赖）
- agentType 分配是否合理（前端→frontend，后端→backend）
- 预估时间是否合理

### 3. 上报工作流引擎

\`\`\`
workflow_report({
  report_type: "task_decompose",
  task_id: "{taskId}",
  node_id: "{nodeId}",
  proposal_id: "{planId}",
  plan_path: ".ahive/plans/{planId}.json",
  status: "pending_approval"
})
\`\`\`

### 4. 回复执行 Agent

**批准**：
\`\`\`
send_message({
  to_agent: "{agentId}",
  message: "[PLAN_APPROVED] Plan ID:{planId} You can now execute the plan.",
  type: "response"
})
\`\`\`

**驳回**：
\`\`\`
send_message({
  to_agent: "{agentId}",
  message: "[PLAN_REJECTED] Plan ID:{planId} Reason:{驳回原因} Suggestions:{修改建议}",
  type: "response"
})
\`\`\`

---

## 审批标准

| 情况 | 决策 |
|------|------|
| 步骤合理，依赖清晰 | APPROVED |
| 步骤过细（<5分钟/步） | REJECTED，建议合并 |
| 步骤过大（>60分钟/步） | REJECTED，建议拆分 |
| 依赖关系混乱 | REJECTED，建议重新梳理 |

---

## 注意事项

- 审批超时 30 分钟自动批准
- 同一计划驳回 3 次后，Agent 可直接执行
- 使用 \`workflow_report\` 向引擎汇报，使用 \`send_message\` 回复 Agent

**Version**: 2.0.0
**Updated**: 2026-04-19
`,
  
  tools: ['read_file', 'workflow_report', 'send_message'],
  description: '审批执行 Agent 的任务计划',
  priority: 10,
};