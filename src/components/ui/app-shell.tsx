"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 全局应用壳（docs/08 §4.1 + 大改）：
 * - 顶部品牌栏
 * - 管理页左侧流程铁路导航（按 bookId 动态生成、当前页高亮）
 * - 画布页保持沉浸式暗色，不套壳
 */
const NAV_ITEMS = [
  { key: "overview", label: "项目概览", href: "" },
  { key: "bible", label: "全书档案 · A", href: "/bible" },
  { key: "script", label: "改编脚本 · B", href: "/script" },
  { key: "assets", label: "资产库 · C", href: "/assets" },
  { key: "storyboard", label: "分镜时间轴 · D", href: "/storyboard" },
  { key: "voice", label: "多角色配音 · E", href: "/voice" },
  { key: "render", label: "渲染 · F", href: "/render" },
  { key: "workbench", label: "编排台", href: "/workbench" },
  { key: "canvas", label: "分镜画布", href: "/canvas" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isCanvas = pathname?.includes("/canvas") ?? false;
  if (isCanvas) return <>{children}</>;

  const segments = pathname?.split("/").filter(Boolean) ?? [];
  const bookId = segments[0] === "books" && segments[1] ? segments[1] : null;

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

      <div className="flex">
        {bookId && (
          <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-1 p-3 lg:flex">
            <p className="px-2 pb-1 text-overline font-medium uppercase tracking-widest text-text-subtle">
              流程
            </p>
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const href = item.key === "overview" ? `/books/${bookId}` : `/books/${bookId}${item.href}`;
                const active =
                  item.key === "overview"
                    ? pathname === `/books/${bookId}`
                    : pathname === href;
                return (
                  <Link
                    key={item.key}
                    href={href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors duration-fast ${
                      active
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
