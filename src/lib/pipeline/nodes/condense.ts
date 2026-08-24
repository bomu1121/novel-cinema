import { getSupabaseAdmin } from "@/lib/db";
import { createCheckpoint } from "@/lib/checkpoints";
import { JobCancelledError, NOOP_REPORTER, type ProgressReporter } from "@/lib/jobs/types";
import { completeJSON } from "@/lib/providers/llm";
import {
  buildCondensePrompt,
  buildCondenseSystem,
  condenseParagraphsToText,
  CONDENSE_OUTPUT_BUDGET_HINT,
  type CondenseContextInput,
} from "@/lib/pipeline/prompts/condense";
import {
  condensedChapterSchema,
  type CondensedChapter,
} from "@/lib/pipeline/schemas/condense";

export interface ChapterForCondense {
  id: string;
  idx: number;
  title: string | null;
  cleanedText: string;
}

export const DEFAULT_CONDENSE_RATIO = 0.35;

/** 精简字数预算：默认 35%，夹在 400~6000 字（M0 单章规模） */
export function targetCharsForSource(sourceChars: number, ratio = DEFAULT_CONDENSE_RATIO): number {
  const safeRatio = Math.min(0.6, Math.max(0.2, ratio));
  return Math.min(6000, Math.max(400, Math.round(sourceChars * safeRatio)));
}

function normalizeForMatch(text: string): string {
  return text.replace(/[\s\u3000]/g, "");
}

/** 归一化偏移 → 原文偏移（跳过空白；找不到返回 [-1,-1]） */
function mapNormalizedToRaw(raw: string, normStart: number, normLen: number): [number, number] {
  let normPos = 0;
  let rawStart = -1;
  let rawEnd = -1;
  for (let i = 0; i < raw.length; i++) {
    if (/[\s\u3000]/.test(raw[i])) continue;
    if (normPos === normStart) rawStart = i;
    if (normPos === normStart + normLen - 1) {
      rawEnd = i + 1;
      break;
    }
    normPos++;
  }
  return [rawStart, rawEnd];
}

/** 找出 quote 中最长的、能逐字出现在原文归一化文本里的片段 */
function longestVerbatimFragment(norm: string, quote: string): string {
  const minLen = 4;
  const maxLen = Math.min(quote.length, 120);
  for (let len = maxLen; len >= minLen; len--) {
    for (let start = 0; start + len <= quote.length; start++) {
      const sub = quote.slice(start, start + len);
      if (norm.includes(sub)) return sub;
    }
  }
  return "";
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  const idxs: number[] = [];
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    idxs.push(i);
    from = i + 1;
  }
  return idxs;
}

/**
 * 确定性修复 source_spans（与 adapt 的 repairSourceSpans 同思路）：
 * 模型给出的 quote 经常是“压缩转述”，并非逐字原文；这里用原文中能找到的最长逐字片段
 * 重新定位 start/end 并把 quote 替换成真正的原文切片。返回修复条数。
 */
export function repairCondenseSpans(chapterText: string, result: CondensedChapter): number {
  const norm = normalizeForMatch(chapterText);
  let repaired = 0;
  for (const p of result.paragraphs) {
    for (const span of p.source_spans) {
      const q = normalizeForMatch(span.quote);
      if (q && norm.includes(q)) continue;
      const frag = longestVerbatimFragment(norm, q);
      if (!frag) continue;

      const occurrences = findAllOccurrences(norm, frag);
      const targetRaw = span.start_char;
      let bestStart = -1;
      let bestEnd = -1;
      let bestDist = Infinity;
      for (const idx of occurrences) {
        const [start, end] = mapNormalizedToRaw(chapterText, idx, frag.length);
        if (start < 0) continue;
        const dist = Math.abs(start - targetRaw);
        if (dist < bestDist) {
          bestDist = dist;
          bestStart = start;
          bestEnd = end;
        }
      }
      if (bestStart >= 0 && bestEnd > bestStart) {
        span.start_char = bestStart;
        span.end_char = bestEnd;
        span.quote = chapterText.slice(bestStart, bestEnd);
        repaired++;
      }
    }
  }
  return repaired;
}

interface LoadedCondenseContext {
  input: CondenseContextInput;
}

