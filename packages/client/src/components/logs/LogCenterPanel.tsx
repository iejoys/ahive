/**
 * 日志管理中心
 * 集成工作流日志、系统日志等多种日志类型
 */

import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { WorkflowLogTab } from './WorkflowLogTab';
import { SystemLogTab } from './SystemLogTab';

type LogTabType = 'workflow' | 'system' | 'service';

export function LogCenterPanel() {
  const { language } = useStore();
  const [activeTab, setActiveTab] = useState<LogTabType>('workflow');

  // 检测是否在 Electron 环境
  const isDesktop = typeof window !== 'undefined' &&
    (window as any).electronAPI?.isDesktop;

  const tabs: { id: LogTabType; label: string; icon: string }[] = [
    { id: 'workflow', label: language === 'zh' ? '工作流日志' : 'Workflow Logs', icon: '🔄' },
    { id: 'system', label: language === 'zh' ? '系统日志' : 'System Logs', icon: '💻' },
    // { id: 'service', label: language === 'zh' ? '服务日志' : 'Service Logs', icon: '🔌' }, // 预留
  ];

  // Web 版本提示
  if (!isDesktop) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-hive-text-secondary">
        <div className="text-6xl mb-4 opacity-50">📜</div>
        <p>{language === 'zh' ? 'Web 版本暂不支持日志功能，请使用 Electron 客户端' : 'Web version does not support log feature, please use Electron client'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-hive-bg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 bg-hive-surface border-b border-hive-border">
        <h2 className="text-lg font-semibold text-hive-text flex items-center gap-2">
          📜 {language === 'zh' ? '日志管理中心' : 'Log Center'}
        </h2>
      </div>

      {/* Tab 栏 */}
      <div className="flex gap-1 px-4 py-2 bg-hive-surface/50 border-b border-hive-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-hive-primary text-white'
                : 'text-hive-text-secondary hover:text-hive-text hover:bg-hive-hover'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'workflow' && <WorkflowLogTab />}
        {activeTab === 'system' && <SystemLogTab />}
        {/* {activeTab === 'service' && <ServiceLogTab />} */}
      </div>
    </div>
  );
}