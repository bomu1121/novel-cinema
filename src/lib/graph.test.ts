import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "./db";
import { downstreamImpact, estimateNode } from "./pipeline/graph";

const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

async function makeChain(): Promise<{ bookId: string; adaptedId: string; beatId: string; shotId: string }> {
  const s = getSupabaseAdmin();
  const { data: book } = await s.from("books").insert({ owner_id: "t", title: `graph-${randomUUID()}` }).select("id").single();
  createdBookIds.push(book.id);
  const { data: chapter } = await s
    .from("source_chapters")
    .insert({ book_id: book.id, idx: 1, title: "第一章", raw_text: "a", cleaned_text: "a", char_count: 1 })
    .select("id")
    .single();
  const { data: adapted } = await s
    .from("adapted_chapters")
    .insert({ book_id: book.id, source_chapter_id: chapter.id, idx: 1, title: "第一章", status: "pending_review" })
    .select("id")
    .single();
  const beatId = randomUUID();
  await s.from("beats").insert({ id: beatId, book_id: book.id, adapted_chapter_id: adapted.id, idx: 1, type: "dialogue", text: "hi", source_span: "1-1", status: "draft" });
  const shotId = randomUUID();
  await s.from("shots").insert({ id: shotId, book_id: book.id, beat_id: beatId, idx: 1, description: "d", camera: "static", duration_sec: 3, transition_in: "cut", transition_out: "cut", status: "draft" });
  return { bookId: book.id, adaptedId: adapted.id, beatId, shotId };
}

describe("下游影响计数（docs/06 §4.2 stale 溯源）", () => {
  it("改 beat → 影响该 beat 的镜头与配音句", async () => {
    const { bookId, beatId } = await makeChain();
    const s = getSupabaseAdmin();
    const profileId = randomUUID();
    const profileInsert = await s.from("voice_profiles").insert({ id: profileId, book_id: bookId, name: "林晚", role: "character", provider: "t", provider_voice_id: "v1" });
    expect(profileInsert.error).toBeNull();
    const takeInsert = await s.from("voice_takes").insert({ id: randomUUID(), book_id: bookId, beat_id: beatId, voice_profile_id: profileId, provider: "t", model: "m", status: "draft" });
    expect(takeInsert.error).toBeNull();

    const impacts = await downstreamImpact(bookId, "beats", beatId);
    expect(impacts).toContainEqual({ table: "shots", count: 1 });
    expect(impacts).toContainEqual({ table: "voice_takes", count: 1 });
  });

  it("改章节 → 影响全部镜头与过期时间线", async () => {
    const { bookId, adaptedId } = await makeChain();
    const s = getSupabaseAdmin();
    await s.from("timelines").insert({ id: randomUUID(), book_id: bookId, kind: "preview", version: 1, snapshot: "{}", status: "stale" });

    const impacts = await downstreamImpact(bookId, "adapted_chapters", adaptedId);
    expect(impacts).toContainEqual({ table: "shots", count: 1 });
    expect(impacts).toContainEqual({ table: "timelines", count: 1 });
  });

  it("改时间线 → 影响渲染任务", async () => {
    const { bookId } = await makeChain();
    const s = getSupabaseAdmin();
    const timelineId = randomUUID();
    await s.from("timelines").insert({ id: timelineId, book_id: bookId, kind: "preview", version: 1, snapshot: "{}", status: "approved" });
    await s.from("render_jobs").insert({ id: randomUUID(), book_id: bookId, scope: "master", status: "queued" });

    const impacts = await downstreamImpact(bookId, "timelines", timelineId);
    expect(impacts).toContainEqual({ table: "render_jobs", count: 1 });
  });
});

describe("estimateNode 三档 gate（docs/07 I3）", () => {
  it("adapt/storyboard → block；analyze/bible.propose/assets/voice → notify；render → auto", async () => {
    const bookId = `gate-${randomUUID()}`;
    const adapt = await estimateNode(bookId, "adapt");
    const storyboard = await estimateNode(bookId, "storyboard");
    const analyze = await estimateNode(bookId, "analyze");
    const bible = await estimateNode(bookId, "bible.propose");
    const assets = await estimateNode(bookId, "assets-phase1");
    const voice = await estimateNode(bookId, "voice");
    const render = await estimateNode(bookId, "render");

    expect(adapt.gate).toBe("block");
    expect(storyboard.gate).toBe("block");
    expect(analyze.gate).toBe("notify");
    expect(bible.gate).toBe("notify");
    expect(bible.llmCalls).toBe(1);
    expect(assets.gate).toBe("notify");
    expect(voice.gate).toBe("notify");
    expect(render.gate).toBe("auto");
  });
});
