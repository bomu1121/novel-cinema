"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
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
  rationale?: string;
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

interface HistoryBatch {
  id: string;
  version: number;
  proposal_json: StyleProposal[];
  approved_index: number | null;
  note: string | null;
  created_at: string;
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
    visual_style?: string;
    art_direction?: string | null;
    color_palette?: string[];
    camera_grammar?: Record<string, string>;
    narration_tone?: string | null;
    spoiler_rules?: { rules?: string[] } | string[] | null;
    negative_prompt?: { text?: string } | string | null;
    proposal_json: StyleProposal[];
    approved_proposal_index: number | null;
    approved_at: string | null;
    manual_override?: number | boolean;
  } | null;
  bibleHistory?: HistoryBatch[];
}

/** 展平字段可能是 v1 遗留的 {rules:[]}/{text:} 包装，也可能是裸数组/字符串，统一解包 */
function unwrapList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v && typeof v === "object" && Array.isArray((v as { rules?: unknown }).rules)) {
    return ((v as { rules: unknown[] }).rules).map(String);
  }
  return [];
}

function unwrapText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string") {
    return (v as { text: string }).text;
  }
  return "";
}

function CameraGrammar({ grammar }: { grammar: Record<string, string> }) {
  const rows: Array<[string, string]> = [
    ["对话", grammar.dialogue ?? ""],
    ["旁白", grammar.narration ?? ""],
    ["转场", grammar.transition ?? ""],
  ].filter(([, v]) => v) as Array<[string, string]>;
  if (rows.length === 0) return null;
  return (
    <dl className="mt-2 space-y-0.5 text-xs text-text-muted">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-8 shrink-0 text-text-subtle">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProposalCard({
  proposal,
  index,
  recommended,
  approved,
  approveLabel,
  onApprove,
  approving,
}: {
  proposal: StyleProposal;
  index: number;
  recommended: boolean;
  approved: boolean;
  approveLabel: string;
  onApprove: () => void;
  approving: boolean;
}) {
  return (
    <Card
      className={`text-sm ${approved ? "border-approved/40 bg-approved/10" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">
          方案 {index + 1}
          {recommended && (
            <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
              ★ 推荐
            </span>
          )}
        </h4>
        {approved ? (
          <StatusPill table="style_bibles" status="approved" />
        ) : (
          <Button
            size="sm"
            variant="approve"
            onClick={onApprove}
            disabled={approving}
            loading={approving}
          >
            {approveLabel}
          </Button>
        )}
      </div>
      {proposal.rationale && (
        <p className="mt-2 rounded bg-surface-2 px-2 py-1.5 text-xs text-text-muted">
          为什么推荐：{proposal.rationale}
        </p>
      )}
      <p className="mt-3 font-mono text-xs leading-5 text-text">{proposal.visual_style}</p>
      {proposal.art_direction && <p className="mt-2 text-text-muted">{proposal.art_direction}</p>}
      {proposal.color_palette.length > 0 && (
        <p className="mt-2 flex items-center gap-2">
          {proposal.color_palette.map((color) => (
            <span
              key={color}
              className="inline-block h-5 w-5 rounded border border-border-strong"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </p>
      )}
      {proposal.narration_tone && (
        <p className="mt-2 text-xs text-text-muted">旁白基调：{proposal.narration_tone}</p>
      )}
      <CameraGrammar grammar={proposal.camera_grammar ?? {}} />
      {unwrapList(proposal.spoiler_rules).length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-clue">
          {unwrapList(proposal.spoiler_rules).map((rule, j) => (
            <li key={j}>{rule}</li>
          ))}
        </ul>
      )}
      {proposal.negative_prompt && (
        <details className="mt-2 text-xs text-text-subtle">
          <summary className="cursor-pointer">负面词</summary>
          <p className="mt-1 font-mono text-text-muted">{proposal.negative_prompt}</p>
        </details>
      )}
    </Card>
  );
}

function HistorySection({
  history,
  restoring,
  onRestore,
}: {
  history: HistoryBatch[];
  restoring: boolean;
  onRestore: (proposalId: string) => void;
}) {
  if (history.length === 0) return null;
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h4 className="text-sm font-semibold">候选批次历史（可回看 / 恢复）</h4>
      <p className="text-xs text-text-muted">
        每次重新生成/恢复都会把旧批次归档到这里；恢复会把该批次立为当前候选（回到待审）。
      </p>
      <div className="space-y-2">
        {history.map((batch) => (
          <Card key={batch.id} className="px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">批次 v{batch.version}</span>
                <span className="text-text-subtle">{new Date(batch.created_at).toLocaleString()}</span>
                {batch.note && <span className="text-text-subtle">· {batch.note}</span>}
                {batch.approved_index !== null && batch.approved_index !== undefined && (
                  <span className="rounded-full bg-approved/10 px-2 py-0.5 text-approved">
                    当时批准 #{(batch.approved_index ?? 0) + 1}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRestore(batch.id)}
                disabled={restoring}
                loading={restoring}
              >
                恢复为当前候选
              </Button>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-text-subtle">
                查看 {batch.proposal_json.length} 套方案
              </summary>
              <div className="mt-2 grid gap-2 lg:grid-cols-3">
                {batch.proposal_json.map((p, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface-2 p-2">
                    <p className="font-medium">#{i + 1}</p>
                    <p className="mt-1 font-mono leading-4 text-text">{p.visual_style}</p>
                    {p.narration_tone && <p className="mt-1 text-text-subtle">基调：{p.narration_tone}</p>}
                  </div>
                ))}
              </div>
            </details>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function BiblePage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const searchParams = useSearchParams();
  const queryChapterId = searchParams.get("chapter");

  const [data, setData] = useState<BibleData>({});
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [restoring, setRestoring] = useState(false);
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

  async function restore(proposalId: string) {
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/bible/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "恢复失败");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
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

  const styleBible = data.styleBible ?? null;
  const locked = styleBible?.status === "approved";
  const candidates = styleBible?.proposal_json ?? [];
  const hasSummaries = (data.summaries?.length ?? 0) > 0;
  const manualOverride = Boolean(styleBible?.manual_override);

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
            以下内容由已分析章节合并 / 最近一次生成，属于整本书，不随上方章节切换变化。
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

        {/* 风格圣经候选（v2，docs/14） */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">风格圣经候选（AI 提案，选定后锁定）</h3>
              <p className="mt-1 text-xs text-text-muted">
                书级共享；候选生成基于全书摘要与档案（不再随章节分析刷新）。重新生成会归档旧批次，历史可回看/恢复。
              </p>
            </div>
            {styleBible && (
              <StatusPill table="style_bibles" status={styleBible.status} />
            )}
          </div>

          {!styleBible && (
            <Card className="border-dashed">
              <EmptyState description="还没有风格候选。先在上方“章节分析”区分析至少一章，然后生成候选。" />
              <div className="px-6 pb-6">
                <JobRunner
                  bookId={bookId}
                  node="bible.propose"
                  label={hasSummaries ? "生成风格候选（AI 提案）" : "生成风格候选（需先分析章节）"}
                  disabled={!hasSummaries}
                  onDone={() => void load()}
                  onSettled={(status, message) => {
                    if (status === "failed" && message) setError(message);
                  }}
                />
              </div>
            </Card>
          )}

          {styleBible && locked && (
            <Card className="border-approved/40 bg-approved/10 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold">
                  当前锁定方案
                  {manualOverride && (
                    <span className="ml-2 rounded-full bg-regen/15 px-2 py-0.5 text-xs text-regen">
                      手工修订（工作台改过）
                    </span>
                  )}
                </h4>
                <span className="text-xs text-text-subtle">
                  版本 v{styleBible.version}
                  {styleBible.approved_at
                    ? ` · 锁定于 ${new Date(styleBible.approved_at).toLocaleString()}`
                    : ""}
                </span>
              </div>
              <p className="mt-3 font-mono text-xs leading-5 text-text">
                {styleBible.visual_style ?? ""}
              </p>
              {styleBible.art_direction && (
                <p className="mt-2 text-text-muted">{styleBible.art_direction}</p>
              )}
              {(styleBible.color_palette ?? []).length > 0 && (
                <p className="mt-2 flex items-center gap-2">
                  {(styleBible.color_palette ?? []).map((color) => (
                    <span
                      key={color}
                      className="inline-block h-5 w-5 rounded border border-border-strong"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </p>
              )}
              {styleBible.narration_tone && (
                <p className="mt-2 text-xs text-text-muted">旁白基调：{styleBible.narration_tone}</p>
              )}
              <CameraGrammar grammar={styleBible.camera_grammar ?? {}} />
              {unwrapList(styleBible.spoiler_rules).length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-clue">
                  {unwrapList(styleBible.spoiler_rules).map((rule, j) => (
                    <li key={j}>{rule}</li>
                  ))}
                </ul>
              )}
              {unwrapText(styleBible.negative_prompt) && (
                <details className="mt-2 text-xs text-text-subtle">
                  <summary className="cursor-pointer">负面词</summary>
                  <p className="mt-1 font-mono text-text-muted">{unwrapText(styleBible.negative_prompt)}</p>
                </details>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setCompareMode((m) => !m)}>
                  {compareMode ? "收起候选" : "从当前候选改选另一套"}
                </Button>
                <JobRunner
                  bookId={bookId}
                  node="bible.propose"
                  label="重新生成候选（将解锁）"
                  variant="secondary"
                  size="sm"
                  onDone={() => void load()}
                  onSettled={(status, message) => {
                    if (status === "failed" && message) setError(message);
                  }}
                />
              </div>
            </Card>
          )}

          {styleBible && (compareMode || !locked) && candidates.length > 0 && (
            <div className="space-y-3">
              {candidates.length > 1 && !locked && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-muted">
                    共 {candidates.length} 套候选，批准后锁定；也可稍后改选。
                  </p>
                  <button
                    type="button"
                    onClick={() => setCompareMode((m) => !m)}
                    className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-text-muted hover:bg-surface-3"
                  >
                    {compareMode ? "退出对比（纵向）" : "左右对比"}
                  </button>
                </div>
              )}
              <div className={compareMode ? "grid gap-4 lg:grid-cols-3" : "space-y-4"}>
                {candidates.map((p, i) => (
                  <ProposalCard
                    key={i}
                    proposal={p}
                    index={i}
                    recommended={
                      !locked && !!styleBible.visual_style && p.visual_style === styleBible.visual_style
                    }
                    approved={locked && styleBible.approved_proposal_index === i}
                    approveLabel={locked ? "改选这套" : "批准这套"}
                    onApprove={() => approve(i)}
                    approving={approving}
                  />
                ))}
              </div>
            </div>
          )}

          {styleBible && !locked && candidates.length > 0 && (
            <div className="border-t border-border pt-3">
              <JobRunner
                bookId={bookId}
                node="bible.propose"
                label="重新生成候选"
                variant="secondary"
                size="sm"
                onDone={() => void load()}
                onSettled={(status, message) => {
                  if (status === "failed" && message) setError(message);
                }}
              />
              <p className="mt-1 text-xs text-text-muted">
                重新生成会归档当前批次（历史可回看/恢复）并回到待审状态。
              </p>
            </div>
          )}

          <HistorySection
            history={data.bibleHistory ?? []}
            restoring={restoring}
            onRestore={(proposalId) => void restore(proposalId)}
          />
        </section>
      </section>
    </PageShell>
  );
}
