/**
 * 工作流调度器（新版）
 * 管理多个工作流执行实例，支持中断恢复和指挥官通信
 */

import log from 'electron-log';
import type {
  Agent,
  Workflow,
  ExecutionContext,
  WorkflowEvent,
  ReviewResult,
} from '../types';
import type { WebSocketServer } from '../../services/ahivecore/WebSocketServer';
import { WorkflowEngine } from './WorkflowEngine';
import { StateManager, WorkflowExecutionState } from '../persistence/StateManager';
import { CommanderChannel, CommanderMessage } from './CommanderChannel';
import { InterruptRecovery } from '../recovery/InterruptRecovery';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectPromptGenerator } from '../persistence/ProjectPromptGenerator';

/**
 * 调度器配置
 */
export interface WorkflowSchedulerConfig {
  // WebSocket 服务器（复用全局）
  wsServer: WebSocketServer;
  
  // Agent 相关
  getAgents: () => Agent[];
  getWorkflow: (workflowId: string) => Workflow | undefined;
  callAgent: (
    agent: Agent,
    prompt: string,
    timeout?: number
  ) => Promise<{ success: boolean; output: string; error?: string }>;
  
  // 持久化路径
  stateDir?: string;
  
  // 定时询问间隔（毫秒）
  pollInterval?: number;
  
  // 心跳检测间隔（毫秒）
  heartbeatInterval?: number;
  
  // 状态数据库
  stateDB?: any;  // WorkflowStateDB 实例
}

/**
 * 启动检测步骤状态
 */
export type StartupCheckStatus = 'pending' | 'checking' | 'success' | 'failed' | 'skipped' | 'warning';

/**
 * 启动检测单项结果（每个检测步骤的结果）
 * 与前端 WorkflowStartupCheckDialog.tsx 的 CheckStep 接口匹配
 */
export interface StartupCheckItem {
  id: string;             // 检测步骤 ID（如 'heartbeat-service'）
  name: string;           // 步骤中文名称
  nameEn: string;         // 步骤英文名称
  status: StartupCheckStatus;
  details: string[];      // 详细信息列表
  error?: string;         // 错误信息（如果有）
  timestamp: number;      // 时间戳
}

/**
 * 启动检测总体结果（整个检测的汇总结果）
 * 与前端 WorkflowStartupCheckDialog.tsx 的 StartupCheckResult 接口匹配
 */
export interface StartupCheckResult {
  workflowId: string;
  workflowName: string;
  canProceed: boolean;    // 是否可以继续执行工作流
  steps: StartupCheckItem[];  // 检测步骤列表（前端期望 steps 而不是 checks）
  timestamp: number;
}

/**
 * 启动检测报告（用于记录和展示）
 */
export interface StartupCheckReport {
  workflowId: string;
  workflowName: string;
  success: boolean;
  steps: StartupCheckItem[];
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * 执行实例信息
 */
interface ExecutionInstance {
  engine: WorkflowEngine;
  stateManager: StateManager;
  commanderChannel: CommanderChannel;
  startedAt: number;
  lastPollAt: number;
}

/**
 * 工作流调度器
 */
export class WorkflowScheduler {
  private config: Required<Omit<WorkflowSchedulerConfig, 'stateDir'>> & { stateDir: string };
  private instances: Map<string, ExecutionInstance> = new Map();
  private recovery: InterruptRecovery;
  
  // 定时器
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  
  // 事件处理器
  private eventHandlers: Map<string, (event: WorkflowEvent) => void> = new Map();
  
  constructor(config: WorkflowSchedulerConfig) {
    this.config = {
      wsServer: config.wsServer,
      getAgents: config.getAgents,
      getWorkflow: config.getWorkflow,
      callAgent: config.callAgent,
      stateDir: config.stateDir || './data/workflow-states',
      stateDB: config.stateDB, // 传递 stateDB
      pollInterval: config.pollInterval || 30000, // 30秒
      heartbeatInterval: config.heartbeatInterval || 30000, // 30秒
    };
    
    // InterruptRecovery 需要 InterruptRecoveryConfig 对象
    const stateManager = new StateManager(this.config.stateDir);
    this.recovery = new InterruptRecovery({
      stateManager,
      dataDir: this.config.stateDir,
      autoRecoverOnStart: false
    });
    
    console.log('[WorkflowScheduler] Created with state dir:', this.config.stateDir);
  }
  
  /**
   * 启动调度器
   */
  async start(): Promise<void> {
    console.log('[WorkflowScheduler] Starting...');
    
    // 启动定时询问
    this.startPolling();
    
    // 启动心跳检测
    this.startHeartbeat();
    
    // 恢复中断的工作流
    await this.recoverInterrupted();
    
    console.log('[WorkflowScheduler] Started');
  }
  
  /**
   * 停止调度器
   */
  async stop(): Promise<void> {
    console.log('[WorkflowScheduler] Stopping...');
    
    // 停止定时器
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    // 保存所有运行中的实例状态
    for (const [instanceId, instance] of this.instances) {
      if (instance.stateManager) {
        await instance.stateManager.saveState();
      }
      instance.commanderChannel.destroy();
    }
    
    console.log('[WorkflowScheduler] Stopped');
  }
  
  // ==================== 启动检测功能 ====================

