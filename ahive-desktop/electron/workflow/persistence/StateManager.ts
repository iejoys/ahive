/**
 * 状态持久化管理器
 * 管理三层文件架构的状态持久化
 * 
 * 三层架构：
 * 1. workflow-execution.json - 引擎视角（工作流执行状态）
 * 2. workflow-log.md - 指挥官视角（项目日志）
 * 3. agent.md - Agent视角（Agent工作状态）
 */

import * as fs from 'fs';
import * as path from 'path';

// ========== 类型定义 ==========

/**
 * 节点执行状态
 */
export type NodeExecutionStatus = 
  | 'pending'      // 待执行
  | 'running'      // 执行中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'skipped';     // 跳过

/**
 * 工作流执行状态
 */
export type WorkflowExecutionStatus =
  | 'idle'         // 空闲
  | 'running'      // 运行中
  | 'paused'       // 已暂停
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'interrupted'; // 中断（可恢复）

/**
 * 节点执行记录
 */
export interface NodeExecutionRecord {
  nodeId: string;
  nodeName: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  agentId?: string;
  agentName?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  duration?: number;
  retryCount?: number;
}

/**
 * 工作流执行状态（引擎视角）
 */
export interface WorkflowExecutionState {
  // 基本信息
  instanceId: string;
  workflowId: string;
  workflowName: string;
  projectPath: string;
  
  // 状态
  status: WorkflowExecutionStatus;
  currentNodeId: string | null;
  currentNodeName: string | null;
  
  // 时间
  startedAt: string;
  completedAt?: string;
  lastUpdatedAt: string;
  interruptedAt?: string;
  
  // 执行路径
  executionPath: string[];
  nodeRecords: NodeExecutionRecord[];
  
  // 黑板变量
  variables: Record<string, unknown>;
  
  // 错误信息
  error?: string;
  
  // 元数据
  metadata?: {
    totalNodes?: number;
    completedNodes?: number;
    failedNodes?: number;
    [key: string]: unknown;
  };
}

/**
 * 指挥官日志条目
 */
export interface CommanderLogEntry {
  timestamp: string;
  type: 'info' | 'task' | 'complete' | 'error' | 'query' | 'response';
  nodeId?: string;
  nodeName?: string;
  agentId?: string;
  agentName?: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Agent工作状态
 */
export interface AgentWorkState {
  agentId: string;
  agentName: string;
  status: 'idle' | 'working' | 'waiting' | 'error';
  
  // 当前任务
  currentTask?: {
    instanceId: string;
    workflowId: string;
    workflowName: string;
    nodeId: string;
    nodeName: string;
    taskDescription: string;
    startedAt: string;
  };
  
  // 历史任务
  completedTasks?: Array<{
    instanceId: string;
    nodeId: string;
    nodeName: string;
    completedAt: string;
    success: boolean;
  }>;
  
  // 时间戳
  lastUpdatedAt: string;
  lastHeartbeatAt: string;
  
  // 工作目录
  projectPath?: string;
}

// ========== 状态管理器类 ==========

/**
 * 状态管理器
 * 负责三层文件的状态持久化
 */
export class StateManager {
  private baseDir: string;
  private executionsDir: string;
  private logsDir: string;
  private agentsDir: string;
  
  constructor(baseDir: string = './data/workflow') {
    this.baseDir = baseDir;
    this.executionsDir = path.join(baseDir, 'executions');
    this.logsDir = path.join(baseDir, 'logs');
    this.agentsDir = path.join(baseDir, 'agents');
    
    this.ensureDirectories();
  }
  
