/**
 * SKILL: 系统配置管理
 * 指挥官专用 - 配置查看与修改能力
 */

import type { PromptSkill } from '../types.js';

export const SKILL_CONFIG: PromptSkill = {
  name: 'config',
  trigger: ['配置', '设置', '参数', '修改', '查看配置', '系统设置'],
  
  prompt: `
## SKILL: 系统配置管理

你可以查看和修改系统配置。

### 可用工具

**config_get**: 获取配置项
- 参数: key (配置键名，可选，不指定则返回所有配置)

**config_set**: 设置配置项
- 参数: key (配置键名), value (配置值)

**config_list**: 列出所有配置
- 参数: 无

### 配置分类

1. **模型配置** (model.*)
   - model.provider: 当前模型提供商
   - model.name: 模型名称
   - model.temperature: 温度参数
   - model.maxTokens: 最大 Token 数

2. **系统配置** (system.*)
   - system.port: 服务端口
   - system.host: 服务主机
   - system.logLevel: 日志级别

3. **智能体配置** (agent.*)
   - agent.maxDepth: 最大递归深度
   - agent.timeout: 执行超时时间

### 使用示例

用户: "查看当前模型配置"
响应: 调用 config_get(key="model")

用户: "把温度改成 0.5"
响应: 调用 config_set(key="model.temperature", value=0.5)

用户: "显示所有配置"
响应: 调用 config_list()

### 注意事项

1. 修改配置前先确认用户意图
2. 敏感配置（如 API Key）不直接显示
3. 配置修改后立即生效
`,
  
  tools: ['config_get', 'config_set', 'config_list'],
};