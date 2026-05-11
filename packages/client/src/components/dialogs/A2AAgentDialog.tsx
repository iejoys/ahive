/**
 * A2A Agent 配置对话框
 * 支持动态表单渲染
 */
import { useState, useEffect } from 'react';
import type { A2AAgentConfig, A2AAgentCard, A2AProtocolType } from '@ahive/shared';

// 输入字段定义（与后端协议配置对应）
interface InputField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'number' | 'checkbox';
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  description?: string;
  options?: { value: string; label: string }[];
  sensitive?: boolean;
}

// 使用 shared 包中的 A2AProtocolType，已包含 'ahivecore'
interface ExtendedA2AAgentConfig extends A2AAgentConfig {
  protocolType?: A2AProtocolType;
  customFields?: Record<string, any>;
}

interface A2AAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: { 
    id?: string;  // 编辑时传入现有 ID
    name: string; 
    endpoint: string; 
    agentId: string; 
    webhookUrl?: string; 
    protocolType: A2AProtocolType;
    customFields?: Record<string, any>;
  }) => Promise<void>;
  editingAgent?: A2AAgentConfig | null;
}

const PROTOCOL_OPTIONS = [
  { value: 'ahivecore' as A2AProtocolType, label: 'AHIVECORE', description: 'AHIVECORE 智能体核心引擎 (本地)' },
  { value: 'a2a-standard' as A2AProtocolType, label: '标准 A2A', description: '标准 A2A 协议' },
  { value: 'openclaw' as A2AProtocolType, label: 'OpenClaw', description: 'OpenClaw OpenResponses API' },
  { value: 'opencode' as A2AProtocolType, label: 'OpenCode', description: 'OpenCode Agent' }
];

// 协议输入字段定义（从后端同步或硬编码）
const PROTOCOL_INPUT_FIELDS: Record<A2AProtocolType, InputField[]> = {
  'a2a-standard': [
    { name: 'agentId', label: 'Agent ID', type: 'text', required: true, placeholder: '例如: my-agent' },
    { name: 'apiKey', label: 'API Key', type: 'password', required: false, sensitive: true },
  ],
  openclaw: [
    { name: 'agentId', label: 'Agent ID', type: 'text', required: true, placeholder: '例如: my-agent' },
    { name: 'apiKey', label: 'API Key', type: 'password', required: false, sensitive: true },
  ],
  opencode: [
    { name: 'agentId', label: 'Agent ID', type: 'text', required: true, placeholder: '例如: sisyphus', description: 'OpenCode 配置的 Agent 名称' },
    { 
      name: 'provider', 
      label: 'Provider ID', 
      type: 'select', 
      required: false, 
      default: 'bailian-coding-plan',
      description: '模型提供商 ID',
      options: [
        { value: 'bailian-coding-plan', label: '百炼 Coding Plan' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'google', label: 'Google' },
      ]
    },
    { name: 'model', label: 'Model ID', type: 'text', required: false, default: 'glm-5', description: '模型 ID' },
    { name: 'apiKey', label: 'API Key', type: 'password', required: false, placeholder: 'username:password', description: 'Basic Auth 认证信息', sensitive: true },
  ],
  ahivecore: [
    { 
      name: 'agentId', 
      label: 'Agent ID', 
      type: 'text', 
      required: false, 
      placeholder: '留空使用默认智能体',
      description: 'AHIVECORE 智能体 ID（可选）'
    },
    { 
      name: 'endpoint', 
      label: '服务地址', 
      type: 'text', 
      required: false, 
      default: 'http://127.0.0.1:18790',
      placeholder: 'http://127.0.0.1:18790',
      description: 'AHIVECORE 服务地址'
    },
  ],
};