async function loadCondenseContext(
  bookId: string,
  chapter: ChapterForCondense,
  ratio: number,
): Promise<LoadedCondenseContext> {
  const supabase = getSupabaseAdmin();
  const sourceChars = chapter.cleanedText.replace(/\s/g, "").length;
  const targetChars = targetCharsForSource(sourceChars, ratio);

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
      .select("visual_style, narration_tone, spoiler_rules, status")
      .eq("book_id", bookId)
      .eq("status", "approved")
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

  const styleRaw = styleRes.data as
    | { visual_style: string; narration_tone: string; spoiler_rules: unknown }
    | null;
  const rawSpoilerRules = styleRaw?.spoiler_rules;
  const spoilerRules = Array.isArray(rawSpoilerRules)
    ? rawSpoilerRules.map(String)
    : typeof rawSpoilerRules === "object" && rawSpoilerRules !== null
      ? (((rawSpoilerRules as { rules?: unknown }).rules ?? []) as unknown[]).map(String)
      : [];

  const previousSummaries = summaries
    .filter((s) => s.source_chapter_id !== chapter.id)
    .slice(-3)
    .map((s) => s.summary);

  const input: CondenseContextInput = {
    chapterIdx: chapter.idx,
    chapterTitle: chapter.title,
    chapterText: chapter.cleanedText,
    sourceChars,
    targetChars,
    ratio,
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
    styleBible: styleRaw
      ? {
          visual_style: styleRaw.visual_style,
          narration_tone: styleRaw.narration_tone,
          spoiler_rules: spoilerRules,
        }
      : null,
  };

  return { input };
}

/** 确定性校验：字数预算 / source_spans 原文定位 / 段落序号 */
export function validateCondensation(
  chapterText: string,
  targetChars: number,
  result: CondensedChapter,
): string[] {
  const errors: string[] = [];
  const totalChars = result.paragraphs.reduce((sum, p) => sum + p.text.replace(/\s/g, "").length, 0);
  if (totalChars > targetChars * 1.15) {
    errors.push(`精简后 ${totalChars} 字超过预算 ${targetChars} 字的 115%，请继续删减`);
  }
  if (totalChars < targetChars * 0.6) {
    errors.push(`精简后 ${totalChars} 字不足预算 ${targetChars} 字的 60%，删减过狠，请保留更多可拍摄内容`);
  }

  const normalized = normalizeForMatch(chapterText);
  result.paragraphs.forEach((p, i) => {
    if (p.idx !== i) errors.push(`paragraphs[${i}].idx 应为 ${i}，实际 ${p.idx}`);
    for (const span of p.source_spans) {
      if (span.start_char < 0 || span.end_char > chapterText.length || span.end_char <= span.start_char) {
        errors.push(`paragraphs[${i}] 的 source_span 越界（${span.start_char},${span.end_char}）`);
        continue;
      }
      const quote = normalizeForMatch(span.quote);
      const spanText = normalizeForMatch(chapterText.slice(span.start_char, span.end_char));
      if (!spanText.includes(quote) && !normalized.includes(quote)) {
        errors.push(`paragraphs[${i}] 的 source_span.quote 无法在原文中逐字定位`);
      }
    }
  });

  return errors;
}

export class CondensationValidationError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly lastResult: CondensedChapter | null,
  ) {
    super(`精简校验连续失败：${errors.length} 项`);
    this.name = "CondensationValidationError";
  }
}

export interface CondenseRunResult {
  id: string;
  title: string;
  condensedText: string;
  sourceChars: number;
  targetChars: number;
  report: CondensedChapter["report"];
}

/** condense.chapter：生成视频向精简底稿（带确定性校验重试），幂等覆盖旧稿 */
export async function runCondensation(
  bookId: string,
  chapter: ChapterForCondense,
  reporter?: ProgressReporter,
  ratio = DEFAULT_CONDENSE_RATIO,
): Promise<CondenseRunResult> {
  const r = reporter ?? NOOP_REPORTER;
  r.step("加载精简上下文（人物/线索/风格）", 1, 3);
  const { input } = await loadCondenseContext(bookId, chapter, ratio);
  const system = buildCondenseSystem() + "\n\n" + CONDENSE_OUTPUT_BUDGET_HINT;

  let result: CondensedChapter | null = null;
  let modelUsed: string | null = null;
  let lastErrors: string[] = [];
  let lastOutput: CondensedChapter | null = null;

  r.step("AI 精简（视频向，含规则校验重试）", 2, 3);
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (r.checkCancelled()) throw new JobCancelledError();
    const prompt = lastErrors.length
      ? `${buildCondensePrompt(input)}\n\n【上次输出未通过规则校验，请修正后重新输出】\n${lastErrors.map((e) => `- ${e}`).join("\n")}`
      : buildCondensePrompt(input);

    const response = await completeJSON({
      system,
      prompt,
      schema: condensedChapterSchema,
      tier: "strong",
      temperature: 0.3,
      maxTokens: 12000,
      bookId,
      node: "condense.chapter",
      maxAttempts: 3,
    });

    const repaired = repairCondenseSpans(input.chapterText, response.data);
    if (repaired > 0) {
      r.log(`已自动修正 ${repaired} 处 source_span 定位（确定性修复）`);
    }
    const errors = validateCondensation(input.chapterText, input.targetChars, response.data);
    if (errors.length === 0) {
      result = response.data;
      modelUsed = response.usage?.model ?? null;
      break;
    }
    lastErrors = errors;
    lastOutput = response.data;
    r.log(`第 ${attempt} 次精简未过规则校验：${errors.length} 项，正在修正重试`);
  }

  if (!result) {
    throw new CondensationValidationError(lastErrors, lastOutput);
  }

  r.step("落库精简底稿", 3, 3);
  const id = await persistCondensation(
    bookId,
    chapter,
    result,
    input.sourceChars,
    input.targetChars,
    ratio,
    modelUsed,
  );

  return {
    id,
    title: result.title,
    condensedText: condenseParagraphsToText(result.paragraphs),
    sourceChars: input.sourceChars,
    targetChars: input.targetChars,
    report: result.report,
  };
}

