import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/db";
import { requireEnv } from "@/lib/env";

export type ModelTier = "cheap" | "strong";

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
}

export interface LLMResult<T> {
  data: T;
  usage: LLMUsage | null;
  attempts: number;
}

export interface CompleteJSONOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** cheap = 粗读/抽取；strong = 改编/合并/自检 */
  tier?: ModelTier;
  temperature?: number;
  maxTokens?: number;
  /** 传入则把调用成本写进 jobs 表（book_id 必填） */
  bookId?: string;
  node?: string;
  maxAttempts?: number;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastIssue?: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

function resolveModel(tier: ModelTier): string {
  const strong = requireEnv("LLM_STRONG_MODEL");
  if (tier === "strong") return strong;
  return process.env.LLM_CHEAP_MODEL || strong;
}

function baseUrl(): string {
  const base = requireEnv("LLM_BASE_URL");
  return base.replace(/\/+$/, "");
}

function schemaInstruction<T>(schema: z.ZodType<T>): string {
  let json: string;
  try {
    json = JSON.stringify(z.toJSONSchema(schema), null, 2);
  } catch {
    json = "（schema 无法序列化，按字段描述输出）";
  }
  return `\n\n【输出格式】你必须只输出一个合法 JSON 对象，不要输出任何解释、注释或 Markdown 代码块。JSON 必须符合以下 schema：\n${json}`;
}

/** 从模型输出中提取 JSON 对象（容忍代码块围栏与前后噪声） */
function extractJson(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last <= first) {
    throw new Error("模型输出中没有 JSON 对象");
  }
  return stripped.slice(first, last + 1);
}

async function postChat(
  messages: ChatMessage[],
  opts: { tier: ModelTier; temperature: number; maxTokens?: number; useJsonMode: boolean },
): Promise<{ content: string; usage: LLMUsage | null; model: string }> {
  const body: Record<string, unknown> = {
    model: resolveModel(opts.tier),
    messages,
    temperature: opts.temperature,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.useJsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("LLM_API_KEY")}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM 返回了空的 choices[0].message.content");
  }

  const usage = data.usage
    ? {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
        model: data.model ?? resolveModel(opts.tier),
      }
    : null;

  return { content, usage, model: data.model ?? resolveModel(opts.tier) };
}

async function logJob(
  bookId: string | undefined,
  node: string | undefined,
  status: "succeeded" | "failed",
  usage: LLMUsage | null,
  attempts: number,
  error: unknown,
): Promise<void> {
  if (!bookId || !node) return;
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("jobs").insert({
      book_id: bookId,
      node,
      status,
      attempt: attempts,
      max_attempts: 3,
      cost: {
        input_tokens: usage?.promptTokens ?? 0,
        output_tokens: usage?.completionTokens ?? 0,
        model: usage?.model ?? null,
      },
      error: error ? { message: error instanceof Error ? error.message : String(error) } : null,
      finished_at: new Date().toISOString(),
    });
  } catch (dbErr) {
    // 成本留痕失败不应打断主流程（例如 DB 尚未配置）
    console.warn("[llm] 写入 jobs 失败:", dbErr);
  }
}

/**
 * 调用 OpenAI 兼容接口并要求结构化 JSON 输出。
 * schema 校验失败会把错误反馈回模型重试，而不是无脑重跑。
 */
export async function completeJSON<T>(opts: CompleteJSONOptions<T>): Promise<LLMResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const temperature = opts.temperature ?? 0.4;
  const system = opts.system + schemaInstruction(opts.schema);
  let lastIssue = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let jsonModeFailed = false;
    try {
      const userPrompt = lastIssue
        ? `${opts.prompt}\n\n【上次输出未通过校验，请修正】\n${lastIssue}\n请重新输出符合 schema 的 JSON。`
        : opts.prompt;

      let result;
      try {
        result = await postChat(
          [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
          {
            tier: opts.tier ?? "cheap",
            temperature,
            maxTokens: opts.maxTokens,
            useJsonMode: true,
          },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/response_format/i.test(msg)) throw err;
        // 个别兼容端不支持 response_format，降级为纯 prompt 约束
        jsonModeFailed = true;
        result = await postChat(
          [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
          {
            tier: opts.tier ?? "cheap",
            temperature,
            maxTokens: opts.maxTokens,
            useJsonMode: false,
          },
        );
      }

      const parsed = JSON.parse(extractJson(result.content)) as unknown;
      const validated = opts.schema.safeParse(parsed);
      if (validated.success) {
        await logJob(opts.bookId, opts.node, "succeeded", result.usage, attempt, null);
        return { data: validated.data, usage: result.usage, attempts: attempt };
      }

      lastIssue = validated.error.issues
        .map((issue) => `路径 ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
    } catch (err) {
      lastIssue = err instanceof Error ? err.message : String(err);
      if (jsonModeFailed) {
        // 降级后仍失败，不再重试同一请求
        throw new LLMError(`LLM 结构化输出失败：${lastIssue}`, attempt, lastIssue);
      }
    }

    if (attempt < maxAttempts) {
      // 简单退避，避免打爆兼容端限流
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  await logJob(opts.bookId, opts.node, "failed", null, maxAttempts, new Error(lastIssue));
  throw new LLMError(`LLM 结构化输出在 ${maxAttempts} 次尝试后仍未通过校验`, maxAttempts, lastIssue);
}

/** 非结构化文本补全（自检、重写等场景） */
export async function completeText(opts: {
  system: string;
  prompt: string;
  tier?: ModelTier;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const result = await postChat(
    [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
    {
      tier: opts.tier ?? "cheap",
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens,
      useJsonMode: false,
    },
  );
  return result.content;
}
