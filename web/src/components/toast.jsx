import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Notice } from './ui.jsx';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {toast && <div className="toast"><Notice tone={toast.tone} title={toast.message} /></div>}
    </ToastContext.Provider>
  );
}

// Runs an async action; shows the success message, or the server's error message.
export function useRun() {
  const notify = useContext(ToastContext);
  return useCallback(async (fn, okMessage) => {
    try {
      const out = await fn();
      if (okMessage) notify(okMessage);
      return out;
    } catch (e) {
      notify(e.message, 'danger');
      return undefined;
    }
  }, [notify]);
}
