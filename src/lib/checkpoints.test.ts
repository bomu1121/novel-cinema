import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "./db";
import {
  createCheckpoint,
  latestCheckpointId,
  listCheckpoints,
  revertCheckpoint,
} from "./checkpoints";

// checkpoint 回归测试（docs/06 §4.4：破坏性操作可回滚的信任地基）
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
    .insert({ owner_id: "test", title: `cp-test-${randomUUID()}` })
    .select("id")
    .single();
  if (error) throw error;
  createdBookIds.push(book.id);
  return book.id;
}

/** 完整依赖链：book → source_chapter → adapted_chapter → beat（shots 的 FK 链） */
async function makeBeat(bookId: string, text = "你好"): Promise<string> {
  const s = getSupabaseAdmin();
  const { data: chapter, error: ce } = await s
    .from("source_chapters")
    .insert({ book_id: bookId, idx: 1, title: "第一章", raw_text: text, cleaned_text: text, char_count: 2 })
    .select("id")
    .single();
  if (ce) throw ce;
  const { data: adapted, error: ae } = await s
    .from("adapted_chapters")
    .insert({ book_id: bookId, source_chapter_id: chapter.id, idx: 1, title: "第一章" })
    .select("id")
    .single();
  if (ae) throw ae;
  const { data: beat, error: be } = await s
    .from("beats")
    .insert({
      id: randomUUID(),
      book_id: bookId,
      adapted_chapter_id: adapted.id,
      idx: 1,
      type: "dialogue",
      text,
      source_span: "1-1",
      status: "draft",
    })
    .select("id")
    .single();
  if (be) throw be;
  return beat.id;
}

async function makeShot(bookId: string, beatId: string, idx: number, duration: number) {
  const s = getSupabaseAdmin();
  const { data: shot, error } = await s
    .from("shots")
    .insert({
      book_id: bookId,
      beat_id: beatId,
      idx,
      description: `镜头 ${idx}`,
      camera: "static",
      duration_sec: duration,
      transition_in: "cut",
      transition_out: "cut",
      style: { locked: true },
      status: "draft",
    })
    .select("id")
    .single();
  if (error) throw error;
  return shot.id;
}

describe("checkpoint", () => {
  it("重建分镜场景：delete 快照可完整恢复被删行（含 JSON 字段）", async () => {
    const bookId = await makeBook();
    const s = getSupabaseAdmin();
    const beatId = await makeBeat(bookId);

    const shotId = await makeShot(bookId, beatId, 1, 3.2);
    const layerId = randomUUID();
    const layerInsert = await s
      .from("shot_layers")
      .insert({ id: layerId, shot_id: shotId, idx: 0, z: 0, kind: "character", expression: "happy", rect: { x: 0, y: 0, w: 100, h: 100 } });
    expect(layerInsert.error).toBeNull();

    // 模拟 buildStoryboard：对旧 shots/layers 建 delete 快照后删除
    const cpId = createCheckpoint(bookId, "重建分镜前（1 镜头）", "node-rerun", "storyboard", [
      { table: "shots", rowId: shotId, before: (await s.from("shots").select("*").eq("id", shotId).single()).data, op: "delete" },
      { table: "shot_layers", rowId: layerId, before: (await s.from("shot_layers").select("*").eq("id", layerId).single()).data, op: "delete" },
    ]);
    expect(cpId).toBeTruthy();
    expect(latestCheckpointId(bookId)).toBe(cpId);
    expect(listCheckpoints(bookId)[0].rowCount).toBe(2);

    await s.from("shot_layers").delete().eq("id", layerId);
    await s.from("shots").delete().eq("id", shotId);

    // 回滚后旧数据完整回来（含 JSON 字段 rect/style）
    const result = revertCheckpoint(bookId, cpId);
    expect(result.restored).toBe(2);
    expect(result.label).toContain("重建分镜前");

    const { data: restoredShot } = await s.from("shots").select("*").eq("id", shotId).single();
    expect(restoredShot).not.toBeNull();
    expect(restoredShot.duration_sec).toBe(3.2);
    expect(restoredShot.style).toEqual({ locked: true });
    const { data: restoredLayer } = await s.from("shot_layers").select("*").eq("id", layerId).single();
    expect(restoredLayer).not.toBeNull();
    expect(restoredLayer.rect).toEqual({ x: 0, y: 0, w: 100, h: 100 });

    // checkpoint 已被消费：再回滚应报错
    expect(() => revertCheckpoint(bookId, cpId)).toThrow("checkpoint 不存在");
    expect(latestCheckpointId(bookId)).toBeNull();
  });

  it("手动编辑场景：update 快照还原被改字段", async () => {
    const bookId = await makeBook();
    const s = getSupabaseAdmin();
    const beatId = await makeBeat(bookId, "原文");

    const before = (await s.from("beats").select("*").eq("id", beatId).single()).data;
    const cpId = createCheckpoint(bookId, "手动编辑「beats」", "manual-edit", undefined, [
      { table: "beats", rowId: beatId, before, op: "update" },
    ]);
    await s.from("beats").update({ text: "被改过的台词", emotion: "angry" }).eq("id", beatId);

    revertCheckpoint(bookId, cpId);

    const { data: beat } = await s.from("beats").select("*").eq("id", beatId).single();
    expect(beat.text).toBe("原文");
    expect(beat.emotion).toBe("neutral");
  });

  it("拒绝快照白名单外的表", () => {
    expect(() =>
      createCheckpoint("x", "非法", "node-rerun", undefined, [
        { table: "books", rowId: "y", before: {}, op: "update" },
      ]),
    ).toThrow("不允许快照的表");
  });

  it("签核点（P2 验收④）：批准改编章节建 checkpoint，回滚恢复到批准前状态", async () => {
    const bookId = await makeBook();
    const s = getSupabaseAdmin();
    const { approveAdaptedChapter } = await import("./pipeline/nodes/adapt");

    // 完整依赖链
    const { data: chapter } = await s
      .from("source_chapters")
      .insert({ book_id: bookId, idx: 1, title: "第一章", raw_text: "a", cleaned_text: "a", char_count: 1 })
      .select("id")
      .single();
    const { data: adapted } = await s
      .from("adapted_chapters")
      .insert({ book_id: bookId, source_chapter_id: chapter.id, idx: 1, title: "第一章", status: "pending_review" })
      .select("id")
      .single();

    await approveAdaptedChapter(adapted.id);
    const { data: approved } = await s.from("adapted_chapters").select("status").eq("id", adapted.id).single();
    expect(approved.status).toBe("approved");

    // 批准留下了签核点
    const cps = listCheckpoints(bookId);
    expect(cps.some((c) => c.origin === "approve" && c.label.includes("批准本章"))).toBe(true);

    // 回滚到批准前
    revertCheckpoint(bookId, cps[0].id);
    const { data: reverted } = await s.from("adapted_chapters").select("status").eq("id", adapted.id).single();
    expect(reverted.status).toBe("pending_review");
  });
});