  // 检测步骤定义（与前端匹配）
  private readonly CHECK_STEP_DEFINITIONS = [
    { id: 'heartbeat', name: '心跳检测已启动', nameEn: 'Heartbeat Started' },
    { id: 'project-config', name: '项目配置检测', nameEn: 'Project Config' },
    { id: 'agent-status', name: 'Agent 状态检测', nameEn: 'Agent Status' },
    { id: 'context-inject', name: '上下文注入', nameEn: 'Context Injection' },
  ];

  /**
   * 创建检测步骤初始状态
   */
  private createCheckStep(id: string, status: StartupCheckStatus = 'pending', details: string[] = [], error?: string): StartupCheckItem {
    const def = this.CHECK_STEP_DEFINITIONS.find(d => d.id === id);
    return {
      id,
      name: def?.name || id,
      nameEn: def?.nameEn || id,
      status,
      details,
      error,
      timestamp: Date.now(),
    };
  }

  /**
   * 执行启动检测
   * 在工作流正式执行前，检测各项准备状态
   */
  async performStartupChecks(
    workflowId: string,
    options?: {
      projectId?: string;
      skipChecks?: boolean;
    }
  ): Promise<StartupCheckResult> {
    console.log(`[WorkflowScheduler] Performing startup checks for workflow: ${workflowId}`);
    
    // ✅ 在检测前检查 AHIVECORE 是否启动
    try {
      const { getAHIVECoreService } = await import('../../services/ahivecore/AHIVECoreService');
      const ahivecoreService = getAHIVECoreService();
      
      if (!ahivecoreService.isConnected()) {
        console.warn('[WorkflowScheduler] AHIVECORE not connected, attempting to connect...');
        await ahivecoreService.checkConnection();
      }
    } catch (error) {
      console.error('[WorkflowScheduler] Failed to check AHIVECORE connection:', error);
    }
    
    // 获取工作流名称
    const workflow = this.config.getWorkflow(workflowId);
    const workflowName = workflow?.name || workflowId;
    
    const result: StartupCheckResult = {
      workflowId,
      workflowName,
      steps: [],
      canProceed: false,
      timestamp: Date.now(),
    };

    // 如果跳过检测，直接返回成功
    if (options?.skipChecks) {
      result.canProceed = true;
      result.steps = [
        this.createCheckStep('heartbeat', 'skipped', ['用户选择跳过启动检测']),
        this.createCheckStep('project-config', 'skipped', ['用户选择跳过启动检测']),
        this.createCheckStep('agent-status', 'skipped', ['用户选择跳过启动检测']),
        this.createCheckStep('context-inject', 'skipped', ['用户选择跳过启动检测']),
      ];
      this.broadcastStartupCheck(result);
      return result;
    }

    // 初始化所有步骤为 pending
    result.steps = this.CHECK_STEP_DEFINITIONS.map(def => 
      this.createCheckStep(def.id, 'pending', [])
    );
    this.broadcastStartupCheck(result);

    // 1. 心跳服务检测
    const heartbeatIndex = result.steps.findIndex(s => s.id === 'heartbeat');
    result.steps[heartbeatIndex] = this.createCheckStep('heartbeat', 'checking', ['检测 AHIVECORE 心跳服务状态...']);
    this.broadcastStartupCheck(result);
    
    const heartbeatCheck = await this.checkHeartbeatService();
    result.steps[heartbeatIndex] = heartbeatCheck;
    this.broadcastStartupCheck(result);

    // 2. 项目配置检测
    const configIndex = result.steps.findIndex(s => s.id === 'project-config');
    result.steps[configIndex] = this.createCheckStep('project-config', 'checking', ['检测项目配置文件...']);
    this.broadcastStartupCheck(result);
    
    const configCheck = await this.checkProjectConfig(workflowId);
    result.steps[configIndex] = configCheck;
    this.broadcastStartupCheck(result);

    // 3. Agent 状态检测（依赖心跳服务）
    const agentIndex = result.steps.findIndex(s => s.id === 'agent-status');
    if (heartbeatCheck.status === 'success') {
      result.steps[agentIndex] = this.createCheckStep('agent-status', 'checking', ['检测工作流相关 Agent 状态...']);
      this.broadcastStartupCheck(result);
      
      const agentCheck = await this.checkAgentStatus(workflowId);
      result.steps[agentIndex] = agentCheck;
      this.broadcastStartupCheck(result);

      // 4. 上下文注入检测（依赖 Agent 状态）
      const injectIndex = result.steps.findIndex(s => s.id === 'context-inject');
      if (agentCheck.status === 'success') {
        result.steps[injectIndex] = this.createCheckStep('context-inject', 'checking', ['检测上下文注入状态...']);
        this.broadcastStartupCheck(result);
        
        const injectCheck = await this.checkContextInjection(workflowId);
        result.steps[injectIndex] = injectCheck;
        this.broadcastStartupCheck(result);
      } else {
        result.steps[injectIndex] = this.createCheckStep('context-inject', 'skipped', ['Agent 状态检测未通过，跳过上下文注入检测']);
        this.broadcastStartupCheck(result);
      }
    } else {
      result.steps[agentIndex] = this.createCheckStep('agent-status', 'skipped', ['心跳服务未启动，跳过 Agent 状态检测']);
      result.steps[result.steps.findIndex(s => s.id === 'context-inject')] = this.createCheckStep('context-inject', 'skipped', ['心跳服务未启动，跳过上下文注入检测']);
      this.broadcastStartupCheck(result);
    }

    // 计算总体状态
    const allPassed = result.steps.every(s => s.status === 'success' || s.status === 'skipped' || s.status === 'warning');
    const anyFailed = result.steps.some(s => s.status === 'failed');
    
    result.canProceed = allPassed && !anyFailed;
    
    this.broadcastStartupCheck(result);
    
    console.log(`[WorkflowScheduler] Startup checks completed, canProceed: ${result.canProceed}`);
    
    return result;
  }

