"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { CONTROL_BASE, controlBorder } from "./control-styles";

/**
 * 统一文本输入（docs/08 §5.2 + 输入框重构）：
 * hover 边框加深、focus 细 ring、caret/selection 跟随品牌色、错误/禁用清晰。
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${CONTROL_BASE} ${controlBorder(!!invalid)} ${className}`}
      {...rest}
    />
  );
});
