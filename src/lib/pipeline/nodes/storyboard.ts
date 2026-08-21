import { getSupabaseAdmin } from "@/lib/db";
import { resolveAssetUrl } from "@/lib/pipeline/nodes/assets";
import type { Beat } from "@/lib/pipeline/schemas/adapt";

interface AssetForShot {
  id: string;
  kind: string;
  character_id: string | null;
  expression: string | null;
  file_key: string | null;
  params: unknown;
  url: string;
}

export interface LayerDraft {
  kind: "background" | "character" | "prop" | "text" | "overlay";
  assetId: string | null;
  characterId: string | null;
  expression: string | null;
  rect: { x: number; y: number; w: number; h: number };
  enter: string | null;
  exit: string | null;
  motion: Record<string, unknown>;
}

export interface ShotDraft {
  beatId: string;
  beatIdx: number;
  idx: number;
  text: string;
  description: string;
  camera: string;
  durationSec: number;
  transitionIn: string;
  transitionOut: string;
  backgroundAssetId: string | null;
  layers: LayerDraft[];
}

interface StoryboardContext {
  backgrounds: AssetForShot[];
  refsByCharacter: Map<string, AssetForShot>;
  expressionsByKey: Map<string, AssetForShot>;
}

async function loadAssets(bookId: string): Promise<StoryboardContext> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("assets")
    .select("id, kind, character_id, expression, file_key, params")
    .eq("book_id", bookId)
    .eq("status", "approved");
  const rows = (data ?? []) as Array<Omit<AssetForShot, "url">>;

  const withUrls: AssetForShot[] = [];
  for (const row of rows) {
    const url = await resolveAssetUrl(row);
    if (url) withUrls.push({ ...row, url });
  }

  const backgrounds = withUrls.filter((a) => a.kind === "background");
  const refsByCharacter = new Map<string, AssetForShot>();
  const expressionsByKey = new Map<string, AssetForShot>();
  for (const a of withUrls) {
    if (a.kind === "character_ref" && a.character_id) refsByCharacter.set(a.character_id, a);
    if (a.kind === "expression" && a.character_id && a.expression) {
      expressionsByKey.set(`${a.character_id}:${a.expression}`, a);
    }
  }
  return { backgrounds, refsByCharacter, expressionsByKey };
}

interface BeatRow extends Omit<Beat, "character_name"> {
  id: string;
  character_id: string | null;
}

function characterLayer(beat: BeatRow, ctx: StoryboardContext): LayerDraft | null {
  if (!beat.character_id) return null;
  const asset =
    expressionsByKeyLookup(ctx, beat.character_id, beat.emotion) ??
    ctx.refsByCharacter.get(beat.character_id) ??
    null;
  if (!asset) return null;
  return {
    kind: "character",
    assetId: asset.id,
    characterId: beat.character_id,
    expression: beat.emotion,
    rect: { x: 0.5, y: 0.42, w: 0.34, h: 0.55 },
    enter: null,
    exit: null,
    motion: { type: "breath", amplitude: 0.002 },
  };
}

function expressionsByKeyLookup(
  ctx: StoryboardContext,
  characterId: string,
  emotion: string,
): AssetForShot | undefined {
  return (
    ctx.expressionsByKey.get(`${characterId}:${emotion}`) ??
    ctx.expressionsByKey.get(`${characterId}:neutral`) ??
    undefined
  );
}

