"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "approve";
  size?: "sm" | "md";
  /** 异步进行中：显示 spinner，保留原文案（禁止"…中"文案闪烁） */
  loading?: boolean;
  /** 0..1 原地进度底纹（有值时按钮内渲染进度） */
  progress?: number;
  /** 右侧键位提示，如 "⌘S" */
  shortcut?: string;
}

const SIZE_STYLE: Record<NonNullable<ButtonProps["size"]>, string> = {
  // 命中区 ≥24px（WCAG 2.2 SC 2.5.8），md 用舒适区 36px
  sm: "min-h-6 gap-1.5 rounded-md px-2.5 text-xs",
  md: "min-h-9 gap-2 rounded-lg px-4 text-sm",
};

const VARIANT_STYLE: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent text-on-accent shadow-card hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-border bg-surface-2 text-text shadow-card hover:bg-surface-3 active:bg-surface-3",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-stale text-inverse shadow-card hover:bg-stale/85 active:bg-stale/90",
  approve: "border border-approved/50 bg-approved/10 text-approved hover:bg-approved/15 active:bg-approved/20",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    progress,
    shortcut,
    className = "",
    disabled,
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`relative inline-flex select-none items-center justify-center overflow-hidden font-medium transition-colors duration-fast active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${SIZE_STYLE[size]} ${VARIANT_STYLE[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {progress != null && progress > 0 && progress < 1 && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-accent/15"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">
        {loading && (
          <span
            aria-hidden
            className="h-3 w-3 nc-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {children}
        {shortcut && (
          <kbd className="ml-0.5 rounded border border-current/30 px-1 text-[10px] leading-4">
            {shortcut}
          </kbd>
        )}
      </span>
    </button>
  );
});
