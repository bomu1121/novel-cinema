import { getSupabaseAdmin } from "@/lib/db";
import { resolveAssetUrl } from "@/lib/pipeline/nodes/assets";
import type {
  RenderAudioTrack,
  RenderSpec,
  RenderSubtitle,
  RenderVideoTrack,
} from "./types";

interface RawTrack {
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
  layers?: Array<{
    kind: string;
    asset_id?: string | null;
    asset_url?: string | null;
    text?: string;
    rect?: { x: number; y: number; w: number; h: number };
    enter?: string | null;
    exit?: string | null;
    motion?: Record<string, unknown>;
  }>;
}

/** 组装渲染规格：timeline.snapshot + 刷新资产 URL + 配音/字幕 */
export async function buildRenderSpec(bookId: string): Promise<RenderSpec> {
  const supabase = getSupabaseAdmin();
  const { data: timeline } = await supabase
    .from("timelines")
    .select("id, snapshot, duration_sec")
    .eq("book_id", bookId)
    .eq("kind", "preview")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const snapshot = timeline?.snapshot as {
    resolution?: [number, number];
    fps?: number;
    duration_sec?: number;
    tracks?: RawTrack[];
  } | null;
  if (!snapshot?.tracks?.length) {
    throw new Error("还没有分镜快照，请先构建分镜。");
  }

  // 刷新图片资产 URL（签名地址可能已过期）
  const assetIds = new Set<string>();
  for (const track of snapshot.tracks) {
    if (track.background_asset_id) assetIds.add(track.background_asset_id);
    for (const layer of track.layers ?? []) {
      if (layer.asset_id) assetIds.add(layer.asset_id);
    }
  }
  const urlById = new Map<string, string>();
  if (assetIds.size > 0) {
    const { data: assetRows } = await supabase
      .from("assets")
      .select("id, file_key, params")
      .in("id", [...assetIds]);
    for (const row of (assetRows ?? []) as Array<{
      id: string;
      file_key: string | null;
      params: unknown;
    }>) {
      const url = await resolveAssetUrl(row);
      if (url) urlById.set(row.id, url);
    }
  }

  let cursor = 0;
  const videoTracks: RenderVideoTrack[] = [];
  const subtitleTrack: RenderSubtitle[] = [];

  for (const raw of snapshot.tracks) {
    const duration = Math.max(0.5, Number(raw.duration_sec ?? 2));
    const start = cursor;
    const end = cursor + duration;

    const backgroundUrl =
      (raw.background_asset_id && urlById.get(raw.background_asset_id)) ||
      raw.background_url ||
      null;

    const layers = (raw.layers ?? []).map((layer) => ({
      kind: (layer.kind as RenderVideoTrack["layers"][number]["kind"]) ?? "overlay",
      asset_url:
        (layer.asset_id && urlById.get(layer.asset_id)) || layer.asset_url || null,
      text: layer.text,
      rect: layer.rect ?? { x: 0.5, y: 0.5, w: 0.4, h: 0.5 },
      enter: layer.enter ?? null,
      exit: layer.exit ?? null,
      motion: layer.motion ?? {},
    }));

    videoTracks.push({
      shotId: raw.shotId ?? `shot_${videoTracks.length}`,
      beatId: raw.beatId ?? "",
      beatIdx: raw.beatIdx ?? videoTracks.length,
      text: raw.text ?? "",
      description: raw.description ?? "",
      camera: raw.camera ?? "static",
      duration_sec: duration,
      transition_in: raw.transition_in ?? "cut",
      transition_out: raw.transition_out ?? "cut",
      background_url: backgroundUrl,
      layers,
    });

    const isTextCard = layers.some((l) => l.kind === "text");
    if (raw.text && !isTextCard && raw.text.length > 0) {
      subtitleTrack.push({ start_sec: start, end_sec: end, text: raw.text });
    }
    cursor = end;
  }

  // 配音：按 beat 找 voice_takes，时间轴位置与镜头累计一致
  const beatIds = [...new Set(videoTracks.map((t) => t.beatId).filter(Boolean))];
  const audioTracks: RenderAudioTrack[] = [];
  if (beatIds.length > 0) {
    const { data: takeRows } = await supabase
      .from("voice_takes")
      .select("beat_id, audio_asset_id, status, voice_profile_id")
      .in("beat_id", beatIds);
    const beatStart = new Map<string, number>();
    for (const track of videoTracks) {
      if (track.beatId && !beatStart.has(track.beatId)) beatStart.set(track.beatId, cursorOf(track, videoTracks));
    }

    for (const take of (takeRows ?? []) as Array<{
      beat_id: string;
      audio_asset_id: string | null;
      status: string;
      voice_profile_id: string | null;
    }>) {
      if (take.status === "rejected" || !take.audio_asset_id) continue;
      const { data: asset } = await supabase
        .from("assets")
        .select("id, file_key, params")
        .eq("id", take.audio_asset_id)
        .single();
      const url = asset ? await resolveAssetUrl(asset) : null;
      if (!url) continue;
      const start = beatStart.get(take.beat_id) ?? 0;
      audioTracks.push({
        kind: "voice",
        start_sec: start,
        url,
        volume: 1.0,
        speaker: take.voice_profile_id,
      });
    }
  }

  return {
    version: 1,
    bookId,
    resolution: snapshot.resolution ?? [1920, 1080],
    fps: snapshot.fps ?? 25,
    duration_sec: Number(cursor.toFixed(2)),
    video_tracks: videoTracks,
    audio_tracks: audioTracks,
    subtitle_track: subtitleTrack,
  };
}

function cursorOf(track: RenderVideoTrack, tracks: RenderVideoTrack[]): number {
  let sum = 0;
  for (const t of tracks) {
    if (t.shotId === track.shotId) return sum;
    sum += t.duration_sec;
  }
  return 0;
}