  /**
   * 检测心跳服务状态
   */
  private async checkHeartbeatService(): Promise<StartupCheckItem> {
    const check = this.createCheckStep('heartbeat', 'checking', ['检测 AHIVECORE 心跳服务状态...']);

    try {
      const { getAHIVECoreService } = await import('../../services/ahivecore/AHIVECoreService');
      const ahivecoreService = getAHIVECoreService();
      
      // 检查 AHIVECORE 是否已连接
      const isConnected = ahivecoreService.isConnected();
      
      if (isConnected) {
        check.status = 'success';
        check.details.push('✓ AHIVECORE 心跳服务已连接');
        // 不再发送测试心跳，由 checkContextInjection 的心跳来验证服务
      } else {
        check.status = 'failed';
        check.details.push('✗ AHIVECORE 心跳服务未连接');
        check.error = 'AHIVECORE 服务未启动或未连接';
      }
    } catch (error) {
      check.status = 'failed';
      check.details.push(`✗ 加载 AHIVECoreService 失败: ${error instanceof Error ? error.message : String(error)}`);
      check.error = error instanceof Error ? error.message : String(error);
    }

    check.timestamp = Date.now();
    return check;
  }

  /**
   * 检测项目配置
   * 同时会生成项目配置提示词文件（如果工作流有 variable 节点）
   */
  private async checkProjectConfig(workflowId: string): Promise<StartupCheckItem> {
    const check = this.createCheckStep('project-config', 'checking', ['检测项目配置文件...']);

    try {
      const { getProjectPromptMeta, getWorkflowDataDir } = await import('../../storage');
      const { getProjectPromptGenerator } = await import('../persistence/ProjectPromptGenerator');
      
      // 获取工作流
      const workflow = this.config.getWorkflow(workflowId);
      
      // ✅ 生成项目配置提示词（如果工作流有 variable 节点）
      if (workflow) {
        const promptGenerator = getProjectPromptGenerator(this.config.stateDir);
        const generatedFiles = promptGenerator.generateFromWorkflow(workflow);
        
        if (generatedFiles.length > 0) {
          check.details.push(`✓ 已生成项目配置提示词文件:`);
          for (const file of generatedFiles) {
            const fileName = path.basename(file);
            check.details.push(`  - ${fileName}`);
          }
        } else {
          check.details.push('ℹ 工作流中没有项目配置节点，跳过提示词生成');
        }
      }
      
      // 获取工作流数据目录
      const workflowDir = getWorkflowDataDir(workflowId);
      const publicPath = path.join(workflowDir, 'projectinfo_prompt.md');
      
      if (fs.existsSync(publicPath)) {
        const stat = fs.statSync(publicPath);
        const content = fs.readFileSync(publicPath, 'utf-8');
        const metadata = getProjectPromptMeta(workflowId);
        
        check.status = 'success';
        check.details.push(`✓ 公共配置文件存在`);
        check.details.push(`✓ 文件大小: ${stat.size} 字节`);
        check.details.push(`✓ 配置版本: v${metadata?.[0]?.version || 1}`);
        check.details.push(`✓ 最后修改: ${new Date(stat.mtime).toLocaleString()}`);
        
        // 检查内容是否有效
        if (content.trim().length > 0) {
          check.details.push(`✓ 配置内容有效 (${content.length} 字符)`);
        } else {
          check.details.push('⚠ 配置文件内容为空');
        }
      } else {
        check.status = 'warning';  // 配置文件不存在不是致命错误
        check.details.push(`⚠ 公共配置文件不存在`);
        check.details.push('提示: 可以在工作流执行期间创建配置文件');
      }
    } catch (error) {
      check.status = 'failed';
      check.details.push(`✗ 项目配置检测失败: ${error instanceof Error ? error.message : String(error)}`);
      check.error = error instanceof Error ? error.message : String(error);
    }

    check.timestamp = Date.now();
    return check;
  }

