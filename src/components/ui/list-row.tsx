"use client";

import type { HTMLAttributes, ReactNode } from "react";

/**
 * 统一列表行（docs/08 §5.3）：分隔线 + hover 底色，适合章节/任务/审阅列表。
 */
export interface ListRowProps extends HTMLAttributes<HTMLLIElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
}

export function ListRow({ leading, trailing, selected = false, className = "", children, ...rest }: ListRowProps) {
  return (
    <li
      className={`flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-body transition-colors duration-fast last:border-0 ${
        selected ? "bg-accent-soft/40" : "hover:bg-surface-2"
      } ${className}`}
      {...rest}
    >
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">{children}</div>
      </div>
      {trailing && <div className="shrink-0 text-text-muted">{trailing}</div>}
    </li>
  );
}
