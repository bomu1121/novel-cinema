"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

/**
 * 统一文本输入（docs/08 §5.2）：默认/悬停/聚焦/禁用/错误状态。
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const BASE =
  "h-10 w-full rounded-md border bg-surface px-3 text-body text-text placeholder:text-text-subtle transition-colors duration-fast focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-subtle";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${BASE} ${
        invalid
          ? "border-stale focus:border-stale focus:ring-2 focus:ring-stale/20"
          : "border-border hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25"
      } ${className}`}
      {...rest}
    />
  );
});
