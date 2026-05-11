import { useStore } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';
import { useState } from 'react';
import { TemplatePanel } from './TemplatePanel';
import { SimulationPanel } from './SimulationPanel';
import { ImportWorkflowDialog } from '../dialogs/ImportWorkflowDialog';
import { WorkflowInstanceDetailDialog } from '../dialogs/WorkflowInstanceDetailDialog';
import { renameWorkflowInStorage, workflowNameExistsInStorage } from '../../scheduler/DataSync';

interface WorkflowToolbarProps {
  onSave?: () => void;
}

export function WorkflowToolbar({}: WorkflowToolbarProps) {
  const { 
    language, 
    workflows, 
    currentWorkflowId,
    addWorkflow,
    setCurrentWorkflow,
    updateWorkflow
  } = useStore();
  const dialog = useDialog();
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [showSimulationPanel, setShowSimulationPanel] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showInstanceDetail, setShowInstanceDetail] = useState(false);
  
  // 创建新工作流
  const handleNewWorkflow = async () => {
    // 生成唯一名称
    const baseName = language === 'zh' ? '新工作流' : 'New Workflow';
    let name = baseName;
    let counter = 1;
    
    // 检查名称冲突（本地 + 存储）
    while (workflows.some(w => w.name === name) || await workflowNameExistsInStorage(name)) {
      counter++;
      name = `${baseName} ${counter}`;
    }
    
    const newWorkflow = {
      id: `workflow-${Date.now()}`,
      name,
      nodes: [],
      edges: [],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addWorkflow(newWorkflow);
    setCurrentWorkflow(newWorkflow.id);
    // 自动进入编辑模式
    setEditingId(newWorkflow.id);
    setEditingName(newWorkflow.name);
  };
  
  // 开始编辑名称
  const startEditing = (workflowId: string, currentName: string) => {
    setEditingId(workflowId);
    setEditingName(currentName);
  };
  
  // 保存名称（重命名）
  const saveName = async () => {
    if (editingId && editingName.trim()) {
      const workflow = workflows.find(w => w.id === editingId);
      const newName = editingName.trim();
      
      if (workflow && workflow.name !== newName) {
        // 检查新名称是否已存在
        const exists = await workflowNameExistsInStorage(newName);
        if (exists) {
          // 名称已存在，提示用户
          alert(language === 'zh' 
            ? `名称 "${newName}" 已存在` 
            : `Name "${newName}" already exists`
          );
          return;
        }
        
        // 重命名文件
        const success = await renameWorkflowInStorage(workflow.name, newName);
        if (success) {
          // 更新 store
          updateWorkflow({ ...workflow, name: newName });
        }
      }
    }
    setEditingId(null);
    setEditingName('');
  };
  
  
  
  return (
    <div className="bg-gray-800 rounded-lg p-3 shadow-lg border border-gray-700">
      {/* 工作流选择 */}
      <div className="flex items-center gap-2 mb-3">
        {editingId === currentWorkflowId ? (
          // 编辑模式
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
            }}
            className="flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1 border border-indigo-500 focus:outline-none focus:border-indigo-400"
            autoFocus
          />
        ) : (
          // 选择模式
          <select 
            className="flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
            value={currentWorkflowId || ''}
            onChange={(e) => setCurrentWorkflow(e.target.value)}
          >
            <option value="">{language === 'zh' ? '-- 选择工作流 --' : '-- Select Workflow --'}</option>
            {workflows.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
        {currentWorkflowId && editingId !== currentWorkflowId && (
          <button
            onClick={() => {
              const w = workflows.find(w => w.id === currentWorkflowId);
              if (w) startEditing(w.id, w.name);
            }}
            className="text-gray-400 hover:text-white px-2 py-1 text-sm"
            title={language === 'zh' ? '重命名' : 'Rename'}
          >
            ✏️
          </button>
        )}
        <button
          onClick={handleNewWorkflow}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-2 py-1 rounded transition-colors"
        >
          + {language === 'zh' ? '新建' : 'New'}
        </button>
        <button
          onClick={() => setShowTemplatePanel(true)}
          className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-2 py-1 rounded transition-colors"
          title={language === 'zh' ? '从模板导入' : 'Import from Template'}
        >
          📋 {language === 'zh' ? '模板' : 'Template'}
        </button>
        <button
          onClick={() => setShowImportDialog(true)}
          className="bg-green-600 hover:bg-green-700 text-white text-xs px-2 py-1 rounded transition-colors"
          title={language === 'zh' ? '从文件导入' : 'Import from File'}
        >
          📥 {language === 'zh' ? '导入' : 'Import'}
        </button>
        {currentWorkflowId && (
          <>
            <button
              onClick={() => setShowSimulationPanel(true)}
              className="bg-orange-600 hover:bg-orange-700 text-white text-xs px-2 py-1 rounded transition-colors"
              title={language === 'zh' ? '模拟执行验证' : 'Simulate Execution'}
            >
              🧪 {language === 'zh' ? '模拟' : 'Simulate'}
            </button>
            <button
              onClick={() => setShowInstanceDetail(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-2 py-1 rounded transition-colors"
              title={language === 'zh' ? '实例详情' : 'Instance Details'}
            >
              📊 {language === 'zh' ? '详情' : 'Details'}
            </button>
            <button
              onClick={async () => {
                const confirmed = await dialog.confirm(
                  language === 'zh' ? '确定删除此工作流？' : 'Delete this workflow?',
                  language === 'zh' ? '删除确认' : 'Confirm Delete'
                );
                if (confirmed) {
                  useStore.getState().deleteWorkflow(currentWorkflowId);
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white text-xs px-2 py-1 rounded transition-colors"
              title={language === 'zh' ? '删除工作流' : 'Delete Workflow'}
            >
              🗑️
            </button>
          </>
        )}
      </div>
      
      {/* 操作说明 */}
      <div className="text-gray-400 text-xs">
        {language === 'zh' 
          ? '💡 从左侧工具箱拖拽节点到画布，从输出点拖线连接到下一节点'
          : '💡 Drag nodes from toolbox to canvas, drag from output to connect'
        }
      </div>

      {/* 模板选择面板 */}
      {showTemplatePanel && (
        <TemplatePanel onClose={() => setShowTemplatePanel(false)} />
      )}

      {/* 模拟执行面板 */}
      {showSimulationPanel && (
        <SimulationPanel onClose={() => setShowSimulationPanel(false)} />
      )}

      {/* 导入对话框 */}
      {showImportDialog && (
        <ImportWorkflowDialog onClose={() => setShowImportDialog(false)} />
      )}

      {/* 实例详情对话框 */}
      {showInstanceDetail && (
        <WorkflowInstanceDetailDialog
          open={showInstanceDetail}
          onClose={() => setShowInstanceDetail(false)}
          initialWorkflowId={currentWorkflowId}
        />
      )}
    </div>
  );
}