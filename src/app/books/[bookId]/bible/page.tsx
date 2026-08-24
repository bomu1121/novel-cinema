"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Card } from "@/components/ui/card";
import { JobRunner } from "@/components/jobs/job-runner";

interface StyleProposal {
  genre: string[];
  visual_style: string;
  art_direction: string;
  color_palette: string[];
  camera_grammar: Record<string, string>;
  narration_tone: string;
  spoiler_rules: string[];
  negative_prompt: string;
}

interface ChapterRow {
  id: string;
  idx: number;
  title: string | null;
  char_count: number;
  status: string;
}

interface SummaryRow {
  source_chapter_id: string;
  summary: string;
  key_events?: unknown;
  characters?: unknown;
  clues?: unknown;
  tone: string | null;
}

interface BibleData {
  book?: { id: string; title: string; status: string } | null;
  chapters?: ChapterRow[];
  summaries?: SummaryRow[];
  characters?: Array<{
    id: string;
    canonical_name: string;
    aliases: string[];
    role: string;
    description: string | null;
    status: string;
  }>;
  locations?: Array<{ id: string; name: string; description: string | null; visual_note: string | null }>;
  items?: Array<{ id: string; name: string; kind: string; description: string | null }>;
  clues?: Array<{
    id: string;
    name: string;
    clue_type: string;
    description: string;
    is_red_herring: boolean;
    is_spoiler: boolean;
  }>;
  events?: Array<{ id: string; time_label: string; description: string }>;
  styleBible?: {
    id: string;
    version: number;
    status: string;
    proposal_json: StyleProposal[];
    approved_proposal_index: number | null;
  } | null;
}

