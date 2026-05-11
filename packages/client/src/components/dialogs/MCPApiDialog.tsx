/**
 * MCP API 配置对话框
 * 支持动态表单渲染
 */
import { useState, useEffect } from 'react';

// 输入字段定义
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

// 平台类型
type MCPApiPlatformType = 'bailian' | 'openai' | 'anthropic';

// MCP Server 配置
interface MCPServerConfig {
  label: string;
  description?: string;
  url: string;
}

// MCP API 配置
interface MCPApiConfig {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  platformType: MCPApiPlatformType;
  fieldValues: Record<string, any>;
  mcpServers: MCPServerConfig[];
  createdAt?: string;
  updatedAt?: string;
}

interface MCPApiDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: MCPApiConfig) => Promise<void>;
  editingConfig?: MCPApiConfig | null;
}

// 平台选项
const PLATFORM_OPTIONS = [
  { value: 'bailian' as MCPApiPlatformType, label: '阿里云百炼', description: '阿里云百炼 Responses API + MCP' },
  { value: 'openai' as MCPApiPlatformType, label: 'OpenAI', description: 'OpenAI Responses API + MCP' },
  { value: 'anthropic' as MCPApiPlatformType, label: 'Anthropic Claude', description: 'Claude Messages API + MCP Connector' },
];

