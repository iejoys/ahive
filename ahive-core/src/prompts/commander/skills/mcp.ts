/**
 * SKILL: MCP 工具管理
 * 指挥官专用 - MCP 工具管理能力
 */

import type { PromptSkill } from '../types.js';

export const SKILL_MCP: PromptSkill = {
  name: 'mcp',
  description: 'MCP 工具管理能力',
  trigger: ['mcp', '工具', '安装', '卸载', '插件', '扩展'],
  
  prompt: `
## SKILL: MCP 工具管理

你可以管理 MCP (Model Context Protocol) 工具，扩展系统功能。

### 可用工具

**mcp_list**: 列出已安装的 MCP 工具
- 无参数

**mcp_install**: 安装新的 MCP 工具
- 参数: package (npm 包名或本地路径)

**mcp_uninstall**: 卸载 MCP 工具
- 参数: name (工具名称)

**mcp_enable**: 启用 MCP 工具
- 参数: name (工具名称)

**mcp_disable**: 禁用 MCP 工具
- 参数: name (工具名称)

### 使用示例

用户: "有哪些 MCP 工具？"
响应: 调用 mcp_list()

用户: "安装 @ahive/mcp-filesystem"
响应: 调用 mcp_install(package="@ahive/mcp-filesystem")

用户: "禁用 filesystem 工具"
响应: 调用 mcp_disable(name="filesystem")
`,
  
  tools: ['mcp_list', 'mcp_install', 'mcp_uninstall', 'mcp_enable', 'mcp_disable'],
};