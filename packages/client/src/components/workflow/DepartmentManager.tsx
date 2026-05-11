/**
 * 部门管理组件
 * 管理部门、成员、内部工作流
 */

import { useState, useEffect } from 'react';
import { useDialog } from '../common/DialogProvider';
import type { 
  Agent, 
  Department, 
  Workflow 
} from '../../types';

// ========== 类型定义 ==========

export interface DepartmentManagerProps {
  /** 可用智能体列表 */
  agents: Agent[];
  /** 可用工作流列表 */
  workflows: Workflow[];
  /** 部门列表 */
  departments: Department[];
  /** 部门变更回调 */
  onDepartmentsChange: (departments: Department[]) => void;
  /** 关闭回调 */
  onClose?: () => void;
}

// ========== 内部工作流配置接口 ==========

interface InternalWorkflowConfig {
  id: string;
  name: string;
  triggerCondition: string;
  workflowId: string;
  triggerType: 'manual' | 'auto' | 'webhook' | 'schedule';
  schedule?: string;
  enabled: boolean;
}

// ========== 图标选择 ==========

const departmentIcons = [
  '💻', '🔬', '📊', '🎨', '🔧', '📚', '🎯', '💼', '🌟', '🚀'
];

// ========== 触发类型配置 ==========

const triggerTypes = [
  { id: 'manual', label: '手动触发', icon: '👆' },
  { id: 'auto', label: '自动触发', icon: '⚡' },
  { id: 'schedule', label: '定时触发', icon: '⏰' },
  { id: 'webhook', label: 'Webhook', icon: '🔗' },
];

// ========== 创建空部门 ==========

