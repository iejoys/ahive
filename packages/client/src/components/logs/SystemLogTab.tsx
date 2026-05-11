/**
 * 系统日志 Tab
 * 查看、管理系统运行日志文件
 */

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { useDialog } from '../common/DialogProvider';

// 类型定义
interface LogFile {
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  modifiedAt: string;
  createdAt: string;
}

interface LogStats {
  totalFiles: number;
  totalSize: number;
  totalSizeFormatted: string;
  oldestFile?: string | null;
  newestFile?: string | null;
}

interface LogContent {
  success: boolean;
  filename?: string;
  totalLines?: number;
  content?: string;
  lines?: string[];
  error?: string;
}

// 日志级别颜色
const LOG_LEVEL_COLORS: Record<string, string> = {
  '[INFO]': 'text-blue-400',
  '[WARN]': 'text-yellow-400',
  '[ERROR]': 'text-red-400',
  '[DEBUG]': 'text-gray-400',
};

// 格式化时间
function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SystemLogTab() {
  const { language } = useStore();
  const dialog = useDialog();

  // 状态
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [stats, setStats] = useState<LogStats>({ totalFiles: 0, totalSize: 0, totalSizeFormatted: '0 B' });
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogContent | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [logLevel, setLogLevel] = useState<string>('all');
  const [searchKeyword, setSearchKeyword] = useState('');

  // 检测是否在 Electron 环境
  const isDesktop = typeof window !== 'undefined' &&
    (window as any).electronAPI?.isDesktop;

  // 加载日志文件列表
  const loadLogFiles = useCallback(async () => {
    if (!isDesktop) return;

    setLoading(true);
    try {
      const [files, statsResult] = await Promise.all([
        (window as any).electronAPI.getSystemLogFiles(),
        (window as any).electronAPI.getSystemLogStats(),
      ]);
      setLogFiles(files || []);
      setStats(statsResult || { totalFiles: 0, totalSize: 0, totalSizeFormatted: '0 B' });
    } catch (error) {
      console.error('[SystemLogTab] Failed to load log files:', error);
    } finally {
      setLoading(false);
    }
  }, [isDesktop]);

  // 查看日志内容
  const viewLog = async (filename: string) => {
    if (!isDesktop) return;

    setViewingFile(filename);
    try {
      const result = await (window as any).electronAPI.readSystemLog(filename, {
        lines: 500,
        level: logLevel === 'all' ? undefined : logLevel,
        search: searchKeyword || undefined,
      });
      setSelectedLog(result);
    } catch (error) {
      console.error('[SystemLogTab] Failed to read log:', error);
    }
  };

  // 删除单个日志
  const deleteLog = async (filename: string) => {
    if (!isDesktop) return;

    const confirmed = await dialog.confirm(
      language === 'zh' ? `确定要删除日志文件 "${filename}" 吗？` : `Delete log file "${filename}"?`,
      language === 'zh' ? '删除确认' : 'Confirm Delete'
    );
    if (!confirmed) return;

    try {
      await (window as any).electronAPI.deleteSystemLog(filename);
      setLogFiles(logFiles.filter(f => f.name !== filename));
      if (viewingFile === filename) {
        setViewingFile(null);
        setSelectedLog(null);
      }
    } catch (error) {
      console.error('[SystemLogTab] Failed to delete log:', error);
    }
  };

  // 批量删除
  const batchDelete = async () => {
    if (!isDesktop || selectedFiles.size === 0) return;

    const confirmed = await dialog.confirm(
      language === 'zh' ? `确定要删除选中的 ${selectedFiles.size} 个日志文件吗？` : `Delete ${selectedFiles.size} selected log files?`,
      language === 'zh' ? '批量删除确认' : 'Batch Delete'
    );
    if (!confirmed) return;

    try {
      const result = await (window as any).electronAPI.deleteSystemLogs(Array.from(selectedFiles));
      if (result.success) {
        await dialog.alert(
          language === 'zh' ? `成功删除 ${result.deleted} 个文件` : `Deleted ${result.deleted} files`
        );
        setSelectedFiles(new Set());
        loadLogFiles();
      }
    } catch (error) {
      console.error('[SystemLogTab] Failed to batch delete:', error);
    }
  };

  // 清理旧日志
  const cleanupOldLogs = async () => {
    if (!isDesktop) return;

    const confirmed = await dialog.confirm(
      language === 'zh' ? '确定要清理 7 天前的旧日志吗？' : 'Clean up logs older than 7 days?',
      language === 'zh' ? '清理确认' : 'Cleanup Confirm'
    );
    if (!confirmed) return;

    try {
      const result = await (window as any).electronAPI.cleanupSystemLogs(7);
      if (result.success) {
        await dialog.alert(
          language === 'zh' ? `已清理 ${result.deleted} 个旧日志文件` : `Cleaned ${result.deleted} old log files`
        );
        loadLogFiles();
      }
    } catch (error) {
      console.error('[SystemLogTab] Failed to cleanup logs:', error);
    }
  };

  // 切换选中
  const toggleSelect = (filename: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(filename)) {
      newSelected.delete(filename);
    } else {
      newSelected.add(filename);
    }
    setSelectedFiles(newSelected);
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedFiles.size === logFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(logFiles.map(f => f.name)));
    }
  };

  // 初始加载
  useEffect(() => {
    loadLogFiles();
  }, [loadLogFiles]);

  // 重新加载日志内容（当过滤条件变化时）
  useEffect(() => {
    if (viewingFile) {
      viewLog(viewingFile);
    }
  }, [logLevel, searchKeyword]);

  // 文案
  const t = {
    totalFiles: language === 'zh' ? '文件数' : 'Files',
    totalSize: language === 'zh' ? '总大小' : 'Total Size',
    refresh: language === 'zh' ? '刷新' : 'Refresh',
    cleanup: language === 'zh' ? '清理旧日志' : 'Cleanup Old Logs',
    batchDelete: language === 'zh' ? '批量删除' : 'Batch Delete',
    selectAll: language === 'zh' ? '全选' : 'Select All',
    noLogs: language === 'zh' ? '暂无日志文件' : 'No log files',
    view: language === 'zh' ? '查看' : 'View',
    delete: language === 'zh' ? '删除' : 'Delete',
    filename: language === 'zh' ? '文件名' : 'Filename',
    size: language === 'zh' ? '大小' : 'Size',
    modified: language === 'zh' ? '修改时间' : 'Modified',
    actions: language === 'zh' ? '操作' : 'Actions',
    filterLevel: language === 'zh' ? '日志级别' : 'Log Level',
    all: language === 'zh' ? '全部' : 'All',
    search: language === 'zh' ? '搜索...' : 'Search...',
    close: language === 'zh' ? '关闭' : 'Close',
    lines: language === 'zh' ? '行' : 'lines',
  };

  return (
    <div className="flex flex-col h-full">
      {/* 统计栏 */}
      <div className="flex items-center gap-6 px-4 py-2 bg-hive-surface/50 border-b border-hive-border text-sm">
        <span className="text-hive-text-secondary">{t.totalFiles}: <strong className="text-hive-text">{stats.totalFiles}</strong></span>
        <span className="text-hive-text-secondary">{t.totalSize}: <strong className="text-hive-primary">{stats.totalSizeFormatted}</strong></span>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-hive-surface/30 border-b border-hive-border">
        <div className="flex gap-3">
          <select
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value)}
            className="px-3 py-1.5 bg-hive-bg border border-hive-border rounded-lg text-hive-text text-sm focus:border-hive-primary outline-none"
          >
            <option value="all">{t.all}</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
          </select>

          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder={t.search}
            className="px-3 py-1.5 bg-hive-bg border border-hive-border rounded-lg text-hive-text text-sm focus:border-hive-primary outline-none w-48"
          />
        </div>

        <div className="flex gap-2">
          {selectedFiles.size > 0 && (
            <button
              onClick={batchDelete}
              className="px-3 py-1.5 text-sm bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 hover:bg-red-500/20 transition-colors"
            >
              🗑️ {t.batchDelete} ({selectedFiles.size})
            </button>
          )}
          <button
            onClick={loadLogFiles}
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

      {/* 日志文件列表 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-hive-text-secondary">
            {language === 'zh' ? '加载中...' : 'Loading...'}
          </div>
        ) : logFiles.length === 0 ? (
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
                checked={selectedFiles.size === logFiles.length && logFiles.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-hive-border bg-hive-bg"
              />
              <span className="flex-1">{t.filename}</span>
              <span className="w-24 text-right">{t.size}</span>
              <span className="w-32 text-right">{t.modified}</span>
              <span className="w-28 text-right">{t.actions}</span>
            </div>

            {/* 文件项 */}
            {logFiles.map((file) => (
              <div
                key={file.name}
                className={`flex items-center gap-4 px-4 py-3 hover:bg-hive-hover transition-colors ${
                  selectedFiles.has(file.name) ? 'bg-hive-primary/10' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.name)}
                  onChange={() => toggleSelect(file.name)}
                  className="w-4 h-4 rounded border-hive-border bg-hive-bg"
                />

                {/* 文件图标和名称 */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-lg">📄</span>
                  <span className="text-hive-text font-medium truncate">{file.name}</span>
                </div>

                {/* 大小 */}
                <div className="text-hive-text-secondary text-sm w-24 text-right">
                  {file.sizeFormatted}
                </div>

                {/* 修改时间 */}
                <div className="text-hive-text-secondary text-sm w-32 text-right">
                  {formatDateTime(file.modifiedAt)}
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-1 w-28 justify-end">
                  <button
                    onClick={() => viewLog(file.name)}
                    className="px-2 py-1 text-xs bg-hive-primary/20 text-hive-primary rounded hover:bg-hive-primary/30 transition-colors"
                  >
                    {t.view}
                  </button>
                  <button
                    onClick={() => deleteLog(file.name)}
                    className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                  >
                    {t.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 日志详情面板 */}
      {selectedLog && (
        <div className="border-t border-hive-border bg-hive-surface h-64 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-hive-border">
            <h3 className="text-sm font-medium text-hive-text flex items-center gap-2">
              📄 {viewingFile}
              {selectedLog.totalLines && (
                <span className="text-hive-text-secondary text-xs">({selectedLog.totalLines} {t.lines})</span>
              )}
            </h3>
            <button
              onClick={() => {
                setSelectedLog(null);
                setViewingFile(null);
              }}
              className="text-hive-text-secondary hover:text-hive-text transition-colors"
            >
              ✕ {t.close}
            </button>
          </div>

          <div className="flex-1 overflow-auto p-2">
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {selectedLog.lines?.map((line, i) => {
                // 检测日志级别并着色
                let colorClass = 'text-hive-text';
                for (const [level, color] of Object.entries(LOG_LEVEL_COLORS)) {
                  if (line.includes(level)) {
                    colorClass = color;
                    break;
                  }
                }
                return (
                  <div key={i} className={`${colorClass} hover:bg-hive-hover/30 px-1`}>
                    {line}
                  </div>
                );
              })}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}