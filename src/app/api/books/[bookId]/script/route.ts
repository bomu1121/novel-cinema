import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";
import { getLatestScript } from "@/lib/pipeline/nodes/adapt";
import { estimateNode } from "@/lib/pipeline/graph";
import { listOpenReviewTasks } from "@/lib/review";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/script">,
) {
  const { bookId } = await ctx.params;
  try {
    const url = new URL(request.url);
    const chapterId = url.searchParams.get("chapterId") ?? undefined;
    const script = await getLatestScript(bookId, chapterId);
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
    const supabase = getSupabaseAdmin();
    const [chaptersRes, adaptedRes, adaptEstimate] = await Promise.all([
      supabase
        .from("source_chapters")
        .select("id, idx, title, char_count, status")
        .eq("book_id", bookId)
        .order("idx"),
      supabase
        .from("adapted_chapters")
        .select("id, source_chapter_id, title, status")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false }),
      estimateNode(bookId, "adapt").catch(() => null),
    ]);

    return NextResponse.json({
      ...script,
      review,
      chapters: chaptersRes.data ?? [],
      adaptedList: adaptedRes.data ?? [],
      adaptBlockers: adaptEstimate?.blockers ?? [],
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

