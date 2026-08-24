"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { PhaseRail } from "@/components/ui/phase-rail";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list-row";
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
}

const SIGN_OFF_ENTRIES = [
  { href: "/bible", key: "A", title: "全书档案", desc: "人物 / 线索 / 风格方案" },
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

export default function BookDetailPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [book, setBook] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/books/${bookId}/chapters`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setBook(data.book);
        setChapters(data.chapters ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
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
              <StatusPill table="books" status={book.status} />
            </span>
          ) : undefined
        }
        description="按签核点推进：档案 → 改编 → 资产 → 分镜 → 配音 → 渲染。画布与编排台是深度编辑入口。"
      />

      {book && <PhaseRail current={PHASE_MAP[book.status] ?? 1} className="max-w-xl" />}

      <ErrorBanner message={error} />

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
        <h2 className="mb-3 font-display text-title font-semibold">章节</h2>
        {chapters.length === 0 ? (
          <p className="text-sm text-text-subtle">还没有章节数据。</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {chapters.map((ch) => (
              <ListRow
                key={ch.id}
                leading={
                  <span className="font-medium text-text">
                    {ch.kind === "front" ? "前言" : `第 ${ch.idx} 章`}
                    {ch.title ? ` · ${ch.title}` : ""}
                  </span>
                }
                trailing={
                  <span className="inline-flex items-center gap-2 text-text-muted">
                    {ch.char_count.toLocaleString()} 字
                    <StatusPill table="source_chapters" status={ch.status} />
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
