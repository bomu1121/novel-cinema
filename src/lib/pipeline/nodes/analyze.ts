import { getSupabaseAdmin } from "@/lib/db";
import { createCheckpoint } from "@/lib/checkpoints";
import { completeJSON } from "@/lib/providers/llm";
import {
  buildChunkExtractPrompt,
  buildStyleProposalPrompt,
  CHUNK_EXTRACT_SYSTEM,
  STYLE_PROPOSAL_SYSTEM,
} from "@/lib/pipeline/prompts/analyze";
import {
  chunkAnalysisSchema,
  styleBibleProposalsSchema,
  type ChunkAnalysis,
  type StyleBibleProposal,
  type StyleBibleProposals,
} from "@/lib/pipeline/schemas/analysis";

export interface ChapterForAnalysis {
  id: string;
  idx: number;
  title: string | null;
  cleanedText: string;
}

/** C10 前置的“单章粗读”：调用便宜模型抽取结构化信息 */
export async function analyzeChapter(
  bookId: string,
  chapter: ChapterForAnalysis,
): Promise<ChunkAnalysis> {
  const result = await completeJSON({
    system: CHUNK_EXTRACT_SYSTEM,
    prompt: buildChunkExtractPrompt(chapter.idx, chapter.title, chapter.cleanedText),
    schema: chunkAnalysisSchema,
    tier: "cheap",
    temperature: 0.2,
    bookId,
    node: "analyze.chapter",
  });
  return result.data;
}

/** B24：风格圣经候选（强模型） */
export async function proposeStyleBibles(
  bookId: string,
  analysis: ChunkAnalysis,
  genreHint: string | null = null,
): Promise<StyleBibleProposals> {
  const result = await completeJSON({
    system: STYLE_PROPOSAL_SYSTEM,
    prompt: buildStyleProposalPrompt(analysis, genreHint),
    schema: styleBibleProposalsSchema,
    tier: "strong",
    temperature: 0.6,
    bookId,
    node: "bible.propose",
  });
  return result.data;
}

function mergeAliases(existing: string[] | null, incoming: string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...incoming]));
}

export interface PersistResult {
  characters: number;
  locations: number;
  items: number;
  clues: number;
  events: number;
}

/** 把单章分析结果合并进全书档案（B25 的 M0 简化版） */
export async function persistChapterAnalysis(
  bookId: string,
  chapter: ChapterForAnalysis,
  analysis: ChunkAnalysis,
): Promise<PersistResult> {
  const supabase = getSupabaseAdmin();

  await supabase.from("chapter_summaries").upsert(
    {
      book_id: bookId,
      source_chapter_id: chapter.id,
      summary: analysis.summary,
      key_events: analysis.events,
      new_facts: [],
      characters: analysis.characters.map((c) => c.name),
      clues: analysis.clues.map((c) => c.name),
      tone: analysis.tone,
    },
    { onConflict: "source_chapter_id" },
  );

  // 人物：按 canonical_name / aliases 合并
  const { data: charRows } = await supabase
    .from("characters")
    .select("id, canonical_name, aliases")
    .eq("book_id", bookId);
  const charRowsArr = (charRows ?? []) as Array<{
    id: string;
    canonical_name: string;
    aliases: string[] | null;
  }>;

  for (const c of analysis.characters) {
    const found = charRowsArr.find(
      (row) => row.canonical_name === c.name || (row.aliases ?? []).includes(c.name),
    );
    if (found) {
      await supabase
        .from("characters")
        .update({ aliases: mergeAliases(found.aliases, c.aliases), description: c.description || undefined })
        .eq("id", found.id);
    } else {
      await supabase.from("characters").insert({
        book_id: bookId,
        canonical_name: c.name,
        aliases: c.aliases,
        role: c.role,
        description: c.description,
        bio: { appearance: c.appearance },
        first_chapter_id: chapter.id,
        status: "draft",
      });
    }
  }

  // 地点
  const { data: locRows } = await supabase
    .from("locations")
    .select("id, name")
    .eq("book_id", bookId);
  const locMap = new Map((locRows ?? []).map((row: { id: string; name: string }) => [row.name, row.id]));
  for (const l of analysis.locations) {
    if (locMap.has(l.name)) continue;
    const { data } = await supabase
      .from("locations")
      .insert({
        book_id: bookId,
        name: l.name,
        aliases: l.aliases,
        description: l.description,
        visual_note: l.visual_note,
        first_chapter_id: chapter.id,
        status: "draft",
      })
      .select("id")
      .single();
    if (data) locMap.set(l.name, data.id);
  }

  // 物品
  const { data: itemRows } = await supabase
    .from("items")
    .select("id, name")
    .eq("book_id", bookId);
  const itemMap = new Map((itemRows ?? []).map((row: { id: string; name: string }) => [row.name, row.id]));
  for (const it of analysis.items) {
    if (itemMap.has(it.name)) continue;
    await supabase.from("items").insert({
      book_id: bookId,
      name: it.name,
      kind: it.kind,
      description: it.description,
      visual_note: it.visual_note,
      first_chapter_id: chapter.id,
      status: "draft",
    });
  }

  // 线索（同名覆盖更新）
  const { data: clueRows } = await supabase
    .from("clues")
    .select("id, name")
    .eq("book_id", bookId);
  const clueMap = new Map((clueRows ?? []).map((row: { id: string; name: string }) => [row.name, row.id]));
  for (const cl of analysis.clues) {
    const payload = {
      book_id: bookId,
      name: cl.name,
      clue_type: cl.clue_type,
      description: cl.description,
      introduced_chapter_id: chapter.id,
      is_red_herring: cl.is_red_herring,
      is_spoiler: cl.is_spoiler,
      status: "introduced" as const,
    };
    if (clueMap.has(cl.name)) {
      await supabase.from("clues").update(payload).eq("id", clueMap.get(cl.name)!);
    } else {
      await supabase.from("clues").insert(payload);
    }
  }

  // 时间线：单章重跑时先清后插，保证幂等
  await supabase.from("timeline_events").delete().eq("book_id", bookId).eq("source_chapter_id", chapter.id);
  if (analysis.events.length > 0) {
    await supabase.from("timeline_events").insert(
      analysis.events.map((ev, i) => ({
        book_id: bookId,
        source_chapter_id: chapter.id,
        time_label: ev.time_label,
        order_key: `${String(chapter.idx).padStart(4, "0")}-${String(i).padStart(3, "0")}`,
        description: ev.description,
        character_ids: [],
        confidence: 1.0,
      })),
    );
  }

  return {
    characters: analysis.characters.length,
    locations: analysis.locations.length,
    items: analysis.items.length,
    clues: analysis.clues.length,
    events: analysis.events.length,
  };
}

