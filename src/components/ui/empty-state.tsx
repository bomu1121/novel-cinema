"use client";

import type { ReactNode } from "react";

/**
 * 空状态（docs/06 §6.1 / docs/07 V8）：
 * - 必须给"原因 + 下一步"，有动作时提供一键入口，而不是只写"暂无数据"。
 * - 只用于"确实没有数据"的场景；禁止为未生成的 AI 产物渲染假就绪骨架。
 */
export interface EmptyStateProps {
  /** 可选：空状态标题 */
  title?: ReactNode;
  /** 必填语义：下一步该做什么 / 为什么是空的 */
  description: ReactNode;
  /** 可选：一键执行动作（<Button> / <Link> 等） */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`text-sm text-text-subtle ${className}`}>
      {title && <p className="font-medium text-text">{title}</p>}
      <p>{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
