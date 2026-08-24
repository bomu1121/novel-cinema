"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { CONTROL_BASE, controlBorder } from "./control-styles";

/**
 * 统一多行文本域（docs/08 §5.2 + 输入框重构）：与 Input 同一视觉语言；mono 变体给 JSON/代码。
 */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

const BASE = CONTROL_BASE.replace("h-10", "min-h-20").replace("px-3", "px-3 py-2");

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, mono, className = "", ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${BASE} ${mono ? "font-mono text-caption" : ""} ${controlBorder(!!invalid)} ${className}`}
      {...rest}
    />
  );
});
