"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
      <header>
        <Link href={`/books/${bookId}`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← 返回章节
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          渲染 <span className="text-sm font-normal text-zinc-400">签核 F</span>
        </h1>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 p-5 text-sm">
        <h2 className="font-semibold">M0 本地渲染</h2>
        <p className="mt-2 text-zinc-600">
          当前阶段在本地终端执行渲染（M1 迁到云端 Job）。先确认分镜已构建、配音已合成，然后在项目根目录运行：
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white">
            {data.command || "npm run render:local -- --book <bookId>"}
          </code>
          <button
            onClick={copyCommand}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs hover:border-zinc-900"
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        {data.timeline && (
          <p className="mt-3 text-xs text-zinc-500">
            preview timeline：{data.timeline.status} · {(data.timeline.duration_sec ?? 0).toFixed(1)}s
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">渲染任务</h2>
        {data.jobs.length === 0 ? (
          <p className="text-sm text-zinc-400">还没有渲染任务。运行一次本地渲染命令后这里会出现记录。</p>
        ) : (
          <ul className="space-y-2">
            {data.jobs.map((job) => (
              <li key={job.id} className="rounded-xl border border-zinc-200 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {job.scope} · {job.status}
                    {job.duration_sec != null && (
                      <span className="ml-2 text-xs text-zinc-500">{job.duration_sec.toFixed(1)}s</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400">{new Date(job.created_at).toLocaleString()}</p>
                </div>
                {job.error?.message && <p className="mt-1 text-xs text-red-600">{job.error.message}</p>}
                {job.url && (
                  <a
                    href={job.url}
                    target="_blank"
                    className="mt-2 inline-block text-xs text-blue-600 underline"
                  >
                    下载成品 mp4 →
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
