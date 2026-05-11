/**
 * 工作流JSON文件持久化
 * 
 * 将动态节点持久化到工作流JSON文件
 */

import * as fs from 'fs';
import * as path from 'path';
import type { WorkflowNode, WorkflowEdge } from '../types';
import type { WorkflowDynamicMetadata, BatchGroup } from './types';

/**
 * 工作流文件持久化
 */
export class WorkflowFilePersistence {
  /**
   * 将动态节点持久化到工作流JSON文件
   * @param workflowFilePath 工作流文件路径
   * @param dynamicNodes 动态节点列表
   * @param dynamicEdges 动态边列表
   * @param metadata 动态元数据
   */
  async persistDynamicNodes(
    workflowFilePath: string,
    dynamicNodes: WorkflowNode[],
    dynamicEdges: WorkflowEdge[],
    metadata: WorkflowDynamicMetadata
  ): Promise<void> {
    // 读取现有工作流
    const workflow = await this.loadWorkflow(workflowFilePath);
    
    if (!workflow) {
      throw new Error(`Workflow file not found: ${workflowFilePath}`);
    }
    
    // 标记动态节点
    const markedNodes = dynamicNodes.map(node => ({
      ...node,
      _dynamic: true,
    }));
    
    // 标记动态边
    const markedEdges = dynamicEdges.map(edge => ({
      ...edge,
      _dynamic: true,
    }));
    
    // 合并节点（避免重复）
    const existingDynamicNodeIds = new Set(
      workflow.nodes.filter(n => (n as any)._dynamic).map(n => n.id)
    );
    const newNodes = workflow.nodes.filter(n => !existingDynamicNodeIds.has(n.id));
    
    // 合并边（避免重复）
    const existingDynamicEdgeIds = new Set(
      workflow.edges.filter(e => (e as any)._dynamic).map(e => e.id)
    );
    const newEdges = workflow.edges.filter(e => !existingDynamicEdgeIds.has(e.id));
    
    // 更新工作流
    const updatedWorkflow = {
      ...workflow,
      nodes: [...newNodes, ...markedNodes],
      edges: [...newEdges, ...markedEdges],
      _dynamicMetadata: metadata,
      updatedAt: new Date().toISOString(),
    };
    
    // 写入文件
    await this.saveWorkflow(workflowFilePath, updatedWorkflow);
    
    console.log(`[WorkflowFilePersistence] Persisted ${dynamicNodes.length} dynamic nodes to ${workflowFilePath}`);
  }
  
  /**
   * 从工作流JSON文件加载动态节点
   * @param workflowFilePath 工作流文件路径
   * @param parentNodeId 父节点ID
   */
  async loadDynamicNodes(
    workflowFilePath: string,
    parentNodeId: string
  ): Promise<{ nodes: WorkflowNode[]; edges: WorkflowEdge[]; metadata?: WorkflowDynamicMetadata }> {
    const workflow = await this.loadWorkflow(workflowFilePath);
    
    if (!workflow) {
      return { nodes: [], edges: [] };
    }
    
    // 过滤动态节点
    const nodes = workflow.nodes.filter(
      n => (n as any)._dynamic && n.id.startsWith(parentNodeId)
    );
    
    // 过滤动态边
    const edges = workflow.edges.filter(
      e => (e as any)._dynamic && (e.source.startsWith(parentNodeId) || e.target.startsWith(parentNodeId))
    );
    
    // 获取元数据
    const metadata = (workflow as any)._dynamicMetadata as WorkflowDynamicMetadata | undefined;
    
    return { nodes, edges, metadata };
  }
  
