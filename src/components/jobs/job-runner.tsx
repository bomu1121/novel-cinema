"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { JobStepList } from "@/components/jobs/job-step-list";
import { useJob } from "@/lib/ui/use-job";

/**
 * AI 任务一体化入口（docs/06 §6.2）：按钮 = 入队；下方就地展开阶段进度。
 * 页面集成示例：
 *   <JobRunner bookId={bookId} node="voice" label="逐句合成" onDone={load} />
 */
export interface JobRunnerProps {
  bookId: string;
  node: "analyze" | "bible.propose" | "condense" | "adapt" | "assets-phase1" | "assets-phase2" | "storyboard" | "voice";
  label: string;
  /** 入队时随任务一起传递的结构化输入（如 analyze 的 chapterId） */
  input?: Record<string, unknown>;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "approve";
  size?: "sm" | "md";
  className?: string;
  /** 已有任务 id（页面切换章节后重新挂载时接回进度） */
  initialJobId?: string | null;
  /** 运行中状态回调（页面用它冻结其他按钮） */
  onRunningChange?: (running: boolean) => void;
  /** 入队成功（页面可持久化 jobId，供切换章节后接回） */
  onStart?: (jobId: string) => void;
  /** 成功完成（页面在此刷新数据） */
  onDone?: (jobId: string) => void;
  /** 失败/取消 */
  onSettled?: (status: "failed" | "cancelled", message: string | null) => void;
}

export function JobRunner({
  bookId,
  node,
  label,
  input,
  disabled,
  variant = "primary",
  size = "md",
  className = "",
  initialJobId = null,
  onRunningChange,
  onStart,
  onDone,
  onSettled,
}: JobRunnerProps) {
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [startError, setStartError] = useState<string | null>(null);
  const job = useJob(bookId, jobId);
  const running = job.status === "pending" || job.status === "running";
  const doneRef = useRef(false);

  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  useEffect(() => {
    if (job.status === "succeeded" && !doneRef.current) {
      doneRef.current = true;
      onDone?.(job.jobId!);
    } else if ((job.status === "failed" || job.status === "cancelled") && !doneRef.current) {
      doneRef.current = true;
      onSettled?.(job.status, job.error);
    }
  }, [job.status, job.error, job.jobId, onDone, onSettled]);

  const start = useCallback(async () => {
    doneRef.current = false;
    setStartError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, input }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "入队失败");
      const nextJobId = json.jobId as string;
      setJobId(nextJobId);
      onStart?.(nextJobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStartError(message);
      onSettled?.("failed", message);
    }
  }, [bookId, node, input, onStart, onSettled]);

  return (
    <div className={className}>
      <Button
        variant={variant}
        size={size}
        onClick={start}
        disabled={disabled || running}
        loading={running}
      >
        {label}
      </Button>
      {startError && (
        <p className="mt-2 text-xs text-stale" role="alert">
          {startError}
        </p>
      )}
      {jobId && (
        <JobStepList
          className="mt-2"
          state={job}
          onCancel={() => {
            void job.cancel();
          }}
        />
      )}
    </div>
  );
}
