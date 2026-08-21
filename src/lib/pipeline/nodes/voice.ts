import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/db";
import { createCheckpoint } from "@/lib/checkpoints";
import { JobCancelledError, NOOP_REPORTER, type ProgressReporter } from "@/lib/jobs/types";
import { r2Put } from "@/lib/r2";
import { charSimilarity, isASRConfigured, transcribe } from "@/lib/providers/asr";
import { getTTSProvider } from "@/lib/providers/tts";
import { resolveAssetUrl } from "@/lib/pipeline/nodes/assets";

const DEFAULT_SPEAKER = "zh_female_vv_uranus_bigtts";

/** 情绪 → TTS 参数（在 beat.pace 基础上叠加） */
const EMOTION_TTS: Record<string, { rate: number; pitch: number }> = {
  neutral: { rate: 0, pitch: 0 },
  calm: { rate: -5, pitch: -1 },
  happy: { rate: 10, pitch: 2 },
  sad: { rate: -10, pitch: -2 },
  angry: { rate: 10, pitch: 2 },
  fear: { rate: 15, pitch: 2 },
  surprise: { rate: 10, pitch: 3 },
  suspicious: { rate: -5, pitch: -1 },
  nervous: { rate: 15, pitch: 0 },
  pain: { rate: -10, pitch: -2 },
  determined: { rate: 5, pitch: 1 },
  whisper: { rate: -15, pitch: -2 },
};

interface VoiceProfileRow {
  id: string;
  role: string;
  character_id: string | null;
  provider_voice_id: string;
  defaults: { pitch_offset?: number } | null;
}

interface BeatRow {
  id: string;
  idx: number;
  speaker_type: string;
  character_id: string | null;
  text: string;
  emotion: string;
  pace: number;
}

interface VoiceTakeRow {
  id: string;
  beat_id: string;
  voice_profile_id: string;
  duration_ms: number | null;
  asr_text: string | null;
  asr_confidence: number | null;
  status: string;
  error: { message?: string } | null;
  audio_asset_id: string | null;
}

