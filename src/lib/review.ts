/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseAdmin } from "@/lib/db";

/**
 * 待审收件箱（docs/06 §6.2 ReviewInbox）：复活 review_tasks 表。
 * 节点完成后把 AI 自检红项写为 open 任务；用户处理后可标记决策。
 */

export interface ReviewTaskItem {
  id: string;
  kind: string;
  targetType: string;
  targetId: string;
  status: string;
  aiReport: Record<string, unknown>;
  createdAt: string;
}

export interface ReviewItemInput {
  beatIdx: number;
  severity: "red" | "yellow";
  kind: string;
  issue: string;
  suggestion?: string | null;
}

/** 把自检红项持久化为 open 的 review_tasks（黄项只作为 ai_report 信息，不建任务防噪音） */
export async function persistReviewTasks(
  bookId: string,
  kind: string,
  targetType: string,
  targetId: string,
  items: ReviewItemInput[],
): Promise<number> {
  const s = getSupabaseAdmin();
  const reds = items.filter((i) => i.severity === "red");
  if (reds.length === 0) return 0;
  const { error } = await s.from("review_tasks").insert(
    reds.map((item) => ({
      book_id: bookId,
      kind,
      target_type: targetType,
      target_id: targetId,
      status: "open",
      ai_report: {
        beat_idx: item.beatIdx,
        kind: item.kind,
        issue: item.issue,
        suggestion: item.suggestion ?? null,
        severity: "red",
      },
    })),
  );
  if (error) throw error;
  return reds.length;
}

export async function listOpenReviewTasks(bookId: string, limit = 20): Promise<ReviewTaskItem[]> {
  const s = getSupabaseAdmin();
  const { data, error } = await s
    .from("review_tasks")
    .select("id, kind, target_type, target_id, status, ai_report, created_at")
    .eq("book_id", bookId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    targetType: r.target_type as string,
    targetId: r.target_id as string,
    status: r.status as string,
    aiReport: r.ai_report as Record<string, unknown>,
    createdAt: r.created_at as string,
  }));
}

/** 用户处理完成：记录决策并关闭 */
export async function decideReviewTask(bookId: string, taskId: string, decision: string): Promise<void> {
  const s = getSupabaseAdmin();
  const { error } = await s
    .from("review_tasks")
    .update({ status: "closed", human_decision: { decision, at: new Date().toISOString() } })
    .eq("id", taskId)
    .eq("book_id", bookId);
  if (error) throw error;
}

/**
 * adapt 校验重试耗尽的降级（docs/06 附录 F）：把失败诊断写入待审收件箱，
 * 而不是让用户只看到一句红字。返回给用户看的提示消息。
 */
export async function handleAdaptationFailure(
  bookId: string,
  err: { errors?: string[]; lastAdapt?: unknown },
): Promise<string> {
  void err.lastAdapt;
  const errors = err.errors ?? [];
  const summary = errors.join("；").slice(0, 400);
  await persistReviewTasks(bookId, "chapter_script", "book", bookId, [
    {
      beatIdx: 0,
      severity: "red",
      kind: "adapt_validation",
      issue: summary || "模型多次输出未通过规则校验（原因未记录）",
      suggestion: "请查看失败原因后重跑改编；如反复失败可先精简章节或人工拆分",
    },
  ]);
  return `改编校验连续失败（${errors.length} 项，详情已存入待审收件箱）`;
}
