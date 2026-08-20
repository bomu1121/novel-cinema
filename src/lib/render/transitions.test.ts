import { describe, expect, it } from "vitest";
import {
  buildXfadeChain,
  planShotGroups,
  resolveBoundary,
  totalDurationSec,
} from "./transitions";
import type { RenderVideoTrack } from "./types";

function track(overrides: Partial<RenderVideoTrack>): RenderVideoTrack {
  return {
    shotId: Math.random().toString(36).slice(2),
    beatId: "b",
    beatIdx: 0,
    text: "",
    description: "",
    camera: "static",
    duration_sec: 2,
    transition_in: "cut",
    transition_out: "cut",
    background_url: null,
    layers: [],
    ...overrides,
  };
}

describe("resolveBoundary", () => {
  it("后镜 transition_in 优先", () => {
    const b = resolveBoundary(track({ transition_out: "crossfade" }), track({ transition_in: "dip_to_black" }));
    expect(b).toEqual({ xfade: "fadeblack", overlap: 0.6 });
  });

  it("后镜 cut 时回退到前镜 transition_out", () => {
    const b = resolveBoundary(track({ transition_out: "crossfade" }), track({ transition_in: "cut" }));
    expect(b).toEqual({ xfade: "fade", overlap: 0.8 });
  });
});

describe("planShotGroups + buildXfadeChain", () => {
  it("cut 切组；组内重叠转场计算 offset 链", () => {
    const tracks = [
      track({ duration_sec: 2, transition_out: "crossfade" }),
      track({ duration_sec: 3, transition_in: "cut", transition_out: "dip_to_black" }),
      track({ duration_sec: 2, transition_in: "cut" }),
      track({ duration_sec: 1, transition_in: "cut" }),
    ];
    const groups = planShotGroups(tracks);
    // [0,1,2] 一组（两条重叠边界），[3] 一组（硬切）
    expect(groups.map((g) => g.indices)).toEqual([[0, 1, 2], [3]]);

    const { filter, durationSec } = buildXfadeChain(tracks, groups[0]);
    expect(durationSec).toBeCloseTo(2 + 3 + 2 - 0.8 - 0.6, 3);
    // offset1 = 2-0.8=1.2; offset2 = (2+3-0.8)-0.6=3.6
    expect(filter).toContain("offset=1.2");
    expect(filter).toContain("offset=3.6");
    expect(filter).toContain("transition=fade");
    expect(filter).toContain("transition=fadeblack");
  });

  it("单镜头组 copy 输出", () => {
    const tracks = [track({ duration_sec: 4 })];
    const groups = planShotGroups(tracks);
    expect(groups).toHaveLength(1);
    const { filter } = buildXfadeChain(tracks, groups[0]);
    expect(filter).toBe("[0:v]copy[out]");
  });
});

describe("totalDurationSec", () => {
  it("总时长 = Σ镜头 − Σ重叠", () => {
    const tracks = [
      track({ duration_sec: 2, transition_out: "crossfade" }),
      track({ duration_sec: 3, transition_in: "cut", transition_out: "dip_to_black" }),
      track({ duration_sec: 2, transition_in: "cut" }),
    ];
    expect(totalDurationSec(tracks)).toBeCloseTo(5.6, 3);
  });
});
