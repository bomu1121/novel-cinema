import { describe, expect, it } from "vitest";
import { charSimilarity } from "./asr";

describe("charSimilarity", () => {
  it("完全一致为 1", () => {
    expect(charSimilarity("这扇窗是从里面反锁的", "这扇窗是从里面反锁的")).toBe(1);
  });

  it("少量误差仍保持高分", () => {
    const score = charSimilarity("这扇窗是从里面反锁的", "这扇窗是从里面反锁的。");
    expect(score).toBeGreaterThan(0.9);
  });

  it("内容严重不一致时低分", () => {
    expect(charSimilarity("这扇窗是从里面反锁的", "今天天气不错")).toBeLessThan(0.5);
  });
});
