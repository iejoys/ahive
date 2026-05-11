import { contextBridge, ipcRenderer } from 'electron';

/**
 * 覆写原生 alert/confirm 以解决 Electron 焦点丢失问题
 * 问题：https://github.com/electron/electron/issues/19977
 */
function overrideDialogs() {
  // 保存原始函数
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;

  // 覆写 alert
  window.alert = (message?: any): void => {
    originalAlert(message);
    
    // 焦点恢复：延迟执行确保对话框已完全关闭
    setTimeout(() => {
      // 1. 聚焦窗口
      window.focus();
      
      // 2. 尝试恢复到之前的焦点元素
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && typeof activeEl.focus === 'function') {
        activeEl.blur();
        activeEl.focus();
      }
      
      // 3. 如果没有活动元素，尝试聚焦第一个可聚焦元素
      if (!activeEl || activeEl === document.body) {
        const firstInput = document.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])') as HTMLElement;
        firstInput?.focus();
      }
    }, 50);
  };

  // 覆写 confirm
  window.confirm = (message?: any): boolean => {
    const result = originalConfirm(message);
    
    // 焦点恢复
    setTimeout(() => {
      window.focus();
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && typeof activeEl.focus === 'function') {
        activeEl.blur();
        activeEl.focus();
      }
      if (!activeEl || activeEl === document.body) {
        const firstInput = document.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])') as HTMLElement;
        firstInput?.focus();
      }
    }, 50);
    
    return result;
  };
}

