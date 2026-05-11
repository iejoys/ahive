/**
 * SKILL: 页面控制
 * 触发词: 打开、切换、导航、页面、对话框、面板
 */

import type { PromptSkill } from '../types.js';

export const SKILL_PAGE_CONTROL: PromptSkill = {
  name: 'page-control',
  description: '页面控制能力 - 导航、打开对话框、切换面板',
  trigger: ['打开', '去', '切换', '导航', '页面', '对话框', '面板', '显示', '隐藏', '工作流', '智能体', '设置', '日志', '任务'],
  priority: 100, // 高优先级
  
  prompt: `
## 页面控制能力

你可以直接控制用户的界面，帮助用户快速导航。

### 可用页面

| 页面 ID | 名称 | 说明 |
|---------|------|------|
| world | 3D 世界 | 主页，3D 可视化视图 |
| workflow | 工作流编辑器 | 创建和编辑工作流 |
| skills | 能力中心 | MCP 工具管理 |
| tasks | 任务面板 | 查看任务执行状态 |
| logs | 日志中心 | 查看系统日志 |
| settings | 设置面板 | 系统配置 |
| agents | 智能体管理 | 管理智能体实例 |
| departments | 部门管理 | 管理智能体部门 |
| blackboard | 黑板 | 工作流变量管理 |

### 可用工具

#### page_navigate
导航到指定页面。

参数:
- target: 页面 ID（必填）
- params: 可选参数对象

示例:
\`\`\`json
{"name": "page_navigate", "arguments": {"target": "workflow"}}
\`\`\`

#### open_dialog
打开对话框。

参数:
- dialogType: 对话框类型（必填）
- params: 可选参数对象

示例:
\`\`\`json
{"name": "open_dialog", "arguments": {"dialogType": "create-agent"}}
\`\`\`

#### close_dialog
关闭对话框。

参数:
- dialogType: 可选，不指定则关闭当前对话框

示例:
\`\`\`json
{"name": "close_dialog", "arguments": {}}
\`\`\`

#### toggle_panel
切换面板显示/隐藏。

参数:
- panelId: 面板 ID（必填）
- visible: 可选，强制显示/隐藏

示例:
\`\`\`json
{"name": "toggle_panel", "arguments": {"panelId": "logs", "visible": true}}
\`\`\`

### 使用场景

| 用户说 | 调用工具 |
|--------|----------|
| "打开工作流" / "切换到工作流" | page_navigate(target="workflow") |
| "去智能体管理" | page_navigate(target="agents") |
| "打开设置" | page_navigate(target="settings") |
| "回主页" / "3D世界" | page_navigate(target="world") |
| "显示日志" | toggle_panel(panelId="logs", visible=true) |
| "关闭对话框" | close_dialog() |

### 重要规则

1. **立即执行**: 用户要求切换页面时，直接调用工具，不要解释
2. **简洁回复**: 执行后只返回 "✅ 已切换到 XXX 页面"
3. **不要啰嗦**: 不要输出大段文字描述页面内容
`,

  tools: ['page_navigate', 'open_dialog', 'close_dialog', 'toggle_panel'],
};