export function A2AAgentDialog({ isOpen, onClose, onSave, editingAgent }: A2AAgentDialogProps) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [protocolType, setProtocolType] = useState<A2AProtocolType>('opencode');
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);

  // 获取当前协议的输入字段
  const currentInputFields = PROTOCOL_INPUT_FIELDS[protocolType] || [];

  // 初始化自定义字段的默认值
  useEffect(() => {
    const defaults: Record<string, any> = {};
    currentInputFields.forEach(field => {
      if (field.default !== undefined) {
        defaults[field.name] = field.default;
      }
    });
    setCustomFields(prev => ({ ...defaults, ...prev }));
  }, [protocolType]);

  // 对话框打开/关闭时重置状态
  useEffect(() => {
    if (isOpen) {
      if (editingAgent) {
        setName(editingAgent.name);
        setEndpoint(editingAgent.endpoint);
        setWebhookUrl(editingAgent.webhookUrl || '');
        setProtocolType(editingAgent.protocolType || 'opencode');
        
        // 加载自定义字段
        const editingCustom = (editingAgent as any).customFields || {};
        const defaults: Record<string, any> = {};
        currentInputFields.forEach(field => {
          if (field.default !== undefined) {
            defaults[field.name] = field.default;
          }
        });
        // 加载顶层字段到 customFields（agentId, apiKey 等）
        const topLevelFields: Record<string, any> = {};
        if (editingAgent.agentId) topLevelFields.agentId = editingAgent.agentId;
        if (editingAgent.apiKey) topLevelFields.apiKey = editingAgent.apiKey;
        setCustomFields({ ...defaults, ...topLevelFields, ...editingCustom });
      } else {
        setName('');
        setEndpoint('');
        setWebhookUrl('');
        setProtocolType('opencode');
        
        // 重置自定义字段为默认值
        const defaults: Record<string, any> = {};
        currentInputFields.forEach(field => {
          if (field.default !== undefined) {
            defaults[field.name] = field.default;
          }
        });
        setCustomFields(defaults);
      }
    }
  }, [isOpen, editingAgent]);

  if (!isOpen) return null;

  const handleCustomFieldChange = (fieldName: string, value: any) => {
    setCustomFields(prev => ({ ...prev, [fieldName]: value }));
  };

  const handleDiscover = async () => {
    if (!endpoint.trim()) {
      alert('请先输入端点 URL');
      return;
    }

    setIsDiscovering(true);
    try {
      const anyWindow = window as any;
      
      if (anyWindow.electronAPI?.discoverA2AAgentCard) {
        // AHIVECORE 协议允许访问本地网络
        const allowLocalNetwork = protocolType === 'ahivecore';
        const result = await anyWindow.electronAPI.discoverA2AAgentCard(
          endpoint, 
          protocolType, 
          allowLocalNetwork
        );
        
        if (result.success && result.card) {
          if (result.card.name) setName(result.card.name);
          if (result.card.id) {
            handleCustomFieldChange('agentId', result.card.id);
          }
          alert(`发现 Agent: ${result.card.name}\n来源: ${result.endpoint}`);
        } else {
          alert(result.error || '未能发现 Agent Card，请手动填写信息');
        }
      } else {
        alert('请使用 Electron 桌面应用来发现 Agent');
      }
    } catch (error) {
      alert(`发现失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleSave = async () => {
    // 验证必填字段
    if (!name.trim() || !endpoint.trim()) {
      alert('请填写名称和端点');
      return;
    }

    // 验证自定义必填字段
    for (const field of currentInputFields) {
      if (field.required && !customFields[field.name]) {
        alert(`请填写 ${field.label}`);
        return;
      }
    }

    setIsLoading(true);
    try {
      await onSave({
        id: editingAgent?.id,  // 编辑时传入现有 ID
        name: name.trim(),
        endpoint: endpoint.trim(),
        agentId: customFields.agentId || '',
        webhookUrl: webhookUrl.trim() || undefined,
        protocolType,
        customFields,
      });

      onClose();
    } catch (error) {
      alert(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 渲染动态输入字段
  const renderInputField = (field: InputField) => {
    const value = customFields[field.name] ?? field.default ?? '';
    
    const commonProps = {
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => 
        handleCustomFieldChange(field.name, e.target.value),
      placeholder: field.placeholder,
      className: 'w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white',
    };

    return (
      <div key={field.name} className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">
          {field.label} {field.required && <span className="text-red-400">*</span>}
        </label>
        
        {field.type === 'select' ? (
          <select {...commonProps}>
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <input
            type={field.type}
            {...commonProps}
          />
        )}
        
        {field.description && (
          <p className="text-xs text-gray-500 mt-1">{field.description}</p>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-4">
          {editingAgent ? '编辑 A2A Agent' : '添加 A2A Agent'}
        </h2>

        {/* 协议类型选择 */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-2">协议类型</label>
          <div className="grid grid-cols-3 gap-2">
            {PROTOCOL_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setProtocolType(option.value)}
                className={`px-3 py-2 rounded text-sm ${
                  protocolType === option.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* 端点 URL */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">
            端点 URL <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="例如: http://127.0.0.1:8095"
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            />
            <button
              onClick={handleDiscover}
              disabled={isDiscovering}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white disabled:opacity-50"
            >
              {isDiscovering ? '发现中...' : '🔍 发现'}
            </button>
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
            placeholder="例如: Sisyphus"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          />
        </div>

        {/* 动态字段（根据协议类型） */}
        <div className="border-t border-gray-700 pt-4 mt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">协议配置</h3>
          {currentInputFields.map(renderInputField)}
        </div>

        {/* Webhook URL（可选） */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Webhook URL（可选）</label>
          <input
            type="text"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="用于接收异步任务回调"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          />
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
            {isLoading ? '保存中...' : (editingAgent ? '更新' : '添加')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A2A Agent 列表项组件
 */
interface A2AAgentListItemProps {
  agent: A2AAgentConfig;
  onDelete: (id: string) => void;
  onRefresh: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

export function A2AAgentListItem({ agent, onDelete, onRefresh, onToggle }: A2AAgentListItemProps) {
  return (
    <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600/20 rounded-lg flex items-center justify-center">
            <span className="text-xl">🤖</span>
          </div>
          <div>
            <h4 className="text-white font-medium">{agent.name}</h4>
            <p className="text-gray-400 text-sm">{agent.agentId}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggle(agent.id, !agent.enabled)}
            className={`px-3 py-1 rounded text-sm ${
              agent.enabled
                ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
            }`}
          >
            {agent.enabled ? '启用' : '禁用'}
          </button>
          <button
            onClick={() => onRefresh(agent.id)}
            className="px-3 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-sm"
          >
            刷新
          </button>
          <button
            onClick={() => onDelete(agent.id)}
            className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-sm"
          >
            删除
          </button>
        </div>
      </div>
      
      <div className="mt-2 text-xs text-gray-500">
        <span>协议: {agent.protocolType || 'a2a-standard'}</span>
        <span className="mx-2">•</span>
        <span>端点: {agent.endpoint}</span>
      </div>
    </div>
  );
}