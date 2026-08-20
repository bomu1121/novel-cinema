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
      const { data: takeRows } = await s
        .from("voice_takes")
        .select("id, beat_id, voice_profile_id, status, asr_confidence, error, duration_ms, audio_asset_id")
        .in("beat_id", beatIds);
      voiceTakes = await Promise.all(
        ((takeRows ?? []) as any[]).map(async (t) => {
          let url: string | null = null;
          if (t.audio_asset_id) {
            const { data: asset } = await s
              .from("assets")
              .select("id, file_key, params")
              .eq("id", t.audio_asset_id)
              .single();
            if (asset) url = await resolveAssetUrl(asset);
          }
          return { ...t, url };
        }),
      );
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

  const estimateNodes: RerunNode[] = ["analyze", "adapt", "assets-phase1", "assets-phase2", "storyboard", "voice"];
  const estimates = Object.fromEntries(
    await Promise.all(
      estimateNodes.map(async (n) => [n, await estimateRerun(bookId, n).catch(() => "暂无法估算")]),
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
    estimates,
  };
}

/** 编辑中间态：先校验归属，再存快照，更新，最后向下游传播 stale */
export async function patchWorkbenchRow(
  bookId: string,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ snapshotId: string | null }> {
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

  // 撤销快照（I0）：保存修改前的完整行
  let snapshotId: string | null = null;
  const before = await s.from(table).select("*").eq("id", id).single();
  if (before.data) {
    const snap = await s
      .from("snapshots")
      .insert({ book_id: bookId, table_name: table, row_id: id, before_json: before.data })
      .select("id")
      .single();
    snapshotId = snap.data?.id ?? null;
  }

  const { error } = await s.from(table).update(patch).eq("id", id);
  if (error) {
    if (snapshotId) await s.from("snapshots").delete().eq("id", snapshotId);
    throw new Error(error.message ?? "更新失败");
  }
  await propagateStale(bookId, table, id);
  return { snapshotId };
}

/** 撤销最近一次编排修改（I0） */
export async function undoLatest(bookId: string): Promise<{ table: string; rowId: string }> {
  const s = getSupabaseAdmin();
  const { data: snap } = await s
    .from("snapshots")
    .select("id, table_name, row_id, before_json")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap) throw new Error("没有可撤销的操作");
  if (!EDITABLE_TABLES.has(snap.table_name)) throw new Error("快照表不可写");

  const before = snap.before_json as Record<string, unknown>;
  const rest = Object.fromEntries(
    Object.entries(before).filter(([key]) => key !== "id" && key !== "book_id"),
  );
  const { error } = await s.from(snap.table_name).update(rest).eq("id", snap.row_id);
  if (error) throw new Error(error.message ?? "恢复失败");
  await s.from("snapshots").delete().eq("id", snap.id);
  await propagateStale(bookId, snap.table_name, snap.row_id);
  return { table: snap.table_name, rowId: snap.row_id };
}

/** 单节点影响预报（I0：按按钮前让用户知道将发生什么） */
export async function estimateRerun(bookId: string, node: RerunNode): Promise<string> {
  const s = getSupabaseAdmin();
  switch (node) {
    case "analyze": {
      const { data: ch } = await s.from("source_chapters").select("char_count").eq("book_id", bookId).eq("idx", 1).single();
      const chars = ch?.char_count ?? 0;
      return `分析 1 章（${chars} 字）· 约 2 次 LLM 调用 · 30~60s · 生成 3 套风格候选`;
    }
    case "adapt": {
      const { data: ch } = await s.from("source_chapters").select("char_count").eq("book_id", bookId).eq("idx", 1).single();
      const chars = ch?.char_count ?? 0;
      return `改编 1 章（${chars} 字）· 约 2 次 LLM 调用 · 30~90s · 会覆盖现有 beats`;
    }
    case "assets-phase1": {
      const plan = await import("./assets").then((m) => m.listAssetPlan(bookId));
      const n = plan.phase1.filter((x) => !x.skipReason).length;
      return `生成 ${n} 张设定图/背景 · 每张 1 次图像调用 · 约 ${n * 20}s · 生成后需人工点选`;
    }
    case "assets-phase2": {
      const plan = await import("./assets").then((m) => m.listAssetPlan(bookId));
      const n = plan.phase2.filter((x) => !x.skipReason).length;
      return `生成 ${n} 张表情变体 · 每张 1 次图像调用（含参考图）· 约 ${n * 20}s`;
    }
    case "storyboard": {
      const { data: shots } = await s.from("shots").select("id").eq("book_id", bookId);
      return `零 AI 成本 · 重建 ${shots?.length ?? 0} 个镜头 · 约 3s · 会覆盖镜头与图层的手工修改（可撤销）`;
    }
    case "voice": {
      const { data: beats } = await s.from("beats").select("id").eq("book_id", bookId);
      const n = beats?.length ?? 0;
      return `为缺失的句子合成配音（当前 ${n} 句 beat）· 每句 1 次 TTS · 约 ${Math.max(10, n * 5)}s`;
    }
    default:
      return "未知节点";
  }
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
