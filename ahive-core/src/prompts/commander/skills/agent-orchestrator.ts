/**
 * SKILL: 智能体统筹调度
 * 触发词：智能体、调度、分配、协作、分身
 */

import type { PromptSkill } from '../types.js';

export const SKILL_AGENT_ORCHESTRATOR: PromptSkill = {
  name: 'agent-orchestrator',
  trigger: ['智能体', '调度', '分配', '协作', '分身', 'agent', '创建智能体', '终止'],
  
  prompt: `
## SKILL: 智能体统筹调度

你可以调度其他智能体协作完成任务。

### 可用工具

**send_message**: 发送消息给指定智能体
- 参数: to_agent (智能体ID或昵称), message (消息内容), type (消息类型)

**list_agents**: 列出所有可用智能体
- 参数: search (可选，搜索关键词)

**spawn_agent**: 创建分身智能体处理子任务
- 参数: role (角色类型), message (任务描述), fork_history (是否继承历史)

**wait_agent**: 等待智能体完成任务
- 参数: id 或 ids (智能体ID), timeout_ms (超时时间), auto_terminate (是否自动终止)

### 智能体类型

| 类型 | 角色 | 能力 |
|------|------|------|
| codex-frontend | 前端开发 | React, Vue, CSS, UI/UX |
| codex-backend | 后端开发 | Node.js, Python, API |
| codex-fullstack | 全栈开发 | 前后端一体化 |
| openclaw-artist | 美术设计 | 图像、UI、视觉 |
| openclaw-audio | 音频处理 | 音乐、音效、配音 |

### 使用示例

用户: "让前端开发帮我写个登录页面"
响应:
1. 调用 list_agents(search="前端") 查找前端智能体
2. 调用 send_message(to_agent="codex-frontend", message="请实现登录页面", type="task")

用户: "创建一个分身处理这个子任务"
响应:
1. 调用 spawn_agent(role="codex-backend", message="处理子任务描述", fork_history=false)
2. 等待结果后调用 wait_agent(id="返回的agentId")

用户: "查看所有智能体状态"
响应: 调用 list_agents()

### 企业微信消息推送

当需要向企业微信用户推送消息时，可以发送消息给 ahive-webot 智能体。

**使用方式**: 发送消息给 ahive-webot 智能体

**消息格式**:
\`\`\`
send_message({
  to_agent: "ahive-webot",
  message: "要推送的消息内容",
  type: "task"
})
\`\`\`

**回复路由**: 消息会自动添加 \`[FROM_AGENT: 你的智能体ID]\` 标记。用户回复时，回复会自动路由回你的智能体。

**示例**:
\`\`\`
send_message({
  to_agent: "ahive-webot",
  message: "文件修改已完成，请查看 src/app.ts"
})
\`\`\`

用户回复后，你会收到类似这样的消息：
\`\`\`
[REQID: xxx]
回复时请在开头保留: [REQID: xxx]

用户消息：
好的，谢谢！
\`\`\`

### 调度原则

1. **按需分配**: 根据任务类型选择合适的智能体
2. **并行执行**: 独立任务可以并行分配给多个智能体
3. **结果整合**: 收集所有智能体的结果，整合后回复用户
4. **资源管理**: 及时终止不需要的分身智能体
5. **人机协作**: 重要修改发送审核卡片，让用户确认后再执行
`,
  
  tools: ['send_message', 'list_agents', 'spawn_agent', 'wait_agent'],
};