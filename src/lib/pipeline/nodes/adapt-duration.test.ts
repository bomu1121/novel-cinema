import { describe, expect, it } from "vitest";
import { isOnlyDurationError, repairSourceSpans, applyDurationCap } from "./adapt";

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
});
