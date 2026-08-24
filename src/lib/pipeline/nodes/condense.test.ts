import { describe, expect, it } from "vitest";
import {
  repairCondenseSpans,
  targetCharsForSource,
  validateCondensation,
  DEFAULT_CONDENSE_RATIO,
} from "./condense";
import {
  buildCondensePrompt,
  buildCondenseSystem,
  condenseParagraphsToText,
} from "@/lib/pipeline/prompts/condense";
import type { CondensedChapter } from "@/lib/pipeline/schemas/condense";

const chapterText = "雨下得很大。他推开门走了进去。屋里很黑。有人在窗边低声说：“你来了。”";

function makeResult(overrides: Partial<CondensedChapter> = {}): CondensedChapter {
  const paragraphs = [
    {
      idx: 0,
      text: "雨下得很大。他推开门走了进去。",
      kind: "action" as const,
      source_spans: [{ start_char: 0, end_char: 12, quote: "雨下得很大。他推开门走了进去。" }],
    },
    {
      idx: 1,
      text: "“你来了。”",
      kind: "dialogue" as const,
      source_spans: [{ start_char: 26, end_char: 31, quote: "“你来了。”" }],
    },
  ];
  return {
    title: "雨夜来客",
    hook: "雨夜，有人来访。",
    paragraphs,
    report: { kept: [], cut: [], compressed: [], clue_safety_notes: [], risks: [] },
    ...overrides,
  };
}

describe("condense · 字数预算", () => {
  it("默认 35% 并夹在 400~6000 字之间", () => {
    expect(DEFAULT_CONDENSE_RATIO).toBe(0.35);
    expect(targetCharsForSource(3000)).toBe(1050);
    expect(targetCharsForSource(100)).toBe(400);
    expect(targetCharsForSource(50000)).toBe(6000);
  });
});

describe("condense · 确定性校验", () => {
  it("通过合法精简稿", () => {
    const errors = validateCondensation(chapterText, 20, makeResult());
    expect(errors).toEqual([]);
  });

  it("拒绝删减过狠的稿子", () => {
    const errors = validateCondensation(chapterText, 100, makeResult());
    expect(errors.some((e) => e.includes("60%"))).toBe(true);
  });

  it("拒绝无法逐字定位到原文的 source_span", () => {
    const bad = makeResult();
    bad.paragraphs[0].source_spans = [{ start_char: 0, end_char: 3, quote: "不存在的句子" }];
    const errors = validateCondensation(chapterText, 20, bad);
    expect(errors.some((e) => e.includes("无法在原文中逐字定位"))).toBe(true);
  });

  it("repairCondenseSpans 能把转述 quote 修正为原文切片", () => {
    const bad = makeResult();
    bad.paragraphs[0].source_spans = [{ start_char: 0, end_char: 20, quote: "雨下得很大，他推开门走了进去。" }];
    const repaired = repairCondenseSpans(chapterText, bad);
    expect(repaired).toBeGreaterThan(0);
    const errors = validateCondensation(chapterText, 20, bad);
    expect(errors).toEqual([]);
  });
});

describe("condense · 提示词（视频向而非摘要）", () => {
  it("系统提示词明确禁止概括转述，要求可拍摄内容", () => {
    const system = buildCondenseSystem();
    expect(system).toContain("不是写摘要");
    expect(system).toContain("禁止概括转述");
    expect(system).toContain("只保留可拍摄内容");
    expect(system).toContain("绝不新增事实");
  });

  it("用户提示词包含字数预算与原文", () => {
    const prompt = buildCondensePrompt({
      chapterIdx: 1,
      chapterTitle: "雨夜",
      chapterText,
      sourceChars: 30,
      targetChars: 12,
      ratio: 0.4,
      characters: [],
      clues: [],
      previousSummaries: [],
      styleBible: null,
    });
    expect(prompt).toContain("30 字 → 精简到 12 字");
    expect(prompt).toContain(chapterText);
  });

  it("段落拼接为可直接编辑的纯文本底稿", () => {
    const text = condenseParagraphsToText(makeResult().paragraphs);
    expect(text).toBe("雨下得很大。他推开门走了进去。\n\n“你来了。”");
  });
});
