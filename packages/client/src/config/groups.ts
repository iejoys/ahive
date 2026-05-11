// 智能体类型配置
export const AGENT_TYPES = [
  { 
    id: 'openclaw', 
    name: 'OpenClaw', 
    nameEn: 'OpenClaw',
    description: '通用AI助手，支持多种任务', 
    descriptionEn: 'General AI assistant, supports multiple tasks',
    icon: '🦞',
    defaultCommand: 'openclaw agent'
  },
  { 
    id: 'opencode', 
    name: 'OpenCode', 
    nameEn: 'OpenCode',
    description: '代码生成与调试专家', 
    descriptionEn: 'Code generation & debugging expert',
    icon: '💻',
    defaultCommand: 'opencode run'
  },
  { 
    id: 'claude', 
    name: 'Claude', 
    nameEn: 'Claude',
    description: 'Claude AI 对话', 
    descriptionEn: 'Claude AI conversation',
    icon: '🧠',
    defaultCommand: 'claude'
  },
  { 
    id: 'custom', 
    name: 'Custom', 
    nameEn: 'Custom',
    description: '自定义API端点', 
    descriptionEn: 'Custom API endpoint',
    icon: '⚙️',
    defaultCommand: ''
  },
];

// 分组配置 - 与任务角色挂钩
export interface Group {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  descriptionEn: string;
  defaultType: 'opencode' | 'mcp' | 'custom' | 'mock';
}

export const GROUPS: Group[] = [
  { 
    id: 'code', 
    name: '编码组', 
    nameEn: 'Code',
    icon: '💻', 
    description: '代码生成与调试', 
    descriptionEn: 'Code generation & debugging',
    defaultType: 'opencode' 
  },
  { 
    id: 'search', 
    name: '搜索组', 
    nameEn: 'Search',
    icon: '🔍', 
    description: '信息搜索与收集', 
    descriptionEn: 'Information search & collection',
    defaultType: 'mcp' 
  },
  { 
    id: 'analyze', 
    name: '分析组', 
    nameEn: 'Analyze',
    icon: '📊', 
    description: '数据分析与报告', 
    descriptionEn: 'Data analysis & reporting',
    defaultType: 'mcp' 
  },
  { 
    id: 'general', 
    name: '通用组', 
    nameEn: 'General',
    icon: '🎭', 
    description: '通用对话与任务', 
    descriptionEn: 'General conversation & tasks',
    defaultType: 'mock' 
  },
];

// 形象选项
export const AVATARS = [
  { id: 'coder', icon: '💻', label: '程序员', labelEn: 'Coder' },
  { id: 'mcp', icon: '🔌', label: '工具专家', labelEn: 'Tool Expert' },
  { id: 'general', icon: '🎭', label: '通用', labelEn: 'General' },
  { id: 'robot', icon: '🤖', label: '机器人', labelEn: 'Robot' },
];

export function getGroupById(id: string): Group | undefined {
  return GROUPS.find(g => g.id === id);
}

export function getAvatarById(id: string) {
  return AVATARS.find(a => a.id === id);
}
