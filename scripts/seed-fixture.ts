/**
 * 视觉回归 fixture（docs/06 §8.3）：在 NOVEL_CINEMA_DATA_DIR 指向的库中
 * 建一本完全确定性的书（固定 bookId=fixture-book），供 Playwright 截图基线使用。
 * 幂等：先删后建。用法：NOVEL_CINEMA_DATA_DIR=... npx tsx scripts/seed-fixture.ts
 */
import { getSupabaseAdmin, rawDb } from "../src/lib/db";

const BOOK_ID = "fixture-book";

async function main() {
  const s = getSupabaseAdmin();
  await s.from("books").delete().eq("id", BOOK_ID); // 级联清掉全部下游
  const now = new Date().toISOString();

  await s.from("books").insert({
    id: BOOK_ID,
    owner_id: "fixture",
    title: "视觉回归夹具书",
    language: "zh",
    total_chars: 4200,
    status: "asset_ready",
    created_at: now,
  });

  await s.from("source_chapters").insert({
    id: "fixture-chapter-1",
    book_id: BOOK_ID,
    idx: 1,
    title: "第一章 雨夜",
    raw_text: "雨下得很大。林晚站在窗边。",
    cleaned_text: "雨下得很大。林晚站在窗边，回头看向陈默。",
    char_count: 4200,
    status: "approved",
    created_at: now,
  });

  await s.from("adapted_chapters").insert({
    id: "fixture-adapted",
    book_id: BOOK_ID,
    source_chapter_id: "fixture-chapter-1",
    idx: 1,
    title: "第一章 雨夜",
    hook: "雨夜里的密室，门和窗都锁着。",
    status: "approved",
    model: "deepseek-chat",
    target_duration_sec: 154,
    estimated_duration_sec: 148,
    importance: 1.0,
    selection_report: {
      kept: [{ span: "1-80", reason: "核心对白" }],
      cut: [{ summary: "门房对话略去", reason: "节奏" }],
      clue_safety_notes: ["泥脚印线索保留"],
    },
    raw_output: { title: "第一章 雨夜" },
    created_at: now,
  });

  const beats: Array<[string, number, string, string, string]> = [
    ["fixture-beat-1", 0, "narration", "雨下得很大，巷子空无一人。", "旁白"],
    ["fixture-beat-2", 1, "dialogue", "这扇窗是从里面反锁的。", "林晚"],
    ["fixture-beat-3", 2, "dialogue", "门也是锁着的，钥匙只有一把。", "林晚"],
    ["fixture-beat-4", 3, "action", "陈默蹲下身，看向地板上的水渍。", "动作"],
    ["fixture-beat-5", 4, "dialogue", "有人比我们先到过这里。", "陈默"],
    ["fixture-beat-6", 5, "insert_card", "雨夜 · 谜局", "文字卡"],
  ];
  for (const [id, idx, type, text, speaker] of beats) {
    await s.from("beats").insert({
      id,
      book_id: BOOK_ID,
      adapted_chapter_id: "fixture-adapted",
      idx,
      type,
      speaker_type: type === "dialogue" ? "character" : "narrator",
      character_id: speaker === "林晚" ? "fixture-char-linwan" : speaker === "陈默" ? "fixture-char-chenmo" : null,
      text,
      emotion: "neutral",
      pace: 1,
      source_span: { start_char: idx * 20, end_char: idx * 20 + text.length, quote: text.slice(0, 8) },
      importance: 3,
      clue_ids: [],
      flags: {},
      estimated_duration_sec: type === "insert_card" ? 3.5 : 5,
      status: "approved",
      created_at: now,
    });
  }

  await s.from("style_bibles").insert({
    id: "fixture-style",
    book_id: BOOK_ID,
    version: 1,
    status: "approved",
    visual_style: "film noir, high contrast, 1930s Shanghai",
    art_direction: "雨夜冷色调",
    color_palette: ["#1a1a2e", "#16213e", "#0f3460"],
    camera_grammar: { default: "static" },
    narration_tone: "克制、冷静",
    spoiler_rules: { rules: ["泥脚印不暗示真凶"] },
    negative_prompt: { text: "bright, cheerful" },
    proposal_json: [
      { visual_style: "film noir, high contrast", art_direction: "雨夜", color_palette: ["#111"], narration_tone: "克制", spoiler_rules: [], negative_prompt: "bright" },
      { visual_style: "neo-noir, teal shadows", art_direction: "霓虹雨夜", color_palette: ["#0a2e3f"], narration_tone: "悬疑", spoiler_rules: [], negative_prompt: "daylight" },
      { visual_style: "1980s Chinese old town", art_direction: "旧城巷", color_palette: ["#3a2a1a"], narration_tone: "沉稳", spoiler_rules: [], negative_prompt: "colorful" },
    ],
    approved_proposal_index: 0,
    approved_at: now,
    created_at: now,
  });

  await s.from("characters").insert([
    { id: "fixture-char-linwan", book_id: BOOK_ID, canonical_name: "林晚", aliases: ["晚晚"], role: "lead", description: "年轻女性，细心", status: "approved", created_at: now },
    { id: "fixture-char-chenmo", book_id: BOOK_ID, canonical_name: "陈默", aliases: [], role: "detective", description: "刑警", status: "approved", created_at: now },
  ]);

  await s.from("voice_profiles").insert([
    { id: "fixture-vp-linwan", book_id: BOOK_ID, name: "林晚", role: "character", character_id: "fixture-char-linwan", provider: "volcengine", provider_voice_id: "zh_female_v1", status: "approved", created_at: now },
    { id: "fixture-vp-chenmo", book_id: BOOK_ID, name: "陈默", role: "character", character_id: "fixture-char-chenmo", provider: "volcengine", provider_voice_id: "zh_male_v1", status: "approved", created_at: now },
  ]);

  await s.from("assets").insert([
    { id: "fixture-asset-bg1", book_id: BOOK_ID, kind: "background", title: "雨夜巷子", params: { url: "/placeholder-bg.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-bg2", book_id: BOOK_ID, kind: "background", title: "屋内书桌", params: { url: "/placeholder-bg.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-linwan-ref", book_id: BOOK_ID, kind: "character_ref", title: "林晚 设定图", character_id: "fixture-char-linwan", params: { url: "/placeholder-char.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-chenmo-ref", book_id: BOOK_ID, kind: "character_ref", title: "陈默 设定图", character_id: "fixture-char-chenmo", params: { url: "/placeholder-char.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-linwan-happy", book_id: BOOK_ID, kind: "expression", title: "林晚 happy", character_id: "fixture-char-linwan", expression: "happy", params: { url: "/placeholder-exp.png" }, source: "imported", status: "candidate", is_candidate: true, created_at: now },
    { id: "fixture-asset-linwan-sad", book_id: BOOK_ID, kind: "expression", title: "林晚 sad", character_id: "fixture-char-linwan", expression: "sad", params: { url: "/placeholder-exp.png" }, source: "imported", status: "candidate", is_candidate: true, created_at: now },
  ]);

  const shots: Array<[string, string, number, string, number]> = [
    ["fixture-shot-1", "fixture-beat-1", 0, "空巷雨夜全景", 4],
    ["fixture-shot-2", "fixture-beat-2", 0, "林晚窗前近景", 5],
    ["fixture-shot-3", "fixture-beat-3", 0, "门锁特写", 3],
    ["fixture-shot-4", "fixture-beat-4", 0, "水渍地面俯拍", 5],
  ];
  for (const [id, beatId, idx, desc, dur] of shots) {
    await s.from("shots").insert({
      id,
      book_id: BOOK_ID,
      beat_id: beatId,
      idx,
      description: desc,
      camera: idx === 0 ? "static" : idx === 2 ? "push_in" : "ken_burns_in",
      duration_sec: dur,
      transition_in: "cut",
      transition_out: idx === 3 ? "crossfade" : "cut",
      background_asset_id: "fixture-asset-bg1",
      style: {},
      status: "approved",
      created_at: now,
    });
  }
  await s.from("shot_layers").insert([
    { id: "fixture-layer-1", shot_id: "fixture-shot-2", idx: 0, z: 0, kind: "character", character_id: "fixture-char-linwan", asset_id: "fixture-asset-linwan-ref", rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.6 }, enter_animation: "fade_in", exit_animation: "none", motion: {}, locked: false, created_at: now },
    { id: "fixture-layer-2", shot_id: "fixture-shot-3", idx: 0, z: 0, kind: "character", character_id: "fixture-char-chenmo", asset_id: "fixture-asset-chenmo-ref", rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.6 }, enter_animation: "slide_left", exit_animation: "none", motion: {}, locked: false, created_at: now },
  ]);

  await s.from("voice_takes").insert([
    { id: "fixture-take-1", book_id: BOOK_ID, beat_id: "fixture-beat-2", voice_profile_id: "fixture-vp-linwan", provider: "volcengine", model: "seed-tts-2.0", asr_confidence: 0.92, asr_text: "这扇窗是从里面反锁的。", status: "accepted", created_at: now },
    { id: "fixture-take-2", book_id: BOOK_ID, beat_id: "fixture-beat-3", voice_profile_id: "fixture-vp-linwan", provider: "volcengine", model: "seed-tts-2.0", asr_confidence: 0.95, asr_text: "门也是锁着的。", status: "accepted", created_at: now },
  ]);

  await s.from("timelines").insert({
    id: "fixture-timeline",
    book_id: BOOK_ID,
    kind: "preview",
    version: 1,
    duration_sec: 17,
    snapshot: {
      version: 1,
      kind: "preview",
      resolution: [1920, 1080],
      fps: 25,
      duration_sec: 17,
      tracks: shots.map(([id]) => ({ shotId: id, beatId: "", beatIdx: 0, camera: "static", duration_sec: 4 })),
    },
    status: "approved",
    created_at: now,
  });

  await s.from("render_jobs").insert({
    id: "fixture-render-1",
    book_id: BOOK_ID,
    scope: "preview",
    timeline_id: "fixture-timeline",
    preset: "{}",
    status: "succeeded",
    progress: 1,
    duration_sec: 17,
    cost_cents: 5,
    started_at: now,
    finished_at: now,
    created_at: now,
  });

  // 成本仪表盘有数 + 收件箱有一条待办
  await s.from("jobs").insert([
    { id: "fixture-job-1", book_id: BOOK_ID, node: "analyze.chapter", status: "succeeded", attempt: 1, max_attempts: 3, cost: { input_tokens: 1200, output_tokens: 800, model: "deepseek" }, created_at: now, finished_at: now },
    { id: "fixture-job-2", book_id: BOOK_ID, node: "adapt.chapter", status: "succeeded", attempt: 2, max_attempts: 4, cost: { input_tokens: 3400, output_tokens: 5200, model: "deepseek" }, created_at: now, finished_at: now },
    { id: "fixture-job-3", book_id: BOOK_ID, node: "review.script", status: "succeeded", attempt: 1, max_attempts: 3, cost: { input_tokens: 900, output_tokens: 300, model: "deepseek" }, created_at: now, finished_at: now },
  ]);
  await s.from("review_tasks").insert({
    id: "fixture-review-1",
    book_id: BOOK_ID,
    kind: "chapter_script",
    target_type: "adapted_chapters",
    target_id: "fixture-adapted",
    status: "open",
    ai_report: { beat_idx: 2, kind: "pacing", issue: "第 3 句节奏偏慢", suggestion: "可合并到前一句", severity: "red" },
    created_at: now,
  });
  // 签核点（时间机器非空）
  rawDb
    .prepare(`INSERT INTO checkpoints (id, book_id, label, origin, node, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("fixture-cp-1", BOOK_ID, "批准本章「第一章 雨夜」", "approve", "approve:script", now);

  console.log("fixture 就绪：bookId=fixture-book");
}

main().catch((err) => {
  console.error("seed-fixture 失败:", err);
  process.exit(1);
});
