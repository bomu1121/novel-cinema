import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin, rawDb } from "../db";
import {
  activeJobs,
  appendEvent,
  createJobRow,
  eventsAfter,
  getJob,
  isCancelRequested,
  setCancelRequested,
  setJobStatus,
  sweepOrphanJobs,
  updateJobProgress,
} from "./progress";

const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

async function makeBook(): Promise<string> {
  const s = getSupabaseAdmin();
  const { data: book, error } = await s.from("books").insert({ owner_id: "test", title: "jobs-test" }).select("id").single();
  if (error) throw error;
  createdBookIds.push(book.id);
  return book.id;
}

describe("jobs 队列（docs/06 §4.1）", () => {
  it("入队 → pending 行；事件流按 seq 追加与重放", async () => {
    const bookId = await makeBook();
    const jobId = createJobRow(bookId, "voice", { chapterId: "x" });
    expect(getJob(jobId)?.status).toBe("pending");

    appendEvent(jobId, "step", { label: "排队中" });
    appendEvent(jobId, "step", { label: "合成第 1/8 句", index: 1, total: 8 });

    const all = eventsAfter(jobId, 0);
    expect(all).toHaveLength(2);
    expect(all[1].payload).toMatchObject({ label: "合成第 1/8 句", index: 1, total: 8 });
    // 重放：从 seq 1 开始只拿到第 2 条
    const replay = eventsAfter(jobId, all[0].seq);
    expect(replay).toHaveLength(1);
    expect(replay[0].kind).toBe("step");
  });

  it("状态机与进度字段", async () => {
    const bookId = await makeBook();
    const jobId = createJobRow(bookId, "assets-phase1");
    setJobStatus(jobId, "running");
    expect(getJob(jobId)?.startedAt).toBeTruthy();

    updateJobProgress(jobId, { progress: 0.5, step: "生成 设定图：林晚", stepIndex: 2, stepTotal: 4 });
    const mid = getJob(jobId)!;
    expect(mid.progress).toBe(0.5);
    expect(mid.stepIndex).toBe(2);

    setJobStatus(jobId, "succeeded");
    const done = getJob(jobId)!;
    expect(done.status).toBe("succeeded");
    expect(done.progress).toBe(1);
    expect(done.finishedAt).toBeTruthy();
  });

  it("取消：置位后 isCancelRequested 为 true", async () => {
    const bookId = await makeBook();
    const jobId = createJobRow(bookId, "voice");
    expect(isCancelRequested(jobId)).toBe(false);
    setCancelRequested(jobId);
    expect(isCancelRequested(jobId)).toBe(true);
  });

  it("activeJobs 只返回 pending/running；孤儿清理标记超时 running", async () => {
    const bookId = await makeBook();
    const runningId = createJobRow(bookId, "storyboard");
    setJobStatus(runningId, "running");
    const doneId = createJobRow(bookId, "analyze");
    setJobStatus(doneId, "succeeded");

    const active = activeJobs(bookId);
    expect(active.map((j) => j.id)).toContain(runningId);
    expect(active.map((j) => j.id)).not.toContain(doneId);

    // 伪造超时 running（started_at 回拨 11 分钟）
    rawDb
      .prepare(`UPDATE jobs SET started_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), runningId);
    const swept = sweepOrphanJobs();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(getJob(runningId)?.status).toBe("failed");
  });
});