/** S10：beat → shots 的确定性镜头语法（docs/02 规则表 v0 实现） */
function buildShotsForBeat(beat: BeatRow, ctx: StoryboardContext, beatIndex: number): ShotDraft[] {
  const duration = Number(beat.estimated_duration_sec) || 4;
  const base = {
    beatId: beat.id,
    beatIdx: beat.idx,
    text: beat.text,
    transitionIn: "cut" as const,
    transitionOut: "cut" as const,
  };

  switch (beat.type) {
    case "narration": {
      return [
        {
          ...base,
          idx: 0,
          description: `旁白：${beat.text.slice(0, 24)}`,
          // 默认静止：背景不自动推拉横摇，动效由用户在画布/编排台显式选择
          camera: "static",
          durationSec: Math.max(3, Math.min(8, duration)),
          backgroundAssetId: ctx.backgrounds[beatIndex % Math.max(1, ctx.backgrounds.length)]?.id ?? null,
          layers: [],
        },
      ];
    }

    case "dialogue": {
      const layer = characterLayer(beat, ctx);
      return [
        {
          ...base,
          idx: 0,
          description: `对白：${beat.text.slice(0, 24)}`,
          camera: "static",
          durationSec: Math.min(8, Math.max(2.5, duration)),
          backgroundAssetId: ctx.backgrounds[beatIndex % Math.max(1, ctx.backgrounds.length)]?.id ?? null,
          layers: layer ? [layer] : [],
        },
      ];
    }

    case "action": {
      const half = duration / 2;
      if (duration >= 5) {
        return [
          {
            ...base,
            idx: 0,
            description: `动作 A：${beat.text.slice(0, 20)}`,
            camera: "static",
            durationSec: Number(half.toFixed(2)),
            transitionOut: "cut",
            backgroundAssetId: ctx.backgrounds[beatIndex % Math.max(1, ctx.backgrounds.length)]?.id ?? null,
            layers: [],
          },
          {
            ...base,
            idx: 1,
            description: `动作 B：${beat.text.slice(0, 20)}`,
            camera: "static",
            durationSec: Number((duration - half).toFixed(2)),
            transitionIn: "cut",
            backgroundAssetId: ctx.backgrounds[(beatIndex + 1) % Math.max(1, ctx.backgrounds.length)]?.id ?? null,
            layers: [],
          },
        ];
      }
      return [
        {
          ...base,
          idx: 0,
          description: `动作：${beat.text.slice(0, 24)}`,
          camera: "static",
          durationSec: duration,
          backgroundAssetId: ctx.backgrounds[beatIndex % Math.max(1, ctx.backgrounds.length)]?.id ?? null,
          layers: [],
        },
      ];
    }

    case "insert_card": {
      return [
        {
          ...base,
          idx: 0,
          description: `文字卡：${beat.text.slice(0, 24)}`,
          camera: "static",
          durationSec: Math.min(5, Math.max(3, duration)),
          transitionIn: "fade_in",
          transitionOut: "fade_out",
          backgroundAssetId: null,
          layers: [
            {
              kind: "text",
              assetId: null,
              characterId: null,
              expression: null,
              rect: { x: 0.5, y: 0.5, w: 0.78, h: 0.3 },
              enter: "fade_in",
              exit: "fade_out",
              motion: {},
            },
          ],
        },
      ];
    }

    case "montage": {
      const bgCount = Math.min(ctx.backgrounds.length, 3);
      if (bgCount === 0) {
        return [
          {
            ...base,
            idx: 0,
            description: `蒙太奇（无背景资产，黑场占位）`,
            camera: "static",
            durationSec: 2,
            transitionIn: "crossfade",
            transitionOut: "crossfade",
            backgroundAssetId: null,
            layers: [],
          },
        ];
      }
      return ctx.backgrounds.slice(0, bgCount).map((bg, i) => ({
        ...base,
        idx: i,
        description: `蒙太奇 ${i + 1}`,
        camera: "static",
        durationSec: Number(Math.max(2, duration / bgCount).toFixed(2)),
        transitionIn: i === 0 ? "crossfade" : "crossfade",
        transitionOut: i === bgCount - 1 ? "crossfade" : "crossfade",
        backgroundAssetId: bg.id,
        layers: [],
      }));
    }

    case "transition": {
      return [
        {
          ...base,
          idx: 0,
          description: "黑场过渡",
          camera: "static",
          durationSec: Math.min(1.5, duration),
          transitionIn: "dip_to_black",
          transitionOut: "dip_to_black",
          backgroundAssetId: null,
          layers: [
            {
              kind: "overlay",
              assetId: null,
              characterId: null,
              expression: null,
              rect: { x: 0.5, y: 0.5, w: 1, h: 1 },
              enter: null,
              exit: null,
              motion: {},
            },
          ],
        },
      ];
    }

    default: {
      return [
        {
          ...base,
          idx: 0,
          description: beat.text.slice(0, 24),
          camera: "static",
          durationSec: duration,
          backgroundAssetId: null,
          layers: [],
        },
      ];
    }
  }
}

