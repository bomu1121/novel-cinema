"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { StatusPill } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { JobRunner } from "@/components/jobs/job-runner";
import { useToast } from "@/components/toast";

interface SourceChapter {
  id: string;
  idx: number;
  title: string | null;
  cleaned_text: string;
  char_count: number;
}

interface ChapterRow {
  id: string;
  idx: number;
  title: string | null;
  char_count: number;
  status: string;
}

interface CondensedSummary {
  id: string;
  source_chapter_id: string;
  status: string;
  title: string | null;
  updated_at: string | null;
}

interface CondensedRow {
  id: string;
  title: string;
  hook: string;
  condensed_text: string;
  source_chars: number;
  target_chars: number;
  ratio: number;
  status: string;
  hand_edited: number;
  report?: {
    kept?: Array<{ quote?: string; reason?: string }>;
    cut?: Array<{ summary: string; reason?: string }>;
    compressed?: Array<{ from?: string; to?: string; reason?: string }>;
    clue_safety_notes?: string[];
    risks?: Array<{ severity: "red" | "yellow"; text: string }>;
  } | null;
}

export default function CondensePage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const searchParams = useSearchParams();
  const queryChapterId = searchParams.get("chapter");
  const toast = useToast();

  const [source, setSource] = useState<SourceChapter | null>(null);
  const [condensed, setCondensed] = useState<CondensedRow | null>(null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [condensedList, setCondensedList] = useState<CondensedSummary[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 每个章节独立记住最近一次 jobId：切换章节后仍能接回该章进度，互不锁定
  const [jobIds, setJobIds] = useState<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 精简结果框随内容自动增高，避免出现“页面滚动 + textarea 内滚”双滚动条
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draftText, condensed]);

  const load = useCallback(
    async (chapterId?: string) => {
      try {
        const query = chapterId ? `?chapterId=${encodeURIComponent(chapterId)}` : "";
        const res = await fetch(`/api/books/${bookId}/condense${query}`);
        const json = await res.json();
        if (json.error) {
          setError(json.error);
          return;
        }
        setChapters(json.chapters ?? []);
        setCondensedList(json.condensedList ?? []);
        setSource(json.source ?? null);
        setCondensed(json.condensed ?? null);
        setDraftText(json.condensed?.condensed_text ?? "");
        if (chapterId) {
          setSelectedChapterId(chapterId);
        } else {
          const chaptersArr = (json.chapters ?? []) as ChapterRow[];
          const firstId = json.source?.id ?? chaptersArr[0]?.id ?? null;
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
    // 挂载后拉取精简稿；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(queryChapterId ?? undefined);
  }, [load, queryChapterId]);

  async function save() {
    if (!condensed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/books/${bookId}/condense`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draftText, chapterId: selectedChapterId ?? undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "保存失败");
        return;
      }
      toast.push("success", "精简稿已保存，下游脚本已标记为过期", undefined);
      await load(selectedChapterId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!condensed) return;
    try {
      const res = await fetch(`/api/books/${bookId}/condense/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: condensed.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "批准失败");
        return;
      }
      toast.push("success", "精简稿已批准，之后的章节改编会优先使用它", undefined);
      await load(selectedChapterId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const condensedChars = draftText.replace(/\s/g, "").length;
  const sourceChars = source?.char_count ?? 0;
  const ratio = sourceChars > 0 ? Math.round((condensedChars / sourceChars) * 100) : 0;

  const selectedChapter = chapters.find((c) => c.id === selectedChapterId) ?? null;
  const selectedCondensedSummary = condensedList.find((c) => c.source_chapter_id === selectedChapterId) ?? null;
  const selectedChapterLabel = selectedChapter
    ? `第 ${selectedChapter.idx} 章${selectedChapter.title ? ` · ${selectedChapter.title}` : ""}`
    : "尚未选择章节";

  return (
    <PageShell size="full" className="space-y-6">
      <PageHeader
        title="精简底稿对照"
        meta="视频向精简 · 签核 B0"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
      />

      <ErrorBanner message={error} />

      {chapters.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="font-semibold">章节精简</h2>
            <p className="mt-1 text-sm text-text-muted">
              这里按“单章”执行精简：选择一章，生成该章的视频向精简底稿。不同章节可并行发起，互不锁定；下方原文 / 精简稿会随章节切换。
            </p>
          </div>

          <Card className={selectedCondensedSummary ? "" : "border-dashed"}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">当前精简对象</h3>
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
              {selectedCondensedSummary && (
                <span className="rounded-full bg-approved/10 px-2.5 py-1 text-caption text-approved">
                  ✓ 已精简
                </span>
              )}
            </div>

            <p className="mt-2 text-sm text-text-muted">
              {selectedCondensedSummary
                ? "已生成精简稿，可在下方对照原文检查、手动修改并批准。"
                : selectedChapter
                  ? "本章尚未精简，点击下方按钮生成精简稿。"
                  : "请先在列表中选择一章。"}
            </p>

            {selectedChapter && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <JobRunner
                  key={selectedChapter.id}
                  bookId={bookId}
                  node="condense"
                  label={
                    selectedCondensedSummary
                      ? `重新精简「${selectedChapterLabel}」`
                      : `精简「${selectedChapterLabel}」`
                  }
                  input={{ chapterId: selectedChapter.id }}
                  initialJobId={jobIds[selectedChapter.id] ?? null}
                  onStart={(jobId) =>
                    setJobIds((prev) => ({ ...prev, [selectedChapter.id]: jobId }))
                  }
                  onDone={() => {
                    toast.push("info", "精简完成，请在下方检查并手动修正", undefined);
                    void load(selectedChapter.id);
                  }}
                  onSettled={(status, message) => {
                    if (message) setError(message);
                    if (status === "cancelled") void load(selectedChapter.id);
                  }}
                />
                {condensed && condensed.status !== "approved" && (
                  <Button variant="approve" onClick={approve}>
                    批准底稿
                  </Button>
                )}
              </div>
            )}
          </Card>
        </section>
      )}

      {!source ? (
        <EmptyState description="还没有可精简的章节。请先在首页上传一章 txt。" />
      ) : (
        <>
          <div className="grid items-stretch gap-6 lg:grid-cols-2">
            <Card className="flex flex-col text-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-title font-semibold">原文（只读）</h2>
                <span className="text-caption text-text-muted">
                  第 {source.idx} 章 · {source.char_count.toLocaleString()} 字
                </span>
              </div>
              <div className="mt-4 min-h-[60vh] flex-1 whitespace-pre-wrap rounded-xl border border-border bg-surface-2 p-6 text-lead leading-7 text-text-muted">
                {source.cleaned_text}
              </div>
            </Card>

            <Card className="flex flex-col text-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-title font-semibold">
                  精简底稿{condensed?.hand_edited ? " · 已手动修改" : ""}
                </h2>
                {condensed && <StatusPill table="condensed_chapters" status={condensed.status} />}
              </div>
              {condensed ? (
                <>
                  <p className="mt-2 text-caption text-text-muted">
                    {condensedChars.toLocaleString()} 字 / 目标 {condensed.target_chars.toLocaleString()} 字 ·
                    压缩率 {ratio}%
                    {condensed.status === "approved" ? " · 已批准，章节改编将优先使用此底稿" : ""}
                  </p>
                  <Textarea
                    ref={textareaRef}
                    aria-label="精简底稿"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={1}
                    className="mt-4 min-h-[60vh] flex-1 resize-none overflow-hidden text-lead leading-7"
                  />
                  <div className="mt-4 flex justify-end">
                    <Button onClick={save} disabled={saving} loading={saving}>
                      保存修改
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-body text-text-muted">
                  还没有精简稿。在上方选择章节并运行精简后，这里会显示精简底稿。
                </p>
              )}
            </Card>
          </div>

          {condensed?.report && (
            <Card className="text-sm">
              <h2 className="font-display text-title font-semibold">AI 取舍报告（为什么删）</h2>
              {condensed.report.cut && condensed.report.cut.length > 0 && (
                <details className="mt-3" open>
                  <summary className="cursor-pointer text-body font-medium">
                    删除 {condensed.report.cut.length} 处
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-text-muted">
                    {condensed.report.cut.map((c, i) => (
                      <li key={i}>
                        {c.summary}
                        {c.reason ? ` —— ${c.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {condensed.report.compressed && condensed.report.compressed.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-body font-medium">
                    压缩 {condensed.report.compressed.length} 处
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-text-muted">
                    {condensed.report.compressed.map((c, i) => (
                      <li key={i}>
                        {c.from ? `${c.from} → ` : ""}
                        {c.to}
                        {c.reason ? ` —— ${c.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {condensed.report.clue_safety_notes && condensed.report.clue_safety_notes.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-body font-medium text-regen">
                    线索安全提示 {condensed.report.clue_safety_notes.length} 条
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-text-muted">
                    {condensed.report.clue_safety_notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </details>
              )}
              {condensed.report.risks && condensed.report.risks.length > 0 && (
                <ul className="mt-3 space-y-1 text-caption">
                  {condensed.report.risks.map((risk, i) => (
                    <li key={i} className={risk.severity === "red" ? "text-stale" : "text-regen"}>
                      {risk.severity === "red" ? "红" : "黄"}：{risk.text}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
