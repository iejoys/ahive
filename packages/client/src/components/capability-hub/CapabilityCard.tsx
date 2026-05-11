import { Handle, Position } from 'reactflow';
import type { Skill } from '../../types';
import { useStore } from '../../store/useStore';

interface SkillNodeProps {
  data: Skill;
}

const categoryColors: Record<string, string> = {
  core: '#6366f1',
  web: '#22c55e',
  data: '#f59e0b',
  ai: '#ec4899',
  system: '#8b5cf6',
};

const categoryLabels: Record<string, { zh: string; en: string }> = {
  core: { zh: '核心', en: 'Core' },
  web: { zh: '网页', en: 'Web' },
  data: { zh: '数据', en: 'Data' },
  ai: { zh: 'AI', en: 'AI' },
  system: { zh: '系统', en: 'System' },
};

export function CapabilityCard({ data }: SkillNodeProps) {
  const { language } = useStore();
  const color = categoryColors[data.category] || '#71717a';
  const categoryLabel = categoryLabels[data.category]?.[language] || data.category;

  return (
    <div className="px-4 py-3 rounded-lg bg-gray-800 border-2 min-w-[180px]" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Top} className="!bg-gray-600" />
      
      <div className="flex items-center gap-2">
        <span className="text-2xl">{data.icon}</span>
        <div>
          <div className="text-white font-medium">{data.name}</div>
          <div className="text-gray-400 text-xs">{data.description}</div>
        </div>
      </div>
      
      <div className="mt-2 flex items-center justify-between">
        <span 
          className="text-xs px-2 py-0.5 rounded"
          style={{ backgroundColor: color + '20', color }}
        >
          {categoryLabel}
        </span>
        <span className="text-xs text-gray-500">{data.installs.toLocaleString()}{language === 'zh' ? ' 次安装' : ' installs'}</span>
      </div>
      
      <Handle type="source" position={Position.Bottom} className="!bg-gray-600" />
    </div>
  );
}
