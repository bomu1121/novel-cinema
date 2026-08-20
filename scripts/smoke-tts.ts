// 火山豆包 TTS 连通性冒烟：合成一句并保存，随后用 ffprobe 校验
import { writeFileSync } from "node:fs";
import { getTTSProvider } from "../src/lib/providers/tts";

async function main() {
  const tts = getTTSProvider();
  const result = await tts.synthesize({
    text: "测试成功。雨夜，有人推开了那扇窗。",
    speaker: process.env.TTS_NARRATOR_SPEAKER || "zh_female_vv_uranus_bigtts",
    speechRate: 0,
    pitchRate: 0,
  });
  const out = ".test-assets/tts-smoke.mp3";
  writeFileSync(out, result.audio);
  console.log(`合成成功：${result.audio.byteLength} bytes -> ${out}`);
}

main().catch((err) => {
  console.error("TTS 冒烟失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
