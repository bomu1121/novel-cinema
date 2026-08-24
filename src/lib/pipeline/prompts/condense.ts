import type { CondenseParagraph } from "@/lib/pipeline/schemas/condense";

export interface CondenseContextInput {
  chapterIdx: number;
  chapterTitle: string | null;
  chapterText: string;
  sourceChars: number;
  targetChars: number;
  ratio: number;
  characters: Array<{ name: string; aliases: string[]; description: string | null; role: string }>;
  clues: Array<{ name: string; description: string; is_spoiler: boolean; is_red_herring: boolean }>;
  previousSummaries: string[];
  styleBible: {
    visual_style: string;
    narration_tone: string;
    spoiler_rules: string[];
  } | null;
}

/**
 * condense.chapter 系统提示词。
 * 研究依据（2026-08 调研）：
 * - 影视改编保留“可拍摄内容”（对白/动作/空间/物件），删内心独白与环境铺陈：
 *   Fiveable《Condensing and Expanding Narratives》、Screenweaver《novel → screenplay》。
 * - 叙事对齐研究要求精简版与原文保持事件/线索的可追溯：
 *   EMNLP 2023《Analyzing Film Adaptation through Narrative Alignment》。
 * - 与 docs/02 C10（beat 级改编）的忠实度约束保持一致：只删/合/缩，绝不新增。
 */
export function buildCondenseSystem(): string {
  return `你是“小说→视频”的影视改编编辑。你的任务不是写摘要，而是输出一份可以直接交给分镜与配音的“精简叙事底稿”。

【与摘要的硬区别】
1. 禁止概括转述：不得把具体的对白/动作写成“两人展开调查”“气氛紧张”这类抽象总结。
2. 对白优先保留原文原句：允许删语气词和重复回合，不允许改语义、不允许杜撰台词。
3. 只保留可拍摄内容：人物动作、对白、关键物件、空间变化、线索；删除不可拍摄或非关键内容：内心独白、重复描写、环境铺陈、寒暄过渡、议论。
4. 每一段精简稿都必须能在原文定位：paragraph.source_spans.quote 必须逐字来自原文。

【压缩手法优先级】
1. 删除：环境/服饰重复描写、内心独白、总结性议论、与线索无关的寒暄。
2. 合并：同一场景内的连续动作合并；多轮对白只保留关键回合（至少保留冲突推进的那一句）。
3. 微缩：保留原句关键短语，删修饰词与填充词。
禁止：新增情节/台词/事实、改变因果顺序、提前泄露尚未回收的线索。

【结构要求】
- 精简稿读起来仍是一段连贯的叙事，不是要点列表。
- 因果关系完整：观众只看视频就能看懂“谁、在哪里、做了什么、为什么”。
- 所有未回收线索的“引入点”必须保留；若本章回收线索，回收点必须保留。
- 每段 paragraph.kind 标注其可拍摄类型（dialogue/action/narration/transition/clue/other）。

【风险自报】
- report.cut 诚实记录删了什么、为什么删；
- report.compressed 记录如何压缩；
- 对可能伤及线索的删减写进 report.clue_safety_notes；
- 对删减后可能让观众看不懂的地方，在 report.risks 里标注 red/yellow。

【硬约束】
1. 忠于原文：只删减、合并、微缩，绝不新增事实、对白或动作。
2. 字数预算：目标字数必须落在预算区间内（±10%）。
3. 只输出一个合法 JSON 对象。`;
}

export function buildCondensePrompt(input: CondenseContextInput): string {
  const bible = input.styleBible;
  return [
    `【本章】第 ${input.chapterIdx} 章${input.chapterTitle ? ` · ${input.chapterTitle}` : ""}`,
    `【精简目标】原文 ${input.sourceChars} 字 → 精简到 ${input.targetChars} 字左右（压缩率约 ${(input.ratio * 100).toFixed(0)}%，允许 ±10% 误差）。`,
    `【风格圣经】${bible ? `视觉：${bible.visual_style}；旁白基调：${bible.narration_tone}` : "（未批准，按本章基调保守处理）"}`,
    `【剧透规则】${(bible?.spoiler_rules ?? []).join("；") || "无"}`,
    `【人物】${input.characters.map((c) => `${c.name}（${c.role}${c.description ? `，${c.description}` : ""}）`).join("；") || "无"}`,
    `【必须保住的线索】${input.clues.map((c) => `${c.name}：${c.description}${c.is_spoiler ? "（剧透禁画）" : ""}${c.is_red_herring ? "（红鲱鱼）" : ""}`).join("；") || "无"}`,
    `【前情摘要】${input.previousSummaries.length > 0 ? input.previousSummaries.join("\n") : "（本章为全书开头）"}`,
    `【原文】`,
    input.chapterText,
  ].join("\n\n");
}

/** 输出体积护栏（防截断，与 adapt 同思路） */
export const CONDENSE_OUTPUT_BUDGET_HINT = [
  "输出体积预算：paragraphs ≤ 60；单段 text ≤ 300 字；每段 source_spans ≤ 24 个；",
  "精简后总字数必须落在目标字数的 60%~115% 区间；低于 60% 就是删减过度，请补回可拍摄细节、对白和动作。",
  "report 只记要点，不得回贴大段原文；总输出控制在 8000 token 以内。",
].join("\n");

export function condenseParagraphsToText(paragraphs: CondenseParagraph[]): string {
  return paragraphs.map((p) => p.text.trim()).filter(Boolean).join("\n\n");
}
