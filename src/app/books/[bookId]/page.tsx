"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { PhaseRail } from "@/components/ui/phase-rail";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

interface ChapterSummary {
  id: string;
  idx: number;
  kind: string;
  title: string | null;
  char_count: number;
  status: string;
}

interface BookDetail {
  id: string;
  title: string;
  status: string;
  total_chars: number;
  created_at: string;
  source_encoding?: string | null;
  parse_report?: {
    removedLines?: number;
    dedupedLines?: number;
    tailRemoved?: boolean;
    mergedLineBreaks?: number;
    tocLinesSkipped?: number;
  } | null;
}

interface ChapterStage {
  done: boolean;
  status?: string | null;
  beatCount?: number;
  shotCount?: number;
  takeCount?: number;
}

interface ChapterWorkspaceRow {
  id: string;
  idx: number;
  title: string | null;
  char_count: number;
  status: string;
  stages: {
    analyze: ChapterStage;
    condense: ChapterStage;
    adapt: ChapterStage;
    storyboard: ChapterStage;
    voice: ChapterStage;
  };
}

const SIGN_OFF_ENTRIES = [
  { href: "/bible", key: "A", title: "全书档案", desc: "人物 / 线索 / 风格方案" },
  { href: "/condense", key: "B0", title: "精简底稿", desc: "原文对照 · 视频向精简 · 手动修正" },
  { href: "/script", key: "B", title: "改编脚本", desc: "beats 逐条审阅" },
  { href: "/assets", key: "C", title: "资产库", desc: "设定图与表情变体" },
  { href: "/storyboard", key: "D", title: "分镜时间轴", desc: "镜头 / 图层 / 预览" },
  { href: "/voice", key: "E", title: "多角色配音", desc: "TTS + ASR 校验" },
  { href: "/render", key: "F", title: "渲染", desc: "本地命令与任务记录" },
] as const;

const PHASE_MAP: Record<string, number> = {
  draft: 1,
  analyzing: 1,
  scripting: 2,
  asset_ready: 3,
  rendering: 5,
  completed: 6,
  failed: 1,
};

const WORKSPACE_STAGES: Array<{
  key: keyof ChapterWorkspaceRow["stages"];
  label: string;
  href: string;
  detail?: (row: ChapterWorkspaceRow) => string;
}> = [
  { key: "analyze", label: "分析", href: "bible" },
  { key: "condense", label: "精简", href: "condense" },
  {
    key: "adapt",
    label: "改编",
    href: "script",
    detail: (row) => (row.stages.adapt.done ? `${row.stages.adapt.beatCount ?? 0} beats` : ""),
  },
  {
    key: "storyboard",
    label: "分镜",
    href: "storyboard",
    detail: (row) => (row.stages.storyboard.done ? `${row.stages.storyboard.shotCount ?? 0} 镜头` : ""),
  },
  {
    key: "voice",
    label: "配音",
    href: "voice",
    detail: (row) => (row.stages.voice.done ? `${row.stages.voice.takeCount ?? 0} 句` : ""),
  },
];