  /**
   * 检测 Agent 状态
   */
  private async checkAgentStatus(workflowId: string): Promise<StartupCheckItem> {
    const check = this.createCheckStep('agent-status', 'checking', ['检测工作流相关 Agent 状态...']);

    try {
      const workflow = this.config.getWorkflow(workflowId);
      if (!workflow) {
        check.status = 'failed';
        check.details.push('✗ 工作流不存在');
        check.error = 'Workflow not found';
        check.timestamp = Date.now();
        return check;
      }

      // 获取工作流中的 Agent 节点
      const agentNodes = workflow.nodes.filter(n => n.type === 'agent');
      
      if (agentNodes.length === 0) {
        check.status = 'warning';
        check.details.push('⚠ 工作流中没有 Agent 节点');
        check.timestamp = Date.now();
        return check;
      }

      check.details.push(`发现 ${agentNodes.length} 个 Agent 节点`);

      // 获取所有 Agent
      const allAgents = this.config.getAgents();
      check.details.push(`系统中已注册 Agent 数量: ${allAgents.length}`);
      
      // ✅ 检查 AHIVECORE 连接状态
      const { getAHIVECoreService } = await import('../../services/ahivecore/AHIVECoreService');
      const ahivecoreService = getAHIVECoreService();
      const isAHIVECOREConnected = ahivecoreService.isConnected();
      
      check.details.push(`AHIVECORE 连接状态: ${isAHIVECOREConnected ? '已连接' : '未连接'}`);
      
      // 收集问题详情
      const notFoundAgents: string[] = [];
      const offlineAgents: string[] = [];
      const onlineAgents: string[] = [];
      
      // 检查每个 Agent 节点对应的 Agent 状态
      let onlineCount = 0;
      let offlineCount = 0;
      
      for (const node of agentNodes) {
        const agentId = (node as any).config?.executor?.executors?.[0]?.id || node.id;
        const agent = allAgents.find(a => a.agentId === agentId || a.id === agentId);
        
        if (agent) {
          // ✅ 改进状态判断：如果 AHIVECORE 已连接，则认为 Agent 在线
          let status = agent.status || 'unknown';
          
          // 如果 Agent 是 AHIVECORE 类型且 AHIVECORE 已连接，强制设置为在线
          if (agent.agentType === 'ahivecore' || agent.protocolType === 'ahivecore') {
            if (isAHIVECOREConnected) {
              status = 'online';
            } else {
              status = 'offline';
            }
          }
          
          check.details.push(`  - ${node.name} (ID: ${agentId}): ${status}`);
          
          if (status === 'online' || status === 'idle' || status === 'busy') {
            onlineCount++;
            onlineAgents.push(node.name);
          } else {
            offlineCount++;
            offlineAgents.push(`${node.name} (状态: ${status})`);
            check.details.push(`    ⚠ Agent 状态异常`);
          }
        } else {
          // ⚠️ 找不到 Agent 配置，应该警告
          offlineCount++;
          notFoundAgents.push(agentId);
          check.details.push(`  - ${node.name} (ID: ${agentId}): ⚠ 未在系统中找到`);
        }
      }

      // 判断检测结果 - 添加详细提示
      if (offlineCount === 0) {
        check.status = 'success';
        check.details.push(`✓ 所有 Agent (${onlineCount}/${agentNodes.length}) 状态正常`);
      } else if (onlineCount > 0) {
        check.status = 'warning';
        check.details.push(`⚠ 部分 Agent 状态异常: ${onlineCount} 正常, ${offlineCount} 异常`);
        
        // 添加详细问题说明
        if (notFoundAgents.length > 0) {
          check.details.push(`--- 未找到的 Agent ---`);
          check.details.push(`  以下 Agent ID 在系统中不存在: ${notFoundAgents.join(', ')}`);
          check.details.push(`  解决方法: 在 Agent 管理中添加这些 Agent，或修改工作流节点配置`);
        }
        if (offlineAgents.length > 0) {
          check.details.push(`--- 离线的 Agent ---`);
          check.details.push(`  ${offlineAgents.join(', ')}`);
          check.details.push(`  解决方法: 检查 AHIVECORE 连接或 Agent 服务状态`);
        }
      } else {
        check.status = 'failed';
        check.details.push(`✗ 所有 Agent 状态异常 (${offlineCount}/${agentNodes.length})`);
        
        // 添加详细问题说明
        if (notFoundAgents.length > 0) {
          check.details.push(`--- 未找到的 Agent ---`);
          check.details.push(`  以下 Agent ID 在系统中不存在:`);
          notFoundAgents.forEach(id => check.details.push(`    • ${id}`));
          check.details.push(`  解决方法: 在 Agent 管理中添加这些 Agent，或修改工作流节点配置`);
        }
        if (offlineAgents.length > 0) {
          check.details.push(`--- 离线的 Agent ---`);
          offlineAgents.forEach(a => check.details.push(`    • ${a}`));
          check.details.push(`  解决方法: 检查 AHIVECORE 连接或 Agent 服务状态`);
        }
        
        // 设置详细错误信息
        const errorParts: string[] = [];
        if (notFoundAgents.length > 0) errorParts.push(`未找到: ${notFoundAgents.join(', ')}`);
        if (offlineAgents.length > 0) errorParts.push(`离线: ${offlineAgents.length}个`);
        check.error = errorParts.join('; ');
      }
    } catch (error) {
      check.status = 'failed';
      check.details.push(`✗ Agent 状态检测失败: ${error instanceof Error ? error.message : String(error)}`);
      check.error = error instanceof Error ? error.message : String(error);
    }

    check.timestamp = Date.now();
    return check;
  }

