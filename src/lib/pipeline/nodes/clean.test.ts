import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { cleanAndSplit, cleanBytes, detectAndDecode } from "./clean";

describe("detectAndDecode", () => {
  it("识别 UTF-8（带 BOM）", () => {
    const body = Buffer.from("第一章 雨夜", "utf8");
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
    const { text, encoding } = detectAndDecode(buf);
    expect(encoding).toBe("utf-8");
    expect(text).toContain("雨夜");
  });

  it("识别 GB18030 文本", () => {
    const buf = iconv.encode("第一章 雨夜，他推开了门。", "gb18030");
    const { text, encoding } = detectAndDecode(buf);
    expect(encoding).toBe("gb18030");
    expect(text).toContain("第一章");
  });

  it("识别 UTF-16LE（带 BOM）", () => {
    const body = Buffer.from("第一章", "utf16le");
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
    const { encoding, text } = detectAndDecode(buf);
    expect(encoding).toBe("utf-16le");
    expect(text).toContain("第一章");
  });
});

describe("cleanAndSplit · 清洗", () => {
  it("去除盗版站水印与纯符号行", () => {
    const text = [
      "本站小说更新最快，请收藏 www.example.com",
      "====",
      "第一章 雨夜",
      "雨下得很大。",
      "更多好书请关注微信公众号：某某阅读",
    ].join("\n");
    const result = cleanAndSplit(text);
    const cleaned = result.chapters.find((c) => c.idx === 1)!;
    expect(cleaned.cleanedText).toContain("雨下得很大。");
    expect(cleaned.cleanedText).not.toContain("example.com");
    expect(cleaned.cleanedText).not.toContain("微信公众号");
  });

  it("重复 3 次以上的同一行只保留一次", () => {
    const text = ["第一章 测试", "防盗填充", "防盗填充", "防盗填充", "正文内容"].join("\n");
    const result = cleanAndSplit(text);
    const cleaned = result.chapters.find((c) => c.idx === 1)!;
    expect(cleaned.cleanedText.match(/防盗填充/g)).toHaveLength(1);
  });
});

describe("cleanAndSplit · 切章", () => {
  it("识别中文数字章节标题，并把前言放入 idx=0", () => {
    const text = [
      "这是一段作者前言。",
      "第一章 雨夜",
      "雨下得很大。",
      "第二章 来客",
      "有人敲门。",
    ].join("\n");
    const result = cleanAndSplit(text);
    expect(result.chapters.map((c) => c.idx)).toEqual([0, 1, 2]);
    expect(result.chapters[0].kind).toBe("front");
    expect(result.chapters[1].title).toBe("雨夜");
    expect(result.chapters[2].title).toBe("来客");
  });

  it("章节标题独占一行时，并入紧随的短标题行", () => {
    const text = ["第一章", "雨夜", "正文。", "第二章", "来客", "正文2。"].join("\n");
    const result = cleanAndSplit(text);
    expect(result.chapters.find((c) => c.idx === 1)?.title).toBe("雨夜");
    expect(result.chapters.find((c) => c.idx === 2)?.title).toBe("来客");
  });

  it("识别 楔子/尾声 等特殊标题", () => {
    const text = ["楔子", "很多年前……", "第一章 开端", "正文。"].join("\n");
    const result = cleanAndSplit(text);
    expect(result.chapters[0].kind).toBe("chapter");
    expect(result.chapters[0].title).toBe("楔子");
  });

  it("无章节标题时按约 5000 字兜底切段", () => {
    const paragraph = "他走在无人的街道上。".repeat(200); // 约 2400 字
    const text = Array.from({ length: 5 }, (_, i) => `第${i + 1}段。${paragraph}`).join("\n");
    const result = cleanAndSplit(text);
    expect(result.chapters.length).toBeGreaterThan(1);
    expect(result.chapters[0].kind).toBe("segment");
    expect(result.warnings.join()).toContain("未识别到章节标题");
  });
});

describe("cleanBytes", () => {
  it("端到端：GBK 字节 → 章节列表", () => {
    const text = "第一章 开端\n正文内容。";
    const result = cleanBytes(iconv.encode(text, "gb18030"));
    expect(result.encoding).toBe("gb18030");
    expect(result.totalChars).toBeGreaterThan(0);
    expect(result.chapters[0].cleanedText).toContain("正文内容");
  });
});
