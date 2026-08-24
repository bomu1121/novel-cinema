import { z } from "zod";

/**
 * condense.chapter —— 视频向“精简叙事底稿”。
 * 注意：这不是摘要。paragraphs 是可直接交给分镜/配音的可拍摄文本，
 * 每个段落必须能通过 source_spans 定位回原文。
 */

export const condenseParagraphKindSchema = z.enum([
  "dialogue",
  "action",
  "narration",
  "transition",
  "clue",
  "other",
]);

export const condenseSourceSpanSchema = z.object({
  start_char: z.number().int().min(0),
  end_char: z.number().int().min(0),
  quote: z.string().min(1),
});

export const condenseParagraphSchema = z.object({
  idx: z.number().int().min(0),
  /** 精简后的段落文本（口语/书面兼可，但必须是可拍摄的叙事） */
  text: z.string().min(1).max(600),
  kind: condenseParagraphKindSchema.default("narration"),
  /** 该段落对应的原文区间；quote 必须逐字来自原文 */
  source_spans: z.array(condenseSourceSpanSchema).min(1).max(24),
});

export const condenseReportSchema = z.object({
  kept: z
    .array(z.object({ quote: z.string().default(""), reason: z.string().default("") }))
    .default([]),
  cut: z
    .array(z.object({ summary: z.string(), reason: z.string().default("") }))
    .default([]),
  compressed: z
    .array(z.object({ from: z.string().default(""), to: z.string(), reason: z.string().default("") }))
    .default([]),
  clue_safety_notes: z.array(z.string()).default([]),
  risks: z
    .array(z.object({ severity: z.enum(["red", "yellow"]), text: z.string() }))
    .default([]),
});

export const condensedChapterSchema = z.object({
  title: z.string().min(1).max(80),
  hook: z.string().min(1).max(200),
  paragraphs: z.array(condenseParagraphSchema).min(1).max(80),
  report: condenseReportSchema,
});

export type CondensedChapter = z.infer<typeof condensedChapterSchema>;
export type CondenseParagraph = z.infer<typeof condenseParagraphSchema>;
export type CondenseReport = z.infer<typeof condenseReportSchema>;