  /**
   * 检测上下文注入准备状态
   * 注意：此方法只检测准备状态，不实际注入上下文
   * 实际注入在工作流真正启动时执行（executeWorkflowWithChecks 中）
   */
  private async checkContextInjection(workflowId: string): Promise<StartupCheckItem> {
    const check = this.createCheckStep('context-inject', 'checking', ['检测上下文注入准备状态...']);

    try {
      const { getWorkflowDataDir } = await import('../../storage');
      
      // ✅ 只检测配置文件是否存在，不实际注入
      const workflowDir = getWorkflowDataDir(workflowId);
      
      // 检查公共配置文件
      const publicPath = path.join(workflowDir, 'projectinfo_prompt.md');
      const publicExists = fs.existsSync(publicPath);
      
      // 获取工作流中的 Agent 节点
      const workflow = this.config.getWorkflow(workflowId);
      const agentNodes = workflow?.nodes.filter(n => n.type === 'agent') || [];
      
      // 检查专用配置文件
      const privateFiles: string[] = [];
      for (const node of agentNodes) {
        const agentId = (node as any).config?.executor?.executors?.[0]?.id || node.id;
        const privatePath = path.join(workflowDir, `projectinfo_${agentId}_prompt.md`);
        if (fs.existsSync(privatePath)) {
          privateFiles.push(agentId);
        }
      }
      
      // 检测 AHIVECORE 连接状态（注入通道是否可用）
      const { getAHIVECoreService } = await import('../../services/ahivecore/AHIVECoreService');
      const ahivecoreService = getAHIVECoreService();
      const isConnected = ahivecoreService.isConnected();
      
      check.details.push(`公共配置文件: ${publicExists ? '✓ 存在' : '⚠ 不存在'}`);
      check.details.push(`专用配置文件: ${privateFiles.length > 0 ? `✓ ${privateFiles.length} 个` : '⚠ 无'}`);
      check.details.push(`注入通道: ${isConnected ? '✓ AHIVECORE 已连接' : '✗ AHIVECORE 未连接'}`);
      
      // 判断状态：只要通道可用就算准备就绪（配置文件可以在运行时动态加载）
      if (isConnected) {
        check.status = 'success';
        check.details.push('✓ 上下文注入准备就绪');
        check.details.push('ℹ 实际注入将在工作流启动时执行');
      } else {
        check.status = 'failed';
        check.details.push('✗ AHIVECORE 未连接，无法注入上下文');
        check.error = 'AHIVECORE not connected';
      }
    } catch (error) {
      check.status = 'failed';
      check.details.push(`✗ 上下文注入检测失败: ${error instanceof Error ? error.message : String(error)}`);
      check.error = error instanceof Error ? error.message : String(error);
    }

    check.timestamp = Date.now();
    return check;
  }

  /**
   * 广播启动检测状态
   */
  private broadcastStartupCheck(result: StartupCheckResult): void {
    // ✅ 修复消息格式，符合前端期望的 { type: 'event', payload: { type: '...', ... } } 格式
    this.config.wsServer.broadcastAll({
      type: 'event',
      payload: {
        type: 'workflow-startup-check',
        agentId: 'workflow-scheduler',
        timestamp: Date.now(),
        data: result,
      }
    });
  }

  /**
   * 执行工作流（带启动检测）
   */
  async execute(
    workflowId: string,
    variables?: Record<string, unknown>,
    options?: {
      projectId?: string;
      triggeredBy?: string;
      skipChecks?: boolean;  // 是否跳过启动检测
    }
  ): Promise<{ instanceId: string; success: boolean; error?: string; startupCheck?: StartupCheckResult }> {
    // 先执行启动检测
    const startupCheck = await this.performStartupChecks(workflowId, options);
    
    // 如果检测未通过，返回错误
    if (!startupCheck.canProceed) {
      console.error(`[WorkflowScheduler] Startup checks failed for workflow: ${workflowId}`);
      return { 
        instanceId: '', 
        success: false, 
        error: 'Startup checks failed',
        startupCheck 
      };
    }

    const workflow = this.config.getWorkflow(workflowId);
    
    if (!workflow) {
      console.error(`[WorkflowScheduler] Workflow not found: ${workflowId}`);
      return { instanceId: '', success: false, error: 'Workflow not found', startupCheck };
    }

    const agents = this.config.getAgents();

    // 生成实例 ID
    const instanceId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // 使用 WorkflowStateDB 创建实例（如果可用）
    log.info('[WorkflowScheduler] stateDB available:', !!this.config.stateDB);
    if (this.config.stateDB) {
      log.info('[WorkflowScheduler] Creating instance in database:', instanceId);
      this.config.stateDB.createInstance({
        instanceId,
        workflowId,
        workflowName: workflow.name,
        projectId: options?.projectId,
        status: 'running',
        startedAt: new Date().toISOString(),
        currentNodeId: '',
        currentNodeName: '',
        executionPath: [],
        variables: variables || {},
        triggeredBy: options?.triggeredBy || 'manual',
        updatedAt: new Date().toISOString(),
      });
      log.info('[WorkflowScheduler] Instance created in database');
    } else {
      log.warn('[WorkflowScheduler] stateDB not available, skipping database creation');
    }

    // 创建指挥官通信通道
    const commanderChannel = new CommanderChannel({
      wsServer: this.config.wsServer,
      instanceId,
      workflowId,
      projectId: options?.projectId,
      onMessage: (message) => this.handleCommanderMessage(instanceId, message),
    });

    // 创建工作流引擎
    const engine = new WorkflowEngine({
      workflow,
      agents,
      callAgent: this.config.callAgent,
      broadcast: (event) => this.handleWorkflowEvent(instanceId, event),
      stateDir: this.config.stateDir,
      stateDB: this.config.stateDB,
      instanceId, // 传递 instanceId，避免重复生成
      commanderConfig: {
        wsServer: this.config.wsServer,
        instanceId,
        workflowId,
        projectId: options?.projectId,
      },
    });

    // 注册实例（不再需要 stateManager）
    this.instances.set(instanceId, {
      engine,
      stateManager: null as any, // 保留字段但设为 null
      commanderChannel,
      startedAt: Date.now(),
      lastPollAt: Date.now(),
    });
    
    console.log(`[WorkflowScheduler] Starting workflow: ${workflow.name} (${instanceId})`);
    
    // ✅ 实际注入上下文（在真正启动时执行）
    await this.injectProjectContext(workflowId, instanceId);
    
    // 异步执行
    engine.start(variables).then(result => {
      console.log(`[WorkflowScheduler] Workflow ${instanceId} completed: ${result.success}`);
      
      // 执行完成后延迟清理
      setTimeout(() => {
        this.cleanupInstance(instanceId);
      }, 60000); // 保留1分钟供查询
    }).catch(error => {
      console.error(`[WorkflowScheduler] Workflow ${instanceId} error:`, error);
      
      // 广播错误事件到 UI
      this.config.wsServer.broadcastAll({
        type: 'workflow-error',
        agentId: 'workflow-scheduler',
        timestamp: Date.now(),
        data: {
          instanceId,
          workflowId: instance.engine.getContext().workflowId,
          workflowName: instance.engine.getContext().workflowName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      
      this.cleanupInstance(instanceId);
    });
    
    return { instanceId, success: true };
  }
  
  /**
   * 暂停工作流
   */
  async pause(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    
    instance.engine.pause();
    
    // stateManager 已废弃，跳过持久化
    if (instance.stateManager) {
      await instance.stateManager.updateNodeStatus(
        instance.engine.getCurrentNodeId(),
        'paused'
      );
    }
    
    return true;
  }
  
  /**
   * 恢复工作流
   */
  async resume(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    
    instance.engine.resume();
    
    // stateManager 已废弃，跳过持久化
    if (instance.stateManager) {
      await instance.stateManager.updateNodeStatus(
        instance.engine.getCurrentNodeId(),
        'running'
      );
    }
    
    return true;
  }
  
  /**
   * 停止工作流实例
   */
  async stopWorkflow(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    
    await instance.engine.stop();
    
    // stateManager 已废弃，跳过持久化
    if (instance.stateManager) {
      await instance.stateManager.updateStatus('failed', 'Stopped by user');
    }
    
    this.cleanupInstance(instanceId);
    
    return true;
  }
  
  /**
   * 获取执行状态
   */
  getState(instanceId: string): ExecutionContext | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    
    return instance.engine.getContext();
  }
  
  /**
   * 获取完整执行状态（包括持久化数据）
   */
  async getFullState(instanceId: string): Promise<WorkflowExecutionState | null> {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    
    if (instance.stateManager) {
      return instance.stateManager.getState();
    }
    // stateManager 已废弃，从 engine context 返回状态
    return null;
  }
  
  /**
   * 获取黑板变量
   */
  getVariables(instanceId: string): Record<string, unknown> | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    
    return instance.engine.getBlackboard().export().variables;
  }
  
  /**
   * 提交审核结果
   */
  async submitReview(
    instanceId: string,
    nodeId: string,
    result: ReviewResult
  ): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    
    // 更新黑板变量
    instance.engine.getBlackboard().setVariable(`${nodeId}:reviewResult`, result, {
      owner: instanceId,
    });
    
    // 保存状态
    if (instance.stateManager) {
      await instance.stateManager.setVariable(`${nodeId}:reviewResult`, result);
    }
    
    // 如果在等待审核状态，恢复执行
    const context = instance.engine.getContext();
    if (context.status === 'waiting_review') {
      instance.engine.resume();
    }
    
    return true;
  }
  