/** 保存风格圣经候选（重复运行会升级 version 并回到待审状态） */
export async function persistStyleProposals(
  bookId: string,
  proposals: StyleBibleProposals,
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const recommended =
    proposals.proposals[Math.min(proposals.recommended_index, proposals.proposals.length - 1)];

  const { data: existing } = await supabase
    .from("style_bibles")
    .select("id, version")
    .eq("book_id", bookId)
    .maybeSingle();

  const payload = {
    book_id: bookId,
    status: "pending_review" as const,
    genre: recommended.genre,
    visual_style: recommended.visual_style,
    art_direction: recommended.art_direction,
    color_palette: recommended.color_palette,
    camera_grammar: recommended.camera_grammar,
    narration_tone: recommended.narration_tone,
    spoiler_rules: { rules: recommended.spoiler_rules },
    negative_prompt: { text: recommended.negative_prompt },
    proposal_json: proposals.proposals,
    approved_proposal_index: null,
  };

  if (existing) {
    await supabase
      .from("style_bibles")
      .update({ ...payload, version: (existing.version ?? 0) + 1 })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("style_bibles")
    .insert({ ...payload, version: 1 })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

/** 签核 A：选定某一套风格方案（批准前自动建 checkpoint，docs/06 P2 验收④） */
export async function approveStyleBible(
  styleBibleId: string,
  proposalIndex: number,
): Promise<StyleBibleProposal | null> {
  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from("style_bibles")
    .select("*")
    .eq("id", styleBibleId)
    .single();
  if (!row) return null;

  const proposals = (row.proposal_json ?? []) as StyleBibleProposal[];
  const selected = proposals[proposalIndex];
  if (!selected) return null;

  // 批准即签核点：回滚可回到"批准风格方案之前"
  createCheckpoint(
    row.book_id,
    `批准风格方案「${selected.visual_style ?? `方案 ${proposalIndex + 1}`}」`,
    "approve",
    "approve:bible",
    [{ table: "style_bibles", rowId: styleBibleId, before: row, op: "update" }],
  );

  await supabase
    .from("style_bibles")
    .update({
      status: "approved",
      approved_proposal_index: proposalIndex,
      approved_at: new Date().toISOString(),
      genre: selected.genre,
      visual_style: selected.visual_style,
      art_direction: selected.art_direction,
      color_palette: selected.color_palette,
      camera_grammar: selected.camera_grammar,
      narration_tone: selected.narration_tone,
      spoiler_rules: { rules: selected.spoiler_rules },
      negative_prompt: { text: selected.negative_prompt },
    })
    .eq("id", styleBibleId);

  return selected;
}
