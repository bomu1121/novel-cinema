import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";
import { runAdaptation } from "@/lib/pipeline/nodes/adapt";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/adapt">,
) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { chapterId?: string };
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("source_chapters")
      .select("id, idx, title, cleaned_text")
      .eq("book_id", bookId);
    query = body.chapterId ? query.eq("id", body.chapterId) : query.eq("idx", 1);
    const { data: chapter, error: chapterError } = await query.single();

    if (chapterError || !chapter) {
      return NextResponse.json({ error: "找不到可改编的章节（idx=1）" }, { status: 404 });
    }

    const result = await runAdaptation(bookId, {
      id: chapter.id,
      idx: chapter.idx,
      title: chapter.title,
      cleanedText: chapter.cleaned_text,
    });

    await supabase.from("books").update({ status: "scripting" }).eq("id", bookId);

    return NextResponse.json({
      adaptedChapterId: result.adaptedChapterId,
      adapt: result.adapt,
      review: result.review,
      context: result.context,
    });
  } catch (err) {
    const message =
      (err as { message?: string })?.message ??
      ((err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

