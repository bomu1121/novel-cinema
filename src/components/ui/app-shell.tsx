"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 全局应用壳（docs/08 §4.1）：顶部品牌栏。
 * 画布页保持沉浸式暗色，不套顶栏。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isCanvas = pathname?.includes("/canvas") ?? false;

  if (isCanvas) return <>{children}</>;

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border bg-surface-1/95 px-4 backdrop-blur">
        <Link
          href="/"
          className="font-display text-lead font-semibold tracking-tight text-accent hover:text-accent-hover"
        >
          novel-cinema
        </Link>
        <span className="hidden text-caption text-text-muted sm:inline">小说影像化工作台</span>
        <div className="ml-auto flex items-center gap-2 text-caption text-text-subtle">
          <span className="hidden md:inline">按 ⌘K 打开命令面板</span>
        </div>
      </header>
      {children}
    </div>
  );
}
