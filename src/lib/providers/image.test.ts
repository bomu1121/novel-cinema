import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getImageProvider } from "./image";

beforeAll(() => {
  process.env.IMAGE_API_KEY = "test-ark-key";
  process.env.IMAGE_BASE_URL = "https://ark.test/api/v3";
  process.env.IMAGE_MODEL_T2I = "test-t2i";
  process.env.IMAGE_MODEL_I2I = "test-i2i";
  process.env.IMAGE_SIZE = "1K";
  process.env.IMAGE_SIZE_16X9 = "1280x720";
  process.env.IMAGE_SIZE_9X16 = "720x1280";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okImages(n: number) {
  return new Response(
    JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ url: `https://img.test/${i}.png` })) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("SeedreamProvider", () => {
  it("无参考图走 T2I 模型，n=候选数", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okImages(3));
    vi.stubGlobal("fetch", fetchMock);

    const images = await getImageProvider().generate({
      kind: "character_ref",
      prompt: "a detective, film noir",
      count: 3,
    });

    expect(images).toHaveLength(3);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("test-t2i");
    expect(body.n).toBe(3);
    expect(body.image).toBeUndefined();
    expect(body.watermark).toBe(false);
  });

  it("表情变体带参考图走 I2I 模型", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okImages(2));
    vi.stubGlobal("fetch", fetchMock);

    await getImageProvider().generate({
      kind: "expression",
      prompt: "same character, suspicious expression",
      refImageUrls: ["https://ref.test/char.png"],
      count: 2,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("test-i2i");
    expect(body.image).toEqual(["https://ref.test/char.png"]);
  });

  it("背景 16:9 / 竖版 9:16 使用对应尺寸", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okImages(1))
      .mockResolvedValueOnce(okImages(1));
    vi.stubGlobal("fetch", fetchMock);

    await getImageProvider().generate({ kind: "background", prompt: "wide", aspect: "16:9", count: 1 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).size).toBe("1280x720");

    await getImageProvider().generate({ kind: "background", prompt: "tall", aspect: "9:16", count: 1 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).size).toBe("720x1280");
  });

  it("watermark 参数被拒绝时自动去掉重试", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "watermark param not supported" } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(okImages(1));
    vi.stubGlobal("fetch", fetchMock);

    const images = await getImageProvider().generate({
      kind: "background",
      prompt: "rainy alley at night",
      count: 1,
    });

    expect(images).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.watermark).toBeUndefined();
  });
});
