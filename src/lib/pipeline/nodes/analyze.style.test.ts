import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "@/lib/db";
import { approveStyleBible } from "./analyze";

const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

async function setupStyleBook() {
  const s = getSupabaseAdmin();
  const bookId = `style-test-${randomUUID()}`;
  createdBookIds.push(bookId);
  await s.from("books").insert({ id: bookId, title: "style-test", total_chars: 10 });

  const proposals = [
    {
      genre: ["mystery"],
      visual_style: "方案A",
      art_direction: "A",
      color_palette: ["#111111"],
      camera_grammar: {},
      narration_tone: "冷静",
      spoiler_rules: ["不要剧透"],
      negative_prompt: "text",
    },
    {
      genre: ["mystery"],
      visual_style: "方案B",
      art_direction: "B",
      color_palette: ["#222222"],
      camera_grammar: {},
      narration_tone: "紧张",
      spoiler_rules: ["不要剧透"],
      negative_prompt: "text",
    },
  ];
  const { data: style } = await s
    .from("style_bibles")
    .insert({
      book_id: bookId,
      version: 1,
      status: "pending_review",
      genre: proposals[0].genre,
      visual_style: proposals[0].visual_style,
      art_direction: proposals[0].art_direction,
      color_palette: proposals[0].color_palette,
      camera_grammar: proposals[0].camera_grammar,
      narration_tone: proposals[0].narration_tone,
      spoiler_rules: { rules: proposals[0].spoiler_rules },
      negative_prompt: { text: proposals[0].negative_prompt },
      proposal_json: proposals,
      approved_proposal_index: null,
    })
    .select("id")
    .single();

  const { data: chapter } = await s
    .from("source_chapters")
    .insert({
      book_id: bookId,
      idx: 1,
      title: "第一章",
      raw_text: "原文",
      cleaned_text: "原文",
      char_count: 2,
    })
    .select("id")
    .single();

  await s.from("adapted_chapters").insert({
    book_id: bookId,
    source_chapter_id: chapter.id,
    idx: 1,
    title: "脚本",
    hook: "hook",
    status: "approved",
    selection_report: {},
    raw_output: {},
  });
  await s.from("condensed_chapters").insert({
    book_id: bookId,
    source_chapter_id: chapter.id,
    title: "底稿",
    hook: "hook",
    condensed_text: "精简稿",
    source_chars: 10,
    target_chars: 4,
    status: "approved",
    report: {},
  });

  return { bookId, styleId: style.id };
}

describe("style bible 批准", () => {
  it("批准所选方案并让脚本/精简底稿过期", async () => {
    const s = getSupabaseAdmin();
    const { bookId, styleId } = await setupStyleBook();

    const selected = await approveStyleBible(bookId, styleId, 1);
    expect(selected?.visual_style).toBe("方案B");

    const { data: style } = await s
      .from("style_bibles")
      .select("status, approved_proposal_index, visual_style")
      .eq("id", styleId)
      .single();
    expect(style.status).toBe("approved");
    expect(style.approved_proposal_index).toBe(1);

    const { data: adapted } = await s.from("adapted_chapters").select("status").eq("book_id", bookId);
    expect(adapted.every((r: { status: string }) => r.status === "stale")).toBe(true);
    const { data: condensed } = await s.from("condensed_chapters").select("status").eq("book_id", bookId);
    expect(condensed.every((r: { status: string }) => r.status === "stale")).toBe(true);
  });

  it("不能批准其他书的风格方案", async () => {
    const s = getSupabaseAdmin();
    const { styleId } = await setupStyleBook();

    const selected = await approveStyleBible("other-book", styleId, 0);
    expect(selected).toBeNull();
    const { data: style } = await s.from("style_bibles").select("status").eq("id", styleId).single();
    expect(style.status).toBe("pending_review");
  });
});
