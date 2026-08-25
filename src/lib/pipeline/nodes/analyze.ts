import { getSupabaseAdmin } from "@/lib/db";
import { createCheckpoint } from "@/lib/checkpoints";
import { completeJSON } from "@/lib/providers/llm";
import {
  buildChunkExtractPrompt,
  buildStyleProposalPromptForBook,
  CHUNK_EXTRACT_SYSTEM,
  STYLE_PROPOSAL_SYSTEM,
} from "@/lib/pipeline/prompts/analyze";
import {
  betterCanonical,
  mergeNameSets,
  namesMatch,
  normalizeName,
  normalizeRole,
  pickBestRole,
  type CharacterRow,
  type IncomingCharacter,
} from "@/lib/pipeline/characters";
import {
  betterEntityCanonical,
  entityCompareKey,
  entityNamesMatch,
  type EntityRow,
} from "@/lib/pipeline/entities";
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
  // 把已有人物/地点/线索档案注入提示词，让模型复用 canonical 名（从源头抑制命名漂移）
  const supabase = getSupabaseAdmin();
  const { data: charRows } = await supabase
    .from("characters")
    .select("canonical_name, aliases")
    .eq("book_id", bookId);
  const existingCharacters = (charRows ?? []) as CharacterRow[];
  const { data: locRows } = await supabase
    .from("locations")
    .select("name, aliases")
    .eq("book_id", bookId);
  const existingLocations = (locRows ?? []) as EntityRow[];
  const { data: clueRows } = await supabase
    .from("clues")
    .select("name, aliases")
    .eq("book_id", bookId);
  const existingClues = (clueRows ?? []) as EntityRow[];

  const result = await completeJSON({
    system: CHUNK_EXTRACT_SYSTEM,
    prompt: buildChunkExtractPrompt(
      chapter.idx,
      chapter.title,
      chapter.cleanedText,
      existingCharacters,
      existingLocations,
      existingClues,
    ),
    schema: chunkAnalysisSchema,
    tier: "cheap",
    temperature: 0.2,
    bookId,
    node: "analyze.chapter",
  });
  return result.data;
}

/** B24 v2（docs/14）：全书级风格圣经候选（强模型）——聚合多章摘要与档案，不再依赖单章 */
export async function proposeStyleBiblesForBook(bookId: string): Promise<StyleBibleProposals> {
  const supabase = getSupabaseAdmin();

  // 章节摘要（含章节号/标题，用于组装全书上下文）
  const [summaryRes, chapterRes] = await Promise.all([
    supabase
      .from("chapter_summaries")
      .select("source_chapter_id, summary, tone")
      .eq("book_id", bookId),
    supabase.from("source_chapters").select("id, idx, title").eq("book_id", bookId),
  ]);
  const idxByChapterId = new Map(
    ((chapterRes.data ?? []) as Array<{ id: string; idx: number; title: string | null }>).map(
      (c) => [c.id, c],
    ),
  );
  const chapterSummaries = ((summaryRes.data ?? []) as Array<{
    source_chapter_id: string;
    summary: string;
    tone?: string | null;
  }>)
    .map((s) => {
      const ch = idxByChapterId.get(s.source_chapter_id);
      return {
        idx: ch?.idx ?? 0,
        title: ch?.title ?? null,
        summary: s.summary,
        tone: s.tone,
      };
    })
    .sort((a, b) => a.idx - b.idx)
    .slice(0, 5);

  if (chapterSummaries.length === 0) {
    throw new Error("还没有章节摘要，请先在“全书档案”页分析章节");
  }

  // 档案概览：人物（≤12）、地点、线索（带剧透/红鲱鱼标记）
  const [charRes, locRes, clueRes] = await Promise.all([
    supabase
      .from("characters")
      .select("canonical_name, role, description")
      .eq("book_id", bookId)
      .limit(12),
    supabase.from("locations").select("name, visual_note").eq("book_id", bookId),
    supabase
      .from("clues")
      .select("name, is_spoiler, is_red_herring")
      .eq("book_id", bookId),
  ]);

  const result = await completeJSON({
    system: STYLE_PROPOSAL_SYSTEM,
    prompt: buildStyleProposalPromptForBook({
      genreHint: null,
      chapterSummaries,
      characters: ((charRes.data ?? []) as Array<{
        canonical_name: string;
        role: string;
        description: string | null;
      }>).map((c) => ({
        name: c.canonical_name,
        role: c.role,
        description: c.description ?? "",
      })),
      locations: ((locRes.data ?? []) as Array<{ name: string; visual_note: string | null }>).map(
        (l) => ({ name: l.name, visual_note: l.visual_note }),
      ),
      clues: ((clueRes.data ?? []) as Array<{
        name: string;
        is_spoiler: boolean;
        is_red_herring: boolean;
      }>).map((cl) => ({
        name: cl.name,
        is_spoiler: Boolean(cl.is_spoiler),
        is_red_herring: Boolean(cl.is_red_herring),
      })),
    }),
    schema: styleBibleProposalsSchema,
    tier: "strong",
    temperature: 0.6,
    bookId,
    node: "bible.propose",
  });
  return result.data;
}

