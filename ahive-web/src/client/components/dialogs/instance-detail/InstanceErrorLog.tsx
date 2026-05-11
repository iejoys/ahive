import React from 'react';

interface InstanceErrorLogProps {
  instanceDetails: any;
  nodeStates: any[];
}

const InstanceErrorLog: React.FC<InstanceErrorLogProps> = ({ instanceDetails, nodeStates }) => {
  if (!instanceDetails || instanceDetails.status !== 'failed') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">
          暂无错误信息
        </div>
      </div>
    );
  }

  const failedNodes = nodeStates.filter(n => n.status === 'failed');

  const handleCopy = () => {
    const text = `错误类型: ${instanceDetails.interruptReason || 'Unknown'}\n` +
      `错误消息: ${instanceDetails.interruptReason || 'No message'}\n` +
      `发生节点: ${instanceDetails.currentNodeName || 'Unknown'}\n` +
      `发生时间: ${instanceDetails.interruptAt || instanceDetails.completedAt || 'Unknown'}\n` +
      `错误堆栈:\n${instanceDetails.interruptStack || 'No stack trace'}`;
    navigator.clipboard.writeText(text);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-4">错误详情</h3>

      {/* 主要错误信息 */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <span className="text-gray-400">错误类型:</span>
            <span className="text-white">WorkflowExecutionError</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400">错误消息:</span>
            <span className="text-white">{instanceDetails.interruptReason || 'Unknown error'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400">发生节点:</span>
            <span className="text-white">{instanceDetails.currentNodeName || 'Unknown'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-gray-400">发生时间:</span>
            <span className="text-white">
              {new Date(instanceDetails.interruptAt || instanceDetails.completedAt).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* 错误堆栈 */}
      {instanceDetails.interruptStack && (
        <div className="bg-gray-700/50 rounded-lg p-4 mb-4 border border-gray-600">
          <h4 className="text-md font-semibold text-white mb-2">错误堆栈</h4>
          <pre className="overflow-auto max-h-72 p-4 bg-gray-900/50 rounded text-sm text-white font-mono">
            {instanceDetails.interruptStack}
          </pre>
        </div>
      )}

      {/* 失败节点 */}
      {failedNodes.length > 0 && (
        <div className="mb-4">
          <h4 className="text-md font-semibold text-white mb-2">失败节点</h4>
          <div className="space-y-2">
            {failedNodes.map((node, index) => (
              <div key={`${node.nodeId}-${index}`} className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-red-400">❌</span>
                  <span className="text-white">{node.nodeName || node.nodeId}</span>
                </div>
                {node.error && (
                  <div className="text-red-400 text-sm mt-1">
                    {node.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 复制按钮 */}
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
        >
          📋 复制错误
        </button>
      </div>
    </div>
  );
};

export default InstanceErrorLog;