export interface BuildStoryboardResult {
  adaptedChapterId: string;
  timelineId: string;
  durationSec: number;
  shots: Array<{
    id: string;
    beatIdx: number;
    idx: number;
    description: string;
    camera: string;
    durationSec: number;
    transitionIn: string;
    transitionOut: string;
    backgroundUrl: string | null;
    layers: Array<{
      id: string;
      kind: string;
      assetUrl: string | null;
      expression: string | null;
      rect: unknown;
      motion: unknown;
    }>;
  }>;
}

/** 构建 + 落库分镜，并生成 preview 版 timeline 快照 */
export async function buildStoryboard(
  bookId: string,
  adaptedChapterId?: string,
): Promise<BuildStoryboardResult> {
  const supabase = getSupabaseAdmin();

  let chapterQuery = supabase
    .from("adapted_chapters")
    .select("id, source_chapter_id, title, target_duration_sec, status")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (adaptedChapterId) chapterQuery = chapterQuery.eq("id", adaptedChapterId);
  const { data: chapter, error: chapterError } = await chapterQuery.maybeSingle();
  if (chapterError || !chapter) {
    throw new Error("还没有改编脚本，请先运行章节改编。");
  }

  const { data: beatRows } = await supabase
    .from("beats")
    .select("*")
    .eq("adapted_chapter_id", chapter.id)
    .order("idx");
  const beats = (beatRows ?? []) as BeatRow[];
  if (beats.length === 0) throw new Error("该章没有 beat");

  const ctx = await loadAssets(bookId);
  if (ctx.backgrounds.length === 0 && beats.some((b) => b.type !== "insert_card" && b.type !== "transition")) {
    throw new Error("还没有已批准的背景图。请先到资产库完成 phase1 并点选背景。");
  }

  // 幂等：重跑先清掉本章旧 shots/layers
  const beatIds = beats.map((b) => b.id);
  const { data: oldShots } = await supabase.from("shots").select("id").in("beat_id", beatIds);
  const oldShotIds = (oldShots ?? []).map((s: { id: string }) => s.id);
  if (oldShotIds.length > 0) {
    await supabase.from("shot_layers").delete().in("shot_id", oldShotIds);
    await supabase.from("shots").delete().in("id", oldShotIds);
  }

  const drafts: ShotDraft[] = [];
  beats.forEach((beat, beatIndex) => {
    drafts.push(...buildShotsForBeat(beat, ctx, beatIndex));
  });

  // 人物入场/出场：本章内角色首次出现的镜头淡入，最后一次出现的镜头淡出
  const firstBeatIdx = new Map<string, number>();
  const lastBeatIdx = new Map<string, number>();
  beats.forEach((beat) => {
    if (!beat.character_id) return;
    if (!firstBeatIdx.has(beat.character_id)) firstBeatIdx.set(beat.character_id, beat.idx);
    lastBeatIdx.set(beat.character_id, beat.idx);
  });
  for (const draft of drafts) {
    for (const layer of draft.layers) {
      if (layer.kind !== "character" || !layer.characterId) continue;
      if (draft.beatIdx === firstBeatIdx.get(layer.characterId)) layer.enter = "fade_in";
      if (draft.beatIdx === lastBeatIdx.get(layer.characterId)) layer.exit = "fade_out";
    }
  }

  const inserted: Array<{ id: string; draft: ShotDraft }> = [];
  for (const draft of drafts) {
    const { data: shot, error } = await supabase
      .from("shots")
      .insert({
        book_id: bookId,
        beat_id: draft.beatId,
        idx: draft.idx,
        description: draft.description,
        camera: draft.camera,
        duration_sec: draft.durationSec,
        transition_in: draft.transitionIn,
        transition_out: draft.transitionOut,
        background_asset_id: draft.backgroundAssetId,
        style: {},
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw error;

    const layers = draft.layers.map((layer, layerIdx) => ({
      shot_id: shot.id,
      idx: layerIdx,
      z: layerIdx,
      kind: layer.kind,
      character_id: layer.characterId,
      asset_id: layer.assetId,
      expression: layer.expression,
      rect: layer.rect,
      enter_animation: layer.enter,
      exit_animation: layer.exit,
      motion: layer.motion,
      locked: false,
    }));
    if (layers.length > 0) {
      await supabase.from("shot_layers").insert(layers);
    }
    inserted.push({ id: shot.id, draft });
  }

  const durationSec = Number(drafts.reduce((s, d) => s + d.durationSec, 0).toFixed(2));

  // 生成 preview 快照（渲染的唯一事实来源；预览 URL 用当前签名地址）
  const snapshot = {
    version: 1,
    kind: "preview",
    resolution: [1920, 1080],
    fps: 25,
    duration_sec: durationSec,
    tracks: drafts.map((d, i) => ({
      shotId: inserted[i]?.id,
      beatId: d.beatId,
      beatIdx: d.beatIdx,
      text: d.text,
      description: d.description,
      camera: d.camera,
      duration_sec: d.durationSec,
      transition_in: d.transitionIn,
      transition_out: d.transitionOut,
      background_url: d.backgroundAssetId
        ? [...ctx.backgrounds].find((b) => b.id === d.backgroundAssetId)?.url ?? null
        : null,
      background_asset_id: d.backgroundAssetId ?? null,
      layers: d.layers.map((layer) => {
        const asset = layer.assetId
          ? [...ctx.refsByCharacter.values(), ...ctx.expressionsByKey.values()].find((a) => a.id === layer.assetId)
          : null;
        return {
          kind: layer.kind,
          asset_id: layer.assetId ?? null,
          asset_url: asset?.url ?? null,
          text: layer.kind === "text" ? d.text : undefined,
          rect: layer.rect,
          enter: layer.enter,
          exit: layer.exit,
          motion: layer.motion,
        };
      }),
    })),
  };

  const { data: timeline, error: timelineError } = await supabase
    .from("timelines")
    .insert({
      book_id: bookId,
      kind: "preview",
      version: 1,
      duration_sec: durationSec,
      snapshot,
      status: "draft",
    })
    .select("id")
    .single();
  if (timelineError) throw timelineError;

  const resultShots = inserted.map(({ id, draft }) => ({
    id,
    beatIdx: draft.beatIdx,
    idx: draft.idx,
    description: draft.description,
    camera: draft.camera,
    durationSec: draft.durationSec,
    transitionIn: draft.transitionIn,
    transitionOut: draft.transitionOut,
    backgroundUrl:
      draft.backgroundAssetId != null
        ? ctx.backgrounds.find((b) => b.id === draft.backgroundAssetId)?.url ?? null
        : null,
    layers: draft.layers.map((layer) => ({
      id: `${id}:${layer.kind}`,
      kind: layer.kind,
      assetUrl: layer.assetId
        ? [...ctx.refsByCharacter.values(), ...ctx.expressionsByKey.values()].find((a) => a.id === layer.assetId)?.url ?? null
        : null,
      expression: layer.expression,
      rect: layer.rect,
      motion: layer.motion,
    })),
  }));

  return {
    adaptedChapterId: chapter.id,
    timelineId: timeline.id,
    durationSec,
    shots: resultShots,
  };
}

/** 签核 D：批准最新 preview timeline */
export async function approveStoryboard(bookId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: timeline } = await supabase
    .from("timelines")
    .select("id")
    .eq("book_id", bookId)
    .eq("kind", "preview")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!timeline) throw new Error("还没有 preview timeline，请先构建分镜");
  await supabase.from("timelines").update({ status: "approved" }).eq("id", timeline.id);
}

/** 人工微调：改 shot 时长/背景（写 locked，重跑分镜时保留） */
export async function updateShot(
  shotId: string,
  patch: { durationSec?: number; backgroundAssetId?: string | null },
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const payload: Record<string, unknown> = { style: { locked: true } };
  if (typeof patch.durationSec === "number" && patch.durationSec > 0) {
    payload.duration_sec = patch.durationSec;
  }
  if (patch.backgroundAssetId !== undefined) {
    payload.background_asset_id = patch.backgroundAssetId;
  }
  await supabase.from("shots").update(payload).eq("id", shotId);
}
