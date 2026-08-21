"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export interface ToastAction {
  label: string;
  onAction: () => void;
}

interface ToastItem {
  id: number;
  type: "success" | "error" | "info" | "progress";
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  push: (type: ToastItem["type"], message: string, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

/** 语义色（令牌，docs/06 §5.1） */
const TYPE_STYLE: Record<ToastItem["type"], string> = {
  success: "border-approved/40 bg-approved/10 text-approved",
  error: "border-stale/40 bg-stale/10 text-stale",
  progress: "border-accent/40 bg-accent/10 text-accent",
  info: "border-border-strong bg-surface-2 text-text-muted",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastItem["type"], message: string, action?: ToastAction) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, type, message, action }]);
      if (type !== "error" && type !== "progress") {
        window.setTimeout(() => dismiss(id), type === "success" ? 4000 : 6000);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* WCAG 4.1.3 状态消息：polite 播报；错误条目用 role="alert" 覆盖为 assertive */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-sm shadow-card ${TYPE_STYLE[t.type]}`}
          >
            <span className="min-w-0 flex-1">
              {t.type === "progress" && (
                <span
                  aria-hidden
                  className="mr-1 inline-block h-2 w-2 nc-pulse rounded-full bg-current"
                />
              )}
              {t.message}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onAction();
                    dismiss(t.id);
                  }}
                  className="min-h-6 min-w-6 rounded-md border border-current/40 px-2 text-xs font-medium hover:bg-current/10"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="关闭通知"
                onClick={() => dismiss(t.id)}
                className="flex min-h-6 min-w-6 items-center justify-center rounded-md text-base leading-none opacity-50 hover:bg-current/10 hover:opacity-100"
              >
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
