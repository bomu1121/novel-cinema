import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin, rawDb } from "./db";
import { applyStaged, discardStaged, listStaged, stageEntries, stagedSummary } from "./staging";
import { createJobRow } from "./jobs/progress";
import { computeStoryboard } from "./pipeline/nodes/storyboard";

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
    .insert({ owner_id: "test", title: `staging-${randomUUID()}` })
    .select("id")
    .single();
  if (error) throw error;
  createdBookIds.push(book.id);
  return book.id;
}

async function makeChain(bookId: string, beatType = "dialogue") {
  const s = getSupabaseAdmin();
  const { data: chapter } = await s
    .from("source_chapters")
    .insert({ book_id: bookId, idx: 1, title: "第一章", raw_text: "a", cleaned_text: "a", char_count: 1 })
    .select("id")
    .single();
  const { data: adapted } = await s
    .from("adapted_chapters")
    .insert({ book_id: bookId, source_chapter_id: chapter.id, idx: 1, title: "第一章" })
    .select("id")
    .single();
  const beatId = randomUUID();
  await s.from("beats").insert({
    id: beatId,
    book_id: bookId,
    adapted_chapter_id: adapted.id,
    idx: 1,
    type: beatType,
    text: "旧台词",
    source_span: "1-1",
    status: "draft",
  });
  return { chapterId: chapter.id, adaptedId: adapted.id, beatId };
}

describe("staging 审阅（docs/06 §6.3）", () => {
  it("stageEntries 写入 + listStaged 按 seq 排序 + summary 分组", async () => {
    const bookId = await makeBook();
    const jobId = createJobRow(bookId, "adapt");
    stageEntries(bookId, jobId, "adapt", [
      { tableName: "beats", op: "delete", rowId: "b1", before: { id: "b1", text: "旧" }, groupKey: "beat#1" },
      { tableName: "beats", op: "insert", after: { id: "b2", text: "新" }, groupKey: "beat#1" },
    ]);

    const entries = listStaged(bookId, jobId);
    expect(entries).toHaveLength(2);
    expect(entries[0].op).toBe("delete");
    expect(entries[0].before).toMatchObject({ text: "旧" });

    const summary = stagedSummary(bookId);
    expect(summary[0]).toMatchObject({ node: "adapt", count: 2 });
    expect(summary[0].groups).toContainEqual({ key: "beat#1", count: 2 });
  });

  it("applyStaged：insert/delete 按决策应用，未决条目按拒绝处理，随后清空", async () => {
    const bookId = await makeBook();
    const { beatId } = await makeChain(bookId);
    const jobId = createJobRow(bookId, "adapt");

    const insertId = randomUUID();
    stageEntries(bookId, jobId, "adapt", [
      { tableName: "beats", op: "delete", rowId: beatId, before: { id: beatId, text: "旧台词" }, groupKey: "beat#1" },
      {
        tableName: "beats",
        op: "insert",
        after: {
          id: insertId,
          book_id: bookId,
          adapted_chapter_id: (rawDb.prepare(`SELECT adapted_chapter_id FROM beats WHERE id = ?`).get(beatId) as { adapted_chapter_id: string }).adapted_chapter_id,
          idx: 1,
          type: "dialogue",
          text: "新台词",
          source_span: "1-1",
          status: "draft",
        },
        groupKey: "beat#1",
      },
    ]);

    const result = applyStaged(bookId, jobId, {});
    // 两条都未决 → 全部按拒绝（不应用）
    expect(result).toEqual({ applied: 0, rejected: 2 });
    expect(listStaged(bookId, jobId)).toHaveLength(0);

    // 重新 stage 并接受 delete + 拒绝 insert
    stageEntries(bookId, jobId, "adapt", [
      { tableName: "beats", op: "delete", rowId: beatId, before: { id: beatId, text: "旧台词" }, groupKey: "beat#1" },
      {
        tableName: "beats",
        op: "insert",
        after: {
          id: insertId,
          book_id: bookId,
          adapted_chapter_id: "unused",
          idx: 1,
          type: "dialogue",
          text: "新台词",
          source_span: "1-1",
          status: "draft",
        },
        groupKey: "beat#1",
      },
    ]);
    const entries = listStaged(bookId, jobId);
    const decisions: Record<string, "accepted" | "rejected"> = {
      [entries[0].id]: "accepted",
      [entries[1].id]: "rejected",
    };
    const r2 = applyStaged(bookId, jobId, decisions);
    expect(r2).toEqual({ applied: 1, rejected: 1 });

    const { data: remaining } = await getSupabaseAdmin().from("beats").select("id").eq("id", beatId);
    expect(remaining?.length ?? 0).toBe(0);
    expect(listStaged(bookId, jobId)).toHaveLength(0);
  });

  it("discardStaged：只丢弃不落库", async () => {
    const bookId = await makeBook();
    const { beatId } = await makeChain(bookId);
    const jobId = createJobRow(bookId, "adapt");
    stageEntries(bookId, jobId, "adapt", [
      { tableName: "beats", op: "delete", rowId: beatId, before: { id: beatId }, groupKey: "beat#1" },
    ]);
    const dropped = discardStaged(bookId, jobId);
    expect(dropped).toBe(1);
    const { data: still } = await getSupabaseAdmin().from("beats").select("id").eq("id", beatId);
    expect(still).not.toBeNull();
  });

  it("stageStoryboard：旧镜头 delete + 新镜头 insert + timeline insert（快照引用同一批 id）", async () => {
    const bookId = await makeBook();
    // insert_card 类型不需要已批准背景图，便于纯本地验证
    const { adaptedId, beatId } = await makeChain(bookId, "insert_card");

    // 造一个旧镜头（含图层）
    const oldShotId = randomUUID();
    await getSupabaseAdmin().from("shots").insert({
      id: oldShotId,
      book_id: bookId,
      beat_id: beatId,
      idx: 1,
      description: "旧镜头",
      camera: "static",
      duration_sec: 3,
      transition_in: "cut",
      transition_out: "cut",
      status: "draft",
    });
    await getSupabaseAdmin().from("shot_layers").insert({
      id: randomUUID(),
      shot_id: oldShotId,
      idx: 0,
      z: 0,
      kind: "character",
    });

    const staged = await computeStoryboard(bookId, adaptedId);
    expect(staged.drafts.length).toBeGreaterThan(0);
    const shotIds = new Set(staged.drafts.map((d) => d.shotId));
    for (const d of staged.drafts) expect(shotIds.has(d.shotId!)).toBe(true);
    // 快照 tracks 引用同一批 shotId
    const tracks = staged.snapshot.tracks as Array<{ shotId?: string }>;
    for (const t of tracks) expect(shotIds.has(t.shotId!)).toBe(true);
  });
});
