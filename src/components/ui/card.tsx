"use client";

import type { HTMLAttributes, ReactNode } from "react";

/**
 * 统一卡片（docs/08 §5.3）：
 * - default：普通信息卡（border 单手段，不叠阴影）
 * - interactive：可点击卡（hover 边框/阴影）
 * - selected：选中态（accent 边框 + 底色）
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  interactive?: boolean;
  selected?: boolean;
  /** 媒体卡/图片卡：去掉 body 默认 p-4 内边距 */
  flush?: boolean;
  title?: ReactNode;
  actions?: ReactNode;
}

export function Card({
  interactive = false,
  selected = false,
  flush = false,
  title,
  actions,
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`rounded-lg border bg-surface ${
        selected
          ? "border-accent bg-accent-soft/40 ring-1 ring-accent/30"
          : interactive
            ? "border-border transition-colors duration-fast hover:border-border-strong hover:shadow-card"
            : "border-border"
      } ${interactive ? "cursor-pointer" : ""} ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {title && <h3 className="text-lead font-semibold text-text">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </div>
  );
}
