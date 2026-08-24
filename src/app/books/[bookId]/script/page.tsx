"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { ImpactPill } from "@/components/ui/impact-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ShortcutHelp } from "@/components/ui/shortcut-help";
import { PageShell } from "@/components/ui/page-shell";
import { JobRunner } from "@/components/jobs/job-runner";
import { StagedReviewPanel } from "@/components/jobs/staged-review-panel";
import { PlanSheet } from "@/components/jobs/plan-sheet";
import { useToast } from "@/components/toast";
import { useJob } from "@/lib/ui/use-job";
import { EMOTIONS } from "@/lib/ui/enums";

interface BeatRow {
  id: string;
  idx: number;
  type: string;
  speaker_type: string;
  text: string;
  emotion: string;
  pace: number;
  visual_note: string;
  source_span: { start_char: number; end_char: number; quote: string };
  importance: number;
  flags: { spoiler?: boolean; low_confidence?: boolean } | null;
  estimated_duration_sec: number;
}

interface ChapterRow {
  id: string;
  idx: number;
  title: string | null;
  char_count: number;
  status: string;
}

interface AdaptedSummary {
  id: string;
  source_chapter_id: string;
  title: string | null;
  status: string;
}

interface ChapterRowData {
  id: string;
  title: string;
  hook: string;
  status: string;
  basis?: string | null;
  target_duration_sec: number;
  estimated_duration_sec: number;
  selection_report: {
    kept?: Array<{ span?: string; reason?: string }>;
    cut?: Array<{ summary: string; reason?: string }>;
    compressed?: Array<{ span?: string; from?: string; to?: string }>;
    clue_safety_notes?: string[];
  } | null;
}

interface ScriptData {
  chapter: ChapterRowData | null;
  beats: BeatRow[];
}

interface ReviewItem {
  severity: "red" | "yellow";
  beat_idx: number;
  kind: string;
  issue: string;
  suggestion: string;
}

type BeatEdit = { text: string; emotion: string; pace: number; visual_note: string };

