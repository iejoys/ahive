/**
 * 批次分组算法
 * 
 * 将任务按 batch 字段分组，支持按批次顺序执行
 */

import type { PlannerModule, BatchGroup } from './types';

/**
 * 批次分组器
 */
export class BatchGrouper {
  /**
   * 按 batch 字段分组
   * @param modules 任务项列表
   * @param batchField 批次字段名（默认 'batch'）
   * @returns 按批次分组的任务列表（按批次号升序）
   */
  groupByBatch(
    modules: PlannerModule[],
    batchField: string = 'batch'
  ): BatchGroup[] {
    const batchMap = new Map<number, PlannerModule[]>();
    
    for (const module of modules) {
      const batch = (module as any)[batchField] ?? 1;
      if (!batchMap.has(batch)) {
        batchMap.set(batch, []);
      }
      batchMap.get(batch)!.push(module);
    }
    
    // 按批次号升序排序
    const sortedBatches = [...batchMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([batch, modules]) => ({ batch, modules }));
    
    return sortedBatches;
  }
  
  /**
   * 获取批次执行顺序
   * @param batches 批次分组列表
   * @returns 批次号数组（升序）
   */
  getExecutionOrder(batches: BatchGroup[]): number[] {
    return batches.map(b => b.batch).sort((a, b) => a - b);
  }
  
  /**
   * 获取总批次数
   * @param modules 任务项列表
   * @param batchField 批次字段名
   * @returns 批次数
   */
  getTotalBatches(modules: PlannerModule[], batchField: string = 'batch'): number {
    const batches = new Set<number>();
    for (const module of modules) {
      batches.add((module as any)[batchField] ?? 1);
    }
    return batches.size;
  }
  
  /**
   * 获取指定批次的所有模块
   * @param modules 任务项列表
   * @param batch 批次号
   * @param batchField 批次字段名
   * @returns 该批次的模块列表
   */
  getModulesByBatch(
    modules: PlannerModule[],
    batch: number,
    batchField: string = 'batch'
  ): PlannerModule[] {
    return modules.filter(m => ((m as any)[batchField] ?? 1) === batch);
  }
  
  /**
   * 验证批次分配是否正确
   * @param modules 任务项列表
   * @returns 验证结果
   */
  validateBatchAssignment(modules: PlannerModule[]): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    
    // 检查是否有模块
    if (modules.length === 0) {
      errors.push('模块列表为空');
      return { valid: false, errors };
    }
    
    // 检查每个模块是否有 batch 字段
    for (const module of modules) {
      if (module.batch === undefined || module.batch === null) {
        errors.push(`模块 ${module.id} 缺少 batch 字段`);
      }
      if (module.batch < 1) {
        errors.push(`模块 ${module.id} 的 batch 值必须大于 0`);
      }
    }
    
    // 检查依赖关系是否满足批次顺序
    const moduleMap = new Map<string, PlannerModule>();
    for (const module of modules) {
      moduleMap.set(module.id, module);
    }
    
    for (const module of modules) {
      if (module.dependsOn && module.dependsOn.length > 0) {
        for (const depId of module.dependsOn) {
          const depModule = moduleMap.get(depId);
          if (!depModule) {
            errors.push(`模块 ${module.id} 依赖的模块 ${depId} 不存在`);
          } else if (depModule.batch >= module.batch) {
            errors.push(
              `模块 ${module.id} (batch=${module.batch}) 依赖的模块 ${depId} (batch=${depModule.batch}) 批次号应该更小`
            );
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * 自动修正批次分配（基于依赖关系）
   * @param modules 任务项列表
   * @returns 修正后的模块列表
   */
  autoFixBatchAssignment(modules: PlannerModule[]): PlannerModule[] {
    const moduleMap = new Map<string, PlannerModule>();
    const fixedModules: PlannerModule[] = [];
    
    // 深拷贝模块
    for (const module of modules) {
      const fixedModule = { ...module };
      moduleMap.set(module.id, fixedModule);
      fixedModules.push(fixedModule);
    }
    
    // 计算每个模块的正确批次号
    const calculateBatch = (moduleId: string, visited: Set<string> = new Set()): number => {
      if (visited.has(moduleId)) {
        // 循环依赖，返回当前批次
        return moduleMap.get(moduleId)?.batch ?? 1;
      }
      visited.add(moduleId);
      
      const module = moduleMap.get(moduleId);
      if (!module) return 1;
      
      if (!module.dependsOn || module.dependsOn.length === 0) {
        return 1;
      }
      
      let maxDepBatch = 0;
      for (const depId of module.dependsOn) {
        const depBatch = calculateBatch(depId, visited);
        maxDepBatch = Math.max(maxDepBatch, depBatch);
      }
      
      return maxDepBatch + 1;
    };
    
    // 修正每个模块的批次号
    for (const module of fixedModules) {
      module.batch = calculateBatch(module.id);
    }
    
    return fixedModules;
  }
}
