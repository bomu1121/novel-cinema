"use client";

import type { ReactNode } from "react";

/**
 * 表单字段容器（docs/08 §5.2）：
 * Label → Control → Hint/Error 统一结构；错误用 role=alert。
 */
export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, required, children, className = "" }: FieldProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={htmlFor} className="block text-caption font-medium text-text">
          {label}
          {required && <span aria-hidden className="ml-0.5 text-stale">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-caption text-stale">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
