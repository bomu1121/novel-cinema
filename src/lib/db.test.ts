import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "./db";

// 本地 SQLite 数据层回归测试（多行插入/JSON 编解码/upsert/错误返回）
const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

async function makeBook(title = `db-test-${randomUUID()}`) {
  const s = getSupabaseAdmin();
  const { data: book, error } = await s
    .from("books")
    .insert({ owner_id: "test", title, total_chars: 10 })
    .select("id")
    .single();
  if (error) throw error;
  createdBookIds.push(book.id);
  return book.id;
}

describe("SQLite 数据层", () => {
  it("多行 insert + 按序 select（回归：参数过多 bug）", async () => {
    const s = getSupabaseAdmin();
    const bookId = await makeBook();

    const { error } = await s.from("source_chapters").insert([
      { book_id: bookId, idx: 1, title: "第一章", raw_text: "a", cleaned_text: "a", char_count: 1 },
      { book_id: bookId, idx: 2, title: "第二章", raw_text: "b", cleaned_text: "b", char_count: 1 },
    ]);
    expect(error).toBeNull();

    const { data, error: selectError } = await s
      .from("source_chapters")
      .select("idx, title")
      .eq("book_id", bookId)
      .order("idx");
    expect(selectError).toBeNull();
    expect(data).toHaveLength(2);
    expect(data[0].title).toBe("第一章");
    expect(data[1].title).toBe("第二章");
  });

  it("JSON 列自动编解码（数组/对象往返）", async () => {
    const s = getSupabaseAdmin();
    const bookId = await makeBook();

    const { data: ch, error } = await s
      .from("characters")
      .insert({
        book_id: bookId,
        canonical_name: "林晚",
        aliases: ["小晚"],
        bio: { appearance: "黑色长发", age: 27 },
      })
      .select("id, aliases, bio")
      .single();
    expect(error).toBeNull();
    expect(ch.aliases).toEqual(["小晚"]);
    expect(ch.bio.age).toBe(27);

    const { error: updError } = await s
      .from("characters")
      .update({ bio: { appearance: "短发" } })
      .eq("id", ch.id);
    expect(updError).toBeNull();

    const { data: again } = await s
      .from("characters")
      .select("bio")
      .eq("id", ch.id)
      .single();
    expect(again.bio.appearance).toBe("短发");
  });

  it("upsert onConflict 覆盖更新", async () => {
    const s = getSupabaseAdmin();
    const bookId = await makeBook();

    const { data: chapter, error } = await s
      .from("source_chapters")
      .insert({ book_id: bookId, idx: 1, title: "第一章", raw_text: "a", cleaned_text: "a", char_count: 1 })
      .select("id")
      .single();
    expect(error).toBeNull();

    const { error: up1 } = await s.from("chapter_summaries").upsert(
      { book_id: bookId, source_chapter_id: chapter.id, summary: "第一版" },
      { onConflict: "source_chapter_id" },
    );
    expect(up1).toBeNull();

    const { error: up2 } = await s.from("chapter_summaries").upsert(
      { book_id: bookId, source_chapter_id: chapter.id, summary: "第二版" },
      { onConflict: "source_chapter_id" },
    );
    expect(up2).toBeNull();

    const { data: rows } = await s
      .from("chapter_summaries")
      .select("summary")
      .eq("source_chapter_id", chapter.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("第二版");
  });

  it("约束冲突以 {error} 返回而不是抛异常", async () => {
    const s = getSupabaseAdmin();
    const bookId = await makeBook();
    const base = { book_id: bookId, idx: 1, title: "第一章", raw_text: "a", cleaned_text: "a", char_count: 1 };
    await s.from("source_chapters").insert(base);

    const { error } = await s.from("source_chapters").insert(base);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("UNIQUE");
  });
});
