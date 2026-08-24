import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import {
  cleanAndSplit,
  cleanBytes,
  detectAndDecode,
  detectHeading,
  parseChineseNumber,
  reflowParagraphs,
} from "./clean";

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

  it("识别无 BOM 的 UTF-16LE 中文文本", () => {
    const body = Buffer.from("第一章 雨夜，他推开了门。", "utf16le");
    const { encoding, text } = detectAndDecode(body);
    expect(encoding).toBe("utf-16le");
    expect(text).toContain("雨夜");
  });

  it("Big5 繁体文本不被误判为 GB18030", () => {
    const buf = iconv.encode("第一章 雨夜，他推開了門，後來個個都來了。", "big5");
    const { encoding, text } = detectAndDecode(buf);
    expect(encoding).toBe("big5");
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
    const text = ["第一章 测试", "重复行内容", "重复行内容", "重复行内容", "正文内容。"].join("\n");
    const result = cleanAndSplit(text);
    const cleaned = result.chapters.find((c) => c.idx === 1)!;
    expect(cleaned.cleanedText.match(/重复行内容/g)).toHaveLength(1);
    expect(result.report.dedupedLines).toBeGreaterThan(0);
  });

  it("非相邻的重复水印行也会被折叠", () => {
    const text = [
      "第一章 测试",
      "正文第一段。",
      "请收藏本站 www.example.com",
      "正文第二段。",
      "请收藏本站 www.example.com",
    ].join("\n");
    const result = cleanAndSplit(text);
    const cleaned = result.chapters.find((c) => c.idx === 1)!;
    // 水印行直接被识别删除，不再进入正文
    expect(cleaned.cleanedText).not.toContain("example.com");
    expect(cleaned.cleanedText).toContain("正文第一段。");
  });

  it("删除文末“全文完”标记", () => {
    const text = ["第一章 雨夜", "雨下得很大。", "（全文完）"].join("\n");
    const result = cleanAndSplit(text);
    const cleaned = result.chapters.find((c) => c.idx === 1)!;
    expect(cleaned.cleanedText).not.toContain("全文完");
    expect(result.report.tailRemoved).toBe(true);
  });
});

