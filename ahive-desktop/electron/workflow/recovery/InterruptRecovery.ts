/**
 * 中断恢复模块
 * 负责工作流中断后的恢复
 */

import * as fs from 'fs';
import * as path from 'path';
import { StateManager, WorkflowExecutionState } from '../persistence/StateManager';
import { WorkflowEngine, WorkflowEngineConfig } from '../core/WorkflowEngine';

/**
 * 恢复点信息
 */
export interface RecoveryPoint {
  instanceId: string;
  workflowId: string;
  nodeId: string;
  nodeName: string;
  timestamp: string;
  status: 'paused' | 'interrupted' | 'error';
  canRecover: boolean;
  error?: string;
}

/**
 * 恢复结果
 */
export interface RecoveryResult {
  success: boolean;
  instanceId: string;
  recoveredFrom: RecoveryPoint;
  message: string;
}

/**
 * 中断恢复器配置
 */
export interface InterruptRecoveryConfig {
  stateManager: StateManager;
  dataDir: string;
  autoRecoverOnStart?: boolean;
}

/**
 * 中断恢复器
 */
export class InterruptRecovery {
  private stateManager: StateManager;
  private dataDir: string;
  private autoRecoverOnStart: boolean;
  private recoveryPoints: Map<string, RecoveryPoint> = new Map();

  constructor(config: InterruptRecoveryConfig) {
    this.stateManager = config.stateManager;
    this.dataDir = config.dataDir;
    this.autoRecoverOnStart = config.autoRecoverOnStart ?? false;

    // 确保 recovery 目录存在
    this.ensureRecoveryDir();
  }

  /**
   * 确保恢复目录存在
   */
  private ensureRecoveryDir(): void {
    const recoveryDir = path.join(this.dataDir, 'recovery');
    if (!fs.existsSync(recoveryDir)) {
      fs.mkdirSync(recoveryDir, { recursive: true });
    }
  }

  /**
   * 扫描所有可恢复的工作流
   */
  scanRecoverableWorkflows(): RecoveryPoint[] {
    const recoveryPoints: RecoveryPoint[] = [];

    // 从状态管理器获取所有未完成的执行状态
    const allStates = this.stateManager.getAllExecutionStates();

    for (const state of allStates) {
      // 只恢复中断或暂停状态的工作流
      if (state.status === 'running' || state.status === 'paused' || state.status === 'interrupted') {
        const recoveryPoint: RecoveryPoint = {
          instanceId: state.instanceId,
          workflowId: state.workflowId,
          nodeId: state.currentNodeId || '',
          nodeName: state.currentNodeName || '',
          timestamp: state.lastUpdatedAt,
          status: state.status === 'paused' ? 'paused' : 'interrupted',
          canRecover: true,
        };

        recoveryPoints.push(recoveryPoint);
        this.recoveryPoints.set(state.instanceId, recoveryPoint);
      }
    }

    console.log(`[InterruptRecovery] Found ${recoveryPoints.length} recoverable workflows`);
    return recoveryPoints;
  }

  /**
   * 获取恢复点
   */
  getRecoveryPoint(instanceId: string): RecoveryPoint | undefined {
    return this.recoveryPoints.get(instanceId);
  }