function createEmptyDepartment(): Department {
  return {
    id: `dept-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: '新部门',
    icon: '💻',
    description: '',
    members: [],
    internalWorkflows: [],
    blackboard: {},
    settings: {
      autoAssign: true,
      assignStrategy: 'round-robin',
      notifyOnTask: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ========== 主组件 ==========

export function DepartmentManager({
  agents,
  workflows,
  departments,
  onDepartmentsChange,
  onClose,
}: DepartmentManagerProps) {
  const dialog = useDialog();
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(
    departments[0]?.id || null
  );
  const [isEditing, setIsEditing] = useState(false);
  
  // 获取当前选中的部门
  const selectedDept = departments.find(d => d.id === selectedDeptId);
  
  // 添加新部门
  const handleAddDepartment = () => {
    const newDept = createEmptyDepartment();
    onDepartmentsChange([...departments, newDept]);
    setSelectedDeptId(newDept.id);
    setIsEditing(true);
  };
  
  // 更新部门
  const handleUpdateDepartment = (updated: Department) => {
    onDepartmentsChange(
      departments.map(d => d.id === updated.id ? updated : d)
    );
  };
  
  // 删除部门
  const handleDeleteDepartment = async (deptId: string) => {
    const confirmed = await dialog.confirm('确定要删除这个部门吗？', '删除确认');
    if (!confirmed) return;
    
    const newDepartments = departments.filter(d => d.id !== deptId);
    onDepartmentsChange(newDepartments);
    
    if (selectedDeptId === deptId) {
      setSelectedDeptId(newDepartments[0]?.id || null);
    }
  };
  
  // 添加成员
  const handleAddMember = (agentId: string, role: 'leader' | 'member') => {
    if (!selectedDept || !agentId) return;
    
    // 检查是否已存在
    if (selectedDept.members.some(m => m.agentId === agentId)) return;
    
    handleUpdateDepartment({
      ...selectedDept,
      members: [...selectedDept.members, { agentId, role }],
      updatedAt: new Date().toISOString(),
    });
  };
  
  // 移除成员
  const handleRemoveMember = (agentId: string) => {
    if (!selectedDept) return;
    
    handleUpdateDepartment({
      ...selectedDept,
      members: selectedDept.members.filter(m => m.agentId !== agentId),
      updatedAt: new Date().toISOString(),
    });
  };
  
  // 更新成员角色
  const handleUpdateMemberRole = (agentId: string, role: 'leader' | 'member') => {
    if (!selectedDept) return;
    
    handleUpdateDepartment({
      ...selectedDept,
      members: selectedDept.members.map(m => 
        m.agentId === agentId ? { ...m, role } : m
      ),
      updatedAt: new Date().toISOString(),
    });
  };
  
  // 添加内部工作流
  const handleAddInternalWorkflow = (workflowId: string) => {
    if (!selectedDept || !workflowId) return;
    
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;
    
    const newIwf: InternalWorkflowConfig = {
      id: `iwf-${Date.now()}`,
      name: workflow.name,
      triggerCondition: '',
      workflowId,
      triggerType: 'manual',
      enabled: true,
    };
    
    handleUpdateDepartment({
      ...selectedDept,
      internalWorkflows: [...selectedDept.internalWorkflows, newIwf],
      updatedAt: new Date().toISOString(),
    });
  };
  
  // 更新内部工作流
  const handleUpdateInternalWorkflow = (iwfId: string, updates: Partial<InternalWorkflowConfig>) => {
    if (!selectedDept) return;
    
    handleUpdateDepartment({
      ...selectedDept,
      internalWorkflows: selectedDept.internalWorkflows.map(iwf =>
        iwf.id === iwfId ? { ...iwf, ...updates } : iwf
      ),
      updatedAt: new Date().toISOString(),
    });
  };
  
  // 移除内部工作流
  const handleRemoveInternalWorkflow = (iwfId: string) => {
    if (!selectedDept) return;
    
    handleUpdateDepartment({
      ...selectedDept,
      internalWorkflows: selectedDept.internalWorkflows.filter(iwf => iwf.id !== iwfId),
      updatedAt: new Date().toISOString(),
    });
  };
  
  // 获取智能体名称
  const getAgentName = (agentId: string) => {
    return agents.find(a => a.id === agentId)?.name || agentId;
  };
  
  // 获取可用智能体 (未加入当前部门的)
  const getAvailableAgents = () => {
    const memberIds = new Set(selectedDept?.members.map(m => m.agentId) || []);
    return agents.filter(a => !memberIds.has(a.id));
  };
  
  return (
    <div className="department-manager flex h-full bg-gray-900 rounded-lg overflow-hidden">
      {/* 左侧: 部门列表 */}
      <div className="w-64 border-r border-gray-700 flex flex-col">
        {/* 标题栏 */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-white font-medium flex items-center gap-2">
            <span>👥</span>
            <span>部门管理</span>
          </h2>
          <button
            onClick={handleAddDepartment}
            className="text-indigo-400 hover:text-indigo-300 text-sm"
          >
            + 新建
          </button>
        </div>
        
        {/* 部门列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {departments.length > 0 ? (
            departments.map(dept => (
              <div
                key={dept.id}
                onClick={() => {
                  setSelectedDeptId(dept.id);
                  setIsEditing(false);
                }}
                className={`flex items-center gap-2 p-3 rounded cursor-pointer transition-colors ${
                  selectedDeptId === dept.id
                    ? 'bg-indigo-600/30 border border-indigo-500'
                    : 'hover:bg-gray-700/50 border border-transparent'
                }`}
              >
                <span className="text-xl">{dept.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm truncate">{dept.name}</div>
                  <div className="text-gray-500 text-xs">
                    {dept.members.length} 人
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">👥</div>
              <div className="text-sm">暂无部门</div>
              <button
                onClick={handleAddDepartment}
                className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm"
              >
                创建第一个部门
              </button>
            </div>
          )}
        </div>
        
        {/* 关闭按钮 */}
        {onClose && (
          <div className="p-2 border-t border-gray-700">
            <button
              onClick={onClose}
              className="w-full py-2 text-gray-400 hover:text-white text-sm"
            >
              关闭
            </button>
          </div>
        )}
      </div>
      
      {/* 右侧: 部门详情 */}
      {selectedDept ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 详情头部 */}
          <div className="p-4 border-b border-gray-700 flex items-center gap-3">
            <span className="text-3xl">{selectedDept.icon}</span>
            <div className="flex-1">
              <input
                type="text"
                value={selectedDept.name}
                onChange={(e) => handleUpdateDepartment({
                  ...selectedDept,
                  name: e.target.value,
                  updatedAt: new Date().toISOString(),
                })}
                className="bg-transparent text-white text-lg font-medium focus:outline-none"
              />
              <input
                type="text"
                value={selectedDept.description || ''}
                onChange={(e) => handleUpdateDepartment({
                  ...selectedDept,
                  description: e.target.value,
                  updatedAt: new Date().toISOString(),
                })}
                placeholder="添加部门描述..."
                className="block mt-1 bg-transparent text-gray-400 text-sm focus:outline-none"
              />
            </div>
            
            {/* 图标选择 */}
            <div className="flex items-center gap-1">
              {departmentIcons.map(icon => (
                <button
                  key={icon}
                  onClick={() => handleUpdateDepartment({
                    ...selectedDept,
                    icon,
                    updatedAt: new Date().toISOString(),
                  })}
                  className={`w-8 h-8 rounded flex items-center justify-center text-lg ${
                    selectedDept.icon === icon
                      ? 'bg-indigo-600'
                      : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
            
            {/* 删除按钮 */}
            <button
              onClick={() => handleDeleteDepartment(selectedDept.id)}
              className="ml-2 text-gray-400 hover:text-red-400"
            >
              🗑️
            </button>
          </div>
          
          {/* 详情内容 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* 成员管理 */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium">成员</h3>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddMember(e.target.value, 'member');
                      e.target.value = '';
                    }
                  }}
                  className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                >
                  <option value="">+ 添加成员</option>
                  {getAvailableAgents().map(agent => (
                    <option key={agent.id} value={agent.agentId || agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              
              {selectedDept.members.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {selectedDept.members.map(member => (
                    <div
                      key={member.agentId}
                      className="bg-gray-700/50 rounded p-3 flex items-center gap-2"
                    >
                      <span className="text-xl">
                        {agents.find(a => a.id === member.agentId)?.avatar || '🤖'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm truncate">
                          {getAgentName(member.agentId)}
                        </div>
                        <select
                          value={member.role}
                          onChange={(e) => handleUpdateMemberRole(
                            member.agentId, 
                            e.target.value as 'leader' | 'member'
                          )}
                          className="bg-transparent text-gray-400 text-xs focus:outline-none"
                        >
                          <option value="leader">👑 负责人</option>
                          <option value="member">👤 成员</option>
                        </select>
                      </div>
                      <button
                        onClick={() => handleRemoveMember(member.agentId)}
                        className="text-gray-400 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-sm text-center py-4 bg-gray-700/30 rounded">
                  暂无成员
                </div>
              )}
            </section>
            
{/* 内部工作流 */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium flex items-center gap-2">
                  <span>📋</span>
                  内部工作流
                </h3>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddInternalWorkflow(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                >
                  <option value="">+ 添加工作流</option>
                  {workflows
                    .filter(w => !selectedDept.internalWorkflows.some(iwf => iwf.workflowId === w.id))
                    .map(workflow => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))
                  }
                </select>
              </div>
              
              {selectedDept.internalWorkflows.length > 0 ? (
                <div className="space-y-3">
                  {(selectedDept.internalWorkflows as InternalWorkflowConfig[]).map(iwf => {
                    const workflow = workflows.find(w => w.id === iwf.workflowId);
                    return (
                      <div
                        key={iwf.id}
                        className="bg-gray-700/50 rounded-lg p-4"
                      >
                        {/* 工作流标题行 */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">📋</span>
                            <span className="text-white font-medium">{iwf.name}</span>
                            {workflow && (
                              <span className="text-gray-500 text-xs">
                                ({workflow.nodes?.length || 0} 节点)
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={iwf.enabled !== false}
                                onChange={(e) => handleUpdateInternalWorkflow(iwf.id, { enabled: e.target.checked })}
                                className="rounded"
                              />
                              <span className="text-gray-400 text-xs">启用</span>
                            </label>
                            <button
                              onClick={() => handleRemoveInternalWorkflow(iwf.id)}
                              className="text-gray-400 hover:text-red-400 text-sm"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                        
                        {/* 触发类型选择 */}
                        <div className="mb-3">
                          <label className="text-gray-400 text-xs mb-1 block">触发类型</label>
                          <div className="flex gap-2">
                            {triggerTypes.map(tt => (
                              <button
                                key={tt.id}
                                onClick={() => handleUpdateInternalWorkflow(iwf.id, { triggerType: tt.id as InternalWorkflowConfig['triggerType'] })}
                                className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                                  iwf.triggerType === tt.id
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                                }`}
                              >
                                <span>{tt.icon}</span>
                                <span>{tt.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* 触发条件 (自动触发时) */}
                        {iwf.triggerType === 'auto' && (
                          <div className="mb-3">
                            <label className="text-gray-400 text-xs mb-1 block">触发条件</label>
                            <input
                              type="text"
                              value={iwf.triggerCondition || ''}
                              onChange={(e) => handleUpdateInternalWorkflow(iwf.id, { triggerCondition: e.target.value })}
                              placeholder="例: task.type == 'data_process'"
                              className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white text-sm"
                            />
                            <p className="text-gray-500 text-xs mt-1">
                              可用变量: task, department, member
                            </p>
                          </div>
                        )}
                        
                        {/* 定时配置 (定时触发时) */}
                        {iwf.triggerType === 'schedule' && (
                          <div className="mb-3">
                            <label className="text-gray-400 text-xs mb-1 block">Cron 表达式</label>
                            <input
                              type="text"
                              value={iwf.schedule || ''}
                              onChange={(e) => handleUpdateInternalWorkflow(iwf.id, { schedule: e.target.value })}
                              placeholder="例: 0 9 * * * (每天9点)"
                              className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-white text-sm font-mono"
                            />
                          </div>
                        )}
                        
                        {/* Webhook URL (Webhook触发时) */}
                        {iwf.triggerType === 'webhook' && (
                          <div className="mb-3">
                            <label className="text-gray-400 text-xs mb-1 block">Webhook URL</label>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 px-3 py-2 bg-gray-600 rounded text-gray-300 text-xs truncate">
                                /api/webhook/dept/{selectedDept.id}/workflow/{iwf.id}
                              </code>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    `${window.location.origin}/api/webhook/dept/${selectedDept.id}/workflow/${iwf.id}`
                                  );
                                }}
                                className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-gray-300"
                              >
                                复制
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-gray-500 text-sm text-center py-6 bg-gray-700/30 rounded">
                  <div className="text-2xl mb-2">📋</div>
                  <div>暂无内部工作流</div>
                  <div className="text-xs mt-1 text-gray-600">
                    内部工作流可在特定条件下自动执行
                  </div>
                </div>
              )}
            </section>
            
            {/* 部门设置 */}
            <section>
              <h3 className="text-white font-medium mb-3">设置</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDept.settings.autoAssign}
                    onChange={(e) => handleUpdateDepartment({
                      ...selectedDept,
                      settings: { ...selectedDept.settings, autoAssign: e.target.checked },
                      updatedAt: new Date().toISOString(),
                    })}
                    className="rounded"
                  />
                  <span className="text-gray-300 text-sm">自动分配任务</span>
                </label>
                
                <div>
                  <label className="text-gray-400 text-xs">任务分配策略</label>
                  <select
                    value={selectedDept.settings.assignStrategy}
                    onChange={(e) => handleUpdateDepartment({
                      ...selectedDept,
                      settings: {
                        ...selectedDept.settings,
                        assignStrategy: e.target.value as Department['settings']['assignStrategy'],
                      },
                      updatedAt: new Date().toISOString(),
                    })}
                    className="w-full mt-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  >
                    <option value="random">随机分配</option>
                    <option value="round-robin">轮询分配</option>
                    <option value="skill-match">技能匹配</option>
                  </select>
                </div>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDept.settings.notifyOnTask}
                    onChange={(e) => handleUpdateDepartment({
                      ...selectedDept,
                      settings: { ...selectedDept.settings, notifyOnTask: e.target.checked },
                      updatedAt: new Date().toISOString(),
                    })}
                    className="rounded"
                  />
                  <span className="text-gray-300 text-sm">新任务时通知成员</span>
                </label>
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-4xl mb-2">👥</div>
            <div>选择或创建一个部门</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DepartmentManager;