import { useEffect, useState, useCallback } from 'react';
import { Sidebar } from './components/ui/Sidebar';
import { Header } from './components/ui/Header';
import { AgentWorld } from './components/3d/AgentWorld';
import { MCPToolPanel } from './components/capability-hub/MCPToolPanel';
import { TaskPanel } from './components/task/TaskPanel';
import { LogCenterPanel } from './components/logs/LogCenterPanel';
import { CreateAgentDialog } from './components/dialogs/CreateAgentDialog';
import { DialogProvider } from './components/common/DialogProvider';
import { FloatingAHIVECore } from './components/3d/FloatingAHIVECore';
import { WorkflowInstanceDetailDialog } from './components/dialogs/WorkflowInstanceDetailDialog';
import { useStore } from './store/useStore';
import { translations } from './i18n';
import type { Agent, Skill, Task } from './types';
import { initializeDataFromStorage } from './store/useStore';
import { wsManager } from './utils/wsManager';
import { handleWorkflowEvent } from './store/useStore';
import { loadWorkflowsFromStorage } from './scheduler';
import { usePageControl } from './hooks/usePageControl';
import { ErrorBoundary } from './components/common/ErrorBoundary';


// 发送到WPF桌面端
export function sendToWPF(data: object) {
  try {
    // @ts-ignore
    window.chrome?.webview?.postMessage(JSON.stringify(data));
  } catch (e) {
    // 非桌面环境，忽略
  }
}

