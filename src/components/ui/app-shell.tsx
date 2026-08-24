"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * 全局应用壳（docs/08 §4.1 + 大改）：
 * - 顶部品牌栏
 * - 左侧栏常驻“章节”快捷切换列表：只要左侧栏存在，章节列表就存在
 * - 管理页左侧流程铁路导航（按 bookId 动态生成、当前页高亮）
 * - 画布页保持沉浸式暗色，不套壳（此时左侧栏整体消失）
 */
const NAV_ITEMS = [
  { key: "overview", label: "项目概览", href: "" },
  { key: "bible", label: "全书档案 · A", href: "/bible" },
  { key: "condense", label: "精简底稿 · B0", href: "/condense" },
  { key: "script", label: "改编脚本 · B", href: "/script" },
  { key: "assets", label: "资产库 · C", href: "/assets" },
  { key: "storyboard", label: "分镜时间轴 · D", href: "/storyboard" },
  { key: "voice", label: "多角色配音 · E", href: "/voice" },
  { key: "render", label: "渲染 · F", href: "/render" },
  { key: "workbench", label: "编排台", href: "/workbench" },
  { key: "canvas", label: "分镜画布", href: "/canvas" },
] as const;



interface ChapterTab {
  id: string;
  idx: number;
  title: string | null;
  char_count: number;
  done: number;
  total: number;
}

const STAGE_KEYS = ["analyze", "condense", "adapt", "storyboard", "voice"] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCanvas = pathname?.includes("/canvas") ?? false;

  const segments = pathname?.split("/").filter(Boolean) ?? [];
  const bookId = segments[0] === "books" && segments[1] ? segments[1] : null;

  const [chapterTabs, setChapterTabs] = useState<ChapterTab[]>([]);

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    fetch(`/api/books/${bookId}/chapter-workspace`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.chapters) return;
        setChapterTabs(
          (json.chapters as Array<{
            id: string;
            idx: number;
            title: string | null;
            char_count: number;
            stages: Record<string, { done: boolean }>;
          }>).map((ch) => ({
            id: ch.id,
            idx: ch.idx,
            title: ch.title,
            char_count: ch.char_count,
            done: STAGE_KEYS.filter((key) => ch.stages[key]?.done).length,
            total: STAGE_KEYS.length,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (isCanvas) return <>{children}</>;

  const currentChapterId = searchParams.get("chapter") ?? "";

  function switchChapter(chapterId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("chapter", chapterId);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

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
          <aside className="scroll-hover-reveal scroll-contain sticky top-12 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-1 p-3 lg:flex">
            {chapterTabs.length > 0 && (
              <div className="border-b border-border pb-3">
                <p className="px-2 pb-1 text-overline font-medium uppercase tracking-widest text-text-subtle">
                  章节
                </p>
                <div className="space-y-0.5">
                  {chapterTabs.map((ch) => {
                    const active =
                      currentChapterId === ch.id || (!currentChapterId && ch.idx === chapterTabs[0].idx);
                    const complete = ch.done === ch.total;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => switchChapter(ch.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors duration-fast ${
                          active
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-text-muted hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            complete ? "bg-approved" : ch.done > 0 ? "bg-regen" : "bg-border"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          第 {ch.idx} 章{ch.title ? ` · ${ch.title}` : ""}
                        </span>
                        <span className={active ? "text-accent/70" : "text-text-subtle"}>
                          {ch.done}/{ch.total}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
