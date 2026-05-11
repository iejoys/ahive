/**
 * LLM 配置对话框
 * 
 * 用于首次配置 AHIVECORE 主智能体的 LLM Provider
 * 支持三种类型：云端 API、Ollama 本地、本地 GGUF 模型
 * 
 * ✅ 预设列表从 AHIVECORE API 动态获取，保持同步
 */
import { useState, useEffect } from 'react';

// AHIVECORE API 地址
const AHIVECORE_API = 'http://127.0.0.1:18790';

// Provider 类型
type ProviderType = 'openai' | 'ollama' | 'local';

// 预设配置
interface APIProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
  description?: string;
}

// 配置数据
interface LLMConfigData {
  providerType: ProviderType;
  // 云端 API 配置
  presetId?: string;
  apiEndpoint?: string;
  apiKey?: string;
  apiModel?: string;
  // Ollama 配置
  ollamaHost?: string;
  ollamaModel?: string;
  // 本地模型配置
  modelPath?: string;
  modelName?: string;
  gpuLayers?: number;
  threads?: number;
  contextSize?: number;
  // 通用配置
  temperature?: number;
  maxTokens?: number;
}

interface LLMConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: LLMConfigData) => Promise<void>;
}

// 默认预设（API 不可用时的备用）
const DEFAULT_PRESETS: APIProviderPreset[] = [
  {
    id: 'bailian-coding',
    name: '阿里百炼 Coding Plan',
    endpoint: 'https://coding.dashscope.aliyuncs.com/v1',
    models: ['qwen3.5-plus', 'glm-5', 'kimi-k2.5', 'MiniMax-M2.5'],
    defaultModel: 'qwen3.5-plus',
    description: '阿里百炼 Coding Plan - 聚合 Qwen/GLM/Kimi/MiniMax',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    defaultModel: 'gpt-4o-mini',
    description: 'OpenAI GPT 系列模型',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek 推理和代码模型',
  },
  {
    id: 'custom',
    name: '自定义 API',
    endpoint: '',
    models: [],
    defaultModel: '',
    description: '自定义 OpenAI 兼容 API',
  },
];

// Provider 类型选项
const PROVIDER_TYPES = [
  { id: 'openai', name: '云端 API', icon: '☁️', description: '使用云端 LLM 服务（OpenAI、DeepSeek 等）' },
  { id: 'ollama', name: 'Ollama 本地', icon: '🖥️', description: '使用本地 Ollama 服务' },
  { id: 'local', name: '本地模型', icon: '💾', description: '直接加载 GGUF 模型文件' },
];

