import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const remove = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-ui-success" />,
    error: <XCircle className="w-5 h-5 text-ui-danger" />,
    warning: <AlertCircle className="w-5 h-5 text-ui-warning" />,
    info: <Info className="w-5 h-5 text-ui-info" />,
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed top-4 start-1/2 -translate-x-1/2 z-[80] flex flex-col gap-2 w-full max-w-sm px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-3 bg-ui-surface rounded-xl shadow-ui-lg ring-1 ring-ui-border px-4 py-3 animate-slide-down"
          >
            {icons[toast.type]}
            <span className="flex-1 text-sm text-ui-text">{toast.message}</span>
            <button onClick={() => remove(toast.id)} className="text-ui-subtle hover:text-ui-text transition-colors" aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
