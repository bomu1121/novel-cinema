"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";

/**
 * 统一多行文本域（docs/08 §5.2）：与 Input 同一视觉语言；mono 变体给 JSON/代码。
 */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

const BASE =
  "min-h-20 w-full rounded-md border bg-surface px-3 py-2 text-body text-text placeholder:text-text-subtle transition-colors duration-fast focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-subtle";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, mono, className = "", ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${BASE} ${
        mono ? "font-mono text-caption" : ""
      } ${
        invalid
          ? "border-stale focus:border-stale focus:ring-2 focus:ring-stale/20"
          : "border-border hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/25"
      } ${className}`}
      {...rest}
    />
  );
});
