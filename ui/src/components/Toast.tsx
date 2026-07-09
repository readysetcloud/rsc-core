import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms (default 5000; errors default to 8000). */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: ReactNode;
  variant: ToastVariant;
}

interface ToastApi {
  toast: (message: ReactNode, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: ReactNode, options?: ToastOptions) => {
      const id = nextId.current++;
      const variant = options?.variant ?? 'info';
      const duration = options?.duration ?? (variant === 'error' ? 8000 : 5000);
      setItems((current) => [...current, { id, message, variant }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="toast-viewport" role="region" aria-label="Notifications">
            {items.map((t) => (
              <div
                key={t.id}
                className={cx('toast', `toast-${t.variant}`)}
                role={t.variant === 'error' ? 'alert' : 'status'}
              >
                <span style={{ flex: 1 }}>{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'inherit',
                    opacity: 0.6,
                    minHeight: 'auto',
                    padding: 0,
                    fontSize: '1rem',
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