  /**
   * 获取所有活跃实例
   */
  getActiveInstances(): ExecutionContext[] {
    return Array.from(this.instances.values()).map(i => i.engine.getContext());
  }
  
  /**
   * 获取活跃实例数量
   */
  getActiveCount(): number {
    return this.instances.size;
  }
  
  /**
   * 获取工作流定义（公开方法，供 WebSocketServer 调用）
   */
  getWorkflow(workflowId: string): Workflow | undefined {
    return this.config.getWorkflow(workflowId);
  }
  
  /**
   * 处理工作流事件
   * 直接广播原始事件类型，让前端能正确订阅
   */
  private handleWorkflowEvent(instanceId: string, event: WorkflowEvent): void {
    // 直接广播原始事件（添加 instanceId）
    // broadcastAll 会自动包装成 { type: 'event', payload: event }
    // 所以这里直接传 StreamEvent 格式的事件对象
    const broadcastEvent = {
      ...event,
      instanceId,
      agentId: 'workflow-scheduler',
      timestamp: event.timestamp || Date.now(),
    };
    
    // 直接调用 broadcastAll，它会自动包装
    this.config.wsServer.broadcastAll(broadcastEvent);
    
    console.log(`[WorkflowScheduler] Broadcast event: ${event.type}, nodeId: ${event.nodeId || 'N/A'}`);
    
    // 调用注册的事件处理器
    const handler = this.eventHandlers.get(instanceId);
    if (handler) {
      handler(event);
    }
  }
  
  /**
   * 处理指挥官消息
   */
  private async handleCommanderMessage(
    instanceId: string,
    message: CommanderMessage
  ): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    
    console.log(`[WorkflowScheduler] Commander message for ${instanceId}:`, message.type);
    
    switch (message.type) {
      case 'task-response':
        // Agent 汇报工作进度
        await instance.stateManager.updateAgentProgress(
          message.payload.agentId,
          message.payload.progress,
          message.payload.status
        );
        break;
        
      case 'task-complete':
        // Agent 完成任务
        await instance.stateManager.completeNode(
          instance.engine.getCurrentNodeId(),
          message.payload.output
        );
        break;
        
      case 'task-error':
        // Agent 任务失败
        await instance.stateManager.failNode(
          instance.engine.getCurrentNodeId(),
          message.payload.error
        );
        break;
        
      case 'agent-status':
        // Agent 状态更新
        await instance.stateManager.updateAgentStatus(
          message.payload.agentId,
          message.payload.status,
          message.payload.animation
        );
        break;
    }
  }
  
