"use client";

import type { ReactNode } from "react";

/**
 * 统一页面容器（docs/08 §4.1 + 大改）：
 * 所有页面共用同一套宽度/内边距/间距，消灭手写 `max-w-* px-* py-*`。
 */
export function PageShell({
  size = "default",
  className = "",
  children,
}: {
  size?: "narrow" | "default" | "wide";
  className?: string;
  children: ReactNode;
}) {
  const width = size === "narrow" ? "max-w-3xl" : size === "wide" ? "max-w-6xl" : "max-w-5xl";
  return (
    <main className={`mx-auto w-full ${width} px-4 py-6 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </main>
  );
}
