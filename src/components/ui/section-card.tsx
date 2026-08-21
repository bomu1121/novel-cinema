"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

export interface SectionCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  /** 右上角动作区（按钮等） */
  actions?: ReactNode;
}

/** 统一内容卡片：边框 + 卡片阴影 + 可选标题/动作 */
export const SectionCard = forwardRef<HTMLDivElement, SectionCardProps>(function SectionCard(
  { title, actions, className = "", children, ...rest },
  ref,
) {
  return (
    <section
      ref={ref}
      className={`rounded-lg border border-border bg-surface ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
});