/** 描述合并：保留信息更丰富（更长）的一条 */
function pickLongerDescription(a: string | null | undefined, b: string | null | undefined): string | null {
  const sa = (a ?? "").trim();
  const sb = (b ?? "").trim();
  if (!sa) return sb || null;
  if (!sb) return sa || null;
  return sb.length > sa.length ? sb : sa;
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

  // 人物：四向匹配合并（canonical 相等 / 新名 ∈ 旧别名 / 旧 canonical ∈ 新别名 / 别名交集 / 基名相等），
  // 工作数组随插入动态更新（同章内后出现的变体也能匹配到刚插入的行）
  const { data: charRows } = await supabase
    .from("characters")
    .select("id, canonical_name, aliases, role, description")
    .eq("book_id", bookId);
  const rows = (charRows ?? []) as Array<CharacterRow & { id: string }>;

  for (const c of analysis.characters) {
    const incoming: IncomingCharacter = c;
    const found = rows.find((row) => namesMatch(row, incoming));
    if (found) {
      const promoted = betterCanonical(found.canonical_name, c.name);
      // 所有不同写法都应收敛：要么升级为 canonical，要么并入别名
      const extraAliases: string[] = [];
      if (normalizeName(c.name) !== normalizeName(found.canonical_name)) extraAliases.push(c.name);
      if (promoted) extraAliases.push(found.canonical_name);
      const updates: Record<string, unknown> = {
        aliases: mergeNameSets(found.aliases, c.aliases, extraAliases),
        description: pickLongerDescription(found.description, c.description),
        role: pickBestRole([found.role, c.role]),
      };
      if (promoted) updates.canonical_name = promoted;
      await supabase.from("characters").update(updates).eq("id", found.id);
      // 同步工作数组，供本章后续条目匹配
      found.canonical_name = promoted ?? found.canonical_name;
      found.aliases = updates.aliases as string[];
      found.role = updates.role as string;
      found.description = updates.description as string | null;
    } else {
      const { data } = await supabase
        .from("characters")
        .insert({
          book_id: bookId,
          canonical_name: c.name,
          aliases: c.aliases,
          role: normalizeRole(c.role),
          description: c.description,
          bio: { appearance: c.appearance },
          first_chapter_id: chapter.id,
          status: "draft",
        })
        .select("id")
        .single();
      if (data) {
        rows.push({
          id: data.id,
          canonical_name: c.name,
          aliases: c.aliases ?? [],
          role: normalizeRole(c.role),
          description: c.description,
        });
      }
    }
  }

  // 地点：别名四向匹配合并（与人物同构），工作数组动态更新
  const { data: locRows } = await supabase
    .from("locations")
    .select("id, name, aliases, description, visual_note")
    .eq("book_id", bookId);
  const locRowsArr = (locRows ?? []) as Array<EntityRow & { id: string; visual_note?: string | null }>;

  for (const l of analysis.locations) {
    const found = locRowsArr.find((row) => entityNamesMatch(row, l));
    if (found) {
      const promoted = betterEntityCanonical(found.name, l.name);
      const extraAliases: string[] = [];
      if (entityCompareKey(l.name) !== entityCompareKey(found.name)) extraAliases.push(l.name);
      if (promoted) extraAliases.push(found.name);
      await supabase
        .from("locations")
        .update({
          name: promoted ?? found.name,
          aliases: mergeNameSets(found.aliases, l.aliases, extraAliases),
          description: pickLongerDescription(found.description, l.description),
          visual_note: pickLongerDescription(found.visual_note, l.visual_note),
        })
        .eq("id", found.id);
      found.name = promoted ?? found.name;
      found.aliases = mergeNameSets(found.aliases, l.aliases, extraAliases);
      found.description = pickLongerDescription(found.description, l.description);
      found.visual_note = pickLongerDescription(found.visual_note, l.visual_note);
    } else {
      const { data } = await supabase
        .from("locations")
        .insert({
          book_id: bookId,
          name: l.name,
          aliases: l.aliases ?? [],
          description: l.description,
          visual_note: l.visual_note,
          first_chapter_id: chapter.id,
          status: "draft",
        })
        .select("id")
        .single();
      if (data) {
        locRowsArr.push({ id: data.id, name: l.name, aliases: l.aliases ?? [], description: l.description, visual_note: l.visual_note });
      }
    }
  }

  // 物品：别名四向匹配合并
  const { data: itemRows } = await supabase
    .from("items")
    .select("id, name, aliases, description, visual_note")
    .eq("book_id", bookId);
  const itemRowsArr = (itemRows ?? []) as Array<EntityRow & { id: string; visual_note?: string | null }>;

  for (const it of analysis.items) {
    const found = itemRowsArr.find((row) => entityNamesMatch(row, it));
    if (found) {
      const promoted = betterEntityCanonical(found.name, it.name);
      const extraAliases: string[] = [];
      if (entityCompareKey(it.name) !== entityCompareKey(found.name)) extraAliases.push(it.name);
      if (promoted) extraAliases.push(found.name);
      await supabase
        .from("items")
        .update({
          name: promoted ?? found.name,
          aliases: mergeNameSets(found.aliases, it.aliases, extraAliases),
          description: pickLongerDescription(found.description, it.description),
          visual_note: pickLongerDescription(found.visual_note, it.visual_note),
        })
        .eq("id", found.id);
      found.name = promoted ?? found.name;
      found.aliases = mergeNameSets(found.aliases, it.aliases, extraAliases);
      found.description = pickLongerDescription(found.description, it.description);
      found.visual_note = pickLongerDescription(found.visual_note, it.visual_note);
    } else {
      await supabase.from("items").insert({
        book_id: bookId,
        name: it.name,
        kind: it.kind,
        aliases: it.aliases ?? [],
        description: it.description,
        visual_note: it.visual_note,
        first_chapter_id: chapter.id,
        status: "draft",
      });
    }
  }

  // 线索：别名四向匹配合并（同名时合并 aliases/描述，红鲱鱼/剧透取并集）
  const { data: clueRows } = await supabase
    .from("clues")
    .select("id, name, aliases, clue_type, description, is_red_herring, is_spoiler")
    .eq("book_id", bookId);
  const clueRowsArr = (clueRows ?? []) as Array<
    EntityRow & { id: string; clue_type?: string | null; is_red_herring?: boolean | number; is_spoiler?: boolean | number }
  >;

  for (const cl of analysis.clues) {
    const found = clueRowsArr.find((row) => entityNamesMatch(row, cl, { containment: true }));
    if (found) {
      const promoted = betterEntityCanonical(found.name, cl.name);
      const extraAliases: string[] = [];
      if (entityCompareKey(cl.name) !== entityCompareKey(found.name)) extraAliases.push(cl.name);
      if (promoted) extraAliases.push(found.name);
      const clueType =
        found.clue_type && found.clue_type !== "other" ? found.clue_type : cl.clue_type || "other";
      await supabase
        .from("clues")
        .update({
          name: promoted ?? found.name,
          aliases: mergeNameSets(found.aliases, cl.aliases, extraAliases),
          clue_type: clueType,
          description: pickLongerDescription(found.description, cl.description) ?? "",
          is_red_herring: Boolean(found.is_red_herring) || Boolean(cl.is_red_herring),
          is_spoiler: Boolean(found.is_spoiler) || Boolean(cl.is_spoiler),
        })
        .eq("id", found.id);
      found.name = promoted ?? found.name;
      found.aliases = mergeNameSets(found.aliases, cl.aliases, extraAliases);
      found.clue_type = clueType;
      found.description = pickLongerDescription(found.description, cl.description);
      found.is_red_herring = Boolean(found.is_red_herring) || Boolean(cl.is_red_herring);
      found.is_spoiler = Boolean(found.is_spoiler) || Boolean(cl.is_spoiler);
    } else {
      await supabase.from("clues").insert({
        book_id: bookId,
        name: cl.name,
        aliases: cl.aliases ?? [],
        clue_type: cl.clue_type,
        description: cl.description,
        introduced_chapter_id: chapter.id,
        is_red_herring: cl.is_red_herring,
        is_spoiler: cl.is_spoiler,
        status: "introduced",
      });
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

export interface PersistStyleResult {
  id: string;
  /** 新批次的版本号 */
  version: number;
  /** 是否归档了旧批次（bible_proposals） */
  archived: boolean;
}

/**
 * 保存风格圣经候选（v2，docs/14 §2.2）：
 * - 新批次落库前，把旧当前批次（proposal_json + 当时批准索引）归档进 bible_proposals（append-only 历史）；
 * - 行状态回到 pending_review（解锁），approved_proposal_index 清空；
 * - 覆盖已批准方案前先建 checkpoint（可整体回滚）；
 * - manual_override 清 0（AI 方案接管人工修订）。
 */
export async function persistStyleProposals(
  bookId: string,
  proposals: StyleBibleProposals,
  opts: { note?: string } = {},
): Promise<PersistStyleResult> {
  const supabase = getSupabaseAdmin();
  const recommended =
    proposals.proposals[Math.min(proposals.recommended_index, proposals.proposals.length - 1)];

  const { data: existing } = await supabase
    .from("style_bibles")
    .select("id, version, proposal_json, approved_proposal_index")
    .eq("book_id", bookId)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;
  let archived = false;

  if (existing) {
    const oldProposals = (existing.proposal_json ?? []) as StyleBibleProposal[];
    // 旧批次归档：历史永远不丢（即使旧批次为空数组也不写）
    if (oldProposals.length > 0) {
      await supabase.from("bible_proposals").insert({
        book_id: bookId,
        version: existing.version ?? 1,
        proposal_json: existing.proposal_json,
        approved_index: existing.approved_proposal_index,
        note: opts.note ?? `AI 重新生成，批次 v${nextVersion} 取代`,
        created_at: new Date().toISOString(),
      });
      archived = true;
    }
    // 重新生成会覆盖已批准的方案：先建 checkpoint，失败/不满意可整体回滚
    const { data: before } = await supabase
      .from("style_bibles")
      .select("*")
      .eq("id", existing.id)
      .single();
    if (before) {
      createCheckpoint(bookId, `重新生成风格方案（v${nextVersion}）`, "node-rerun", "bible.propose", [
        { table: "style_bibles", rowId: existing.id, before, op: "update" },
      ]);
    }
    await supabase
      .from("style_bibles")
      .update({
        status: "pending_review",
        version: nextVersion,
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
        approved_at: null,
        manual_override: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { id: existing.id, version: nextVersion, archived };
  }

  const { data: created, error } = await supabase
    .from("style_bibles")
    .insert({
      book_id: bookId,
      status: "pending_review",
      version: nextVersion,
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
      manual_override: 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: created.id, version: nextVersion, archived };
}

/** 恢复历史批次为当前候选（docs/14 §5）：内容来自 bible_proposals，新版本号追加，旧当前批次归档 */
export async function restoreStyleProposal(
  bookId: string,
  proposalId: string,
): Promise<PersistStyleResult> {
  const supabase = getSupabaseAdmin();
  const { data: row } = await supabase
    .from("bible_proposals")
    .select("id, book_id, version, proposal_json, approved_index")
    .eq("id", proposalId)
    .single();
  if (!row || row.book_id !== bookId) throw new Error("历史批次不存在或不属于本书");

  const proposals = (row.proposal_json ?? []) as StyleBibleProposal[];
  if (proposals.length === 0) throw new Error("历史批次为空，无法恢复");

  return persistStyleProposals(bookId, {
    proposals,
    recommended_index: row.approved_index ?? 0,
  }, { note: `恢复自批次 v${row.version}` });
}

/** 签核 A：选定某一套风格方案（批准前自动建 checkpoint，批准后向下游传播 stale） */
export async function approveStyleBible(
  bookId: string,
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
  if (row.book_id !== bookId) return null;

  const proposals = (row.proposal_json ?? []) as StyleBibleProposal[];
  const selected = proposals[proposalIndex];
  if (!selected) return null;

  // 批准即签核点：回滚可回到"批准风格方案之前"
  createCheckpoint(
    bookId,
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
      // AI 方案接管：手工修订标记清 0
      manual_override: 0,
    })
    .eq("id", styleBibleId);

  // 风格变更 → 下游脚本与精简底稿全部过期，等待显式重跑（不自动烧钱）
  await supabase.from("adapted_chapters").update({ status: "stale" }).eq("book_id", bookId);
  await supabase.from("condensed_chapters").update({ status: "stale" }).eq("book_id", bookId);

  return selected;
}
