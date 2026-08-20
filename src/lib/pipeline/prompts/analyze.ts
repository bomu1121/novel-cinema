import type { ChunkAnalysis } from "@/lib/pipeline/schemas/analysis";

export const CHUNK_EXTRACT_SYSTEM = `你是一名严谨的小说文本分析器。任务：从给定原文片段中提取结构化信息。
规则：
1. 只提取原文明确出现的信息，绝不推断、补充或美化。
2. 人名、地名保留原文写法；别名全部记入 aliases。
3. 无法判断的内容省略，不要编造。
4. 线索（clues）只收录对情节推进/解谜有意义的细节、伏笔或矛盾点。
5. summary 用 3~5 句话概括本片段发生了什么，不评价。`;

export function buildChunkExtractPrompt(chapterIdx: number, title: string | null, text: string): string {
  return [
    `【章节】第 ${chapterIdx} 章${title ? ` · ${title}` : ""}`,
    `【原文】`,
    text,
  ].join("\n\n");
}

export const STYLE_PROPOSAL_SYSTEM = `你是一名视觉导演。任务：根据小说的类型、人物与情节基调，给出 1~3 套可直接用于 AI 绘图的视觉风格方案。
要求：
1. visual_style 是一句英文 prompt 风格描述（可含中文专有名词），例如 "dark rainy night, film noir, high contrast, 1920s Shanghai"。
2. color_palette 给 4~6 个十六进制色值。
3. spoiler_rules 面向推理小说：写清哪些画面内容在真相揭晓前禁止出现。
4. negative_prompt 是通用负面词：text, watermark, extra fingers, deformed hands 等。
5. recommended_index 指向你推荐的那套方案。`;

export function buildStyleProposalPrompt(analysis: ChunkAnalysis, genreHint: string | null): string {
  return [
    `【类型倾向】${genreHint || "未知（请从内容判断）"}`,
    `【章节摘要】${analysis.summary}`,
    `【基调】${analysis.tone || "未知"}`,
    `【人物】${analysis.characters.map((c) => c.name).join("、") || "（本章未提取到人物）"}`,
    `【地点】${analysis.locations.map((l) => l.name).join("、") || "（未提取到地点）"}`,
  ].join("\n");
}