// Mock data for initial development
const MOCK_AGENTS: Agent[] = [
  {
    id: '1',
    name: 'OpenCode',
    description: '代码生成与调试专家',
    status: 'idle',
    avatar: 'coder',
    position: { x: 0, y: 0, z: 0 },
    skills: ['code-gen', 'debug', 'refactor'],
    type: 'opencode',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    name: 'MCP',
    description: '网络搜索与信息收集',
    status: 'idle',
    avatar: 'searcher',
    position: { x: 2, y: 0, z: 1 },
    skills: ['web-search', 'summarize'],
    type: 'mcp',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    name: 'Mock',
    description: '数据分析与可视化',
    status: 'idle',
    avatar: 'analyzer',
    position: { x: -2, y: 0, z: 2 },
    skills: ['data-analysis', 'visualize'],
    type: 'mock',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '4',
    name: 'DOC',
    description: '文档生成与管理',
    status: 'idle',
    avatar: 'robot',
    position: { x: 3, y: 0, z: -1 },
    skills: ['doc-gen', 'markdown', 'template'],
    type: 'custom',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '5',
    name: 'Checker',
    description: '代码审查与质量检查',
    status: 'idle',
    avatar: 'mcp',
    position: { x: -3, y: 0, z: -1 },
    skills: ['lint', 'audit', 'review'],
    type: 'custom',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const MOCK_SKILLS: Skill[] = [
  {
    id: 'web-search',
    name: '网络搜索',
    description: '在互联网上搜索信息',
    category: 'web',
    icon: '🔍',
    dependencies: [],
    installs: 32500,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'summarize',
    name: '文档摘要',
    description: '总结长文档和文本内容',
    category: 'core',
    icon: '📝',
    dependencies: ['web-search'],
    installs: 28000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'code-gen',
    name: '代码生成',
    description: '用多种编程语言生成代码',
    category: 'core',
    icon: '💻',
    dependencies: [],
    installs: 45000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'debug',
    name: '调试',
    description: '发现并修复代码中的bug',
    category: 'core',
    icon: '🐛',
    dependencies: ['code-gen'],
    installs: 21000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'refactor',
    name: '重构',
    description: '重构和改进代码质量',
    category: 'core',
    icon: '🔧',
    dependencies: ['code-gen'],
    installs: 18000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'data-analysis',
    name: '数据分析',
    description: '分析和处理数据',
    category: 'data',
    icon: '📊',
    dependencies: [],
    installs: 22000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'visualize',
    name: '数据可视化',
    description: '从数据创建可视化图表',
    category: 'data',
    icon: '📈',
    dependencies: ['data-analysis'],
    installs: 15000,
    createdAt: new Date().toISOString(),
  },
];

// 导出刷新函数供其他组件使用
export const refreshAgentsEvent = { listeners: [] as (() => void)[] };

function App() {
  const {
    setAgents,
    setSkills,
    addTask,
    language,
    activeTab,
    setOfflineAgents,
    // WebSocket 全局状态
    setWsConnected,
    updateStreamMessage,
    clearStreamMessage,
    addExecutionLog,
    updateMemoryData,
    addAgentChatMessage,
    setAgentTyping,
    agents,
    // 启动检测界面状态
    showStartupCheck,
    setShowStartupCheck,
    setPendingWorkflowId,
    setPendingWorkflowName,
    setCurrentWorkflow,
    workflows,
  } = useStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [currentScene, setCurrentScene] = useState('default');
  const tr = translations[language];

  // ========== 页面控制 Hook ==========
  // 监听指挥官的页面控制指令
  usePageControl();

  // 加载所有 Agents（包括 A2A Agents）
  const loadAllAgents = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const agentsParam = params.get('agents');

    let initialAgents: Agent[] = [];

    if (agentsParam) {
      const agentNames = agentsParam.split(',').filter(n => n);
      initialAgents = agentNames.map((name, i) => ({
        id: `agent-${name}`,
        name: name,
        description: 'AI Assistant',
        status: 'idle' as const,
        avatar: '🤖',
        position: { x: Math.cos(i * 2 * Math.PI / agentNames.length) * 5, y: 0, z: Math.sin(i * 2 * Math.PI / agentNames.length) * 5 },
        skills: [],
        type: 'openclaw' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      console.log('Loaded agents from URL:', initialAgents.length);
    } else {
      // 使用 electronAPI.isDesktop 检测是否在 Electron 桌面环境
      const isDesktop = (window as any).electronAPI?.isDesktop === true;

      if (isDesktop) {
        // Electron 桌面环境：不加载演示数据，使用空数组
        // 真正的智能体数据会从 A2A 或持久化存储加载
        initialAgents = [];
        console.log('Running in Electron desktop environment, skipping mock data');
      } else {
        // Web 演示环境：加载 mock 数据
        initialAgents = [...MOCK_AGENTS];
        setSkills(MOCK_SKILLS);
        console.log('Running in Web demo environment, loaded mock agents');
      }
    }

    // 加载 A2A Agents 并合并
    try {
      const anyWindow = window as any;
      if (anyWindow.electronAPI?.getA2AAgentList) {
        const a2aAgents = await anyWindow.electronAPI.getA2AAgentList();
        console.log('Loaded A2A agents:', a2aAgents?.length || 0);

        if (a2aAgents && a2aAgents.length > 0) {
          // 将 A2A Agents 转换为 Agent 格式并合并
          const convertedA2AAgents: Agent[] = a2aAgents.map((a: any, i: number) => {
            // 根据 protocolType 确定智能体类型
            let agentType: 'a2a' | 'ahive-coder' | 'ahive-worker' = 'a2a';
            if (a.protocolType === 'ahivecore') {
              // 从 customFields 或默认值获取具体类型
              agentType = a.customFields?.agentType || 'ahive-coder';
            }

            return {
              id: `a2a-${a.id}`,
              name: a.name || a.agentId,
              agentId: a.agentId || a.customFields?.agentId,  // 保留真实的智能体 ID
              description: a.card?.description || 'A2A Agent',
              status: 'idle' as const,
              avatar: '🤖',
              position: {
                x: Math.cos((initialAgents.length + i) * 2 * Math.PI / (initialAgents.length + a2aAgents.length)) * 5,
                y: 0,
                z: Math.sin((initialAgents.length + i) * 2 * Math.PI / (initialAgents.length + a2aAgents.length)) * 5
              },
              skills: a.card?.capabilities?.map((c: any) => c.name || c) || [],
              type: agentType,  // 使用正确的类型
              protocolType: a.protocolType,  // 保留协议类型，用于区分 AHIVECORE 和外部 Agent
              createdAt: a.createdAt || new Date().toISOString(),
              updatedAt: a.updatedAt || new Date().toISOString(),
            };
          });
          initialAgents = [...initialAgents, ...convertedA2AAgents];
        }
      }
    } catch (e) {
      console.log('Failed to load A2A agents:', e);
    }

    // ========== 添加 AHIVECORE 核心智能体 ==========
    // AHIVECORE 是系统核心，始终存在
    const ahiveCoreAgent: Agent = {
      id: 'ahivecore',
      name: 'AHIVECORE',
      description: 'AHIVE 系统核心智能体 - 指挥官',
      status: 'idle' as const,
      avatar: '🔷',
      position: { x: 0, y: 0, z: 0 },  // 中心位置
      skills: ['command', 'coordinate', 'orchestrate'],
      type: 'ahivecore' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 检查是否已存在 AHIVECORE（避免重复添加）
    const existingAHIVECore = initialAgents.find(a =>
      a.id === 'ahivecore' ||
      a.name.toLowerCase() === 'ahivecore' ||
      a.type === 'ahivecore'
    );

    if (!existingAHIVECore) {
      initialAgents = [ahiveCoreAgent, ...initialAgents];
      console.log('[App] Added AHIVECORE agent to agents list');
    } else {
      console.log('[App] AHIVECORE agent already exists:', existingAHIVECore.id);
    }

    setAgents(initialAgents);
  }, [setAgents, setSkills]);

  // 初始化应用
  useEffect(() => {
    const initApp = async () => {
      await loadAllAgents();
      await initializeDataFromStorage();

      // 启动时主动检测离线状态
      try {
        const anyWindow = window as any;
        if (anyWindow.electronAPI?.checkA2AHealth) {
          console.log('[HealthCheck] Checking agent health on startup...');
          await anyWindow.electronAPI.checkA2AHealth();
        }
      } catch (e) {
        console.log('[HealthCheck] Failed to check health on startup:', e);
      }

      setIsLoading(false);
    };

    initApp();
  }, [loadAllAgents]);

  // 监听 A2A Agents 变化事件
  useEffect(() => {
    const handleRefresh = () => {
      console.log('Refreshing agents...');
      loadAllAgents();
    };

    refreshAgentsEvent.listeners.push(handleRefresh);

    return () => {
      const index = refreshAgentsEvent.listeners.indexOf(handleRefresh);
      if (index > -1) {
        refreshAgentsEvent.listeners.splice(index, 1);
      }
    };
  }, [loadAllAgents]);

  // 监听 A2A 健康状态
  useEffect(() => {
    const anyWindow = window as any;
    if (!anyWindow.electronAPI?.onA2AHealthStatus) return;

    const handleHealthStatus = (data: { offlineAgents: string[]; totalAgents: number; timestamp: number }) => {
      console.log('[HealthCheck] Received status:', data);
      setOfflineAgents(data.offlineAgents);
    };

    anyWindow.electronAPI.onA2AHealthStatus(handleHealthStatus);

    return () => {
      anyWindow.electronAPI.removeA2AHealthStatusListener?.();
    };
  }, [setOfflineAgents]);

  // ========== WebSocket 全局订阅 ==========
  useEffect(() => {
    console.log('========== WebSocket 全局订阅 START ==========');

    // 连接 WebSocket
    wsManager.connect();
    console.log('[App] wsManager.connect() called');

    // 检查连接状态
    const isConnected = wsManager.isConnected();
    console.log('[App] WebSocket isConnected:', isConnected);
    setWsConnected(isConnected);

    // 订阅连接状态变化
    const unsubConnection = wsManager.subscribe('connection', (data) => {
      console.log('[App] Connection status changed:', data);
      setWsConnected(data.connected);
    });

    // 定时检查连接状态
    const connectionTimer = setInterval(() => {
      const connected = wsManager.isConnected();
      console.log('[App] WebSocket status:', connected ? 'connected' : 'disconnected');
      setWsConnected(connected);
    }, 10000);

    // 订阅思考事件
    const unsubThinking = wsManager.subscribe('thinking', (data) => {
      console.log('[App] thinking event:', data);
      addExecutionLog({
        type: 'thinking',
        agentId: data.agentId,
        agentName: data.agentName || data.agentId,
        content: data.thinking || data.content || '思考中...',
      });
    });

    // 订阅工具调用
    const unsubAction = wsManager.subscribe('action', (data) => {
      console.log('[App] action event:', data);
      // tool 可能是 'unknown'，实际类型可能在 params.type 里
      const toolName = data.tool !== 'unknown' ? data.tool : (data.params?.type || 'unknown');
      addExecutionLog({
        type: 'tool_call',
        agentId: data.agentId,
        agentName: data.agentName || data.agentId,
        content: `调用工具: ${toolName}`,
        details: data.params || data.input,
      });
    });

    // 订阅错误
    const unsubError = wsManager.subscribe('error', (data) => {
      console.log('[App] error event:', data);
      addExecutionLog({
        type: 'error',
        agentId: data.agentId,
        agentName: data.agentName || data.agentId,
        content: data.content || data.error || data.message || 'Unknown error',
      });
      setAgentTyping(data.agentId, false);
    });

    // 订阅文本片段 - 只累积消息，不添加日志（避免碎片化）
    const unsubTextDelta = wsManager.subscribe('text-delta', (data) => {
      console.log('[App] text-delta event:', data);
      // 确保 delta 是有效的字符串
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (delta && data.agentId) {
        updateStreamMessage(data.agentId, delta, data.agentName);
      }
    });

    // 订阅文本完成
    const unsubTextDone = wsManager.subscribe('text-done', (data) => {
      console.log('[App] text-done event:', data);
      // 获取累积的完整消息，添加到执行日志
      const streamingMessages = useStore.getState().streamingMessages;
      const streamMsg = streamingMessages[data.agentId];
      if (streamMsg && streamMsg.content) {
        addExecutionLog({
          type: 'message',
          agentId: data.agentId,
          agentName: data.agentName || streamMsg.agentName || data.agentId,
          content: streamMsg.content,
        });
      }
      clearStreamMessage(data.agentId);
      setAgentTyping(data.agentId, false);
    });

    // 订阅完成事件
    const unsubDone = wsManager.subscribe('done', (data) => {
      console.log('[App] done event:', data);
      // 获取累积的完整消息，添加到执行日志
      const streamingMessages = useStore.getState().streamingMessages;
      const streamMsg = streamingMessages[data.agentId];
      if (streamMsg && streamMsg.content) {
        addExecutionLog({
          type: 'message',
          agentId: data.agentId,
          agentName: data.agentName || streamMsg.agentName || data.agentId,
          content: streamMsg.content,
        });
      }
      clearStreamMessage(data.agentId);
      setAgentTyping(data.agentId, false);
    });

    // 订阅智能体间对话
    const unsubAgentChat = wsManager.subscribe('agent-chat', (data) => {
      console.log('[App] agent-chat:', data);

      // 添加到执行日志显示
      addExecutionLog({
        type: 'agent_chat',
        agentId: data.agentId,
        agentName: data.agentName || data.agentId,
        content: `→ ${data.toAgentName || data.toAgentId}: ${data.message}`,
      });

      // 同时存储到 agentChatMessages
      addAgentChatMessage({
        fromAgentId: data.agentId,
        fromAgentName: data.agentName,
        toAgentId: data.toAgentId,
        toAgentName: data.toAgentName,
        message: data.message,
      });
    });

    // 订阅内存监控
    const unsubMemory = wsManager.subscribe('memory', (data) => {
      console.log('[App] memory event:', data);
      updateMemoryData(data);
    });

    // 订阅工作流启动检测开始事件（来自指挥官启动工作流）
    const unsubStartupCheckStarted = wsManager.subscribe('workflow-startup-check-started', (data) => {
      console.log('[App] workflow-startup-check-started:', data);
      // 更新按钮状态为"检测中"
      const { workflowId, workflowName, status } = data;
      if (workflowId) {
        // 设置工作流状态为检测中（用于按钮显示）
        useStore.getState().setWorkflowExecutionStatus(workflowId, 'checking');
      }
    });

    // 订阅工作流启动检测结果事件（来自指挥官启动工作流）
    const unsubStartupCheckResult = wsManager.subscribe('workflow-startup-check-result', (data) => {
      console.log('[App] workflow-startup-check-result:', data);
      const { workflowId, workflowName, canProceed, steps, checkResult } = data;
      
      if (workflowId) {
        if (canProceed) {
          // 检测通过，更新按钮状态为"运行中"
          useStore.getState().setWorkflowExecutionStatus(workflowId, 'running');
          console.log(`[App] Workflow ${workflowId} startup checks passed, status set to running`);
        } else {
          // 检测未通过，更新按钮状态为"失败"，并显示错误信息
          useStore.getState().setWorkflowExecutionStatus(workflowId, 'failed');
          
          // 提取失败原因
          const failedSteps = steps?.filter((s: any) => s.status === 'failed') || [];
          const failedReasons = failedSteps.map((s: any) => `${s.name}: ${s.error || '检测失败'}`).join('\n');
          
          // 添加到执行日志
          addExecutionLog({
            type: 'error',
            agentId: 'workflow-scheduler',
            agentName: workflowName || workflowId,
            content: `启动检测未通过:\n${failedReasons}`,
            details: { steps, checkResult },
          });
          
          console.log(`[App] Workflow ${workflowId} startup checks failed: ${failedReasons}`);
        }
      }
    });

    // 订阅工作流事件
    const unsubWorkflowStarted = wsManager.subscribe('workflow-started', (data) => {
      console.log('[App] workflow-started:', data);
      handleWorkflowEvent({ type: 'workflow-started', ...data });
    });
    const unsubWorkflowCompleted = wsManager.subscribe('workflow-completed', (data) => {
      console.log('[App] workflow-completed:', data);
      handleWorkflowEvent({ type: 'workflow-completed', ...data });
    });
    const unsubWorkflowError = wsManager.subscribe('workflow-error', (data) => {
      console.log('[App] workflow-error:', data);
      
      // 添加到执行日志
      addExecutionLog({
        type: 'error',
        agentId: 'workflow-scheduler',
        agentName: data.workflowName || data.workflowId || 'Workflow',
        content: `工作流执行错误: ${data.error || 'Unknown error'}`,
      });
      
      handleWorkflowEvent({ type: 'workflow-error', ...data });
    });
    const unsubWorkflowNodeStart = wsManager.subscribe('workflow-node-start', (data) => {
      console.log('[App] workflow-node-start:', data);
      handleWorkflowEvent({ type: 'workflow-node-start', ...data });
    });

    // 订阅 CommanderChannel 实际广播的任务级别事件（3D 动画触发）
    const unsubWorkflowTaskStart = wsManager.subscribe('workflow_task_start', (data) => {
      console.log('[App] workflow_task_start:', data);
      handleWorkflowEvent({ type: 'workflow-node-start', ...data });
    });
    const unsubWorkflowTaskComplete = wsManager.subscribe('workflow_task_complete', (data) => {
      console.log('[App] workflow_task_complete:', data);
      handleWorkflowEvent({ type: 'workflow-node-complete', ...data });
    });
    const unsubWorkflowTaskError = wsManager.subscribe('workflow_task_error', (data) => {
      console.log('[App] workflow_task_error:', data);
      handleWorkflowEvent({ type: 'workflow-error', ...data });
    });

    // 订阅 workflow_report 事件（指挥官通过 workflow_report 工具上报的任务状态）
    const unsubWorkflowReport = wsManager.subscribe('workflow_report', (data) => {
      console.log('[App] workflow_report:', data);
      const { report_type, task_id, agent_id, node_id, ...rest } = data;
      
      switch (report_type) {
        case 'task_ack':
          // Agent 确认接受任务 → 开始工作动画
          console.log(`[App] Agent ${agent_id} acknowledged task ${task_id}, triggering start animation`);
          handleWorkflowEvent({
            type: 'workflow-node-start',
            nodeId: node_id || task_id,
            agentId: agent_id,
            taskId: task_id,
            ...rest,
          });
          break;
          
        case 'task_complete':
          // Agent 完成任务 → 完成动画
          console.log(`[App] Agent ${agent_id} completed task ${task_id}, triggering complete animation`);
          handleWorkflowEvent({
            type: 'workflow-node-complete',
            nodeId: node_id || task_id,
            agentId: agent_id,
            taskId: task_id,
            ...rest,
          });
          break;
          
        case 'task_error':
          // Agent 任务异常 → 错误处理
          console.log(`[App] Agent ${agent_id} error on task ${task_id}`);
          handleWorkflowEvent({
            type: 'workflow-node-error',
            nodeId: node_id || task_id,
            agentId: agent_id,
            taskId: task_id,
            ...rest,
          });
          break;
          
        case 'task_progress':
          // 任务进度更新（可选：未来可用于更新进度条或粒子效果）
          console.log(`[App] Agent ${agent_id} progress on task ${task_id}: ${rest.progress}%`);
          break;
          
        default:
          console.log(`[App] Unknown workflow_report type: ${report_type}`);
      }
    });

    const unsubWorkflowVariableSet = wsManager.subscribe('workflow-variable-set', (data) => {
      console.log('[App] workflow-variable-set:', data);
      handleWorkflowEvent({ type: 'workflow-variable-set', ...data });
    });

    // 订阅工作流创建事件（指挥官生成工作流后通知前端刷新）
    const unsubWorkflowCreated = wsManager.subscribe('workflow-created', async (data) => {
      console.log('[App] workflow-created:', data);
      // 重新加载工作流列表
      const workflows = await loadWorkflowsFromStorage();
      useStore.getState().setWorkflows(workflows);
      // 如果有新工作流的 ID，自动选中它
      if (data.workflowId) {
        useStore.getState().setCurrentWorkflow(data.workflowId);
      }
    });

    // 订阅智能体动画状态变化事件
    const unsubAnimationState = wsManager.subscribe('animation-state-change', (data) => {
      console.log('[App] animation-state-change:', data);
      const { agentId, currentState, previousState, action, expression } = data;
      if (agentId && currentState) {
        console.log(`[App] Updating animation state for ${agentId}: ${previousState} -> ${currentState}`);
        useStore.getState().updateAgentAnimationState(agentId, {
          state: currentState,
          action: action,
          expression: expression,
        });
        // 打印当前所有动画状态
        console.log('[App] Current animation states:', useStore.getState().agentAnimationStates);
      }
    });

    // 订阅智能体动画动作事件
    const unsubAnimationAction = wsManager.subscribe('animation-action', (data) => {
      console.log('[App] animation-action:', data);
      const { agentId, action } = data;
      if (agentId && action) {
        // 只更新动作，保持当前状态
        const currentState = useStore.getState().agentAnimationStates[agentId];
        if (currentState) {
          useStore.getState().updateAgentAnimationState(agentId, {
            state: currentState.state,
            action: action,
          });
        }
      }
    });

    console.log('[App] All WebSocket subscriptions registered');

    return () => {
      console.log('[App] Cleaning up WebSocket subscriptions');
      clearInterval(connectionTimer);
      unsubConnection();
      unsubTextDelta();
      unsubTextDone();
      unsubThinking();
      unsubAction();
      unsubError();
      unsubDone();
      unsubAgentChat();
      unsubMemory();
      unsubWorkflowStarted();
      unsubWorkflowCompleted();
      unsubWorkflowError();
      unsubWorkflowNodeStart();
      unsubWorkflowTaskStart();
      unsubWorkflowTaskComplete();
      unsubWorkflowTaskError();
      unsubWorkflowVariableSet();
      unsubWorkflowCreated();
      unsubAnimationState();
      unsubAnimationAction();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // WPF WebView2 消息处理
  useEffect(() => {
    // @ts-ignore - WPF WebView2消息
    const wpf = window.chrome?.webview;
    if (!wpf) return;

    const handler = (event: any) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        console.log('[WPF消息]', data);

        switch (data.type) {
          case 'task_complete':
            const completedTask: Task = {
              id: `task-${Date.now()}`,
              agentId: '1',
              task: data.task,
              status: 'completed',
              output: (data.output || '').split('\n'),
              createdAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            };
            addTask(completedTask);
            break;
          case 'task_error':
            const failedTask: Task = {
              id: `task-${Date.now()}`,
              agentId: '1',
              task: data.task,
              status: 'failed',
              output: [data.error || '执行失败'],
              createdAt: new Date().toISOString(),
            };
            addTask(failedTask);
            break;
        }
      } catch (e) {
        console.error('[WPF消息解析失败]', e);
      }
    };

    // @ts-ignore
    window.chrome?.webview?.addEventListener('message', handler);

    return () => {
      // @ts-ignore
      window.chrome?.webview?.removeEventListener('message', handler);
    };
  }, [addTask]);


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-hive-bg">
        <div className="text-hive-text text-xl">{tr.loading}</div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <DialogProvider language={language}>
        <div className="flex h-screen bg-hive-bg overflow-hidden">
          <Sidebar onNewAgent={() => setIsCreateDialogOpen(true)} />
          <div className="flex-1 flex flex-col">
            <Header currentScene={currentScene} onSceneChange={setCurrentScene} />
            <main className="flex-1 flex overflow-hidden">
              {/* 3D World / Workflow - 统一入口 */}
              <div className={`flex-1 ${(activeTab !== 'world' && activeTab !== 'workflow') ? 'hidden' : ''}`}>
                <AgentWorld currentScene={currentScene} />
              </div>

              {/* MCP Tools - 能力中心 */}
              <div className={`flex-1 ${activeTab !== 'skills' ? 'hidden' : ''}`}>
                <MCPToolPanel />
              </div>
              {/* Task Panel */}
              <div className={`flex-1 ${activeTab !== 'tasks' ? 'hidden' : ''}`}>
                <TaskPanel />
              </div>

              {/* Log Center */}
              <div className={`flex-1 ${activeTab !== 'logs' ? 'hidden' : ''}`}>
                <LogCenterPanel />
              </div>
            </main>
          </div>

          {/* 新建智能体对话框 */}
          <CreateAgentDialog isOpen={isCreateDialogOpen} onClose={() => setIsCreateDialogOpen(false)} />

          {/* 全局浮动 AHIVECORE 智能体 - 类似 QQ/微信聊天窗口 */}
          <FloatingAHIVECore />

          {/* 工作流实例详情对话框 - 全局渲染，确保在最顶层 */}
          <GlobalWorkflowInstanceDetailDialog />
        </div>
      </DialogProvider>
    </ErrorBoundary>
  );
}

// 全局工作流实例详情对话框组件
function GlobalWorkflowInstanceDetailDialog() {
  const {
    showInstanceDetailDialog,
    setShowInstanceDetailDialog,
    instanceDetailDialogInstanceId,
    instanceDetailDialogWorkflowId,
  } = useStore();
  
  return (
    <WorkflowInstanceDetailDialog
      open={showInstanceDetailDialog}
      onClose={() => setShowInstanceDetailDialog(false)}
      initialInstanceId={instanceDetailDialogInstanceId || undefined}
      initialWorkflowId={instanceDetailDialogWorkflowId || undefined}
    />
  );
}

export default App;