/** 建配音表：旁白 1 个 + 每角色 1 个，voice_id 跨章锁定 */
export async function ensureVoiceProfiles(bookId: string): Promise<{
  narrator: VoiceProfileRow;
  byCharacter: Map<string, VoiceProfileRow>;
}> {
  const supabase = getSupabaseAdmin();

  const narratorSpeaker = process.env.TTS_NARRATOR_SPEAKER || DEFAULT_SPEAKER;
  const extraSpeakers = (process.env.TTS_CHARACTER_SPEAKERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // 旁白
  let narrator = await getProfile(supabase, bookId, "narrator", null);
  if (!narrator) {
    const { data } = await supabase
      .from("voice_profiles")
      .insert({
        book_id: bookId,
        name: "旁白",
        role: "narrator",
        provider: "volcengine",
        provider_voice_id: narratorSpeaker,
        defaults: {},
        status: "draft",
      })
      .select("id, role, character_id, provider_voice_id, defaults")
      .single();
    narrator = data as VoiceProfileRow;
  }

  // 角色
  const { data: charRows } = await supabase
    .from("characters")
    .select("id, canonical_name")
    .eq("book_id", bookId);
  const byCharacter = new Map<string, VoiceProfileRow>();
  for (const [i, ch] of ((charRows ?? []) as Array<{ id: string; canonical_name: string }>).entries()) {
    let profile = await getProfile(supabase, bookId, "character", ch.id);
    if (!profile) {
      const speaker = extraSpeakers.length > 0
        ? extraSpeakers[i % extraSpeakers.length]
        : narratorSpeaker;
      const pitchOffset = extraSpeakers.length > 0 ? 0 : i % 2 === 0 ? 2 : -2;
      const { data } = await supabase
        .from("voice_profiles")
        .insert({
          book_id: bookId,
          name: ch.canonical_name,
          role: "character",
          character_id: ch.id,
          provider: "volcengine",
          provider_voice_id: speaker,
          defaults: { pitch_offset: pitchOffset },
          status: "draft",
        })
        .select("id, role, character_id, provider_voice_id, defaults")
        .single();
      profile = data as VoiceProfileRow;
    }
    byCharacter.set(ch.id, profile);
  }

  return { narrator, byCharacter };
}

async function getProfile(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  bookId: string,
  role: string,
  characterId: string | null,
): Promise<VoiceProfileRow | null> {
  let query = supabase
    .from("voice_profiles")
    .select("id, role, character_id, provider_voice_id, defaults")
    .eq("book_id", bookId)
    .eq("role", role);
  query = characterId ? query.eq("character_id", characterId) : query.is("character_id", null);
  const { data } = await query.maybeSingle();
  return (data as VoiceProfileRow) ?? null;
}

function speechParams(beat: BeatRow, profile: VoiceProfileRow): {
  speechRate: number;
  pitchRate: number;
} {
  const emotion = EMOTION_TTS[beat.emotion] ?? EMOTION_TTS.neutral;
  const paceRate = Math.round((Number(beat.pace) - 1) * 100);
  return {
    speechRate: Math.max(-50, Math.min(100, emotion.rate + paceRate)),
    pitchRate: Math.max(
      -12,
      Math.min(12, emotion.pitch + (profile.defaults?.pitch_offset ?? 0)),
    ),
  };
}

/** V10：为最新一章缺失的 beat 逐句合成（已有 take 的 beat 跳过） */
export async function generateVoiceTakes(
  bookId: string,
  reporter?: ProgressReporter,
): Promise<{ generated: number; skipped: number; errors: string[] }> {
  const r = reporter ?? NOOP_REPORTER;
  const supabase = getSupabaseAdmin();
  const { data: chapter } = await supabase
    .from("adapted_chapters")
    .select("id")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!chapter) throw new Error("还没有改编脚本");

  const { data: beatRows } = await supabase
    .from("beats")
    .select("id, idx, speaker_type, character_id, text, emotion, pace")
    .eq("adapted_chapter_id", chapter.id)
    .order("idx");
  const beats = (beatRows ?? []) as BeatRow[];

  const { narrator, byCharacter } = await ensureVoiceProfiles(bookId);
  const tts = getTTSProvider();
  let generated = 0;
  let skipped = 0;
  const errors: string[] = [];
  let done = 0;

  for (const beat of beats) {
    if (beat.speaker_type !== "narrator" && beat.speaker_type !== "character") continue;

    r.step(`合成第 ${done + 1}/${beats.length} 句`, done + 1, beats.length);
    if (r.checkCancelled()) throw new JobCancelledError();

    const { data: existing } = await supabase
      .from("voice_takes")
      .select("id")
      .eq("beat_id", beat.id)
      .limit(1)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      done += 1;
      r.progress(done / beats.length);
      continue;
    }

    const profile =
      beat.speaker_type === "narrator" ? narrator : byCharacter.get(beat.character_id ?? "") ?? narrator;
    const params = speechParams(beat, profile);

    try {
      const result = await tts.synthesize({
        text: beat.text,
        speaker: profile.provider_voice_id,
        speechRate: params.speechRate,
        pitchRate: params.pitchRate,
      });

      const takeId = randomUUID();
      let fileKey: string | null = null;
      let assetParams: Record<string, unknown> = {};
      try {
        fileKey = `book/${bookId}/voice/${takeId}.mp3`;
        await r2Put(fileKey, result.audio, "audio/mpeg");
      } catch {
        assetParams = { dataBase64: Buffer.from(result.audio).toString("base64") };
        fileKey = null;
      }

      const { data: audioAsset, error: assetError } = await supabase
        .from("assets")
        .insert({
          book_id: bookId,
          kind: "voice_sample",
          title: `beat_${beat.idx}`,
          provider: "volcengine",
          model: process.env.TTS_RESOURCE_ID || "seed-tts-2.0",
          params: assetParams,
          file_key: fileKey,
          mime_type: "audio/mpeg",
          file_size_bytes: result.audio.byteLength,
          source: "generated",
          status: "approved", // 音频不需要二次点选，ASR 校验后直接可用
          is_candidate: false,
        })
        .select("id")
        .single();
      if (assetError || !audioAsset) throw assetError ?? new Error("创建音频资产失败");

      let asrText: string | null = null;
      let asrConfidence: number | null = null;
      let takeError: unknown = null;
      if (isASRConfigured()) {
        try {
          asrText = await transcribe(result.audio, `${takeId}.mp3`);
          asrConfidence = Number(charSimilarity(beat.text, asrText).toFixed(3));
          if (asrConfidence < 0.85) {
            takeError = {
              asr_mismatch: true,
              message: `ASR 相似度 ${asrConfidence} 低于 0.85，建议重录`,
            };
          }
        } catch (err) {
          asrText = null;
          asrConfidence = null;
          takeError = { message: err instanceof Error ? err.message : String(err) };
        }
      }

      await supabase.from("voice_takes").insert({
        book_id: bookId,
        beat_id: beat.id,
        voice_profile_id: profile.id,
        provider: "volcengine",
        model: process.env.TTS_RESOURCE_ID || "seed-tts-2.0",
        params,
        audio_asset_id: audioAsset.id,
        duration_ms: Math.round((beat.text.replace(/\s/g, "").length / 4.5) * 1000 * Number(beat.pace)),
        asr_text: asrText,
        asr_confidence: asrConfidence,
        status: takeError ? "draft" : "accepted",
        error: takeError,
      });
      generated += 1;
    } catch (err) {
      errors.push(`beat#${beat.idx}: ${err instanceof Error ? err.message : String(err)}`);
    }
    done += 1;
    r.progress(done / beats.length);
  }

  return { generated, skipped, errors };
}

