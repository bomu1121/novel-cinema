import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "../db";
import { createJobRow, eventsAfter, getJob, setCancelRequested } from "./progress";
import { executeJob } from "./worker";
import { JobCancelledError, type ProgressReporter } from "./types";

const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

async function makeBook(): Promise<string> {
  const s = getSupabaseAdmin();
  const { data: book, error } = await s.from("books").insert({ owner_id: "test", title: "worker-test" }).select("id").single();
  if (error) throw error;
  createdBookIds.push(book.id);
  return book.id;
}

describe("worker 执行器（docs/06 §4.1）", () => {
  it("成功：running → 逐步事件 → succeeded + done", async () => {
    const bookId = await makeBook();
    const jobId = createJobRow(bookId, "voice");

    await executeJob(jobId, async (r: ProgressReporter) => {
      r.step("合成第 1/2 句", 1, 2);
      r.progress(0.5);
      r.step("合成第 2/2 句", 2, 2);
      r.progress(1);
    });

    const job = getJob(jobId)!;
    expect(job.status).toBe("succeeded");
    expect(job.progress).toBe(1);
    const kinds = eventsAfter(jobId, 0).map((e) => e.kind);
    expect(kinds).toContain("done");
    expect(kinds.filter((k) => k === "step")).toHaveLength(2);
  });

  it("协作式取消：置取消位后 checkCancelled → cancelled", async () => {
    const bookId = await makeBook();
    const jobId = createJobRow(bookId, "assets-phase1");
    setCancelRequested(jobId);

    await executeJob(jobId, async (r: ProgressReporter) => {
      r.step("生成中", 1, 3);
      if (r.checkCancelled()) throw new JobCancelledError();
    });

    const job = getJob(jobId)!;
    expect(job.status).toBe("cancelled");
    const errorEvents = eventsAfter(jobId, 0).filter((e) => e.kind === "error");
    expect(errorEvents[0].payload).toMatchObject({ cancelled: true });
  });

  it("失败：抛错 → failed + error 事件", async () => {
    const bookId = await makeBook();
    const jobId = createJobRow(bookId, "adapt");

    await executeJob(jobId, async () => {
      throw new Error("LLM 超时");
    });

    const job = getJob(jobId)!;
    expect(job.status).toBe("failed");
    expect(job.error).toContain("LLM 超时");
    const errorEvents = eventsAfter(jobId, 0).filter((e) => e.kind === "error");
    expect(errorEvents[0].payload).toMatchObject({ message: "LLM 超时" });
  });
});
