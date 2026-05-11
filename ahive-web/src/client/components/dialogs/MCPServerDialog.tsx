/**
 * MCP Server 配置对话框
 * 
 * 文档: MCP_A2A_INTEGRATION_DESIGN.md
 * 创建日期: 2026-03-05
 */

import { useState } from 'react';
import type { MCPServerConfig, MCPTool } from '@/shared';

interface MCPServerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: CreateMCPServerRequest) => Promise<void>;
  editingServer?: MCPServerConfig | null;
}

interface CreateMCPServerRequest {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

const MCP_TEMPLATES = [
  {
    name: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKey: 'GITHUB_TOKEN',
    description: 'GitHub API 操作'
  },
  {
    name: 'PostgreSQL',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envKey: 'DATABASE_URL',
    description: 'PostgreSQL 数据库操作'
  },
  {
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    envKey: '',
    description: '文件系统操作'
  },
  {
    name: 'Yahoo Finance',
    command: 'uvx',
    args: ['yahoo-finance-server'],
    envKey: '',
    description: '股票/期权数据（量化交易）'
  },
  {
    name: 'Slack',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envKey: 'SLACK_BOT_TOKEN',
    description: 'Slack 消息发送'
  },
  {
    name: 'Brave Search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envKey: 'BRAVE_API_KEY',
    description: 'Brave 网页搜索'
  }
];


export function MCPServerDialog({ isOpen, onClose, onSave, editingServer }: MCPServerDialogProps) {
  const [name, setName] = useState(editingServer?.name || '');
  const [command, setCommand] = useState(editingServer?.command || '');
  const [args, setArgs] = useState(editingServer?.args?.join(' ') || '');
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleTemplateSelect = (template: typeof MCP_TEMPLATES[0]) => {
    setName(template.name);
    setCommand(template.command);
    setArgs(template.args.join(' '));
    setEnvKey(template.envKey);
    setEnvValue('');
  };

  const handleSave = async () => {
    if (!name.trim() || !command.trim()) {
      alert('请填写名称和命令');
      return;
    }

    setIsLoading(true);
    try {
      const env: Record<string, string> = {};
      if (envKey.trim() && envValue.trim()) {
        env[envKey.trim()] = envValue.trim();
      }

      await onSave({
        name: name.trim(),
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : undefined,
        env: Object.keys(env).length > 0 ? env : undefined
      });

      // 重置表单
      setName('');
      setCommand('');
      setArgs('');
      setEnvKey('');
      setEnvValue('');
      onClose();
    } catch (error) {
      alert(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-4">
          {editingServer ? '编辑 MCP Server' : '添加 MCP Server'}
        </h2>

        {/* 模板选择 */}
        <div className="mb-6">
          <label className="block text-sm text-gray-400 mb-2">快速选择模板</label>
          <div className="grid grid-cols-2 gap-2">
            {MCP_TEMPLATES.map((template) => (
              <button
                key={template.name}
                onClick={() => handleTemplateSelect(template)}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-left text-sm"
              >
                <div className="font-medium text-white">{template.name}</div>
                <div className="text-gray-400 text-xs">{template.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 名称 */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">
            名称 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: GitHub"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          />
        </div>

        {/* 命令 */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">
            命令 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="例如: npx"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          />
        </div>

        {/* 参数 */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">参数</label>
          <input
            type="text"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="例如: -y @modelcontextprotocol/server-github"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          />
          <p className="text-xs text-gray-500 mt-1">多个参数用空格分隔</p>
        </div>

        {/* 环境变量 */}
        <div className="mb-6">
          <label className="block text-sm text-gray-400 mb-1">环境变量 (可选)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={envKey}
              onChange={(e) => setEnvKey(e.target.value)}
              placeholder="变量名 (如: GITHUB_TOKEN)"
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            />
            <input
              type="password"
              value={envValue}
              onChange={(e) => setEnvValue(e.target.value)}
              placeholder="变量值"
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            部分 MCP Server 需要认证 Token，如 GitHub 需要 GITHUB_TOKEN
          </p>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-white disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white disabled:opacity-50"
          >
            {isLoading ? '保存中...' : (editingServer ? '更新' : '添加')}
          </button>
        </div>
      </div>
    </div>
  );
}

// MCP Server 列表项组件
interface MCPServerListItemProps {
  server: MCPServerConfig & { status: string };
  tools: MCPTool[];
  onDelete: (id: string) => void;
  onRestart: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

export function MCPServerListItem({ 
  server, 
  tools, 
  onDelete, 
  onRestart,
  onToggle 
}: MCPServerListItemProps) {
  const [showTools, setShowTools] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const statusColor = {
    running: 'text-green-400',
    starting: 'text-yellow-400',
    stopped: 'text-gray-400',
    error: 'text-red-400'
  }[server.status] || 'text-gray-400';

  const statusText = {
    running: '运行中',
    starting: '启动中',
    stopped: '已停止',
    error: '错误'
  }[server.status] || server.status;

  // 显示启动中状态（包括本地启动状态和服务器状态）
  const showStartingProgress = isStarting || server.status === 'starting';

  // 处理启用/关闭按钮点击
  const handleToggleClick = async () => {
    if (server.status === 'running') {
      // 关闭
      await onToggle(server.id, false);
    } else {
      // 启动 - 立即显示进度条
      setIsStarting(true);
      try {
        await onToggle(server.id, true);
      } finally {
        setIsStarting(false);
      }
    }
  };

  // 渲染启用/关闭按钮或进度条
  const renderToggleButton = () => {
    if (showStartingProgress) {
      // 启动中 - 显示进度条
      return (
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-yellow-400 rounded-full animate-pulse" 
              style={{ width: '60%' }}
            ></div>
          </div>
          <span className="text-sm text-yellow-400">启动中...</span>
        </div>
      );
    }
    
    if (server.status === 'running') {
      return (
        <button
          onClick={handleToggleClick}
          className="px-4 py-1.5 bg-red-600 hover:bg-red-500 rounded text-white text-sm font-medium transition-colors"
        >
          关闭
        </button>
      );
    }
    
    return (
      <button
        onClick={handleToggleClick}
        className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded text-white text-sm font-medium transition-colors"
      >
        启用
      </button>
    );
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔌</span>
          <div>
            <h3 className="font-medium text-white">{server.name}</h3>
            <p className="text-sm text-gray-400">
              {server.command} {server.args?.join(' ')}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* 状态标签（非启动中时显示） */}
          {!showStartingProgress && (
            <span className={`text-sm ${statusColor}`}>● {statusText}</span>
          )}
          
          {/* 启用/关闭按钮或进度条 */}
          {renderToggleButton()}

          <button
            onClick={() => setShowTools(!showTools)}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            工具 ({tools.length})
          </button>

          <button
            onClick={() => onRestart(server.id)}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            title="重启"
          >
            🔄
          </button>

          <button
            onClick={() => onDelete(server.id)}
            className="px-3 py-1 bg-red-600/20 hover:bg-red-600/40 rounded text-sm text-red-400"
          >
            删除
          </button>
        </div>
      </div>

      {/* 工具列表 */}
      {showTools && tools.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <h4 className="text-sm font-medium text-gray-300 mb-2">可用工具</h4>
          <div className="grid grid-cols-2 gap-2">
            {tools.map((tool) => (
              <div key={tool.name} className="bg-gray-700/50 rounded p-2">
                <div className="font-medium text-sm text-white">{tool.name}</div>
                <div className="text-xs text-gray-400 truncate">{tool.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 启动中提示 */}
      {showStartingProgress && (
        <div className="mt-2 text-sm text-yellow-400">
          首次启动可能需要下载依赖包，请耐心等待...
        </div>
      )}

      {/* 错误信息 */}
      {server.status === 'error' && (
        <div className="mt-2 text-sm text-red-400">
          启动失败，请检查命令和网络连接
        </div>
      )}
    </div>
  );
}