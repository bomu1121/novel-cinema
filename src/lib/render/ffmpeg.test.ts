import { describe, expect, it } from "vitest";
import { buildShotGraph, buildSrt, srtTime } from "./ffmpeg";
import type { RenderVideoTrack } from "./types";

function track(overrides: Partial<RenderVideoTrack> = {}): RenderVideoTrack {
  return {
    shotId: "s1",
    beatId: "b1",
    beatIdx: 0,
    text: "这扇窗是从里面反锁的。",
    description: "测试",
    camera: "ken_burns_in",
    duration_sec: 4,
    transition_in: "cut",
    transition_out: "crossfade",
    background_url: "bg.png",
    layers: [
      {
        kind: "character",
        asset_url: "char.png",
        rect: { x: 0.5, y: 0.45, w: 0.3, h: 0.5 },
        enter: "fade_in",
        exit: null,
        motion: { type: "breath", amplitude: 0.004 },
      },
    ],
    ...overrides,
  };
}

describe("buildShotGraph", () => {
  it("Ken Burns + 呼吸动效 + 淡入图层", () => {
    const graph = buildShotGraph(track(), { width: 1920, height: 1080, fps: 25 });
    expect(graph.inputs).toHaveLength(2);
    expect(graph.filterComplex).toContain("zoompan");
    expect(graph.filterComplex).toContain("sin(2*PI*t/2.6)");
    expect(graph.filterComplex).toContain("fade=t=in:st=0:d=0.3");
    expect(graph.filterComplex).toContain("[outv]");
  });

  it("slide 入场/退场生成位移动画表达式", () => {
    const graph = buildShotGraph(
      track({
        camera: "static",
        layers: [
          {
            kind: "character",
            asset_url: "char.png",
            rect: { x: 0.5, y: 0.45, w: 0.3, h: 0.5 },
            enter: "slide_left",
            exit: "slide_right",
            motion: {},
          },
        ],
      }),
      { width: 1920, height: 1080, fps: 25 },
    );
    expect(graph.filterComplex).toContain("if(lt(t,0.4)");
    expect(graph.filterComplex).toContain("gte(t,3.60)");
  });

  it("黑场 + 文字卡 + 无背景", () => {
    const graph = buildShotGraph(
      track({
        camera: "static",
        background_url: null,
        transition_in: "fade_in",
        transition_out: "fade_out",
        layers: [
          {
            kind: "text",
            asset_url: null,
            text: "第一章 雨夜",
            rect: { x: 0.5, y: 0.5, w: 0.8, h: 0.3 },
            enter: "fade_in",
            exit: "fade_out",
            motion: {},
          },
        ],
      }),
      { width: 1920, height: 1080, fps: 25 },
    );
    expect(graph.inputs[0].type).toBe("lavfi");
    expect(graph.inputs[0].value).toContain("color=c=black");
    expect(graph.filterComplex).toContain("drawtext");
  });
});

describe("字幕", () => {
  it("srtTime 格式正确", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(65.5)).toBe("00:01:05,500");
  });

  it("buildSrt 输出标准 SRT", () => {
    const srt = buildSrt([{ start_sec: 0, end_sec: 3, text: "第一句" }]);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:03,000\n第一句");
  });
});
