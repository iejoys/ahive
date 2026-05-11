# AHIVE - 智能体集群管理器

> 一人多智能体协作可视化管理系统

AHIVE 是一个完整的智能体集群管理解决方案，包含 Web 版、桌面版和核心引擎三个子项目，支持多智能体协作、工作流编排、MCP 工具集成等功能。

---

## 📁 项目结构

```
ahive/
├── ahive-web/       # Web 版 - 浏览器访问的可视化管理界面
├── ahive-desktop/   # 桌面版 - Electron 本地应用
├── ahive-core/      # 核心引擎 - 智能体系统底层库
```

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户界面层                                │
├─────────────────────┬───────────────────────────────────────────┤
│   ahive-web (Web)   │           ahive-desktop (Electron)        │
│                     │                                           │
│  • 3D 智能体世界    │  • 本地工作流引擎                          │
│  • 工作流编辑器     │  • A2A 协议管理                            │
│  • MCP 工具面板     │  • WebSocket 服务器                       │
│  • 实时状态监控     │  • 本地数据持久化                          │
└─────────────────────┴───────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ahive-core (核心引擎)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 智能体系统   │  │ 工具执行器   │  │ 记忆系统     │          │
│  │              │  │              │  │              │          │
│  │ AHIVE-Worker │  │ Shell/FS/Web │  │ 向量搜索     │          │
│  │ AHIVE-Coder  │  │ LSP/Grep     │  │ 会话记忆     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 模型提供者   │  │ 沙箱执行器   │  │ 网关系统     │          │
│  │              │  │              │  │              │          │
│  │ OpenAI       │  │ 安全策略     │  │ HTTP API     │          │
│  │ Ollama       │  │ 权限控制     │  │ WebSocket    │          │
│  │ 本地 GGUF    │  │ 命令过滤     │  │ 认证中间件   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        外部服务                                  │
│                                                                 │
│  • OpenAI / Anthropic API    • Ollama 本地服务                  │
│  • MCP Server (工具服务)     • A2A Agent (智能体协议)           │
│  • 企业微信机器人            • LSP 语言服务器                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📦 子项目详解

### 1. ahive-web (Web 版)

**定位**: 浏览器访问的可视化管理界面

**技术栈**:
- React 18 + TypeScript
- Vite 构建工具
- Three.js / React Three Fiber (3D 可视化)
- ReactFlow (工作流编辑器)
- Socket.IO (实时通信)
- Express (后端服务)

**核心功能**:

| 功能模块 | 说明 |
|---------|------|
| **3D 智能体世界** | 可视化展示智能体状态、位置、交互关系 |
| **工作流编辑器** | 拖拽式节点编排，支持执行器、规划器、部门节点 |
| **MCP 工具面板** | 管理 MCP Server 连接，查看可用工具列表 |
| **智能体管理** | 创建、配置、监控智能体状态 |
| **任务面板** | 发送任务、查看执行进度、输出日志 |
| **日志中心** | 系统日志、工作流日志实时查看 |
| **黑板系统** | 工作流变量管理、数据共享 |

**目录结构**:
```
ahive-web/
├── src/
│   ├── client/           # 前端代码
│   │   ├── components/   # UI 组件
│   │   │   ├── 3d/       # 3D 可视化组件
│   │   │   ├── workflow/ # 工作流编辑器
│   │   │   ├── dialogs/  # 对话框组件
│   │   │   └── capability-hub/ # MCP 工具面板
│   │   ├── scheduler/    # 任务调度器
│   │   ├── store/        # Zustand 状态管理
│   │   └── utils/        # WebSocket 管理等
│   ├── server/           # 后端代码
│   │   ├── routes/       # API 路由
│   │   └── security/     # 安全过滤器
│   └── shared/           # 共享类型定义
├── public/               # 静态资源
└── config/               # 配置文件
```

**启动方式**:
```bash
cd ahive-web
npm install
npm run dev  # 同时启动前端和后端
```

---

### 2. ahive-desktop (桌面版)

**定位**: Electron 本地桌面应用，集成完整工作流引擎

**技术栈**:
- Electron 32
- React 18 + TypeScript
- Vite + vite-plugin-electron
- OpenClaw (智能体框架集成)
- SQLite (本地数据存储)

**核心功能**:

