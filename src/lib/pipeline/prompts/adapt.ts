import type { ScriptReview } from "@/lib/pipeline/schemas/adapt";

export interface AdaptContextInput {
  chapterIdx: number;
  chapterTitle: string | null;
  chapterText: string;
  /** 输入文本来源：原文 or 已批准的《精简底稿》 */
  basis?: "source" | "condensed";
  targetSec: number;
  characters: Array<{ name: string; aliases: string[]; description: string | null; role: string }>;
  clues: Array<{ name: string; description: string; is_spoiler: boolean; is_red_herring: boolean }>;
  previousSummaries: string[];
  styleBible: {
    visual_style: string;
    narration_tone: string;
    camera_grammar: Record<string, unknown>;
    spoiler_rules: string[];
    negative_prompt: string;
  } | null;
}

export function buildAdaptSystem(targetSec: number): string {
  return `你是一名影视导演兼推理小说改编编剧。任务：把一章小说压缩成视频脚本。

【硬约束】
1. 忠于原文：只删减、合并、旁白概述，绝不新增事实、对白或动作。
2. 每个 beat 必须带 source_span（本章字符区间 start_char/end_char/quote），quote 必须逐字来自原文。
3. 时长预算：本章 ${targetSec} 秒。所有 beat 的 estimated_duration_sec 之和不得超过预算的 110%（宁短勿长：预算偏紧时优先删减旁白与次要动作，总时长低于预算更好）。估算规则：中文语速约 4.5 字/秒 × pace；对白额外 +0.8s 反应时间，夹在 2.5~8s；旁白单句不超过 10s；insert_card 3~5s；action/montage 3~6s；transition 不超过 1.5s。
4. 人物白名单：说话人 character_name 只能来自输入中列出的人物；不在名单中的名字不得作为说话人，必要时用“他/她”指代。
5. 剧透规则：凡尚未回收的线索，禁止在 visual_note 中暗示真凶或手法；只能用旁白或文字卡承载，并给该 beat 标 flags.spoiler=true。
6. 画面可达：visual_note 必须拆成“背景 + 人物 + 动作 + 表情”，连续两个 beat 不得无画面变化。
7. 语言：旁白稿是口语化中文；对白优先保留原文关键句但允许删减语气词。
8. selection_report 必须诚实记录：kept=保留了什么、cut=删了什么及原因、compressed=怎么压缩的；对删减可能伤及线索的地方写进 clue_safety_notes。
9. 只输出 JSON 对象。
10. 输出体积预算（防截断）：beats 总数 ≤ 24；对白 text ≤ 60 字、旁白 ≤ 80 字、visual_note ≤ 40 字；selection_report 只记要点，不得回贴大段原文。总输出控制在 12000 token 以内。`;
}

export function buildAdaptPrompt(input: AdaptContextInput): string {
  const bible = input.styleBible;
  return [
    `【本章】第 ${input.chapterIdx} 章${input.chapterTitle ? ` · ${input.chapterTitle}` : ""}`,
    `【输入文本】${input.basis === "condensed" ? "已批准的《精简底稿》——source_span 必须定位到这份底稿，而不是原书" : "原文章节"}`,
    `【时长预算】${input.targetSec} 秒`,
    `【风格圣经】${bible ? `视觉：${bible.visual_style}；旁白：${bible.narration_tone}` : "（未批准，按本章基调自行保守处理）"}`,
    `【剧透规则】${(bible?.spoiler_rules ?? []).join("；") || "无"}`,
    `【人物白名单】${input.characters.map((c) => `${c.name}（${c.role}${c.description ? `，${c.description}` : ""}）`).join("；") || "无"}`,
    `【相关线索】${input.clues.map((c) => `${c.name}：${c.description}${c.is_spoiler ? "（剧透禁画）" : ""}${c.is_red_herring ? "（红鲱鱼）" : ""}`).join("；") || "无"}`,
    `【前情摘要】${input.previousSummaries.length > 0 ? input.previousSummaries.join("\n") : "（本章为全书开头）"}`,
    `【原文】`,
    input.chapterText,
  ].join("\n\n");
}

export function buildReviewPrompt(
  chapterIdx: number,
  chapterText: string,
  beats: Array<{ idx: number; text: string; type: string; character_name: string | null }>,
  clueNames: string[],
): string {
  return [
    `请审校第 ${chapterIdx} 章的改编脚本。逐条核对以下内容：`,
    `1. fidelity：每个 beat 是否忠于原文（对照 source_span），有无捏造事实/对白；`,
    `2. clue：本章涉及的线索（${clueNames.join("、") || "无"}）是否有缺失或提前回收；`,
    `3. spoiler：visual_note / 台词是否暗示了尚未揭晓的真凶或手法；`,
    `4. pacing：是否存在连续 15 秒以上同画面同声音、单条旁白过长、切镜单调；`,
    `5. voice：说话人是否与人物白名单一致。`,
    `【beat 列表】`,
    JSON.stringify(beats.map((b) => ({ idx: b.idx, type: b.type, character_name: b.character_name, text: b.text })), null, 2),
    `【原文】`,
    chapterText,
    `只输出 JSON：{verdict: "ready"|"needs_work", items:[{severity:"red"|"yellow", beat_idx, kind, issue, suggestion}]}。green 级别的问题不要列。`,
  ].join("\n\n");
}

/** 把自检结果中 red 项抽出，供 UI 直接高亮 */
export function redItems(review: ScriptReview) {
  return review.items.filter((i) => i.severity === "red");
}
