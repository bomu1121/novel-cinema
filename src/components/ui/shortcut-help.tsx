"use client";

import { useEffect, useState } from "react";

export interface ShortcutItem {
  keys: string;
  label: string;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * 全站快捷键帮助（docs/08 §7 / M3）：按 `?` 打开，Esc/遮罩关闭。
 * 在输入控件内不劫持。
 */
export function ShortcutHelp({ items }: { items: ShortcutItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isEditable(e.target)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="快捷键帮助"
      className="fixed inset-0 z-[300] flex items-start justify-center bg-surface-invert/40 p-[10vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[480px] max-w-[90vw] rounded-xl border border-border bg-surface-1 p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-title font-semibold text-text">快捷键</h2>
          <button
            type="button"
            aria-label="关闭快捷键帮助"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          >
            ×
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.keys} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-text-muted">{item.label}</span>
              <kbd className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text">
                {item.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-caption text-text-subtle">按 `?` 再次关闭 · 输入框内不会触发</p>
      </div>
    </div>
  );
}
