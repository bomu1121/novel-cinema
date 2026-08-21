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
    const bgUrlById = new Map<string, string>();
    for (const bg of backgrounds) {
      if (bg.url) bgUrlById.set(bg.id, bg.url);
    }

    const rawTracks = (timeline?.snapshot?.tracks ?? []) as Array<{
      shotId?: string;
      beatId?: string;
      beatIdx?: number;
      text?: string;
      description?: string;
      camera?: string;
      duration_sec?: number;
      transition_in?: string;
      transition_out?: string;
      background_url?: string | null;
      background_asset_id?: string | null;
      layers?: Array<Record<string, unknown>>;
    }>;

    // 兼容旧/手工 fixture 的简版 snapshot：补齐页面必需字段，缺失 layers 不崩溃
    const tracks = rawTracks.map((track) => ({
      shotId: track.shotId ?? "",
      beatId: track.beatId ?? "",
      beatIdx: track.beatIdx ?? 0,
      text: track.text ?? "",
      description: track.description ?? "",
      camera: track.camera ?? "static",
      duration_sec: Number(track.duration_sec ?? 2),
      transition_in: track.transition_in ?? "cut",
      transition_out: track.transition_out ?? "cut",
      background_url:
        (track.background_asset_id && bgUrlById.get(track.background_asset_id)) ||
        track.background_url ||
        null,
      background_asset_id: track.background_asset_id ?? null,
      layers: (track.layers ?? []).map((layer) => ({
        kind: (layer.kind as string) ?? "overlay",
        asset_url: (layer.asset_url as string | null) ?? null,
        text: layer.text as string | undefined,
        rect: (layer.rect as { x: number; y: number; w: number; h: number }) ?? { x: 0.5, y: 0.5, w: 0.4, h: 0.5 },
        motion: (layer.motion as Record<string, unknown>) ?? {},
      })),
    }));

    return NextResponse.json({
      timeline: timeline ?? null,
      tracks,
      backgrounds,
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