export default function BookDetailPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [workspace, setWorkspace] = useState<ChapterWorkspaceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [chaptersRes, workspaceRes] = await Promise.all([
          fetch(`/api/books/${bookId}/chapters`),
          fetch(`/api/books/${bookId}/chapter-workspace`),
        ]);
        const chaptersJson = await chaptersRes.json();
        const workspaceJson = await workspaceRes.json();
        if (cancelled) return;

        if (chaptersJson.error) {
          setError(chaptersJson.error);
          return;
        }
        setBook(chaptersJson.book);
        setChapters(chaptersJson.chapters ?? []);
        setWorkspace((workspaceJson.chapters ?? []) as ChapterWorkspaceRow[]);
        if (workspaceJson.error) {
          // 进度聚合失败不阻断概览页，只显示基础章节列表
          setWorkspace([]);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title={book?.title ?? "项目"}
        backHref="/"
        backLabel="← 返回项目列表"
        meta={
          book ? (
            <span className="inline-flex items-center gap-2">
              {book.total_chars.toLocaleString()} 字 · {chapters.length} 章
              {book.source_encoding ? ` · ${book.source_encoding}` : ""}
              <StatusPill table="books" status={book.status} />
            </span>
          ) : undefined
        }
        description="按签核点推进：档案 → 改编 → 资产 → 分镜 → 配音 → 渲染。画布与编排台是深度编辑入口。"
      />

      {book && <PhaseRail current={PHASE_MAP[book.status] ?? 1} className="max-w-xl" />}

      <ErrorBanner message={error} />

      {book?.parse_report && (
        <p className="text-caption text-text-muted">
          清洗报告：删除水印/符号 {book.parse_report.removedLines ?? 0} 行 · 去重{" "}
          {book.parse_report.dedupedLines ?? 0} 行 · 合并断行{" "}
          {book.parse_report.mergedLineBreaks ?? 0} 处
          {(book.parse_report.tocLinesSkipped ?? 0) > 0
            ? ` · 跳过目录 ${book.parse_report.tocLinesSkipped} 行`
            : ""}
          {book.parse_report.tailRemoved ? " · 已移除文末“全文完”标记" : ""}
        </p>
      )}

      {book && (
        <section>
          <h2 className="mb-3 font-display text-title font-semibold">签核入口</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SIGN_OFF_ENTRIES.map((entry) => (
              <Link key={entry.key} href={`/books/${bookId}${entry.href}`} className="block">
                <Card interactive className="h-full">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-lead font-semibold text-text">{entry.title}</span>
                    <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-caption text-accent">
                      签核 {entry.key}
                    </span>
                  </div>
                  <p className="mt-1 text-caption text-text-muted">{entry.desc}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-title font-semibold">章节进度总览</h2>
        {workspace.length > 0 ? (
          <Card flush className="overflow-hidden">
            <div className="grid grid-cols-2 items-center gap-2 border-b border-border bg-surface-2 px-4 py-2 text-xs font-medium text-text-muted md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]">
              <span>章节</span>
              {WORKSPACE_STAGES.map((stage) => (
                <span key={stage.key} className="hidden md:block">{stage.label}</span>
              ))}
            </div>
            <div className="divide-y divide-border">
              {workspace.map((ch) => (
                <div
                  key={ch.id}
                  className="grid grid-cols-2 items-center gap-2 px-4 py-2 text-sm md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text">
                      第 {ch.idx} 章{ch.title ? ` · ${ch.title}` : ""}
                    </p>
                    <p className="text-xs text-text-muted">{ch.char_count.toLocaleString()} 字</p>
                  </div>

                  {WORKSPACE_STAGES.map((stage) => {
                    const value = ch.stages[stage.key];
                    const done = value?.done ?? false;
                    const detail = stage.detail?.(ch);
                    return (
                      <Link
                        key={stage.key}
                        href={`/books/${bookId}/${stage.href}?chapter=${encodeURIComponent(ch.id)}`}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors duration-fast ${
                          done
                            ? "border-approved/40 bg-approved/10 text-approved hover:bg-approved/20"
                            : "border-border bg-surface-2 text-text-muted hover:border-accent/40 hover:text-text"
                        }`}
                        title={done ? "已完成，点击进入" : "未完成，点击进入"}
                      >
                        <span aria-hidden>{done ? "✓" : "○"}</span>
                        <span className="hidden sm:inline">{stage.label}</span>
                        {detail && <span className="hidden lg:inline text-text-subtle">· {detail}</span>}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {chapters.map((ch) => (
              <li key={ch.id} className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm last:border-0">
                <span className="font-medium text-text">
                  {ch.kind === "front" ? "前言" : `第 ${ch.idx} 章`}
                  {ch.title ? ` · ${ch.title}` : ""}
                </span>
                <span className="inline-flex items-center gap-2 text-text-muted">
                  {ch.char_count.toLocaleString()} 字
                  <StatusPill table="source_chapters" status={ch.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
