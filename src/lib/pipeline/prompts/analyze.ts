import type { ChunkAnalysis } from "@/lib/pipeline/schemas/analysis";
import type { CharacterRow } from "@/lib/pipeline/characters";

export const CHUNK_EXTRACT_SYSTEM = `你是一名严谨的小说文本分析器。任务：从给定原文片段中提取结构化信息。
规则：
1. 只提取原文明确出现的信息，绝不推断、补充或美化。
2. 人物识别：若【已有人物档案】中存在同一人物（全名/简称/称谓能对上），必须复用档案中的 name（优先用最完整的名字），并把本片段新出现的称呼追加进 aliases；只有档案中没有的人物才新建条目。严禁为同一人物新建不同名字的条目。
3. 人名、地名保留原文写法；别名全部记入 aliases。
4. 地点识别：若【已有地点档案】中存在同一地点（全名/简称/别称能对上），必须复用其 name，并把新称谓追加进 aliases；严禁为同一地点新建条目。
5. 线索识别：若【已有线索档案】中存在同一线索（同一事实/伏笔/物件，表述不同也算），必须复用其 name，并把新表述追加进 aliases；严禁为同一线索新建条目。
6. role 只能是 protagonist / main / supporting / other 之一，无法判断时写 other。
7. 线索（clues）只收录对情节推进/解谜有意义的细节、伏笔或矛盾点。
8. summary 用 3~5 句话概括本片段发生了什么，不评价。`;

export interface EntityRegistryEntry {
  name: string;
  aliases?: string[] | null;
}

export function buildChunkExtractPrompt(
  chapterIdx: number,
  title: string | null,
  text: string,
  existingCharacters: CharacterRow[] = [],
  existingLocations: EntityRegistryEntry[] = [],
  existingClues: EntityRegistryEntry[] = [],
): string {
  const formatRegistry = (entries: Array<{ name: string; aliases?: string[] | null }>) =>
    entries
      .map((e) => {
        const aliases = (e.aliases ?? []).filter(Boolean);
        return aliases.length > 0
          ? `- ${e.name}（别名：${aliases.join("、")}）`
          : `- ${e.name}`;
      })
      .join("\n");
  const characters = formatRegistry(
    existingCharacters.map((c) => ({ name: c.canonical_name, aliases: c.aliases })),
  );
  const locations = formatRegistry(existingLocations);
  const clues = formatRegistry(existingClues);
  return [
    `【章节】第 ${chapterIdx} 章${title ? ` · ${title}` : ""}`,
    `【已有人物档案】${characters ? `\n${characters}` : "（暂无档案）"}`,
    `【已有地点档案】${locations ? `\n${locations}` : "（暂无档案）"}`,
    `【已有线索档案】${clues ? `\n${clues}` : "（暂无档案）"}`,
    `【原文】`,
    text,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// B24 风格圣经候选（v2，docs/14）：全书级聚合输入，不再依赖单章
// ---------------------------------------------------------------------------

export const STYLE_PROPOSAL_SYSTEM = `你是一名视觉导演。任务：根据整本小说的类型、人物与情节基调，给出 1~3 套可直接用于 AI 绘图的**全书级**视觉风格方案（不是某一章）。
要求：
1. visual_style 是一句英文 prompt 风格描述（可含中文专有名词），例如 "dark rainy night, film noir, high contrast, 1920s Shanghai"。
2. color_palette 给 4~6 个十六进制色值，覆盖主色/辅色/氛围色。
3. camera_grammar 三档必填：dialogue（对话机位）、narration（旁白机位）、transition（转场方式），各一句话。
4. spoiler_rules 面向推理小说：写清哪些画面内容在真相揭晓前禁止出现（基于提供的线索与剧透标记）。
5. negative_prompt 必填：通用负面词（text, watermark, extra fingers, deformed hands 等）+ 与本书风格冲突的元素。
6. rationale 写清这套方案为什么适配这本书（类型契合/气氛来源/可绘图性），一句话。
7. recommended_index 指向你推荐的那套方案。
8. 各套方案之间必须有可辨识的差异（如不同导演/类型处理），不要近义改写。`;

export interface ChapterSummaryInput {
  idx: number;
  title: string | null;
  summary: string;
  tone?: string | null;
}

export interface BookStyleContext {
  /** 类型倾向（未知时由模型从内容判断） */
  genreHint: string | null;
  /** 已分析章节摘要（≤5 章） */
  chapterSummaries: ChapterSummaryInput[];
  /** 人物档案（≤12：canonical + role + 一句话） */
  characters: Array<{ name: string; role: string; description: string }>;
  /** 地点名册 */
  locations: Array<{ name: string; visual_note: string | null }>;
  /** 线索名册（含剧透/红鲱鱼标记） */
  clues: Array<{ name: string; is_spoiler: boolean; is_red_herring: boolean }>;
}

export function buildStyleProposalPromptForBook(ctx: BookStyleContext): string {
  const chapters =
    ctx.chapterSummaries.length > 0
      ? ctx.chapterSummaries
          .map(
            (c, i) =>
              `${i + 1}. 第 ${c.idx} 章${c.title ? `《${c.title}》` : ""}：${c.summary}${
                c.tone ? `（基调：${c.tone}）` : ""
              }`,
          )
          .join("\n")
      : "（还没有章节摘要）";
  const characters =
    ctx.characters.length > 0
      ? ctx.characters
          .map((c) => `- ${c.name}（${c.role || "其他"}）${c.description ? `：${c.description}` : ""}`)
          .join("\n")
      : "（暂无人物档案）";
  const locations =
    ctx.locations.length > 0
      ? ctx.locations
          .map((l) => `- ${l.name}${l.visual_note ? `（视觉：${l.visual_note}）` : ""}`)
          .join("\n")
      : "（暂无地点档案）";
  const clues =
    ctx.clues.length > 0
      ? ctx.clues
          .map(
            (cl) =>
              `- ${cl.name}${cl.is_spoiler ? "【剧透禁画】" : ""}${cl.is_red_herring ? "【红鲱鱼】" : ""}`,
          )
          .join("\n")
      : "（暂无线索档案）";

  return [
    `【类型倾向】${ctx.genreHint || "未知（请从内容判断）"}`,
    `【全书章节摘要】\n${chapters}`,
    `【人物档案】\n${characters}`,
    `【地点名册】\n${locations}`,
    `【线索名册（剧透/红鲱鱼标记用于 spoiler_rules）】\n${clues}`,
    "请基于以上全书信息输出 1~3 套候选；若章节摘要为空则拒绝生成并说明原因。",
  ].join("\n\n");
}

// 保留 v1 单章版（部分调用方/测试仍引用）；新代码一律使用 ForBook 版
export function buildStyleProposalPrompt(analysis: ChunkAnalysis, genreHint: string | null): string {
  return [
    `【类型倾向】${genreHint || "未知（请从内容判断）"}`,
    `【章节摘要】${analysis.summary}`,
    `【基调】${analysis.tone || "未知"}`,
    `【人物】${analysis.characters.map((c) => c.name).join("、") || "（本章未提取到人物）"}`,
    `【地点】${analysis.locations.map((l) => l.name).join("、") || "（未提取到地点）"}`,
  ].join("\n");
}
