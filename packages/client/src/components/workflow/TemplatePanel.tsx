/**
 * 工作流模板选择面板
 * 支持从本地模板库导入和在线模板导入
 */

import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { workflowTemplateService } from '../../services/WorkflowTemplateService';
import type { WorkflowTemplate, OnlineTemplateImportResult } from '../../types';

interface TemplatePanelProps {
  onClose: () => void;
}

export function TemplatePanel({ onClose }: TemplatePanelProps) {
  const { language, addWorkflow, setCurrentWorkflow } = useStore();
  
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  
  // 在线导入状态
  const [onlineUrl, setOnlineUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<WorkflowTemplate | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  
  // 内置模板导入状态
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  // 加载模板
  useEffect(() => {
    loadTemplates();
  }, []);
  
  const loadTemplates = async () => {
    setLoading(true);
    try {
      await workflowTemplateService.loadTemplates();
      const allTemplates = workflowTemplateService.getTemplates();
      setTemplates(allTemplates);
      setCategories(workflowTemplateService.getCategories());
    } catch (error) {
      console.error('[TemplatePanel] Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // 筛选模板
  const filteredTemplates = templates.filter(t => {
    if (selectedCategory && t.category !== selectedCategory) return false;
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      return t.name.toLowerCase().includes(kw) || 
             t.description.toLowerCase().includes(kw);
    }
    return true;
  });
  
  // 从模板创建工作流
  const handleImportTemplate = (templateId: string) => {
    // 清除之前的状态
    setImportError(null);
    setImportSuccess(null);
    
    try {
      const workflow = workflowTemplateService.createFromTemplate(templateId);
      addWorkflow(workflow);
      
      // 显示成功消息
      setImportSuccess(language === 'zh' 
        ? `✅ 已成功导入工作流: ${workflow.name}`
        : `✅ Workflow imported: ${workflow.name}`
      );
      
      // 设置为当前工作流
      setCurrentWorkflow(workflow.id);
      
      // 延迟关闭面板，让用户看到成功提示
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      console.error('[TemplatePanel] Failed to create from template:', error);
      setImportError(error instanceof Error 
        ? error.message 
        : (language === 'zh' ? '导入失败，请重试' : 'Import failed, please try again')
      );
    }
  };
  
  // 在线导入
  const handleOnlineImport = async () => {
    if (!onlineUrl.trim()) return;
    
    setImporting(true);
    setImportError(null);
    
    try {
      const result: OnlineTemplateImportResult = await workflowTemplateService.importFromUrl(onlineUrl);
      
      if (result.success && result.template) {
        setImportPreview(result.template);
        setShowPreview(true);
      } else {
        setImportError(result.error || language === 'zh' ? '导入失败' : 'Import failed');
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };
  
  // 确认导入在线模板
  const handleConfirmOnlineImport = async (saveToLibrary: boolean) => {
    if (!importPreview) return;
    
    try {
      // 保存到本地模板库
      if (saveToLibrary) {
        await workflowTemplateService.saveImportedTemplate(importPreview);
        await loadTemplates(); // 刷新列表
      }
      
      // 创建工作流
      const workflow = workflowTemplateService.createFromTemplate(
        importPreview.id, 
        `${importPreview.name} 副本`
      );
      addWorkflow(workflow);
      
      // 设置为当前工作流
      setCurrentWorkflow(workflow.id);
      
      setShowPreview(false);
      setImportPreview(null);
      setOnlineUrl('');
      onClose();
    } catch (error) {
      console.error('[TemplatePanel] Failed to confirm import:', error);
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-[800px] max-h-[80vh] overflow-hidden border border-gray-700">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            📋 {language === 'zh' ? '工作流模板' : 'Workflow Templates'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>
        
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
          {/* 在线导入区域 */}
          <div className="bg-gray-700/50 rounded-lg p-4 mb-4 border border-gray-600">
            <h3 className="text-white font-medium mb-3 flex items-center gap-2">
              🔗 {language === 'zh' ? '导入在线模板' : 'Import Online Template'}
            </h3>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={onlineUrl}
                onChange={(e) => setOnlineUrl(e.target.value)}
                placeholder={language === 'zh' 
                  ? '模板 JSON 地址 (https://...)' 
                  : 'Template JSON URL (https://...)'
                }
                className="flex-1 bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={handleOnlineImport}
                disabled={importing || !onlineUrl.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white text-sm px-4 py-2 rounded transition-colors"
              >
                {importing 
                  ? (language === 'zh' ? '导入中...' : 'Importing...')
                  : (language === 'zh' ? '导入' : 'Import')
                }
              </button>
            </div>
            
            {importError && (
              <div className="mt-2 text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded">
                ❌ {importError}
              </div>
            )}
            
            {importSuccess && (
              <div className="mt-2 text-green-400 text-sm bg-green-900/20 px-3 py-2 rounded">
                {importSuccess}
              </div>
            )}
          </div>
          
          {/* 筛选器 */}
          <div className="flex gap-3 mb-4">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600"
            >
              <option value="">{language === 'zh' ? '全部类别' : 'All Categories'}</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder={language === 'zh' ? '搜索模板...' : 'Search templates...'}
              className="flex-1 bg-gray-700 text-white text-sm rounded px-3 py-2 border border-gray-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          
          {/* 模板列表 */}
          {loading ? (
            <div className="text-center py-8 text-gray-400">
              {language === 'zh' ? '加载中...' : 'Loading...'}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              {language === 'zh' ? '暂无模板' : 'No templates found'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {filteredTemplates.map(template => (
                <div
                  key={template.id}
                  className="bg-gray-700/50 rounded-lg p-4 border border-gray-600 hover:border-indigo-500 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-white font-medium">{template.name}</h4>
                    {template.isOfficial && (
                      <span className="bg-indigo-600/30 text-indigo-300 text-xs px-2 py-0.5 rounded">
                        {language === 'zh' ? '官方' : 'Official'}
                      </span>
                    )}
                  </div>
                  
                  <p className="text-gray-400 text-sm mb-2 line-clamp-2">
                    {template.description}
                  </p>
                  
                  <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
                    <span className="bg-gray-600/50 px-2 py-0.5 rounded">{template.category}</span>
                    {template.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-gray-400">#{tag}</span>
                    ))}
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleImportTemplate(template.id)}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm py-1.5 rounded transition-colors"
                    >
                      {language === 'zh' ? '导入' : 'Import'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* 导入预览对话框 */}
        {showPreview && importPreview && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="bg-gray-800 rounded-lg p-6 w-[500px] border border-gray-600">
              <h3 className="text-lg font-semibold text-white mb-4">
                {language === 'zh' ? '导入在线模板预览' : 'Online Template Preview'}
              </h3>
              
              <div className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-gray-400">{language === 'zh' ? '名称' : 'Name'}:</span>
                  <span className="text-white">{importPreview.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">{language === 'zh' ? '分类' : 'Category'}:</span>
                  <span className="text-white">{importPreview.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">{language === 'zh' ? '作者' : 'Author'}:</span>
                  <span className="text-white">{importPreview.author}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">{language === 'zh' ? '节点数' : 'Nodes'}:</span>
                  <span className="text-white">{importPreview.nodes.length}</span>
                </div>
                {importPreview.sourceUrl && (
                  <div className="text-gray-400 text-xs truncate">
                    {language === 'zh' ? '来源' : 'Source'}: {importPreview.sourceUrl}
                  </div>
                )}
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => handleConfirmOnlineImport(true)}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded transition-colors"
                >
                  {language === 'zh' ? '导入并保存到模板库' : 'Import & Save to Library'}
                </button>
                <button
                  onClick={() => handleConfirmOnlineImport(false)}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded transition-colors"
                >
                  {language === 'zh' ? '仅创建工作流' : 'Create Workflow Only'}
                </button>
                <button
                  onClick={() => {
                    setShowPreview(false);
                    setImportPreview(null);
                  }}
                  className="px-4 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded transition-colors"
                >
                  {language === 'zh' ? '取消' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}