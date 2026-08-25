import { describe, expect, it } from "vitest";
import {
  isOnlyDurationError,
  repairSourceSpans,
  applyDurationCap,
  splitLongNarrations,
  validateAdaptation,
} from "./adapt";
import type { AdaptContextInput } from "@/lib/pipeline/prompts/adapt";
import type { AdaptedChapter } from "@/lib/pipeline/schemas/adapt";

describe("adapt 确定性兜底", () => {
  it("仅总时长超限 → true（可压缩兜底）", () => {
    expect(isOnlyDurationError(["总时长 191.0s 超过预算 154s 的 110%，请删减或合并 beat"])).toBe(true);
  });
  it("混有其他错误 → false（需重试）", () => {
    expect(isOnlyDurationError([
      "总时长 191.0s 超过预算 154s 的 110%，请删减或合并 beat",
      "beat[3] 旁白超过 10 秒朗读上限（约 50 字）",
    ])).toBe(false);
    expect(isOnlyDurationError(["beat[0] source_span 越界"])).toBe(false);
    expect(isOnlyDurationError([])).toBe(false);
  });

  it("repairSourceSpans：quote 失配时用 beat.text 模糊定位并修正 span", () => {
    const chapterText = "雨下得很大。林晚站在窗边。她回头看向陈默。";
    const input = { chapterText } as never;
    const adapt = {
      beats: [
        {
          idx: 0,
          type: "narration",
          text: "雨下得很大",
          source_span: { start_char: 0, end_char: 3, quote: "雨下得很大。" },
          estimated_duration_sec: 4,
        },
        {
          idx: 1,
          type: "dialogue",
          text: "她回头看向陈默",
          source_span: { start_char: 0, end_char: 2, quote: "不对的引文" },
          estimated_duration_sec: 4,
        },
      ],
    } as never;

    const repaired = repairSourceSpans(input as never, adapt as never);
    expect(repaired).toBe(1);
    const spans = (adapt as never as { beats: Array<{ source_span: { quote: string } }> }).beats.map((b) => b.source_span.quote);
    expect(spans[1]).toBe("她回头看向陈默");
  });

  it("applyDurationCap：超预算时按比例压缩到 110% 内", () => {
    const input = { targetSec: 100 } as never;
    const adapt = { beats: [{ estimated_duration_sec: 80 }, { estimated_duration_sec: 80 }] } as never;
    const applied = applyDurationCap(input as never, adapt as never);
    expect(applied).toBe(true);
    const total = (adapt as never as { beats: Array<{ estimated_duration_sec: number }> }).beats.reduce((s, b) => s + b.estimated_duration_sec, 0);
    expect(total).toBeLessThanOrEqual(110);
    expect(total).toBeGreaterThan(100);
  });

  it("splitLongNarrations：>50 字旁白拆成多条、重排 idx、重算时长", () => {
    const longNarration = "夜色越来越浓，山间的雾气像活物一样沿着石阶向上爬行，把整座孤楼吞没在灰白的寂静里，只有二楼那扇窗还亮着昏黄的灯。";
    const input = { targetSec: 100 } as never;
    const adapt = {
      beats: [
        { idx: 0, type: "narration", text: longNarration, pace: 1.0, flags: {}, source_span: { start_char: 0, end_char: 10, quote: "夜色" }, estimated_duration_sec: 12 },
        { idx: 1, type: "dialogue", text: "有人来了。", pace: 1.0, flags: {}, source_span: { start_char: 0, end_char: 5, quote: "有人" }, estimated_duration_sec: 3 },
      ],
    } as never;

    const split = splitLongNarrations(input as never, adapt as never);
    expect(split).toBeGreaterThan(0);
    const beats = (adapt as never as { beats: Array<{ idx: number; text: string; estimated_duration_sec: number; flags: Record<string, boolean> }> }).beats;
    // 拆分后每条 ≤50 字，idx 连续
    for (const b of beats) {
      expect(b.text.replace(/\s/g, "").length).toBeLessThanOrEqual(50);
      expect(b.estimated_duration_sec).toBeLessThanOrEqual(8);
    }
    beats.forEach((b, i) => expect(b.idx).toBe(i));
    expect(beats[0].flags.low_confidence).toBe(true);
  });

  it("混合错误（总时长超限 + 旁白超长）走确定性兜底后校验通过", () => {
    const chapterText = "雨下得很大。林晚站在窗边，回头看向陈默：“这扇窗是从里面反锁的。”陈默皱眉，没有说话。夜色越来越浓，山间的雾气像活物一样沿着石阶向上爬行，把整座孤楼吞没在灰白的寂静里，只有二楼那扇窗还亮着昏黄的灯光，像一只不肯闭上的眼睛。";
    const longNarration = "夜色越来越浓，山间的雾气像活物一样沿着石阶向上爬行，把整座孤楼吞没在灰白的寂静里，只有二楼那扇窗还亮着昏黄的灯光，像一只不肯闭上的眼睛。";
    const input: AdaptContextInput = {
      chapterIdx: 1,
      chapterTitle: "孤楼",
      chapterText,
      targetSec: 60,
      characters: [
        { name: "林晚", aliases: [], description: "女主角", role: "protagonist" },
        { name: "陈默", aliases: [], description: "侦探", role: "detective" },
      ],
      clues: [],
      previousSummaries: [],
      styleBible: null,
    };
    const adapt: AdaptedChapter = {
      title: "孤楼",
      hook: "密室",
      beats: [
        { idx: 0, type: "narration", speaker_type: "narrator", character_name: null, text: "雨下得很大。林晚站在窗边。", emotion: "neutral", pace: 1.0, visual_note: "", source_span: { start_char: 0, end_char: 12, quote: "雨下得很大" }, importance: 3, clue_names: [], flags: { spoiler: false, low_confidence: false }, estimated_duration_sec: 10 },
        { idx: 1, type: "dialogue", speaker_type: "character", character_name: "林晚", text: "这扇窗是从里面反锁的。", emotion: "suspicious", pace: 1.0, visual_note: "", source_span: { start_char: 13, end_char: 26, quote: "这扇窗是从里面反锁的" }, importance: 5, clue_names: [], flags: { spoiler: false, low_confidence: false }, estimated_duration_sec: 10 },
        { idx: 2, type: "narration", speaker_type: "narrator", character_name: null, text: longNarration, emotion: "neutral", pace: 1.0, visual_note: "", source_span: { start_char: 27, end_char: 40, quote: "夜色越来越浓" }, importance: 2, clue_names: [], flags: { spoiler: false, low_confidence: false }, estimated_duration_sec: 10 },
      ],
      selection_report: { kept: [], cut: [], compressed: [], clue_safety_notes: [], risks: [] },
      casting_notes: [],
      bgm_suggestion: { mood: "悬疑", intensity: 4 },
    };

    // 每条 30s 共 90s > 66s（预算 60s×1.1）+ 旁白 >50 字 → 混合错误
    adapt.beats.forEach((b) => (b.estimated_duration_sec = 30));
    const errors = validateAdaptation(input, adapt);
    expect(errors.some((e) => e.startsWith("总时长"))).toBe(true);
    expect(errors.some((e) => e.includes("旁白超过 10 秒朗读上限"))).toBe(true);

    // 走确定性兜底：span 修复 + 旁白拆分 + 时长压缩
    repairSourceSpans(input, adapt);
    splitLongNarrations(input, adapt);
    applyDurationCap(input, adapt);
    expect(validateAdaptation(input, adapt)).toEqual([]);
  });
});
