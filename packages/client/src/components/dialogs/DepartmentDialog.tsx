/**
 * 部门管理弹窗
 * 提供部门创建、编辑、删除及内部工作流配置
 */

import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { DepartmentManager } from '../workflow/DepartmentManager';

export function DepartmentDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const { agents, workflows, departments, setDepartments, language } = useStore();
  const isZh = language === 'zh';

  // 监听打开事件
  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-department-dialog', handleOpen);
    return () => window.removeEventListener('open-department-dialog', handleOpen);
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* 弹窗内容 */}
      <div className="relative bg-gray-900 rounded-lg border border-gray-700 shadow-2xl w-[900px] h-[85vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-xl">👥</span>
            <h2 className="text-lg font-semibold text-white">
              {isZh ? '部门管理' : 'Department Management'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
        
        {/* 主体内容 */}
        <div className="flex-1 overflow-hidden">
          <DepartmentManager
            agents={agents}
            workflows={workflows}
            departments={departments}
            onDepartmentsChange={setDepartments}
            onClose={handleClose}
          />
        </div>
      </div>
    </div>
  );
}

export default DepartmentDialog;