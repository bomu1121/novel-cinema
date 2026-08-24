"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 统一页面页头（docs/08 §4.2）：
 * 返回链接 → 标题 + 状态/元信息 → 操作区 → 可选说明。
 */
export interface PageHeaderProps {
  title: ReactNode;
  backHref?: string;
  backLabel?: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  backHref,
  backLabel = "← 返回",
  description,
  meta,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {backHref && (
            <Link href={backHref} className="inline-block text-caption text-text-muted hover:text-text">
              {backLabel}
            </Link>
          )}
          <h1 className="font-display text-page font-semibold tracking-tight text-text">
            {title}
            {meta && <span className="ml-2 align-middle text-sm font-normal text-text-subtle">{meta}</span>}
          </h1>
          <div aria-hidden className="h-1 w-10 rounded-full bg-accent" />
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="max-w-3xl text-body text-text-muted">{description}</p>}
    </header>
  );
}
