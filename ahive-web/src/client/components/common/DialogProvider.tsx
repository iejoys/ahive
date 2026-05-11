/**
 * 全局对话框系统
 * 替代原生 alert/confirm，解决 Electron 焦点丢失问题
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

// 对话框类型
type DialogType = 'alert' | 'confirm' | 'success' | 'warning' | 'error';

// 对话框配置
interface DialogConfig {
  type: DialogType;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

// 对话框状态
interface DialogState extends DialogConfig {
  id: number;
  resolve: (value: boolean) => void;
}

// Context 类型
interface DialogContextType {
  alert: (message: string, title?: string, type?: DialogType) => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
  success: (message: string, title?: string) => Promise<void>;
  warning: (message: string, title?: string) => Promise<void>;
  error: (message: string, title?: string) => Promise<void>;
}

const DialogContext = createContext<DialogContextType | null>(null);

// 获取图标和颜色
const getDialogStyle = (type: DialogType) => {
  switch (type) {
    case 'success':
      return {
        icon: '✓',
        iconBg: 'bg-emerald-500/20',
        iconColor: 'text-emerald-400',
        borderColor: 'border-emerald-500/30',
        glowColor: 'shadow-emerald-500/20',
        accentColor: 'bg-emerald-600 hover:bg-emerald-500',
      };
    case 'warning':
      return {
        icon: '⚠',
        iconBg: 'bg-amber-500/20',
        iconColor: 'text-amber-400',
        borderColor: 'border-amber-500/30',
        glowColor: 'shadow-amber-500/20',
        accentColor: 'bg-amber-600 hover:bg-amber-500',
      };
    case 'error':
      return {
        icon: '✕',
        iconBg: 'bg-red-500/20',
        iconColor: 'text-red-400',
        borderColor: 'border-red-500/30',
        glowColor: 'shadow-red-500/20',
        accentColor: 'bg-red-600 hover:bg-red-500',
      };
    case 'confirm':
      return {
        icon: '?',
        iconBg: 'bg-indigo-500/20',
        iconColor: 'text-indigo-400',
        borderColor: 'border-indigo-500/30',
        glowColor: 'shadow-indigo-500/20',
        accentColor: 'bg-indigo-600 hover:bg-indigo-500',
      };
    default:
      return {
        icon: 'ℹ',
        iconBg: 'bg-cyan-500/20',
        iconColor: 'text-cyan-400',
        borderColor: 'border-cyan-500/30',
        glowColor: 'shadow-cyan-500/20',
        accentColor: 'bg-cyan-600 hover:bg-cyan-500',
      };
  }
};

// 获取默认标题
const getDefaultTitle = (type: DialogType, language: 'zh' | 'en'): string => {
  const titles = {
    zh: { alert: '提示', confirm: '确认', success: '成功', warning: '警告', error: '错误' },
    en: { alert: 'Notice', confirm: 'Confirm', success: 'Success', warning: 'Warning', error: 'Error' },
  };
  return titles[language][type];
};

// 单个对话框组件
const DialogBox: React.FC<{
  dialog: DialogState;
  onResolve: (id: number, result: boolean) => void;
  language: 'zh' | 'en';
}> = ({ dialog, onResolve, language }) => {
  const style = getDialogStyle(dialog.type);
  const confirmText = dialog.confirmText || (language === 'zh' ? '确定' : 'OK');
  const cancelText = dialog.cancelText || (language === 'zh' ? '取消' : 'Cancel');

  const handleConfirm = () => {
    dialog.onConfirm?.();
    onResolve(dialog.id, true);
  };

  const handleCancel = () => {
    dialog.onCancel?.();
    onResolve(dialog.id, false);
  };

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center animate-fadeIn"
      onClick={dialog.type === 'confirm' ? handleCancel : handleConfirm}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      
      {/* Dialog Box */}
      <div
        className={`
          relative w-full max-w-md mx-4
          bg-gradient-to-b from-gray-800 to-gray-900
          border ${style.borderColor}
          rounded-lg overflow-hidden
          shadow-2xl ${style.glowColor}
          animate-scaleIn
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sci-Fi Top Decoration */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
        
        {/* Corner Decorations */}
        <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-cyan-500/40" />
        <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-cyan-500/40" />
        <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-cyan-500/40" />
        <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-cyan-500/40" />

        {/* Header */}
        <div className="px-6 pt-5 pb-3 flex items-center gap-4">
          {/* Icon */}
          <div className={`
            w-12 h-12 rounded-lg ${style.iconBg} 
            flex items-center justify-center
            border border-white/10
          `}>
            <span className={`text-2xl font-bold ${style.iconColor}`}>
              {style.icon}
            </span>
          </div>
          
          {/* Title */}
          <h3 className="text-lg font-semibold text-white tracking-wide">
            {dialog.title || getDefaultTitle(dialog.type, language)}
          </h3>
        </div>

        {/* Message */}
        <div className="px-6 pb-5">
          <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
            {dialog.message}
          </p>
        </div>

        {/* Buttons */}
        <div className="px-6 pb-5 flex justify-end gap-3">
          {dialog.type === 'confirm' && (
            <button
              onClick={handleCancel}
              className="
                px-5 py-2 rounded
                bg-gray-700 hover:bg-gray-600
                text-gray-300 text-sm font-medium
                border border-gray-600
                transition-all duration-200
                hover:border-gray-500
              "
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`
              px-5 py-2 rounded
              ${style.accentColor}
              text-white text-sm font-medium
              transition-all duration-200
              shadow-lg
            `}
          >
            {confirmText}
          </button>
        </div>

        {/* Sci-Fi Bottom Decoration */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
      </div>
    </div>
  );
};

// Dialog Provider 组件
export const DialogProvider: React.FC<{ 
  children: React.ReactNode;
  language?: 'zh' | 'en';
}> = ({ children, language = 'zh' }) => {
  const [dialogs, setDialogs] = useState<DialogState[]>([]);
  const dialogIdRef = useRef(0);

  const addDialog = useCallback((config: DialogConfig): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = ++dialogIdRef.current;
      setDialogs((prev) => [...prev, { ...config, id, resolve }]);
    });
  }, []);

  const removeDialog = useCallback((id: number, result: boolean) => {
    setDialogs((prev) => {
      const dialog = prev.find((d) => d.id === id);
      if (dialog) {
        dialog.resolve(result);
      }
      return prev.filter((d) => d.id !== id);
    });
  }, []);

  const alert = useCallback(
    (message: string, title?: string, type: DialogType = 'alert'): Promise<void> => {
      return addDialog({ type, message, title }).then(() => {});
    },
    [addDialog]
  );

  const confirm = useCallback(
    (message: string, title?: string): Promise<boolean> => {
      return addDialog({ type: 'confirm', message, title });
    },
    [addDialog]
  );

  const success = useCallback(
    (message: string, title?: string): Promise<void> => {
      return addDialog({ type: 'success', message, title }).then(() => {});
    },
    [addDialog]
  );

  const warning = useCallback(
    (message: string, title?: string): Promise<void> => {
      return addDialog({ type: 'warning', message, title }).then(() => {});
    },
    [addDialog]
  );

  const error = useCallback(
    (message: string, title?: string): Promise<void> => {
      return addDialog({ type: 'error', message, title }).then(() => {});
    },
    [addDialog]
  );

  // 全局访问
  useEffect(() => {
    (window as any).__dialogContext = { alert, confirm, success, warning, error };
    
    // 保存原始函数
    const _originalAlert = window._originalAlert || window.alert;
    const _originalConfirm = window._originalConfirm || window.confirm;
    window._originalAlert = _originalAlert;
    window._originalConfirm = _originalConfirm;
    
    // 覆写 alert - 使用自定义对话框
    window.alert = (message?: any): void => {
      // 如果是 Electron 环境，用原始 alert（preload 会处理焦点问题）
      if (window !== window.parent) {
        _originalAlert(message);
        return;
      }
      // 否则用自定义对话框
      addDialog({ type: 'alert', message: String(message) });
    };
    
    // 覆写 confirm - 使用自定义对话框（同步版本）
    // 注意：这会阻塞，但我们用原始 confirm 作为后备
    window.confirm = (message?: any): boolean => {
      // 如果是 Electron 环境，用原始 confirm（preload 会处理焦点问题）
      if (window !== window.parent) {
        return _originalConfirm(message);
      }
      // 非 Electron 环境暂时用原始 confirm
      return _originalConfirm(message);
    };
    
    return () => {
      delete (window as any).__dialogContext;
      window.alert = _originalAlert;
      window.confirm = _originalConfirm;
    };
  }, [alert, confirm, success, warning, error, addDialog]);

  return (
    <DialogContext.Provider value={{ alert, confirm, success, warning, error }}>
      {children}
      {dialogs.map((dialog) => (
        <DialogBox
          key={dialog.id}
          dialog={dialog}
          onResolve={removeDialog}
          language={language}
        />
      ))}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { 
            opacity: 0;
            transform: scale(0.9) translateY(-10px);
          }
          to { 
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.15s ease-out;
        }
        .animate-scaleIn {
          animation: scaleIn 0.2s ease-out;
        }
      `}</style>
    </DialogContext.Provider>
  );
};

// Hook
export const useDialog = (): DialogContextType => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within DialogProvider');
  }
  return context;
};

// 全局函数（用于非 React 代码）
export const dialog = {
  alert: (message: string, title?: string, type?: DialogType): Promise<void> => {
    const ctx = (window as any).__dialogContext;
    if (ctx) return ctx.alert(message, title, type);
    window.alert(message);
    return Promise.resolve();
  },
  confirm: (message: string, title?: string): Promise<boolean> => {
    const ctx = (window as any).__dialogContext;
    if (ctx) return ctx.confirm(message, title);
    return Promise.resolve(window.confirm(message));
  },
  success: (message: string, title?: string): Promise<void> => {
    const ctx = (window as any).__dialogContext;
    if (ctx) return ctx.success(message, title);
    window.alert(message);
    return Promise.resolve();
  },
  warning: (message: string, title?: string): Promise<void> => {
    const ctx = (window as any).__dialogContext;
    if (ctx) return ctx.warning(message, title);
    window.alert(message);
    return Promise.resolve();
  },
  error: (message: string, title?: string): Promise<void> => {
    const ctx = (window as any).__dialogContext;
    if (ctx) return ctx.error(message, title);
    window.alert(message);
    return Promise.resolve();
  },
};