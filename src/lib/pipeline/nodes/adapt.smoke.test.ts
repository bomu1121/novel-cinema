import { describe, expect, it } from "vitest";
import { completeJSON } from "@/lib/providers/llm";
import { buildAdaptPrompt, buildAdaptSystem } from "@/lib/pipeline/prompts/adapt";
import { adaptedChapterSchema } from "@/lib/pipeline/schemas/adapt";
import { validateAdaptation } from "./adapt";

/**
 * 真实 LLM 冒烟测试（只在显式设置 SMOKE_LLM=1 时运行，会产生少量费用）。
 * 运行：$env:SMOKE_LLM="1"; npx vitest run src/lib/pipeline/nodes/adapt.smoke.test.ts
 */
const chapterText = `第一章 雨夜

雨下得很大。林晚站在窗边，回头看向陈默：“这扇窗是从里面反锁的。”

陈默走到窗前，用指尖沿着窗框划了一圈，没有接话。窗外的巷子里没有一个人。

“门也是锁着的。”林晚的声音有些发抖，“钥匙只有一把，在死者手里。”

陈默蹲下身，看向地板上的水渍。水渍从窗边一直延伸到书桌下方。

“先别下结论。”他说，“把灯关掉，我们再走一遍。”

灯灭了。黑暗中，林晚听见陈默轻轻吸了一口气。`;

const characters = [
  { name: "林晚", aliases: ["小晚"], description: "年轻女性，案件当事人", role: "protagonist" },
  { name: "陈默", aliases: [], description: "私家侦探，冷静寡言", role: "detective" },
];

describe.runIf(process.env.SMOKE_LLM === "1")("adapt smoke (真实 LLM)", () => {
  it(
    "deepseek-chat 能产出通过全部确定性校验的改编脚本",
    async () => {
      const targetSec = 60;
      const input = {
        chapterIdx: 1,
        chapterTitle: "雨夜",
        chapterText,
        targetSec,
        characters,
        clues: [
          { name: "反锁的门窗", description: "密室状态：门窗均从内反锁", is_spoiler: false, is_red_herring: false },
          { name: "地板水渍", description: "从窗边延伸到书桌下", is_spoiler: false, is_red_herring: false },
        ],
        previousSummaries: [],
        styleBible: {
          visual_style: "dark rainy night, film noir, high contrast",
          narration_tone: "克制、冷静的悬疑旁白",
          camera_grammar: {},
          spoiler_rules: ["真相揭晓前不得在画面中暗示凶手身份"],
          negative_prompt: "text, watermark",
        },
      };

      const result = await completeJSON({
        system: buildAdaptSystem(targetSec),
        prompt: buildAdaptPrompt(input),
        schema: adaptedChapterSchema,
        tier: "strong",
        temperature: 0.5,
        maxTokens: 8000,
        node: "smoke.adapt",
      });

      const errors = validateAdaptation(input, result.data);
      console.log(
        `beats=${result.data.beats.length}, ` +
          `total=${result.data.beats.reduce((s, b) => s + b.estimated_duration_sec, 0).toFixed(1)}s, ` +
          `attempts=${result.attempts}`,
      );
      expect(errors).toEqual([]);
      expect(result.data.beats.length).toBeGreaterThanOrEqual(5);
    },
    180_000,
  );
});
