"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { CONTROL_BASE, controlBorder } from "./control-styles";

/**
 * 统一下拉选择（docs/08 §5.2 + 输入框重构）：与 Input 同一视觉语言。
 * 2–3 个静态选项应优先用 chip/radio 组（docs/07 V2 lint 原则）。
 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

// 下拉右侧需要给 chevron 留空间，把默认 px-3 替换为 pl-3 pr-8
const BASE = CONTROL_BASE.replace("px-3", "pl-3 pr-8");

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className = "", children, ...rest },
  ref,
) {
  return (
    <span className="relative block w-full">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${BASE} ${controlBorder(!!invalid)} ${className}`}
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
