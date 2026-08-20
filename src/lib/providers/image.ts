import { requireEnv } from "@/lib/env";

export type ImageKind = "character_ref" | "expression" | "background" | "prop" | "text_card";

export interface ImageGenSpec {
  kind: ImageKind;
  prompt: string;
  negativePrompt?: string;
  /** 目标画幅（Seedream 部分模型只支持 1:1，此值作为映射建议） */
  aspect?: "16:9" | "9:16" | "1:1";
  /** 一次生成候选数（1~4） */
  count?: number;
  seed?: number;
  /** 角色参考图 URL（i2i 模式，表情/姿势变体必传） */
  refImageUrls?: string[];
}

export interface GeneratedImage {
  url: string | null;
  b64: string | null;
  seed: number | null;
}

export interface ImageProvider {
  readonly name: string;
  generate(spec: ImageGenSpec): Promise<GeneratedImage[]>;
}

export class ImageProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProviderError";
  }
}

interface SeedreamResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string; code?: string };
}

/**
 * 火山方舟 Seedream/即梦适配器（OpenAI images 兼容风格）。
 * 模型名、size 全部走环境变量，版本更新时改配置即可，不用改代码。
 */
export class SeedreamProvider implements ImageProvider {
  readonly name = "seedream";

  private endpoint(): string {
    const base = requireEnv("IMAGE_BASE_URL");
    return `${base.replace(/\/+$/, "")}/images/generations`;
  }

  private model(kind: ImageKind, hasRef: boolean): string {
    // 有参考图 → 图生图；无参考图 → 文生图
    if (kind === "expression" || (hasRef && kind === "character_ref")) {
      return requireEnv("IMAGE_MODEL_I2I");
    }
    return requireEnv("IMAGE_MODEL_T2I");
  }

  async generate(spec: ImageGenSpec): Promise<GeneratedImage[]> {
    const hasRef = Boolean(spec.refImageUrls?.length);
    const body: Record<string, unknown> = {
      model: this.model(spec.kind, hasRef),
      prompt: [spec.prompt, spec.negativePrompt ? `negative: ${spec.negativePrompt}` : ""]
        .filter(Boolean)
        .join(" "),
      n: Math.min(4, Math.max(1, spec.count ?? 3)),
      size: process.env.IMAGE_SIZE || "1K",
      response_format: "url",
      watermark: false,
    };
    if (spec.seed != null) body.seed = spec.seed;
    if (hasRef) body.image = spec.refImageUrls;

    let res: Response;
    let useWatermarkParam = true;
    try {
      res = await this.post(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 部分模型/账号不支持 watermark=false，去掉该参数重试一次
      if (!/watermark/i.test(msg)) throw err;
      useWatermarkParam = false;
      delete body.watermark;
      res = await this.post(body);
    }

    const text = await res.text();
    let json: SeedreamResponse;
    try {
      json = JSON.parse(text) as SeedreamResponse;
    } catch {
      throw new ImageProviderError(`Seedream 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 300)}`);
    }
    if (!res.ok || json.error) {
      // 400 时 body 里可能才是真正的业务错误：watermark 参数不支持则去掉重试一次
      if (useWatermarkParam && /watermark/i.test(json.error?.message ?? text)) {
        delete body.watermark;
        res = await this.post(body);
        const retryText = await res.text();
        try {
          json = JSON.parse(retryText) as SeedreamResponse;
        } catch {
          throw new ImageProviderError(`Seedream 重试返回非 JSON（HTTP ${res.status}）`);
        }
      }
      if (!res.ok || json.error) {
        throw new ImageProviderError(
          `Seedream 生成失败（HTTP ${res.status}）：${json.error?.message ?? text.slice(0, 300)}`,
        );
      }
    }

    const images = json.data ?? [];
    if (images.length === 0) {
      throw new ImageProviderError("Seedream 返回了空 data");
    }
    return images.map((img) => ({
      url: img.url ?? null,
      b64: img.b64_json ?? null,
      seed: spec.seed ?? null,
    }));
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireEnv("IMAGE_API_KEY")}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 400) {
      // 4xx 交由调用方解析错误体后决定是否重试
      const text = await res.text();
      throw new ImageProviderError(`Seedream HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }
}

let provider: ImageProvider | null = null;

export function getImageProvider(): ImageProvider {
  if (provider) return provider;
  const name = (process.env.IMAGE_PROVIDER || "seedream").toLowerCase();
  if (name !== "seedream") {
    throw new Error(`不支持的 IMAGE_PROVIDER: ${name}（当前仅支持 seedream）`);
  }
  provider = new SeedreamProvider();
  return provider;
}