| 功能模块 | 说明 |
|---------|------|
| **工作流引擎** | 本地执行工作流，支持中断恢复、状态持久化 |
| **A2A 协议管理** | Agent-to-Agent 协议配置与通信 |
| **MCP 管理** | MCP Server 配置、连接管理 |
| **MCP-API** | HTTP API 形式的 MCP 服务配置 |
| **WebSocket 服务器** | 内置 WS 服务器，供前端连接 |
| **指挥官通道** | 工作流执行过程中的审批/干预机制 |
| **黑板服务** | 工作流变量存储与共享 |
| **定时任务** | Cron 表达式定时执行工作流 |
| **中断恢复** | 工作流中断后自动恢复执行 |

**目录结构**:
```
ahive-desktop/
├── electron/
│   ├── main.ts           # Electron 主进程
│   ├── preload.ts        # 预加载脚本
│   ├── workflow/         # 工作流引擎
│   │   ├── core/         # WorkflowEngine, Scheduler
│   │   ├── dynamic/      # 动态节点执行器
│   │   ├── persistence/  # 状态持久化
│   │   └ recovery/       # 中断恢复
│   ├── a2a/              # A2A 协议实现
│   │   ├── clients/      # 各种 A2A 客户端
│   │   └ config/         # 协议配置加载
│   ├── mcp/              # MCP 管理
│   ├── mcp-api/          # MCP-API 管理
│   ├── services/         # 服务层
│   │   └ ahivecore/      # AHIVECORE 服务集成
│   └ storage.ts          # 本地数据存储
├── src/                  # 前端代码
├── data/                 # 本地数据目录
│   ├── workflows/        # 工作流定义
│   ├── agents.json       # 智能体配置
│   └ protocol-config.json # 协议配置
└── config/               # 配置文件
```

**启动方式**:
```bash
cd ahive-desktop
pnpm install
npm run dev  # 启动 Electron 开发模式
```

**构建发布**:
```bash
npm run build  # 构建 Windows 安装包
```

---

### 3. ahive-core (核心引擎)

**定位**: 智能体系统底层引擎库，可独立运行或作为依赖集成

**技术栈**:
- TypeScript
- node-llama-cpp (本地 GGUF 模型推理)
- better-sqlite3 (向量数据库)
- WebSocket (通信)
- Zod (类型验证)

**核心模块**:

| 模块 | 导出路径 | 说明 |
|------|---------|------|
| **智能体系统** | `./agents` | AHIVE-Worker、AHIVE-Coder 执行器 |
| **工具执行器** | `./executor` | Shell、文件、网络、LSP 等工具 |
| **记忆系统** | `./memory` | 向量搜索、会话记忆、知识库 |
| **模型提供者** | `./providers` | OpenAI、Ollama、本地 GGUF 支持 |
| **沙箱执行器** | `./sandbox` | 安全策略、权限控制、命令过滤 |
| **网关系统** | `./gateway` | HTTP API、WebSocket、认证中间件 |
| **配置管理** | `./config` | 统一配置管理、Secret 管理 |
| **插件 SDK** | `./plugin-sdk` | 插件开发接口 |
| **工具编排器** | `./orchestrator` | 工具调用编排、并行执行 |

**智能体类型**:

| 类型 | 说明 |
|------|------|
| **AHIVE-Worker** | 对话型智能体，适合日常对话、轻量级任务 |
| **AHIVE-Coder** | 编程型智能体，适合代码编写、复杂推理 |
| **AHIVE-Webot** | 企业微信机器人智能体 |

**工具系统**:

| 工具类别 | 包含工具 |
|---------|---------|
| **文件操作** | read, write, edit, Glob, Grep |
| **Shell 执行** | exec, process |
| **网络工具** | web_search, web_fetch |
| **LSP 工具** | definition, references, hover |
| **智能体工具** | spawn_agent, wait_agent, send_message |
| **任务管理** | task_plan, update_plan |

