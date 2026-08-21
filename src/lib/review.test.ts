import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "./db";
import { handleAdaptationFailure, listOpenReviewTasks } from "./review";

const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

async function makeBook(): Promise<string> {
  const s = getSupabaseAdmin();
  const { data: book, error } = await s
    .from("books")
    .insert({ owner_id: "test", title: `review-${randomUUID()}` })
    .select("id")
    .single();
  if (error) throw error;
  createdBookIds.push(book.id);
  return book.id;
}

describe("adapt 失败降级（docs/06 附录 F）", () => {
  it("handleAdaptationFailure：写入 open 诊断任务并返回可读消息", async () => {
    const bookId = await makeBook();
    const message = await handleAdaptationFailure(bookId, {
      errors: ["总时长 191.0s 超过预算 154s 的 110%", "beat[3] source_span.quote 无法在原文中定位"],
      lastAdapt: { beats: [] },
    });

    expect(message).toContain("详情已存入待审收件箱");

    const tasks = await listOpenReviewTasks(bookId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].kind).toBe("chapter_script");
    const report = tasks[0].aiReport as { kind: string; severity: string; issue: string };
    expect(report.kind).toBe("adapt_validation");
    expect(report.severity).toBe("red");
    expect(report.issue).toContain("总时长");
  });

  it("空错误列表也能生成诊断（不抛异常）", async () => {
    const bookId = await makeBook();
    const message = await handleAdaptationFailure(bookId, {});
    expect(message).toContain("待审收件箱");
    const tasks = await listOpenReviewTasks(bookId);
    expect(tasks).toHaveLength(1);
  });
});
