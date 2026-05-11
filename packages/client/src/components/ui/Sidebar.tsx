import { useStore } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';
import { translations } from '../../i18n';
import { SettingsPanel } from './SettingsPanel';
import { DepartmentDialog } from '../dialogs/DepartmentDialog';
import type { TabType } from '../../types';

interface SidebarProps {
  onNewAgent?: () => void;
}

export function Sidebar({ onNewAgent }: SidebarProps) {
  const { 
    activeTab, 
    setActiveTab, 
    agents, 
    selectedAgentId, 
    selectAgent, 
    language, 
    showSettingsPanel, 
    setShowSettingsPanel 
  } = useStore();
  
  const dialog = useDialog();
  const tr = translations[language];
  const isZh = language === 'zh';

  const tabs: { id: TabType; labelKey: 'world' | 'skills' | 'tasks' | 'workflow' | 'logs'; icon: string }[] = [
    { id: 'world', labelKey: 'world', icon: '🌍' },
    { id: 'skills', labelKey: 'skills', icon: '🔌' },
    { id: 'tasks', labelKey: 'tasks', icon: '📋' },
    { id: 'workflow', labelKey: 'workflow', icon: '🔀' },
    { id: 'logs', labelKey: 'logs', icon: '📜' },
  ];

  const getStatusLabel = (status: string) => {
    return tr.status[status as keyof typeof tr.status] || status;
  };

  // 删除智能体
  const handleDeleteAgent = async () => {
    if (!selectedAgentId) return;
    const agent = agents.find(a => a.id === selectedAgentId);
    const confirmed = await dialog.confirm(
      isZh ? `确定要删除智能体 "${agent?.name}" 吗？` : `Delete agent "${agent?.name}"?`,
      isZh ? '删除确认' : 'Confirm Delete'
    );
    if (confirmed) {
      console.log('Delete agent:', selectedAgentId);
      await dialog.alert(isZh ? '删除功能开发中...' : 'Delete function coming soon...');
      selectAgent(null);
    }
  };

  return (
    <>
      <div className="w-14 bg-hive-surface flex flex-col items-center py-3 border-r border-hive-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg mb-1 transition-all ${
              activeTab === tab.id
                ? 'bg-hive-primary text-white'
                : 'text-hive-text hover:bg-hive-hover'
            }`}
            title={tr[tab.labelKey]}
          >
            {tab.icon}
          </button>
        ))}
        
        {/* 分割线 */}
        <div className="w-8 h-px bg-gray-600 my-2" />
        
        {/* 工具按钮 */}
        <div className="flex flex-col gap-1">
          {/* 新建智能体 */}
          <button
            onClick={() => onNewAgent?.()}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg text-hive-text hover:bg-hive-hover"
            title={isZh ? '新建智能体' : 'New Agent'}
          >
            ➕
          </button>
          
          {/* 删除智能体 */}
          <button
            onClick={handleDeleteAgent}
            disabled={!selectedAgentId}
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all ${
              selectedAgentId 
                ? 'text-red-400 hover:bg-hive-hover' 
                : 'text-gray-600 cursor-not-allowed'
            }`}
            title={isZh ? '删除智能体' : 'Delete Agent'}
          >
            🗑️
          </button>
          
          {/* 部门管理 */}
          <button
            onClick={() => {
              const event = new CustomEvent('open-department-dialog');
              window.dispatchEvent(event);
            }}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg text-hive-text hover:bg-hive-hover"
            title={isZh ? '部门管理' : 'Manage Departments'}
          >
            👥
          </button>
        </div>
        
        {/* 底部按钮 */}
        <div className="mt-auto flex flex-col gap-1">
          {/* 设置按钮 */}
          <button
            onClick={() => setShowSettingsPanel(true)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg text-hive-text hover:bg-hive-hover"
            title={isZh ? '设置' : 'Settings'}
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* 设置面板 */}
      <SettingsPanel 
        isOpen={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
      />

      {/* 部门管理弹窗 */}
      <DepartmentDialog />
    </>
  );
}