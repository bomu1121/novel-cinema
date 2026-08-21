/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 真实数据端到端验证（docs/06 附录 F）
 * 用法：NOVEL_CINEMA_DATA_DIR=... npx tsx scripts/e2e-verify.ts <baseUrl> <txtPath>
 * 流程：上传 → analyze → adapt（staged 审阅+应用）→ 批准风格/本章 → fixture 背景 → storyboard（staged）→ 批准分镜 → voice → cost 一致性
 * 注意：会调用真实 LLM/TTS/ASR（有成本），建议在独立数据目录跑。
 */
import { readFileSync } from "node:fs";
import { getSupabaseAdmin, rawDb } from "../src/lib/db";

const BASE = process.argv[2] ?? "http://127.0.0.1:3125";
const TXT = process.argv[3] ?? "samples/e2e-chapter.txt";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

async function post(path: string, body?: unknown, isForm = false) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? (body as BodyInit) : JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, json: (await res.json()) as any };
}

async function waitJob(bookId: string, jobId: string, timeoutMs: number) {
  const t0 = Date.now();
  for (;;) {
    const { json } = await get(`/api/books/${bookId}/jobs/${jobId}`);
    const job = json.job;
    if (job && job.status !== "pending" && job.status !== "running") {
      return { ...job, elapsedMs: Date.now() - t0, events: json.events ?? [] };
    }
    if (Date.now() - t0 > timeoutMs) return { status: "timeout", elapsedMs: Date.now() - t0, events: [] };
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  const s = getSupabaseAdmin();
  console.log("══ 真实数据端到端验证 ══\n");

  // 1. 上传
  const txt = readFileSync(TXT, "utf8");
  const form = new FormData();
  form.set("file", new Blob([txt], { type: "text/plain" }), "e2e-chapter.txt");
  form.set("title", "雨夜验证");
  const up = await post("/api/books", form, true);
  const bookId = up.json.book?.id;
  check("上传并解析", up.status === 200 && !!bookId, `bookId=${bookId ?? "无"} 章节数=${up.json.chapters?.length}`);
  if (!bookId) return;
  const s2 = getSupabaseAdmin();
  void s2;

  // 2. analyze
  console.log("\n── 节点 1/6：analyze（2 次 LLM）──");
  const estAnalyze = (await get(`/api/books/${bookId}/estimate?node=analyze`)).json;
  const a = await post(`/api/books/${bookId}/jobs`, { node: "analyze" });
  const aj = await waitJob(bookId, a.json.jobId, 240_000);
  check("analyze 完成", aj.status === "succeeded", `实际耗时 ${(aj.elapsedMs / 1000).toFixed(0)}s（预报 ${estAnalyze.estSeconds?.[0]}~${estAnalyze.estSeconds?.[1]}s）`);
  const { data: characters } = await s.from("characters").select("id").eq("book_id", bookId);
  const { data: clues } = await s.from("clues").select("id").eq("book_id", bookId);
  const { data: styleBibles } = await s.from("style_bibles").select("id, proposal_json").eq("book_id", bookId);
  check("人物落库", (characters?.length ?? 0) > 0, `${characters?.length ?? 0} 个`);
  check("线索落库", (clues?.length ?? 0) > 0, `${clues?.length ?? 0} 条`);
  check("风格候选生成", (styleBibles?.length ?? 0) > 0 && (styleBibles?.[0]?.proposal_json?.length ?? 0) >= 1);

  // 3. adapt（staged）
  console.log("\n── 节点 2/6：adapt（staged 审阅）──");
  const estAdapt = (await get(`/api/books/${bookId}/estimate?node=adapt`)).json;
  const ad = await post(`/api/books/${bookId}/jobs`, { node: "adapt" });
  const adj = await waitJob(bookId, ad.json.jobId, 600_000);
  check("adapt 完成（变更清单已生成）", adj.status === "succeeded", `实际耗时 ${(adj.elapsedMs / 1000).toFixed(0)}s（预报 ${estAdapt.estSeconds?.[0]}~${estAdapt.estSeconds?.[1]}s）`);
  const staged = (await get(`/api/books/${bookId}/staged?jobId=${ad.json.jobId}`)).json;
  const stagedEntries = staged.entries ?? [];
  check("staged 变更清单生成", stagedEntries.length > 0, `${stagedEntries.length} 条（beats 新增 ${stagedEntries.filter((e: any) => e.tableName === "beats" && e.op === "insert").length} / 章节 ${stagedEntries.filter((e: any) => e.tableName === "adapted_chapters").length}）`);
  // 应用：接受 beats 新增，接受章节行
  const decisions: Record<string, "accepted"> = {};
  for (const e of stagedEntries) decisions[e.id] = "accepted";
  const ap = await post(`/api/books/${bookId}/staged/${ad.json.jobId}`, { decisions });
  check("审阅应用", ap.status === 200 && ap.json.ok, `应用 ${ap.json.applied} 处`);
  const { data: beats } = await s.from("beats").select("id, idx, text").eq("book_id", bookId);
  check("beats 落库", (beats?.length ?? 0) > 0, `${beats?.length ?? 0} 个 beat`);
  const { data: adaptedChapters } = await s.from("adapted_chapters").select("id, status").eq("book_id", bookId);
  check("章节状态 pending_review", (adaptedChapters?.[0]?.status ?? "") === "pending_review");
  const { data: reviewTasks } = await s.from("review_tasks").select("id").eq("book_id", bookId).eq("status", "open");
  console.log(`  · 收件箱 open 任务：${reviewTasks?.length ?? 0} 条（红项持久化）`);

  // 4. 批准风格方案 + 本章
  console.log("\n── 签核 A/B ──");
  const proposalIndex = styleBibles?.[0]?.proposal_json?.length ? 0 : 0;
  const appB = await post(`/api/books/${bookId}/bible/approve`, { styleBibleId: styleBibles?.[0]?.id, proposalIndex });
  check("批准风格方案", appB.status === 200, "");
  const cps = rawDb.prepare(`SELECT label, origin FROM checkpoints WHERE book_id = ? ORDER BY created_at DESC LIMIT 5`).all(bookId) as Array<{ label: string; origin: string }>;
  check("批准生成签核点", cps.some((c) => c.origin === "approve"), cps.map((c) => c.label).join(" | "));
  const appS = await post(`/api/books/${bookId}/script/approve`, { adaptedChapterId: adaptedChapters?.[0]?.id });
  check("批准本章", appS.status === 200, "");

  // 5. fixture 背景 + 角色图（跳过真实图像 API 成本，直插占位资产）
  console.log("\n── fixture 资产（占位，零成本）──");
  const { error: bgErr } = await s.from("assets").insert({
    book_id: bookId,
    kind: "background",
    title: "雨夜巷子（fixture）",
    params: { url: "/placeholder-bg.png" },
    source: "imported",
    status: "approved",
    is_candidate: false,
  });
  check("fixture 背景就绪", !bgErr, bgErr?.message ?? "");
  // 角色参考图 + 表情（buildShotsForBeat 依赖它们生成人物图层）
  const { data: charRows } = await s.from("characters").select("id, canonical_name").eq("book_id", bookId);
  let layerFixture = 0;
  for (const c of charRows ?? []) {
    const ref = await s.from("assets").insert({
      book_id: bookId,
      kind: "character_ref",
      title: `${c.canonical_name} 设定图（fixture）`,
      character_id: c.id,
      params: { url: "/placeholder-char.png" },
      source: "imported",
      status: "approved",
      is_candidate: false,
    });
    if (!ref.error) layerFixture += 1;
    const exp = await s.from("assets").insert({
      book_id: bookId,
      kind: "expression",
      title: `${c.canonical_name} 表情（fixture）`,
      character_id: c.id,
      expression: "happy",
      params: { url: "/placeholder-exp.png" },
      source: "imported",
      status: "approved",
      is_candidate: false,
    });
    if (!exp.error) layerFixture += 1;
  }
  check("角色图层资产就绪", layerFixture >= 4, `${layerFixture} 个（参考图+表情）`);

  // 6. storyboard（staged）
  console.log("\n── 节点 3/6：storyboard（staged 审阅）──");
  const estSb = (await get(`/api/books/${bookId}/estimate?node=storyboard`)).json;
  const sb = await post(`/api/books/${bookId}/jobs`, { node: "storyboard" });
  const sbj = await waitJob(bookId, sb.json.jobId, 120_000);
  check("storyboard 完成", sbj.status === "succeeded", `实际耗时 ${(sbj.elapsedMs / 1000).toFixed(0)}s（预报 ${estSb.estSeconds?.[0]}~${estSb.estSeconds?.[1]}s）`);
  const sbStaged = (await get(`/api/books/${bookId}/staged?jobId=${sb.json.jobId}`)).json;
  const sbEntries = sbStaged.entries ?? [];
  check("分镜变更清单", sbEntries.length > 0, `${sbEntries.length} 条（镜头 ${sbEntries.filter((e: any) => e.tableName === "shots").length} / 图层 ${sbEntries.filter((e: any) => e.tableName === "shot_layers").length} / 时间线 ${sbEntries.filter((e: any) => e.tableName === "timelines").length}）`);
  const sbDecisions: Record<string, "accepted"> = {};
  for (const e of sbEntries) sbDecisions[e.id] = "accepted";
  const sbAp = await post(`/api/books/${bookId}/staged/${sb.json.jobId}`, { decisions: sbDecisions });
  check("分镜审阅应用", sbAp.status === 200 && sbAp.json.ok, `应用 ${sbAp.json.applied} 处`);
  const { data: shots } = await s.from("shots").select("id, idx, duration_sec").eq("book_id", bookId);
  // shot_layers 表无 book_id 列（schema 如此），验证库隔离所以全库计数即可
  const layerCount = (rawDb.prepare(`SELECT COUNT(*) AS n FROM shot_layers`).get() as { n: number }).n;
  const { data: timelines } = await s.from("timelines").select("id, status").eq("book_id", bookId);
  check("镜头/图层/时间线落库", (shots?.length ?? 0) > 0 && layerCount > 0 && (timelines?.length ?? 0) > 0,
    `${shots?.length ?? 0} 镜头 · ${layerCount} 图层 · ${timelines?.length ?? 0} 时间线(${timelines?.[0]?.status})`);

  // 7. 批准分镜
  const appSb = await post(`/api/books/${bookId}/storyboard/approve`, {});
  check("批准分镜", appSb.status === 200, "");

  // 8. voice（真实 TTS + ASR）
  console.log("\n── 节点 4/6：voice（逐句 TTS + ASR）──");
  const estV = (await get(`/api/books/${bookId}/estimate?node=voice`)).json;
  const v = await post(`/api/books/${bookId}/jobs`, { node: "voice" });
  const vj = await waitJob(bookId, v.json.jobId, 300_000);
  check("voice 完成", vj.status === "succeeded", `实际耗时 ${(vj.elapsedMs / 1000).toFixed(0)}s（预报 ${estV.estSeconds?.[0]}~${estV.estSeconds?.[1]}s） · 失败信息: ${vj.error ?? "无"}`);
  const { data: takes } = await s.from("voice_takes").select("id, beat_id, status, asr_confidence").eq("book_id", bookId);
  check("voice_takes 落库", (takes?.length ?? 0) > 0, `${takes?.length ?? 0} 句（accepted ${takes?.filter((t: any) => t.status === "accepted").length ?? 0} / draft ${takes?.filter((t: any) => t.status === "draft").length ?? 0}）`);

  // 9. cost 一致性
  console.log("\n── 成本仪表盘一致性 ──");
  const cost = (await get(`/api/books/${bookId}/cost`)).json;
  const dbRows = rawDb.prepare(`SELECT COUNT(*) AS n, SUM(json_extract(cost, '$.input_tokens')) AS inp, SUM(json_extract(cost, '$.output_tokens')) AS outp FROM jobs WHERE book_id = ?`).get(bookId) as { n: number; inp: number; outp: number };
  check("cost 端点与 DB 一致", cost.all?.calls === dbRows.n && cost.all?.inputTokens === dbRows.inp && cost.all?.outputTokens === dbRows.outp,
    `API: ${cost.all?.calls} 次/${cost.all?.inputTokens} in/${cost.all?.outputTokens} out · DB: ${dbRows.n} 次/${dbRows.inp}/${dbRows.outp}`);

  // 10. 预报 vs 实际（调用次数）
  console.log("\n── 预报 vs 实际 ──");
  const byNode = rawDb.prepare(`SELECT node, COUNT(*) AS n FROM jobs WHERE book_id = ? GROUP BY node`).all(bookId) as Array<{ node: string; n: number }>;
  console.log("  jobs 明细:", byNode.map((r) => `${r.node}×${r.n}`).join(" · "));

  console.log(`\n══ 结果：${pass} 通过 / ${fail} 失败 ══`);
  console.log(`BOOK_ID=${bookId}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("验证脚本异常:", err);
  process.exit(1);
});

