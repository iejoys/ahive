import React from 'react';

interface InstanceOutputsProps {
  outputs: any[];
  outputStats: { [type: string]: number };
}

const InstanceOutputs: React.FC<InstanceOutputsProps> = ({ outputs, outputStats }) => {
  if (outputs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-lg">
          暂无产出物数据
        </div>
      </div>
    );
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'document':
        return '📄';
      case 'directory':
        return '📁';
      case 'code':
        return '💻';
      case 'config':
        return '⚙️';
      default:
        return '📄';
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const totalStats = Object.values(outputStats).reduce((sum, count) => sum + count, 0);

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-4">产出物列表</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-600">
              <th className="text-left py-2 px-3 text-gray-400">#</th>
              <th className="text-left py-2 px-3 text-gray-400">名称</th>
              <th className="text-left py-2 px-3 text-gray-400">类型</th>
              <th className="text-left py-2 px-3 text-gray-400">大小</th>
              <th className="text-left py-2 px-3 text-gray-400">节点</th>
              <th className="text-left py-2 px-3 text-gray-400">时间</th>
            </tr>
          </thead>
          <tbody>
            {outputs.map((output, index) => (
              <tr key={output.id || index} className="border-b border-gray-700 hover:bg-gray-700/30">
                <td className="py-2 px-3 text-white">{index + 1}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <span>{getTypeIcon(output.outputType)}</span>
                    <span className="text-white">{output.outputName}</span>
                  </div>
                </td>
                <td className="py-2 px-3">
                  <span className="px-2 py-1 rounded text-sm bg-indigo-500/20 text-indigo-400">
                    {output.outputType}
                  </span>
                </td>
                <td className="py-2 px-3 text-white">{formatFileSize(output.fileSize)}</td>
                <td className="py-2 px-3 text-white">{output.nodeName || '-'}</td>
                <td className="py-2 px-3 text-white">
                  {new Date(output.createdAt).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 text-sm text-gray-400">
        统计: 共 {outputs.length} 个产出物
        {Object.entries(outputStats).map(([type, count]) => ` (${type}: ${count})`).join(',')}
      </div>
    </div>
  );
};

export default InstanceOutputs;
