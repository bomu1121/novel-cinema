import { describe, expect, it } from "vitest";
import { validateAdaptation } from "./adapt";
import type { AdaptedChapter } from "@/lib/pipeline/schemas/adapt";
import type { AdaptContextInput } from "@/lib/pipeline/prompts/adapt";

const chapterText = "第一章 雨夜\n\n雨下得很大。林晚站在窗边，回头看向陈默：“这扇窗是从里面反锁的。”陈默皱眉，没有说话。";

function makeInput(overrides: Partial<AdaptContextInput> = {}): AdaptContextInput {
  return {
    chapterIdx: 1,
    chapterTitle: "雨夜",
    chapterText,
    targetSec: 60,
    characters: [
      { name: "林晚", aliases: ["小晚"], description: "女主角", role: "protagonist" },
      { name: "陈默", aliases: [], description: "侦探", role: "detective" },
    ],
    clues: [{ name: "反锁的窗", description: "密室线索", is_spoiler: false, is_red_herring: false }],
    previousSummaries: [],
    styleBible: null,
    ...overrides,
  };
}

function makeAdapt(overrides: Partial<AdaptedChapter> = {}): AdaptedChapter {
  return {
    title: "雨夜",
    hook: "密室第一现场",
    beats: [
      {
        idx: 0,
        type: "narration",
        speaker_type: "narrator",
        character_name: null,
        text: "雨夜，林晚站在窗边。",
        emotion: "neutral",
        pace: 1.0,
        visual_note: "雨夜房间，林晚站在窗边，神情平静",
        source_span: { start_char: 0, end_char: 20, quote: "雨下得很大" },
        importance: 3,
        clue_names: [],
        flags: { spoiler: false, low_confidence: false },
        estimated_duration_sec: 4,
      },
      {
        idx: 1,
        type: "dialogue",
        speaker_type: "character",
        character_name: "林晚",
        text: "这扇窗是从里面反锁的。",
        emotion: "suspicious",
        pace: 1.0,
        visual_note: "林晚近景，手指向窗闩",
        source_span: { start_char: 20, end_char: 45, quote: "这扇窗是从里面反锁的" },
        importance: 5,
        clue_names: ["反锁的窗"],
        flags: { spoiler: false, low_confidence: false },
        estimated_duration_sec: 4,
      },
    ],
    selection_report: {
      kept: [],
      cut: [],
      compressed: [],
      clue_safety_notes: [],
      risks: [],
    },
    casting_notes: [],
    bgm_suggestion: { mood: "悬疑", intensity: 4 },
    ...overrides,
  };
}

describe("validateAdaptation", () => {
  it("合规脚本通过", () => {
    const errors = validateAdaptation(makeInput(), makeAdapt());
    expect(errors).toEqual([]);
  });

  it("说话人不在白名单时拒绝", () => {
    const adapt = makeAdapt({
      beats: [makeAdapt().beats[0], { ...makeAdapt().beats[1], character_name: "陌生人" }],
    });
    const errors = validateAdaptation(makeInput(), adapt);
    expect(errors.join()).toContain("不在人物白名单");
  });

  it("时长超预算 110% 时拒绝", () => {
    const beats = makeAdapt().beats.map((b) => ({ ...b, estimated_duration_sec: 40 }));
    const errors = validateAdaptation(makeInput({ targetSec: 60 }), makeAdapt({ beats }));
    expect(errors.join()).toContain("超过预算");
  });

  it("source_span 的 quote 无法定位时拒绝", () => {
    const adapt = makeAdapt({
      beats: [
        {
          ...makeAdapt().beats[0],
          source_span: { start_char: 0, end_char: 10, quote: "不存在的句子" },
        },
      ],
    });
    const errors = validateAdaptation(makeInput(), adapt);
    expect(errors.join()).toContain("无法在原文中定位");
  });
});
