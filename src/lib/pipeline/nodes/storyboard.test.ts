import { describe, expect, it } from "vitest";
import { mergeDuplicateShots, type ShotDraft } from "./storyboard";

function draft(overrides: Partial<ShotDraft> = {}): ShotDraft {
  return {
    beatId: "b1",
    beatIdx: 0,
    idx: 0,
    text: "",
    description: "测试",
    camera: "static",
    durationSec: 2.5,
    transitionIn: "cut",
    transitionOut: "cut",
    backgroundAssetId: "bg1",
    layers: [],
    ...overrides,
  };
}

describe("mergeDuplicateShots（相同画面硬切修复）", () => {
  it("同 beat 相同背景/图层/机位 + 硬切 → 合并为一个镜头", () => {
    const merged = mergeDuplicateShots([
      draft({ idx: 0, durationSec: 2.5, transitionOut: "cut" }),
      draft({ idx: 1, durationSec: 2.5, transitionIn: "cut", transitionOut: "fade_out" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].durationSec).toBe(5);
    expect(merged[0].transitionOut).toBe("fade_out"); // 保留后镜的出点
  });

  it("背景不同则不合并", () => {
    const merged = mergeDuplicateShots([
      draft({ idx: 0, backgroundAssetId: "bg1" }),
      draft({ idx: 1, backgroundAssetId: "bg2" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("跨 beat 不合并（即使画面相同）", () => {
    const merged = mergeDuplicateShots([
      draft({ idx: 0, beatId: "b1" }),
      draft({ idx: 0, beatId: "b2" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("有重叠转场不合并", () => {
    const merged = mergeDuplicateShots([
      draft({ idx: 0, transitionOut: "crossfade" }),
      draft({ idx: 1, transitionIn: "cut" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});
