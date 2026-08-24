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
  size?: "narrow" | "default" | "wide" | "full";
  className?: string;
  children: ReactNode;
}) {
  const width =
    size === "narrow" ? "max-w-3xl" : size === "wide" ? "max-w-6xl" : size === "full" ? "max-w-none" : "max-w-5xl";
  const padding = size === "full" ? "px-3 py-6 sm:px-4" : "px-4 py-6 sm:px-6 lg:px-8";
  return (
    <main className={`mx-auto w-full ${width} ${padding} ${className}`}>
      {children}
    </main>
  );
}