  /**
   * 确保目录存在
   */
  private ensureDirectories(): void {
    [this.baseDir, this.executionsDir, this.logsDir, this.agentsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
  
  // ========== 第一层：工作流执行状态（引擎视角） ==========
  
  /**
   * 获取执行状态文件路径
   */
  private getExecutionFilePath(instanceId: string): string {
    return path.join(this.executionsDir, `${instanceId}.json`);
  }
  
  /**
   * 保存工作流执行状态
   */
  saveExecutionState(state: WorkflowExecutionState): void {
    const filePath = this.getExecutionFilePath(state.instanceId);
    state.lastUpdatedAt = new Date().toISOString();
    
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`[StateManager] Saved execution state: ${state.instanceId}`);
  }
  
  /**
   * 加载工作流执行状态
   */
  loadExecutionState(instanceId: string): WorkflowExecutionState | null {
    const filePath = this.getExecutionFilePath(instanceId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as WorkflowExecutionState;
    } catch (error) {
      console.error(`[StateManager] Failed to load execution state: ${instanceId}`, error);
      return null;
    }
  }
  
  /**
   * 删除工作流执行状态
   */
  deleteExecutionState(instanceId: string): void {
    const filePath = this.getExecutionFilePath(instanceId);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[StateManager] Deleted execution state: ${instanceId}`);
    }
  }
  
  /**
   * 获取所有中断的工作流
   */
  getInterruptedExecutions(): WorkflowExecutionState[] {
    const files = fs.readdirSync(this.executionsDir);
    const interrupted: WorkflowExecutionState[] = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const instanceId = file.replace('.json', '');
      const state = this.loadExecutionState(instanceId);
      
      if (state && state.status === 'interrupted') {
        interrupted.push(state);
      }
    }
    
    return interrupted;
  }
  
  /**
   * 获取所有运行中的工作流
   */
  getRunningExecutions(): WorkflowExecutionState[] {
    const files = fs.readdirSync(this.executionsDir);
    const running: WorkflowExecutionState[] = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const instanceId = file.replace('.json', '');
      const state = this.loadExecutionState(instanceId);
      
      if (state && (state.status === 'running' || state.status === 'paused')) {
        running.push(state);
      }
    }
    
    return running;
  }
  
  // ========== 第二层：指挥官日志（指挥官视角） ==========
  
  /**
   * 获取指挥官日志文件路径
   */
  private getLogFilePath(instanceId: string): string {
    return path.join(this.logsDir, `${instanceId}.md`);
  }
  
  /**
   * 初始化指挥官日志
   */
  initCommanderLog(instanceId: string, workflowName: string, projectPath: string): void {
    const filePath = this.getLogFilePath(instanceId);
    const timestamp = new Date().toISOString();
    
    const content = `# 工作流执行日志

## 基本信息

- **工作流名称**: ${workflowName}
- **实例ID**: ${instanceId}
- **项目路径**: ${projectPath}
- **开始时间**: ${timestamp}

---

## 执行记录

`;
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[StateManager] Initialized commander log: ${instanceId}`);
  }
  
  /**
   * 追加指挥官日志
   */
  appendCommanderLog(instanceId: string, entry: CommanderLogEntry): void {
    const filePath = this.getLogFilePath(instanceId);
    
    if (!fs.existsSync(filePath)) {
      return;
    }
    
    const timestamp = entry.timestamp || new Date().toISOString();
    let line = '';
    
    switch (entry.type) {
      case 'info':
        line = `### [${timestamp}] ℹ️ 信息\n\n${entry.message}\n\n`;
        break;
        
      case 'task':
        line = `### [${timestamp}] 📋 任务分发\n\n- **节点**: ${entry.nodeName} (${entry.nodeId})\n- **执行者**: ${entry.agentName} (${entry.agentId})\n- **描述**: ${entry.message}\n\n`;
        break;
        
      case 'complete':
        line = `### [${timestamp}] ✅ 任务完成\n\n- **节点**: ${entry.nodeName} (${entry.nodeId})\n- **执行者**: ${entry.agentName} (${entry.agentId})\n- **结果**: ${entry.message}\n\n`;
        break;
        
      case 'error':
        line = `### [${timestamp}] ❌ 错误\n\n- **节点**: ${entry.nodeName} (${entry.nodeId})\n- **错误**: ${entry.message}\n\n`;
        break;
        
      case 'query':
        line = `### [${timestamp}] ❓ 询问\n\n- **目标**: ${entry.agentName}\n- **内容**: ${entry.message}\n\n`;
        break;
        
      case 'response':
        line = `### [${timestamp}] 💬 回复\n\n- **来源**: ${entry.agentName}\n- **内容**: ${entry.message}\n\n`;
        break;
    }
    
    fs.appendFileSync(filePath, line, 'utf-8');
  }
  
