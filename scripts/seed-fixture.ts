/**
 * 测试 fixture（docs/06 §8.3）：在 NOVEL_CINEMA_DATA_DIR 指向的库中
 * 建一本完全确定性的书（固定 bookId=fixture-book），内容取自桌面《魔眼之匣》第一章节选。
 * 供 Playwright 截图基线 + 本地工作台手动测试使用。
 * 幂等：先删后建。用法：NOVEL_CINEMA_DATA_DIR=... npx tsx scripts/seed-fixture.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getSupabaseAdmin, rawDb } from "../src/lib/db";

const BOOK_ID = "fixture-book";
const samplePath = path.join(process.cwd(), "samples", "magyan-chapter.txt");
const rawText = readFileSync(samplePath, "utf8").trim();
const totalChars = rawText.replace(/\s/g, "").length;

const CHAR = {
  yamura: "fixture-char-yamura",
  hiruko: "fixture-char-hiruko",
  tokiwa: "fixture-char-tokiwa",
} as const;

const BEATS: Array<{
  id: string;
  idx: number;
  type: string;
  speaker: keyof typeof CHAR | null;
  text: string;
  emotion: string;
  duration: number;
}> = [
  { id: "fixture-beat-0", idx: 0, type: "narration", speaker: null, text: "我和比留子同学被分到了一楼的房间。放下行李后，比留子同学来到了我的房间。", emotion: "neutral", duration: 5 },
  { id: "fixture-beat-1", idx: 1, type: "dialogue", speaker: "hiruko", text: "你去看的时候，他们在干什么？", emotion: "calm", duration: 3 },
  { id: "fixture-beat-2", idx: 2, type: "narration", speaker: null, text: "我几经烦恼，最后把自己在餐厅见到的事情和盘托出。", emotion: "neutral", duration: 4 },
  { id: "fixture-beat-3", idx: 3, type: "dialogue", speaker: "hiruko", text: "从那两个人的态度来看，事件和画的一致并非偶然啊。而且十色同学还不希望别人知道这件事。", emotion: "serious", duration: 5 },
  { id: "fixture-beat-4", idx: 4, type: "dialogue", speaker: "hiruko", text: "当然，依旧不能排除他们自导自演的可能性。", emotion: "calm", duration: 4 },
  { id: "fixture-beat-5", idx: 5, type: "dialogue", speaker: "yamura", text: "那就无法解释十色在餐厅画画的理由了。", emotion: "doubt", duration: 4 },
  { id: "fixture-beat-6", idx: 6, type: "dialogue", speaker: "hiruko", text: "真不愧是会长。如果是自导自演，他们还需要别人协助，而且整个计划会相当不稳定，所以可能性应该很低。", emotion: "admire", duration: 6 },
  { id: "fixture-beat-7", idx: 7, type: "dialogue", speaker: "hiruko", text: "我认为最应该注意的，其实是先见女士的预言。", emotion: "serious", duration: 4 },
  { id: "fixture-beat-8", idx: 8, type: "dialogue", speaker: "yamura", text: "接下来这两天里要死四个人吗？不过就算是先见的预言，现在也无法辨认真伪啊。", emotion: "doubt", duration: 5 },
  { id: "fixture-beat-9", idx: 9, type: "dialogue", speaker: "hiruko", text: "叶村君，我们是来调查班目机构的。不管预言是真是假，我们都要调查先见女士和这个“魔眼之匣”。", emotion: "firm", duration: 6 },
  { id: "fixture-beat-10", idx: 10, type: "action", speaker: null, text: "事情定下之后，我们又闲聊了大约一个小时，听到外面传来敲门声。原来是王寺来通知洗澡的顺序了。", emotion: "neutral", duration: 5 },
  { id: "fixture-beat-11", idx: 11, type: "action", speaker: null, text: "我走出浴室，沿着冰冷的走廊快步往房间走。来到拐角，我跟站在那里的人对上了目光。是十色。", emotion: "surprise", duration: 5 },
  { id: "fixture-beat-12", idx: 12, type: "dialogue", speaker: "tokiwa", text: "那个，谢谢你。", emotion: "shy", duration: 3 },
  { id: "fixture-beat-13", idx: 13, type: "dialogue", speaker: "yamura", text: "那幅画……我看着好像桥在燃烧。", emotion: "serious", duration: 4 },
  { id: "fixture-beat-14", idx: 14, type: "dialogue", speaker: "tokiwa", text: "那只是碰巧。", emotion: "evasive", duration: 3 },
];

async function main() {
  const s = getSupabaseAdmin();
  await s.from("books").delete().eq("id", BOOK_ID); // 级联清掉全部下游
  const now = new Date().toISOString();

  async function mustInsert(table: string, rows: unknown) {
    // QueryBuilder 的 insert 签名是 Record<string, any>，这里只转发给底层，由 DB 层校验
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await s.from(table).insert(rows as any);
    if (r.error) throw new Error(`insert ${table} 失败: ${r.error.message}`);
  }

  await mustInsert("books", {
    id: BOOK_ID,
    owner_id: "fixture",
    title: "魔眼之匣·测试章",
    source_file_name: "magyan-chapter.txt",
    language: "zh",
    total_chars: totalChars,
    status: "asset_ready",
    created_at: now,
  });

  await mustInsert("source_chapters", {
    id: "fixture-chapter-1",
    book_id: BOOK_ID,
    idx: 1,
    title: "第一章 魔眼之匣（节选）",
    raw_text: rawText,
    cleaned_text: rawText,
    char_count: totalChars,
    status: "approved",
    created_at: now,
  });

  await mustInsert("adapted_chapters", {
    id: "fixture-adapted",
    book_id: BOOK_ID,
    source_chapter_id: "fixture-chapter-1",
    idx: 1,
    title: "第一章 魔眼之匣（节选）",
    hook: "预知死亡的预言、与世隔绝的魔眼之匣，叶村让与剑崎比留子开始调查。",
    status: "approved",
    model: "deepseek-chat",
    target_duration_sec: 90,
    estimated_duration_sec: 85,
    importance: 1.0,
    selection_report: {
      kept: [{ span: "1-200", reason: "核心调查对话" }],
      cut: [{ summary: "恋爱话题略去", reason: "节奏" }],
      clue_safety_notes: ["预言细节不提前揭示"],
    },
    raw_output: { title: "第一章 魔眼之匣（节选）" },
    created_at: now,
  });

  // 先插入角色，beats 才能引用（旧版顺序 bug 的修复）
  await mustInsert("characters", [
    { id: CHAR.yamura, book_id: BOOK_ID, canonical_name: "叶村让", aliases: ["叶村"], role: "lead", description: "神红大学经济系一年级，推理爱好会会长。", status: "approved", created_at: now },
    { id: CHAR.hiruko, book_id: BOOK_ID, canonical_name: "剑崎比留子", aliases: ["比留子"], role: "lead", description: "神红大学文学系二年级，推理爱好会会员。", status: "approved", created_at: now },
    { id: CHAR.tokiwa, book_id: BOOK_ID, canonical_name: "十色真理绘", aliases: ["十色"], role: "support", description: "高中二年级，描绘预知未来画作的预言者。", status: "approved", created_at: now },
  ]);

  await mustInsert("style_bibles", {
    id: "fixture-style",
    book_id: BOOK_ID,
    version: 1,
    status: "approved",
    genre: ["悬疑", "推理"],
    visual_style: "日式山间孤楼、冷峻悬疑、胶片感",
    art_direction: "深秋山间、封闭建筑、昏暗室内",
    color_palette: ["#1a1a2e", "#2b2d42", "#3a3a5c", "#8d99ae"],
    camera_grammar: { default: "static" },
    narration_tone: "冷静、克制",
    spoiler_rules: { rules: ["预言细节不提前揭示"] },
    negative_prompt: { text: "bright, cheerful, daytime" },
    proposal_json: [
      { visual_style: "日式山间孤楼", art_direction: "深秋冷调", color_palette: ["#1a1a2e"], narration_tone: "冷静", spoiler_rules: [], negative_prompt: "bright" },
      { visual_style: "昭和怪谈", art_direction: "昏黄灯影", color_palette: ["#3a2a1a"], narration_tone: "不安", spoiler_rules: [], negative_prompt: "daylight" },
    ],
    approved_proposal_index: 0,
    approved_at: now,
    created_at: now,
  });

  await mustInsert("voice_profiles", [
    { id: "fixture-vp-yamura", book_id: BOOK_ID, name: "叶村让", role: "character", character_id: CHAR.yamura, provider: "volcengine", provider_voice_id: "zh_male_v2", status: "approved", created_at: now },
    { id: "fixture-vp-hiruko", book_id: BOOK_ID, name: "剑崎比留子", role: "character", character_id: CHAR.hiruko, provider: "volcengine", provider_voice_id: "zh_female_v2", status: "approved", created_at: now },
    { id: "fixture-vp-tokiwa", book_id: BOOK_ID, name: "十色真理绘", role: "character", character_id: CHAR.tokiwa, provider: "volcengine", provider_voice_id: "zh_female_v3", status: "approved", created_at: now },
  ]);

  // 本地占位媒体：public/placeholder-*.png 已由仓库提供，保证工作台图片/音频不 404
  await mustInsert("assets", [
    { id: "fixture-asset-bg1", book_id: BOOK_ID, kind: "background", title: "魔眼之匣外景", character_id: null, expression: null, params: { url: "/placeholder-bg.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-bg2", book_id: BOOK_ID, kind: "background", title: "一楼房间", character_id: null, expression: null, params: { url: "/placeholder-bg.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-yamura-ref", book_id: BOOK_ID, kind: "character_ref", title: "叶村让 设定图", character_id: CHAR.yamura, expression: null, params: { url: "/placeholder-char.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-hiruko-ref", book_id: BOOK_ID, kind: "character_ref", title: "剑崎比留子 设定图", character_id: CHAR.hiruko, expression: null, params: { url: "/placeholder-char.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-tokiwa-ref", book_id: BOOK_ID, kind: "character_ref", title: "十色真理绘 设定图", character_id: CHAR.tokiwa, expression: null, params: { url: "/placeholder-char.png" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
    { id: "fixture-asset-yamura-calm", book_id: BOOK_ID, kind: "expression", title: "叶村让 calm", character_id: CHAR.yamura, expression: "calm", params: { url: "/placeholder-exp.png" }, source: "imported", status: "candidate", is_candidate: true, created_at: now },
    { id: "fixture-asset-hiruko-calm", book_id: BOOK_ID, kind: "expression", title: "剑崎比留子 calm", character_id: CHAR.hiruko, expression: "calm", params: { url: "/placeholder-exp.png" }, source: "imported", status: "candidate", is_candidate: true, created_at: now },
    { id: "fixture-asset-tokiwa-shy", book_id: BOOK_ID, kind: "expression", title: "十色真理绘 shy", character_id: CHAR.tokiwa, expression: "shy", params: { url: "/placeholder-exp.png" }, source: "imported", status: "candidate", is_candidate: true, created_at: now },
    { id: "fixture-asset-audio", book_id: BOOK_ID, kind: "voice_sample", title: "测试音频", character_id: null, expression: null, params: { url: "/placeholder-audio.mp3" }, source: "imported", status: "approved", is_candidate: false, created_at: now },
  ]);

  for (const beat of BEATS) {
    await mustInsert("beats", {
      id: beat.id,
      book_id: BOOK_ID,
      adapted_chapter_id: "fixture-adapted",
      idx: beat.idx,
      type: beat.type,
      speaker_type: beat.type === "dialogue" ? "character" : "narrator",
      character_id: beat.speaker ? CHAR[beat.speaker] : null,
      text: beat.text,
      emotion: beat.emotion,
      pace: 1,
      source_span: { start_char: 0, end_char: Math.min(beat.text.length, 40), quote: beat.text.slice(0, 8) },
      importance: 3,
      clue_ids: [],
      flags: {},
      estimated_duration_sec: beat.duration,
      status: "approved",
      created_at: now,
    });
  }

  const shots = BEATS.map((beat, i) => ({
    id: `fixture-shot-${i + 1}`,
    book_id: BOOK_ID,
    beat_id: beat.id,
    idx: 0,
    description: `${beat.type === "dialogue" ? "对白" : beat.type === "narration" ? "旁白" : "动作"}：${beat.text.slice(0, 24)}`,
    camera: "static",
    duration_sec: beat.duration,
    transition_in: "cut",
    transition_out: i === BEATS.length - 1 ? "fade" : "cut",
    background_asset_id: i % 2 === 0 ? "fixture-asset-bg1" : "fixture-asset-bg2",
    style: {},
    status: "approved",
    created_at: now,
  }));
  await mustInsert("shots", shots);

  const layers = BEATS.flatMap((beat, i) => {
    if (beat.type !== "dialogue" || !beat.speaker) return [];
    const refAsset = beat.speaker === "yamura" ? "fixture-asset-yamura-ref" : beat.speaker === "hiruko" ? "fixture-asset-hiruko-ref" : "fixture-asset-tokiwa-ref";
    return [{
      id: `fixture-layer-${i + 1}`,
      shot_id: `fixture-shot-${i + 1}`,
      idx: 0,
      z: 0,
      kind: "character",
      character_id: CHAR[beat.speaker],
      asset_id: refAsset,
      rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.6 },
      enter_animation: "fade_in",
      exit_animation: "none",
      motion: {},
      locked: false,
      created_at: now,
    }];
  });
  await mustInsert("shot_layers", layers);

  const voiceTakes = BEATS.filter((b) => b.type === "dialogue").map((beat) => {
    const vp = beat.speaker === "yamura" ? "fixture-vp-yamura" : beat.speaker === "hiruko" ? "fixture-vp-hiruko" : "fixture-vp-tokiwa";
    return {
      id: `fixture-take-${beat.idx}`,
      book_id: BOOK_ID,
      beat_id: beat.id,
      voice_profile_id: vp,
      provider: "volcengine",
      model: "seed-tts-2.0",
      audio_asset_id: "fixture-asset-audio",
      asr_confidence: 0.95,
      asr_text: beat.text,
      status: "accepted",
      created_at: now,
    };
  });
  await mustInsert("voice_takes", voiceTakes);

  const totalDuration = BEATS.reduce((sum, b) => sum + b.duration, 0);
  const beatById = new Map(BEATS.map((b) => [b.id, b]));
  const layerByShotId = new Map(layers.map((l) => [l.shot_id, l]));
  await mustInsert("timelines", {
    id: "fixture-timeline",
    book_id: BOOK_ID,
    kind: "preview",
    version: 1,
    duration_sec: totalDuration,
    snapshot: {
      version: 1,
      kind: "preview",
      resolution: [1920, 1080],
      fps: 25,
      duration_sec: totalDuration,
      tracks: shots.map((shot) => {
        const beat = beatById.get(shot.beat_id);
        const layer = layerByShotId.get(shot.id);
        return {
          shotId: shot.id,
          beatId: shot.beat_id,
          beatIdx: beat?.idx ?? 0,
          text: beat?.text ?? "",
          description: shot.description,
          camera: shot.camera,
          duration_sec: shot.duration_sec,
          transition_in: shot.transition_in,
          transition_out: shot.transition_out,
          background_url: "/placeholder-bg.png",
          background_asset_id: shot.background_asset_id,
          layers: layer
            ? [{
                kind: layer.kind,
                asset_id: layer.asset_id,
                asset_url: "/placeholder-char.png",
                text: beat?.type === "dialogue" ? beat.text : undefined,
                rect: layer.rect,
                enter: layer.enter_animation,
                exit: layer.exit_animation,
                motion: layer.motion,
              }]
            : [],
        };
      }),
    },
    status: "approved",
    created_at: now,
  });

  await mustInsert("render_jobs", {
    id: "fixture-render-1",
    book_id: BOOK_ID,
    scope: "preview",
    timeline_id: "fixture-timeline",
    preset: "{}",
    status: "succeeded",
    progress: 1,
    duration_sec: totalDuration,
    cost_cents: 5,
    started_at: now,
    finished_at: now,
    created_at: now,
  });

  // 成本仪表盘有数 + 收件箱有一条待办
  await mustInsert("jobs", [
    { id: "fixture-job-1", book_id: BOOK_ID, node: "analyze.chapter", status: "succeeded", attempt: 1, max_attempts: 3, cost: { input_tokens: 1200, output_tokens: 800, model: "deepseek" }, created_at: now, finished_at: now },
    { id: "fixture-job-2", book_id: BOOK_ID, node: "adapt.chapter", status: "succeeded", attempt: 2, max_attempts: 4, cost: { input_tokens: 3400, output_tokens: 5200, model: "deepseek" }, created_at: now, finished_at: now },
    { id: "fixture-job-3", book_id: BOOK_ID, node: "review.script", status: "succeeded", attempt: 1, max_attempts: 3, cost: { input_tokens: 900, output_tokens: 300, model: "deepseek" }, created_at: now, finished_at: now },
  ]);
  await mustInsert("review_tasks", {
    id: "fixture-review-1",
    book_id: BOOK_ID,
    kind: "chapter_script",
    target_type: "adapted_chapters",
    target_id: "fixture-adapted",
    status: "open",
    ai_report: { beat_idx: 8, kind: "pacing", issue: "第 9 句信息量偏大", suggestion: "可拆成两句", severity: "yellow" },
    created_at: now,
  });
  // 签核点（时间机器非空）
  rawDb
    .prepare(`INSERT INTO checkpoints (id, book_id, label, origin, node, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("fixture-cp-1", BOOK_ID, "批准本章「魔眼之匣·测试章」", "approve", "approve:script", now);

  console.log(`fixture 就绪：bookId=${BOOK_ID}，标题=魔眼之匣·测试章，${totalChars} 字，${BEATS.length} beats，${shots.length} shots`);
}

main().catch((err) => {
  console.error("seed-fixture 失败:", err);
  process.exit(1);
});
