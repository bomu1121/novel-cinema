import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";

type Ctx = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  try {
    const s = getSupabaseAdmin();

    const [bookRes, chaptersRes, summariesRes, condensedRes, adaptedRes, beatsRes, shotsRes, takesRes] =
      await Promise.all([
        s.from("books").select("id, title, status").eq("id", bookId).single(),
        s.from("source_chapters").select("id, idx, title, char_count, status").eq("book_id", bookId).order("idx"),
        s.from("chapter_summaries").select("source_chapter_id, summary").eq("book_id", bookId),
        s.from("condensed_chapters").select("id, source_chapter_id, status").eq("book_id", bookId),
        s.from("adapted_chapters").select("id, source_chapter_id, title, status").eq("book_id", bookId),
        s.from("beats").select("id, adapted_chapter_id").eq("book_id", bookId),
        s.from("shots").select("id, beat_id").eq("book_id", bookId),
        s.from("voice_takes").select("id, beat_id").eq("book_id", bookId),
      ]);

    const summariesByChapter = new Map<string, boolean>(
      (summariesRes.data ?? []).map((r: { source_chapter_id: string }) => [r.source_chapter_id, true]),
    );
    const condensedByChapter = new Map<string, string>(
      (condensedRes.data ?? []).map((r: { source_chapter_id: string; status: string }) => [
        r.source_chapter_id,
        r.status,
      ]),
    );
    const adaptedByChapter = new Map<string, { id: string; source_chapter_id: string; status: string }>(
      (adaptedRes.data ?? []).map((r: { id: string; source_chapter_id: string; status: string }) => [
        r.source_chapter_id,
        r,
      ]),
    );
    const beats = (beatsRes.data ?? []) as Array<{ id: string; adapted_chapter_id: string }>;
    const shots = (shotsRes.data ?? []) as Array<{ id: string; beat_id: string }>;
    const takes = (takesRes.data ?? []) as Array<{ id: string; beat_id: string }>;

    const chapters = ((chaptersRes.data ?? []) as Array<{
      id: string;
      idx: number;
      title: string | null;
      char_count: number;
      status: string;
    }>).map((ch) => {
      const adapted = adaptedByChapter.get(ch.id) ?? null;
      const chapterBeats = adapted ? beats.filter((b) => b.adapted_chapter_id === adapted.id) : [];
      const beatIds = new Set(chapterBeats.map((b) => b.id));
      const shotCount = shots.filter((s) => beatIds.has(s.beat_id)).length;
      const takeCount = takes.filter((t) => beatIds.has(t.beat_id)).length;
      const condensedStatus = condensedByChapter.get(ch.id) ?? null;
      const adaptedStatus = adapted?.status ?? null;
      const analyzed = summariesByChapter.has(ch.id);
      const condensed = Boolean(condensedStatus);
      const adaptedDone = Boolean(adapted);
      const storyboardDone = shotCount > 0;
      const voiceDone = takeCount > 0;

      return {
        id: ch.id,
        idx: ch.idx,
        title: ch.title,
        char_count: ch.char_count,
        status: ch.status,
        stages: {
          analyze: { done: analyzed },
          condense: { done: condensed, status: condensedStatus },
          adapt: { done: adaptedDone, status: adaptedStatus, beatCount: chapterBeats.length },
          storyboard: { done: storyboardDone, shotCount },
          voice: { done: voiceDone, takeCount },
        },
      };
    });

    return NextResponse.json({
      book: bookRes.data ?? null,
      chapters,
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
