/// <reference types="vite/client" />

interface ElectronAPI {
  openExternal?: (url: string) => Promise<void>;
  getAppVersion?: () => Promise<string>;
  runCommand?: (command: string) => Promise<string>;
  getAgents?: () => Promise<any[]>;
  platform?: string;
  isDesktop?: boolean;
  
  // 数据存储 API
  getDataDirectory?: () => Promise<string>;
  getAppData?: () => Promise<any>;
  saveAppData?: (data: any) => Promise<boolean>;
  getScheduledTasks?: () => Promise<any[]>;
  saveScheduledTask?: (task: any) => Promise<boolean>;
  deleteScheduledTask?: (taskId: string) => Promise<boolean>;
  toggleScheduledTask?: (taskId: string, enabled: boolean) => Promise<boolean>;
  addTaskRun?: (run: any) => Promise<boolean>;
  getTaskRuns?: (taskId: string) => Promise<any[]>;
  getAllTaskRuns?: () => Promise<Record<string, any[]>>;
  
  // 消息发送
  sendMessageToAgent?: (agentName: string, message: string) => Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    error?: string;
    data?: any;
    raw?: string;
  }>;
  
  // 网关管理
  getGatewayStatus?: () => Promise<{ status: string; error?: string }>;
  startGateway?: () => Promise<{ success: boolean; error?: string }>;
  stopGateway?: () => Promise<{ success: boolean; error?: string }>;
  onGatewayStatus?: (callback: (data: { status: string; error?: string }) => void) => void;
  
  // 工作流 API
  getWorkflows?: () => Promise<any[]>;
  getWorkflow?: (workflowId: string) => Promise<any | undefined>;
  saveWorkflow?: (workflow: any) => Promise<boolean>;
  deleteWorkflow?: (workflowId: string) => Promise<boolean>;
  workflowNameExists?: (name: string, excludeId?: string) => Promise<boolean>;
  importWorkflow?: (content: string, customName?: string) => Promise<{
    success: boolean;
    workflow?: any;
    error?: string;
  }>;
  listWorkflowFiles?: () => Promise<string[]>;
  renameWorkflow?: (oldName: string, newName: string) => Promise<boolean>;
  
  // 工作流模板 API
  getWorkflowTemplates?: () => Promise<any[]>;
  getWorkflowTemplate?: (templateId: string) => Promise<any | undefined>;
  saveWorkflowTemplate?: (template: any) => Promise<boolean>;
  deleteWorkflowTemplate?: (templateId: string) => Promise<boolean>;
  
  // 黑板 API（兼容旧版）
  getBlackboardState?: (scope?: string) => Promise<any>;
  saveBlackboardState?: (state: any) => Promise<boolean>;
  updateBlackboardVariable?: (entry: any) => Promise<boolean>;
  deleteBlackboardVariable?: (key: string) => Promise<boolean>;
  addBlackboardEvent?: (event: any) => Promise<boolean>;
  
  // 黑板 API（V2 - 全局变量）
  getGlobalVariables?: () => Promise<any>;
  saveGlobalVariables?: (variables: any[]) => Promise<boolean>;
  updateGlobalVariable?: (entry: any) => Promise<boolean>;
  deleteGlobalVariable?: (key: string) => Promise<boolean>;
  
  // 黑板 API（V2 - 工作流变量）
  getWorkflowVariables?: (workflowId: string) => Promise<any>;
  saveWorkflowVariables?: (workflowId: string, variables: any[]) => Promise<boolean>;
  updateWorkflowVariable?: (workflowId: string, entry: any) => Promise<boolean>;
  deleteWorkflowVariable?: (workflowId: string, key: string) => Promise<boolean>;
  clearWorkflowVariables?: (workflowId: string) => Promise<boolean>;
  deleteWorkflowDataDir?: (workflowId: string) => Promise<boolean>;
  getAllWorkflowVariables?: () => Promise<Record<string, any>>;
  
  // 部门 API
  getDepartments?: () => Promise<any[]>;
  getDepartment?: (departmentId: string) => Promise<any | undefined>;
  saveDepartment?: (department: any) => Promise<boolean>;
  saveDepartments?: (departments: any[]) => Promise<boolean>;
  deleteDepartment?: (departmentId: string) => Promise<boolean>;
  addDepartmentMember?: (departmentId: string, member: any) => Promise<boolean>;
  removeDepartmentMember?: (departmentId: string, agentId: string) => Promise<boolean>;
  
  // 执行状态 API
  getExecutionState?: (instanceId: string) => Promise<any | undefined>;
  getAllExecutionStates?: () => Promise<Record<string, any>>;
  saveExecutionState?: (state: any) => Promise<boolean>;
  deleteExecutionState?: (instanceId: string) => Promise<boolean>;
  cleanupExecutionStates?: () => Promise<number>;
  // 工作流执行日志 API
  saveWorkflowExecutionLog?: (log: any) => Promise<boolean>;
  getWorkflowExecutionLog?: (logId: string) => Promise<any | undefined>;
  getWorkflowExecutionLogs?: (options?: { workflowId?: string; status?: string; limit?: number; offset?: number }) => Promise<any[]>;
  deleteWorkflowExecutionLog?: (logId: string) => Promise<boolean>;
  cleanupWorkflowExecutionLogs?: (retentionDays?: number) => Promise<number>;
  getWorkflowLogStats?: () => Promise<any>;
  rebuildWorkflowLogIndex?: () => Promise<number>;

  // MCP/A2A 协议存储 API
  getProtocolConfig?: () => Promise<any>;
  getMCPServers?: () => Promise<any[]>;
  getMCPServer?: (id: string) => Promise<any | undefined>;
  saveMCPServer?: (server: any) => Promise<boolean>;
  deleteMCPServer?: (id: string) => Promise<boolean>;
  toggleMCPServer?: (id: string, enabled: boolean) => Promise<boolean>;
  getA2AAgents?: () => Promise<any[]>;
  getA2AAgent?: (id: string) => Promise<any | undefined>;
  saveA2AAgent?: (agent: any) => Promise<boolean>;
  deleteA2AAgent?: (id: string) => Promise<boolean>;
  toggleA2AAgent?: (id: string, enabled: boolean) => Promise<boolean>;

  // MCP 协议执行 API
  startMCPServer?: (serverId: string) => Promise<any>;
  stopMCPServer?: (serverId: string) => Promise<void>;
  getMCPServerTools?: (serverId: string) => Promise<any[]>;
  callMCPTool?: (serverId: string, toolName: string, args: any) => Promise<{ success: boolean; result?: any; error?: string }>;
  getMCPServerList?: () => Promise<any[]>;

  // MCP 状态变化监听
  onMCPStatusChanged?: (callback: () => void) => void;
  removeMCPStatusChangedListener?: () => void;

  // A2A 协议执行 API
  sendA2ATaskSync?: (agentId: string, task: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  sendA2ATaskAsync?: (agentId: string, task: string, webhookUrl?: string) => Promise<{ success: boolean; taskId?: string; error?: string }>;
  getA2ATaskStatus?: (agentId: string, taskId: string) => Promise<any | undefined>;
  cancelA2ATask?: (agentId: string, taskId: string) => Promise<boolean>;
  refreshA2AAgentCard?: (agentId: string) => Promise<any | null>;
  getA2AAgentList?: () => Promise<any[]>;
  
  // AHIVECORE 流式对话 API
  startAHIVECOREStream?: (agentId: string, message: string, sessionId?: string) => Promise<{ success: boolean; error?: string }>;
  stopAHIVECOREStream?: (agentId: string) => Promise<{ success: boolean; error?: string }>;
  interruptAHIVECORE?: (agentId: string) => Promise<{ success: boolean; error?: string }>;
  sendUserInput?: (agentId: string, input: string) => Promise<{ success: boolean; error?: string }>;

  // Agent 技能持久化 API
  getPersistedAgents?: () => Promise<any[]>;
  getPersistedAgent?: (id: string) => Promise<any | undefined>;
  saveAgent?: (agent: any) => Promise<boolean>;
  updateAgentSkills?: (id: string, skills: string[]) => Promise<boolean>;
  deleteAgent?: (id: string) => Promise<boolean>;
  saveAgents?: (agents: any[]) => Promise<boolean>;

  // npm 镜像源设置 API
  getNpmRegistry?: () => Promise<'auto' | 'china' | 'official'>;
  saveNpmRegistry?: (registry: 'auto' | 'china' | 'official') => Promise<void>;

  // MCP API 配置 API
  getMCPApiConfigs?: () => Promise<any[]>;
  getMCPApiConfig?: (id: string) => Promise<any | undefined>;
  saveMCPApiConfig?: (config: any) => Promise<boolean>;
  deleteMCPApiConfig?: (id: string) => Promise<boolean>;
  toggleMCPApiConfig?: (id: string, enabled: boolean) => Promise<boolean>;
  getMCPApiPlatforms?: () => Promise<any[]>;
  getMCPApiPlatformInputFields?: (platformId: string) => Promise<any[]>;
  getMCPApiTools?: (configId: string) => Promise<any[]>;

  // MCP 能力绑定 API
  bindAgentCapabilities?: (agentId: string, capabilities: any[]) => Promise<{ success: boolean; binding?: any; error?: string }>;
  unbindAgentCapabilities?: (agentId: string, capabilities: any[]) => Promise<{ success: boolean; binding?: any; error?: string }>;
  getAgentCapabilities?: (agentId: string) => Promise<any | null>;

  // ========== 系统状态检测 API ==========
  checkOpenclawInstalled?: () => Promise<{ installed: boolean; version: string | null; error: string | null }>;
  checkOpencodeInstalled?: () => Promise<{ installed: boolean; version: string | null; error: string | null }>;
  getSystemServicesStatus?: () => Promise<{
    gateway: { status: string; error?: string };
    mcpHttpEndpoint: string;
    a2a: { totalAgents: number; enabledAgents: number };
    openclawInstalled: boolean;
    opencodeInstalled: boolean;
  }>;
  getA2AEndpoint?: () => Promise<string>;
  startOpencodeServe?: (port?: number) => Promise<{ success: boolean; endpoint?: string; error?: string; message?: string }>;
  stopOpencodeServe?: () => Promise<{ success: boolean; error?: string }>;
  getOpencodeServeStatus?: () => Promise<{ running: boolean }>;

  // ========== 工作流启动检测 API ==========
  workflowStartupCheck?: (workflowId: string) => Promise<{
    success: boolean;
    canProceed: boolean;
    steps?: Array<{
      id: string;
      name: string;
      status: 'pending' | 'checking' | 'success' | 'failed' | 'skipped';
      details: string[];
      error?: string;
      timestamp: number;
    }>;
    error?: string;
  }>;
  
  // ========== 工作流实例管理 API ==========
  getIncompleteWorkflowInstances?: () => Promise<any[]>;
  getWorkflowInstanceDetails?: (instanceId: string) => Promise<any | null>;
  
  // ========== 项目配置模板 API ==========
  getProjectConfigTemplates?: (language?: 'zh' | 'en') => Promise<any[]>;
  getProjectConfigTemplate?: (templateId: string, language?: 'zh' | 'en') => Promise<any | undefined>;
  reloadProjectConfigTemplates?: () => Promise<boolean>;
}


declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};