"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * 运行台 / Mission Control（docs/07 I8 / P4-D）：
 * 一屏看清“谁在跑、等什么、产出在哪”。
 * 数据来自 jobs active、staged groups、review_tasks open。
 */

interface ActiveJob {
  id: string;
  node: string;
  status: string;
  progress: number;
  step: string | null;
}

interface StagedGroup {
  jobId: string | null;
  node: string;
  count: number;
}

const NODE_LABEL: Record<string, string> = {
  analyze: "章节分析",
  "bible.propose": "风格候选",
  condense: "精简底稿",
  adapt: "改编脚本",
  "assets-phase1": "设定图 + 背景",
  "assets-phase2": "表情变体",
  storyboard: "分镜",
  voice: "配音",
  render: "渲染",
};

export function MissionControl({ bookId, className = "" }: { bookId: string; className?: string }) {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [staged, setStaged] = useState<StagedGroup[]>([]);
  const [reviewCount, setReviewCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [jobsRes, stagedRes, reviewRes] = await Promise.all([
        fetch(`/api/books/${bookId}/jobs?active=1`),
        fetch(`/api/books/${bookId}/staged`),
        fetch(`/api/books/${bookId}/review-tasks`),
      ]);
      const [jobsJson, stagedJson, reviewJson] = await Promise.all([
        jobsRes.json(),
        stagedRes.json(),
        reviewRes.json(),
      ]);
      setJobs(jobsJson.jobs ?? []);
      setStaged(stagedJson.groups ?? []);
      setReviewCount((reviewJson.tasks ?? []).length);
    } catch {
      /* 运行台失败不阻断页面 */
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载后拉取运行台；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  const totalPending = staged.reduce((s, g) => s + g.count, 0);

  return (
    <SectionCard
      title="运行台"
      actions={
        <span className="text-caption text-text-subtle">
          {jobs.length} 执行中 · {totalPending} 待审 · {reviewCount} 待处理
        </span>
      }
      className={className}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <h3 className="mb-2 text-caption font-medium text-text-muted">执行中任务</h3>
          {jobs.length === 0 ? (
            <EmptyState description="当前没有正在执行的任务。" />
          ) : (
            <ul className="space-y-2">
              {jobs.map((job) => (
                <li key={job.id} className="rounded-lg border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-text">
                      {NODE_LABEL[job.node] ?? job.node}
                    </span>
                    <StatusPill table="jobs" status={job.status} />
                  </div>
                  <p className="mt-1 truncate text-text-muted">{job.step ?? "排队中"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-caption font-medium text-text-muted">待审变更</h3>
          {staged.length === 0 ? (
            <EmptyState description="没有待审变更。" />
          ) : (
            <ul className="space-y-2">
              {staged.map((g) => (
                <li key={g.jobId ?? g.node} className="flex items-center justify-between rounded-lg border border-border p-2 text-xs">
                  <span className="truncate font-medium text-text">{NODE_LABEL[g.node] ?? g.node}</span>
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{g.count} 条</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-caption font-medium text-text-muted">待处理收件箱</h3>
          {reviewCount === 0 ? (
            <EmptyState description="收件箱已清空。" />
          ) : (
            <p className="rounded-lg border border-stale/40 bg-stale/10 p-2 text-xs text-stale">
              {reviewCount} 个 AI 自检红项待处理，请到 script 页定位修复。
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
