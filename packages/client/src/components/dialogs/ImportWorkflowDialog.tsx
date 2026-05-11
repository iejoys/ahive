/**
 * 工作流导入对话框
 * 支持从 JSON 文件导入工作流，可自定义名称
 */

import { useState, useRef } from 'react';
import { useStore } from '../../store/useStore';
import { importWorkflowToStorage, workflowNameExistsInStorage } from '../../scheduler/DataSync';

interface ImportWorkflowDialogProps {
  onClose: () => void;
}

export function ImportWorkflowDialog({ onClose }: ImportWorkflowDialogProps) {
  const { language, addWorkflow, setCurrentWorkflow } = useStore();
  
  const [fileContent, setFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [customName, setCustomName] = useState<string>('');
  const [preview, setPreview] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 读取文件
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setFileName(file.name);
    setError(null);
    setPreview(null);
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setFileContent(content);
      
      try {
        const data = JSON.parse(content);
        
        // 验证基本结构
        if (!data.name || !data.nodes || !Array.isArray(data.nodes)) {
          setError(language === 'zh' 
            ? '无效的工作流文件：缺少 name 或 nodes 字段' 
            : 'Invalid workflow file: missing name or nodes field'
          );
          return;
        }
        
        setPreview(data);
        setCustomName(data.name || '');
        setNameError(null);
      } catch {
        setError(language === 'zh' 
          ? '无效的 JSON 文件' 
          : 'Invalid JSON file'
        );
      }
    };
    reader.onerror = () => {
      setError(language === 'zh' 
        ? '文件读取失败' 
        : 'Failed to read file'
      );
    };
    reader.readAsText(file);
  };
  
  // 验证名称
  const validateName = async (name: string) => {
    if (!name.trim()) {
      setNameError(language === 'zh' ? '名称不能为空' : 'Name cannot be empty');
      return false;
    }
    
    const exists = await workflowNameExistsInStorage(name.trim());
    if (exists) {
      setNameError(language === 'zh' 
        ? `名称 "${name}" 已存在` 
        : `Name "${name}" already exists`
      );
      return false;
    }
    
    setNameError(null);
    return true;
  };
  
  // 名称变化处理
  const handleNameChange = (name: string) => {
    setCustomName(name);
    if (name.trim()) {
      // 延迟验证
      setTimeout(() => validateName(name), 300);
    }
  };
  
  // 导入
  const handleImport = async () => {
    if (!fileContent || !customName.trim()) return;
    
    // 验证名称
    const valid = await validateName(customName);
    if (!valid) return;
    
    setImporting(true);
    setError(null);
    
    try {
      const result = await importWorkflowToStorage(fileContent, customName.trim());
      
      if (result.success && result.workflow) {
        // 添加到 store
        addWorkflow(result.workflow);
        setCurrentWorkflow(result.workflow.id);
        onClose();
      } else {
        setError(result.error || (language === 'zh' ? '导入失败' : 'Import failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-[500px] border border-gray-700">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            📥 {language === 'zh' ? '导入工作流' : 'Import Workflow'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          {/* 文件选择 */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              {language === 'zh' ? '选择 JSON 文件' : 'Select JSON File'}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 px-3 rounded border border-gray-600 text-left"
            >
              {fileName || (language === 'zh' ? '点击选择文件...' : 'Click to select file...')}
            </button>
          </div>
          
          {/* 预览 */}
          {preview && (
            <div className="bg-gray-700/50 rounded p-3 border border-gray-600">
              <h3 className="text-white font-medium mb-2">
                {language === 'zh' ? '文件预览' : 'File Preview'}
              </h3>
              <div className="text-sm text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-400">{language === 'zh' ? '原始名称' : 'Original Name'}:</span>
                  <span>{preview.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">{language === 'zh' ? '节点数' : 'Nodes'}:</span>
                  <span>{preview.nodes?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">{language === 'zh' ? '连线数' : 'Edges'}:</span>
                  <span>{preview.edges?.length || 0}</span>
                </div>
              </div>
            </div>
          )}
          
          {/* 自定义名称 */}
          {preview && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                {language === 'zh' ? '工作流名称' : 'Workflow Name'}
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={language === 'zh' ? '输入工作流名称' : 'Enter workflow name'}
                className={`w-full bg-gray-700 text-white text-sm rounded px-3 py-2 border ${
                  nameError ? 'border-red-500' : 'border-gray-600 focus:border-indigo-500'
                } focus:outline-none`}
              />
              {nameError && (
                <p className="text-red-400 text-xs mt-1">{nameError}</p>
              )}
            </div>
          )}
          
          {/* 错误提示 */}
          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded">
              ❌ {error}
            </div>
          )}
        </div>
        
        {/* 底部按钮 */}
        <div className="flex gap-3 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded transition-colors"
          >
            {language === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button
            onClick={handleImport}
            disabled={!preview || !customName.trim() || importing || !!nameError}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-2 rounded transition-colors"
          >
            {importing 
              ? (language === 'zh' ? '导入中...' : 'Importing...')
              : (language === 'zh' ? '导入' : 'Import')
            }
          </button>
        </div>
      </div>
    </div>
  );
}