export function LLMConfigDialog({ isOpen, onClose, onSave }: LLMConfigDialogProps) {
  // Provider 类型
  const [providerType, setProviderType] = useState<ProviderType>('openai');
  
  // 云端 API 配置
  const [presets, setPresets] = useState<APIProviderPreset[]>(DEFAULT_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('bailian-coding');
  const [isCustomAPI, setIsCustomAPI] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  
  // Ollama 配置
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModel, setOllamaModel] = useState('');
  const [isLoadingOllamaModels, setIsLoadingOllamaModels] = useState(false);
  
  // 本地模型配置
  const [modelPath, setModelPath] = useState('');
  const [localModelName, setLocalModelName] = useState('');
  const [gpuLayers, setGpuLayers] = useState(0);
  const [threads, setThreads] = useState(4);
  const [contextSize, setContextSize] = useState(4096);
  
  // 通用配置
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(200000);
  
  // UI 状态
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // 加载预设（从 AHIVECORE）
  useEffect(() => {
    if (isOpen) {
      loadPresets();
    }
  }, [isOpen]);

  // 预设选择变化
  useEffect(() => {
    if (providerType === 'openai') {
      if (selectedPresetId === 'custom') {
        setIsCustomAPI(true);
        setApiEndpoint('');
        setApiModel('');
      } else {
        setIsCustomAPI(false);
        const preset = presets.find(p => p.id === selectedPresetId);
        if (preset) {
          setApiEndpoint(preset.endpoint);
          setApiModel(preset.defaultModel);
        }
      }
    }
  }, [selectedPresetId, presets, providerType]);

  // 加载预设
  const loadPresets = async () => {
    try {
      const response = await fetch('http://127.0.0.1:18790/api/provider/presets');
      const data = await response.json();
      if (data.success && data.presets?.length > 0) {
        setPresets(data.presets);
      }
    } catch (error) {
      console.warn('[LLMConfigDialog] 加载预设失败，使用默认预设:', error);
    }
  };

  // 加载 Ollama 模型列表
  const loadOllamaModels = async () => {
    if (!ollamaHost.trim()) return;
    
    setIsLoadingOllamaModels(true);
    try {
      const response = await fetch(`${ollamaHost}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map((m: any) => m.name) || [];
        setOllamaModels(models);
        if (models.length > 0 && !ollamaModel) {
          setOllamaModel(models[0]);
        }
      }
    } catch (error) {
      console.warn('[LLMConfigDialog] 加载 Ollama 模型列表失败:', error);
      setOllamaModels([]);
    } finally {
      setIsLoadingOllamaModels(false);
    }
  };

  // Provider 类型切换时
  useEffect(() => {
    if (providerType === 'ollama') {
      loadOllamaModels();
    }
  }, [providerType, ollamaHost]);

  // 获取当前预设的模型列表
  const getAPIModelOptions = () => {
    if (isCustomAPI) return [];
    const preset = presets.find(p => p.id === selectedPresetId);
    return preset?.models || [];
  };

  // 测试连接
  const handleTest = async () => {
    setTestResult(null);
    
    if (providerType === 'openai') {
      if (!apiKey.trim()) {
        setTestResult({ success: false, message: '请填写 API Key' });
        return;
      }
      if (!apiEndpoint.trim()) {
        setTestResult({ success: false, message: '请填写 API 端点' });
        return;
      }
      if (!apiModel.trim()) {
        setTestResult({ success: false, message: '请填写模型名称' });
        return;
      }
    } else if (providerType === 'ollama') {
      if (!ollamaHost.trim()) {
        setTestResult({ success: false, message: '请填写 Ollama 服务地址' });
        return;
      }
      if (!ollamaModel.trim()) {
        setTestResult({ success: false, message: '请选择或填写模型名称' });
        return;
      }
    } else if (providerType === 'local') {
      if (!modelPath.trim()) {
        setTestResult({ success: false, message: '请填写模型文件路径' });
        return;
      }
    }

    setIsTesting(true);

    try {
      let testConfig: any = {};
      
      if (providerType === 'openai') {
        testConfig = {
          type: 'openai',
          config: {
            apiEndpoint,
            apiKey,
            apiModel,
            presetId: isCustomAPI ? 'custom' : selectedPresetId,
          },
        };
      } else if (providerType === 'ollama') {
        testConfig = {
          type: 'ollama',
          config: {
            ollamaHost,
            ollamaModel,
          },
        };
      } else {
        testConfig = {
          type: 'local',
          config: {
            modelPath,
            modelName: localModelName || modelPath.split('/').pop()?.replace('.gguf', '') || 'local-model',
            gpuLayers,
            threads,
            contextSize,
          },
        };
      }

      const response = await fetch('http://127.0.0.1:18790/api/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testConfig),
      });

      const data = await response.json();
      
      if (data.success) {
        setTestResult({ success: true, message: '连接成功！模型可用' });
      } else {
        setTestResult({ success: false, message: data.error || '连接失败' });
      }
    } catch (error) {
      setTestResult({ 
        success: false, 
        message: error instanceof Error ? error.message : '测试请求失败' 
      });
    } finally {
      setIsTesting(false);
    }
  };

  // 保存配置
  const handleSave = async () => {
    // 验证必填字段
    if (providerType === 'openai') {
      if (!apiKey.trim()) {
        alert('请填写 API Key');
        return;
      }
      if (!apiEndpoint.trim()) {
        alert('请填写 API 端点');
        return;
      }
      if (!apiModel.trim()) {
        alert('请填写模型名称');
        return;
      }
    } else if (providerType === 'ollama') {
      if (!ollamaHost.trim()) {
        alert('请填写 Ollama 服务地址');
        return;
      }
      if (!ollamaModel.trim()) {
        alert('请选择或填写模型名称');
        return;
      }
    } else if (providerType === 'local') {
      if (!modelPath.trim()) {
        alert('请填写模型文件路径');
        return;
      }
    }

    setIsLoading(true);
    try {
      const config: LLMConfigData = {
        providerType,
        temperature,
        maxTokens,
      };

      if (providerType === 'openai') {
        config.presetId = isCustomAPI ? 'custom' : selectedPresetId;
        config.apiEndpoint = apiEndpoint;
        config.apiKey = apiKey;
        config.apiModel = apiModel;
      } else if (providerType === 'ollama') {
        config.ollamaHost = ollamaHost;
        config.ollamaModel = ollamaModel;
      } else {
        config.modelPath = modelPath;
        config.modelName = localModelName || modelPath.split('/').pop()?.replace('.gguf', '') || 'local-model';
        config.gpuLayers = gpuLayers;
        config.threads = threads;
        config.contextSize = contextSize;
      }

      await onSave(config);
      onClose();
    } catch (error) {
      alert(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const selectedPreset = presets.find(p => p.id === selectedPresetId);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-2xl border border-gray-600 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
              <span className="text-2xl">🧠</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">配置 AHIVECORE 智能体</h2>
              <p className="text-sm text-gray-400">为指挥官配置 LLM Provider</p>
            </div>
          </div>
          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white transition-colors"
            title="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 提示信息 */}
        <div className="bg-indigo-900/30 border border-indigo-500/30 rounded-lg p-3 mb-5">
          <p className="text-sm text-indigo-300">
            💡 AHIVECORE 是系统的核心智能体（指挥官），需要配置 LLM 才能工作。
            可选择云端 API、本地 Ollama 或直接加载本地模型。
          </p>
        </div>

        {/* Provider 类型选择 */}
        <div className="mb-5">
          <label className="block text-sm text-gray-400 mb-2">
            Provider 类型 <span className="text-red-400">*</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            {PROVIDER_TYPES.map(type => (
              <button
                key={type.id}
                onClick={() => setProviderType(type.id as ProviderType)}
                className={`p-3 rounded-lg border transition-all ${
                  providerType === type.id
                    ? 'bg-indigo-600/30 border-indigo-500 text-white'
                    : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:border-gray-500'
                }`}
              >
                <div className="text-2xl mb-1">{type.icon}</div>
                <div className="font-medium text-sm">{type.name}</div>
                <div className="text-xs text-gray-400 mt-1">{type.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 云端 API 配置 */}
        {providerType === 'openai' && (
          <>
            {/* Provider 选择 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                API Provider <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
              >
                {presets.map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
              {selectedPreset?.description && (
                <p className="text-xs text-gray-500 mt-1.5">{selectedPreset.description}</p>
              )}
            </div>

            {/* API 端点 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                API 端点 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                disabled={!isCustomAPI}
              />
              {!isCustomAPI && (
                <p className="text-xs text-gray-500 mt-1.5">预设端点，不可修改</p>
              )}
            </div>

            {/* API Key */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                API Key <span className="text-red-400">*</span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1.5">密钥将安全存储在本地配置文件中</p>
            </div>

            {/* 模型选择 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                模型 <span className="text-red-400">*</span>
              </label>
              {isCustomAPI ? (
                <input
                  type="text"
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                  placeholder="model-name"
                  className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                />
              ) : (
                <select
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                >
                  {getAPIModelOptions().map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              )}
            </div>
          </>
        )}

        {/* Ollama 配置 */}
        {providerType === 'ollama' && (
          <>
            <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3 mb-4">
              <p className="text-sm text-green-300">
                💡 使用本地 Ollama 服务，无需 API Key，数据完全本地化。
                请确保已安装并启动 Ollama 服务。
              </p>
            </div>

            {/* Ollama 服务地址 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                Ollama 服务地址 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1.5">默认地址: http://localhost:11434</p>
            </div>

            {/* 模型选择 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                模型 <span className="text-red-400">*</span>
              </label>
              {ollamaModels.length > 0 ? (
                <select
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                >
                  {ollamaModels.map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    placeholder="llama3.1:8b"
                    className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1.5">
                    未检测到 Ollama 服务，请手动输入模型名称
                  </p>
                </>
              )}
            </div>

            {/* 刷新模型列表 */}
            {ollamaModels.length === 0 && (
              <button
                onClick={loadOllamaModels}
                disabled={isLoadingOllamaModels}
                className="mb-4 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white text-sm transition-colors"
              >
                {isLoadingOllamaModels ? '刷新中...' : '🔄 刷新模型列表'}
              </button>
            )}
          </>
        )}

        {/* 本地模型配置 */}
        {providerType === 'local' && (
          <>
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 mb-4">
              <p className="text-sm text-amber-300">
                💡 直接加载 GGUF 模型文件，完全离线运行。
                需要下载 GGUF 格式的模型文件到本地。
              </p>
            </div>

            {/* 模型路径 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                模型文件路径 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={modelPath}
                onChange={(e) => setModelPath(e.target.value)}
                placeholder="/path/to/model.gguf"
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1.5">GGUF 模型文件的完整路径</p>
            </div>

            {/* 模型名称 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">
                模型名称（可选）
              </label>
              <input
                type="text"
                value={localModelName}
                onChange={(e) => setLocalModelName(e.target.value)}
                placeholder="Qwen2.5-7B-Instruct"
                className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* 性能设置 */}
            <div className="border-t border-gray-700 pt-4 mt-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">性能设置</h3>
              
              <div className="grid grid-cols-3 gap-4">
                {/* GPU 层数 */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    GPU 层数
                  </label>
                  <input
                    type="number"
                    value={gpuLayers}
                    onChange={(e) => setGpuLayers(parseInt(e.target.value) || 0)}
                    min={0}
                    max={100}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">0 = 纯 CPU</p>
                </div>
                
                {/* 线程数 */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    线程数
                  </label>
                  <input
                    type="number"
                    value={threads}
                    onChange={(e) => setThreads(parseInt(e.target.value) || 4)}
                    min={1}
                    max={32}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                
                {/* 上下文长度 */}
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    上下文长度
                  </label>
                  <input
                    type="number"
                    value={contextSize}
                    onChange={(e) => setContextSize(parseInt(e.target.value) || 4096)}
                    min={512}
                    max={32768}
                    step={512}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* 高级设置（通用） */}
        <div className="border-t border-gray-700 pt-4 mt-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">高级设置</h3>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Temperature */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Temperature
              </label>
              <input
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) || 0.3)}
                min={0}
                max={2}
                step={0.1}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            
            {/* Max Tokens */}
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Max Tokens
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 200000)}
                min={1000}
                max={500000}
                step={1000}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 测试结果 */}
        {testResult && (
          <div className={`mt-4 p-3 rounded-lg ${
            testResult.success 
              ? 'bg-green-900/30 border border-green-500/30' 
              : 'bg-red-900/30 border border-red-500/30'
          }`}>
            <p className={`text-sm ${testResult.success ? 'text-green-300' : 'text-red-300'}`}>
              {testResult.success ? '✅' : '❌'} {testResult.message}
            </p>
          </div>
        )}

        {/* 按钮 */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleTest}
            disabled={isTesting || isLoading}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white disabled:opacity-50 transition-colors"
          >
            {isTesting ? '测试中...' : '测试连接'}
          </button>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white disabled:opacity-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white disabled:opacity-50 transition-colors font-medium"
          >
            {isLoading ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LLMConfigDialog;