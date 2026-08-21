/**
 * 状态语义三族（docs/06-ui-optimization-plan.md §5.3）。
 *
 * 族 A 审阅生命周期 → `<StatusBadge>`（唯一入口 toReviewStatus，返回 null 即"别画徽章"）
 * 族 B 执行生命周期 → `<JobStepList>` / `<JobTrace>`（toJobPhase）
 * 族 C 领域语义 → 中性 chip（neutralStatusLabel，禁止套状态色）
 *
 * 权威枚举见 supabase/migrations/0001_schema.sql:16-34；SQLite 侧是自由 TEXT，归一在 UI 层做。
 */

export type ReviewStatus =
  | "draft"
  | "review"
  | "approved"
  | "rejected"
  | "stale"
  | "regen"
  | "skipped";

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  draft: "草稿",
  review: "待审",
  approved: "已批准",
  rejected: "已驳回",
  stale: "已过期",
  regen: "待重生成",
  skipped: "已跳过",
};

/** 族 A 徽章样式（令牌） */
export const REVIEW_STATUS_STYLE: Record<ReviewStatus, string> = {
  draft: "border-draft/30 bg-draft/10 text-draft",
  review: "border-review/40 bg-review/10 text-review",
  approved: "border-approved/40 bg-approved/10 text-approved",
  rejected: "border-rejected/40 bg-rejected/10 text-rejected line-through decoration-rejected/60",
  stale: "border-stale/40 bg-stale/10 text-stale",
  regen: "border-regen/40 bg-regen/10 text-regen",
  skipped: "border-border-strong bg-surface-2 text-text-subtle",
};

/**
 * 族 A 映射：DB status → 审阅状态；不属于审阅族的值一律返回 null（含执行态、剧情态、阶段态）。
 * 表名仅在必要时用于消歧。
 */
export function toReviewStatus(
  table: string,
  dbStatus: string | null | undefined,
): ReviewStatus | null {
  switch (dbStatus) {
    case "draft":
      // books 表的 draft 是全书阶段，不是审阅态
      if (table === "books") return null;
      return "draft";
    case "pending_review":
    case "candidate": // asset_status：候选即待人工点选
    case "open": // review_status
      return "review";
    case "approved":
    case "accepted": // take_status
      return "approved";
    case "rejected":
      return "rejected";
    case "stale":
      return "stale";
    case "archived": // asset_status：淘汰但保留 → 待重生成
      return "regen";
    case "skipped": // review_status
      return "skipped";
    default:
      return null;
  }
}

/** 族 B 执行阶段 */
export type JobPhase = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export const JOB_PHASE_LABEL: Record<JobPhase, string> = {
  pending: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function toJobPhase(dbStatus: string | null | undefined): JobPhase | null {
  switch (dbStatus) {
    case "pending":
    case "queued":
      return "pending";
    case "running":
    case "generating": // asset_status.generating 语义上属于执行族
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

/** 族 C 领域语义（中性标签，不套状态色）：剧情态 / 全书阶段 */
const NEUTRAL_STATUS_LABEL: Record<string, string> = {
  // project_status（全书阶段；books 表的 draft 走这里）
  draft: "未开始",
  analyzing: "分析中",
  scripting: "改编中",
  asset_ready: "资产就绪",
  rendering: "渲染中",
  completed: "已完成",
  // clue_status（剧情态）
  introduced: "已出场",
  recalled: "已回忆",
  resolved: "已揭示",
  red_herring: "红鲱鱼",
};

export function neutralStatusLabel(dbStatus: string | null | undefined): string | null {
  if (!dbStatus) return null;
  return NEUTRAL_STATUS_LABEL[dbStatus] ?? null;
}

/** 全书阶段序列（驱动流程铁路高亮） */
export const PROJECT_PHASES = [
  "draft",
  "analyzing",
  "scripting",
  "asset_ready",
  "rendering",
  "completed",
  "failed",
] as const;
