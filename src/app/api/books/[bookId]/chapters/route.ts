import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";

interface SourceChapterRow {
  id: string;
  idx: number;
  title: string | null;
  char_count: number;
  status: string;
  parse_meta?: Record<string, unknown> | null;
}

/** source_chapters 表不存 kind，从 idx / parse_meta 推导，兼容旧数据和 seed 数据。 */
function deriveChapterKind(row: SourceChapterRow): string {
  if (row.idx === 0) return "front";
  const meta = row.parse_meta ?? {};
  if (meta.splitBy === "fallback_5000") return "segment";
  const unit = meta.unit;
  if (unit === "卷" || unit === "部" || unit === "集") return "part";
  return "chapter";
}

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
          .select("id, title, status, total_chars, created_at, source_encoding, parse_report")
          .eq("id", bookId)
          .single(),
        supabase
          .from("source_chapters")
          .select("id, idx, title, char_count, status, parse_meta")
          .eq("book_id", bookId)
          .order("idx", { ascending: true }),
      ]);

    if (bookError || !book) {
      return NextResponse.json({ error: "书籍不存在" }, { status: 404 });
    }
    if (chaptersError) throw chaptersError;

    const rows = (chapters ?? []) as SourceChapterRow[];
    const normalized = rows.map((ch) => ({
      ...ch,
      kind: deriveChapterKind(ch),
    }));

    return NextResponse.json({ book, chapters: normalized });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