export default function ScriptPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const searchParams = useSearchParams();
  const queryChapterId = searchParams.get("chapter");
  const toast = useToast();

  const [data, setData] = useState<ScriptData>({ chapter: null, beats: [] });
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [adaptedList, setAdaptedList] = useState<AdaptedSummary[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [adaptBlockers, setAdaptBlockers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, BeatEdit>>({});
  // 每个章节独立记住最近一次 jobId：切换章节后仍能接回该章进度，互不锁定
  const [jobIds, setJobIds] = useState<Record<string, string>>({});
  // 可能有多个章节的 adapt 任务同时完成，逐个进入审阅
  const [stagedJobIds, setStagedJobIds] = useState<string[]>([]);
  const [showPlan, setShowPlan] = useState(false);

  const addStagedJobId = useCallback((jobId: string) => {
    setStagedJobIds((prev) => (prev.includes(jobId) ? prev : [...prev, jobId]));
  }, []);

  // 建议 chips → 预演卡 → 入队（docs/06 P3：预报→diff→撤销链路）
  async function startAdaptJob() {
    if (!selectedChapterId) return;
    setShowPlan(false);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: "adapt", input: { chapterId: selectedChapterId } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "入队失败");
      const nextJobId = json.jobId as string;
      setJobIds((prev) => ({ ...prev, [selectedChapterId]: nextJobId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // 挂载时接回未完成的审阅（刷新页面后恢复）
  useEffect(() => {
    fetch(`/api/books/${bookId}/staged`)
      .then((r) => r.json())
      .then((json) => {
        const adaptGroups = (json.groups ?? []).filter(
          (x: { node: string; jobId: string | null }) => x.node === "adapt" && x.jobId,
        );
        setStagedJobIds((prev) => {
          const next = new Set(prev);
          for (const g of adaptGroups) next.add(g.jobId as string);
          return [...next];
        });
      })
      .catch(() => undefined);
  }, [bookId]);

  const load = useCallback(
    async (chapterId?: string) => {
      try {
        const query = chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : "";
        const res = await fetch(`/api/books/${bookId}/script${query}`);
        const json = await res.json();
        if (json.error) {
          setError(json.error);
          return;
        }
        setChapters(json.chapters ?? []);
        setAdaptedList(json.adaptedList ?? []);
        setData({ chapter: json.chapter ?? null, beats: json.beats ?? [] });
        setReview(json.review ?? []);
        setAdaptBlockers(json.adaptBlockers ?? []);
        const next: Record<string, BeatEdit> = {};
        for (const b of (json.beats ?? []) as BeatRow[]) {
          next[b.id] = { text: b.text, emotion: b.emotion, pace: b.pace, visual_note: b.visual_note };
        }
        setEdits(next);
        if (chapterId) {
          setSelectedChapterId(chapterId);
        } else {
          const chaptersArr = (json.chapters ?? []) as ChapterRow[];
          const firstId = chaptersArr[0]?.id ?? null;
          const preferred =
            queryChapterId && chaptersArr.some((c) => c.id === queryChapterId)
              ? queryChapterId
              : firstId;
          setSelectedChapterId(preferred);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [bookId, queryChapterId],
  );

  useEffect(() => {
    // 挂载后拉取脚本；setState 均发生在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(queryChapterId ?? undefined);
  }, [load, queryChapterId]);

  async function saveBeat(beatId: string) {
    const edit = edits[beatId];
    if (!edit) return;
    setSaving(beatId);
    try {
      const res = await fetch(`/api/books/${bookId}/beats/${beatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "保存失败");
        return;
      }
      await load(selectedChapterId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  // 证据定位（docs/06 §6.3 EvidenceDisclosure）：AI 结论 → 滚动到对应 beat 并闪烁
  const jumpToBeat = useCallback((beatIdx: number) => {
    const el = document.getElementById(`beat-card-${beatIdx}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("stale-flash");
    // 强制重排后重新加类，保证闪烁动画重新触发
    void el.offsetWidth;
    el.classList.add("stale-flash");
    window.setTimeout(() => el.classList.remove("stale-flash"), 1200);
  }, []);

  async function approveChapter() {
    if (!data.chapter) return;
    try {
      const res = await fetch(`/api/books/${bookId}/script/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adaptedChapterId: data.chapter.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "批准失败");
        return;
      }
      await load(selectedChapterId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function setEdit(beatId: string, patch: Partial<BeatEdit>) {
    setEdits((prev) => ({ ...prev, [beatId]: { ...prev[beatId], ...patch } }));
  }

  const selectedChapter = chapters.find((c) => c.id === selectedChapterId) ?? null;
  const selectedAdapted = selectedChapter
    ? adaptedList.find((a) => a.source_chapter_id === selectedChapter.id) ?? null
    : null;
  const selectedChapterLabel = selectedChapter
    ? `第 ${selectedChapter.idx} 章${selectedChapter.title ? ` · ${selectedChapter.title}` : ""}`
    : "尚未选择章节";

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="改编脚本审校台"
        meta="签核点 B"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
      />

      {Object.values(jobIds).map((jobId) => (
        <StagedJobBridge
          key={jobId}
          bookId={bookId}
          jobId={jobId}
          onSucceeded={addStagedJobId}
        />
      ))}

      {stagedJobIds.map((jobId) => (
        <StagedReviewPanel
          key={jobId}
          bookId={bookId}
          jobId={jobId}
          nodeLabel="改编脚本审阅"
          onApplied={(result) => {
            toast.push("success", `已应用 ${result.applied} 处变更（驳回 ${result.rejected}）`, undefined);
            setStagedJobIds((prev) => prev.filter((id) => id !== jobId));
            setJobIds((prev) => {
              const next = { ...prev };
              for (const [chapterId, id] of Object.entries(next)) {
                if (id === jobId) delete next[chapterId];
              }
              return next;
            });
            void load(selectedChapterId ?? undefined);
          }}
          onDiscarded={() => {
            toast.push("info", "已放弃本次改编，数据未改动", undefined);
            setStagedJobIds((prev) => prev.filter((id) => id !== jobId));
            setJobIds((prev) => {
              const next = { ...prev };
              for (const [chapterId, id] of Object.entries(next)) {
                if (id === jobId) delete next[chapterId];
              }
              return next;
            });
            void load(selectedChapterId ?? undefined);
          }}
        />
      ))}

      <ErrorBanner message={error} />

      {chapters.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="font-semibold">章节改编</h2>
            <p className="mt-1 text-sm text-text-muted">
              这里按“单章”执行改编：选择一章，生成该章的 beats 脚本并进入逐条审阅。不同章节可并行发起，互不锁定；下方脚本内容会随章节切换。
            </p>
          </div>

          <Card className={selectedAdapted ? "" : "border-dashed"}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">当前改编对象</h3>
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
              {selectedAdapted && (
                <span className="rounded-full bg-approved/10 px-2.5 py-1 text-caption text-approved">
                  ✓ 已改编
                </span>
              )}
            </div>

            <p className="mt-2 text-sm text-text-muted">
              {selectedAdapted
                ? "已生成改编脚本，可在下方审阅、修改并批准。"
                : selectedChapter
                  ? "本章尚未改编，点击下方按钮生成脚本并进入审阅。"
                  : "请先在列表中选择一章。"}
            </p>

            {selectedChapter && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <JobRunner
                  key={selectedChapter.id}
                  bookId={bookId}
                  node="adapt"
                  label={selectedAdapted ? `重新改编「${selectedChapterLabel}」` : `改编「${selectedChapterLabel}」`}
                  input={{ chapterId: selectedChapter.id }}
                  initialJobId={jobIds[selectedChapter.id] ?? null}
                  disabled={adaptBlockers.length > 0}
                  onStart={(jobId) =>
                    setJobIds((prev) => ({ ...prev, [selectedChapter.id]: jobId }))
                  }
                  onDone={(jobId) => {
                    toast.push("info", "改编完成，进入逐条审阅（应用前不覆盖任何数据）", undefined);
                    addStagedJobId(jobId);
                  }}
                />
                {adaptBlockers.length > 0 && (
                  <span className="text-xs text-stale" role="alert">
                    前置未满足：{adaptBlockers.join("；")}
                  </span>
                )}
                {data.chapter && data.chapter.status !== "approved" && (
                  <Button variant="approve" onClick={approveChapter}>
                    批准本章
                  </Button>
                )}
              </div>
            )}
          </Card>
        </section>
      )}

      {data.chapter && (
        <Card className="text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{data.chapter.title}</h2>
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              {data.chapter.estimated_duration_sec.toFixed(0)}s / 预算 {data.chapter.target_duration_sec}s
              <span className="rounded bg-surface-2 px-1.5 py-0.5">
                {data.chapter.basis === "condensed" ? "输入：精简底稿" : "输入：原文"}
              </span>
              <StatusPill table="adapted_chapters" status={data.chapter.status} />
              <ImpactPill bookId={bookId} table="adapted_chapters" rowId={data.chapter.id} status={data.chapter.status} />
            </span>
          </div>
          <p className="mt-2 text-text-muted">{data.chapter.hook}</p>
          {data.chapter.selection_report?.cut && data.chapter.selection_report.cut.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-regen">
                取舍报告：删除 {data.chapter.selection_report.cut.length} 处（点击展开）
              </summary>
              <ul className="mt-2 space-y-1 pl-5 text-xs text-text-muted">
                {data.chapter.selection_report.cut.map((c, i) => (
                  <li key={i}>
                    {c.summary} —— {c.reason || "节奏考虑"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}

      {review.length > 0 && (
        <Card className="border-stale/40 bg-stale/10 text-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-stale">
              AI 自检发现 {review.length} 个问题（点击定位到对应 beat）
            </h2>
            <Button size="sm" variant="secondary" onClick={() => setShowPlan((s) => !s)}>
              💡 一键重跑修复
            </Button>
          </div>
          {showPlan && (
            <PlanSheet
              className="mt-3"
              bookId={bookId}
              node="adapt"
              busy={false}
              onExecute={() => void startAdaptJob()}
              onCancel={() => setShowPlan(false)}
            />
          )}
          <ul className="mt-2 space-y-1">
            {review.map((item, i) =>
              item.kind === "adapt_validation" ? (
                // 改编校验失败诊断（无 beat 可定位，只读展示）
                <li key={i} className="text-stale">
                  <span className="mr-2 rounded bg-surface px-1.5 py-0.5 text-xs">失败</span>
                  【改编校验失败】{item.issue}
                  {item.suggestion ? `（建议：${item.suggestion}）` : ""}
                </li>
              ) : (
                <li key={i} className={item.severity === "red" ? "text-stale" : "text-regen"}>
                  <button
                    type="button"
                    onClick={() => jumpToBeat(item.beat_idx)}
                    className="text-left underline decoration-dotted underline-offset-2 hover:bg-surface/60"
                  >
                    <span className="mr-2 rounded bg-surface px-1.5 py-0.5 text-xs">
                      {item.severity === "red" ? "红" : "黄"}
                    </span>
                    beat#{item.beat_idx} · {item.kind}：{item.issue}
                    {item.suggestion ? `（建议：${item.suggestion}）` : ""}
                  </button>
                </li>
              ),
            )}
          </ul>
        </Card>
      )}

      <section className="space-y-3">
        {data.beats.length === 0 && (
          <EmptyState description="还没有脚本。先在“章节改编”区选择一章并运行改编。" />
        )}
        {data.beats.map((beat) => {
          const edit = edits[beat.id];
          if (!edit) return null;
          const red = review.some((r) => r.beat_idx === beat.idx && r.severity === "red");
          const yellow = review.some((r) => r.beat_idx === beat.idx && r.severity === "yellow");
          const toneClass = red
            ? "border-l-4 border-l-stale border-stale/40 bg-stale/10"
            : yellow
              ? "border-l-4 border-l-regen border-regen/40 bg-regen/10"
              : "";
          return (
            <Card
              key={beat.id}
              id={`beat-card-${beat.idx}`}
              className={`text-sm ${toneClass}`}
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold">
                  #{beat.idx} <span className="text-xs text-text-muted">{beat.type}</span>
                  {beat.speaker_type === "character" && (
                    <span className="ml-2 rounded bg-character/10 px-1.5 py-0.5 text-xs text-character">角色</span>
                  )}
                  {beat.flags?.spoiler && (
                    <span className="ml-2 rounded bg-spoiler/10 px-1.5 py-0.5 text-xs text-spoiler">剧透标记</span>
                  )}
                </p>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span>{beat.estimated_duration_sec.toFixed(1)}s</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => saveBeat(beat.id)}
                    disabled={saving === beat.id}
                    loading={saving === beat.id}
                  >
                    保存修改
                  </Button>
                </div>
              </div>

              <Textarea
                aria-label="台词"
                value={edit.text}
                onChange={(e) => setEdit(beat.id, { text: e.target.value })}
                rows={2}
                className="mt-2"
              />
              <Input
                aria-label="画面说明"
                value={edit.visual_note ?? ""}
                onChange={(e) => setEdit(beat.id, { visual_note: e.target.value })}
                className="mt-2"
                placeholder="画面：背景 + 人物 + 动作 + 表情"
              />
              <div className="mt-2 flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  情绪
                  <Select
                    aria-label="情绪"
                    value={edit.emotion}
                    onChange={(e) => setEdit(beat.id, { emotion: e.target.value })}
                    className="w-32"
                  >
                    {EMOTIONS.map((em) => (
                      <option key={em} value={em}>{em}</option>
                    ))}
                  </Select>
                </label>
                <label className="flex items-center gap-1">
                  语速 {edit.pace.toFixed(2)}
                  <input
                    type="range"
                    min={0.8}
                    max={1.3}
                    step={0.05}
                    value={edit.pace}
                    onChange={(e) => setEdit(beat.id, { pace: Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className="mt-2 truncate text-xs text-text-subtle" title={beat.source_span.quote}>
                {data.chapter?.basis === "condensed" ? "精简底稿出处" : "原文出处"}：
                {beat.source_span.start_char}–{beat.source_span.end_char} “{beat.source_span.quote}”
              </p>
            </Card>
          );
        })}
      </section>

      <ShortcutHelp
        items={[
          { keys: "j / k", label: "审阅列表上下移动" },
          { keys: "a", label: "接受当前变更" },
          { keys: "r", label: "驳回当前变更" },
          { keys: "u", label: "撤销上一条决策" },
          { keys: "Enter", label: "应用已选决策" },
          { keys: "?", label: "打开/关闭快捷键帮助" },
        ]}
      />
    </PageShell>
  );
}

/** 后台监听某个 adapt job：成功后把 jobId 送入待审列表（支持跨章节并行完成） */
function StagedJobBridge({
  bookId,
  jobId,
  onSucceeded,
}: {
  bookId: string;
  jobId: string;
  onSucceeded: (jobId: string) => void;
}) {
  const job = useJob(bookId, jobId);
  useEffect(() => {
    if (job.status === "succeeded") onSucceeded(jobId);
  }, [job.status, jobId, onSucceeded]);
  return null;
}