  /**
   * 读取指挥官日志
   */
  readCommanderLog(instanceId: string): string | null {
    const filePath = this.getLogFilePath(instanceId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    return fs.readFileSync(filePath, 'utf-8');
  }
  
  // ========== 第三层：Agent工作状态（Agent视角） ==========
  
  /**
   * 获取Agent状态文件路径
   */
  private getAgentFilePath(agentId: string): string {
    return path.join(this.agentsDir, `${agentId}.md`);
  }
  
  /**
   * 初始化Agent状态文件
   */
  initAgentState(agentId: string, agentName: string, projectPath?: string): void {
    const filePath = this.getAgentFilePath(agentId);
    const timestamp = new Date().toISOString();
    
    const content = `# Agent 工作状态

## 基本信息

- **Agent ID**: ${agentId}
- **Agent 名称**: ${agentName}
- **状态**: idle
- **最后更新**: ${timestamp}
- **最后心跳**: ${timestamp}
${projectPath ? `- **项目路径**: ${projectPath}` : ''}

---

## 当前任务

暂无任务

---

## 任务历史

暂无历史任务

`;
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[StateManager] Initialized agent state: ${agentId}`);
  }
  
  /**
   * 更新Agent状态
   */
  updateAgentState(state: AgentWorkState): void {
    const filePath = this.getAgentFilePath(state.agentId);
    state.lastUpdatedAt = new Date().toISOString();
    
    let currentTaskSection = '暂无任务';
    if (state.currentTask) {
      currentTaskSection = `### 当前任务详情

- **工作流**: ${state.currentTask.workflowName}
- **实例ID**: ${state.currentTask.instanceId}
- **节点**: ${state.currentTask.nodeName} (${state.currentTask.nodeId})
- **任务描述**: ${state.currentTask.taskDescription}
- **开始时间**: ${state.currentTask.startedAt}
`;
    }
    
    let historySection = '暂无历史任务';
    if (state.completedTasks && state.completedTasks.length > 0) {
      historySection = state.completedTasks.map(task => 
        `- **${task.nodeName}**: ${task.success ? '✅ 成功' : '❌ 失败'} (${task.completedAt})`
      ).join('\n');
    }
    
    const content = `# Agent 工作状态

## 基本信息

- **Agent ID**: ${state.agentId}
- **Agent 名称**: ${state.agentName}
- **状态**: ${state.status}
- **最后更新**: ${state.lastUpdatedAt}
- **最后心跳**: ${state.lastHeartbeatAt}
${state.projectPath ? `- **项目路径**: ${state.projectPath}` : ''}

---

## 当前任务

${currentTaskSection}

---

## 任务历史

${historySection}

`;
    
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  
  /**
   * 读取Agent状态
   */
  readAgentState(agentId: string): string | null {
    const filePath = this.getAgentFilePath(agentId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    return fs.readFileSync(filePath, 'utf-8');
  }
  
  /**
   * 解析Agent状态（从Markdown解析）
   */
  parseAgentState(agentId: string): AgentWorkState | null {
    const content = this.readAgentState(agentId);
    
    if (!content) {
      return null;
    }
    
    // 简单解析Markdown
    const statusMatch = content.match(/\*\*状态\*\*:\s*(\w+)/);
    const nameMatch = content.match(/\*\*Agent 名称\*\*:\s*(.+)/);
    
    return {
      agentId,
      agentName: nameMatch ? nameMatch[1].trim() : agentId,
      status: statusMatch ? (statusMatch[1] as AgentWorkState['status']) : 'idle',
      lastUpdatedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    };
  }
  
  // ========== 工具方法 ==========
  
  /**
   * 清理过期的执行状态
   */
  cleanupExpiredStates(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;
    
    const files = fs.readdirSync(this.executionsDir);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(this.executionsDir, file);
      const stat = fs.statSync(filePath);
      
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
    
    console.log(`[StateManager] Cleaned ${cleaned} expired states`);
    return cleaned;
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    totalExecutions: number;
    runningExecutions: number;
    interruptedExecutions: number;
    totalAgents: number;
  } {
    const executionFiles = fs.readdirSync(this.executionsDir).filter(f => f.endsWith('.json'));
    const agentFiles = fs.readdirSync(this.agentsDir).filter(f => f.endsWith('.md'));
    
    let running = 0;
    let interrupted = 0;
    
    for (const file of executionFiles) {
      const instanceId = file.replace('.json', '');
      const state = this.loadExecutionState(instanceId);
      
      if (state) {
        if (state.status === 'running' || state.status === 'paused') {
          running++;
        } else if (state.status === 'interrupted') {
          interrupted++;
        }
      }
    }
    
    return {
      totalExecutions: executionFiles.length,
      runningExecutions: running,
      interruptedExecutions: interrupted,
      totalAgents: agentFiles.length,
    };
  }
  
  // ========== WorkflowScheduler 需要的方法 ==========
  
  /**
   * 当前实例 ID（用于 WorkflowScheduler）
   */
  private currentInstanceId: string | null = null;
  private currentWorkflowId: string | null = null;
  private currentProjectId: string | null = null;
  
  /**
   * 初始化执行（WorkflowScheduler 调用）
   */
  async initExecution(
    workflow: { id: string; name: string },
    variables?: Record<string, unknown>,
    triggeredBy?: string
  ): Promise<void> {
    this.currentInstanceId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.currentWorkflowId = workflow.id;
    
    const state: WorkflowExecutionState = {
      instanceId: this.currentInstanceId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      projectPath: this.currentProjectId || '',
      status: 'running',
      currentNodeId: null,
      currentNodeName: null,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      executionPath: [],
      nodeRecords: [],
      variables: variables || {},
      metadata: {
        triggeredBy,
        totalNodes: 0,
        completedNodes: 0,
        failedNodes: 0,
      },
    };
    
    this.saveExecutionState(state);
    
    // 初始化指挥官日志
    this.initCommanderLog(this.currentInstanceId, workflow.name, this.currentProjectId || '');
    
    console.log(`[StateManager] Initialized execution: ${this.currentInstanceId}`);
  }
  
  /**
   * 获取当前实例 ID
   */
  getInstanceId(): string {
    return this.currentInstanceId || '';
  }
  
  /**
   * 保存当前状态（WorkflowScheduler 调用）
   */
  async saveState(): Promise<void> {
    if (!this.currentInstanceId) return;
    
    const state = this.loadExecutionState(this.currentInstanceId);
    if (state) {
      state.lastUpdatedAt = new Date().toISOString();
      this.saveExecutionState(state);
    }
  }
  
  /**
   * 加载状态（WorkflowEngine.fromPersisted 调用）
   */
  async loadState(instanceId: string): Promise<WorkflowExecutionState | null> {
    return this.loadExecutionState(instanceId);
  }
  
  /**
   * 更新节点状态
   */
  async updateNodeStatus(nodeId: string, status: NodeExecutionStatus): Promise<void> {
    if (!this.currentInstanceId) return;
    
    const state = this.loadExecutionState(this.currentInstanceId);
    if (!state) return;
    
    // 更新节点记录
    const nodeRecord = state.nodeRecords.find(r => r.nodeId === nodeId);
    if (nodeRecord) {
      nodeRecord.status = status;
      if (status === 'completed' || status === 'failed') {
        nodeRecord.completedAt = new Date().toISOString();
      } else if (status === 'running') {
        nodeRecord.startedAt = new Date().toISOString();
      }
    } else {
      state.nodeRecords.push({
        nodeId,
        nodeName: '',
        status,
        startedAt: status === 'running' ? new Date().toISOString() : undefined,
        completedAt: status === 'completed' || status === 'failed' ? new Date().toISOString() : undefined,
      });
    }
    
    state.currentNodeId = nodeId;
    state.lastUpdatedAt = new Date().toISOString();
    this.saveExecutionState(state);
  }
  
  /**
   * 更新工作流状态
   */
  async updateStatus(status: WorkflowExecutionStatus, reason?: string): Promise<void> {
    if (!this.currentInstanceId) return;
    
    const state = this.loadExecutionState(this.currentInstanceId);
    if (!state) return;
    
    state.status = status;
    state.lastUpdatedAt = new Date().toISOString();
    
    if (status === 'completed' || status === 'failed') {
      state.completedAt = new Date().toISOString();
    }
    
    if (status === 'interrupted') {
      state.interruptedAt = new Date().toISOString();
    }
    
    if (reason) {
      state.error = reason;
    }
    
    this.saveExecutionState(state);
  }
  
  /**
   * 获取当前状态
   */
  getState(): WorkflowExecutionState | null {
    if (!this.currentInstanceId) return null;
    return this.loadExecutionState(this.currentInstanceId);
  }
  
  /**
   * 设置变量
   */
  async setVariable(key: string, value: unknown): Promise<void> {
    if (!this.currentInstanceId) return;
    
    const state = this.loadExecutionState(this.currentInstanceId);
    if (!state) return;
    
    state.variables[key] = value;
    state.lastUpdatedAt = new Date().toISOString();
    this.saveExecutionState(state);
  }
  
  /**
   * 更新 Agent 进度
   */
  async updateAgentProgress(
    agentId: string,
    progress: number,
    status: string
  ): Promise<void> {
    if (!this.currentInstanceId) return;
    
    const state = this.loadExecutionState(this.currentInstanceId);
    if (!state) return;
    
    state.metadata = {
      ...state.metadata,
      agentProgress: {
        agentId,
        progress,
        status,
        updatedAt: new Date().toISOString(),
      },
    };
    
    state.lastUpdatedAt = new Date().toISOString();
    this.saveExecutionState(state);
  }
  
  /**
   * 完成节点
   */
  async completeNode(nodeId: string, output?: Record<string, unknown>): Promise<void> {
    if (!this.currentInstanceId) return;
    
    const state = this.loadExecutionState(this.currentInstanceId);
    if (!state) return;
    
    const nodeRecord = state.nodeRecords.find(r => r.nodeId === nodeId);
    if (nodeRecord) {
      nodeRecord.status = 'completed';
      nodeRecord.completedAt = new Date().toISOString();
      if (output) {
        nodeRecord.output = output;
      }
    }
    
    if (state.metadata) {
      state.metadata.completedNodes = (state.metadata.completedNodes || 0) + 1;
    }
    
    state.lastUpdatedAt = new Date().toISOString();
    this.saveExecutionState(state);
  }
  
  /**
   * 标记节点失败
   */
  async failNode(nodeId: string, error: string): Promise<void> {
    if (!this.currentInstanceId) return;
    
    const state = this.loadExecutionState(this.currentInstanceId);
    if (!state) return;
    
    const nodeRecord = state.nodeRecords.find(r => r.nodeId === nodeId);
    if (nodeRecord) {
      nodeRecord.status = 'failed';
      nodeRecord.completedAt = new Date().toISOString();
      nodeRecord.error = error;
    }
    
    if (state.metadata) {
      state.metadata.failedNodes = (state.metadata.failedNodes || 0) + 1;
    }
    
    state.error = error;
    state.lastUpdatedAt = new Date().toISOString();
    this.saveExecutionState(state);
  }
  
  /**
   * 更新 Agent 状态
   */
  async updateAgentStatus(
    agentId: string,
    status: 'idle' | 'working' | 'waiting' | 'error',
    animation?: string
  ): Promise<void> {
    const agentState = this.parseAgentState(agentId);
    
    const newState: AgentWorkState = {
      agentId,
      agentName: agentState?.agentName || agentId,
      status,
      lastUpdatedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      projectPath: this.currentProjectId,
    };
    
    this.updateAgentState(newState);
  }
  
  /**
   * 获取所有执行状态（InterruptRecovery 调用）
   */
  getAllExecutionStates(): WorkflowExecutionState[] {
    const files = fs.readdirSync(this.executionsDir);
    const states: WorkflowExecutionState[] = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const instanceId = file.replace('.json', '');
      const state = this.loadExecutionState(instanceId);
      
      if (state) {
        states.push(state);
      }
    }
    
    return states;
  }
}