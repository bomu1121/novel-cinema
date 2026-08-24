import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";
import { r2Put } from "@/lib/r2";
import { cleanBytes } from "@/lib/pipeline/nodes/clean";

/** M0 无登录阶段的固定属主，接入 auth 后改为当前用户 id */
const M0_OWNER_ID = "00000000-0000-4000-8000-000000000001";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".txt")) {
      return NextResponse.json({ error: "只支持 .txt 文件" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "文件为空" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "文件超过 50MB 上限" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const clean = cleanBytes(bytes);
    if (clean.chapters.length === 0) {
      return NextResponse.json({ error: "未能解析出任何正文" }, { status: 422 });
    }

    const title = (form.get("title") as string | null)?.trim() || file.name.replace(/\.txt$/i, "");

    const supabase = getSupabaseAdmin();
    const { data: book, error: bookError } = await supabase
      .from("books")
      .insert({
        owner_id: M0_OWNER_ID,
        title,
        source_file_name: file.name,
        total_chars: clean.totalChars,
        status: "draft",
        source_encoding: clean.encoding,
        parse_report: clean.report,
      })
      .select("id, title, status, total_chars, created_at, source_encoding, parse_report")
      .single();

    if (bookError || !book) {
      return NextResponse.json(
        { error: `写入 books 失败：${bookError?.message ?? "未知错误"}` },
        { status: 500 },
      );
    }

    // 原文件入 R2（R2 未配置时这里会抛错，由下方 catch 统一返回）
    const sourceKey = `book/${book.id}/source/${file.name}`;
    await r2Put(sourceKey, bytes, "text/plain");
    await supabase
      .from("books")
      .update({ source_file_key: sourceKey })
      .eq("id", book.id);

    const chapterRows = clean.chapters.map((ch) => ({
      book_id: book.id,
      idx: ch.idx,
      title: ch.title,
      raw_text: ch.rawText,
      cleaned_text: ch.cleanedText,
      char_count: ch.charCount,
      status: "draft" as const,
      parse_meta: ch.parseMeta,
    }));

    const { error: chaptersError } = await supabase
      .from("source_chapters")
      .insert(chapterRows);
    if (chaptersError) {
      return NextResponse.json(
        { error: `写入 source_chapters 失败：${chaptersError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      book,
      encoding: clean.encoding,
      warnings: clean.warnings,
      report: clean.report,
      totalChars: clean.totalChars,
      chapters: clean.chapters.map((ch) => ({
        idx: ch.idx,
        kind: ch.kind,
        title: ch.title,
        charCount: ch.charCount,
      })),
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? ((err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("books")
      .select("id, title, status, total_chars, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return NextResponse.json({ books: data ?? [] });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? ((err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ books: [], error: message });
  }
}


