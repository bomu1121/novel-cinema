/**
 * 单章一键流水线（M0 版）：
 *   npm run pipeline:local -- --book <bookId> [--approve-all] [--skip-assets] [--skip-voice]
 * 阶段：分析 → 批准风格 → 改编 → 批准脚本 → 资产 → 分镜 → 配音 → 渲染。
 * 无 --approve-all 时，每个签核点打印“待批准项”并停止。
 */
import { spawnSync } from "node:child_process";
import { getSupabaseAdmin } from "../src/lib/db";
import {
  analyzeChapter,
  approveStyleBible,
  persistChapterAnalysis,
  persistStyleProposals,
  proposeStyleBibles,
} from "../src/lib/pipeline/nodes/analyze";
import { approveAdaptedChapter, runAdaptation } from "../src/lib/pipeline/nodes/adapt";
import { generateAssetPhase } from "../src/lib/pipeline/nodes/assets";
import { approveStoryboard, buildStoryboard } from "../src/lib/pipeline/nodes/storyboard";
import { approveVoiceTakes, generateVoiceTakes } from "../src/lib/pipeline/nodes/voice";

interface Args {
  bookId?: string;
  approveAll?: boolean;
  skipAssets?: boolean;
  skipVoice?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--book") args.bookId = argv[++i];
    else if (argv[i] === "--approve-all") args.approveAll = true;
    else if (argv[i] === "--skip-assets") args.skipAssets = true;
    else if (argv[i] === "--skip-voice") args.skipVoice = true;
  }
  if (!args.bookId) {
    throw new Error("需要 --book <bookId>");
  }
  return args;
}

function step(name: string) {
  console.log(`\n========== ${name} ==========`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bookId = args.bookId!;
  const supabase = getSupabaseAdmin();

  // 1. 单章分析
  step("B22/B24 单章分析 + 风格圣经候选");
  const { data: chapter } = await supabase
    .from("source_chapters")
    .select("id, idx, title, cleaned_text")
    .eq("book_id", bookId)
    .eq("idx", 1)
    .single();
  if (!chapter) throw new Error("没有 idx=1 的章节，先上传 txt");

  const chapterForAnalysis = {
    id: chapter.id,
    idx: chapter.idx,
    title: chapter.title,
    cleanedText: chapter.cleaned_text,
  };
  const analysis = await analyzeChapter(bookId, chapterForAnalysis);
  await persistChapterAnalysis(bookId, chapterForAnalysis, analysis);
  const proposals = await proposeStyleBibles(bookId, analysis, null);
  const styleBibleId = await persistStyleProposals(bookId, proposals);
  console.log(`风格圣经候选：${proposals.proposals.length} 套（推荐 #${proposals.recommended_index + 1}）`);

  // 签核 A
  if (args.approveAll) {
    await approveStyleBible(bookId, styleBibleId, proposals.recommended_index);
    console.log("签核 A：已批准推荐风格方案");
  } else {
    console.log(`待签核 A：/books/${bookId}/bible 选择一套风格方案`);
    return;
  }

  // 2. 改编
  step("C10/C20 章节改编 + 自检");
  const adaptResult = await runAdaptation(bookId, chapterForAnalysis);
  const redItems = adaptResult.review.items.filter((i) => i.severity === "red");
  console.log(
    `beats=${adaptResult.adapt.beats.length} · 总时长=${adaptResult.adapt.beats
      .reduce((s, b) => s + b.estimated_duration_sec, 0)
      .toFixed(1)}s/${adaptResult.context.targetSec}s · 红项=${redItems.length}`,
  );
  if (redItems.length > 0) {
    for (const item of redItems) {
      console.log(`  [红] beat#${item.beat_idx} ${item.kind}: ${item.issue}`);
    }
  }

  if (args.approveAll || redItems.length === 0) {
    if (adaptResult.adaptedChapterId) {
      await approveAdaptedChapter(adaptResult.adaptedChapterId);
      console.log("签核 B：脚本已批准");
    } else {
      console.log("改编未落库（dryRun 结果），跳过签核 B");
    }
  } else {
    console.log(`待签核 B：/books/${bookId}/script 处理红项后批准`);
    return;
  }

  // 3. 资产
  if (!args.skipAssets) {
    step("A20/A30 资产生成 phase1（设定图 + 背景）");
    const phase1 = await generateAssetPhase(bookId, "phase1");
    console.log(`phase1 生成 ${phase1.generated} 个候选`, phase1.errors.length ? `错误：${phase1.errors.join("；")}` : "");

    if (phase1.generated > 0) {
      console.log(`待签核 C：/books/${bookId}/assets 为每个角色点选设定图、选背景，然后重新运行本命令（继续 phase2 表情变体）`);
      return; // 资产生成后必须人工点选
    }

    const phase2 = await generateAssetPhase(bookId, "phase2");
    console.log(`phase2 生成 ${phase2.generated} 个候选`, phase2.errors.length ? `错误：${phase2.errors.join("；")}` : "");
    if (phase2.generated > 0) {
      console.log(`待签核 C：/books/${bookId}/assets 点选表情候选（或跳过），批准后重新运行本命令`);
      return;
    }
  } else {
    console.log("已跳过资产（--skip-assets），分镜将使用占位/黑场");
  }

  // 4. 分镜
  step("S10 分镜构建");
  const storyboard = await buildStoryboard(bookId);
  await approveStoryboard(bookId);
  console.log(`分镜 ${storyboard.shots.length} 镜头 · ${storyboard.durationSec}s · 签核 D 已批准`);

  // 5. 配音
  if (!args.skipVoice) {
    step("V10 逐句配音");
    const voice = await generateVoiceTakes(bookId);
    console.log(
      `合成 ${voice.generated} · 跳过 ${voice.skipped}`,
      voice.errors.length ? `错误：${voice.errors.join("；")}` : "",
    );
    await approveVoiceTakes(bookId);
    console.log("签核 E：配音已批准（ASR 红项不在此列）");
  }

  // 6. 渲染
  step("R10 本地渲染");
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/render-local.ts", "--book", bookId],
    { stdio: "inherit", windowsHide: true },
  );
  if (child.status !== 0) throw new Error(`渲染退出码 ${child.status}`);

  console.log("\n========== 流水线完成 ==========");
  console.log("下一步：npm run cost:report -- --book " + bookId);
}

main().catch((err) => {
  console.error("\n流水线失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
