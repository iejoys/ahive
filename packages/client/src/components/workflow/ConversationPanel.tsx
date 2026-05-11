/**
 * A2A 对话记录面板
 * 显示智能体之间的对话历史
 */

import { useState, useEffect, useMemo } from 'react';
import type { A2AConversationLog, A2AMessageType } from '../../../types';

// ========== 类型定义 ==========

interface ConversationPanelProps {
  /** 工作流ID */
  workflowId?: string;
  /** 节点ID */
  nodeId?: string;
  /** A2A 服务 URL */
  a2aUrl?: string;
  /** 最大显示条数 */
  maxItems?: number;
  /** 语言 */
  language?: 'zh' | 'en';
}

// ========== 消息类型标签 ==========

const messageTypeLabels: Record<A2AMessageType, { label: string; color: string }> = {
  talktoagent: { label: '对话', color: 'bg-gray-600' },
  review_request: { label: '审核请求', color: 'bg-blue-600' },
  review_result: { label: '审核结果', color: 'bg-green-600' },
  handover: { label: '任务交接', color: 'bg-purple-600' },
  question: { label: '提问', color: 'bg-yellow-600' },
  answer: { label: '回答', color: 'bg-teal-600' },
};

// ========== 主组件 ==========

export function ConversationPanel({
  workflowId,
  nodeId,
  a2aUrl = 'http://127.0.0.1:3003/a2a',
  maxItems = 50,
  language = 'zh',
}: ConversationPanelProps) {
  const [conversations, setConversations] = useState<A2AConversationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<A2AMessageType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 获取对话日志
  const fetchConversations = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (workflowId) params.append('workflowId', workflowId);
      if (nodeId) params.append('nodeId', nodeId);
      if (selectedType !== 'all') params.append('type', selectedType);
      params.append('limit', String(maxItems));

      const response = await fetch(`${a2aUrl}/logs?${params}`);
      const data = await response.json();

      if (data.success) {
        const allMessages: A2AConversationLog[] = [];
        for (const conv of data.conversations || []) {
          allMessages.push(...(conv.messages || []));
        }
        setConversations(allMessages.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        ));
      } else {
        setError(data.error || '加载失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 30000);
    return () => clearInterval(interval);
  }, [workflowId, nodeId, selectedType, maxItems]);

  // 过滤搜索
  const filteredConversations = useMemo(() => {
    if (!searchQuery) return conversations;
    const query = searchQuery.toLowerCase();
    return conversations.filter(
      c => c.message.toLowerCase().includes(query) ||
           c.from.toLowerCase().includes(query) ||
           c.to.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  // 格式化时间
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return language === 'zh' ? '刚刚' : 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}${language === 'zh' ? '分钟前' : 'm ago'}`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}${language === 'zh' ? '小时前' : 'h ago'}`;
    
    return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="conversation-panel bg-gray-800 rounded-lg border border-gray-700 h-full flex flex-col">
      {/* 头部 */}
      <div className="p-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-medium flex items-center gap-2">
            <span>💬</span>
            {language === 'zh' ? '对话记录' : 'Conversations'}
          </h3>
          <button
            onClick={fetchConversations}
            disabled={loading}
            className="text-gray-400 hover:text-white px-2 py-1 text-sm disabled:opacity-50"
          >
            🔄
          </button>
        </div>

        {/* 过滤器 */}
        <div className="flex gap-2 flex-wrap">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as A2AMessageType | 'all')}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
          >
            <option value="all">{language === 'zh' ? '全部类型' : 'All types'}</option>
            {Object.entries(messageTypeLabels).map(([type, { label }]) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'zh' ? '搜索...' : 'Search...'}
            className="flex-1 min-w-[120px] bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm"
          />
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && conversations.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            {language === 'zh' ? '加载中...' : 'Loading...'}
          </div>
        ) : error ? (
          <div className="text-red-400 text-center py-8">{error}</div>
        ) : filteredConversations.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            {language === 'zh' ? '暂无对话记录' : 'No conversations'}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredConversations.map((msg, index) => {
              const typeInfo = messageTypeLabels[msg.type] || { label: msg.type, color: 'bg-gray-600' };
              
              return (
                <div
                  key={msg.logId || index}
                  className="bg-gray-700/50 rounded p-2 border border-gray-600 hover:border-gray-500 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white text-sm font-medium">{msg.from}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-white text-sm font-medium">{msg.to}</span>
                    <span className={`ml-auto px-1.5 py-0.5 rounded text-xs text-white ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                  </div>

                  <div className="text-gray-300 text-sm mb-1 line-clamp-3">
                    {msg.message}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{formatTime(msg.timestamp)}</span>
                    {msg.nodeId && (
                      <span className="bg-gray-600 px-1 rounded">
                        {language === 'zh' ? '节点' : 'Node'}: {msg.nodeId}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      {conversations.length > 0 && (
        <div className="p-2 border-t border-gray-700 text-xs text-gray-500 text-center">
          {language === 'zh' ? `共 ${conversations.length} 条对话` : `${conversations.length} conversations`}
        </div>
      )}
    </div>
  );
}

export default ConversationPanel;