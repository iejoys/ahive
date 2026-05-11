import { useStore } from '../../store/useStore';

/**
 * 内存监控数据接口
 */
interface MemoryData {
  category: 'memory';
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  heapUsedPercent: number;
  peakHeapUsedMB: number;
  averageHeapUsedMB: number;
  uptimeSeconds: number;
  isWarning: boolean;
  warningMessage?: string;
  systemTotalMB: number;
  systemUsedMB: number;
  systemMemoryPercent: number;
}

/**
 * 格式化内存大小
 */
function formatMemory(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`;
  }
  return `${Math.round(mb)}MB`;
}

/**
 * 内存监控进度条组件
 */
export function MemoryMonitorBar() {
  // 从 Store 读取内存数据和连接状态
  const memoryData = useStore((state) => state.memoryData) as MemoryData | null;
  const wsConnected = useStore((state) => state.wsConnected);

  // 格式化运行时间
  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // 计算进度条宽度百分比
  const getBarWidths = () => {
    if (!memoryData) {
      return { ahivecore: 0, systemOther: 0, free: 100 };
    }
    const total = memoryData.systemTotalMB;
    const ahivecore = memoryData.rssMB;
    const systemUsed = memoryData.systemUsedMB;
    const systemOther = systemUsed - ahivecore;
    const free = total - systemUsed;

    return {
      ahivecore: (ahivecore / total) * 100,
      systemOther: (systemOther / total) * 100,
      free: (free / total) * 100,
    };
  };

  const widths = getBarWidths();

  return (
    <div className="absolute top-0 left-0 right-0 z-50 bg-gray-900/95 border-b border-gray-700 px-4 py-2">
      <div className="flex items-center gap-4">
        {/* 连接状态 */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}
            title={wsConnected ? '已连接' : '未连接'}
          />
          <span className="text-xs text-gray-500">AHIVECORE</span>
        </div>

        {/* 三层堆叠进度条 */}
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-4 bg-gray-800/50 rounded-full overflow-hidden flex">
            {/* AHIVECORE 内存 - 蓝色 */}
            <div 
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${widths.ahivecore}%` }}
              title={`AHIVECORE: ${memoryData ? formatMemory(memoryData.rssMB) : '--'}`}
            />
            {/* 系统其他内存 - 橙色 */}
            <div 
              className="h-full bg-amber-500 transition-all duration-500"
              style={{ width: `${widths.systemOther}%` }}
              title={`系统其他: ${memoryData ? formatMemory(memoryData.systemUsedMB - memoryData.rssMB) : '--'}`}
            />
            {/* 剩余内存 - 绿色 */}
            <div 
              className="h-full bg-green-500/60 transition-all duration-500"
              style={{ width: `${widths.free}%` }}
              title={`可用: ${memoryData ? formatMemory(memoryData.systemTotalMB - memoryData.systemUsedMB) : '--'}`}
            />
          </div>
        </div>

        {/* 图例 */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-blue-500 rounded-sm" />
            <span className="text-gray-400">{memoryData ? formatMemory(memoryData.rssMB) : '--'}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-amber-500 rounded-sm" />
            <span className="text-gray-400">{memoryData ? formatMemory(memoryData.systemUsedMB - memoryData.rssMB) : '--'}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500/60 rounded-sm" />
            <span className="text-gray-400">{memoryData ? formatMemory(memoryData.systemTotalMB - memoryData.systemUsedMB) : '--'}</span>
          </div>
        </div>

        {/* 总内存 */}
        <div className="text-xs text-gray-500 border-l border-gray-700 pl-3">
          {memoryData ? formatMemory(memoryData.systemTotalMB) : '--'}
        </div>

        {/* 峰值 */}
        {memoryData && (
          <div className="text-xs text-gray-500 border-l border-gray-700 pl-3">
            峰值: {formatMemory(memoryData.peakHeapUsedMB)}
          </div>
        )}

        {/* 运行时间 */}
        {memoryData && (
          <div className="text-xs text-gray-500">
            {formatUptime(memoryData.uptimeSeconds)}
          </div>
        )}
      </div>
    </div>
  );
}

export default MemoryMonitorBar;