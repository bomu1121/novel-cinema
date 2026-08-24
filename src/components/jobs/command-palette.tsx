"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 命令面板（docs/06 §6.3 CommandPalette）：Cmd+K 唤起，动作 + 跳转，
 * 键盘：↑/↓ 选择 · Enter 执行 · Esc 关闭。Hick 定律——长尾动作收进面板。
 */

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  items: PaletteItem[];
  onClose: () => void;
}

export function CommandPalette({ open, items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (open) {
      // 打开面板时的状态归零（查询清空/光标复位），属订阅语义
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const run = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-surface-invert/30 p-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(filtered.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              const item = filtered[cursor];
              if (item) run(item);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder="输入动作或页面…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
          aria-label="命令查询"
        />
        <ul className="scroll-contain max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-text-subtle">没有匹配的命令</li>
          )}
          {filtered.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => run(item)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  i === cursor ? "bg-accent/10 text-accent" : "text-text"
                }`}
              >
                <span>{item.label}</span>
                {item.hint && <span className="text-xs text-text-subtle">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
