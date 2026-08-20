import { z } from "zod";

/**
 * 服务端环境变量白名单。
 * 只有在这里声明的变量才允许被服务端代码读取，避免拼错 key 静默失败。
 */
const envSchema = z.object({
  // LLM（OpenAI 兼容）
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_CHEAP_MODEL: z.string().optional(),
  LLM_STRONG_MODEL: z.string().optional(),

  // 图像 / TTS / ASR / 渲染
  IMAGE_PROVIDER: z.string().optional(),
  IMAGE_API_KEY: z.string().optional(),
  IMAGE_BASE_URL: z.string().optional(),
  IMAGE_MODEL_T2I: z.string().optional(),
  IMAGE_MODEL_I2I: z.string().optional(),
  IMAGE_SIZE: z.string().optional(),
  TTS_PROVIDER: z.string().optional(),
  TTS_API_KEY: z.string().optional(),
  TTS_API_BASE: z.string().optional(),
  TTS_RESOURCE_ID: z.string().optional(),
  TTS_NARRATOR_SPEAKER: z.string().optional(),
  TTS_CHARACTER_SPEAKERS: z.string().optional(),
  ASR_PROVIDER: z.string().optional(),
  ASR_API_KEY: z.string().optional(),
  ASR_BASE_URL: z.string().optional(),
  ASR_MODEL: z.string().optional(),
  RENDER_ENDPOINT: z.string().optional(),

  // 本地数据目录（默认 ./data）
  NOVEL_CINEMA_DATA_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  return envSchema.parse(process.env);
}

/** 要求某个服务端变量必须存在（在节点真正需要时调用，而非应用启动时）。 */
export function requireEnv<T extends keyof Env>(key: T): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}
