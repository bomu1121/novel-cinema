import { requireEnv } from "@/lib/env";

export class ASRNotConfiguredError extends Error {
  constructor() {
    super("未配置 ASR_API_KEY / ASR_BASE_URL，跳过回读校验");
    this.name = "ASRNotConfiguredError";
  }
}

/** 是否配置了 Whisper 兼容 ASR（OpenAI /audio/transcriptions 协议） */
export function isASRConfigured(): boolean {
  return Boolean(process.env.ASR_API_KEY && process.env.ASR_BASE_URL);
}

export async function transcribe(audio: Uint8Array, filename = "audio.mp3"): Promise<string> {
  if (!isASRConfigured()) throw new ASRNotConfiguredError();

  const base = requireEnv("ASR_BASE_URL").replace(/\/+$/, "");
  const form = new FormData();
  form.set("file", new Blob([audio as BlobPart], { type: "audio/mpeg" }), filename);
  form.set("model", process.env.ASR_MODEL || "whisper-1");
  form.set("language", "zh");

  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireEnv("ASR_API_KEY")}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ASR HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

/** 字符级相似度：最长公共子序列 / 目标长度（中文台词快速校验够用） */
export function charSimilarity(target: string, actual: string): number {
  const a = target.replace(/\s/g, "");
  const b = actual.replace(/\s/g, "");
  if (!a) return 0;
  const dp: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length] / a.length;
}