  /**
   * 恢复工作流
   */
  async recoverWorkflow(
    instanceId: string,
    engineConfig: Omit<WorkflowEngineConfig, 'workflowId' | 'instanceId'>
  ): Promise<RecoveryResult> {
    const recoveryPoint = this.recoveryPoints.get(instanceId);

    if (!recoveryPoint) {
      // 尝试从状态文件恢复
      const state = this.stateManager.loadExecutionState(instanceId);
      if (!state) {
        return {
          success: false,
          instanceId,
          recoveredFrom: recoveryPoint!,
          message: 'No recovery point found',
        };
      }

      // 重建恢复点
      this.recoveryPoints.set(instanceId, {
        instanceId: state.instanceId,
        workflowId: state.workflowId,
        nodeId: state.currentNodeId,
        nodeName: state.nodeName || '',
        timestamp: state.updatedAt,
        status: state.status === 'paused' ? 'paused' : 'interrupted',
        canRecover: true,
      });
    }

    const point = this.recoveryPoints.get(instanceId)!;

    try {
      // 创建新的引擎实例
      const engine = new WorkflowEngine({
        ...engineConfig,
        workflowId: point.workflowId,
        instanceId: point.instanceId,
      });

      // 从恢复点恢复
      await engine.recoverFromInterrupt(point.nodeId);

      // 移除恢复点
      this.recoveryPoints.delete(instanceId);

      return {
        success: true,
        instanceId,
        recoveredFrom: point,
        message: `Workflow recovered from node: ${point.nodeName}`,
      };
    } catch (error) {
      console.error(`[InterruptRecovery] Failed to recover workflow ${instanceId}:`, error);

      return {
        success: false,
        instanceId,
        recoveredFrom: point,
        message: `Recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 保存恢复点
   */
  saveRecoveryPoint(
    instanceId: string,
    workflowId: string,
    nodeId: string,
    nodeName: string,
    status: 'paused' | 'interrupted' | 'error',
    error?: string
  ): void {
    const recoveryPoint: RecoveryPoint = {
      instanceId,
      workflowId,
      nodeId,
      nodeName,
      timestamp: new Date().toISOString(),
      status,
      canRecover: status !== 'error',
      error,
    };

    this.recoveryPoints.set(instanceId, recoveryPoint);

    // 同时保存到文件
    const recoveryFile = path.join(this.dataDir, 'recovery', `${instanceId}.json`);
    fs.writeFileSync(recoveryFile, JSON.stringify(recoveryPoint, null, 2), 'utf-8');

    console.log(`[InterruptRecovery] Saved recovery point: ${instanceId} at node ${nodeName}`);
  }

  /**
   * 删除恢复点
   */
  deleteRecoveryPoint(instanceId: string): void {
    this.recoveryPoints.delete(instanceId);

    const recoveryFile = path.join(this.dataDir, 'recovery', `${instanceId}.json`);
    if (fs.existsSync(recoveryFile)) {
      fs.unlinkSync(recoveryFile);
    }

    console.log(`[InterruptRecovery] Deleted recovery point: ${instanceId}`);
  }

  /**
   * 清理过期的恢复点
   */
  cleanupExpiredRecoveryPoints(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    this.recoveryPoints.forEach((point, instanceId) => {
      const age = now - new Date(point.timestamp).getTime();
      if (age > maxAge) {
        expiredIds.push(instanceId);
      }
    });

    for (const instanceId of expiredIds) {
      this.deleteRecoveryPoint(instanceId);
    }

    console.log(`[InterruptRecovery] Cleaned up ${expiredIds.length} expired recovery points`);
  }

  /**
   * 获取所有恢复点
   */
  getAllRecoveryPoints(): RecoveryPoint[] {
    return Array.from(this.recoveryPoints.values());
  }

  /**
   * 检查是否有可恢复的工作流
   */
  hasRecoverableWorkflows(): boolean {
    return this.recoveryPoints.size > 0;
  }

  /**
   * 查找中断的工作流（WorkflowScheduler 调用）
   */
  async findInterrupted(): Promise<WorkflowExecutionState[]> {
    const recoveryPoints = this.scanRecoverableWorkflows();
    const states: WorkflowExecutionState[] = [];
    
    for (const point of recoveryPoints) {
      const state = this.stateManager.loadExecutionState(point.instanceId);
      if (state) {
        states.push(state);
      }
    }
    
    return states;
  }

  /**
   * 自动恢复所有工作流
   */
  async autoRecoverAll(
    createEngine: (workflowId: string, instanceId: string) => WorkflowEngine
  ): Promise<RecoveryResult[]> {
    const results: RecoveryResult[] = [];
    const points = this.getAllRecoveryPoints();

    for (const point of points) {
      try {
        const engine = createEngine(point.workflowId, point.instanceId);
        await engine.recoverFromInterrupt(point.nodeId);

        results.push({
          success: true,
          instanceId: point.instanceId,
          recoveredFrom: point,
          message: `Recovered from node: ${point.nodeName}`,
        });

        this.recoveryPoints.delete(point.instanceId);
      } catch (error) {
        results.push({
          success: false,
          instanceId: point.instanceId,
          recoveredFrom: point,
          message: `Recovery failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return results;
  }
}