**目录结构**:
```
ahive-core/
├── src/
│   ├── agents/           # 智能体系统
│   │   ├── core/         # UnifiedAgentSystem
│   │   ├── ahive-coder/  # 编程智能体
│   │   ├── ahive-worker/ # 对话智能体
│   │   └ ahive-webot/    # 企业微信智能体
│   ├── executor/         # 工具执行器
│   │   ├── builtin-tools.ts # 内置工具定义
│   │   ├── tool-system.ts   # 工具注册与执行
│   │   ├── shell-executor.ts # Shell 执行
│   │   ├── fs-executor.ts    # 文件系统执行
│   │   └ web-fetch.ts        # 网络请求
│   ├── memory/           # 记忆系统
│   │   ├── core/         # MemoryManager, MemoryDatabase
│   │   ├── codex-memory/ # Codex 风格记忆系统
│   │   └ skills/         # 技能记忆
│   ├── providers/        # 模型提供者
│   │   ├── openai-provider.ts
│   │   ├── ollama-provider.ts
│   │   ├── local-provider.ts  # GGUF 本地模型
│   ├── sandbox/          # 沙箱执行器
│   ├── gateway/          # 网关系统
│   ├── routes/           # HTTP API 路由
│   ├── hooks/            # Hook 系统
│   ├── orchestrator/     # 工具编排器
│   └── utils/            # 工具函数
├── config/               # 配置文件
│   ├── providers.json    # 模型提供者配置
│   ├── agents.json       # 智能体配置
│   ├── models.json       # 可用模型列表
│   └ memory.json         # 记忆配置
├── skills/               # 技能定义
└── templates/            # 模板文件
```

**启动方式**:
```bash
cd ahive-core
npm install
npm run dev  # 启动核心服务
```

**作为依赖使用**:
```typescript
import { 
  UnifiedAgentSystem,
  ToolRegistry,
  createMemoryStore,
  getProviderManager,
  SandboxExecutor,
} from 'ahive-core';

// 创建智能体系统
const agentSystem = new UnifiedAgentSystem();

// 注册工具
const toolRegistry = new ToolRegistry();
toolRegistry.register('read', readFileTool);

// 创建记忆存储
const memoryStore = createMemoryStore();
```

---

## 🔗 项目关系

```
┌──────────────────────────────────────────────────────────────┐
│                    依赖关系图                                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ahive-desktop                                              │
│        │                                                     │
│        ├───► ahive-core (通过 WebSocket/HTTP API 连接)       │
│        │                                                     │
│        ├───► OpenClaw (npm 依赖)                             │
│        │                                                     │
│        └───► ahive-llm-center (link 依赖)                    │
│                                                              │
│   ahive-web                                                  │
│        │                                                     │
│        └───► ahive-desktop (通过 WebSocket 连接)             │
│              或                                               │
│        └───► ahive-core (通过 HTTP API 连接)                 │
│                                                              │
│   ahive-core                                                 │
│        │                                                     │
│        └───► node-llama-cpp (本地模型推理)                   │
│        │                                                     │
│        └───► better-sqlite3 (向量数据库)                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**通信方式**:

| 场景 | 通信方式 |
|------|---------|
| ahive-web ↔ ahive-desktop | WebSocket (端口 3005) |
| ahive-desktop ↔ ahive-core | HTTP API (端口 18790) / WebSocket |
| ahive-core ↔ 外部 LLM | HTTP API (OpenAI/Ollama) |
| ahive-core ↔ 本地模型 | node-llama-cpp (GGUF) |

---

## 🚀 快速开始

### 方式一：使用桌面版（推荐）

```bash
# 1. 安装 ahive-desktop
cd ahive-desktop
pnpm install

# 2. 启动
npm run dev
```

桌面版内置了所有功能，无需额外配置。

### 方式二：Web 版 + 核心引擎

```bash
# 1. 启动核心引擎
cd ahive-core
npm install
npm run dev

# 2. 启动 Web 版
cd ahive-web
npm install
npm run dev

# 3. 访问 http://localhost:5173
```

### 方式三：仅使用核心引擎

```bash
cd ahive-core
npm install
npm run dev:isolated  # 独立模式运行
```

---

## 📋 配置说明

### ahive-core 配置

**providers.json** - 模型提供者配置:
```json
{
  "currentProvider": "bailian",
  "currentConfig": {
    "apiEndpoint": "https://coding.dashscope.aliyuncs.com/v1",
    "apiKey": "YOUR_API_KEY_HERE",
    "apiModel": "qwen3.6-plus"
  }
}
```

**agents.json** - 智能体配置:
```json
{
  "agents": [
    {
      "id": "main-agent",
      "type": "ahive-coder",
      "model": {
        "provider": "bailian",
        "name": "qwen3.6-plus",
        "temperature": 0.3
      }
    }
  ]
}
```

### ahive-desktop 配置

**config.json**:
```json
{
  "webUrl": "http://localhost:5173",
  "apiUrl": "http://localhost:18790"
}
```

**protocols.yaml** - A2A 协议配置:
```yaml
protocols:
  - name: ahivecore
    type: ahivecore
    endpoint: http://localhost:18790
  - name: openclaw
    type: openclaw
    endpoint: http://localhost:3000