export default function BiblePage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const searchParams = useSearchParams();
  const queryChapterId = searchParams.get("chapter");

  const [data, setData] = useState<BibleData>({});
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  // 每个章节独立记住最近一次 jobId：切换章节后仍能接回该章进度，互不锁定
  const [jobIds, setJobIds] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/bible`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
      const chapters = (json.chapters ?? []) as ChapterRow[];
      const summaryIds = new Set((json.summaries ?? []).map((s: SummaryRow) => s.source_chapter_id));
      const firstPending = chapters.find((c) => !summaryIds.has(c.id)) ?? chapters[0];
      const preferred =
        queryChapterId && chapters.some((c) => c.id === queryChapterId)
          ? queryChapterId
          : (firstPending?.id ?? null);
      setSelectedChapterId(preferred);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId, queryChapterId]);

  useEffect(() => {
    // 挂载后拉取档案数据；setState 均发生在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function approve(proposalIndex: number) {
    if (!data.styleBible) return;
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/bible/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleBibleId: data.styleBible.id, proposalIndex }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "批准失败");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }

  const summariesByChapter = useMemo(
    () => new Map((data.summaries ?? []).map((s) => [s.source_chapter_id, s])),
    [data.summaries],
  );
  const selectedChapter = data.chapters?.find((c) => c.id === selectedChapterId) ?? null;
  const selectedSummary = selectedChapter ? summariesByChapter.get(selectedChapter.id) : undefined;
  const selectedChapterLabel = selectedChapter
    ? `第 ${selectedChapter.idx} 章${selectedChapter.title ? ` · ${selectedChapter.title}` : ""}`
    : "尚未选择章节";

  return (
    <PageShell className="space-y-8">
      <PageHeader
        title={data.book?.title ?? "全书档案"}
        meta="签核点 A"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
      />

      <ErrorBanner message={error} />

      {data.chapters && data.chapters.length === 0 && (
        <EmptyState description="还没有可分析的章节，请先回首页上传 .txt。" />
      )}

      {data.chapters && data.chapters.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="font-semibold">章节分析</h2>
            <p className="mt-1 text-sm text-text-muted">
              这里按“单章”执行分析：选择一章，读取该章原文并生成摘要。不同章节可并行发起，互不锁定；人物 / 地点 /
              线索 / 风格候选属于下方“全书档案”，不会随章节切换而丢失。
            </p>
          </div>

          <Card className={selectedSummary ? "" : "border-dashed"}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">当前分析对象</h3>
                <p className="mt-1 text-sm text-text-muted">
                  {selectedChapter ? (
                    <>
                      <span className="font-medium text-text">{selectedChapterLabel}</span>
                      （{selectedChapter.char_count.toLocaleString()} 字）
                    </>
                  ) : (
                    "请选择章节"
                  )}
                </p>
              </div>
              {selectedSummary && (
                <span className="rounded-full bg-approved/10 px-2.5 py-1 text-caption text-approved">
                  ✓ 已分析
                </span>
              )}
            </div>

            {selectedSummary ? (
              <div className="mt-3 border-t border-border pt-3">
                <h4 className="text-sm font-medium text-text">本章摘要</h4>
                <p className="mt-1 text-sm leading-6 text-text-muted">{selectedSummary.summary}</p>
                {selectedSummary.tone && (
                  <p className="mt-2 text-xs text-text-muted">基调：{selectedSummary.tone}</p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-text-muted">
                {selectedChapter ? "本章尚未分析，点击下方按钮生成摘要。" : "请先在列表中选择一章。"}
              </p>
            )}

            {selectedChapter && (
              <div className="mt-4">
                <JobRunner
                  key={selectedChapter.id}
                  bookId={bookId}
                  node="analyze"
                  label={
                    selectedSummary
                      ? `重新分析「${selectedChapterLabel}」`
                      : `分析「${selectedChapterLabel}」`
                  }
                  input={{ chapterId: selectedChapter.id }}
                  initialJobId={jobIds[selectedChapter.id] ?? null}
                  onStart={(jobId) =>
                    setJobIds((prev) => ({ ...prev, [selectedChapter.id]: jobId }))
                  }
                  onDone={() => void load()}
                />
              </div>
            )}
          </Card>
        </section>
      )}

      <section className="space-y-6 border-t border-border pt-6">
        <div>
          <h2 className="font-semibold">全书档案（书级）</h2>
          <p className="mt-1 text-sm text-text-muted">
            以下内容由已分析章节合并 / 最近一次分析生成，属于整本书，不随上方章节切换变化。
          </p>
        </div>

        {data.characters && data.characters.length > 0 && (
          <section>
            <h3 className="mb-3 font-semibold">人物</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.characters.map((c) => (
                <Card key={c.id} className="text-sm">
                  <p className="font-medium">
                    {c.canonical_name}
                    {c.aliases.length > 0 && (
                      <span className="ml-2 text-xs text-text-muted">aka {c.aliases.join(" / ")}</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-text-subtle">{c.role}</p>
                  <p className="mt-2 text-text-muted">{c.description}</p>
                </Card>
              ))}
            </div>
          </section>
        )}

        {data.locations && data.locations.length > 0 && (
          <section>
            <h3 className="mb-3 font-semibold">地点</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.locations.map((loc) => (
                <Card key={loc.id} className="text-sm">
                  <p className="font-medium">{loc.name}</p>
                  {loc.description && <p className="mt-1 text-text-muted">{loc.description}</p>}
                  {loc.visual_note && (
                    <p className="mt-1 text-xs text-text-subtle">视觉：{loc.visual_note}</p>
                  )}
                </Card>
              ))}
            </div>
          </section>
        )}

        {data.clues && data.clues.length > 0 && (
          <section>
            <h3 className="mb-3 font-semibold">线索</h3>
            <div className="space-y-2">
              {data.clues.map((cl) => (
                <Card key={cl.id} className="border-clue/40 bg-clue/10 px-4 py-3 text-sm">
                  <span className="font-medium">{cl.name}</span>
                  <span className="ml-2 text-xs text-clue">{cl.clue_type}</span>
                  {cl.is_red_herring && <span className="ml-2 text-xs text-spoiler">红鲱鱼</span>}
                  {cl.is_spoiler && <span className="ml-2 text-xs text-spoiler">剧透禁画</span>}
                  <p className="mt-1 text-text-muted">{cl.description}</p>
                </Card>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">风格圣经候选（AI 提案，选定后锁定）</h3>
              <p className="mt-1 text-xs text-text-muted">
                书级共享；重新分析任一章节都会刷新候选。
              </p>
            </div>
            {data.styleBible && data.styleBible.proposal_json?.length > 1 && (
              <button
                type="button"
                onClick={() => setCompareMode((m) => !m)}
                className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-muted hover:bg-surface-3"
              >
                {compareMode ? "退出对比（纵向）" : "左右对比"}
              </button>
            )}
          </div>
          {!data.styleBible && (
            <EmptyState description="还没有候选。先在“章节分析”区选择一章并运行分析。" />
          )}
          <div className={compareMode ? "grid gap-4 lg:grid-cols-3" : "space-y-4"}>
            {data.styleBible?.proposal_json?.map((p, i) => (
              <Card
                key={i}
                className={`text-sm ${
                  data.styleBible?.approved_proposal_index === i
                    ? "border-approved/40 bg-approved/10"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">方案 {i + 1}</h4>
                  {data.styleBible?.approved_proposal_index === i ? (
                    <StatusPill table="style_bibles" status="approved" />
                  ) : (
                    <Button
                      size="sm"
                      variant="approve"
                      onClick={() => approve(i)}
                      disabled={approving}
                      loading={approving}
                    >
                      批准这套
                    </Button>
                  )}
                </div>
                <p className="mt-3 font-mono text-xs leading-5 text-text">{p.visual_style}</p>
                <p className="mt-2 text-text-muted">{p.art_direction}</p>
                {p.color_palette.length > 0 && (
                  <p className="mt-2 flex items-center gap-2">
                    {p.color_palette.map((color) => (
                      <span
                        key={color}
                        className="inline-block h-5 w-5 rounded border border-border-strong"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </p>
                )}
                <p className="mt-2 text-xs text-text-muted">旁白基调：{p.narration_tone}</p>
                {p.spoiler_rules.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-clue">
                    {p.spoiler_rules.map((rule, j) => (
                      <li key={j}>{rule}</li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </section>
      </section>
    </PageShell>
  );
}