// 执行覆写
overrideDialogs();

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取应用配置
  getConfig: () => ipcRenderer.invoke('get-config'),

  // 打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // 获取应用版本
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 运行本地命令
  runCommand: (command: string) => ipcRenderer.invoke('run-command', command),

  // 获取OpenClaw智能体
  getAgents: () => ipcRenderer.invoke('get-agents'),

  // 向智能体发送消息
  sendMessageToAgent: (agentName: string, message: string) =>
    ipcRenderer.invoke('send-message-to-agent', agentName, message),

  // 网关管理
  getGatewayStatus: () => ipcRenderer.invoke('get-gateway-status'),
  startGateway: () => ipcRenderer.invoke('start-gateway'),
  stopGateway: () => ipcRenderer.invoke('stop-gateway'),

  // 监听网关状态变化
  onGatewayStatus: (callback: (data: { status: string; error?: string }) => void) => {
    ipcRenderer.on('gateway-status', (_event, data) => callback(data));
  },

  // 平台信息
  platform: process.platform,

  // 是否是桌面环境
  isDesktop: true,

  // ========== 数据存储 API ==========
  // 获取数据目录
  getDataDirectory: () => ipcRenderer.invoke('get-data-directory'),

  // 获取所有数据
  getAppData: () => ipcRenderer.invoke('get-app-data'),

  // 保存所有数据
  saveAppData: (data: unknown) => ipcRenderer.invoke('save-app-data', data),
  // 定时任务
  getScheduledTasks: () => ipcRenderer.invoke('get-scheduled-tasks'),
  saveScheduledTask: (task: unknown) => ipcRenderer.invoke('save-scheduled-task', task),
  toggleScheduledTask: (taskId: string, enabled: boolean) =>
    ipcRenderer.invoke('toggle-scheduled-task', taskId, enabled),

  // 执行记录
  addTaskRun: (run: unknown) => ipcRenderer.invoke('add-task-run', run),
  getAllTaskRuns: () => ipcRenderer.invoke('get-all-task-runs'),

  // ========== 工作流 API ==========
  // 获取所有工作流
  getWorkflows: () => ipcRenderer.invoke('get-workflows'),

  // 获取单个工作流
  getWorkflow: (workflowId: string) => ipcRenderer.invoke('get-workflow', workflowId),

  // 保存工作流
  saveWorkflow: (workflow: unknown) => ipcRenderer.invoke('save-workflow', workflow),
  // 删除工作流
  deleteWorkflow: (workflowId: string) => ipcRenderer.invoke('delete-workflow', workflowId),
  
  // 检查工作流名称是否存在
  workflowNameExists: (name: string, excludeId?: string) => 
    ipcRenderer.invoke('workflow-name-exists', name, excludeId),
  
  // 导入工作流
  importWorkflow: (content: string, customName?: string) => 
    ipcRenderer.invoke('import-workflow', content, customName),
  
  // 获取工作流文件列表
  listWorkflowFiles: () => ipcRenderer.invoke('list-workflow-files'),
  
  // 重命名工作流
  renameWorkflow: (oldName: string, newName: string) => 
    ipcRenderer.invoke('rename-workflow', oldName, newName),

  // ========== 工作流模板 API ==========
  // 获取所有工作流模板
  getWorkflowTemplates: () => ipcRenderer.invoke('get-workflow-templates'),

  // 获取单个工作流模板
  getWorkflowTemplate: (templateId: string) => ipcRenderer.invoke('get-workflow-template', templateId),

  // 保存工作流模板
  saveWorkflowTemplate: (template: unknown) => ipcRenderer.invoke('save-workflow-template', template),

  // 删除工作流模板
  deleteWorkflowTemplate: (templateId: string) => ipcRenderer.invoke('delete-workflow-template', templateId),

  // ========== 项目配置模板 API ==========
  // 获取所有项目配置模板
  getProjectConfigTemplates: (language?: 'zh' | 'en') => 
    ipcRenderer.invoke('get-project-config-templates', language),

  // 获取单个项目配置模板
  getProjectConfigTemplate: (templateId: string, language?: 'zh' | 'en') =>
    ipcRenderer.invoke('get-project-config-template', templateId, language),

  // 重新加载项目配置模板
  reloadProjectConfigTemplates: () => ipcRenderer.invoke('reload-project-config-templates'),

  // ========== 黑板 API（V2 - 支持全局/工作流分离） ==========
  // 获取黑板状态（兼容旧 API）
  getBlackboardState: (scope?: string) => ipcRenderer.invoke('get-blackboard-state', scope),

  // 保存黑板状态（兼容旧 API）
  saveBlackboardState: (state: unknown) => ipcRenderer.invoke('save-blackboard-state', state),
  // 更新黑板变量
  updateBlackboardVariable: (entry: unknown) =>
    ipcRenderer.invoke('update-blackboard-variable', entry),
  // 删除黑板变量
  deleteBlackboardVariable: (key: string) =>
    ipcRenderer.invoke('delete-blackboard-variable', key),

  // 添加黑板事件
  addBlackboardEvent: (event: unknown) => ipcRenderer.invoke('add-blackboard-event', event),
  
  // ========== 黑板 API（V2 - 全局变量） ==========
  // 获取全局变量
  getGlobalVariables: () => ipcRenderer.invoke('get-global-variables'),
  
  // 保存全局变量
  saveGlobalVariables: (variables: unknown[]) => ipcRenderer.invoke('save-global-variables', variables),
  
  // 更新全局变量
  updateGlobalVariable: (entry: unknown) => ipcRenderer.invoke('update-global-variable', entry),
  
  // 删除全局变量
  deleteGlobalVariable: (key: string) => ipcRenderer.invoke('delete-global-variable', key),
  
  // ========== 黑板 API（V2 - 工作流变量） ==========
  // 获取工作流变量
  getWorkflowVariables: (workflowId: string) => ipcRenderer.invoke('get-workflow-variables', workflowId),
  
  // 保存工作流变量
  saveWorkflowVariables: (workflowId: string, variables: unknown[]) => 
    ipcRenderer.invoke('save-workflow-variables', workflowId, variables),
  
  // 更新工作流变量
  updateWorkflowVariable: (workflowId: string, entry: unknown) => 
    ipcRenderer.invoke('update-workflow-variable', workflowId, entry),
  
  // 删除工作流变量
  deleteWorkflowVariable: (workflowId: string, key: string) => 
    ipcRenderer.invoke('delete-workflow-variable', workflowId, key),
  
  // 清空工作流变量
  clearWorkflowVariables: (workflowId: string) => 
    ipcRenderer.invoke('clear-workflow-variables', workflowId),
  
  // 删除工作流数据目录
  deleteWorkflowDataDir: (workflowId: string) => 
    ipcRenderer.invoke('delete-workflow-data-dir', workflowId),
  
  // 获取所有工作流变量
  getAllWorkflowVariables: () => ipcRenderer.invoke('get-all-workflow-variables'),
  
  // ========== 部门 API ==========
  // 获取所有部门
  getDepartments: () => ipcRenderer.invoke('get-departments'),
  
  // 获取单个部门
  getDepartment: (departmentId: string) => ipcRenderer.invoke('get-department', departmentId),
  
  // 保存部门
  saveDepartment: (department: unknown) => ipcRenderer.invoke('save-department', department),
  
  // 批量保存部门
  saveDepartments: (departments: unknown[]) => ipcRenderer.invoke('save-departments', departments),
  
  // 删除部门
  deleteDepartment: (departmentId: string) => ipcRenderer.invoke('delete-department', departmentId),
  
  // 添加部门成员
  addDepartmentMember: (departmentId: string, member: unknown) =>
    ipcRenderer.invoke('add-department-member', departmentId, member),
  
  // 移除部门成员
  removeDepartmentMember: (departmentId: string, agentId: string) =>
    ipcRenderer.invoke('remove-department-member', departmentId, agentId),
  
  // ========== 中断记录 API ==========
  // 获取所有中断记录
  getInterruptions: () => ipcRenderer.invoke('get-interruptions'),
  
  // 获取未恢复的中断记录
  getUnrecoveredInterruptions: () => ipcRenderer.invoke('get-unrecovered-interruptions'),
  
  // 保存中断记录
  saveInterruption: (interruption: unknown) => ipcRenderer.invoke('save-interruption', interruption),
  
  // 标记中断已恢复
  markInterruptionRecovered: (id: string) => ipcRenderer.invoke('mark-interruption-recovered', id),
  
  // 删除中断记录
  deleteInterruption: (id: string) => ipcRenderer.invoke('delete-interruption', id),
  
  // 清理旧中断记录
  cleanupOldInterruptions: (daysToKeep?: number) => ipcRenderer.invoke('cleanup-old-interruptions', daysToKeep),
  
  // ========== 邮件服务 API ==========
  // 发送邮件
  sendEmail: (params: { to: string[]; subject: string; message: string }) =>
    ipcRenderer.invoke('send-email', params),
  
  // ========== 执行状态 API ==========
  // 获取执行状态
  getExecutionState: (instanceId: string) =>
    ipcRenderer.invoke('get-execution-state', instanceId),

  // 获取所有执行状态
  getAllExecutionStates: () => ipcRenderer.invoke('get-all-execution-states'),

  saveExecutionState: (state: unknown) => ipcRenderer.invoke('save-execution-state', state),

  // 删除执行状态
  deleteExecutionState: (instanceId: string) =>
    ipcRenderer.invoke('delete-execution-state', instanceId),

  // 清理过期执行状态
  cleanupExecutionStates: () => ipcRenderer.invoke('cleanup-execution-states'),

  // ========== 工作流执行日志 API ==========
  // 保存工作流执行日志
  saveWorkflowExecutionLog: (log: unknown) =>
    ipcRenderer.invoke('save-workflow-execution-log', log),

  // 获取工作流执行日志
  getWorkflowExecutionLog: (logId: string) =>
    ipcRenderer.invoke('get-workflow-execution-log', logId),

  // 获取工作流执行日志列表
  getWorkflowExecutionLogs: (options?: { workflowId?: string; status?: string; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('get-workflow-execution-logs', options),

  // 删除工作流执行日志
  deleteWorkflowExecutionLog: (logId: string) =>
    ipcRenderer.invoke('delete-workflow-execution-log', logId),

  // 清理过期日志
  cleanupWorkflowExecutionLogs: (retentionDays?: number) =>
    ipcRenderer.invoke('cleanup-workflow-execution-logs', retentionDays),

  // 获取日志统计
  getWorkflowLogStats: () => ipcRenderer.invoke('get-workflow-log-stats'),

  // 重建日志索引
  rebuildWorkflowLogIndex: () => ipcRenderer.invoke('rebuild-workflow-log-index'),

  // ========== 工作流执行控制 API ==========
  // 执行工作流启动检测
  workflowStartupCheck: (workflowId: string) =>
    ipcRenderer.invoke('workflow:startup-check', workflowId),

  // 执行工作流
  executeWorkflow: (workflowId: string, variables?: Record<string, unknown>) =>
    ipcRenderer.invoke('workflow:execute', workflowId, variables),

  // 暂停工作流
  pauseWorkflow: (instanceId: string) =>
    ipcRenderer.invoke('workflow:pause', instanceId),

  // 恢复工作流
  resumeWorkflow: (instanceId: string) =>
    ipcRenderer.invoke('workflow:resume', instanceId),

  // 停止工作流
  stopWorkflow: (instanceId: string) =>
    ipcRenderer.invoke('workflow:stop', instanceId),

  // 强制关闭工作流（用于非正常退出的实例）
  forceStopWorkflow: (instanceId: string, reason?: string) =>
    ipcRenderer.invoke('workflow:force-stop', instanceId, reason),

  // 获取工作流执行状态
  getWorkflowState: (instanceId: string) =>
    ipcRenderer.invoke('workflow:get-state', instanceId),

  // 获取工作流黑板变量
  getWorkflowVariables: (instanceId: string) =>
    ipcRenderer.invoke('workflow:get-variables', instanceId),

  // 获取所有活跃的工作流实例
  listWorkflowInstances: () =>
    ipcRenderer.invoke('workflow:list-instances'),

  // 获取未完成的工作流实例（从数据库）
  getIncompleteWorkflowInstances: () =>
    ipcRenderer.invoke('workflow:get-incomplete-instances'),

  // 获取所有工作流实例
  getAllWorkflowInstances: () =>
    ipcRenderer.invoke('workflow:get-all-instances'),

  // 删除单个工作流实例
  deleteWorkflowInstance: (instanceId: string) =>
    ipcRenderer.invoke('workflow:delete-instance', instanceId),

  // 删除工作流的所有实例
  deleteAllWorkflowInstances: (workflowId: string) =>
    ipcRenderer.invoke('workflow:delete-all-instances', workflowId),

  // 获取工作流实例详情（包括节点状态）
  getWorkflowInstanceDetails: (instanceId: string) =>
    ipcRenderer.invoke('workflow:get-instance-details', instanceId),

  // 提交审核结果
  submitWorkflowReview: (instanceId: string, nodeId: string, result: { score?: number; stars?: number; feedback?: string; approved: boolean }) =>
    ipcRenderer.invoke('workflow:submit-review', instanceId, nodeId, result),

  // 获取实例的产出物
  getWorkflowOutputs: (instanceId: string) =>
    ipcRenderer.invoke('workflow:get-outputs', instanceId),

  // 获取节点的产出物
  getWorkflowNodeOutputs: (instanceId: string, nodeId: string) =>
    ipcRenderer.invoke('workflow:get-node-outputs', instanceId, nodeId),

  // 获取产出物统计
  getWorkflowOutputStats: (instanceId: string) =>
    ipcRenderer.invoke('workflow:get-output-stats', instanceId),

  // 获取工作流的所有实例
  getWorkflowInstancesByWorkflowId: (workflowId: string) =>
    ipcRenderer.invoke('workflow:get-instances-by-workflow', workflowId),

  // ========== 系统日志管理 API ==========
  // 获取系统日志文件列表
  getSystemLogFiles: () => ipcRenderer.invoke('get-system-log-files'),

  // 读取系统日志内容
  readSystemLog: (filename: string, options?: { lines?: number; level?: string; search?: string }) =>
    ipcRenderer.invoke('read-system-log', filename, options),

  // 删除单个系统日志
  deleteSystemLog: (filename: string) =>
    ipcRenderer.invoke('delete-system-log', filename),

  // 批量删除系统日志
  deleteSystemLogs: (filenames: string[]) =>
    ipcRenderer.invoke('delete-system-logs', filenames),

  // 获取系统日志统计
  getSystemLogStats: () => ipcRenderer.invoke('get-system-log-stats'),

  // 清理旧日志
  cleanupSystemLogs: (retentionDays: number) =>
    ipcRenderer.invoke('cleanup-system-logs', retentionDays),

  // ========== MCP/A2A 协议 API ==========
  // 获取协议配置
  getProtocolConfig: () => ipcRenderer.invoke('get-protocol-config'),

  // MCP Server
  getMCPServers: () => ipcRenderer.invoke('get-mcp-servers'),
  getMCPServer: (id: string) => ipcRenderer.invoke('get-mcp-server', id),
  saveMCPServer: (server: unknown) => ipcRenderer.invoke('save-mcp-server', server),
  deleteMCPServer: (id: string) => ipcRenderer.invoke('delete-mcp-server', id),
  toggleMCPServer: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('toggle-mcp-server', id, enabled),
  getMCPServerList: () => ipcRenderer.invoke('get-mcp-server-list'),

  // A2A Agent
  getA2AAgents: () => ipcRenderer.invoke('get-a2a-agents'),
  getA2AAgent: (id: string) => ipcRenderer.invoke('get-a2a-agent', id),
  saveA2AAgent: (agent: unknown) => ipcRenderer.invoke('save-a2a-agent', agent),
  deleteA2AAgent: (id: string) => ipcRenderer.invoke('delete-a2a-agent', id),
  toggleA2AAgent: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('toggle-a2a-agent', id, enabled),
  refreshA2AAgentCard: (agentId: string) => ipcRenderer.invoke('refresh-a2a-agent-card', agentId),
  getA2AAgentList: () => ipcRenderer.invoke('get-a2a-agent-list'),
  discoverA2AAgentCard: (endpoint: string, protocolType?: string, allowLocalNetwork?: boolean) =>
    ipcRenderer.invoke('discover-a2a-agent-card', endpoint, protocolType, allowLocalNetwork),

  // MCP API 配置
  getMCPApiConfigs: () => ipcRenderer.invoke('get-mcp-api-configs'),
  getMCPApiConfig: (id: string) => ipcRenderer.invoke('get-mcp-api-config', id),
  saveMCPApiConfig: (config: unknown) => ipcRenderer.invoke('save-mcp-api-config', config),
  deleteMCPApiConfig: (id: string) => ipcRenderer.invoke('delete-mcp-api-config', id),
  toggleMCPApiConfig: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('toggle-mcp-api-config', id, enabled),
  getMCPApiPlatforms: () => ipcRenderer.invoke('get-mcp-api-platforms'),
  getMCPApiPlatformInputFields: (platformId: string) =>
    ipcRenderer.invoke('get-mcp-api-platform-input-fields', platformId),
  getMCPApiTools: (configId: string) =>
    ipcRenderer.invoke('get-mcp-api-tools', configId),
  // ========== MCP 协议执行 API ==========
  startMCPServer: (serverId: string) => ipcRenderer.invoke('start-mcp-server', serverId),
  stopMCPServer: (serverId: string) => ipcRenderer.invoke('stop-mcp-server', serverId),
  getMCPServerTools: (serverId: string) => ipcRenderer.invoke('get-mcp-server-tools', serverId),
  callMCPTool: (serverId: string, toolName: string, args: unknown) =>
    ipcRenderer.invoke('call-mcp-tool', serverId, toolName, args),

  // MCP 状态变化事件监听
  onMCPStatusChanged: (callback: () => void) => {
    ipcRenderer.on('mcp-status-changed', () => callback());
  },
  removeMCPStatusChangedListener: () => {
    ipcRenderer.removeAllListeners('mcp-status-changed');
  },

  // ========== MCP 能力绑定 API ==========
  bindAgentCapabilities: (agentId: string, capabilities: { server: string; tools: string[] }[]) =>
    ipcRenderer.invoke('bind-agent-capabilities', agentId, capabilities),
  unbindAgentCapabilities: (agentId: string, capabilities: { server: string; tools: string[] }[]) =>
    ipcRenderer.invoke('unbind-agent-capabilities', agentId, capabilities),
  getAgentCapabilities: (agentId: string) =>
    ipcRenderer.invoke('get-agent-capabilities', agentId),
  listAgentCapabilities: () =>
    ipcRenderer.invoke('list-agent-capabilities'),
  checkAgentPermission: (agentId: string, server: string, tool: string) =>
    ipcRenderer.invoke('check-agent-permission', agentId, server, tool),
  getMcpHttpEndpoint: () =>
    ipcRenderer.invoke('get-mcp-http-endpoint'),

  saveNpmRegistry: (registry: 'auto' | 'china' | 'official') =>
    ipcRenderer.invoke('save-npm-registry', registry),
  getNpmRegistry: () => ipcRenderer.invoke('get-npm-registry'),

  // ========== A2A 协议执行 API ==========
  sendA2ATaskSync: (agentId: string, task: string, timeout?: number) =>
    ipcRenderer.invoke('send-a2a-task-sync', agentId, task, timeout),
  sendA2ATaskAsync: (agentId: string, task: string, webhookUrl?: string) =>
    ipcRenderer.invoke('send-a2a-task-async', agentId, task, webhookUrl),
  getA2ATaskStatus: (agentId: string, taskId: string) =>
    ipcRenderer.invoke('get-a2a-task-status', agentId, taskId),
  cancelA2ATask: (agentId: string, taskId: string) =>
    ipcRenderer.invoke('cancel-a2a-task', agentId, taskId),
  
  // ========== AHIVECORE 流式对话 API ==========
  startAHIVECOREStream: (agentId: string, message: string, sessionId?: string) =>
    ipcRenderer.invoke('ahivecore-start-stream', agentId, message, sessionId),
  stopAHIVECOREStream: (agentId: string) =>
    ipcRenderer.invoke('ahivecore-stop-stream', agentId),
  interruptAHIVECORE: (agentId: string) =>
    ipcRenderer.invoke('ahivecore-interrupt', agentId),
  sendUserInput: (agentId: string, input: string) =>
    ipcRenderer.invoke('ahivecore-send-input', agentId, input),

  // ========== AHIVECORE 智能体管理 API ==========
  createAHIVECOREAgent: (type: 'ahive-coder' | 'ahive-worker', config: {
    nickname?: string;
    model?: {
      provider?: string;
      name?: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      baseUrl?: string;
    };
  }) => ipcRenderer.invoke('ahivecore-create-agent', type, config),
  updateAHIVECOREAgent: (agentId: string, config: {
    nickname?: string;
    model?: {
      provider?: string;
      name?: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      baseUrl?: string;
    };
  }) => ipcRenderer.invoke('ahivecore-update-agent', agentId, config),
  deleteAHIVECOREAgent: (agentId: string) =>
    ipcRenderer.invoke('ahivecore-delete-agent', agentId),
  getAHIVECOREAgent: (agentId: string) =>
    ipcRenderer.invoke('ahivecore-get-agent', agentId),
  listAHIVECOREAgents: () =>
    ipcRenderer.invoke('ahivecore-list-agents'),

  // ========== A2A 健康检查 API ==========
  checkA2AHealth: () => ipcRenderer.invoke('check-a2a-health'),
  startHealthCheck: () => ipcRenderer.invoke('start-health-check'),
  stopHealthCheck: () => ipcRenderer.invoke('stop-health-check'),
  onA2AHealthStatus: (callback: (data: { 
    offlineAgents: string[]; 
    totalAgents: number; 
    timestamp: number 
  }) => void) => {
    ipcRenderer.on('a2a-health-status', (_event, data) => callback(data));
  },
  removeA2AHealthStatusListener: () => {
    ipcRenderer.removeAllListeners('a2a-health-status');
  },

  // ========== Agent 技能持久化 API ==========

  getPersistedAgents: () => ipcRenderer.invoke('get-persisted-agents'),
  getPersistedAgent: (id: string) => ipcRenderer.invoke('get-persisted-agent', id),
  saveAgent: (agent: unknown) => ipcRenderer.invoke('save-agent', agent),
  updateAgentSkills: (id: string, skills: string[]) =>
    ipcRenderer.invoke('update-agent-skills', id, skills),
  deleteAgent: (id: string) => ipcRenderer.invoke('delete-agent', id),
  saveAgents: (agents: unknown[]) => ipcRenderer.invoke('save-agents', agents),

  // ========== 语音 API ==========
  // TTS (文字转语音) - 调用 OpenClaw
  invokeTTS: (text: string) => ipcRenderer.invoke('invoke-tts', text),
  // 获取可用声音列表 (Web Speech API)
  getVoices: () => ipcRenderer.invoke('get-voices'),

  // ========== 系统状态检测 API ==========
  // 检测 OpenClaw 安装状态
  checkOpenclawInstalled: () => ipcRenderer.invoke('check-openclaw-installed'),
  // 检测 OpenCode 安装状态
  checkOpencodeInstalled: () => ipcRenderer.invoke('check-opencode-installed'),
  // 获取系统服务状态汇总
  getSystemServicesStatus: () => ipcRenderer.invoke('get-system-services-status'),
  // 获取 A2A 通讯接口 URL
  getA2AEndpoint: () => ipcRenderer.invoke('get-a2a-endpoint'),
  // OpenCode serve 管理
  startOpencodeServe: (port?: number) => ipcRenderer.invoke('start-opencode-serve', port),
  stopOpencodeServe: () => ipcRenderer.invoke('stop-opencode-serve'),
  getOpencodeServeStatus: () => ipcRenderer.invoke('get-opencode-serve-status'),

  // ========== LLM Center API ==========
  // LLM 聊天
  llmChat: (messages: any[], options?: any) =>
    ipcRenderer.invoke('llm-chat', messages, options),
  llmChatWithMemory: (query: string, options?: any) =>
    ipcRenderer.invoke('llm-chat-with-memory', query, options),
  
  // LLM 统计
  llmGetStats: (options?: { agentId?: string }) =>
    ipcRenderer.invoke('llm-get-stats', options),
  llmResetStats: () => ipcRenderer.invoke('llm-reset-stats'),
  
  // LLM Provider 管理
  llmListProviders: () => ipcRenderer.invoke('llm-list-providers'),
  llmGetConfig: () => ipcRenderer.invoke('llm-get-config'),
  llmSetProviderConfig: (config: any) =>
    ipcRenderer.invoke('llm-set-provider-config', config),
  llmRemoveProviderConfig: (name: string) =>
    ipcRenderer.invoke('llm-remove-provider-config', name),
  llmSetDefaultProvider: (name: string) =>
    ipcRenderer.invoke('llm-set-default-provider', name),
  
  // 智能体 LLM 配置
  llmSetAgentConfig: (agentId: string, config: any) =>
    ipcRenderer.invoke('llm-set-agent-config', agentId, config),
  llmGetAgentConfig: (agentId: string) =>
    ipcRenderer.invoke('llm-get-agent-config', agentId),

  // ========== LLM Gateway API ==========
  llmGatewayGetAddress: () => ipcRenderer.invoke('llm-gateway-get-address'),
  llmGatewayListAppKeys: () => ipcRenderer.invoke('llm-gateway-list-appkeys'),
  llmGatewayGenerateAppKey: (agentId: string, agentName?: string) =>
    ipcRenderer.invoke('llm-gateway-generate-appkey', agentId, agentName),
  llmGatewayDeleteAppKey: (key: string) =>
    ipcRenderer.invoke('llm-gateway-delete-appkey', key),
  llmGatewayToggleAppKey: (key: string, enabled: boolean) =>
    ipcRenderer.invoke('llm-gateway-toggle-appkey', key, enabled),
});