describe("reflowParagraphs · 段落重排", () => {
  it("把硬换行打断的短行合并为完整段落", () => {
    const lines = ["他推开", "那扇虚掩的", "木门走了进去。", "屋里很黑。"];
    const paragraphs = reflowParagraphs(lines);
    expect(paragraphs).toEqual(["他推开那扇虚掩的木门走了进去。", "屋里很黑。"]);
  });

  it("句子结束处不合并", () => {
    const lines = ["雨下得很大。", "有人敲门。"];
    const paragraphs = reflowParagraphs(lines);
    expect(paragraphs).toEqual(["雨下得很大。", "有人敲门。"]);
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

  it("识别“正文 第X章”前缀", () => {
    const text = ["正文 第一章 雨夜", "雨下得很大。", "正文 第二章 来客", "有人敲门。"].join("\n");
    const result = cleanAndSplit(text);
    expect(result.chapters.find((c) => c.idx === 1)?.title).toBe("雨夜");
    expect(result.chapters.find((c) => c.idx === 2)?.title).toBe("来客");
  });

  it("识别 卷X 独立卷标题，并写入下一章 parse_meta", () => {
    const text = ["卷一 少年", "第一章 雨夜", "雨下得很大。"].join("\n");
    const result = cleanAndSplit(text);
    const first = result.chapters.find((c) => c.idx === 1);
    expect(first?.kind).toBe("chapter");
    expect(first?.parseMeta.volume).toEqual({ unit: "卷", title: "少年" });
  });

  it("卷标题后跟随正文时保留为 part 章节", () => {
    const text = ["第一卷 少年", "这是卷首引语。", "第一章 雨夜", "雨下得很大。"].join("\n");
    const result = cleanAndSplit(text);
    const part = result.chapters.find((c) => c.kind === "part");
    expect(part?.title).toBe("少年");
  });

  it("识别英文 Chapter 标题", () => {
    const text = ["Chapter 1: Rainy Night", "It was raining.", "Chapter 2", "Someone knocked."].join("\n");
    const result = cleanAndSplit(text);
    const chapters = result.chapters.filter((c) => c.kind === "chapter");
    expect(chapters.length).toBe(2);
    expect(chapters[0].title).toContain("Rainy Night");
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

describe("parseChineseNumber", () => {
  it("解析阿拉伯数字与中文数字章节序号", () => {
    expect(parseChineseNumber("12")).toBe(12);
    expect(parseChineseNumber("十二")).toBe(12);
    expect(parseChineseNumber("二十")).toBe(20);
    expect(parseChineseNumber("一百二十三")).toBe(123);
    expect(parseChineseNumber("一千零一")).toBe(1001);
  });
});

describe("detectHeading · 规则融合与误判护栏", () => {
  it("行首标题直接命中", () => {
    const heading = detectHeading("第一章 雨夜");
    expect(heading?.number).toBe(1);
    expect(heading?.unit).toBe("章");
    expect(heading?.title).toBe("雨夜");
  });

  it("前一行未断句时拒绝正文中的“第X章”字样", () => {
    const heading = detectHeading("第二章", {
      previousLine: "他说：",
      previousChapterNumber: null,
    });
    expect(heading).toBeNull();
  });

  it("序号连续可以救援弱断句场景", () => {
    const heading = detectHeading("第二章", {
      previousLine: "上一章的最后一句",
      previousChapterNumber: 1,
    });
    expect(heading?.number).toBe(2);
  });
});

describe("cleanAndSplit · 目录与误判保护", () => {
  it("跳过连续目录行，只保留带正文的真实章节", () => {
    const text = [
      "第一章 雨夜",
      "第二章 来客",
      "第三章 迷雾",
      "第四章 真相",
      "第五章 尾声",
      "第一章 雨夜",
      "雨下得很大。",
      "第二章 来客",
      "有人敲门。",
    ].join("\n");
    const result = cleanAndSplit(text);
    expect(result.report.tocLinesSkipped).toBe(5);
    expect(result.chapters.filter((c) => c.kind === "chapter")).toHaveLength(2);
    expect(result.chapters.find((c) => c.idx === 1)?.cleanedText).toContain("雨下得很大。");
    expect(result.warnings.join()).toContain("目录行 5 行");
  });

  it("正文对话里的“第二章”不会被当成标题", () => {
    const text = [
      "第一章 雨夜",
      "雨下得很大。",
      "他说：",
      "第二章",
      "是全书最精彩的部分。",
      "第三章 来客",
      "有人敲门。",
    ].join("\n");
    const result = cleanAndSplit(text);
    const chapters = result.chapters.filter((c) => c.kind === "chapter");
    expect(chapters).toHaveLength(2);
    expect(chapters[0].cleanedText).toContain("第二章是全书最精彩的部分。");
    expect(chapters[1].title).toBe("来客");
    expect(result.warnings.join()).toContain("从 1 跳到 3");
  });

  it("识别 Chap.N 分行结构（Chap.1 + 第一章 + 标题）", () => {
    const text = [
      "Chap.1",
      "第一章",
      "魔眼之匣",
      "魔眼の匣",
      "正文内容。",
      "Chap.2",
      "第二章",
      "预言与先知",
      "正文内容2。",
    ].join("\n");
    const result = cleanAndSplit(text);
    const chapters = result.chapters.filter((c) => c.kind === "chapter");
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe("魔眼之匣 魔眼の匣");
    expect(chapters[1].title).toBe("预言与先知");
    expect(chapters.every((c) => c.charCount > 0)).toBe(true);
  });

  it("Chap.N 目录后接裸序章正文时正确结束目录", () => {
    const text = [
      "序章　新生推理爱好会",
      "Chap.1　第一章　魔眼之匣",
      "Chap.2　第二章　预言与先知",
      "终章　侦探的预言",
      "序章",
      "新生推理爱好会",
      "很多年前……",
      "Chap.1",
      "第一章",
      "魔眼之匣",
      "魔眼の匣",
      "正文内容。",
    ].join("\n");
    const result = cleanAndSplit(text);
    expect(result.report.tocLinesSkipped).toBe(4);
    const chapters = result.chapters.filter((c) => c.kind === "chapter");
    expect(chapters.map((c) => c.title)).toEqual([
      "新生推理爱好会",
      "魔眼之匣 魔眼の匣",
    ]);
    expect(chapters.every((c) => c.charCount > 0)).toBe(true);
  });

  it("重复章节序号给出人工复核警告", () => {
    const text = [
      "第一章 雨夜",
      "雨下得很大。",
      "第一章 来客",
      "有人敲门。",
    ].join("\n");
    const result = cleanAndSplit(text);
    expect(result.chapters.filter((c) => c.kind === "chapter")).toHaveLength(2);
    expect(result.warnings.join()).toContain("出现 2 次");
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
