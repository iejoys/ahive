/**
 * 工作流执行日志面板
 * 用于查看、筛选和管理工作流执行记录
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';

// 类型定义
interface NodeExecutionLogEntry {
  nodeId: string;
  nodeName: string;
  agentId?: string;
  agentName?: string;
  timeline: {
    startedAt: string;
    completedAt?: string;
    duration?: number;
  };
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  input: {
    prompt: string;
    variables: string[];
  };
  output: {
    raw: string;
    extracted: Record<string, unknown>;
  };
  error?: string;
  retryCount: number;
}

interface WorkflowExecutionLog {
  logId: string;
  instanceId: string;
  workflowId: string;
  workflowName: string;
  triggerType: 'manual' | 'scheduled' | 'api';
  triggeredBy?: string;
  timeline: {
    startedAt: string;
    completedAt?: string;
    duration?: number;
  };
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  nodes: NodeExecutionLogEntry[];
  error?: string;
}

interface WorkflowLogIndexEntry {
  logId: string;
  workflowId: string;
  workflowName: string;
  startedAt: string;
  completedAt?: string;
  status: string;
  duration?: number;
  nodeCount: number;
  errorCount: number;
  filePath: string;
}

// 状态样式映射
const STATUS_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '✓' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400', icon: '✗' },
  running: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '◐' },
  paused: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: '⏸' },
  cancelled: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: '⊘' },
};

// 格式化持续时间
function formatDuration(ms?: number): string {
  if (!ms) return '-';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// 格式化时间
function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 格式化日期
function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
export function WorkflowLogPanel() {
  const { workflows, language } = useStore();
  const dialog = useDialog();
  
  // 状态
  const [logs, setLogs] = useState<WorkflowLogIndexEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<WorkflowExecutionLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({
    workflowId: '',
    status: '',
  });
  const [stats, setStats] = useState({
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
  });
  
  // 检测是否在 Electron 环境
  const isDesktop = typeof window !== 'undefined' && 
    (window as any).electronAPI?.isDesktop;
  
  // 加载日志列表
  const loadLogs = useCallback(async () => {
    console.log('[WorkflowLogPanel] loadLogs called, isDesktop:', isDesktop);
    
    if (!isDesktop) {
      // Web 版暂无日志功能
      console.log('[WorkflowLogPanel] Not desktop, skipping');
      return;
    }
    
    setLoading(true);
    try {
      console.log('[WorkflowLogPanel] Calling getWorkflowExecutionLogs...');
      const result = await (window as any).electronAPI.getWorkflowExecutionLogs({
        workflowId: filter.workflowId || undefined,
        status: filter.status || undefined,
        limit: 100,
      });
      console.log('[WorkflowLogPanel] getWorkflowExecutionLogs result:', result);
      setLogs(result || []);
      
      // 加载统计
      console.log('[WorkflowLogPanel] Calling getWorkflowLogStats...');
      const statsResult = await (window as any).electronAPI.getWorkflowLogStats();
      console.log('[WorkflowLogPanel] getWorkflowLogStats result:', statsResult);
      if (statsResult) {
        setStats({
          totalRuns: statsResult.totalRuns || 0,
          successfulRuns: statsResult.successfulRuns || 0,
          failedRuns: statsResult.failedRuns || 0,
        });
      }
    } catch (error) {
      console.error('[WorkflowLogPanel] Failed to load logs:', error);
    } finally {
      setLoading(false);
    }
  }, [isDesktop, filter]);
  
  // 加载日志详情
  const loadLogDetail = async (logId: string) => {
    if (!isDesktop) return;
    
    try {
      const result = await (window as any).electronAPI.getWorkflowExecutionLog(logId);
      setSelectedLog(result || null);
    } catch (error) {
      console.error('[WorkflowLogPanel] Failed to load log detail:', error);
    }
  };
  
  // 删除日志
  const deleteLog = async (logId: string) => {
    if (!isDesktop) return;
    
    const confirmed = await dialog.confirm(
      language === 'zh' ? '确定要删除此日志吗？' : 'Are you sure you want to delete this log?',
      language === 'zh' ? '删除确认' : 'Confirm Delete'
    );
    if (!confirmed) return;
    
    try {
      await (window as any).electronAPI.deleteWorkflowExecutionLog(logId);
      setLogs(logs.filter(l => l.logId !== logId));
      if (selectedLog?.logId === logId) {
        setSelectedLog(null);
      }
    } catch (error) {
      console.error('[WorkflowLogPanel] Failed to delete log:', error);
    }
  };
  
  // 清理过期日志
  const cleanupOldLogs = async () => {
    if (!isDesktop) return;
    
    const confirmed = await dialog.confirm(
      language === 'zh' ? '确定要清理30天前的旧日志吗？' : 'Clean up logs older than 30 days?',
      language === 'zh' ? '清理确认' : 'Confirm Cleanup'
    );
    if (!confirmed) return;
    
    try {
      const cleaned = await (window as any).electronAPI.cleanupWorkflowExecutionLogs(30);
      await dialog.alert(
        language === 'zh' ? `已清理 ${cleaned} 条旧日志` : `Cleaned ${cleaned} old logs`,
        language === 'zh' ? '清理完成' : 'Cleanup Complete'
      );
      loadLogs();
    } catch (error) {
      console.error('[WorkflowLogPanel] Failed to cleanup logs:', error);
    }
  };
  
  // 初始加载
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);
  
  // 文案
  const texts = {
    zh: {
      title: '📋 工作流执行日志',
      filter: '筛选',
      workflow: '工作流',
      status: '状态',
      all: '全部',
      search: '搜索',
      cleanupOldLogs: '🗑️ 清理旧日志',
      refresh: '🔄 刷新',
      startTime: '开始时间',
      duration: '耗时',
      nodeCount: '节点数',
      actions: '操作',
      view: '查看',
      delete: '删除',
      noLogs: '暂无执行日志',
      nodeDetails: '节点执行详情',
      agent: 'Agent',
      retry: '重试',
      agentFeedback: 'Agent 反馈',
      stats: '统计',
      totalRuns: '总执行次数',
      successfulRuns: '成功次数',
      failedRuns: '失败次数',
      webVersionNote: 'Web 版本暂不支持日志功能，请使用 Electron 客户端',
    },
    en: {
      title: '📋 Workflow Execution Logs',
      filter: 'Filter',
      workflow: 'Workflow',
      status: 'Status',
      all: 'All',
      search: 'Search',
      cleanupOldLogs: '🗑️ Cleanup Old Logs',
      refresh: '🔄 Refresh',
      startTime: 'Start Time',
      duration: 'Duration',
      nodeCount: 'Nodes',
      actions: 'Actions',
      view: 'View',
      delete: 'Delete',
      noLogs: 'No execution logs',
      nodeDetails: 'Node Execution Details',
      agent: 'Agent',
      retry: 'Retry',
      agentFeedback: 'Agent Feedback',
      stats: 'Statistics',
      totalRuns: 'Total Runs',
      successfulRuns: 'Successful',
      failedRuns: 'Failed',
      webVersionNote: 'Web version does not support log feature, please use Electron client',
    },
  };
  
  const t = texts[language] || texts.zh;
  
  // Web 版本提示
  if (!isDesktop) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-hive-text-secondary">
        <div className="text-6xl mb-4 opacity-50">📜</div>
        <p>{t.webVersionNote}</p>
      </div>
    );
  }
  
  return (
    <div className="flex h-full flex-col bg-hive-bg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 bg-hive-surface border-b border-hive-border">
        <h2 className="text-lg font-semibold text-hive-text flex items-center gap-2">
          📜 {language === 'zh' ? '执行日志' : 'Execution Logs'}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={loadLogs}
            className="px-3 py-1.5 text-sm bg-hive-bg border border-hive-border rounded-lg text-hive-text-secondary hover:text-hive-text hover:border-hive-primary transition-colors"
          >
            🔄 {t.refresh}
          </button>
          <button
            onClick={async () => {
              if (!isDesktop) return;
              try {
                const rebuilt = await (window as any).electronAPI.rebuildWorkflowLogIndex();
                alert(language === 'zh' ? `已重建索引，恢复 ${rebuilt} 条日志` : `Rebuilt index, restored ${rebuilt} logs`);
                loadLogs();
              } catch (err) {
                console.error('[WorkflowLogPanel] Failed to rebuild index:', err);
              }
            }}
            className="px-3 py-1.5 text-sm bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 hover:bg-yellow-500/20 transition-colors"
          >
            🔧 {language === 'zh' ? '重建索引' : 'Rebuild'}
          </button>
          <button
            onClick={cleanupOldLogs}
            className="px-3 py-1.5 text-sm bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors"
          >
            🗑️ {language === 'zh' ? '清理' : 'Cleanup'}
          </button>
        </div>
      </div>
      
      {/* 统计栏 */}
      <div className="flex items-center gap-6 px-4 py-2 bg-hive-surface/50 border-b border-hive-border text-sm">
        <span className="text-hive-text-secondary">{t.stats}:</span>
        <span className="text-hive-text">{t.totalRuns}: <strong className="text-hive-primary">{stats.totalRuns}</strong></span>
        <span className="text-green-400">{t.successfulRuns}: <strong>{stats.successfulRuns}</strong></span>
        <span className="text-red-400">{t.failedRuns}: <strong>{stats.failedRuns}</strong></span>
      </div>
      
      {/* 筛选栏 */}
      <div className="flex gap-3 px-4 py-3 bg-hive-surface/30 border-b border-hive-border">
        <select
          value={filter.workflowId}
          onChange={(e) => setFilter({ ...filter, workflowId: e.target.value })}
          className="px-3 py-1.5 bg-hive-bg border border-hive-border rounded-lg text-hive-text text-sm focus:border-hive-primary outline-none"
        >
          <option value="">{t.all} {t.workflow}</option>
          {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="px-3 py-1.5 bg-hive-bg border border-hive-border rounded-lg text-hive-text text-sm focus:border-hive-primary outline-none"
        >
          <option value="">{t.all} {t.status}</option>
          <option value="completed">✓ {language === 'zh' ? '已完成' : 'Completed'}</option>
          <option value="failed">✗ {language === 'zh' ? '失败' : 'Failed'}</option>
          <option value="running">◐ {language === 'zh' ? '运行中' : 'Running'}</option>
        </select>
      </div>
      
      {/* 日志列表 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-hive-text-secondary">
            {language === 'zh' ? '加载中...' : 'Loading...'}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-hive-text-secondary">
            <div className="text-4xl mb-2 opacity-50">📭</div>
            {t.noLogs}
          </div>
        ) : (
          <div className="divide-y divide-hive-border">
            {logs.map((log) => {
              const style = STATUS_STYLES[log.status] || STATUS_STYLES.cancelled;
              return (
                <div
                  key={log.logId}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-hive-hover transition-colors group"
                >
                  {/* 状态图标 */}
                  <div className={`w-8 h-8 rounded-lg ${style.bg} flex items-center justify-center ${style.text} font-bold`}>
                    {style.icon}
                  </div>
                  
                  {/* 工作流名称 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-hive-text font-medium truncate">{log.workflowName}</div>
                    <div className="text-hive-text-secondary text-xs mt-0.5">
                      {formatDate(log.startedAt)} {formatTime(log.startedAt)}
                    </div>
                  </div>
                  
                  {/* 耗时 */}
                  <div className="text-hive-text-secondary text-sm w-16 text-right">
                    {formatDuration(log.duration)}
                  </div>
                  
                  {/* 节点数 */}
                  <div className="text-hive-text-secondary text-sm w-16 text-right">
                    {log.nodeCount} {language === 'zh' ? '节点' : 'nodes'}
                    {log.errorCount > 0 && <span className="text-red-400 ml-1">({log.errorCount}✗)</span>}
                  </div>
                  
                  {/* 操作按钮 */}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => loadLogDetail(log.logId)}
                      className="px-2 py-1 text-xs bg-hive-primary/20 text-hive-primary rounded hover:bg-hive-primary/30 transition-colors"
                    >
                      {t.view}
                    </button>
                    <button
                      onClick={() => deleteLog(log.logId)}
                      className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                    >
                      {t.delete}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* 日志详情面板 */}
      {selectedLog && (
        <div className="border-t border-hive-border bg-hive-surface">
          <div className="flex items-center justify-between px-4 py-2 border-b border-hive-border">
            <h3 className="text-sm font-medium text-hive-text">{t.nodeDetails}</h3>
            <button
              onClick={() => setSelectedLog(null)}
              className="text-hive-text-secondary hover:text-hive-text transition-colors"
            >
              ✕
            </button>
          </div>
          
          <div className="max-h-48 overflow-auto p-3">
            <div className="space-y-2">
              {selectedLog.nodes.map((node) => {
                const style = STATUS_STYLES[node.status] || STATUS_STYLES.cancelled;
                return (
                  <div key={node.nodeId} className="flex items-center gap-3 px-3 py-2 bg-hive-bg rounded-lg">
                    <div className={`w-6 h-6 rounded ${style.bg} flex items-center justify-center ${style.text} text-xs font-bold`}>
                      {style.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-hive-text text-sm truncate">{node.nodeName}</div>
                      {node.agentName && <div className="text-hive-text-secondary text-xs">{node.agentName}</div>}
                    </div>
                    <div className="text-hive-text-secondary text-xs">{formatDuration(node.timeline.duration)}</div>
                    {node.retryCount > 0 && <div className="text-yellow-400 text-xs">↻{node.retryCount}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}