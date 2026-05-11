import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import type { Agent } from '../../types';

// AHIVECORE API 配置
const AHIVECORE_API = 'http://127.0.0.1:18790';

// 角色类型定义
interface RoleConfig {
  id: string;
  name: string;
  name_zh: string;
  description: string;
}

// 智能体类型配置（AHIVECORE 类型）
export const AHIVECORE_AGENT_TYPES = [
  { 
    id: 'ahive-coder', 
    name: 'AHIVE-CODER', 
    nameEn: 'AHIVE-CODER',
    description: '代码生成与调试专家，支持沙箱执行', 
    descriptionEn: 'Code generation & debugging expert with sandbox execution',
    icon: '💻',
    defaultModel: {
      provider: 'openai',
      name: 'gpt-4o',
      temperature: 0.3,
      maxTokens: 8192,
    }
  },
  { 
    id: 'ahive-worker', 
    name: 'AHIVE-WORKER', 
    nameEn: 'AHIVE-WORKER',
    description: '通用AI助手，支持多种任务和角色配置', 
    descriptionEn: 'General AI assistant, supports multiple tasks and role configuration',
    icon: '🦞',
    defaultModel: {
      provider: 'local',
      name: 'qwen2.5-7b',
      temperature: 0.7,
      maxTokens: 4096,
    }
  },
];

// LLM Provider 配置
export const LLM_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'bailian', name: '百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'local', name: '本地模型', baseUrl: '' },
];

// 常用模型列表
export const COMMON_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
  bailian: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'glm-5', 'deepseek-v3'],
  local: ['qwen2.5-7b', 'llama3-8b', 'mistral-7b'],
};

interface CreateAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
  editAgent?: Agent | null;  // 编辑模式：传入已有智能体
}