async function persistCondensation(
  bookId: string,
  chapter: ChapterForCondense,
  result: CondensedChapter,
  sourceChars: number,
  targetChars: number,
  ratio: number,
  model: string | null,
): Promise<string> {
  const s = getSupabaseAdmin();
  const { data: existing } = await s
    .from("condensed_chapters")
    .select("*")
    .eq("source_chapter_id", chapter.id)
    .maybeSingle();

  if (existing) {
    // 覆盖前建 checkpoint：重新生成失败或结果离谱时可整体回滚
    createCheckpoint(bookId, `重新精简「${chapter.title ?? `第 ${chapter.idx} 章`}」`, "node-rerun", "condense", [
      { table: "condensed_chapters", rowId: existing.id, before: existing, op: "update" },
    ]);
  }

  const payload = {
    book_id: bookId,
    source_chapter_id: chapter.id,
    title: result.title,
    hook: result.hook,
    condensed_text: condenseParagraphsToText(result.paragraphs),
    source_chars: sourceChars,
    target_chars: targetChars,
    ratio,
    status: "pending_review" as const,
    model,
    raw_output: result,
    report: result.report,
    hand_edited: 0,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await s.from("condensed_chapters").update(payload).eq("id", existing.id);
    return existing.id;
  }
  const { data: created, error } = await s
    .from("condensed_chapters")
    .insert(payload)
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "写入 condensed_chapters 失败");
  return created.id;
}

/** 对照页数据：精简稿 + 源章原文 + 结构化报告 */
export async function getLatestCondensed(bookId: string, chapterId?: string) {
  const s = getSupabaseAdmin();

  let sourceQuery = s
    .from("source_chapters")
    .select("id, idx, title, cleaned_text, char_count")
    .eq("book_id", bookId);
  sourceQuery = chapterId ? sourceQuery.eq("id", chapterId) : sourceQuery.eq("idx", 1);
  const { data: source } = await sourceQuery.single();

  let condensedQuery = s
    .from("condensed_chapters")
    .select("*")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (source) condensedQuery = condensedQuery.eq("source_chapter_id", source.id);
  const { data: condensed } = await condensedQuery.maybeSingle();

  return { source, condensed };
}





/** 手动修改精简稿：建 checkpoint → 更新 → 下游脚本标 stale */
export async function saveCondensedText(
  bookId: string,
  text: string,
  chapterId?: string,
): Promise<{ id: string }> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("精简稿不能为空");

  const s = getSupabaseAdmin();
  let query = s
    .from("condensed_chapters")
    .select("*")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (chapterId) query = query.eq("source_chapter_id", chapterId);
  const { data: row } = await query.maybeSingle();
  if (!row) throw new Error("还没有精简稿，请先运行精简");

  createCheckpoint(bookId, `手动修改精简稿「${row.title ?? "精简稿"}」`, "manual-edit", undefined, [
    { table: "condensed_chapters", rowId: row.id, before: row, op: "update" },
  ]);

  await s
    .from("condensed_chapters")
    .update({
      condensed_text: trimmed,
      status: "pending_review",
      hand_edited: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  // 精简稿变化 → 已生成的脚本/下游过期，等待显式重跑（不自动烧钱）
  await s.from("adapted_chapters").update({ status: "stale" }).eq("source_chapter_id", row.source_chapter_id);

  return { id: row.id };
}

/** 签核精简底稿（批准后 adapt 节点优先使用它作为改编输入） */
export async function approveCondensed(bookId: string, id: string): Promise<void> {
  const s = getSupabaseAdmin();
  const { data: row } = await s.from("condensed_chapters").select("*").eq("id", id).single();
  if (!row || row.book_id !== bookId) throw new Error("精简稿不存在");

  createCheckpoint(bookId, `批准精简稿「${row.title ?? "精简稿"}」`, "approve", "approve:condense", [
    { table: "condensed_chapters", rowId: id, before: row, op: "update" },
  ]);
  await s
    .from("condensed_chapters")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id);
}
