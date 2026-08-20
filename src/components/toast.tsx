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
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start justify-between rounded-xl border px-3 py-2 text-sm shadow-lg ${
              t.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : t.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : t.type === "progress"
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            <span className="flex-1">
              {t.type === "progress" && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
              {t.message}
            </span>
            <span className="ml-2 flex items-center gap-2">
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onAction();
                    dismiss(t.id);
                  }}
                  className="rounded border border-current px-1.5 py-0.5 text-xs font-medium hover:opacity-70"
                >
                  {t.action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} className="text-xs opacity-50 hover:opacity-100">×</button>
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
