import { getSupabaseAdmin } from "@/lib/db";
import { completeJSON } from "@/lib/providers/llm";
import {
  buildAdaptPrompt,
  buildAdaptSystem,
  buildReviewPrompt,
  type AdaptContextInput,
} from "@/lib/pipeline/prompts/adapt";
import {
  adaptedChapterSchema,
  scriptReviewSchema,
  type AdaptedChapter,
  type Beat,
  type ScriptReview,
} from "@/lib/pipeline/schemas/adapt";

export interface SourceChapterForAdapt {
  id: string;
  idx: number;
  title: string | null;
  cleanedText: string;
}

export interface AdaptRunResult {
  adaptedChapterId: string;
  adapt: AdaptedChapter;
  review: ScriptReview;
  context: {
    targetSec: number;
    characterNames: string[];
    clueNames: string[];
  };
}

/** 单章时长预算：3000 字基准 180s，线性缩放，夹在 60~600s */
export function targetDurationForChapter(charCount: number): number {
  return Math.round(Math.min(600, Math.max(60, (charCount / 3000) * 180)));
}

export function estimateBeatDuration(beat: Beat): number {
  const textLen = beat.text.replace(/\s/g, "").length;
  const spokenSec = (textLen / 4.5) * beat.pace;
  switch (beat.type) {
    case "dialogue":
      return Math.min(8, Math.max(2.5, spokenSec + 0.8));
    case "narration":
      return Math.min(8, Math.max(2, spokenSec));
    case "insert_card":
      return Math.min(5, Math.max(3, spokenSec));
    case "action":
    case "montage":
      return Math.min(6, Math.max(3, spokenSec));
    case "transition":
      return Math.min(1.5, spokenSec);
    default:
      return Math.max(1, spokenSec);
  }
}

function normalizeForMatch(text: string): string {
  return text.replace(/[\s\u3000]/g, "");
}

interface StyleBibleForAdapt {
  visual_style: string;
  narration_tone: string;
  camera_grammar: Record<string, unknown>;
  spoiler_rules: unknown; // DB 里是 jsonb（{rules: string[]} 或数组）
  negative_prompt: unknown;
}

interface LoadedContext {
  input: AdaptContextInput;
  characterIdByName: Map<string, string>;
  clueIdByName: Map<string, string>;
}