```

---

## 🔧 开发指南

### 添加新智能体类型

在 `ahive-core/src/agents/` 下创建新目录：

```typescript
// src/agents/my-agent/index.ts
export { MyAgentExecutor } from './executor.js';
export { MY_AGENT_PROMPT } from './prompts.js';
```

### 添加新工具

在 `ahive-core/src/executor/builtin-tools.ts` 中注册：

```typescript
export const myNewTool: AgentTool = {
  name: 'my_tool',
  description: '我的自定义工具',
  parameters: { ... },
  execute: async (params) => { ... }
};
```

### 添加新工作流节点类型

在 `ahive-desktop/electron/workflow/` 中扩展：

```typescript
// 新节点执行器
export class MyNodeExecutor {
  async execute(node, context) { ... }
}
```

---

## 📚 API 参考

### ahive-core HTTP API

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 智能体对话 |
| `/api/agents` | GET | 获取智能体列表 |
| `/api/capabilities` | GET | 获取能力列表 |
| `/api/memory/search` | POST | 记忆搜索 |
| `/api/provider/config` | GET/PUT | 模型配置 |
| `/api/workflow/execute` | POST | 执行工作流 |

### WebSocket 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `agent_chat` | Server→Client | 智能体对话消息 |
| `workflow_event` | Server→Client | 工作流执行事件 |
| `task_update` | Server→Client | 任务状态更新 |
| `send_task` | Client→Server | 发送任务 |

---

## 🛡️ 安全说明

- 所有敏感配置已脱敏处理（API Key、Token 等）
- 沙箱执行器提供命令过滤和权限控制
- 支持 `workspace-write`、`on-request` 等安全策略
- 禁止执行危险命令（如 `rm -rf /`）

---

## 📄 许可证

MIT License

---

## 👥 作者  星未来软件工作室

**主页**: https://www.ahive.cn

=====================================================================================
# AHIVE - Multi-Agent Collaboration System

> **AHIVE** (Agent Hive) is an intelligent multi-agent collaboration platform that enables one person to orchestrate multiple AI agents working together visually.

## 📋 Overview

AHIVE is a comprehensive multi-agent orchestration system consisting of three core projects:

| Project | Description | Role |
|---------|-------------|------|
| **ahive-core** | Core Engine | Agent system, tool execution, memory, gateway |
| **ahive-desktop** | Desktop Application | Electron app, workflow engine, A2A/MCP protocols |
| **ahive-web** | Web Frontend | React 3D visualization, workflow editor |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ahive-web (Frontend)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  3D Agent   │  │  Workflow   │  │  Real-time Monitor  │  │
│  │  World      │  │  Editor     │  │  (WebSocket)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket / HTTP
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   ahive-desktop (Desktop App)                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Workflow   │  │  A2A/MCP    │  │  Local Storage      │  │
│  │  Engine     │  │  Protocols  │  │  (JSON/SQLite)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ IPC / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ahive-core (Core Engine)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Unified    │  │  Tool       │  │  Memory System      │  │
│  │  Agent Sys  │  │  Registry   │  │  (Vector Search)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Commander  │  │  Webot      │  │  Knowledge Base     │  │
│  │  Agent      │  │  (WeCom)    │  │  (Expert System)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Project Details

### 1. ahive-core - Core Engine

**The brain of AHIVE system**, providing all core capabilities.

#### Key Features

| Module | Description |
|--------|-------------|
| **UnifiedAgentSystem** | Unified agent framework supporting ahive-worker and ahive-coder types |
| **Commander Agent** | Knowledge-based agent for autonomous workflow orchestration, task distribution, and execution monitoring |
| **Webot Agent** | Enterprise WeChat bot integration for remote communication and notifications |
| **Tool Registry** | Built-in tools: file operations, shell execution, web search/fetch, LSP, Glob/Grep |
| **Memory System** | Session memory, vector search, memory compaction, knowledge retrieval |
| **Knowledge Base** | Document import, chunking, semantic search, citation tracking |
| **Provider Manager** | Multi-provider support: OpenAI, Ollama, Local GGUF, Bailian, Custom |
| **Sandbox Executor** | Secure execution with approval policies and command filtering |
| **Gateway** | HTTP server, authentication, quota management, logging middleware |

#### Agent Types

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Types                           │
├─────────────────────────────────────────────────────────┤
│  ahive-worker  │ General conversational agent           │
│  ahive-coder   │ Code execution agent with tool calling │
│  commander     │ Workflow orchestration & task dispatch │
│  webot         │ Enterprise WeChat communication bridge │
└─────────────────────────────────────────────────────────┘
```

