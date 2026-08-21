"use client";

import type { ReviewStatus } from "@/lib/ui/status";
import {
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_STYLE,
  toReviewStatus,
  neutralStatusLabel,
  toJobPhase,
  JOB_PHASE_LABEL,
} from "@/lib/ui/status";

export interface StatusBadgeProps {
  status: ReviewStatus;
  /** stale 过期原因（tooltip） */
  reason?: string;
  /** stale 影响的下游数量，显示「影响 N」并可点击溯源 */
  impactCount?: number;
  onTraceClick?: () => void;
  className?: string;
}

/** 族 A 审阅状态徽章（docs/06 §5.3）。只接受 toReviewStatus 的结果。 */
export function StatusBadge({
  status,
  reason,
  impactCount,
  onTraceClick,
  className = "",
}: StatusBadgeProps) {
  return (
    <span
      title={reason}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${REVIEW_STATUS_STYLE[status]} ${className}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {REVIEW_STATUS_LABEL[status]}
      {status === "stale" && impactCount != null && (
        <button
          type="button"
          onClick={onTraceClick}
          className="rounded px-0.5 underline decoration-dotted underline-offset-2 hover:bg-current/10"
        >
          影响 {impactCount}
        </button>
      )}
    </span>
  );
}

export interface StatusPillProps {
  /** 数据所属表名（消歧用） */
  table: string;
  /** DB 原始 status 值 */
  status?: string | null;
  reason?: string;
  impactCount?: number;
  onTraceClick?: () => void;
  className?: string;
}

/**
 * 统一状态入口：审阅态 → 徽章；执行态 → 进度 chip（running 脉冲）；
 * 领域语义 → 中性 chip；未知 → 不渲染。
 * 页面一律用这个组件渲染 status，禁止直接输出 DB 字符串。
 */
export function StatusPill({
  table,
  status,
  reason,
  impactCount,
  onTraceClick,
  className = "",
}: StatusPillProps) {
  const review = toReviewStatus(table, status);
  if (review) {
    return (
      <StatusBadge
        status={review}
        reason={reason}
        impactCount={impactCount}
        onTraceClick={onTraceClick}
        className={className}
      />
    );
  }
  const job = toJobPhase(status);
  if (job) {
    return (
      <span
        className={`inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted ${className}`}
      >
        {job === "running" && (
          <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 nc-pulse rounded-full bg-current" />
        )}
        {JOB_PHASE_LABEL[job]}
      </span>
    );
  }
  const neutral = neutralStatusLabel(status);
  if (!neutral) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted ${className}`}
    >
      {neutral}
    </span>
  );
}