async function loadAdaptContext(
  bookId: string,
  chapter: SourceChapterForAdapt,
): Promise<LoadedContext> {
  const supabase = getSupabaseAdmin();

  const [charRes, clueRes, summaryRes, styleRes] = await Promise.all([
    supabase
      .from("characters")
      .select("id, canonical_name, aliases, role, description")
      .eq("book_id", bookId),
    supabase.from("clues").select("id, name, description, is_spoiler, is_red_herring").eq("book_id", bookId),
    supabase
      .from("chapter_summaries")
      .select("source_chapter_id, summary")
      .eq("book_id", bookId),
    supabase
      .from("style_bibles")
      .select("visual_style, narration_tone, camera_grammar, spoiler_rules, negative_prompt, status")
      .eq("book_id", bookId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const characters = (charRes.data ?? []) as Array<{
    id: string;
    canonical_name: string;
    aliases: string[];
    role: string;
    description: string | null;
  }>;
  const clues = (clueRes.data ?? []) as Array<{
    id: string;
    name: string;
    description: string;
    is_spoiler: boolean;
    is_red_herring: boolean;
  }>;
  const summaries = (summaryRes.data ?? []) as Array<{ source_chapter_id: string; summary: string }>;

  const characterIdByName = new Map<string, string>();
  for (const c of characters) {
    characterIdByName.set(c.canonical_name, c.id);
    for (const alias of c.aliases ?? []) characterIdByName.set(alias, c.id);
  }
  const clueIdByName = new Map<string, string>();
  for (const c of clues) clueIdByName.set(c.name, c.id);

  const previousSummaries = summaries
    .filter((s) => {
      // M0 没有 join 原章序号，粗略按“非本章”过滤；跨章续接在 M1 用 idx 关联
      return s.source_chapter_id !== chapter.id;
    })
    .slice(-3)
    .map((s) => s.summary);

  const styleRaw = (styleRes.data ?? null) as (StyleBibleForAdapt & { status: string }) | null;

  const rawSpoilerRules = styleRaw?.spoiler_rules;
  const spoilerRules = Array.isArray(rawSpoilerRules)
    ? rawSpoilerRules.map(String)
    : typeof rawSpoilerRules === "object" && rawSpoilerRules !== null
      ? (((rawSpoilerRules as { rules?: unknown }).rules ?? []) as unknown[])
          .map(String)
      : [];

  const styleBible = styleRaw
    ? {
        visual_style: styleRaw.visual_style,
        narration_tone: styleRaw.narration_tone,
        camera_grammar: styleRaw.camera_grammar ?? {},
        spoiler_rules: spoilerRules,
        negative_prompt:
          typeof styleRaw.negative_prompt === "string"
            ? styleRaw.negative_prompt
            : String(styleRaw.negative_prompt ?? ""),
      }
    : null;

  const input: AdaptContextInput = {
    chapterIdx: chapter.idx,
    chapterTitle: chapter.title,
    chapterText: chapter.cleanedText,
    targetSec: targetDurationForChapter(chapter.cleanedText.replace(/\s/g, "").length),
    characters: characters.map((c) => ({
      name: c.canonical_name,
      aliases: c.aliases ?? [],
      description: c.description,
      role: c.role,
    })),
    clues: clues.map((c) => ({
      name: c.name,
      description: c.description,
      is_spoiler: c.is_spoiler,
      is_red_herring: c.is_red_herring,
    })),
    previousSummaries,
    styleBible,
  };

  return { input, characterIdByName, clueIdByName };
}

/** 确定性校验：预算 / 原文出处 / 人物白名单 / 旁白长度 */
export function validateAdaptation(
  input: AdaptContextInput,
  adapt: AdaptedChapter,
): string[] {
  const errors: string[] = [];
  const chapterText = normalizeForMatch(input.chapterText);
  const allowed = new Set(
    input.characters.flatMap((c) => [c.name, ...(c.aliases ?? [])]),
  );

  const total = adapt.beats.reduce((sum, b) => sum + b.estimated_duration_sec, 0);
  if (total > input.targetSec * 1.1) {
    errors.push(
      `总时长 ${total.toFixed(1)}s 超过预算 ${input.targetSec}s 的 110%，请删减或合并 beat`,
    );
  }

  adapt.beats.forEach((beat, i) => {
    if (beat.idx !== i) {
      errors.push(`beat[${i}].idx 应为 ${i}，实际 ${beat.idx}`);
    }
    const span = beat.source_span;
    if (span.start_char < 0 || span.end_char > input.chapterText.length || span.end_char <= span.start_char) {
      errors.push(`beat[${i}] source_span 越界（${span.start_char},${span.end_char}）`);
    } else {
      const spanText = normalizeForMatch(input.chapterText.slice(span.start_char, span.end_char));
      const quote = normalizeForMatch(span.quote);
      if (!spanText.includes(quote) && !chapterText.includes(quote)) {
        errors.push(`beat[${i}] source_span.quote 无法在原文中定位`);
      }
    }
    if (beat.speaker_type === "character" && (!beat.character_name || !allowed.has(beat.character_name))) {
      errors.push(`beat[${i}] 说话人 "${beat.character_name ?? ""}" 不在人物白名单`);
    }
    if (beat.type === "narration" && beat.text.replace(/\s/g, "").length > 40) {
      errors.push(`beat[${i}] 旁白超过 8 秒朗读上限（约 40 字）`);
    }
  });

  return errors;
}

/** C10：改编 + 语义校验重试 + C20 自检 */
export async function runAdaptation(
  bookId: string,
  chapter: SourceChapterForAdapt,
): Promise<AdaptRunResult> {
  const { input, characterIdByName, clueIdByName } = await loadAdaptContext(bookId, chapter);
  const system = buildAdaptSystem(input.targetSec);

  let adapt: AdaptedChapter | null = null;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = lastErrors.length
      ? `${buildAdaptPrompt(input)}\n\n【上次输出被规则校验拒绝，请修正以下问题后重新输出】\n${lastErrors.map((e) => `- ${e}`).join("\n")}`
      : buildAdaptPrompt(input);

    const result = await completeJSON({
      system,
      prompt,
      schema: adaptedChapterSchema,
      tier: "strong",
      temperature: 0.5,
      maxTokens: 8000,
      bookId,
      node: "adapt.chapter",
      maxAttempts: 2,
    });

    const errors = validateAdaptation(input, result.data);
    if (errors.length === 0) {
      adapt = result.data;
      break;
    }
    lastErrors = errors;
  }

  if (!adapt) {
    throw new Error(`改编校验连续失败：\n${lastErrors.join("\n")}`);
  }

  const reviewResult = await completeJSON({
    system: "你是审片员，只输出 JSON。",
    prompt: buildReviewPrompt(
      chapter.idx,
      chapter.cleanedText,
      adapt.beats.map((b) => ({
        idx: b.idx,
        text: b.text,
        type: b.type,
        character_name: b.character_name,
      })),
      input.clues.map((c) => c.name),
    ),
    schema: scriptReviewSchema,
    tier: "strong",
    temperature: 0.2,
    maxTokens: 3000,
    bookId,
    node: "review.script",
  });

  const adaptedChapterId = await persistAdaptation(
    bookId,
    chapter.id,
    adapt,
    characterIdByName,
    clueIdByName,
    input.targetSec,
  );

  return {
    adaptedChapterId,
    adapt,
    review: reviewResult.data,
    context: {
      targetSec: input.targetSec,
      characterNames: [...characterIdByName.keys()],
      clueNames: [...clueIdByName.keys()],
    },
  };
}

async function persistAdaptation(
  bookId: string,
  sourceChapterId: string,
  adapt: AdaptedChapter,
  characterIdByName: Map<string, string>,
  clueIdByName: Map<string, string>,
  targetSec: number,
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("adapted_chapters")
    .select("id")
    .eq("source_chapter_id", sourceChapterId)
    .maybeSingle();

  const payload = {
    book_id: bookId,
    source_chapter_id: sourceChapterId,
    idx: 1,
    title: adapt.title,
    hook: adapt.hook,
    status: "pending_review" as const,
    model: "deepseek-chat",
    target_duration_sec: targetSec,
    estimated_duration_sec: adapt.beats.reduce((s, b) => s + b.estimated_duration_sec, 0),
    importance: 1.0,
    selection_report: adapt.selection_report,
    raw_output: adapt,
  };

  let adaptedChapterId: string;
  if (existing) {
    adaptedChapterId = existing.id;
    await supabase.from("adapted_chapters").update(payload).eq("id", existing.id);
    await supabase.from("beats").delete().eq("adapted_chapter_id", existing.id);
  } else {
    const { data: created, error } = await supabase
      .from("adapted_chapters")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    adaptedChapterId = created.id;
  }

  const rows = adapt.beats.map((b) => ({
    book_id: bookId,
    adapted_chapter_id: adaptedChapterId,
    idx: b.idx,
    type: b.type,
    speaker_type: b.speaker_type,
    character_id: b.character_name ? characterIdByName.get(b.character_name) ?? null : null,
    text: b.text,
    emotion: b.emotion,
    pace: b.pace,
    visual_note: b.visual_note,
    source_span: b.source_span,
    importance: b.importance,
    clue_ids: b.clue_names.map((n) => clueIdByName.get(n)).filter(Boolean),
    flags: b.flags,
    estimated_duration_sec: b.estimated_duration_sec,
    status: "draft" as const,
  }));

  const { error: beatsError } = await supabase.from("beats").insert(rows);
  if (beatsError) throw beatsError;
  return adaptedChapterId;
}

export async function approveAdaptedChapter(adaptedChapterId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("adapted_chapters")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", adaptedChapterId);
}

export async function updateBeat(
  beatId: string,
  patch: Partial<Pick<Beat, "text" | "emotion" | "pace" | "visual_note">>,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("beats").update(patch).eq("id", beatId);
}

/** 供审校台加载：最新一章的脚本 + beats + 自检留档 */
export async function getLatestScript(bookId: string) {
  const supabase = getSupabaseAdmin();
  const { data: chapter } = await supabase
    .from("adapted_chapters")
    .select("id, title, hook, status, target_duration_sec, estimated_duration_sec, selection_report, model, reviewed_at")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!chapter) return { chapter: null, beats: [] };

  const { data: beats } = await supabase
    .from("beats")
    .select("id, idx, type, speaker_type, character_id, text, emotion, pace, visual_note, source_span, importance, flags, estimated_duration_sec, status")
    .eq("adapted_chapter_id", chapter.id)
    .order("idx");

  return { chapter, beats: beats ?? [] };
}
