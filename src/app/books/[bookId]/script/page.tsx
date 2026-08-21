"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { JobRunner } from "@/components/jobs/job-runner";
import { StagedReviewPanel } from "@/components/jobs/staged-review-panel";
import { PlanSheet } from "@/components/jobs/plan-sheet";
import { useToast } from "@/components/toast";
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
  title: string;
  hook: string;
  status: string;
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
  chapter: ChapterRow | null;
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
  const toast = useToast();

  const [data, setData] = useState<ScriptData>({ chapter: null, beats: [] });
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, BeatEdit>>({});
  const [stagedJobId, setStagedJobId] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);

  // 建议 chips → 预演卡 → 入队（docs/06 P3：预报→diff→撤销链路）
  async function startAdaptJob() {
    setShowPlan(false);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: "adapt" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "入队失败");
      setStagedJobId(json.jobId as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // 挂载时接回未完成的审阅（刷新页面后恢复）
  useEffect(() => {
    fetch(`/api/books/${bookId}/staged`)
      .then((r) => r.json())
      .then((json) => {
        const g = (json.groups ?? []).find((x: { node: string }) => x.node === "adapt");
        if (g?.jobId) setStagedJobId(g.jobId);
      })
      .catch(() => undefined);
  }, [bookId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/script`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
      setReview(json.review ?? []);
      const next: Record<string, BeatEdit> = {};
      for (const b of (json.beats ?? []) as BeatRow[]) {
        next[b.id] = { text: b.text, emotion: b.emotion, pace: b.pace, visual_note: b.visual_note };
      }
      setEdits(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载后拉取脚本；setState 均发生在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
      await load();
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function setEdit(beatId: string, patch: Partial<BeatEdit>) {
    setEdits((prev) => ({ ...prev, [beatId]: { ...prev[beatId], ...patch } }));
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <header className="flex items-start justify-between">
        <div>
          <Link href={`/books/${bookId}`} className="text-sm text-zinc-500 hover:text-zinc-900">
            ← 返回章节
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            改编脚本审校台 <span className="text-sm font-normal text-zinc-400">签核点 B</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <JobRunner
            bookId={bookId}
            node="adapt"
            label="运行章节改编"
            onDone={(jobId) => {
              toast.push("info", "改编完成，进入逐条审阅（应用前不覆盖任何数据）", undefined);
              setStagedJobId(jobId);
            }}
          />
          {data.chapter && data.chapter.status !== "approved" && (
            <Button variant="approve" onClick={approveChapter}>
              批准本章
            </Button>
          )}
        </div>
      </header>

      {stagedJobId && (
        <StagedReviewPanel
          bookId={bookId}
          jobId={stagedJobId}
          nodeLabel="改编脚本审阅"
          onApplied={(result) => {
            toast.push("success", `已应用 ${result.applied} 处变更（驳回 ${result.rejected}）`, undefined);
            setStagedJobId(null);
            void load();
          }}
          onDiscarded={() => {
            toast.push("info", "已放弃本次改编，数据未改动", undefined);
            setStagedJobId(null);
            void load();
          }}
        />
      )}

      <ErrorBanner message={error} />

      {data.chapter && (
        <section className="rounded-xl border border-zinc-200 p-5 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{data.chapter.title}</h2>
            <span className="text-xs text-zinc-500">
              {data.chapter.estimated_duration_sec.toFixed(0)}s / 预算 {data.chapter.target_duration_sec}s ·{" "}
              <StatusPill table="adapted_chapters" status={data.chapter.status} />
            </span>
          </div>
          <p className="mt-2 text-zinc-600">{data.chapter.hook}</p>
          {data.chapter.selection_report?.cut && data.chapter.selection_report.cut.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-regen">
                取舍报告：删除 {data.chapter.selection_report.cut.length} 处（点击展开）
              </summary>
              <ul className="mt-2 space-y-1 pl-5 text-xs text-zinc-600">
                {data.chapter.selection_report.cut.map((c, i) => (
                  <li key={i}>
                    {c.summary} —— {c.reason || "节奏考虑"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {review.length > 0 && (
        <section className="rounded-xl border border-stale/40 bg-stale/10 p-5 text-sm">
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
              busy={stagedJobId !== null}
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
        </section>
      )}

      <section className="space-y-3">
        {data.beats.length === 0 && (
          <p className="text-sm text-zinc-400">
            还没有脚本。先在“全书档案”页跑一次分析（人物/线索/风格），再回来点“运行章节改编”。
          </p>
        )}
        {data.beats.map((beat) => {
          const edit = edits[beat.id];
          if (!edit) return null;
          const red = review.some((r) => r.beat_idx === beat.idx && r.severity === "red");
          return (
            <div
              key={beat.id}
              id={`beat-card-${beat.idx}`}
              className={`rounded-xl border p-4 text-sm ${
                red ? "border-stale/40 bg-stale/10" : "border-zinc-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold">
                  #{beat.idx} <span className="text-xs text-zinc-500">{beat.type}</span>
                  {beat.speaker_type === "character" && (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">角色</span>
                  )}
                  {beat.flags?.spoiler && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600">剧透标记</span>
                  )}
                </p>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
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

              <textarea
                value={edit.text}
                onChange={(e) => setEdit(beat.id, { text: e.target.value })}
                rows={2}
                className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
              <input
                value={edit.visual_note}
                onChange={(e) => setEdit(beat.id, { visual_note: e.target.value })}
                className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600"
                placeholder="画面：背景 + 人物 + 动作 + 表情"
              />
              <div className="mt-2 flex gap-3 text-xs">
                <label className="flex items-center gap-1">
                  情绪
                  <select
                    value={edit.emotion}
                    onChange={(e) => setEdit(beat.id, { emotion: e.target.value })}
                    className="rounded border border-zinc-300 px-2 py-1"
                  >
                    {EMOTIONS.map((em) => (
                      <option key={em} value={em}>{em}</option>
                    ))}
                  </select>
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
              <p className="mt-2 truncate text-xs text-zinc-400" title={beat.source_span.quote}>
                原文出处：{beat.source_span.start_char}–{beat.source_span.end_char} “{beat.source_span.quote}”
              </p>
            </div>
          );
        })}
      </section>
    </main>
  );
}
