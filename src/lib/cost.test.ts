import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "./db";
import { costSummary } from "./cost";

const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

async function makeBook(): Promise<string> {
  const s = getSupabaseAdmin();
  const { data: book, error } = await s.from("books").insert({ owner_id: "test", title: "cost-test" }).select("id").single();
  if (error) throw error;
  createdBookIds.push(book.id);
  return book.id;
}

describe("成本汇总（docs/06 §6.2，与 cost-report.ts 同口径）", () => {
  it("按节点聚合调用次数 / 失败 / tokens", async () => {
    const bookId = await makeBook();
    const s = getSupabaseAdmin();
    await s.from("jobs").insert([
      { book_id: bookId, node: "adapt.chapter", status: "succeeded", cost: { input_tokens: 1000, output_tokens: 500, model: "deepseek" } },
      { book_id: bookId, node: "adapt.chapter", status: "succeeded", cost: { input_tokens: 800, output_tokens: 400, model: "deepseek" } },
      { book_id: bookId, node: "review.script", status: "failed", cost: { input_tokens: 300, output_tokens: 0 } },
    ]);

    const summary = costSummary(bookId);
    expect(summary.calls).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.inputTokens).toBe(2100);
    expect(summary.outputTokens).toBe(900);
    expect(summary.byNode["adapt.chapter"]).toMatchObject({ calls: 2, failed: 0, inputTokens: 1800, outputTokens: 900 });
    expect(summary.byNode["review.script"]).toMatchObject({ calls: 1, failed: 1 });
  });

  it("今日口径只统计当天的任务", async () => {
    const bookId = await makeBook();
    const s = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    await s.from("jobs").insert([
      { book_id: bookId, node: "analyze", status: "succeeded", cost: { input_tokens: 100, output_tokens: 50 }, created_at: `${today}T03:00:00.000Z` },
      { book_id: bookId, node: "analyze", status: "succeeded", cost: { input_tokens: 999, output_tokens: 999 }, created_at: "2020-01-01T00:00:00.000Z" },
    ]);

    expect(costSummary(bookId).inputTokens).toBe(1099);
    expect(costSummary(bookId, true).inputTokens).toBe(100);
  });
});
