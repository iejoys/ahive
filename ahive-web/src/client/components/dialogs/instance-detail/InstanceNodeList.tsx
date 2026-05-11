import React, { useState } from 'react';

interface InstanceNodeListProps {
  nodeStates: any[];
  outputs: any[];
}

const InstanceNodeList: React.FC<InstanceNodeListProps> = ({ nodeStates, outputs }) => {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  if (nodeStates.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">
          暂无节点数据
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 text-green-400';
      case 'failed':
        return 'bg-red-500/20 text-red-400';
      case 'running':
        return 'bg-blue-500/20 text-blue-400';
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'running':
        return '🔄';
      case 'pending':
        return '⏳';
      default:
        return '○';
    }
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const formatJson = (data: any) => {
    if (!data) return '-';
    try {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        return JSON.stringify(parsed, null, 2);
      }
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const formatTime = (time: string | undefined) => {
    if (!time) return '-';
    try {
      return new Date(time).toLocaleString();
    } catch {
      return time;
    }
  };

  const formatDuration = (duration: number | undefined) => {
    if (!duration) return '-';
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-4">节点执行详情</h3>
      <div className="space-y-2">
        {nodeStates.map((node, index) => {
          const nodeOutputs = outputs.filter(o => o.nodeId === node.nodeId);
          const isExpanded = expandedNodes.has(node.nodeId);
          
          return (
            <div 
              key={`${node.nodeId}-${index}`} 
              className="bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden"
            >
              {/* 节点头部 - 基本信息行 */}
              <div 
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-700/70"
                onClick={() => toggleNode(node.nodeId)}
              >
                {/* 序号 */}
                <span className="text-gray-400 w-6 text-center">{index + 1}</span>
                
                {/* 状态图标 */}
                <span className="text-lg">{getStatusIcon(node.status)}</span>
                
                {/* 节点名称 */}
                <span className="text-white font-medium flex-1">
                  {node.nodeName || node.nodeId}
                </span>
                
                {/* 类型 */}
                <span className="text-gray-400 text-sm px-2 py-1 bg-gray-600/50 rounded">
                  {node.nodeType || 'unknown'}
                </span>
                
                {/* 状态标签 */}
                <span className={`px-2 py-1 rounded text-sm ${getStatusColor(node.status)}`}>
                  {node.status}
                </span>
                
                {/* 时长 */}
                <span className="text-gray-400 text-sm w-20 text-right">
                  {formatDuration(node.duration)}
                </span>
                
                {/* Agent */}
                <span className="text-gray-400 text-sm w-24 text-right truncate">
                  {node.agentName || '-'}
                </span>
                
                {/* 产出物数量 */}
                <span className="text-gray-400 text-sm w-16 text-right">
                  {nodeOutputs.length > 0 ? `${nodeOutputs.length} 📄` : '-'}
                </span>
                
                {/* 展开/折叠图标 */}
                <span className="text-gray-400 ml-2">
                  {isExpanded ? '▼' : '▶'}
                </span>
              </div>
              
              {/* 展开详情 */}
              {isExpanded && (
                <div className="border-t border-gray-600 p-4 space-y-3">
                  {/* 时间信息 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-gray-400 text-sm">开始时间:</span>
                      <span className="text-white ml-2">{formatTime(node.startedAt)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-sm">完成时间:</span>
                      <span className="text-white ml-2">{formatTime(node.completedAt)}</span>
                    </div>
                  </div>
                  
                  {/* Agent 信息 */}
                  {(node.agentId || node.agentName) && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-gray-400 text-sm">Agent ID:</span>
                        <span className="text-white ml-2 font-mono text-xs">{node.agentId || '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 text-sm">Agent 名称:</span>
                        <span className="text-white ml-2">{node.agentName || '-'}</span>
                      </div>
                    </div>
                  )}
                  
                  {/* 重试信息 */}
                  {(node.retryCount || node.maxRetries) && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-gray-400 text-sm">重试次数:</span>
                        <span className="text-white ml-2">{node.retryCount || 0}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 text-sm">最大重试:</span>
                        <span className="text-white ml-2">{node.maxRetries || 3}</span>
                      </div>
                    </div>
                  )}
                  
                  {/* 输入数据 */}
                  {node.input && (
                    <div>
                      <div className="text-gray-400 text-sm mb-1">📥 输入数据:</div>
                      <pre className="bg-gray-800 rounded p-3 text-xs text-gray-300 overflow-auto max-h-48 whitespace-pre-wrap">
                        {formatJson(node.input)}
                      </pre>
                    </div>
                  )}
                  
                  {/* 提示词 */}
                  {node.prompt && (
                    <div>
                      <div className="text-gray-400 text-sm mb-1">💬 提示词:</div>
                      <pre className="bg-gray-800 rounded p-3 text-xs text-gray-300 overflow-auto max-h-48 whitespace-pre-wrap">
                        {node.prompt}
                      </pre>
                    </div>
                  )}
                  
                  {/* 响应内容 */}
                  {node.response && (
                    <div>
                      <div className="text-gray-400 text-sm mb-1">📤 响应内容:</div>
                      <pre className="bg-gray-800 rounded p-3 text-xs text-gray-300 overflow-auto max-h-48 whitespace-pre-wrap">
                        {node.response}
                      </pre>
                    </div>
                  )}
                  
                  {/* 输出数据 */}
                  {node.output && (
                    <div>
                      <div className="text-gray-400 text-sm mb-1">✅ 输出数据:</div>
                      <pre className="bg-gray-800 rounded p-3 text-xs text-gray-300 overflow-auto max-h-48 whitespace-pre-wrap">
                        {formatJson(node.output)}
                      </pre>
                    </div>
                  )}
                  
                  {/* 错误信息 */}
                  {node.error && (
                    <div className="bg-red-500/10 rounded p-3 border border-red-500/30">
                      <div className="text-red-400 text-sm mb-1">❌ 错误信息:</div>
                      <pre className="text-red-300 text-xs overflow-auto whitespace-pre-wrap">
                        {node.error}
                      </pre>
                      {node.errorStack && (
                        <div className="mt-2">
                          <div className="text-red-400 text-sm mb-1">错误堆栈:</div>
                          <pre className="text-red-300 text-xs overflow-auto max-h-32 whitespace-pre-wrap">
                            {node.errorStack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* 子节点 */}
                  {node.childNodes && node.childNodes.length > 0 && (
                    <div>
                      <div className="text-gray-400 text-sm mb-1">🔗 子节点:</div>
                      <div className="flex flex-wrap gap-2">
                        {node.childNodes.map((child: string, idx: number) => (
                          <span key={idx} className="px-2 py-1 bg-gray-600/50 rounded text-xs text-gray-300">
                            {child}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* 产出物列表 */}
                  {nodeOutputs.length > 0 && (
                    <div>
                      <div className="text-gray-400 text-sm mb-2">📄 产出物 ({nodeOutputs.length}):</div>
                      <div className="space-y-1">
                        {nodeOutputs.map((output, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-xs bg-gray-600/30 rounded px-2 py-1">
                            <span className="text-gray-400">{output.outputType}</span>
                            <span className="text-white flex-1 truncate">{output.outputName}</span>
                            {output.outputPath && (
                              <span className="text-gray-500 truncate max-w-xs">{output.outputPath}</span>
                            )}
                            {output.fileSize && (
                              <span className="text-gray-400">
                                {(output.fileSize / 1024).toFixed(1)}KB
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InstanceNodeList;