/** 签核 E 前的单句重录 */
export async function regenerateTake(bookId: string, takeId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: take } = await supabase
    .from("voice_takes")
    .select("id, beat_id, voice_profile_id, audio_asset_id")
    .eq("id", takeId)
    .eq("book_id", bookId)
    .single();
  if (!take) throw new Error("take 不存在");

  const [{ data: beat }, { data: profile }] = await Promise.all([
    supabase
      .from("beats")
      .select("id, idx, text, emotion, pace, character_id")
      .eq("id", take.beat_id)
      .single(),
    supabase
      .from("voice_profiles")
      .select("id, provider_voice_id, defaults")
      .eq("id", take.voice_profile_id)
      .single(),
  ]);
  if (!beat || !profile) throw new Error("beat 或 voice_profile 缺失");

  const tts = getTTSProvider();
  const params = speechParams(
    beat as BeatRow,
    { ...(profile as VoiceProfileRow), id: take.voice_profile_id, role: "character", character_id: beat.character_id },
  );
  const result = await tts.synthesize({
    text: beat.text,
    speaker: (profile as VoiceProfileRow).provider_voice_id,
    speechRate: params.speechRate,
    pitchRate: params.pitchRate,
  });

  let fileKey: string | null = `book/${bookId}/voice/${takeId}.mp3`;
  let assetParams: Record<string, unknown> = {};
  try {
    await r2Put(fileKey, result.audio, "audio/mpeg");
  } catch {
    assetParams = { dataBase64: Buffer.from(result.audio).toString("base64") };
    fileKey = null;
  }

  await supabase
    .from("assets")
    .update({ file_key: fileKey, params: assetParams, file_size_bytes: result.audio.byteLength })
    .eq("id", take.audio_asset_id);

  let asrText: string | null = null;
  let asrConfidence: number | null = null;
  let takeError: unknown = null;
  if (isASRConfigured()) {
    try {
      asrText = await transcribe(result.audio, `${takeId}.mp3`);
      asrConfidence = Number(charSimilarity(beat.text, asrText).toFixed(3));
      if (asrConfidence < 0.85) {
        takeError = { asr_mismatch: true, message: `ASR 相似度 ${asrConfidence}` };
      }
    } catch (err) {
      takeError = { message: err instanceof Error ? err.message : String(err) };
    }
  }

  await supabase
    .from("voice_takes")
    .update({
      params,
      asr_text: asrText,
      asr_confidence: asrConfidence,
      status: takeError ? "draft" : "accepted",
      error: takeError,
    })
    .eq("id", takeId);
}

/** 签核 E 列表：最新一章 beats + takes + 可播放 URL */
export async function listVoiceTakes(bookId: string) {
  const supabase = getSupabaseAdmin();
  const { data: chapter } = await supabase
    .from("adapted_chapters")
    .select("id, title")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!chapter) return { chapter: null, rows: [] };

  const [{ data: beatRows }, { data: takeRowsAll }] = await Promise.all([
    supabase
      .from("beats")
      .select("id, idx, speaker_type, text, emotion, pace")
      .eq("adapted_chapter_id", chapter.id)
      .order("idx"),
    supabase
      .from("voice_takes")
      .select(
        "id, beat_id, voice_profile_id, duration_ms, asr_text, asr_confidence, status, error, audio_asset_id",
      )
      .eq("book_id", bookId),
  ]);

  const chapterBeatIds = new Set(
    ((beatRows ?? []) as Array<{ id: string }>).map((b) => b.id),
  );
  const takeRows = ((takeRowsAll ?? []) as VoiceTakeRow[]).filter((t) =>
    chapterBeatIds.has(t.beat_id),
  );

  const takesByBeat = new Map<string, VoiceTakeRow>();
  for (const t of takeRows) {
    takesByBeat.set(t.beat_id, t);
  }

  const rows = [];
  for (const beat of (beatRows ?? []) as BeatRow[]) {
    const take = takesByBeat.get(beat.id);
    let url: string | null = null;
    if (take?.audio_asset_id) {
      const { data: asset } = await supabase
        .from("assets")
        .select("id, file_key, params")
        .eq("id", take.audio_asset_id)
        .single();
      if (asset) url = await resolveAssetUrl(asset);
    }
    rows.push({ beat, take: take ?? null, url });
  }
  return { chapter, rows };
}

/** 一键批准（把 draft → accepted；带 ASR 红项的不动） */
export async function approveVoiceTakes(bookId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: chapter } = await supabase
    .from("adapted_chapters")
    .select("id")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!chapter) return;
  const { data: beatRows } = await supabase
    .from("beats")
    .select("id")
    .eq("adapted_chapter_id", chapter.id);
  const beatIds = (beatRows ?? []).map((b: { id: string }) => b.id);

  // 签核点：批准配音前快照将被改动的 take 行
  const { data: takes } = await supabase
    .from("voice_takes")
    .select("*")
    .in("beat_id", beatIds)
    .is("error", null);
  if ((takes ?? []).length > 0) {
    createCheckpoint(
      bookId,
      `批准配音（${(takes ?? []).length} 句）`,
      "approve",
      "approve:voice",
      ((takes ?? []) as Array<Record<string, unknown>>).map((t) => ({
        table: "voice_takes",
        rowId: t.id as string,
        before: t,
        op: "update" as const,
      })),
    );
  }

  await supabase
    .from("voice_takes")
    .update({ status: "accepted" })
    .in("beat_id", beatIds)
    .is("error", null);
}
