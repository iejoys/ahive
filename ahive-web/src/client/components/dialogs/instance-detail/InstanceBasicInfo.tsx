import React, { useMemo, useState } from 'react';

interface InstanceBasicInfoProps {
  instanceDetails: any;
  nodeStates: any[];
  onRefresh?: () => void;
}

const InstanceBasicInfo: React.FC<InstanceBasicInfoProps> = ({ instanceDetails, nodeStates, onRefresh }) => {
  const [operating, setOperating] = useState(false);
  
  if (!instanceDetails) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">
          请选择一个实例
        </div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'paused':
        return '⏸️';
      case 'running':
        return '▶️';
      default:
        return '⏳';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'paused':
        return 'text-yellow-400';
      case 'running':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const formatDuration = (start: string, end?: string, interrupt?: string, status?: string, updated?: string) => {
    const startTime = new Date(start).getTime();
    // 根据状态确定结束时间
    let endTime: number | null = null;
    
    if (status === 'completed') {
      // 完成状态：优先使用 completedAt，fallback 到 updatedAt
      endTime = end ? new Date(end).getTime() : (updated ? new Date(updated).getTime() : null);
    } else if (status === 'failed' || status === 'paused') {
      // 失败/暂停状态：优先使用 interruptAt，fallback 到 updatedAt
      endTime = interrupt ? new Date(interrupt).getTime() : (updated ? new Date(updated).getTime() : null);
    } else if (status === 'running') {
      // 运行中：使用当前时间
      endTime = Date.now();
    }
    
    // 如果无法确定结束时间，返回未知
    if (endTime === null) {
      return '未知';
    }
    
    const duration = (endTime - startTime) / 1000;
    return `${duration.toFixed(3)} 秒`;
  };

  const nodeStats = {
    total: nodeStates.length,
    completed: nodeStates.filter(n => n.status === 'completed').length,
    running: nodeStates.filter(n => n.status === 'running').length,
    failed: nodeStates.filter(n => n.status === 'failed').length,
    skipped: nodeStates.filter(n => n.status === 'skipped').length,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* 实例信息 */}
      <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">实例信息</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-400">实例ID:</span>
            <span className="text-white font-mono">{instanceDetails.instanceId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">工作流:</span>
            <span className="text-white">{instanceDetails.workflowName || instanceDetails.workflowId}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">状态:</span>
            <div className="flex items-center gap-2">
              <span>{getStatusIcon(instanceDetails.status)}</span>
              <span className={`px-2 py-1 rounded text-sm ${getStatusColor(instanceDetails.status)}`}>
                {instanceDetails.status}
              </span>
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">触发方式:</span>
            <span className="text-white">{instanceDetails.triggeredBy || '手动触发'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">开始时间:</span>
            <span className="text-white">{new Date(instanceDetails.startedAt).toLocaleString()}</span>
          </div>
          {instanceDetails.completedAt && (
            <div className="flex justify-between">
              <span className="text-gray-400">结束时间:</span>
              <span className="text-white">{new Date(instanceDetails.completedAt).toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-400">执行时长:</span>
            <span className="text-white">
              {formatDuration(instanceDetails.startedAt, instanceDetails.completedAt, instanceDetails.interruptAt, instanceDetails.status, instanceDetails.updatedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* 执行统计 */}
      <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">执行统计</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-400">总节点数:</span>
            <span className="text-white">{nodeStats.total}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">已完成:</span>
            <div className="flex items-center gap-2">
              <span className="text-white">{nodeStats.completed}</span>
              <span className="text-green-400">✅</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">执行中:</span>
            <div className="flex items-center gap-2">
              <span className="text-white">{nodeStats.running}</span>
              <span className="text-blue-400">▶️</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">失败:</span>
            <div className="flex items-center gap-2">
              <span className="text-white">{nodeStats.failed}</span>
              <span className="text-red-400">❌</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">跳过:</span>
            <div className="flex items-center gap-2">
              <span className="text-white">{nodeStats.skipped}</span>
              <span className="text-gray-400">⏳</span>
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮区域 */}
      {(instanceDetails.status === 'paused' || instanceDetails.status === 'running') && (
        <div className="col-span-2 bg-gray-700/50 rounded-lg p-4 border border-gray-600">
          <h3 className="text-lg font-semibold text-white mb-4">🎮 实例操作</h3>
          <div className="flex gap-4 flex-wrap">
            {/* 接续执行按钮 - 仅对 paused 状态显示 */}
            {instanceDetails.status === 'paused' && (
              <button
                onClick={async () => {
                  if (operating) return;
                  setOperating(true);
                  try {
                    const result = await window.electronAPI?.resumeWorkflow?.(instanceDetails.instanceId);
                    if (result) {
                      alert('接续执行成功！工作流已恢复运行。');
                      onRefresh?.();
                    } else {
                      alert('接续执行失败，请检查日志。');
                    }
                  } catch (error: any) {
                    alert(`接续执行错误: ${error.message}`);
                  } finally {
                    setOperating(false);
                  }
                }}
                disabled={operating}
                className={`px-4 py-2 rounded transition-colors flex items-center gap-2 ${
                  operating
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-500 text-white'
                }`}
                title="接续执行暂停的工作流"
              >
                ▶️ 接续执行
              </button>
            )}
            
            {/* 强制关闭按钮 - 对 running/paused 状态显示 */}
            {(instanceDetails.status === 'running' || instanceDetails.status === 'paused') && (
              <button
                onClick={async () => {
                  if (operating) return;
                  const confirmed = window.confirm('确定要强制关闭此工作流实例吗？这将停止当前执行并将状态标记为失败。');
                  if (!confirmed) return;
                  
                  setOperating(true);
                  try {
                    const result = await window.electronAPI?.stopWorkflow?.(instanceDetails.instanceId);
                    if (result) {
                      alert('强制关闭成功！实例已停止。');
                      onRefresh?.();
                    } else {
                      alert('强制关闭失败，请检查日志。');
                    }
                  } catch (error: any) {
                    alert(`强制关闭错误: ${error.message}`);
                  } finally {
                    setOperating(false);
                  }
                }}
                disabled={operating}
                className={`px-4 py-2 rounded transition-colors flex items-center gap-2 ${
                  operating
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-red-600 hover:bg-red-500 text-white'
                }`}
                title="强制关闭工作流实例"
              >
                ⏹️ 强制关闭
              </button>
            )}
            
            {/* 标记为失败按钮 - 对 running 状态显示（僵尸实例清理） */}
            {instanceDetails.status === 'running' && (
              <button
                onClick={async () => {
                  if (operating) return;
                  const confirmed = window.confirm('此实例可能已停止响应（僵尸实例）。确定要将其标记为失败状态吗？这只会更新数据库状态，不会停止实际执行。');
                  if (!confirmed) return;
                  
                  setOperating(true);
                  try {
                    const result = await window.electronAPI?.forceStopWorkflow?.(instanceDetails.instanceId);
                    if (result) {
                      alert('标记失败成功！实例状态已更新。');
                      onRefresh?.();
                    } else {
                      alert('标记失败失败，请检查日志。');
                    }
                  } catch (error: any) {
                    alert(`标记失败错误: ${error.message}`);
                  } finally {
                    setOperating(false);
                  }
                }}
                disabled={operating}
                className={`px-4 py-2 rounded transition-colors flex items-center gap-2 ${
                  operating
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-orange-600 hover:bg-orange-500 text-white'
                }`}
                title="标记为失败（清理僵尸实例）"
              >
                ⚠️ 标记失败
              </button>
            )}
          </div>
          
          {/* 操作提示 */}
          <div className="mt-4 text-sm text-gray-400">
            {instanceDetails.status === 'paused' && (
              <p>💡 提示：接续执行将恢复暂停的工作流，从上次中断的节点继续执行。</p>
            )}
            {instanceDetails.status === 'running' && (
              <p>💡 提示：如果实例长时间无响应，可能是僵尸进程。可使用"标记失败"清理状态。</p>
            )}
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {instanceDetails.status === 'failed' && instanceDetails.interruptReason && (
        <div className="col-span-2 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-red-400 mb-4">❌ 错误信息</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-red-400">❌</span>
              <span className="text-white">{instanceDetails.interruptReason}</span>
            </div>
            {instanceDetails.currentNodeName && (
              <div className="flex gap-2">
                <span className="text-gray-400">节点:</span>
                <span className="text-white">{instanceDetails.currentNodeName}</span>
              </div>
            )}
            {instanceDetails.interruptAt && (
              <div className="flex gap-2">
                <span className="text-gray-400">时间:</span>
                <span className="text-white">{new Date(instanceDetails.interruptAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default InstanceBasicInfo;
