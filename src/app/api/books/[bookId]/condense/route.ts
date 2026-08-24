import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";
import { getLatestCondensed, saveCondensedText } from "@/lib/pipeline/nodes/condense";

type Ctx = { params: Promise<{ bookId: string }> };

/** 精简底稿对照页数据：源章原文 + 最新精简稿 + 全章节列表 + 已精简状态 */
export async function GET(request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  try {
    const url = new URL(request.url);
    const chapterId = url.searchParams.get("chapterId") ?? undefined;
    const data = await getLatestCondensed(bookId, chapterId);

    const supabase = getSupabaseAdmin();
    const [chaptersRes, condensedListRes] = await Promise.all([
      supabase
        .from("source_chapters")
        .select("id, idx, title, char_count, status")
        .eq("book_id", bookId)
        .order("idx"),
      supabase
        .from("condensed_chapters")
        .select("id, source_chapter_id, status, title, updated_at")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false }),
    ]);

    return NextResponse.json({
      ...data,
      chapters: chaptersRes.data ?? [],
      condensedList: condensedListRes.data ?? [],
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 手动修改精简稿：checkpoint → 更新 → 下游标 stale */
export async function PATCH(request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { text?: string; chapterId?: string };
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "精简稿不能为空" }, { status: 400 });
    }
    const saved = await saveCondensedText(bookId, body.text, body.chapterId);
    return NextResponse.json({ ok: true, id: saved.id });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
