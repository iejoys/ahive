import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

/**
 * 覆写原生 alert/confirm 以解决 Electron iframe 焦点丢失问题
 * 问题：https://github.com/electron/electron/issues/19977
 */
const originalAlert = window.alert;
const originalConfirm = window.confirm;

window.alert = (message?: any): void => {
  originalAlert(message);
  
  // 焦点恢复：延迟执行确保对话框已完全关闭
  setTimeout(() => {
    window.focus();
    const activeEl = document.activeElement as HTMLElement;
    if (activeEl && typeof activeEl.focus === 'function') {
      activeEl.blur();
      activeEl.focus();
    }
    if (!activeEl || activeEl === document.body) {
      const firstInput = document.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])') as HTMLElement;
      firstInput?.focus();
    }
  }, 50);
};

window.confirm = (message?: any): boolean => {
  const result = originalConfirm(message);
  
  // 焦点恢复
  setTimeout(() => {
    window.focus();
    const activeEl = document.activeElement as HTMLElement;
    if (activeEl && typeof activeEl.focus === 'function') {
      activeEl.blur();
      activeEl.focus();
    }
    if (!activeEl || activeEl === document.body) {
      const firstInput = document.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])') as HTMLElement;
      firstInput?.focus();
    }
  }, 50);
  
  return result;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)