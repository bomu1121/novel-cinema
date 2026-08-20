import { z } from "zod";

export const EMOTIONS = [
  "neutral",
  "calm",
  "happy",
  "sad",
  "angry",
  "fear",
  "surprise",
  "suspicious",
  "nervous",
  "pain",
  "determined",
  "whisper",
] as const;

export const emotionSchema = z.enum(EMOTIONS);

export const beatTypeSchema = z.enum([
  "narration",
  "dialogue",
  "action",
  "insert_card",
  "montage",
  "transition",
]);

export const speakerTypeSchema = z.enum(["narrator", "character", "onscreen_text", "none"]);

export const sourceSpanSchema = z.object({
  start_char: z.number().int().min(0),
  end_char: z.number().int().min(0),
  quote: z.string().min(1),
});

export const beatSchema = z.object({
  idx: z.number().int().min(0),
  type: beatTypeSchema,
  speaker_type: speakerTypeSchema,
  /** 说话人姓名；必须在人物白名单内，旁白时可为 null */
  character_name: z.string().nullable().default(null),
  /** 旁白稿或台词（口语化） */
  text: z.string().min(1),
  emotion: emotionSchema.default("neutral"),
  pace: z.number().min(0.8).max(1.3).default(1.0),
  visual_note: z.string().min(1),
  source_span: sourceSpanSchema,
  importance: z.number().int().min(1).max(5).default(3),
  clue_names: z.array(z.string()).default([]),
  flags: z
    .object({
      spoiler: z.boolean().default(false),
      low_confidence: z.boolean().default(false),
    })
    .default({ spoiler: false, low_confidence: false }),
  estimated_duration_sec: z.number().positive(),
});

export const selectionReportSchema = z.object({
  kept: z
    .array(z.object({ span: z.string().default(""), reason: z.string().default("") }))
    .default([]),
  cut: z
    .array(z.object({ summary: z.string(), reason: z.string().default("") }))
    .default([]),
  compressed: z
    .array(z.object({ span: z.string().default(""), from: z.string().default(""), to: z.string() }))
    .default([]),
  clue_safety_notes: z.array(z.string()).default([]),
  risks: z
    .array(z.object({ severity: z.enum(["red", "yellow"]), text: z.string() }))
    .default([]),
});

export const adaptedChapterSchema = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  beats: z.array(beatSchema).min(1).max(80),
  selection_report: selectionReportSchema,
  casting_notes: z.array(z.string()).default([]),
  bgm_suggestion: z
    .object({ mood: z.string().default(""), intensity: z.number().min(0).max(10).default(3) })
    .default({ mood: "", intensity: 3 }),
});

export type AdaptedChapter = z.infer<typeof adaptedChapterSchema>;
export type Beat = z.infer<typeof beatSchema>;
export type SelectionReport = z.infer<typeof selectionReportSchema>;

/** C20 review.script 自检输出 */
export const reviewItemSchema = z.object({
  severity: z.enum(["red", "yellow"]),
  beat_idx: z.number().int().min(0),
  kind: z.enum(["fidelity", "clue", "spoiler", "pacing", "voice"]),
  issue: z.string(),
  suggestion: z.string().default(""),
});

export const scriptReviewSchema = z.object({
  verdict: z.enum(["ready", "needs_work"]),
  items: z.array(reviewItemSchema).default([]),
});

export type ScriptReview = z.infer<typeof scriptReviewSchema>;
export type ReviewItem = z.infer<typeof reviewItemSchema>;