export function MCPApiDialog({ isOpen, onClose, onSave, editingConfig }: MCPApiDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platformType, setPlatformType] = useState<MCPApiPlatformType>('bailian');
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([{ label: '', url: '' }]);
  const [inputFields, setInputFields] = useState<InputField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFields, setIsLoadingFields] = useState(false);

  // 加载平台输入字段
  useEffect(() => {
    if (isOpen && platformType) {
      loadPlatformInputFields(platformType);
    }
  }, [isOpen, platformType]);

  // 加载平台输入字段
  const loadPlatformInputFields = async (platformId: string) => {
    console.log('[MCPApiDialog] loadPlatformInputFields called for:', platformId);
    setIsLoadingFields(true);
    try {
      const anyWindow = window as any;
      console.log('[MCPApiDialog] electronAPI exists:', !!anyWindow.electronAPI);
      console.log('[MCPApiDialog] getMCPApiPlatformInputFields exists:', !!anyWindow.electronAPI?.getMCPApiPlatformInputFields);
      
      if (anyWindow.electronAPI?.getMCPApiPlatformInputFields) {
        console.log('[MCPApiDialog] Calling IPC with platformId:', platformId);
        const fields = await anyWindow.electronAPI.getMCPApiPlatformInputFields(platformId);
        console.log('[MCPApiDialog] Received fields:', fields);
        setInputFields(fields || []);
        
        // 设置默认值
        const defaults: Record<string, any> = {};
        fields.forEach((field: InputField) => {
          if (field.default !== undefined) {
            defaults[field.name] = field.default;
          }
        });
        setFieldValues(prev => ({ ...defaults, ...prev }));
      } else {
        console.warn('[MCPApiDialog] getMCPApiPlatformInputFields not available in electronAPI');
      }
    } catch (error) {
      console.error('[MCPApiDialog] Failed to load input fields:', error);
    } finally {
      setIsLoadingFields(false);
    }
  };

  // 编辑模式：加载配置
  useEffect(() => {
    if (isOpen && editingConfig) {
      setName(editingConfig.name);
      setDescription(editingConfig.description || '');
      setPlatformType(editingConfig.platformType);
      setFieldValues(editingConfig.fieldValues || {});
      setMcpServers(editingConfig.mcpServers?.length > 0 ? editingConfig.mcpServers : [{ label: '', url: '' }]);
    } else if (isOpen) {
      // 新建模式：重置
      setName('');
      setDescription('');
      setPlatformType('bailian');
      setFieldValues({});
      setMcpServers([{ label: '', url: '' }]);
    }
  }, [isOpen, editingConfig]);

  if (!isOpen) return null;

  // 更新字段值
  const handleFieldChange = (fieldName: string, value: any) => {
    setFieldValues(prev => ({ ...prev, [fieldName]: value }));
  };

  // 更新 MCP Server
  const handleMcpServerChange = (index: number, field: keyof MCPServerConfig, value: string) => {
    setMcpServers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // 添加 MCP Server
  const addMcpServer = () => {
    setMcpServers(prev => [...prev, { label: '', url: '' }]);
  };

  // 删除 MCP Server
  const removeMcpServer = (index: number) => {
    setMcpServers(prev => prev.filter((_, i) => i !== index));
  };

  // 保存配置
  const handleSave = async () => {
    // 验证必填字段
    if (!name.trim()) {
      alert('请填写名称');
      return;
    }

    // 验证平台必填字段
    for (const field of inputFields) {
      if (field.required && !fieldValues[field.name]) {
        alert(`请填写 ${field.label}`);
        return;
      }
    }

    // 验证 MCP Server
    const validServers = mcpServers.filter(s => s.label && s.url);
    if (validServers.length === 0) {
      alert('请至少配置一个 MCP Server');
      return;
    }

    setIsLoading(true);
    try {
      const config: MCPApiConfig = {
        id: editingConfig?.id || `mcp-api-${Date.now()}`,
        name: name.trim(),
        description: description.trim() || undefined,
        enabled: editingConfig?.enabled ?? true,
        platformType,
        fieldValues,
        mcpServers: validServers,
        createdAt: editingConfig?.createdAt,
        updatedAt: new Date().toISOString(),
      };

      await onSave(config);
      onClose();
    } catch (error) {
      alert(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 渲染输入字段
  const renderInputField = (field: InputField) => {
    const value = fieldValues[field.name] ?? field.default ?? '';
    
    return (
      <div key={field.name} className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">
          {field.label} {field.required && <span className="text-red-400">*</span>}
        </label>
        
        {field.type === 'select' ? (
          <select
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          >
            {field.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <input
            type={field.type}
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            placeholder={field.placeholder}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
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
          {editingConfig ? '编辑 MCP API' : '添加 MCP API'}
        </h2>

        {/* 基本信息 */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">
            名称 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: 百炼 + 高德地图"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">描述</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选描述"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          />
        </div>

        {/* 平台选择 */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">
            平台 <span className="text-red-400">*</span>
          </label>
          <select
            value={platformType}
            onChange={(e) => setPlatformType(e.target.value as MCPApiPlatformType)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          >
            {PLATFORM_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {PLATFORM_OPTIONS.find(o => o.value === platformType)?.description}
          </p>
        </div>

        {/* 动态字段 */}
        {isLoadingFields ? (
          <div className="text-gray-400 text-center py-4">加载配置...</div>
        ) : (
          <div className="border-t border-gray-700 pt-4 mt-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">API 配置</h3>
            {inputFields.map(renderInputField)}
          </div>
        )}

        {/* MCP Server 配置 */}
        <div className="border-t border-gray-700 pt-4 mt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">MCP Server 配置</h3>
          
          {mcpServers.map((server, index) => (
            <div key={index} className="mb-4 p-3 bg-gray-700/50 rounded">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-400">Server {index + 1}</span>
                {mcpServers.length > 1 && (
                  <button
                    onClick={() => removeMcpServer(index)}
                    className="text-red-400 text-sm hover:text-red-300"
                  >
                    删除
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={server.label}
                  onChange={(e) => handleMcpServerChange(index, 'label', e.target.value)}
                  placeholder="Server 标签"
                  className="px-2 py-1 bg-gray-600 border border-gray-500 rounded text-white text-sm"
                />
                <input
                  type="text"
                  value={server.url}
                  onChange={(e) => handleMcpServerChange(index, 'url', e.target.value)}
                  placeholder="SSE 端点 URL"
                  className="px-2 py-1 bg-gray-600 border border-gray-500 rounded text-white text-sm"
                />
              </div>
              
              <input
                type="text"
                value={server.description || ''}
                onChange={(e) => handleMcpServerChange(index, 'description', e.target.value)}
                placeholder="描述（可选）"
                className="w-full mt-2 px-2 py-1 bg-gray-600 border border-gray-500 rounded text-white text-sm"
              />
            </div>
          ))}
          
          <button
            onClick={addMcpServer}
            className="text-indigo-400 text-sm hover:text-indigo-300"
          >
            + 添加 MCP Server
          </button>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-3 mt-6">
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
            {isLoading ? '保存中...' : (editingConfig ? '更新' : '添加')}
          </button>
        </div>
      </div>
    </div>
  );
}

// 列表项组件
interface MCPApiListItemProps {
  config: MCPApiConfig;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}

export function MCPApiListItem({ config, onEdit, onDelete, onToggle }: MCPApiListItemProps) {
  const platformLabel = PLATFORM_OPTIONS.find(o => o.value === config.platformType)?.label || config.platformType;
  const [isExpanded, setIsExpanded] = useState(false);
  const serverCount = config.mcpServers?.length || 0;
  
  return (
    <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
      {/* 主行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600/20 rounded-lg flex items-center justify-center">
            <span className="text-xl">🔌</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              {/* 状态指示器 */}
              <span className={config.enabled ? 'text-green-400' : 'text-gray-500'}>
                {config.enabled ? '●' : '○'}
              </span>
              <h4 className="text-white font-medium">{config.name}</h4>
              {/* MCP Server 数量徽章 */}
              {serverCount > 0 && (
                <span 
                  className="px-2 py-0.5 text-xs bg-indigo-600/30 text-indigo-300 rounded-full cursor-pointer hover:bg-indigo-600/40"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {serverCount} 个 MCP Server
                </span>
              )}
            </div>
            <p className="text-gray-400 text-sm">{platformLabel}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 启用/禁用按钮 - 显示相反操作 */}
          <button
            onClick={() => onToggle(!config.enabled)}
            className={`px-3 py-1 rounded text-sm ${
              config.enabled
                ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
            }`}
          >
            {config.enabled ? '禁用' : '启用'}
          </button>
          <button
            onClick={onEdit}
            className="px-3 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-sm"
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-sm"
          >
            删除
          </button>
        </div>
      </div>
      
      {/* MCP Server 展开列表 */}
      {serverCount > 0 && isExpanded && (
        <div className="mt-3 pt-3 border-t border-gray-600">
          <div className="text-xs text-gray-400 mb-2">MCP Server 列表：</div>
          <div className="space-y-2">
            {config.mcpServers.map((server, index) => (
              <div key={index} className="flex items-start gap-2 p-2 bg-gray-800/50 rounded text-sm">
                <span className="text-indigo-400 shrink-0">#{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{server.label}</span>
                    {server.description && (
                      <span className="text-gray-500 text-xs">{server.description}</span>
                    )}
                  </div>
                  <div className="text-gray-400 text-xs truncate" title={server.url}>
                    {server.url}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}