import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getTTSProvider } from "./tts";

beforeAll(() => {
  process.env.TTS_API_KEY = "test-tts-key";
  process.env.TTS_API_BASE = "tts.test";
  process.env.TTS_RESOURCE_ID = "seed-tts-2.0";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(lines: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("VolcengineTTSProvider", () => {
  it("解析 SSE data 行并拼接 base64 音频块", async () => {
    const audio1 = Buffer.from("hello-audio-1");
    const audio2 = Buffer.from("hello-audio-2");
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        `data: ${JSON.stringify({ code: 0, data: audio1.toString("base64") })}`,
        `data: ${JSON.stringify({ code: 0, data: audio2.toString("base64") })}`,
        "data: [DONE]",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTTSProvider().synthesize({
      text: "测试台词",
      speaker: "zh_test_speaker",
      speechRate: 10,
      pitchRate: -2,
    });

    expect(Buffer.from(result.audio).toString()).toBe("hello-audio-1hello-audio-2");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.req_params.speaker).toBe("zh_test_speaker");
    expect(body.req_params.audio_params.speech_rate).toBe(10);
    expect(JSON.parse(body.req_params.additions).post_process.pitch).toBe(-2);
    expect(fetchMock.mock.calls[0][1].headers["X-Api-Resource-Id"]).toBe("seed-tts-2.0");
    expect(fetchMock.mock.calls[0][1].headers["X-Api-Key"]).toBe("test-tts-key");
  });

  it("业务错误码抛 TTSError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      sseResponse([`data: ${JSON.stringify({ code: 30000000, message: "bad text" })}`]),
    ));

    await expect(
      getTTSProvider().synthesize({ text: "x", speaker: "s" }),
    ).rejects.toThrow(/30000000/);
  });
});
