"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Card } from "@/components/ui/card";
import { JobRunner } from "@/components/jobs/job-runner";

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
  const [voiceBlockers, setVoiceBlockers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [redoIds, setRedoIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/voice`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
      setVoiceBlockers(json.voiceBlockers ?? []);
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

  async function approve() {
    setApproving(true);
    try {
      const res = await fetch(`/api/books/${bookId}/voice/approve`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "批准失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }

  async function redo(takeId: string) {
    setRedoIds((prev) => new Set(prev).add(takeId));
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/voice/${takeId}/redo`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "重录失败");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRedoIds((prev) => {
        const next = new Set(prev);
        next.delete(takeId);
        return next;
      });
    }
  }

  const missing = data.rows.filter((r) => !r.take).length;
  const red = data.rows.filter((r) => r.take?.error).length;

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="多角色配音"
        meta="签核点 E"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
        actions={
          <div className="flex gap-2">
            <JobRunner
              bookId={bookId}
              node="voice"
              label={`逐句合成（缺 ${missing} 句）`}
              disabled={approving || voiceBlockers.length > 0}
              onRunningChange={setGenerating}
              onDone={() => void load()}
            />
            <Button
              variant="approve"
              onClick={approve}
              disabled={approving || generating || red > 0}
              loading={approving}
              title={red > 0 ? "先处理红项" : ""}
            >
              批准全部（红项 {red}）
            </Button>
          </div>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {voiceBlockers.length > 0 && (
        <div className="rounded-lg border border-stale/40 bg-stale/10 px-4 py-3 text-sm text-stale" role="alert">
          配音暂不可用：{voiceBlockers.join("；")}
        </div>
      )}

      {data.chapter && (
        <p className="text-sm text-text-muted">
          当前配音章节：<span className="font-medium text-text">{data.chapter.title}</span>
        </p>
      )}

      <div className="space-y-2">
        {data.rows.map((row) => (
          <Card
            key={row.beat.id}
            className={`text-sm ${
              row.take?.error ? "border-l-4 border-l-stale border-stale/40 bg-stale/10" : ""
            }`}
          >
            <div className="flex flex-wrap items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-caption text-text-muted">
                #{row.beat.idx}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">
                    {row.beat.speaker_type === "narrator" ? "旁白" : "角色"}
                  </span>
                  <span className="text-caption text-text-muted">
                    {row.beat.emotion} · pace {row.beat.pace}
                  </span>
                  {row.take && (
                    <>
                      <StatusPill table="voice_takes" status={row.take.status} />
                      {row.take.asr_confidence != null && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-caption ${
                            row.take.asr_confidence < 0.85
                              ? "bg-stale/10 text-stale"
                              : "bg-approved/10 text-approved"
                          }`}
                        >
                          ASR {Math.round(row.take.asr_confidence * 100)}%
                        </span>
                      )}
                    </>
                  )}
                </div>
                <p className="mt-1 text-text">{row.beat.text}</p>
                {row.take?.error?.message && (
                  <p className="mt-1 text-xs text-stale">{row.take.error.message}</p>
                )}
                {row.url ? (
                  <audio controls src={row.url} className="mt-2 h-8 w-full" />
                ) : (
                  row.take && <p className="mt-1 text-xs text-text-subtle">（音频预览不可用）</p>
                )}
              </div>
              {row.take && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => redo(row.take!.id)}
                  disabled={approving || redoIds.has(row.take.id)}
                  loading={redoIds.has(row.take.id)}
                >
                  重录
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
