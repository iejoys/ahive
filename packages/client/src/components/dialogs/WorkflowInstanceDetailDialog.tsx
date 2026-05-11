import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store/useStore';
import InstanceBasicInfo from './instance-detail/InstanceBasicInfo';
import InstanceExecutionProgress from './instance-detail/InstanceExecutionProgress';
import InstanceNodeList from './instance-detail/InstanceNodeList';
import InstanceOutputs from './instance-detail/InstanceOutputs';
import InstanceVariables from './instance-detail/InstanceVariables';
import InstanceErrorLog from './instance-detail/InstanceErrorLog';

interface WorkflowInstanceDetailDialogProps {
  open: boolean;
  onClose: () => void;
  initialInstanceId?: string;
  initialWorkflowId?: string;
}

const WorkflowInstanceDetailDialog: React.FC<WorkflowInstanceDetailDialogProps> = ({
  open,
  onClose,
  initialInstanceId,
  initialWorkflowId,
}) => {
  const {
    workflows,
    allInstances,
    selectedInstanceDetails,
    loadAllInstances,
    loadInstanceDetails,
    deleteInstance,
    deleteAllInstances,
    language,
  } = useStore();

  const isZh = language === 'zh';

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(initialWorkflowId || '');
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(initialInstanceId || '');
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [nodeStates, setNodeStates] = useState<any[]>([]);
  const [outputs, setOutputs] = useState<any[]>([]);
  const [outputStats, setOutputStats] = useState<{ [type: string]: number }>({});

  // 拖动状态
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);

  // 初始化：设置工作流ID
  useEffect(() => {
    if (open) {
      if (initialWorkflowId) {
        setSelectedWorkflowId(initialWorkflowId);
      } else if (workflows.length > 0) {
        setSelectedWorkflowId(workflows[0].id);
      }
      // 重置位置
      setPosition({ x: 0, y: 0 });
    }
  }, [open, initialWorkflowId, workflows]);

  // 当工作流变化时，加载实例列表
  useEffect(() => {
    if (open && selectedWorkflowId) {
      loadAllInstances();
    }
  }, [open, selectedWorkflowId, loadAllInstances]);

  // 当实例列表加载完成后，设置默认实例
  useEffect(() => {
    if (open && allInstances.length > 0 && !selectedInstanceId) {
      if (initialInstanceId && allInstances.some(inst => inst.instanceId === initialInstanceId)) {
        setSelectedInstanceId(initialInstanceId);
      } else {
        // 选择第一个属于当前工作流的实例
        const firstInstance = allInstances.find(inst => inst.workflowId === selectedWorkflowId);
        if (firstInstance) {
          setSelectedInstanceId(firstInstance.instanceId);
        }
      }
    }
  }, [open, allInstances, initialInstanceId, selectedWorkflowId, selectedInstanceId]);

  // 加载实例详情
  useEffect(() => {
    if (open && selectedInstanceId) {
      setLoading(true);
      loadInstanceDetails(selectedInstanceId).then(details => {
        if (details && details.nodeStates) {
          setNodeStates(details.nodeStates);
        } else {
          setNodeStates([]);
        }
        setLoading(false);
      });

      // 加载产出物
      if (window.electronAPI?.getWorkflowOutputs) {
        window.electronAPI.getWorkflowOutputs(selectedInstanceId).then((outputs: any[]) => {
          setOutputs(outputs);
        });
      }

      // 加载产出物统计
      if (window.electronAPI?.getWorkflowOutputStats) {
        window.electronAPI.getWorkflowOutputStats(selectedInstanceId).then((stats: { [type: string]: number }) => {
          setOutputStats(stats);
        });
      }
    }
  }, [open, selectedInstanceId, loadInstanceDetails]);

  const handleWorkflowChange = (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setSelectedInstanceId(''); // 清空实例选择
  };

  const handleInstanceChange = (instanceId: string) => {
    setSelectedInstanceId(instanceId);
  };

  const handleRefresh = () => {
    if (selectedInstanceId) {
      setLoading(true);
      loadInstanceDetails(selectedInstanceId).then(details => {
        if (details && details.nodeStates) {
          setNodeStates(details.nodeStates);
        } else {
          setNodeStates([]);
        }
        setLoading(false);
      });

      if (window.electronAPI?.getWorkflowOutputs) {
        window.electronAPI.getWorkflowOutputs(selectedInstanceId).then((outputs: any[]) => {
          setOutputs(outputs);
        });
      }

      if (window.electronAPI?.getWorkflowOutputStats) {
        window.electronAPI.getWorkflowOutputStats(selectedInstanceId).then((stats: { [type: string]: number }) => {
          setOutputStats(stats);
        });
      }
    }
  };

  // 拖动处理
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'H2') {
      setIsDragging(true);
      dragStartPos.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    }
  };

  // 删除当前实例
  const handleDeleteInstance = async () => {
    if (!selectedInstanceId) return;
    
    const confirmed = window.confirm(
      isZh 
        ? `确定要删除实例 ${selectedInstanceId.slice(0, 8)}... 吗？` 
        : `Are you sure you want to delete instance ${selectedInstanceId.slice(0, 8)}...?`
    );
    
    if (confirmed) {
      const success = await deleteInstance(selectedInstanceId);
      if (success) {
        setSelectedInstanceId('');
        setNodeStates([]);
        setOutputs([]);
        setOutputStats({});
      } else {
        alert(isZh ? '删除失败' : 'Delete failed');
      }
    }
  };

  // 删除所有实例
  const handleDeleteAllInstances = async () => {
    if (!selectedWorkflowId) return;
    
    const count = filteredInstances.length;
    const confirmed = window.confirm(
      isZh 
        ? `确定要删除该工作流的所有 ${count} 个实例吗？` 
        : `Are you sure you want to delete all ${count} instances of this workflow?`
    );
    
    if (confirmed) {
      const success = await deleteAllInstances(selectedWorkflowId);
      if (success) {
        setSelectedInstanceId('');
        setNodeStates([]);
        setOutputs([]);
        setOutputStats({});
      } else {
        alert(isZh ? '删除失败' : 'Delete failed');
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragStartPos.current.x,
        y: e.clientY - dragStartPos.current.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 过滤当前工作流的实例
  const filteredInstances = allInstances.filter(inst => inst.workflowId === selectedWorkflowId);

  const tabs = [
    { label: isZh ? '基本信息' : 'Basic Info', component: <InstanceBasicInfo instanceDetails={selectedInstanceDetails} nodeStates={nodeStates} onRefresh={handleRefresh} /> },
    { label: isZh ? '执行进度' : 'Progress', component: <InstanceExecutionProgress instanceDetails={selectedInstanceDetails} nodeStates={nodeStates} /> },
    { label: isZh ? '节点列表' : 'Nodes', component: <InstanceNodeList nodeStates={nodeStates} outputs={outputs} /> },
    { label: isZh ? '产出物目录' : 'Outputs', component: <InstanceOutputs outputs={outputs} outputStats={outputStats} /> },
    { label: isZh ? '变量数据' : 'Variables', component: <InstanceVariables instanceDetails={selectedInstanceDetails} /> },
    { label: isZh ? '错误日志' : 'Errors', component: <InstanceErrorLog instanceDetails={selectedInstanceDetails} nodeStates={nodeStates} /> },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10002]">
      <div
        ref={dialogRef}
        className="bg-gray-800 rounded-lg w-[75vw] h-[75vh] flex flex-col overflow-hidden shadow-2xl"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
      >
        {/* 标题栏 - 可拖动 */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-gray-700 cursor-move select-none"
          onMouseDown={handleMouseDown}
        >
          <h2 className="text-xl font-bold text-white">
            {isZh ? '工作流实例详情' : 'Workflow Instance Details'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title={isZh ? '关闭' : 'Close'}
          >
            ✕
          </button>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-700 bg-gray-800">
          {/* 工作流选择 */}
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">
              {isZh ? '工作流' : 'Workflow'}
            </label>
            <select
              value={selectedWorkflowId}
              onChange={(e) => handleWorkflowChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-indigo-500"
            >
              {workflows.map(workflow => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </div>

          {/* 实例选择 - 更宽 */}
          <div className="flex-[2]">
            <label className="block text-xs text-gray-400 mb-1">
              {isZh ? '实例' : 'Instance'}
            </label>
            <select
              value={selectedInstanceId}
              onChange={(e) => handleInstanceChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:border-indigo-500"
              style={{ minWidth: '300px' }}
            >
              {filteredInstances.length > 0 ? (
                filteredInstances.map(instance => (
                  <option key={instance.instanceId} value={instance.instanceId}>
                    {instance.instanceId} - {instance.status} ({instance.workflowName || instance.workflowId})
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  {isZh ? '暂无实例' : 'No instances'}
                </option>
              )}
            </select>
          </div>

          {/* 刷新按钮 */}
          <div className="flex items-end gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading || !selectedInstanceId}
              className={`px-4 py-2 rounded transition-colors ${
                loading || !selectedInstanceId
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {loading ? '⏳' : '🔄'} {isZh ? '刷新' : 'Refresh'}
            </button>
            
            {/* 删除当前实例 */}
            <button
              onClick={handleDeleteInstance}
              disabled={!selectedInstanceId}
              className={`px-4 py-2 rounded transition-colors ${
                !selectedInstanceId
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
              title={isZh ? '删除当前实例' : 'Delete current instance'}
            >
              🗑️ {isZh ? '删除' : 'Delete'}
            </button>
            
            {/* 清理所有实例 */}
            <button
              onClick={handleDeleteAllInstances}
              disabled={filteredInstances.length === 0}
              className={`px-4 py-2 rounded transition-colors ${
                filteredInstances.length === 0
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-orange-600 hover:bg-orange-500 text-white'
              }`}
              title={isZh ? '清理该工作流的所有实例' : 'Clear all instances of this workflow'}
            >
              🧹 {isZh ? '清理全部' : 'Clear All'}
            </button>
          </div>
        </div>

        {/* 标签页 */}
        <div className="flex border-b border-gray-700 bg-gray-800">
          {tabs.map((tab, index) => (
            <button
              key={index}
              onClick={() => setActiveTab(index)}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === index
                  ? 'text-white border-b-2 border-indigo-500 bg-gray-700'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto p-6 bg-gray-900">
          {tabs[activeTab].component}
        </div>
      </div>
    </div>
  );
};

export default WorkflowInstanceDetailDialog;
export { WorkflowInstanceDetailDialog };
