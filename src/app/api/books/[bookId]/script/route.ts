import { NextResponse } from "next/server";
import { getLatestScript } from "@/lib/pipeline/nodes/adapt";
import { listOpenReviewTasks } from "@/lib/review";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/script">,
) {
  const { bookId } = await ctx.params;
  try {
    const script = await getLatestScript(bookId);
    // 自检红项已持久化为 review_tasks（jobs 路径），合并回页面渲染
    const tasks = await listOpenReviewTasks(bookId);
    const review = tasks
      .filter((t) => t.kind === "chapter_script")
      .map((t) => {
        const report = t.aiReport as { beat_idx?: number; kind?: string; issue?: string; suggestion?: string | null };
        return {
          beat_idx: report.beat_idx ?? 0,
          severity: "red" as const,
          kind: report.kind ?? "unknown",
          issue: report.issue ?? "AI 自检发现问题",
          suggestion: report.suggestion ?? null,
        };
      });
    return NextResponse.json({ ...script, review });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

