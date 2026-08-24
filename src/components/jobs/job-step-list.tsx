"use client";

import { useEffect, useState } from "react";
import type { UseJobState } from "@/lib/ui/use-job";

/**
 * 任务阶段进度（docs/06 §6.2 JobStepList）：步骤流替代转圈。
 * - 真实分母（stepIndex/stepTotal）存在时显示阶段进度；
 * - 无真实进度时只显示当前步骤与已用时，绝不显示假百分比；
 * - aria-live 只播报阶段变化，不逐帧播报百分比。
 */
export interface JobStepListProps {
  state: UseJobState;
  onCancel?: () => void;
  className?: string;
  /** 停滞阈值（毫秒），超过则显示停滞提示；默认 30s */
  stallMs?: number;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

export function JobStepList({ state, onCancel, className = "", stallMs = 30000 }: JobStepListProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (state.status === "idle" || !state.jobId) return null;

  const hasRatio = state.stepTotal > 0 && state.stepIndex > 0;
  const percent = state.progress > 0 ? Math.round(state.progress * 100) : null;
  const stalled =
    state.status === "running" &&
    state.lastEventAt != null &&
    now - state.lastEventAt > stallMs;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-text-muted ${className}`}
    >
      {state.status === "pending" && <p>排队中…</p>}

      {state.status === "running" && (
        <div className={`space-y-1.5 ${stalled ? "text-regen" : ""}`}>
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  stalled ? "bg-regen" : "nc-pulse bg-accent"
                }`}
              />
              <span className="truncate">{state.step ?? (stalled ? "仍在生成" : "执行中")}</span>
            </p>
            <span className="shrink-0 tabular-nums">
              {hasRatio && `${state.stepIndex}/${state.stepTotal} · `}
              {formatElapsed(state.elapsedMs)}
            </span>
          </div>
          {stalled && (
            <p className="text-caption text-regen">
              已 {formatElapsed(now - state.lastEventAt!)} 没有新事件，可能仍在生成长内容
            </p>
          )}
          {percent != null && (
            <div
              className="h-1 overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="任务进度"
            >
              <div className={`h-full rounded-full ${stalled ? "bg-regen" : "bg-accent"}`} style={{ width: `${percent}%` }} />
            </div>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="min-h-6 rounded px-2 text-accent underline decoration-dotted underline-offset-2 hover:bg-accent/10"
            >
              取消任务
            </button>
          )}
          {state.logs.length > 0 && (
            <details className="text-caption text-text-subtle">
              <summary className="cursor-pointer select-none">执行日志（{state.logs.length}）</summary>
              <ul className="scroll-contain mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded bg-surface-1 p-2">
                {state.logs.map((line, i) => (
                  <li key={i} className="truncate font-mono text-[10px] leading-4">
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {state.status === "succeeded" && (
        <p className="text-approved">
          ✓ 已完成
          {state.elapsedMs > 0 &&
            (state.estimatedMs != null
              ? ` · 预估 ${formatElapsed(state.estimatedMs)} / 实际 ${formatElapsed(state.elapsedMs)}`
              : ` · 用时 ${formatElapsed(state.elapsedMs)}`)}
        </p>
      )}
      {state.status === "cancelled" && (
        <p className="text-text-muted">
          已取消{state.step ? `（完成到：${state.step}）` : ""}，可重新执行
        </p>
      )}
      {state.status === "failed" && (
        <p className="text-stale" role="alert">
          {state.error ?? "任务失败"}——可重试
        </p>
      )}
    </div>
  );
}