  /**
   * 启动定时询问
   */
  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.pollRunningInstances();
    }, this.config.pollInterval);
  }
  
  /**
   * 询问运行中的实例
   */
  private async pollRunningInstances(): Promise<void> {
    for (const [instanceId, instance] of this.instances) {
      const context = instance.engine.getContext();
      
      // 只询问运行中的实例
      if (context.status !== 'running') continue;
      
      // 检查是否需要询问
      const now = Date.now();
      if (now - instance.lastPollAt < this.config.pollInterval) continue;
      
      instance.lastPollAt = now;
      
      // 通过指挥官通道询问 Agent 状态
      const currentNodeId = instance.engine.getCurrentNodeId();
      const currentNode = instance.engine.getNode(currentNodeId);
      
      if (currentNode) {
        await instance.commanderChannel.pollAgentStatus(
          currentNode.agentId || currentNode.id,
          {
            nodeId: currentNodeId,
            nodeName: currentNode.name,
            taskBrief: currentNode.description || currentNode.name,
          }
        );
      }
    }
  }
  
  /**
   * 启动心跳检测
   * - 检查实例健康状态
   * - 发送心跳到 AHIVECORE（包含项目配置元数据）
   */
  private startHeartbeat(): void {
    console.log(`[WorkflowScheduler] Starting heartbeat timer with interval: ${this.config.heartbeatInterval}ms`);
    
    this.heartbeatTimer = setInterval(async () => {
      console.log(`[WorkflowScheduler] Heartbeat tick, instances count: ${this.instances.size}`);
      
      this.checkInstanceHealth();
      
      // 发送心跳到 AHIVECORE
      await this.sendHeartbeatToAHIVECORE();
    }, this.config.heartbeatInterval);
  }
  
  /**
   * 检查实例健康状态
   */
  private checkInstanceHealth(): void {
    const now = Date.now();
    const timeout = this.config.heartbeatInterval * 3;
    
    for (const [instanceId, instance] of this.instances) {
      // 检查是否超时
      if (now - instance.lastPollAt > timeout) {
        console.warn(`[WorkflowScheduler] Instance ${instanceId} heartbeat timeout`);
        
        // 标记为可能中断
        if (instance.stateManager) {
          instance.stateManager.updateStatus('paused', 'Heartbeat timeout');
        }
      }
    }
  }
  
  /**
   * 发送心跳到 AHIVECORE
   * 包含工作流状态和项目配置文件元数据
   */
  private async sendHeartbeatToAHIVECORE(): Promise<void> {
    // 导入 storage.ts 中的 sendHeartbeatToAHIVECORE 函数
    const { sendHeartbeatToAHIVECORE } = await import('../../storage');
    
    console.log(`[WorkflowScheduler] sendHeartbeatToAHIVECORE called, instances: ${this.instances.size}`);
    
    // 为每个运行中的工作流发送心跳
    for (const [instanceId, instance] of this.instances) {
      console.log(`[WorkflowScheduler] Processing instance: ${instanceId}`);
      const context = instance.engine.getContext();
      
      // 发送心跳
      try {
        const response = await sendHeartbeatToAHIVECORE(context.workflowId, context.status);
        
        if (response.success) {
          console.log(`[WorkflowScheduler] Heartbeat sent for workflow ${context.workflowId}`);
          
          // 处理返回的 Agent 状态
          if (response.agents) {
            this.handleAgentStatusResponse(instance, response.agents);
          }
        } else {
          console.warn(`[WorkflowScheduler] Heartbeat failed for workflow ${context.workflowId}`);
        }
      } catch (error) {
        console.error(`[WorkflowScheduler] Heartbeat error:`, error);
      }
    }
  }
  
  /**
   * 处理 AHIVECORE 返回的 Agent 状态
   */
  private handleAgentStatusResponse(
    instance: ExecutionInstance,
    agents: Array<{ agentId: string; status: string; hasTask: boolean }>
  ): void {
    for (const agent of agents) {
      // 如果 Agent 闲置且有任务，触发询问
      if (agent.status === 'idle' && agent.hasTask) {
        console.log(`[WorkflowScheduler] Agent ${agent.agentId} idle with task, triggering inquiry`);
        
        // 通过指挥官通道唤醒 Agent
        const currentNodeId = instance.engine.getCurrentNodeId();
        const currentNode = instance.engine.getNode(currentNodeId);
        
        if (currentNode) {
          instance.commanderChannel.wakeupAgent(
            agent.agentId,
            currentNode.description || currentNode.name,
            undefined,
            instance.engine.getContext().projectPath
          );
        }
      }
    }
  }
  
  /**
   * 恢复中断的工作流
   */
  private async recoverInterrupted(): Promise<void> {
    console.log('[WorkflowScheduler] Checking for interrupted workflows...');
    
    const interrupted = await this.recovery.findInterrupted();
    console.log(`[WorkflowScheduler] Found ${interrupted.length} interrupted workflows`);
    
    // ⚠️ 暂时禁用中断恢复，避免启动时循环创建实例
    // TODO: 实现更智能的恢复策略，限制恢复数量
    if (interrupted.length > 0) {
      console.log('[WorkflowScheduler] Interrupt recovery is currently disabled');
      console.log('[WorkflowScheduler] Please manually clean up state files if needed:');
      console.log('[WorkflowScheduler]   - ./data/workflow-states/executions/*');
      console.log('[WorkflowScheduler]   - ./data/workflow-states/logs/*');
    }
    
    // for (const state of interrupted) {
    //   console.log(`[WorkflowScheduler] Recovering workflow: ${state.instanceId}`);
    //   
    //   // 恢复执行（跳过启动检测）
    //   await this.execute(
    //     state.workflowId,
    //     state.variables,
    //     {
    //       projectId: state.projectId,
    //       triggeredBy: 'recovery',
    //       skipChecks: true,
    //     }
    //   );
    // }
  }
  
  /**
   * 注入项目配置上下文到 Agent
   * 在工作流真正启动时执行，避免检测阶段污染 Agent 上下文
   * 
   * 重要：必须等待所有相关 Agent 确认配置已接收，才能让工作流引擎发布第一个任务
   */
  private async injectProjectContext(workflowId: string, instanceId: string): Promise<void> {
    console.log(`[WorkflowScheduler] Injecting project context for workflow: ${workflowId}, instance: ${instanceId}`);
    
    try {
      const { getWorkflowDataDir, sendHeartbeatToAHIVECORE } = await import('../../storage');
      const workflowDir = getWorkflowDataDir(workflowId);
      
      // 检查配置文件是否存在
      const publicPath = path.join(workflowDir, 'projectinfo_prompt.md');
      if (!fs.existsSync(publicPath)) {
        console.log(`[WorkflowScheduler] No project config file found, skipping injection`);
        return;
      }
      
      // 获取工作流中参与的 Agent 列表
      const workflow = this.config.getWorkflow(workflowId);
      const agentNodes = workflow?.nodes.filter(n => n.type === 'agent') || [];
      const participatingAgentIds = agentNodes.map(node => 
        (node as any).config?.executor?.executors?.[0]?.id || node.id
      );
      
      console.log(`[WorkflowScheduler] Participating agents: ${participatingAgentIds.join(', ')}`);
      
      // 发送心跳，触发上下文注入
      const heartbeatResponse = await sendHeartbeatToAHIVECORE(workflowId, 'running');
      
      if (!heartbeatResponse.success) {
        console.warn(`[WorkflowScheduler] ⚠️ Project context injection failed`);
        // 注入失败不阻止工作流启动，但记录警告
        return;
      }
      
      console.log(`[WorkflowScheduler] ✅ Heartbeat sent, waiting for agents to confirm config received...`);
      
      // ✅ 等待所有相关 Agent 确认配置已接收（最多等待 10 秒）
      const maxWaitTime = 10000; // 10 秒
      const checkInterval = 500; // 每 500ms 检查一次
      const startTime = Date.now();
      
      let allAgentsReady = false;
      
      while (!allAgentsReady && (Date.now() - startTime) < maxWaitTime) {
        // 再次发送心跳检查 Agent 状态
        const statusCheck = await sendHeartbeatToAHIVECORE(workflowId, 'running');
        
        if (statusCheck.success && statusCheck.agents) {
          // 检查所有参与的 Agent 是否都已准备好
          const readyAgents = statusCheck.agents.filter(a => 
            a.status === 'active' || a.status === 'idle' || a.hasTask === false
          );
          
          // 检查参与的 Agent 是否都在 readyAgents 中
          const participatingReady = participatingAgentIds.every(agentId => 
            readyAgents.some(ra => ra.agentId === agentId)
          );
          
          if (participatingReady || participatingAgentIds.length === 0) {
            allAgentsReady = true;
            console.log(`[WorkflowScheduler] ✅ All participating agents are ready`);
            break;
          }
          
          console.log(`[WorkflowScheduler] Waiting for agents... Ready: ${readyAgents.length}/${statusCheck.agents.length}`);
        }
        
        // 等待下一次检查
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      if (!allAgentsReady) {
        console.warn(`[WorkflowScheduler] ⚠️ Timeout waiting for agents to be ready, proceeding anyway`);
      }
      
      // 广播注入成功事件
      this.config.wsServer.broadcastAll({
        type: 'event',
        payload: {
          type: 'context-injected',
          agentId: 'workflow-scheduler',
          timestamp: Date.now(),
          data: {
            workflowId,
            instanceId,
            agents: heartbeatResponse.agents || [],
            allAgentsReady,
          },
        },
      });
      
      console.log(`[WorkflowScheduler] ✅ Project context injection completed, workflow can now start`);
    } catch (error) {
      console.error(`[WorkflowScheduler] Failed to inject project context:`, error);
      // 注入失败不阻止工作流启动，只是警告
    }
  }
  
  /**
   * 清理实例
   */
  private cleanupInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.commanderChannel.destroy();
      this.instances.delete(instanceId);
    }
  }
  
  /**
   * 注册事件处理器
   */
  onWorkflowEvent(instanceId: string, handler: (event: WorkflowEvent) => void): void {
    this.eventHandlers.set(instanceId, handler);
  }
  
  /**
   * 移除事件处理器
   */
  offWorkflowEvent(instanceId: string): void {
    this.eventHandlers.delete(instanceId);
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    activeCount: number;
    totalStarted: number;
    uptime: number;
  } {
    return {
      activeCount: this.instances.size,
      totalStarted: 0, // TODO: 持久化统计
      uptime: Date.now(),
    };
  }
}
