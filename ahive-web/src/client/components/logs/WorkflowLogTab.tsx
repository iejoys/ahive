/**
 * 工作流执行日志 Tab
 * 重构自 WorkflowLogPanel，作为日志中心的一个 Tab
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

export function WorkflowLogTab() {
  const { workflows, language } = useStore();
  const dialog = useDialog();

  // 状态
  const [logs, setLogs] = useState<WorkflowLogIndexEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<WorkflowExecutionLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
    if (!isDesktop) return;

    setLoading(true);
    try {
      const result = await (window as any).electronAPI.getWorkflowExecutionLogs({
        workflowId: filter.workflowId || undefined,
        status: filter.status || undefined,
        limit: 100,
      });
      setLogs(result || []);

      // 加载统计
      const statsResult = await (window as any).electronAPI.getWorkflowLogStats();
      if (statsResult) {
        setStats({
          totalRuns: statsResult.totalRuns || 0,
          successfulRuns: statsResult.successfulRuns || 0,
          failedRuns: statsResult.failedRuns || 0,
        });
      }
    } catch (error) {
      console.error('[WorkflowLogTab] Failed to load logs:', error);
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
      console.error('[WorkflowLogTab] Failed to load log detail:', error);
    }
  };

  // 删除单个日志
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
      console.error('[WorkflowLogTab] Failed to delete log:', error);
    }
  };

  // 批量删除
  const batchDelete = async () => {
    if (!isDesktop || selectedIds.size === 0) return;

    const confirmed = await dialog.confirm(
      language === 'zh' ? `确定要删除选中的 ${selectedIds.size} 条日志吗？` : `Delete ${selectedIds.size} selected logs?`,
      language === 'zh' ? '批量删除确认' : 'Batch Delete'
    );
    if (!confirmed) return;

    let deleted = 0;
    for (const logId of selectedIds) {
      try {
        await (window as any).electronAPI.deleteWorkflowExecutionLog(logId);
        deleted++;
      } catch (e) {
        console.error('[WorkflowLogTab] Failed to delete:', logId, e);
      }
    }

    setSelectedIds(new Set());
    loadLogs();
  };

  // 清理过期日志
  const cleanupOldLogs = async () => {
    if (!isDesktop) return;

    const confirmed = await dialog.confirm(
      language === 'zh' ? '确定要清理30天前的旧日志吗？' : 'Clean up logs older than 30 days?',
      language === 'zh' ? '清理确认' : 'Cleanup Confirm'
    );
    if (!confirmed) return;

    try {
      const cleaned = await (window as any).electronAPI.cleanupWorkflowExecutionLogs(30);
      await dialog.alert(language === 'zh' ? `已清理 ${cleaned} 条旧日志` : `Cleaned ${cleaned} old logs`);
      loadLogs();
    } catch (error) {
      console.error('[WorkflowLogTab] Failed to cleanup logs:', error);
    }
  };

  // 切换选中
  const toggleSelect = (logId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(logId)) {
      newSelected.delete(logId);
    } else {
      newSelected.add(logId);
    }
    setSelectedIds(newSelected);
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(l => l.logId)));
    }
  };

  // 初始加载
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // 文案
  const t = {
    stats: language === 'zh' ? '统计' : 'Statistics',
    totalRuns: language === 'zh' ? '总执行次数' : 'Total Runs',
    successfulRuns: language === 'zh' ? '成功次数' : 'Successful',
    failedRuns: language === 'zh' ? '失败次数' : 'Failed',
    filter: language === 'zh' ? '筛选' : 'Filter',
    workflow: language === 'zh' ? '工作流' : 'Workflow',
    status: language === 'zh' ? '状态' : 'Status',
    all: language === 'zh' ? '全部' : 'All',
    refresh: language === 'zh' ? '刷新' : 'Refresh',
    cleanup: language === 'zh' ? '清理' : 'Cleanup',
    batchDelete: language === 'zh' ? '批量删除' : 'Batch Delete',
    selectAll: language === 'zh' ? '全选' : 'Select All',
    selected: language === 'zh' ? '已选' : 'Selected',
    noLogs: language === 'zh' ? '暂无执行日志' : 'No execution logs',
    view: language === 'zh' ? '查看' : 'View',
    delete: language === 'zh' ? '删除' : 'Delete',
    nodeDetails: language === 'zh' ? '节点执行详情' : 'Node Execution Details',
    nodes: language === 'zh' ? '节点' : 'nodes',
  };

  return (
    <div className="flex flex-col h-full">
      {/* 统计栏 */}
      <div className="flex items-center gap-6 px-4 py-2 bg-hive-surface/50 border-b border-hive-border text-sm">
        <span className="text-hive-text-secondary">{t.stats}:</span>
        <span className="text-hive-text">{t.totalRuns}: <strong className="text-hive-primary">{stats.totalRuns}</strong></span>
        <span className="text-green-400">{t.successfulRuns}: <strong>{stats.successfulRuns}</strong></span>
        <span className="text-red-400">{t.failedRuns}: <strong>{stats.failedRuns}</strong></span>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-hive-surface/30 border-b border-hive-border">
        <div className="flex gap-3">
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

        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={batchDelete}
              className="px-3 py-1.5 text-sm bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors"
            >
              🗑️ {t.batchDelete} ({selectedIds.size})
            </button>
          )}
          <button
            onClick={loadLogs}
            className="px-3 py-1.5 text-sm bg-hive-bg border border-hive-border rounded-lg text-hive-text-secondary hover:text-hive-text hover:border-hive-primary transition-colors"
          >
            🔄 {t.refresh}
          </button>
          <button
            onClick={cleanupOldLogs}
            className="px-3 py-1.5 text-sm bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400 hover:bg-yellow-500/20 transition-colors"
          >
            🧹 {t.cleanup}
          </button>
        </div>
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
            {/* 表头 */}
            <div className="flex items-center gap-4 px-4 py-2 bg-hive-surface/30 text-hive-text-secondary text-xs font-medium">
              <input
                type="checkbox"
                checked={selectedIds.size === logs.length && logs.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-hive-border bg-hive-bg"
              />
              <span className="w-20">{t.status}</span>
              <span className="flex-1">{t.workflow}</span>
              <span className="w-24 text-right">{language === 'zh' ? '耗时' : 'Duration'}</span>
              <span className="w-20 text-right">{t.nodes}</span>
              <span className="w-24 text-right">{language === 'zh' ? '操作' : 'Actions'}</span>
            </div>

            {/* 日志项 */}
            {logs.map((log) => {
              const style = STATUS_STYLES[log.status] || STATUS_STYLES.cancelled;
              return (
                <div
                  key={log.logId}
                  className={`flex items-center gap-4 px-4 py-3 hover:bg-hive-hover transition-colors ${
                    selectedIds.has(log.logId) ? 'bg-hive-primary/10' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(log.logId)}
                    onChange={() => toggleSelect(log.logId)}
                    className="w-4 h-4 rounded border-hive-border bg-hive-bg"
                  />

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
                  <div className="text-hive-text-secondary text-sm w-24 text-right">
                    {formatDuration(log.duration)}
                  </div>

                  {/* 节点数 */}
                  <div className="text-hive-text-secondary text-sm w-20 text-right">
                    {log.nodeCount} {t.nodes}
                    {log.errorCount > 0 && <span className="text-red-400 ml-1">({log.errorCount}✗)</span>}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-1 w-24 justify-end">
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