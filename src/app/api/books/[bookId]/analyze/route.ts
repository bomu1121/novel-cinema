import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";
import { analyzeChapter, persistChapterAnalysis } from "@/lib/pipeline/nodes/analyze";

/**
 * 章节分析（M0 版）：单章粗读 → 落档案。
 * 风格圣经候选已拆为独立节点 bible.propose（docs/14），不再随章节分析联动刷新。
 * 长任务化（托管队列 + 进度）在 M1 引入。
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/analyze">,
) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { chapterId?: string };
    const supabase = getSupabaseAdmin();

    // 选择目标章：M0 默认第一章
    let query = supabase
      .from("source_chapters")
      .select("id, idx, title, cleaned_text")
      .eq("book_id", bookId);
    query = body.chapterId ? query.eq("id", body.chapterId) : query.eq("idx", 1);
    const { data: chapter, error: chapterError } = await query.single();

    if (chapterError || !chapter) {
      return NextResponse.json({ error: "找不到可分析的章节（idx=1）" }, { status: 404 });
    }

    const chapterForAnalysis = {
      id: chapter.id,
      idx: chapter.idx,
      title: chapter.title,
      cleanedText: chapter.cleaned_text,
    };

    const analysis = await analyzeChapter(bookId, chapterForAnalysis);
    const persisted = await persistChapterAnalysis(bookId, chapterForAnalysis, analysis);

    await supabase
      .from("books")
      .update({ status: "analyzing" })
      .eq("id", bookId);

    return NextResponse.json({
      chapter: { id: chapter.id, idx: chapter.idx, title: chapter.title },
      summary: analysis.summary,
      tone: analysis.tone,
      persisted,
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
