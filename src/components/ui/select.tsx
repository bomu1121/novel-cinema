"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";

/**
 * 统一下拉选择（docs/08 §5.2）：与 Input 同一视觉语言。
 * 2–3 个静态选项应优先用 chip/radio 组（docs/07 V2 lint 原则）。
 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

const BASE =
  "h-10 w-full appearance-none rounded-md border bg-surface px-3 pr-8 text-body text-text transition-all duration-fast focus:shadow-card focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-subtle";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className = "", children, ...rest },
  ref,
) {
  return (
    <span className="relative block w-full">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${BASE} ${
          invalid
            ? "border-stale focus:border-stale focus:ring-2 focus:ring-stale/20"
            : "border-border hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25"
        } ${className}`}
        {...rest}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
});
