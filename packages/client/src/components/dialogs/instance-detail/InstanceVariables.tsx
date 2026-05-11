import React from 'react';

interface InstanceVariablesProps {
  instanceDetails: any;
}

const InstanceVariables: React.FC<InstanceVariablesProps> = ({ instanceDetails }) => {
  if (!instanceDetails || !instanceDetails.variables) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">
          暂无变量数据
        </div>
      </div>
    );
  }

  const handleCopy = () => {
    const text = JSON.stringify(instanceDetails.variables, null, 2);
    navigator.clipboard.writeText(text);
  };

  const handleExport = () => {
    const text = JSON.stringify(instanceDetails.variables, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `variables-${instanceDetails.instanceId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-4">工作流变量</h3>
      <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
        <pre className="overflow-auto max-h-96 p-4 bg-gray-900/50 rounded text-sm text-white font-mono">
          {JSON.stringify(instanceDetails.variables, null, 2)}
        </pre>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={handleCopy}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
        >
          📋 复制变量
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
        >
          💾 导出为JSON
        </button>
      </div>
    </div>
  );
};

export default InstanceVariables;
