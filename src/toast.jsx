import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ToastContext = createContext(() => {});
export function errorMessage(error) {
  return error?.message === '连接不上服务，请确认本地服务已启动' || error?.message?.startsWith('生成失败：')
    ? error.message : `生成失败：${error?.message || '操作未完成，请重试'}`;
}
export function ToastProvider({ children }) {
  const [notice, setNotice] = useState(null);
  const timer = useRef(null);
  const toast = useCallback((message, action) => {
    clearTimeout(timer.current);
    setNotice({ message, action });
    timer.current = setTimeout(() => setNotice(null), action ? 5000 : 3000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <ToastContext.Provider value={toast}>
    {children}
    {notice && <div className="toast" role="status" aria-live="polite">
      <span>{notice.message}</span>
      {notice.action && <button onClick={async () => {
        clearTimeout(timer.current);
        setNotice(null);
        try { await notice.action.fn(); } catch (error) { toast(errorMessage(error)); }
      }}>{notice.action.label}</button>}
    </div>}
  </ToastContext.Provider>;
}
export function useToast() { return useContext(ToastContext); }
