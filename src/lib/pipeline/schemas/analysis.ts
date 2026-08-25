import { z } from "zod";

/** 逐块抽取（B22 chunk.extract）输出 */
export const chunkCharacterSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  description: z.string().default(""),
  role: z.string().default("other"),
  appearance: z.string().default(""),
  first_seen_in_chunk: z.boolean().default(false),
});

export const chunkAnalysisSchema = z.object({
  characters: z.array(chunkCharacterSchema).default([]),
  events: z
    .array(
      z.object({
        time_label: z.string().default(""),
        description: z.string(),
        characters: z.array(z.string()).default([]),
        location: z.string().default(""),
      }),
    )
    .default([]),
  locations: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()).default([]),
        description: z.string().default(""),
        visual_note: z.string().default(""),
      }),
    )
    .default([]),
  items: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()).default([]),
        kind: z.string().default("object"),
        description: z.string().default(""),
        visual_note: z.string().default(""),
      }),
    )
    .default([]),
  clues: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()).default([]),
        clue_type: z.string().default("other"),
        description: z.string(),
        is_red_herring: z.boolean().default(false),
        is_spoiler: z.boolean().default(false),
      }),
    )
    .default([]),
  summary: z.string().min(1),
  tone: z.string().default(""),
});

export type ChunkAnalysis = z.infer<typeof chunkAnalysisSchema>;

/** 风格圣经候选（B24 bible.propose）单套 */
export const styleBibleProposalSchema = z.object({
  genre: z.array(z.string()).default([]),
  visual_style: z.string().min(1),
  art_direction: z.string().default(""),
  color_palette: z.array(z.string()).default([]),
  camera_grammar: z.object({
    dialogue: z.string().default("说话人近景，每 6 秒内切换"),
    narration: z.string().default("宽景 + 缓慢推拉"),
    transition: z.string().default("场景切换 crossfade，时间跳跃淡黑"),
  }),
  narration_tone: z.string().default(""),
  spoiler_rules: z.array(z.string()).default([]),
  negative_prompt: z.string().default(""),
  /** 为什么推荐这套（适配理由：类型契合/气氛/可绘图性） */
  rationale: z.string().default(""),
});

export const styleBibleProposalsSchema = z.object({
  proposals: z.array(styleBibleProposalSchema).min(1).max(3),
  recommended_index: z.number().int().min(0).default(0),
});

export type StyleBibleProposals = z.infer<typeof styleBibleProposalsSchema>;
export type StyleBibleProposal = z.infer<typeof styleBibleProposalSchema>;
