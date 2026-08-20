/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseAdmin } from "@/lib/db";
import { resolveAssetUrl } from "@/lib/pipeline/nodes/assets";
import { analyzeChapter, persistChapterAnalysis, persistStyleProposals, proposeStyleBibles } from "@/lib/pipeline/nodes/analyze";
import { runAdaptation } from "@/lib/pipeline/nodes/adapt";
import { generateAssetPhase } from "@/lib/pipeline/nodes/assets";
import { buildStoryboard } from "@/lib/pipeline/nodes/storyboard";
import { generateVoiceTakes } from "@/lib/pipeline/nodes/voice";

const EDITABLE_TABLES = new Set([
  "source_chapters",
  "characters",
  "clues",
  "locations",
  "style_bibles",
  "adapted_chapters",
  "beats",
  "shots",
  "shot_layers",
  "voice_profiles",
  "voice_takes",
  "assets",
]);

/** 编排台：一次性拉取全书中间态 */
export async function getWorkbench(bookId: string) {
  const s = getSupabaseAdmin();
  const [bookRes, chaptersRes, charactersRes, cluesRes, locationsRes, styleRes, adaptedRes, assetsRes, profilesRes, timelineRes, jobsRes] =
    await Promise.all([
      s.from("books").select("id, title, status, total_chars, created_at").eq("id", bookId).single(),
      s.from("source_chapters").select("id, idx, title, char_count, status").eq("book_id", bookId).order("idx"),
      s.from("characters").select("id, canonical_name, aliases, role, description, bio, ref_asset_id, voice_profile_id, status").eq("book_id", bookId),
      s.from("clues").select("id, name, clue_type, description, is_red_herring, is_spoiler, status").eq("book_id", bookId),
      s.from("locations").select("id, name, visual_note, ref_asset_id, status").eq("book_id", bookId),
      s.from("style_bibles").select("id, version, status, visual_style, art_direction, narration_tone, camera_grammar, spoiler_rules, negative_prompt, proposal_json").eq("book_id", bookId).order("version", { ascending: false }).limit(1).maybeSingle(),
      s.from("adapted_chapters").select("id, source_chapter_id, title, hook, status, target_duration_sec, estimated_duration_sec, selection_report").eq("book_id", bookId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      s.from("assets").select("id, kind, title, prompt, character_id, expression, scene_key, status, file_key, params").eq("book_id", bookId).order("created_at", { ascending: false }),
      s.from("voice_profiles").select("id, name, role, character_id, provider_voice_id, defaults, status").eq("book_id", bookId),
      s.from("timelines").select("id, kind, version, status, duration_sec, created_at").eq("book_id", bookId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      s.from("render_jobs").select("id, scope, status, duration_sec, created_at, finished_at").eq("book_id", bookId).order("created_at", { ascending: false }).limit(5),
    ]);

  let beats: any[] = [];
  let shots: unknown[] = [];
  let layers: unknown[] = [];
  let voiceTakes: unknown[] = [];
  if (adaptedRes.data) {
    const { data: beatRows } = await s
      .from("beats")
      .select("id, idx, type, speaker_type, character_id, text, emotion, pace, visual_note, source_span, importance, clue_ids, flags, estimated_duration_sec, status")
      .eq("adapted_chapter_id", adaptedRes.data.id)
      .order("idx");
    beats = (beatRows ?? []) as any[];
    const beatIds = beats.map((b: { id: string }) => b.id);
    if (beatIds.length > 0) {
      const [takeRes] = await Promise.all([
        s.from("voice_takes").select("id, beat_id, voice_profile_id, status, asr_confidence, error, duration_ms").in("beat_id", beatIds),
      ]);
      voiceTakes = takeRes.data ?? [];
      const shotRows = await s.from("shots").select("id").in("beat_id", beatIds);
      const shotIds = (shotRows.data ?? []).map((r: { id: string }) => r.id);
      const [shotRes, layerRes] = await Promise.all([
        s.from("shots").select("id, beat_id, idx, description, camera, duration_sec, transition_in, transition_out, background_asset_id, status").in("beat_id", beatIds).order("idx"),
        shotIds.length > 0
          ? s.from("shot_layers").select("id, shot_id, idx, z, kind, character_id, asset_id, expression, rect, enter_animation, exit_animation, motion, opacity, locked").in("shot_id", shotIds)
          : Promise.resolve({ data: [] }),
      ]);
      shots = shotRes.data ?? [];
      layers = layerRes.data ?? [];
    }
  }

  const assetsWithUrls = await Promise.all(
    ((assetsRes.data ?? []) as Array<{ file_key: string | null; params: unknown; [k: string]: unknown }>).map(
      async (a) => ({ ...a, url: await resolveAssetUrl(a) }),
    ),
  );

  return {
    book: bookRes.data,
    chapters: chaptersRes.data ?? [],
    characters: charactersRes.data ?? [],
    clues: cluesRes.data ?? [],
    locations: locationsRes.data ?? [],
    styleBible: styleRes.data,
    adaptedChapter: adaptedRes.data,
    beats,
    shots,
    layers,
    voiceTakes,
    assets: assetsWithUrls,
    voiceProfiles: profilesRes.data ?? [],
    timeline: timelineRes.data,
    renderJobs: jobsRes.data ?? [],
  };
}

/** 编辑中间态：先校验归属，再更新，最后向下游传播 stale */
export async function patchWorkbenchRow(
  bookId: string,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!EDITABLE_TABLES.has(table)) throw new Error(`不允许编辑表: ${table}`);
  const s = getSupabaseAdmin();

  if (table === "shot_layers") {
    const { data: layer } = await s.from("shot_layers").select("shot_id").eq("id", id).single();
    if (!layer) throw new Error("图层不存在");
    const { data: shot } = await s.from("shots").select("book_id").eq("id", layer.shot_id).single();
    if (!shot || shot.book_id !== bookId) throw new Error("图层不属于本书");
  } else {
    const { data: row } = await s.from(table).select("book_id").eq("id", id).single();
    if (!row || row.book_id !== bookId) throw new Error("记录不属于本书");
  }

  const { error } = await s.from(table).update(patch).eq("id", id);
  if (error) throw new Error(error.message ?? "更新失败");
  await propagateStale(bookId, table, id);
}

async function propagateStale(bookId: string, table: string, id: string): Promise<void> {
  const s = getSupabaseAdmin();
  switch (table) {
    case "style_bibles":
    case "clues":
      await s.from("adapted_chapters").update({ status: "stale" }).eq("book_id", bookId);
      break;
    case "source_chapters":
      await s.from("adapted_chapters").update({ status: "stale" }).eq("source_chapter_id", id);
      break;
    case "characters": {
      await s.from("assets").update({ status: "stale" }).eq("character_id", id);
      const { data: beats } = await s.from("beats").select("id").eq("character_id", id);
      const beatIds = (beats ?? []).map((b: { id: string }) => b.id);
      if (beatIds.length > 0) await s.from("shots").update({ status: "stale" }).in("beat_id", beatIds);
      break;
    }
    case "adapted_chapters":
      await s.from("timelines").update({ status: "stale" }).eq("book_id", bookId);
      break;
    case "beats": {
      await s.from("shots").update({ status: "stale" }).eq("beat_id", id);
      await s.from("timelines").update({ status: "stale" }).eq("book_id", bookId);
      const { data: beat } = await s.from("beats").select("adapted_chapter_id").eq("id", id).single();
      if (beat) {
        await s.from("adapted_chapters").update({ status: "pending_review" }).eq("id", beat.adapted_chapter_id);
      }
      break;
    }
    case "shots":
    case "shot_layers":
    case "assets":
      await s.from("timelines").update({ status: "stale" }).eq("book_id", bookId);
      break;
    case "voice_profiles":
      await s.from("voice_takes").update({ status: "draft" }).eq("voice_profile_id", id);
      break;
    default:
      break;
  }
}

export type RerunNode = "analyze" | "adapt" | "assets-phase1" | "assets-phase2" | "storyboard" | "voice";

/** 单节点重跑（人工编排的核心操作） */
export async function rerunNode(bookId: string, node: RerunNode) {
  const s = getSupabaseAdmin();
  switch (node) {
    case "analyze": {
      const { data: chapter } = await s
        .from("source_chapters")
        .select("id, idx, title, cleaned_text")
        .eq("book_id", bookId)
        .eq("idx", 1)
        .single();
      if (!chapter) throw new Error("没有 idx=1 的章节");
      const analysis = await analyzeChapter(bookId, {
        id: chapter.id,
        idx: chapter.idx,
        title: chapter.title,
        cleanedText: chapter.cleaned_text,
      });
      await persistChapterAnalysis(bookId, chapter, analysis);
      const proposals = await proposeStyleBibles(bookId, analysis, null);
      const styleBibleId = await persistStyleProposals(bookId, proposals);
      return { styleBibleId, recommendedIndex: proposals.recommended_index };
    }
    case "adapt": {
      const { data: chapter } = await s
        .from("source_chapters")
        .select("id, idx, title, cleaned_text")
        .eq("book_id", bookId)
        .eq("idx", 1)
        .single();
      if (!chapter) throw new Error("没有 idx=1 的章节");
      const result = await runAdaptation(bookId, chapter);
      return { adaptedChapterId: result.adaptedChapterId, beats: result.adapt.beats.length };
    }
    case "assets-phase1":
    case "assets-phase2":
      return await generateAssetPhase(bookId, node === "assets-phase1" ? "phase1" : "phase2");
    case "storyboard":
      return await buildStoryboard(bookId);
    case "voice":
      return await generateVoiceTakes(bookId);
    default:
      throw new Error(`未知节点: ${node}`);
  }
}