// 添加类型声明
declare global {
  interface Window {
    electronAPI: {
      getConfig: () => Promise<{ webUrl: string; iframeUrl: string; apiUrl: string }>;
      openExternal: (url: string) => Promise<void>;
      getAppVersion: () => Promise<string>;
      runCommand: (command: string) => Promise<string>;
      getAgents: () => Promise<any[]>;
      sendMessageToAgent: (agentName: string, message: string) => Promise<{
        success: boolean;
        stdout: string;
        stderr: string;
        error?: string;
        data?: unknown;
      }>;
      getGatewayStatus: () => Promise<{ status: string; error?: string }>;
      startGateway: () => Promise<{ success: boolean; error?: string }>;
      stopGateway: () => Promise<{ success: boolean; error?: string }>;
      onGatewayStatus: (callback: (data: { status: string; error?: string }) => void) => void;
      platform: string;
      isDesktop: boolean;

      // 数据存储 API
      getDataDirectory: () => Promise<string>;
      getAppData: () => Promise<any>;
      saveAppData: (data: unknown) => Promise<boolean>;
      getScheduledTasks: () => Promise<unknown[]>;
      saveScheduledTask: (task: unknown) => Promise<boolean>;
      deleteScheduledTask: (taskId: string) => Promise<boolean>;
      toggleScheduledTask: (taskId: string, enabled: boolean) => Promise<boolean>;
      addTaskRun: (run: unknown) => Promise<boolean>;
      getTaskRuns: (taskId: string) => Promise<unknown[]>;
      getAllTaskRuns: () => Promise<Record<string, unknown[]>>;

      // 工作流 API
      getWorkflows: () => Promise<unknown[]>;
      getWorkflow: (workflowId: string) => Promise<unknown | undefined>;
      saveWorkflow: (workflow: unknown) => Promise<boolean>;
      deleteWorkflow: (workflowId: string) => Promise<boolean>;
      workflowNameExists: (name: string, excludeId?: string) => Promise<boolean>;
      importWorkflow: (content: string, customName?: string) => Promise<{
        success: boolean;
        workflow?: unknown;
        error?: string;
      }>;
      listWorkflowFiles: () => Promise<string[]>;
      renameWorkflow: (oldName: string, newName: string) => Promise<boolean>;

      // 工作流模板 API
      getWorkflowTemplates: () => Promise<any[]>;
      getWorkflowTemplate: (templateId: string) => Promise<any | undefined>;
      saveWorkflowTemplate: (template: unknown) => Promise<boolean>;
      deleteWorkflowTemplate: (templateId: string) => Promise<boolean>;

      // 黑板 API
      getBlackboardState: () => Promise<unknown>;
      saveBlackboardState: (state: unknown) => Promise<boolean>;
      updateBlackboardVariable: (entry: unknown) => Promise<boolean>;
      deleteBlackboardVariable: (key: string) => Promise<boolean>;
      addBlackboardEvent: (event: unknown) => Promise<boolean>;

      // 部门 API
      getDepartments: () => Promise<unknown[]>;
      getDepartment: (departmentId: string) => Promise<unknown | undefined>;
      saveDepartment: (department: unknown) => Promise<boolean>;
      saveDepartments: (departments: unknown[]) => Promise<boolean>;
      deleteDepartment: (departmentId: string) => Promise<boolean>;
      addDepartmentMember: (departmentId: string, member: unknown) => Promise<boolean>;
      removeDepartmentMember: (departmentId: string, agentId: string) => Promise<boolean>;
      
      // 中断记录 API
      getInterruptions: () => Promise<unknown[]>;
      getUnrecoveredInterruptions: () => Promise<unknown[]>;
      saveInterruption: (interruption: unknown) => Promise<boolean>;
      markInterruptionRecovered: (id: string) => Promise<boolean>;
      deleteInterruption: (id: string) => Promise<boolean>;
      cleanupOldInterruptions: (daysToKeep?: number) => Promise<number>;
      
      // 邮件服务 API
      sendEmail: (params: { to: string[]; subject: string; message: string }) => Promise<{ success: boolean; error?: string }>;

      // 执行状态 API
      getExecutionState: (instanceId: string) => Promise<any | undefined>;
      getAllExecutionStates: () => Promise<Record<string, any>>;
      saveExecutionState: (state: any) => Promise<boolean>;
      deleteExecutionState: (instanceId: string) => Promise<boolean>;
      cleanupExecutionStates: () => Promise<number>;

      // 工作流执行日志 API
      saveWorkflowExecutionLog: (log: any) => Promise<boolean>;
      getWorkflowExecutionLog: (logId: string) => Promise<any | undefined>;
      getWorkflowExecutionLogs: (options?: { workflowId?: string; status?: string; limit?: number; offset?: number }) => Promise<any[]>;
      deleteWorkflowExecutionLog: (logId: string) => Promise<boolean>;
      cleanupWorkflowExecutionLogs: (retentionDays?: number) => Promise<number>;
      getWorkflowLogStats: () => Promise<any>;
      // 重建日志索引
      rebuildWorkflowLogIndex: () => Promise<number>;

      // 工作流执行控制 API
      workflowStartupCheck: (workflowId: string) => Promise<{ success: boolean; result?: any; error?: string }>;
      executeWorkflow: (workflowId: string, variables?: Record<string, unknown>) => Promise<{ instanceId: string; success: boolean; error?: string }>;
      pauseWorkflow: (instanceId: string) => Promise<boolean>;
      resumeWorkflow: (instanceId: string) => Promise<boolean>;
      stopWorkflow: (instanceId: string) => Promise<boolean>;
      forceStopWorkflow: (instanceId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
      getWorkflowState: (instanceId: string) => Promise<any | null>;
      getWorkflowVariables: (instanceId: string) => Promise<Record<string, unknown> | null>;
      listWorkflowInstances: () => Promise<any[]>;
      submitWorkflowReview: (instanceId: string, nodeId: string, result: { score?: number; stars?: number; feedback?: string; approved: boolean }) => Promise<boolean>;

      // 系统日志管理 API
      getSystemLogFiles: () => Promise<{ name: string; path: string; size: number; sizeFormatted: string; modifiedAt: string; createdAt: string }[]>;
      readSystemLog: (filename: string, options?: { lines?: number; level?: string; search?: string }) => Promise<{ success: boolean; filename?: string; totalLines?: number; content?: string; lines?: string[]; error?: string }>;
      deleteSystemLog: (filename: string) => Promise<{ success: boolean; error?: string }>;
      deleteSystemLogs: (filenames: string[]) => Promise<{ success: boolean; deleted: number; failed: number; error?: string }>;
      getSystemLogStats: () => Promise<{ totalFiles: number; totalSize: number; totalSizeFormatted: string; oldestFile?: string | null; newestFile?: string | null }>;
      cleanupSystemLogs: (retentionDays: number) => Promise<{ success: boolean; deleted: number; error?: string }>;

      // MCP/A2A 协议存储 API
      getProtocolConfig: () => Promise<any>;
      getMCPServers: () => Promise<any[]>;
      getMCPServer: (id: string) => Promise<any | undefined>;
      saveMCPServer: (server: any) => Promise<boolean>;
      deleteMCPServer: (id: string) => Promise<boolean>;
      toggleMCPServer: (id: string, enabled: boolean) => Promise<boolean>;
      getA2AAgents: () => Promise<any[]>;
      getA2AAgent: (id: string) => Promise<any | undefined>;
      saveA2AAgent: (agent: any) => Promise<boolean>;
      deleteA2AAgent: (id: string) => Promise<boolean>;
      toggleA2AAgent: (id: string, enabled: boolean) => Promise<boolean>;
      refreshA2AAgentCard: (agentId: string) => Promise<any>;
      getA2AAgentList: () => Promise<any[]>;
      discoverA2AAgentCard: (endpoint: string, protocolType?: string) => Promise<any>;

      // MCP API 配置 API
      getMCPApiConfigs: () => Promise<any[]>;
      getMCPApiConfig: (id: string) => Promise<any | undefined>;
      saveMCPApiConfig: (config: any) => Promise<boolean>;
      deleteMCPApiConfig: (id: string) => Promise<boolean>;
      toggleMCPApiConfig: (id: string, enabled: boolean) => Promise<boolean>;
      getMCPApiPlatforms: () => Promise<any[]>;
      getMCPApiPlatformInputFields: (platformId: string) => Promise<any[]>;
getMCPApiTools: (configId: string) => Promise<any[]>;

      // MCP 协议执行 API
      startMCPServer: (serverId: string) => Promise<any>;
      stopMCPServer: (serverId: string) => Promise<void>;
      getMCPServerTools: (serverId: string) => Promise<any[]>;
      callMCPTool: (serverId: string, toolName: string, args: any) => Promise<{ success: boolean; result?: any; error?: string }>;
      getMCPServerList: () => Promise<any[]>;

      // MCP 状态变化事件监听
      onMCPStatusChanged: (callback: () => void) => void;

      // MCP 能力绑定 API
      bindAgentCapabilities: (agentId: string, capabilities: { server: string; tools: string[] }[]) => Promise<{ success: boolean; binding?: any; error?: string }>;
      unbindAgentCapabilities: (agentId: string, capabilities: { server: string; tools: string[] }[]) => Promise<{ success: boolean; binding?: any; error?: string }>;
      getAgentCapabilities: (agentId: string) => Promise<any | null>;
      listAgentCapabilities: () => Promise<any[]>;
      checkAgentPermission: (agentId: string, server: string, tool: string) => Promise<boolean>;
      getMcpHttpEndpoint: () => Promise<string>;

      saveNpmRegistry: (registry: 'auto' | 'china' | 'official') => Promise<void>;
      getNpmRegistry: () => Promise<'auto' | 'china' | 'official'>;

      // A2A 协议执行 API
      sendA2ATaskSync: (agentId: string, task: string) => Promise<{ success: boolean; result?: any; error?: string }>;
      sendA2ATaskAsync: (agentId: string, task: string, webhookUrl?: string) => Promise<{ success: boolean; taskId?: string; error?: string }>;
      getA2ATaskStatus: (agentId: string, taskId: string) => Promise<any | undefined>;
      cancelA2ATask: (agentId: string, taskId: string) => Promise<boolean>;

      // AHIVECORE 流式对话 API
      startAHIVECOREStream: (agentId: string, message: string, sessionId?: string) => Promise<{ success: boolean; error?: string }>;
      stopAHIVECOREStream: (agentId: string) => Promise<{ success: boolean; error?: string }>;
      interruptAHIVECORE: (agentId: string) => Promise<{ success: boolean; error?: string }>;
      sendUserInput: (agentId: string, input: string) => Promise<{ success: boolean; error?: string }>;

      // A2A 健康检查 API
      checkA2AHealth: () => Promise<Map<string, boolean>>;
      startHealthCheck: () => Promise<boolean>;
      stopHealthCheck: () => Promise<boolean>;
      onA2AHealthStatus: (callback: (data: {
        offlineAgents: string[];
        totalAgents: number;
        timestamp: number;
      }) => void) => void;
      removeA2AHealthStatusListener: () => void;


      // 发现 A2A Agent Card
      discoverA2AAgentCard: (endpoint: string, protocolType?: string) => Promise<{
        success: boolean;
        card?: {
          id: string;
          name: string;
          description: string;
          url: string;
          capabilities: string[];
          version: string;
        };
        endpoint?: string;
        error?: string;
      }>;

      // Agent 技能持久化 API
      getPersistedAgents: () => Promise<any[]>;
      getPersistedAgent: (id: string) => Promise<any | undefined>;
      saveAgent: (agent: any) => Promise<boolean>;
      updateAgentSkills: (id: string, skills: string[]) => Promise<boolean>;
      deleteAgent: (id: string) => Promise<boolean>;
      saveAgents: (agents: unknown[]) => Promise<boolean>;

      // 系统状态检测 API
      checkOpenclawInstalled: () => Promise<{ installed: boolean; version: string | null; error: string | null }>;
      checkOpencodeInstalled: () => Promise<{ installed: boolean; version: string | null; error: string | null }>;
      getSystemServicesStatus: () => Promise<{
        gateway: { status: string; error?: string };
        mcpHttpEndpoint: string;
        a2a: { totalAgents: number; enabledAgents: number };
        openclawInstalled: boolean;
        opencodeInstalled: boolean;
      }>;
      getA2AEndpoint: () => Promise<string>;
      startOpencodeServe: (port?: number) => Promise<{ success: boolean; endpoint?: string; error?: string; message?: string }>;
      stopOpencodeServe: () => Promise<{ success: boolean; error?: string }>;
      getOpencodeServeStatus: () => Promise<{ running: boolean }>;

      // LLM Center API
      llmChat: (messages: any[], options?: any) => Promise<{ success: boolean; response?: any; error?: string }>;
      llmChatWithMemory: (query: string, options?: any) => Promise<{ success: boolean; response?: any; error?: string }>;
      llmGetStats: (options?: { agentId?: string }) => Promise<{ success: boolean; stats?: any; error?: string }>;
      llmResetStats: () => Promise<{ success: boolean }>;
      llmListProviders: () => Promise<string[]>;
      llmGetConfig: () => Promise<any>;
      llmSetProviderConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
      llmRemoveProviderConfig: (name: string) => Promise<{ success: boolean }>;
      llmSetDefaultProvider: (name: string) => Promise<{ success: boolean; error?: string }>;
      llmSetAgentConfig: (agentId: string, config: any) => Promise<{ success: boolean }>;
      llmGetAgentConfig: (agentId: string) => Promise<any | undefined>;

      // LLM Gateway API
      llmGatewayGetAddress: () => Promise<string>;
      llmGatewayListAppKeys: () => Promise<any[]>;
      llmGatewayGenerateAppKey: (agentId: string, agentName?: string) => Promise<any>;
      llmGatewayDeleteAppKey: (key: string) => Promise<{ success: boolean }>;
      llmGatewayToggleAppKey: (key: string, enabled: boolean) => Promise<{ success: boolean }>;

      // AHIVECORE 智能体管理 API
      createAHIVECOREAgent: (type: 'ahive-coder' | 'ahive-worker', config?: {
        nickname?: string;
        model?: {
          provider?: string;
          name?: string;
          temperature?: number;
          maxTokens?: number;
          apiKey?: string;
          baseUrl?: string;
        };
      }) => Promise<{ success: boolean; agent?: any; error?: string }>;
      updateAHIVECOREAgent: (agentId: string, config?: {
        nickname?: string;
        model?: {
          provider?: string;
          name?: string;
          temperature?: number;
          maxTokens?: number;
          apiKey?: string;
          baseUrl?: string;
        };
      }) => Promise<{ success: boolean; agent?: any; error?: string }>;
      deleteAHIVECOREAgent: (agentId: string) => Promise<{ success: boolean; error?: string }>;
      getAHIVECOREAgent: (agentId: string) => Promise<{ success: boolean; agent?: any; error?: string }>;
      listAHIVECOREAgents: () => Promise<{ success: boolean; agents?: any[]; error?: string }>;
    };
  }
}