"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);

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

  async function runAnalysis() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `分析失败（HTTP ${res.status}）`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

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
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12">
      <header className="flex items-start justify-between">
        <div>
          <Link href={`/books/${bookId}`} className="text-sm text-zinc-500 hover:text-zinc-900">
            ← 返回章节
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            {data.book?.title ?? "全书档案"} <span className="text-sm font-normal text-zinc-400">签核点 A</span>
          </h1>
        </div>
        <button
          onClick={runAnalysis}
          disabled={running}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "AI 分析中…" : "运行单章分析"}
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <section className="rounded-xl border border-zinc-200 p-5">
          <h2 className="font-semibold">章节摘要</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">{summary.summary}</p>
          {summary.tone && <p className="mt-2 text-xs text-zinc-500">基调：{summary.tone}</p>}
        </section>
      )}

      {data.characters && data.characters.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">人物</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.characters.map((c) => (
              <div key={c.id} className="rounded-lg border border-zinc-200 p-4 text-sm">
                <p className="font-medium">
                  {c.canonical_name}
                  {c.aliases.length > 0 && (
                    <span className="ml-2 text-xs text-zinc-500">aka {c.aliases.join(" / ")}</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-zinc-400">{c.role}</p>
                <p className="mt-2 text-zinc-600">{c.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.clues && data.clues.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">线索</h2>
          <ul className="space-y-2">
            {data.clues.map((cl) => (
              <li key={cl.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <span className="font-medium">{cl.name}</span>
                <span className="ml-2 text-xs text-amber-600">{cl.clue_type}</span>
                {cl.is_red_herring && <span className="ml-2 text-xs text-red-500">红鲱鱼</span>}
                {cl.is_spoiler && <span className="ml-2 text-xs text-red-500">剧透禁画</span>}
                <p className="mt-1 text-zinc-600">{cl.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-6">
        <h2 className="font-semibold">风格圣经候选（AI 提案，选定后锁定）</h2>
        {!data.styleBible && (
          <p className="text-sm text-zinc-400">还没有候选，点右上角“运行单章分析”生成。</p>
        )}
        {data.styleBible?.proposal_json?.map((p, i) => (
          <div
            key={i}
            className={`rounded-xl border p-5 text-sm ${
              data.styleBible?.approved_proposal_index === i
                ? "border-emerald-400 bg-emerald-50"
                : "border-zinc-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">方案 {i + 1}</h3>
              {data.styleBible?.approved_proposal_index === i ? (
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs text-white">已批准</span>
              ) : (
                <button
                  onClick={() => approve(i)}
                  disabled={approving}
                  className="rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:border-zinc-900 disabled:opacity-50"
                >
                  批准这套
                </button>
              )}
            </div>
            <p className="mt-3 font-mono text-xs leading-5 text-zinc-700">{p.visual_style}</p>
            <p className="mt-2 text-zinc-600">{p.art_direction}</p>
            {p.color_palette.length > 0 && (
              <p className="mt-2 flex items-center gap-2">
                {p.color_palette.map((color) => (
                  <span
                    key={color}
                    className="inline-block h-5 w-5 rounded border border-zinc-300"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </p>
            )}
            <p className="mt-2 text-xs text-zinc-500">旁白基调：{p.narration_tone}</p>
            {p.spoiler_rules.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                {p.spoiler_rules.map((rule, j) => (
                  <li key={j}>{rule}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
