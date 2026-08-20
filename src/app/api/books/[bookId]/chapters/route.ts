import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/chapters">,
) {
  const { bookId } = await ctx.params;
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: book, error: bookError }, { data: chapters, error: chaptersError }] =
      await Promise.all([
        supabase
          .from("books")
          .select("id, title, status, total_chars, created_at")
          .eq("id", bookId)
          .single(),
        supabase
          .from("source_chapters")
          .select("id, idx, kind, title, char_count, status, parse_meta")
          .eq("book_id", bookId)
          .order("idx", { ascending: true }),
      ]);

    if (bookError || !book) {
      return NextResponse.json({ error: "书籍不存在" }, { status: 404 });
    }
    if (chaptersError) throw chaptersError;

    return NextResponse.json({ book, chapters: chapters ?? [] });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

