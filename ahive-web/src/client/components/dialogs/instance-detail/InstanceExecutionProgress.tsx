import React from 'react';

interface InstanceExecutionProgressProps {
  instanceDetails: any;
  nodeStates: any[];
}

const InstanceExecutionProgress: React.FC<InstanceExecutionProgressProps> = ({ instanceDetails, nodeStates }) => {
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
      case 'running':
        return '▶️';
      default:
        return '⏳';
    }
  };

  const executionPath = instanceDetails.executionPath || [];
  const completedCount = nodeStates.filter(n => n.status === 'completed').length;
  const totalNodes = nodeStates.length;
  const progress = totalNodes > 0 ? (completedCount / totalNodes) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* 执行路径 */}
      <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">执行路径</h3>
        <div className="space-y-2">
          {executionPath.map((nodeId: string, index: number) => {
            const node = nodeStates.find(n => n.nodeId === nodeId);
            return (
              <div key={`${nodeId}-${index}`} className="flex items-center gap-2">
                <span className="text-gray-400 w-8">{index + 1}.</span>
                <span className="text-white">{node?.nodeName || nodeId}</span>
                {node && <span>{getStatusIcon(node.status)}</span>}
                {node?.status === 'failed' && (
                  <span className="text-red-400 text-sm">(失败)</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 进度条 */}
      <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">进度条</h3>
        <div className="space-y-2">
          <div className="w-full h-3 bg-gray-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-sm text-gray-400">
            {progress.toFixed(0)}% ({completedCount}/{totalNodes})
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstanceExecutionProgress;