  /**
   * 清除工作流中的动态节点
   * @param workflowFilePath 工作流文件路径
   * @param parentNodeId 父节点ID（可选，不传则清除所有）
   */
  async clearDynamicNodes(
    workflowFilePath: string,
    parentNodeId?: string
  ): Promise<void> {
    const workflow = await this.loadWorkflow(workflowFilePath);
    
    if (!workflow) {
      return;
    }
    
    // 过滤要保留的节点
    const nodes = workflow.nodes.filter(n => {
      if (!(n as any)._dynamic) return true;
      if (parentNodeId) {
        return !n.id.startsWith(parentNodeId);
      }
      return false;
    });
    
    // 过滤要保留的边
    const edges = workflow.edges.filter(e => {
      if (!(e as any)._dynamic) return true;
      if (parentNodeId) {
        return !e.source.startsWith(parentNodeId) && !e.target.startsWith(parentNodeId);
      }
      return false;
    });
    
    // 更新元数据
    let metadata = (workflow as any)._dynamicMetadata;
    if (parentNodeId && metadata) {
      // 移除指定父节点的批次信息
      const newBatches: Record<number, string[]> = {};
      for (const [batch, nodeIds] of Object.entries(metadata.batches)) {
        newBatches[Number(batch)] = (nodeIds as string[]).filter(id => !id.startsWith(parentNodeId));
      }
      metadata = { ...metadata, batches: newBatches, updatedAt: new Date().toISOString() };
    } else {
      metadata = undefined;
    }
    
    // 更新工作流
    const updatedWorkflow = {
      ...workflow,
      nodes,
      edges,
      _dynamicMetadata: metadata,
      updatedAt: new Date().toISOString(),
    };
    
    await this.saveWorkflow(workflowFilePath, updatedWorkflow);
  }
  
  /**
   * 加载工作流
   * @param filePath 文件路径
   */
  async loadWorkflow(filePath: string): Promise<any | null> {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`[WorkflowFilePersistence] Failed to load workflow: ${filePath}`, error);
      return null;
    }
  }
  
  /**
   * 保存工作流
   * @param filePath 文件路径
   * @param workflow 工作流数据
   */
  async saveWorkflow(filePath: string, workflow: any): Promise<void> {
    const data = JSON.stringify(workflow, null, 2);
    await fs.promises.writeFile(filePath, data, 'utf-8');
  }
  
  /**
   * 生成动态节点ID
   * @param parentNodeId 父节点ID
   * @param batch 批次号
   * @param index 索引
   */
  generateDynamicNodeId(parentNodeId: string, batch: number, index: number): string {
    return `${parentNodeId}_batch${batch}_${index}`;
  }
  
  /**
   * 生成动态边ID
   * @param sourceId 源节点ID
   * @param targetId 目标节点ID
   */
  generateDynamicEdgeId(sourceId: string, targetId: string): string {
    return `e-dynamic-${sourceId}-${targetId}`;
  }
  
  /**
   * 创建动态元数据
   * @param parentNodeId 父节点ID
   * @param batches 批次分组
   */
  createMetadata(parentNodeId: string, batches: BatchGroup[]): WorkflowDynamicMetadata {
    const batchMap: Record<number, string[]> = {};
    
    for (const batch of batches) {
      batchMap[batch.batch] = batch.modules.map((m, i) => 
        this.generateDynamicNodeId(parentNodeId, batch.batch, i)
      );
    }
    
    return {
      parentNodeId,
      batches: batchMap,
      createdAt: new Date().toISOString(),
    };
  }
  
  /**
   * 检查工作流是否有动态节点
   * @param workflowFilePath 工作流文件路径
   */
  async hasDynamicNodes(workflowFilePath: string): Promise<boolean> {
    const workflow = await this.loadWorkflow(workflowFilePath);
    
    if (!workflow) {
      return false;
    }
    
    return workflow.nodes.some((n: any) => n._dynamic);
  }
  
  /**
   * 获取工作流的动态元数据
   * @param workflowFilePath 工作流文件路径
   */
  async getMetadata(workflowFilePath: string): Promise<WorkflowDynamicMetadata | undefined> {
    const workflow = await this.loadWorkflow(workflowFilePath);
    
    if (!workflow) {
      return undefined;
    }
    
    return (workflow as any)._dynamicMetadata;
  }
}
