"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

interface RenderJob {
  id: string;
  scope: string;
  status: string;
  duration_sec: number | null;
  output_file_key: string | null;
  error: { message?: string } | null;
  url: string | null;
  created_at: string;
  finished_at: string | null;
}

interface RenderData {
  timeline: { status: string; duration_sec: number | null } | null;
  jobs: RenderJob[];
  command: string;
}

export default function RenderPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [data, setData] = useState<RenderData>({ timeline: null, jobs: [], command: "" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/render`);
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
    // 挂载后拉取渲染任务；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function copyCommand() {
    await navigator.clipboard.writeText(data.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <PageHeader
        title="渲染"
        meta="签核 F"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
      />

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <Card className="text-sm">
        <h2 className="font-semibold">M0 本地渲染</h2>
        <p className="mt-2 text-text-muted">
          当前阶段在本地终端执行渲染（M1 迁到云端 Job）。先确认分镜已构建、配音已合成，然后在项目根目录运行：
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-surface-invert px-3 py-2 text-xs text-inverse">
            {data.command || "npm run render:local -- --book <bookId>"}
          </code>
          <Button size="sm" variant="secondary" onClick={copyCommand}>
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
        {data.timeline && (
          <p className="mt-3 text-xs text-text-muted">
            preview timeline：<StatusPill table="timelines" status={data.timeline.status} /> ·{" "}
            {(data.timeline.duration_sec ?? 0).toFixed(1)}s
          </p>
        )}
      </Card>

      <section>
        <h2 className="mb-3 font-semibold">渲染任务</h2>
        {data.jobs.length === 0 ? (
          <EmptyState description="还没有渲染任务。运行一次本地渲染命令后这里会出现记录。" />
        ) : (
          <div className="space-y-2">
            {data.jobs.map((job) => (
              <Card key={job.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {job.scope} · <StatusPill table="render_jobs" status={job.status} />
                    {job.duration_sec != null && (
                      <span className="ml-2 text-xs text-text-muted">{job.duration_sec.toFixed(1)}s</span>
                    )}
                  </p>
                  <p className="text-xs text-text-subtle">{new Date(job.created_at).toLocaleString()}</p>
                </div>
                {job.error?.message && <p className="mt-1 text-xs text-stale">{job.error.message}</p>}
                {job.url && (
                  <a
                    href={job.url}
                    target="_blank"
                    className="mt-2 inline-block text-xs text-accent underline"
                  >
                    下载成品 mp4 →
                  </a>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
