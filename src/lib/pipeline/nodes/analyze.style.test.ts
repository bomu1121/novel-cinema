import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "@/lib/db";
import { approveStyleBible, persistStyleProposals, restoreStyleProposal } from "./analyze";
import type { StyleBibleProposal, StyleBibleProposals } from "@/lib/pipeline/schemas/analysis";

const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id);
  }
});

const CAMERA = {
  dialogue: "说话人近景",
  narration: "宽景",
  transition: "crossfade",
};

function makeProposals(): StyleBibleProposals {
  return {
    proposals: [
      {
        genre: ["mystery"],
        visual_style: "方案A",
        art_direction: "A",
        color_palette: ["#111111"],
        camera_grammar: CAMERA,
        narration_tone: "冷静",
        spoiler_rules: ["不要剧透"],
        negative_prompt: "text",
        rationale: "适配冷峻悬疑",
      },
      {
        genre: ["mystery"],
        visual_style: "方案B",
        art_direction: "B",
        color_palette: ["#222222"],
        camera_grammar: CAMERA,
        narration_tone: "紧张",
        spoiler_rules: ["不要剧透"],
        negative_prompt: "text",
        rationale: "适配紧张节奏",
      },
    ],
    recommended_index: 0,
  };
}

async function setupStyleBook() {
  const s = getSupabaseAdmin();
  const bookId = `style-test-${randomUUID()}`;
  createdBookIds.push(bookId);
  await s.from("books").insert({ id: bookId, title: "style-test", total_chars: 10 });

  const proposals = makeProposals();
  const result = await persistStyleProposals(bookId, proposals);

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

  return { bookId, styleId: result.id };
}

describe("style bible 批准（签核 A）", () => {
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

  it("已锁定状态可改选另一套（换选）", async () => {
    const s = getSupabaseAdmin();
    const { bookId, styleId } = await setupStyleBook();

    await approveStyleBible(bookId, styleId, 1);
    const selected = await approveStyleBible(bookId, styleId, 0);
    expect(selected?.visual_style).toBe("方案A");

    const { data: style } = await s
      .from("style_bibles")
      .select("status, approved_proposal_index, visual_style, manual_override")
      .eq("id", styleId)
      .single();
    expect(style.status).toBe("approved");
    expect(style.approved_proposal_index).toBe(0);
    expect(style.manual_override).toBe(0);
  });
});

describe("style bible 批次归档（docs/14）", () => {
  it("重新生成：旧批次归档进 bible_proposals、version+1、回到待审", async () => {
    const s = getSupabaseAdmin();
    const { bookId, styleId } = await setupStyleBook();
    await approveStyleBible(bookId, styleId, 1);

    const next = makeProposals();
    next.proposals[0].visual_style = "方案C";
    const result = await persistStyleProposals(bookId, next);
    expect(result.version).toBe(2);
    expect(result.archived).toBe(true);

    const { data: style } = await s
      .from("style_bibles")
      .select("version, status, approved_proposal_index, visual_style, manual_override")
      .eq("id", styleId)
      .single();
    expect(style.version).toBe(2);
    expect(style.status).toBe("pending_review");
    expect(style.approved_proposal_index).toBeNull();
    expect(style.visual_style).toBe("方案C");
    expect(style.manual_override).toBe(0);

    // 归档批次：保留旧候选与当时的批准索引
    const { data: history } = await s
      .from("bible_proposals")
      .select("version, proposal_json, approved_index, note")
      .eq("book_id", bookId);
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].approved_index).toBe(1);
    expect((history[0].proposal_json as StyleBibleProposal[])[0].visual_style).toBe("方案A");
  });

  it("恢复历史批次：内容回到当前、版本号追加、note 标记", async () => {
    const s = getSupabaseAdmin();
    const { bookId, styleId } = await setupStyleBook();

    // 生成 v2，v1 被归档
    const next = makeProposals();
    next.proposals[0].visual_style = "方案C";
    await persistStyleProposals(bookId, next);

    const { data: history } = await s
      .from("bible_proposals")
      .select("id, version, approved_index")
      .eq("book_id", bookId)
      .single();
    expect(history).toBeTruthy();

    // 恢复 v1 → 当前候选 = v1 内容，version 3，v2 被归档
    const restored = await restoreStyleProposal(bookId, history.id);
    expect(restored.version).toBe(3);

    const { data: style } = await s
      .from("style_bibles")
      .select("version, status, visual_style, proposal_json")
      .eq("id", styleId)
      .single();
    expect(style.version).toBe(3);
    expect(style.status).toBe("pending_review");
    expect(style.visual_style).toBe("方案A");
    expect((style.proposal_json as StyleBibleProposal[]).length).toBe(2);

    const { data: archived } = await s
      .from("bible_proposals")
      .select("version, note, proposal_json")
      .eq("book_id", bookId)
      .order("version", { ascending: true });
    expect(archived).toHaveLength(2);
    expect(archived[0].version).toBe(1);
    expect(archived[1].version).toBe(2);
    expect(archived[1].note).toContain("恢复自批次 v1");
    // 恢复时被归档的是当时的当前批次（v2 内容）
    expect((archived[1].proposal_json as StyleBibleProposal[])[0].visual_style).toBe("方案C");
  });

  it("不能恢复其他书的历史批次", async () => {
    const s = getSupabaseAdmin();
    const { bookId } = await setupStyleBook();
    await persistStyleProposals(bookId, makeProposals());

    const { data: history } = await s
      .from("bible_proposals")
      .select("id")
      .eq("book_id", bookId)
      .single();
    await expect(restoreStyleProposal("other-book", history.id)).rejects.toThrow("不属于本书");
  });
});
