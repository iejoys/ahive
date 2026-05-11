/**
 * 部门节点配置面板
 * 用于配置部门节点的执行参数
 */

import { useState, useEffect } from 'react';
import type { 
  WorkflowNode, 
  Department,
  DepartmentNodeConfig,
  WorkflowNodeConfig 
} from '../../../types';

// ========== 类型定义 ==========

export interface DepartmentNodeConfigPanelProps {
  /** 当前节点 */
  node: WorkflowNode;
  /** 可用部门列表 */
  departments: Department[];
  /** 配置更新回调 */
  onUpdate: (config: WorkflowNodeConfig) => void;
}

// ========== 默认配置 ==========

const defaultDepartmentConfig: DepartmentNodeConfig = {
  departmentId: '',
  triggerInternalWorkflow: true,
  waitForResult: true,
  resultTimeout: 300,
};

// ========== 主组件 ==========

export function DepartmentNodeConfigPanel({
  node,
  departments,
  onUpdate,
}: DepartmentNodeConfigPanelProps) {
  // 从节点配置中获取部门配置，或使用默认值
  const [config, setConfig] = useState<DepartmentNodeConfig>(
    node.config?.departmentConfig || defaultDepartmentConfig
  );
  
  // 当配置变化时通知父组件
  useEffect(() => {
    const newConfig: WorkflowNodeConfig = {
      ...node.config,
      departmentConfig: config,
    };
    onUpdate(newConfig);
  }, [config]);
  
  // 更新配置字段
  const updateConfig = <K extends keyof DepartmentNodeConfig>(
    key: K,
    value: DepartmentNodeConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };
  
  // 获取选中的部门
  const selectedDept = departments.find(d => d.id === config.departmentId);
  
  return (
    <div className="department-node-config-panel space-y-4 p-4">
      {/* 部门选择 */}
      <div className="form-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          选择部门
        </label>
        <select
          value={config.departmentId}
          onChange={(e) => updateConfig('departmentId', e.target.value)}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="">选择部门...</option>
          {departments.map(dept => (
            <option key={dept.id} value={dept.id}>
              {dept.icon} {dept.name} ({dept.members.length} 人)
            </option>
          ))}
        </select>
      </div>
      
      {/* 部门信息展示 */}
      {selectedDept && (
        <div className="bg-gray-700/30 rounded p-3 space-y-3">
          {/* 成员列表 */}
          <div>
            <div className="text-gray-400 text-xs mb-1">成员</div>
            <div className="flex flex-wrap gap-1">
              {selectedDept.members.map(member => (
                <span
                  key={member.agentId}
                  className="bg-gray-600 px-2 py-0.5 rounded text-xs text-gray-300 flex items-center gap-1"
                >
                  {member.role === 'leader' && <span>👑</span>}
                  {member.agentId}
                </span>
              ))}
            </div>
          </div>
          
          {/* 内部工作流 */}
          {selectedDept.internalWorkflows.length > 0 && (
            <div>
              <div className="text-gray-400 text-xs mb-1">内部工作流</div>
              <div className="flex flex-wrap gap-1">
                {selectedDept.internalWorkflows.map(iwf => (
                  <span
                    key={iwf.id}
                    className="bg-indigo-600/30 px-2 py-0.5 rounded text-xs text-indigo-300"
                  >
                    📋 {iwf.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* 执行选项 */}
      <div className="form-group space-y-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.triggerInternalWorkflow}
            onChange={(e) => updateConfig('triggerInternalWorkflow', e.target.checked)}
            className="mt-0.5 rounded"
          />
          <div>
            <span className="text-gray-300 text-sm">触发部门内部工作流</span>
            <p className="text-gray-500 text-xs mt-0.5">
              任务派发时自动触发部门内定义的工作流
            </p>
          </div>
        </label>
        
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.waitForResult}
            onChange={(e) => updateConfig('waitForResult', e.target.checked)}
            className="mt-0.5 rounded"
          />
          <div>
            <span className="text-gray-300 text-sm">等待部门返回结果</span>
            <p className="text-gray-500 text-xs mt-0.5">
              暂停工作流直到部门完成任务并返回结果
            </p>
          </div>
        </label>
        
        {/* 等待超时 */}
        {config.waitForResult && (
          <div className="ml-7">
            <label className="text-gray-400 text-xs">等待超时 (秒)</label>
            <input
              type="number"
              value={config.resultTimeout || 300}
              onChange={(e) => updateConfig('resultTimeout', Number(e.target.value))}
              min={10}
              max={3600}
              className="w-24 mt-1 ml-2 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
            />
          </div>
        )}
      </div>
      
      {/* 任务描述模板 */}
      <div className="form-group">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          任务描述模板
        </label>
        <textarea
          placeholder="描述要派发给部门的任务内容，支持 {{变量}} 插值..."
          rows={3}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 text-sm focus:border-indigo-500 focus:outline-none resize-none"
        />
      </div>
      
      {/* 提示 */}
      <div className="bg-indigo-600/10 border border-indigo-500/30 rounded p-3">
        <div className="text-indigo-400 text-sm flex items-start gap-2">
          <span>💡</span>
          <div>
            <p className="font-medium">部门节点说明</p>
            <p className="text-gray-400 text-xs mt-1">
              任务会根据部门的分配策略自动分配给成员。
              如果部门有内部工作流，可以自动触发协同执行。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DepartmentNodeConfigPanel;