/**
 * 动态节点状态存储
 * 
 * 管理动态节点的状态持久化
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DynamicNodeState } from './types';

/**
 * 动态节点状态存储
 */
export class DynamicNodeStateStore {
  private stateDir: string;
  
  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.ensureDir();
  }
  
  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }
  
  /**
   * 获取状态文件路径
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   * @param nodeId 节点ID
   */
  private getStateFilePath(workflowId: string, instanceId: string, nodeId: string): string {
    const dir = path.join(this.stateDir, workflowId, instanceId, 'dynamic-nodes');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, `${nodeId}.json`);
  }
  
  /**
   * 获取实例目录路径
   */
  private getInstanceDir(workflowId: string, instanceId: string): string {
    return path.join(this.stateDir, workflowId, instanceId, 'dynamic-nodes');
  }
  
  /**
   * 保存动态节点状态
   * @param state 节点状态
   */
  async save(state: DynamicNodeState): Promise<void> {
    const filePath = this.getStateFilePath(state.workflowId, state.instanceId, state.nodeId);
    const data = JSON.stringify(state, null, 2);
    await fs.promises.writeFile(filePath, data, 'utf-8');
  }
  
  /**
   * 加载动态节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   * @param nodeId 节点ID
   */
  async load(workflowId: string, instanceId: string, nodeId: string): Promise<DynamicNodeState | null> {
    const filePath = this.getStateFilePath(workflowId, instanceId, nodeId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as DynamicNodeState;
    } catch (error) {
      console.error(`[DynamicNodeStateStore] Failed to load state: ${filePath}`, error);
      return null;
    }
  }
  
  /**
   * 加载工作流实例的所有动态节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   */
  async loadAll(workflowId: string, instanceId: string): Promise<DynamicNodeState[]> {
    const dir = this.getInstanceDir(workflowId, instanceId);
    
    if (!fs.existsSync(dir)) {
      return [];
    }
    
    const files = await fs.promises.readdir(dir);
    const states: DynamicNodeState[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(dir, file);
        try {
          const data = await fs.promises.readFile(filePath, 'utf-8');
          states.push(JSON.parse(data) as DynamicNodeState);
        } catch (error) {
          console.error(`[DynamicNodeStateStore] Failed to load: ${filePath}`, error);
        }
      }
    }
    
    return states;
  }
  
  /**
   * 加载指定父节点的所有动态节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   * @param parentNodeId 父节点ID
   */
  async loadByParent(
    workflowId: string,
    instanceId: string,
    parentNodeId: string
  ): Promise<DynamicNodeState[]> {
    const allStates = await this.loadAll(workflowId, instanceId);
    return allStates.filter(s => s.parentNodeId === parentNodeId);
  }
  
  /**
   * 删除动态节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   * @param nodeId 节点ID
   */
  async delete(workflowId: string, instanceId: string, nodeId: string): Promise<void> {
    const filePath = this.getStateFilePath(workflowId, instanceId, nodeId);
    
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
  
  /**
   * 清理工作流实例的所有动态节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   */
  async clear(workflowId: string, instanceId: string): Promise<void> {
    const dir = this.getInstanceDir(workflowId, instanceId);
    
    if (fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
  
  /**
   * 更新节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   * @param nodeId 节点ID
   * @param updates 更新内容
   */
  async update(
    workflowId: string,
    instanceId: string,
    nodeId: string,
    updates: Partial<DynamicNodeState>
  ): Promise<DynamicNodeState | null> {
    const state = await this.load(workflowId, instanceId, nodeId);
    
    if (!state) {
      return null;
    }
    
    const updatedState: DynamicNodeState = {
      ...state,
      ...updates,
    };
    
    await this.save(updatedState);
    return updatedState;
  }
  
  /**
   * 检查节点状态是否存在
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   * @param nodeId 节点ID
   */
  async exists(workflowId: string, instanceId: string, nodeId: string): Promise<boolean> {
    const filePath = this.getStateFilePath(workflowId, instanceId, nodeId);
    return fs.existsSync(filePath);
  }
  
  /**
   * 获取未完成的节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   */
  async getPending(workflowId: string, instanceId: string): Promise<DynamicNodeState[]> {
    const states = await this.loadAll(workflowId, instanceId);
    return states.filter(s => s.status === 'pending' || s.status === 'running');
  }
  
  /**
   * 获取失败的节点状态
   * @param workflowId 工作流ID
   * @param instanceId 实例ID
   */
  async getFailed(workflowId: string, instanceId: string): Promise<DynamicNodeState[]> {
    const states = await this.loadAll(workflowId, instanceId);
    return states.filter(s => s.status === 'failed');
  }
}
