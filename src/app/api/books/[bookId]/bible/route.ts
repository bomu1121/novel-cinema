import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/bible">,
) {
  const { bookId } = await ctx.params;
  try {
    const supabase = getSupabaseAdmin();

    const [bookRes, sourceChaptersRes, chaptersRes, charactersRes, locationsRes, itemsRes, cluesRes, eventsRes, styleRes, historyRes] =
      await Promise.all([
        supabase.from("books").select("id, title, status").eq("id", bookId).single(),
        supabase
          .from("source_chapters")
          .select("id, idx, title, char_count, status")
          .eq("book_id", bookId)
          .order("idx"),
        supabase
          .from("chapter_summaries")
          .select("source_chapter_id, summary, key_events, characters, clues, tone")
          .eq("book_id", bookId),
        supabase
          .from("characters")
          .select("id, canonical_name, aliases, role, description, bio, status")
          .eq("book_id", bookId),
        supabase
          .from("locations")
          .select("id, name, aliases, description, visual_note, status")
          .eq("book_id", bookId),
        supabase
          .from("items")
          .select("id, name, kind, description, visual_note, status")
          .eq("book_id", bookId),
        supabase
          .from("clues")
          .select("id, name, clue_type, description, is_red_herring, is_spoiler, status")
          .eq("book_id", bookId),
        supabase
          .from("timeline_events")
          .select("id, source_chapter_id, time_label, order_key, description")
          .eq("book_id", bookId)
          .order("order_key"),
        supabase
          .from("style_bibles")
          .select("id, version, status, genre, visual_style, art_direction, color_palette, camera_grammar, narration_tone, spoiler_rules, negative_prompt, proposal_json, approved_proposal_index, approved_at, manual_override")
          .eq("book_id", bookId)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("bible_proposals")
          .select("id, version, proposal_json, approved_index, note, created_at")
          .eq("book_id", bookId)
          .order("version", { ascending: false })
          .limit(20),
      ]);

    return NextResponse.json({
      book: bookRes.data,
      chapters: sourceChaptersRes.data ?? [],
      summaries: chaptersRes.data ?? [],
      characters: charactersRes.data ?? [],
      locations: locationsRes.data ?? [],
      items: itemsRes.data ?? [],
      clues: cluesRes.data ?? [],
      events: eventsRes.data ?? [],
      styleBible: styleRes.data ?? null,
      bibleHistory: historyRes.data ?? [],
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