export function CreateAgentDialog({ isOpen, onClose, onCreated, editAgent }: CreateAgentDialogProps) {
  const { addAgent, updateAgentStatus, language, agents } = useStore();
  const isZh = language === 'zh';
  
  // 表单状态
  const [agentType, setAgentType] = useState('ahive-coder');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('bailian');
  const [model, setModel] = useState('qwen-plus');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://dashscope.aliyuncs.com/compatible-mode/v1');
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(20000);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // ✅ 角色选择状态
  const [roles, setRoles] = useState<RoleConfig[]>([]);
  const [selectedRole, setSelectedRole] = useState('default');
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  
  // ✅ 获取角色列表
  const fetchRoles = async () => {
    setIsLoadingRoles(true);
    try {
      const response = await fetch(`${AHIVECORE_API}/api/roles`);
      const data = await response.json();
      if (data.success && data.roles) {
        setRoles(data.roles);
        if (!selectedRole && data.defaultRole) {
          setSelectedRole(data.defaultRole);
        }
      }
    } catch (err) {
      console.error('[CreateAgentDialog] Failed to fetch roles:', err);
    } finally {
      setIsLoadingRoles(false);
    }
  };
  
  // ✅ 当选择 AHIVE-WORKER 类型时，获取角色列表
  useEffect(() => {
    if (agentType === 'ahive-worker' && roles.length === 0) {
      fetchRoles();
    }
  }, [agentType]);

  // 编辑模式：初始化表单
  useEffect(() => {
    if (editAgent) {
      setName(editAgent.name);
      setAgentType(editAgent.type || 'ahive-coder');
      
      // 从 customFields 恢复 LLM 配置
      if (editAgent.customFields) {
        setProvider(editAgent.customFields.provider || 'bailian');
        setModel(editAgent.customFields.model || 'qwen-plus');
        setApiKey(editAgent.customFields.apiKey || '');
        setBaseUrl(editAgent.customFields.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1');
        setTemperature(editAgent.customFields.temperature || 0.3);
        setMaxTokens(editAgent.customFields.maxTokens || 20000);
      }
    } else {
      // 新建模式：重置表单
      setName('');
      setAgentType('ahive-coder');
      setProvider('bailian');
      setModel('qwen-plus');
      setApiKey('');
      setBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1');
      setTemperature(0.3);
      setMaxTokens(20000);
    }
    setError(null);
  }, [editAgent, isOpen]);

  // Provider 变化时更新 baseUrl 和默认模型
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const providerConfig = LLM_PROVIDERS.find(p => p.id === newProvider);
    if (providerConfig) {
      setBaseUrl(providerConfig.baseUrl);
      // 设置默认模型
      const models = COMMON_MODELS[newProvider] || [];
      if (models.length > 0) {
        setModel(models[0]);
      }
    }
  };

  if (!isOpen) return null;

  // 调用 AHIVECORE API 创建智能体
  const createAgentInAHIVECORE = async (agentData: any) => {
    const response = await fetch(`${AHIVECORE_API}/api/unified-agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentData),
    });
    
    if (!response.ok) {
      throw new Error(`AHIVECORE API 错误: ${response.statusText}`);
    }
    
    return response.json();
  };

  // 调用 AHIVECORE API 更新智能体
  const updateAgentInAHIVECORE = async (agentId: string, agentData: any) => {
    const response = await fetch(`${AHIVECORE_API}/api/unified-agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agentData),
    });
    
    if (!response.ok) {
      throw new Error(`AHIVECORE API 错误: ${response.statusText}`);
    }
    
    return response.json();
  };

  // 保存到 Electron protocol-config.json
  const saveToProtocolConfig = async (agentId: string, agentData: any) => {
    // 检查是否在 Electron 环境
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.saveA2AAgent) {
      console.warn('[CreateAgentDialog] Not in Electron environment, skipping protocol-config save');
      return;
    }

    const a2aAgentConfig = {
      id: `ahivecore-${agentId}`,
      name: agentData.nickname || name.trim(),
      endpoint: AHIVECORE_API,
      agentId: agentId,
      protocolType: 'ahivecore',
      agentType: agentType,  // 保存智能体类型 (ahive-coder / ahive-worker)
      enabled: true,
      customFields: {
        endpoint: AHIVECORE_API,
        agentId: agentId,
        agentType: agentType,  // 在 customFields 中也保存一份
        provider: provider,
        model: model,
        apiKey: apiKey,
        baseUrl: baseUrl,
        temperature: temperature,
        maxTokens: maxTokens,
        // ✅ 保存角色配置（仅 AHIVE-WORKER 类型）
        ...(agentType === 'ahive-worker' && agentData.role ? { role: agentData.role } : {}),
      },
    };

    await electronAPI.saveA2AAgent(a2aAgentConfig);
    console.log('[CreateAgentDialog] Saved to protocol-config.json:', a2aAgentConfig);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(isZh ? '请输入智能体名称' : 'Please enter agent name');
      return;
    }

    if (!apiKey.trim()) {
      setError(isZh ? '请输入 API Key' : 'Please enter API Key');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // 构建智能体数据
      const agentData: any = {
        agentId: editAgent?.id || undefined,  // 编辑模式使用原 ID
        type: agentType,
        nickname: name.trim(),
        model: {
          provider: provider,
          name: model,
          temperature: temperature,
          maxTokens: maxTokens,
          apiKey: apiKey.trim(),
          baseUrl: baseUrl,
        },
      };
      
      // ✅ 如果是 AHIVE-WORKER 类型，添加角色配置
      if (agentType === 'ahive-worker' && selectedRole) {
        agentData.role = selectedRole;
      }

      let result: any;
      
      if (editAgent) {
        // 编辑模式：调用更新 API
        result = await updateAgentInAHIVECORE(editAgent.id, agentData);
        
        // 更新本地状态
        updateAgentStatus(editAgent.id, 'idle');
        
        // 更新 protocol-config.json
        await saveToProtocolConfig(editAgent.id, agentData);
      } else {
        // 创建模式：调用创建 API
        result = await createAgentInAHIVECORE(agentData);
        
        if (!result.success || !result.agent?.id) {
          throw new Error(isZh ? '创建失败：未返回智能体 ID' : 'Creation failed: No agent ID returned');
        }

        const newAgentId = result.agent.id;

        // 创建本地 Agent 对象
        const newAgent: Agent = {
          id: newAgentId,
          name: name.trim(),
          type: agentType as Agent['type'],
          agentType: agentType,
          group: 'general',
          description: AHIVECORE_AGENT_TYPES.find(t => t.id === agentType)?.description || '',
          status: 'idle',
          avatar: agentType === 'ahive-coder' ? 'coder' : 'general',
          position: { 
            x: Math.random() * 6 - 3, 
            y: 0, 
            z: Math.random() * 6 - 3 
          },
          skills: [],
          customFields: {
            endpoint: AHIVECORE_API,
            agentId: newAgentId,
            provider: provider,
            model: model,
            apiKey: apiKey.trim(),
            baseUrl: baseUrl,
            temperature: temperature,
            maxTokens: maxTokens,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // 添加到本地状态
        addAgent(newAgent);

        // 保存到 protocol-config.json
        await saveToProtocolConfig(newAgentId, agentData);
      }

      // 重置表单
      setName('');
      setApiKey('');
      setError(null);
      onClose();
      onCreated?.();

    } catch (err: any) {
      console.error('[CreateAgentDialog] Error:', err);
      setError(err.message || (isZh ? '创建失败' : 'Creation failed'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 - 点击不关闭 */}
      <div className="absolute inset-0 bg-black/60" />
      
      {/* 对话框 */}
      <div className="relative bg-hive-surface border border-hive-border rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* 标题栏 + 关闭按钮 */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-hive-text">
            {editAgent 
              ? (isZh ? '编辑智能体' : 'Edit Agent')
              : (isZh ? '创建新智能体' : 'Create New Agent')
            }
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-hive-bg hover:bg-red-500/20 text-hive-text-secondary hover:text-red-400 transition-colors"
            title={isZh ? '关闭' : 'Close'}
          >
            ✕
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* 智能体类型 */}
        <div className="mb-4">
          <label className="block text-sm text-hive-text-secondary mb-2">
            {isZh ? '智能体类型' : 'Agent Type'}
          </label>
          <div className="flex gap-3">
            {AHIVECORE_AGENT_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setAgentType(t.id)}
                disabled={!!editAgent}  // 编辑模式不允许更改类型
                className={`flex flex-col items-center justify-center px-4 py-3 rounded-lg border-2 transition-all ${
                  agentType === t.id 
                    ? 'border-hive-primary bg-hive-primary/20' 
                    : 'border-hive-border hover:border-hive-text-secondary'
                } ${editAgent ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className="text-2xl">{t.icon}</span>
                <span className="text-sm text-hive-text mt-1">
                  {isZh ? t.name : t.nameEn}
                </span>
                <span className="text-xs text-hive-text-secondary mt-1">
                  {isZh ? t.description : t.descriptionEn}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ✅ 角色选择 - 仅 AHIVE-WORKER 类型显示 */}
        {agentType === 'ahive-worker' && (
          <div className="mb-4 p-4 bg-indigo-500/10 rounded-lg border border-indigo-500/30">
            <label className="block text-sm text-hive-text-secondary mb-2">
              {isZh ? '🎭 选择角色' : '🎭 Select Role'}
              <span className="text-xs text-hive-text-secondary ml-2">
                ({isZh ? '角色配置仅适用于 AHIVE-WORKER 类型' : 'Role config only for AHIVE-WORKER type'})
              </span>
            </label>
            {isLoadingRoles ? (
              <div className="text-hive-text-secondary text-sm py-2">
                {isZh ? '加载角色列表...' : 'Loading roles...'}
              </div>
            ) : roles.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {isZh ? role.name_zh : role.name} - {role.description}
                    </option>
                  ))}
                </select>
                {/* 显示选中角色的详细信息 */}
                {roles.find(r => r.id === selectedRole) && (
                  <div className="text-xs text-hive-text-secondary bg-hive-bg/50 p-2 rounded">
                    <strong>{isZh ? '角色描述：' : 'Description: '}</strong>
                    {roles.find(r => r.id === selectedRole)?.description}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-yellow-400 text-sm py-2">
                {isZh ? '⚠ 无法获取角色列表，请检查 AHIVECORE 服务' : '⚠ Failed to fetch roles, check AHIVECORE service'}
                <button
                  onClick={fetchRoles}
                  className="ml-2 text-hive-primary hover:underline"
                >
                  {isZh ? '重试' : 'Retry'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 名字 */}
        <div className="mb-4">
          <label className="block text-sm text-hive-text-secondary mb-2">
            {isZh ? '名字' : 'Name'}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isZh ? '输入智能体名称' : 'Enter agent name'}
            className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
          />
        </div>

        {/* LLM 配置 */}
        <div className="mb-4 p-4 bg-hive-bg/50 rounded-lg border border-hive-border">
          <h3 className="text-sm font-medium text-hive-text mb-3">
            {isZh ? 'LLM 配置' : 'LLM Configuration'}
          </h3>

          {/* Provider */}
          <div className="mb-3">
            <label className="block text-xs text-hive-text-secondary mb-1">
              {isZh ? 'Provider' : 'Provider'}
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div className="mb-3">
            <label className="block text-xs text-hive-text-secondary mb-1">
              {isZh ? '模型' : 'Model'}
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
            >
              {(COMMON_MODELS[provider] || []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="custom">{isZh ? '自定义...' : 'Custom...'}</option>
            </select>
            {model === 'custom' && (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={isZh ? '输入模型名称' : 'Enter model name'}
                className="w-full mt-2 px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
              />
            )}
          </div>

          {/* API Key */}
          <div className="mb-3">
            <label className="block text-xs text-hive-text-secondary mb-1">
              {isZh ? 'API Key' : 'API Key'}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isZh ? '输入 API Key' : 'Enter API Key'}
              className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
            />
          </div>

          {/* Base URL */}
          {provider !== 'local' && (
            <div className="mb-3">
              <label className="block text-xs text-hive-text-secondary mb-1">
                {isZh ? 'API Base URL' : 'API Base URL'}
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={isZh ? '输入 API Base URL' : 'Enter API Base URL'}
                className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
              />
            </div>
          )}

          {/* Temperature */}
          <div className="mb-3">
            <label className="block text-xs text-hive-text-secondary mb-1">
              {isZh ? 'Temperature' : 'Temperature'}: {temperature}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Max Tokens */}
          <div className="mb-3">
            <label className="block text-xs text-hive-text-secondary mb-1">
              {isZh ? 'Max Tokens' : 'Max Tokens'}
            </label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)}
              min={256}
              max={200000}
              className="w-full px-3 py-2 bg-hive-bg border border-hive-border rounded-lg text-hive-text focus:outline-none focus:border-hive-primary"
            />
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-hive-text-secondary hover:text-hive-text transition-colors"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || !apiKey.trim() || isCreating}
            className="px-6 py-2 bg-hive-primary hover:bg-hive-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isCreating 
              ? (isZh ? '处理中...' : 'Processing...')
              : editAgent 
                ? (isZh ? '保存' : 'Save')
                : (isZh ? '创建' : 'Create')
            }
          </button>
        </div>
      </div>
    </div>
  );
}