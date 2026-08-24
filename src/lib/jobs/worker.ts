import { spawn } from "node:child_process";
import { appendEvent, getJob, isCancelRequested, setJobStatus, updateJobProgress } from "./progress";
import { JobCancelledError, type ProgressReporter } from "./types";
import { rerunNode, type RerunNode } from "@/lib/pipeline/nodes/workbench";
import { stageAdaptation, stageEntries, stageStoryboard } from "@/lib/staging";

/**
 * 任务执行器（docs/06 §4.1）。
 *
 * 两种用法：
 * 1. CLI（独立进程）：`npx tsx src/lib/jobs/worker.ts --job <jobId>`
 *    —— Next 入队后 spawn detached 子进程执行，进度/取消经 SQLite 共享（WAL）。
 * 2. executeJob(jobId, runFn)：进程内执行（测试注入假节点用）。
 *
 * 高覆盖节点（adapt/storyboard）默认走 staging：只计算并生成变更清单，
 * 由用户在 DiffReview 逐条审阅后 apply（docs/06 §6.3）。
 */

export function makeReporter(jobId: string): ProgressReporter {
  // progress 列节流合并（≥500ms），事件流不节流
  let lastColumnWrite = 0;
  return {
    step(label, index, total) {
      appendEvent(jobId, "step", { label, index, total });
      const now = Date.now();
      if (now - lastColumnWrite >= 500) {
        lastColumnWrite = now;
        updateJobProgress(jobId, { step: label, stepIndex: index, stepTotal: total });
      }
    },
    log(line) {
      appendEvent(jobId, "log", { line });
    },
    progress(value) {
      appendEvent(jobId, "progress", { value });
      const now = Date.now();
      if (now - lastColumnWrite >= 500) {
        lastColumnWrite = now;
        updateJobProgress(jobId, { progress: value });
      }
    },
    checkCancelled() {
      return isCancelRequested(jobId);
    },
  };
}

export async function executeJob(jobId: string, run: (reporter: ProgressReporter) => Promise<unknown>): Promise<void> {
  setJobStatus(jobId, "running");
  const reporter = makeReporter(jobId);
  try {
    await run(reporter);
    setJobStatus(jobId, "succeeded");
    appendEvent(jobId, "done", {});
  } catch (err) {
    if (err instanceof JobCancelledError || isCancelRequested(jobId)) {
      setJobStatus(jobId, "cancelled");
      appendEvent(jobId, "error", { message: "任务已取消", cancelled: true });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    setJobStatus(jobId, "failed", { error: message });
    appendEvent(jobId, "error", { message });
  }
}

/**
 * 派生独立 worker 子进程执行 job。
 * 不用 `npx ...` + shell:true：Windows 上 detached + cmd.exe 会弹出命令行窗口；
 * 直接用 node --import tsx 启动，既避免 .cmd 解析问题，也不会弹窗。
 */
export function spawnWorker(jobId: string): void {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/lib/jobs/worker.ts", "--job", jobId],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    },
  );
  child.on("error", (err) => {
    console.error("[jobs] worker 启动失败:", err.message);
  });
  child.unref();
}

/** CLI 入口：--job <jobId> */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const jobIdx = argv.indexOf("--job");
  const jobId = jobIdx >= 0 ? argv[jobIdx + 1] : null;
  if (!jobId) {
    console.error("用法: tsx src/lib/jobs/worker.ts --job <jobId>");
    process.exit(1);
  }
  const job = getJob(jobId);
  if (!job) {
    console.error(`job 不存在: ${jobId}`);
    process.exit(1);
  }
  const input = (job.inputRef ?? {}) as { chapterId?: string };
  await executeJob(jobId, async (reporter) => {
    if (job.node === "adapt" || job.node === "storyboard") {
      // staging 模式：计算 → 变更清单（不落库），审阅后 apply
      const staged =
        job.node === "adapt"
          ? await stageAdaptation(job.bookId, reporter, input.chapterId)
          : await stageStoryboard(job.bookId, reporter);
      stageEntries(job.bookId, jobId, job.node, staged.entries);
      appendEvent(jobId, "log", { line: `变更清单已生成（${staged.entries.length} 条），等待审阅；应用前不会覆盖任何数据` });
      return;
    }
    await rerunNode(job.bookId, job.node as RerunNode, reporter, input);
  });
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("src/lib/jobs/worker.ts");
if (isMain) {
  main().catch((err) => {
    console.error("worker 异常退出:", err);
    process.exit(1);
  });
}