#### Commander Agent Capabilities

- **Page Control**: Navigate UI, open dialogs, toggle panels
- **Workflow Generation**: Decompose user intent into executable workflows
- **Agent Orchestration**: Dispatch tasks to agents, monitor execution status
- **Configuration Management**: View and modify system settings
- **MCP Tool Management**: Enable/disable MCP capabilities

#### Directory Structure

```
ahive-core/
├── src/
│   ├── agents/           # Agent implementations
│   │   ├── core/         # UnifiedAgentSystem
│   │   ├── ahive-coder/  # Code execution agent
│   │   ├── ahive-worker/ # Conversational agent
│   │   └── ahive-webot/  # Enterprise WeChat bot
│   ├── prompts/
│   │   └── commander/    # Commander prompts & skills
│   ├── executor/         # Tool execution system
│   ├── memory/           # Memory & vector search
│   ├── knowledge/        # Knowledge base (expert system)
│   ├── providers/        # LLM providers
│   ├── gateway/          # HTTP gateway & auth
│   ├── sandbox/          # Secure execution
│   └── routes/           # API routes
├── config/               # Configuration files
├── skills/               # Skill definitions
└── templates/            # Memory templates
```

---

### 2. ahive-desktop - Desktop Application

**Electron-based desktop client** for local workflow execution.

#### Key Features

| Module | Description |
|--------|-------------|
| **Workflow Engine** | Execute workflows with interrupt/resume, state persistence |
| **Workflow Scheduler** | Cron-based scheduling, interval tasks, one-time execution |
| **A2A Protocol** | Agent-to-Agent communication (AHIVECORE, OpenClaw, A2A-Standard) |
| **MCP Integration** | Model Context Protocol tool management |
| **Blackboard System** | Global variables, workflow variables, event tracking |
| **State Persistence** | SQLite-based execution state and log storage |
| **Department Management** | Agent grouping and role assignment |

#### Workflow Node Types

```
┌─────────────────────────────────────────────────────────┐
│                  Workflow Nodes                          │
├─────────────────────────────────────────────────────────┤
│  executor      │ Execute task with specified agent      │
│  planner       │ Decompose complex task into subtasks   │
│  department    │ Group agents by function               │
│  dynamic-parallel │ Parallel execution with batching   │
│  review        │ Human review checkpoint                │
└─────────────────────────────────────────────────────────┘
```

#### Directory Structure

```
ahive-desktop/
├── electron/
│   ├── main.ts           # Electron main process
│   ├── preload.ts        # IPC bridge
│   ├── workflow/         # Workflow engine & scheduler
│   │   ├── core/         # WorkflowEngine, CommanderChannel
│   │   ├── dynamic/      # Planner, DynamicParallel
│   │   └── persistence/  # StateManager, OutputCollector
│   ├── a2a/              # A2A protocol clients
│   ├── mcp/              # MCP tool management
│   └── services/         # AHIVECORE service, WebSocket
├── data/                 # Local data storage
│   ├── workflows/        # Workflow definitions
│   ├── agents.json       # Agent configurations
│   └── protocol-config.json
└── src/                  # React frontend
```

---

### 3. ahive-web - Web Frontend

**Browser-based visualization interface** for agent monitoring and workflow editing.

#### Key Features

