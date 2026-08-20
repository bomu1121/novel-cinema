"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface VoiceRow {
  beat: {
    id: string;
    idx: number;
    speaker_type: string;
    text: string;
    emotion: string;
    pace: number;
  };
  take: {
    id: string;
    duration_ms: number;
    asr_text: string | null;
    asr_confidence: number | null;
    status: string;
    error: { message?: string } | null;
  } | null;
  url: string | null;
}

interface VoiceData {
  chapter: { id: string; title: string } | null;
  rows: VoiceRow[];
}

export default function VoicePage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [data, setData] = useState<VoiceData>({ chapter: null, rows: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generate" | "approve" | string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/voice`);
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
    // 挂载后拉取配音列表；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/voice/generate`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `合成失败（HTTP ${res.status}）`);
        return;
      }
      if (json.errors?.length) setError(`部分失败：${json.errors.join("；")}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    try {
      const res = await fetch(`/api/books/${bookId}/voice/approve`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "批准失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function redo(takeId: string) {
    setBusy(takeId);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/voice/${takeId}/redo`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "重录失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const missing = data.rows.filter((r) => !r.take).length;
  const red = data.rows.filter((r) => r.take?.error).length;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <header className="flex items-start justify-between">
        <div>
          <Link href={`/books/${bookId}`} className="text-sm text-zinc-500 hover:text-zinc-900">
            ← 返回章节
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            多角色配音 <span className="text-sm font-normal text-zinc-400">签核点 E</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={generate}
            disabled={busy !== null}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "generate" ? "合成中…" : `逐句合成（缺 ${missing} 句）`}
          </button>
          <button
            onClick={approve}
            disabled={busy !== null || red > 0}
            className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            title={red > 0 ? "先处理红项" : ""}
          >
            {busy === "approve" ? "批准中…" : `批准全部（红项 ${red}）`}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {data.rows.map((row) => (
          <li
            key={row.beat.id}
            className={`rounded-xl border p-4 text-sm ${
              row.take?.error ? "border-red-300 bg-red-50" : "border-zinc-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                #{row.beat.idx} · {row.beat.speaker_type === "narrator" ? "旁白" : "角色"}
                <span className="ml-2 text-xs text-zinc-500">
                  {row.beat.emotion} · pace {row.beat.pace}
                </span>
              </p>
              {row.take && (
                <span className="flex items-center gap-2 text-xs text-zinc-500">
                  {row.take.status}
                  {row.take.asr_confidence != null && (
                    <span className={row.take.asr_confidence < 0.85 ? "text-red-600" : ""}>
                      ASR {Math.round(row.take.asr_confidence * 100)}%
                    </span>
                  )}
                  <button
                    onClick={() => redo(row.take!.id)}
                    disabled={busy !== null}
                    className="rounded border border-zinc-300 px-2 py-1 hover:border-zinc-900 disabled:opacity-50"
                  >
                    {busy === row.take.id ? "重录中…" : "重录"}
                  </button>
                </span>
              )}
            </div>
            <p className="mt-1 text-zinc-700">{row.beat.text}</p>
            {row.take?.error?.message && (
              <p className="mt-1 text-xs text-red-600">{row.take.error.message}</p>
            )}
            {row.url ? (
              <audio controls src={row.url} className="mt-2 h-8 w-full" />
            ) : (
              row.take && <p className="mt-1 text-xs text-zinc-400">（音频预览不可用）</p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
