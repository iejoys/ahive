/**
 * 进度追踪器
 * 
 * 追踪动态节点的执行进度
 */

import type { DynamicNodeProgressEvent, DynamicProgressEventType } from './types';

/**
 * 进度信息
 */
export interface ProgressInfo {
  // 总数
  total: number;
  
  // 已完成
  completed: number;
  
  // 失败
  failed: number;
  
  // 当前批次
  currentBatch: number;
  
  // 总批次数
  totalBatches: number;
  
  // 进度百分比
  percentage: number;
  
  // 运行中的节点
  runningNodes: string[];
}

/**
 * 进度追踪器
 */
export class ProgressTracker {
  // 进度回调列表
  private callbacks: ((event: DynamicNodeProgressEvent) => void)[] = [];
  
  // 进度信息映射 (parentNodeId -> ProgressInfo)
  private progressMap: Map<string, ProgressInfo> = new Map();
  
  // 运行中的节点映射 (parentNodeId -> Set<nodeId>)
  private runningNodesMap: Map<string, Set<string>> = new Map();
  
  /**
   * 注册进度回调
   * @param callback 回调函数
   */
  onProgress(callback: (event: DynamicNodeProgressEvent) => void): void {
    this.callbacks.push(callback);
  }
  
  /**
   * 移除进度回调
   * @param callback 回调函数
   */
  offProgress(callback: (event: DynamicNodeProgressEvent) => void): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }
  
  /**
   * 报告进度事件
   * @param event 进度事件
   */
  report(event: DynamicNodeProgressEvent): void {
    // 更新进度信息
    this.updateProgress(event);
    
    // 触发回调
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('[ProgressTracker] Callback error:', error);
      }
    }
  }
  
  /**
   * 初始化进度
   * @param parentNodeId 父节点ID
   * @param total 总数
   * @param totalBatches 总批次数
   */
  initProgress(parentNodeId: string, total: number, totalBatches: number): void {
    this.progressMap.set(parentNodeId, {
      total,
      completed: 0,
      failed: 0,
      currentBatch: 0,
      totalBatches,
      percentage: 0,
      runningNodes: [],
    });
    this.runningNodesMap.set(parentNodeId, new Set());
  }
  
  /**
   * 获取当前进度
   * @param parentNodeId 父节点ID
   * @returns 进度信息
   */
  getProgress(parentNodeId: string): ProgressInfo | undefined {
    return this.progressMap.get(parentNodeId);
  }
  
  /**
   * 更新进度信息
   * @param event 进度事件
   */
  private updateProgress(event: DynamicNodeProgressEvent): void {
    const { parentNodeId, nodeId, type, batch } = event;
    
    let progress = this.progressMap.get(parentNodeId);
    if (!progress) {
      return;
    }
    
    let runningNodes = this.runningNodesMap.get(parentNodeId);
    if (!runningNodes) {
      runningNodes = new Set();
      this.runningNodesMap.set(parentNodeId, runningNodes);
    }
    
    // 根据事件类型更新
    switch (type) {
      case 'created':
        // 节点创建，不需要更新计数
        break;
        
      case 'started':
        runningNodes.add(nodeId);
        progress.currentBatch = Math.max(progress.currentBatch, batch);
        break;
        
      case 'completed':
        runningNodes.delete(nodeId);
        progress.completed++;
        break;
        
      case 'failed':
        runningNodes.delete(nodeId);
        progress.failed++;
        break;
        
      case 'batch_start':
        progress.currentBatch = batch;
        break;
        
      case 'batch_complete':
        // 批次完成
        break;
    }
    
    // 更新进度百分比
    const processed = progress.completed + progress.failed;
    progress.percentage = progress.total > 0 
      ? Math.round((processed / progress.total) * 100) 
      : 0;
    
    // 更新运行中的节点列表
    progress.runningNodes = [...runningNodes];
    
    this.progressMap.set(parentNodeId, progress);
  }
  
  /**
   * 清除进度
   * @param parentNodeId 父节点ID
   */
  clearProgress(parentNodeId: string): void {
    this.progressMap.delete(parentNodeId);
    this.runningNodesMap.delete(parentNodeId);
  }
  
  /**
   * 创建进度事件
   * @param options 事件选项
   * @returns 进度事件
   */
  createEvent(options: {
    type: DynamicProgressEventType;
    parentNodeId: string;
    nodeId: string;
    batch: number;
    index: number;
    total: number;
    data?: Record<string, any>;
  }): DynamicNodeProgressEvent {
    const progress = this.progressMap.get(options.parentNodeId);
    const percentage = progress?.percentage ?? 0;
    
    return {
      type: options.type,
      parentNodeId: options.parentNodeId,
      nodeId: options.nodeId,
      batch: options.batch,
      index: options.index,
      total: options.total,
      percentage,
      timestamp: new Date().toISOString(),
      data: options.data,
    };
  }
  
  /**
   * 获取所有进度信息
   * @returns 进度信息映射
   */
  getAllProgress(): Map<string, ProgressInfo> {
    return new Map(this.progressMap);
  }
  
  /**
   * 检查是否所有节点都已完成
   * @param parentNodeId 父节点ID
   * @returns 是否全部完成
   */
  isAllCompleted(parentNodeId: string): boolean {
    const progress = this.progressMap.get(parentNodeId);
    if (!progress) return false;
    
    const processed = progress.completed + progress.failed;
    return processed >= progress.total;
  }
  
  /**
   * 检查是否有失败的节点
   * @param parentNodeId 父节点ID
   * @returns 是否有失败
   */
  hasFailures(parentNodeId: string): boolean {
    const progress = this.progressMap.get(parentNodeId);
    return progress ? progress.failed > 0 : false;
  }
}
