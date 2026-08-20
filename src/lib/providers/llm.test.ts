import { z } from "zod";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { completeJSON, LLMError } from "./llm";

const schema = z.object({
  name: z.string(),
  age: z.number().int().positive(),
});

function okResponse(content: string, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage,
        model: "test-model",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

beforeAll(() => {
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://llm.test/v1";
  process.env.LLM_STRONG_MODEL = "test-strong";
  process.env.LLM_CHEAP_MODEL = "test-cheap";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("completeJSON", () => {
  it("解析成功（容忍 markdown 代码块围栏）", async () => {
    const fetchMock = vi.fn().mockReturnValue(okResponse('```json\n{"name":"小林","age":28}\n```'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeJSON({
      system: "你是测试",
      prompt: "输出一个人",
      schema,
    });

    expect(result.data).toEqual({ name: "小林", age: 28 });
    expect(result.attempts).toBe(1);
    expect(result.usage?.model).toBe("test-model");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("test-cheap"); // 默认 cheap 档
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("schema 校验失败时把错误反馈给模型并重试", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(okResponse(JSON.stringify({ name: "小林", age: -1 })))
      .mockReturnValueOnce(okResponse(JSON.stringify({ name: "小林", age: 28 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await completeJSON({ system: "s", prompt: "p", schema });

    expect(result.data).toEqual({ name: "小林", age: 28 });
    expect(result.attempts).toBe(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.messages[1].content).toContain("上次输出未通过校验");
  });

  it("多次校验失败后抛出 LLMError", async () => {
    const fetchMock = vi.fn().mockReturnValue(okResponse(JSON.stringify({ wrong: true })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completeJSON({ system: "s", prompt: "p", schema, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(LLMError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
