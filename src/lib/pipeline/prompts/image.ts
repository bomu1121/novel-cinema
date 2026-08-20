const EMOTION_CN: Record<string, string> = {
  neutral: "平静自然",
  calm: "平静",
  happy: "微笑",
  sad: "悲伤",
  angry: "愤怒",
  fear: "惊恐",
  surprise: "惊讶",
  suspicious: "怀疑、皱眉",
  nervous: "紧张",
  pain: "痛苦",
  determined: "坚定",
  whisper: "低声耳语、神秘",
};

const POSE_CN: Record<string, string> = {
  standing: "站立",
  sitting: "坐着",
  walking: "行走",
  pointing: "用手指向某处",
  thinking: "沉思",
};

export interface ImagePromptContext {
  visualStyle: string;
  negative: string;
  character?: {
    name: string;
    bio: Record<string, unknown>;
  };
  expression?: string;
  pose?: string;
  location?: { name: string; visualNote: string | null };
  mood?: string;
}

/** 角色设定图：全身、正脸、中性表情、纯背景（后续所有变体的基准） */
export function buildCharacterRefPrompt(ctx: ImagePromptContext): string {
  const bio = ctx.character?.bio ?? {};
  return [
    ctx.visualStyle,
    `character design sheet of ${ctx.character?.name ?? "the character"}`,
    bio.appearance ?? "",
    bio.outfit ?? "",
    "neutral expression, standing, full body, front view, plain background, clean lines",
  ]
    .filter(Boolean)
    .join(", ");
}

/** 表情变体：显式要求与参考图同人同装，是跨图一致性的关键约束 */
export function buildExpressionPrompt(ctx: ImagePromptContext): string {
  return [
    ctx.visualStyle,
    `same character as the reference image, ${ctx.character?.name ?? "the character"}`,
    `${EMOTION_CN[ctx.expression ?? "neutral"] ?? ctx.expression} expression`,
    ctx.pose ? `${POSE_CN[ctx.pose] ?? ctx.pose} pose` : "same standing pose",
    "same outfit, same face, consistent with reference",
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildBackgroundPrompt(ctx: ImagePromptContext): string {
  return [
    ctx.visualStyle,
    ctx.location?.name ?? "",
    ctx.location?.visualNote ?? "",
    ctx.mood ? `mood: ${ctx.mood}` : "",
    "establishing shot, no people, no text, no watermark",
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildNegativePrompt(extra: string | null): string {
  return [extra, "text, watermark, logo, extra fingers, deformed hands, blurry, low quality"]
    .filter(Boolean)
    .join(", ");
}
