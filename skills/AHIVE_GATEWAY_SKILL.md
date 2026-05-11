---
name: ahive-gateway
description: 连接 AHIVE 智能体集群管理系统，实现 MCP 工具调用和 A2A 智能体通讯
version: 1.0.0
author: StarFuture Software Studio
category: ai-agents
private: true
scope: lan-only
tags:
  - ahive
  - mcp
  - a2a
  - multi-agent
  - gateway
---

# AHIVE Gateway Skill

连接 AHIVE 智能体集群管理系统，获取 MCP 工具调用能力和 A2A 智能体通讯能力。

---

## 一、AHIVE 服务端点

安装此 Skill 后，你可以：

1. **调用 MCP 工具** - 访问文件系统、数据库、API 等
2. **与其他 Agent 通讯** - 通过 A2A 协议协作

### 服务地址

| 服务 | 端口 | 地址 | 用途 |
|------|------|------|------|
| MCP 工具服务 | 3002 | `http://127.0.0.1:3002` | 调用 MCP 工具 |
| A2A 通讯服务 | 3003 | `http://127.0.0.1:3003` | Agent 间通讯 |

---

## 二、MCP 工具调用

### 2.1 列出可用服务器

```bash
GET http://127.0.0.1:3002/mcp/servers
```

**响应示例：**
```json
[
  { "id": "filesystem", "name": "Filesystem", "status": "running" },
  { "id": "github", "name": "GitHub", "status": "running" }
]
```

### 2.2 列出服务器工具

```bash
GET http://127.0.0.1:3002/mcp/{serverId}/tools
```

**示例：**
```bash
GET http://127.0.0.1:3002/mcp/filesystem/tools
```

### 2.3 调用工具

```bash
POST http://127.0.0.1:3002/mcp/{serverId}/{toolName}
Content-Type: application/json

{
  "arguments": {
    "path": "/docs/readme.md"
  }
}
```

**示例 - 读取文件：**
```bash
POST http://127.0.0.1:3002/mcp/filesystem/readFile
Content-Type: application/json

{
  "arguments": {
    "path": "F:\\project\\README.md"
  }
}
```

**示例 - 写入文件：**
```bash
POST http://127.0.0.1:3002/mcp/filesystem/writeFile
Content-Type: application/json

{
  "arguments": {
    "path": "F:\\project\\output.txt",
    "content": "Hello from AHIVE!"
  }
}
```

---

## 三、A2A 智能体通讯

### 3.1 发送消息给其他 Agent

```bash
GET http://127.0.0.1:3003/a2a?type={类型}&sender={你的ID}&AGENTNAME={目标Agent}&消息={内容}
```

**消息类型：**

| 类型 | 说明 | 使用场景 |
|------|------|----------|
| `talktoagent` | 普通对话 | 日常沟通 |
| `review_request` | 审核请求 | 请求他人审核你的工作 |
| `review_result` | 审核结果 | 审核完成后反馈 |
| `handover` | 任务交接 | 把任务交给其他人 |
| `question` | 提问 | 有问题需要帮助 |
| `answer` | 回答 | 回复别人的问题 |

**示例 - 发送审核请求：**
```bash
GET http://127.0.0.1:3003/a2a?type=review_request&sender=alice&AGENTNAME=carol&消息="需求文档已完成，请审核"
```

**示例 - 任务交接：**
```bash
GET http://127.0.0.1:3003/a2a?type=handover&sender=alice&AGENTNAME=bob&消息="前端开发已完成，请接手测试"&节点ID=frontend&工作流ID=project-xxx
```

### 3.2 POST 方式发送（支持长消息）

```bash
POST http://127.0.0.1:3003/a2a
Content-Type: application/json

{
  "type": "talktoagent",
  "sender": "alice",
  "AGENTNAME": "bob",
  "消息": "这是一段很长的消息内容..."
}
```

### 3.3 获取团队通讯录

```bash
GET http://127.0.0.1:3003/a2a/directory
```

**响应示例：**
```json
{
  "type": "team_directory",
  "projectId": "default",
  "MCP_URL": "http://127.0.0.1:3002/mcp",
  "A2A_URL": "http://127.0.0.1:3003/a2a",
  "agents": [
    { "id": "alice", "name": "Alice", "role": "需求分析师" },
    { "id": "bob", "name": "Bob", "role": "开发者" }
  ],
  "messageTypes": [
    { "type": "talktoagent", "description": "普通对话" },
    { "type": "review_request", "description": "审核请求" }
  ]
}
```

### 3.4 查询对话日志

```bash
GET http://127.0.0.1:3003/a2a/logs?workflowId={工作流ID}&limit=50
```

### 3.5 获取智能体状态

```bash
GET http://127.0.0.1:3003/a2a/status
```

---

## 四、完整示例

### 场景：完成开发任务后请求审核

```bash
# 1. 读取需求文档
POST http://127.0.0.1:3002/mcp/filesystem/readFile
{
  "arguments": { "path": "docs/requirements.md" }
}

# 2. 完成开发后，写入代码
POST http://127.0.0.1:3002/mcp/filesystem/writeFile
{
  "arguments": { 
    "path": "src/feature.ts",
    "content": "// 实现代码..."
  }
}

# 3. 发送审核请求给审核员
GET http://127.0.0.1:3003/a2a?type=review_request&sender=developer&AGENTNAME=reviewer&消息="功能开发完成，代码已提交，请审核 src/feature.ts"
```

---

## 五、注意事项

1. **确保 AHIVE 客户端已启动** - MCP 和 A2A 服务需要 AHIVE 客户端运行
2. **检查端口** - 默认 MCP 端口 3002，A2A 端口 3003
3. **消息编码** - URL 参数需要 URL 编码，长消息建议用 POST
4. **Agent ID** - sender 和 AGENTNAME 要与 AHIVE 中配置的 Agent ID 一致

---

## 六、故障排除

### 服务无响应

```bash
# 检查 MCP 服务状态
curl http://127.0.0.1:3002/health

# 检查 A2A 服务状态
curl http://127.0.0.1:3003/health
```

### 工具调用失败

1. 确认服务器 ID 正确
2. 确认工具名称正确
3. 检查参数格式

---

**Copyright (c) 2026 星未来软件工作室 StarFuture Software Studio (AHIVE.CN)**