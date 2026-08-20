import { randomUUID } from "node:crypto";
import { requireEnv } from "@/lib/env";

export interface TTSSpec {
  text: string;
  /** 火山音色 ID，例如 zh_female_vv_uranus_bigtts */
  speaker: string;
  /** 语速 [-50,100]，100=2.0x，-50=0.5x */
  speechRate?: number;
  /** 音调 [-12,12] */
  pitchRate?: number;
  /** 音量 [-50,100] */
  loudnessRate?: number;
  format?: "mp3" | "pcm" | "ogg_opus";
  sampleRate?: number;
}

export interface TTSResult {
  audio: Uint8Array;
  format: string;
}

export class TTSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TTSError";
  }
}

/**
 * 火山引擎豆包语音合成（HTTP Chunked/SSE 单向流式 V3）。
 * 参考官方 skill：openspeech.bytedance.com/api/v3/tts/unidirectional/sse
 */
export class VolcengineTTSProvider {
  readonly name = "volcengine";

  private endpoint(): string {
    const base = (process.env.TTS_API_BASE || "openspeech.bytedance.com").replace(/^https?:\/\//, "");
    return `https://${base}/api/v3/tts/unidirectional/sse`;
  }

  async synthesize(spec: TTSSpec): Promise<TTSResult> {
    const format = spec.format ?? "mp3";
    const sampleRate = spec.sampleRate ?? 24000;
    const speechRate = Math.max(-50, Math.min(100, Math.round(spec.speechRate ?? 0)));
    const pitchRate = Math.max(-12, Math.min(12, Math.round(spec.pitchRate ?? 0)));
    const loudnessRate = Math.max(-50, Math.min(100, Math.round(spec.loudnessRate ?? 0)));

    const audioParams: Record<string, unknown> = {
      format,
      speech_rate: speechRate,
      loudness_rate: loudnessRate,
    };
    if (format === "mp3" || format === "ogg_opus") {
      audioParams.bit_rate = 128000;
    }

    const body = {
      user: { uid: "novel-cinema" },
      req_params: {
        text: spec.text.trim(),
        speaker: spec.speaker,
        sample_rate: sampleRate,
        audio_params: audioParams,
        additions: JSON.stringify({
          post_process: { pitch: pitchRate },
          disable_markdown_filter: true,
          enable_latex_tn: false,
        }),
      },
    };

    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Resource-Id": process.env.TTS_RESOURCE_ID || "seed-tts-2.0",
        "X-Api-Request-Id": randomUUID(),
        "X-Api-Key": requireEnv("TTS_API_KEY"),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new TTSError(`TTS HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    // 解析 SSE：data: {...}，音频块在 data 字段（base64）
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const chunks: Buffer[] = [];
    let sawError = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            code?: number;
            message?: string;
            data?: string;
          };
          const code = parsed.code ?? 0;
          if (code !== 0 && code !== 20000000) {
            sawError = `code=${code} ${parsed.message ?? ""}`;
            continue;
          }
          if (parsed.data) {
            chunks.push(Buffer.from(parsed.data, "base64"));
          }
        } catch {
          // 忽略无法解析的行（保底：不因一行坏数据废掉整段音频）
        }
      }
    }

    if (sawError) throw new TTSError(sawError);
    if (chunks.length === 0) throw new TTSError("TTS 没有返回音频数据");

    return { audio: Buffer.concat(chunks), format };
  }
}

let ttsProvider: VolcengineTTSProvider | null = null;

export function getTTSProvider(): VolcengineTTSProvider {
  if (!ttsProvider) ttsProvider = new VolcengineTTSProvider();
  return ttsProvider;
}