| Module | Description |
|--------|-------------|
| **3D Agent World** | Three.js visualization of agent positions and status |
| **Workflow Editor** | ReactFlow-based drag-and-drop workflow design |
| **Capability Hub** | MCP tool panel, server status, tool cards |
| **Task Panel** | Task creation, execution monitoring, output display |
| **Log Center** | System logs, workflow execution logs |
| **Department Manager** | Agent grouping and assignment |
| **Blackboard Panel** | Variable management, event timeline |

#### 3D Visualization

- **Agent Characters**: Customizable 3D avatars for each agent type
- **Status Effects**: Visual indicators for idle/working/error states
- **Workflow Execution**: Animated flow showing task progression
- **Memory Monitor**: Real-time memory usage visualization
- **Scene Selection**: Multiple 3D scenes (cyberpunk, nature, office)

#### Directory Structure

```
ahive-web/
├── src/
│   ├── client/
│   │   ├── components/
│   │   │   ├── 3d/           # Three.js components
│   │   │   ├── workflow/     # Workflow editor
│   │   │   ├── capability-hub/
│   │   │   ├── dialogs/      # Modal dialogs
│   │   │   └── logs/         # Log panels
│   │   ├── scheduler/        # Client-side task scheduling
│   │   ├── store/            # Zustand state management
│   │   └── utils/            # WebSocket manager
│   ├── server/               # Express backend
│   └── shared/               # Shared types & protocols
└── public/                   # Static assets
```

---

## 🔧 Tech Stack

| Category | ahive-core | ahive-desktop | ahive-web |
|----------|------------|---------------|-----------|
| **Runtime** | Node.js 20+ | Electron 32 | Vite 5 |
| **Language** | TypeScript | TypeScript | TypeScript |
| **Framework** | Express | Electron | React 18 |
| **3D/UI** | - | React | Three.js, ReactFlow |
| **State** | - | SQLite | Zustand |
| **Communication** | WebSocket | IPC, WebSocket | Socket.io |
| **LLM** | node-llama-cpp, OpenAI | OpenClaw | - |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm (recommended)
- Ollama (optional, for local LLM)

### Installation

```bash
# Clone repository
git clone https://github.com/iejoys/ahive.git
cd ahive

# Install dependencies for each project
cd ahive-core && pnpm install
cd ahive-desktop && pnpm install
cd ahive-web && pnpm install
```

### Running

```bash
# Start core engine
cd ahive-core
pnpm dev

# Start desktop app
cd ahive-desktop
pnpm dev

# Start web frontend
cd ahive-web
pnpm dev
```

---

## ⚙️ Configuration

### ahive-core Configuration

Edit `ahive-core/config/providers.json`:

```json
{
  "currentProvider": "bailian",
  "currentConfig": {
    "apiEndpoint": "https://api.example.com/v1",
    "apiKey": "YOUR_API_KEY_HERE",
    "apiModel": "qwen3.6-plus"
  }
}
```

### Enterprise WeChat Configuration

Edit `ahive-core/config/wecom.json` (create if needed):

```json
{
  "botId": "YOUR_BOT_ID",
  "secret": "YOUR_BOT_SECRET",
  "enabled": true
}
```

### ahive-desktop Configuration

Edit `ahive-desktop/config.json`:

```json
{
  "webUrl": "http://localhost:5173",
  "apiUrl": "http://localhost:18790"
}
```

---

## 📡 Communication Protocols

### A2A (Agent-to-Agent)

Supports multiple protocol types:

| Protocol | Description |
|----------|-------------|
| **ahivecore** | Native AHIVE protocol via WebSocket |
| **openclaw** | OpenClaw CLI integration |
| **a2a-standard** | Standard A2A HTTP protocol |

### MCP (Model Context Protocol)

- Tool discovery and registration
- Capability pushing to agents
- HTTP server for external tool access

---

## 🛡️ Security

### Sandbox Execution

- **Approval Policies**: on-request, never, workspace-write
- **Denied Commands**: rm -rf, format, fdisk, mkfs
- **Denied Paths**: .git/hooks, .ssh, .env

### Authentication

- API key based agent authentication
- Token hash verification
- Quota management per agent

---

## 📝 License

MIT License - See LICENSE file for details.

---

## 👥 Author

**星未来软件工作室** (Star Future Software Studio)

Homepage: https://www.ahive.cn
