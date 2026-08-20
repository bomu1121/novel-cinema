import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";
import { resolveAssetUrl } from "@/lib/pipeline/nodes/assets";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/storyboard">,
) {
  const { bookId } = await ctx.params;
  try {
    const supabase = getSupabaseAdmin();
    const { data: timeline } = await supabase
      .from("timelines")
      .select("id, kind, version, status, duration_sec, snapshot, created_at")
      .eq("book_id", bookId)
      .eq("kind", "preview")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: bgRows } = await supabase
      .from("assets")
      .select("id, title, file_key, params")
      .eq("book_id", bookId)
      .eq("kind", "background")
      .eq("status", "approved");

    const backgrounds = await Promise.all(
      ((bgRows ?? []) as Array<{ id: string; title: string | null; file_key: string | null; params: unknown }>).map(
        async (b) => ({ id: b.id, title: b.title, url: await resolveAssetUrl(b) }),
      ),
    );

    return NextResponse.json({
      timeline: timeline ?? null,
      tracks: timeline?.snapshot?.tracks ?? [],
      backgrounds,
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

