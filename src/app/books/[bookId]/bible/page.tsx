"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

interface BibleData {
  book?: { id: string; title: string; status: string } | null;
  summaries?: Array<{ summary: string; tone: string | null }>;
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

  const [data, setData] = useState<BibleData>({});
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/bible`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId]);

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

  const summary = data.summaries?.[0];

  return (
    <PageShell className="space-y-8">
      <PageHeader
        title={data.book?.title ?? "全书档案"}
        meta="签核点 A"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
        actions={
          <JobRunner
            bookId={bookId}
            node="analyze"
            label="运行单章分析"
            disabled={approving}
            onRunningChange={(r) => setApproving(r)}
            onDone={() => void load()}
          />
        }
      />

      <ErrorBanner message={error} />

      {summary && (
        <Card>
          <h2 className="font-semibold">章节摘要</h2>
          <p className="mt-2 text-sm leading-6 text-text">{summary.summary}</p>
          {summary.tone && <p className="mt-2 text-xs text-text-muted">基调：{summary.tone}</p>}
        </Card>
      )}

      {data.characters && data.characters.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">人物</h2>
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

      {data.clues && data.clues.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">线索</h2>
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

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">风格圣经候选（AI 提案，选定后锁定）</h2>
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
          <EmptyState description="还没有候选，点右上角“运行单章分析”生成。" />
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
              <h3 className="font-semibold">方案 {i + 1}</h3>
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
    </PageShell>
  );
}
