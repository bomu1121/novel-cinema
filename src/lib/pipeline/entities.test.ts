import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "@/lib/db";
import { listCheckpoints } from "@/lib/checkpoints";
import {
  betterEntityCanonical,
  entityCompareKey,
  entityNamesMatch,
  healDuplicateEntities,
} from "@/lib/pipeline/entities";
import { persistChapterAnalysis } from "@/lib/pipeline/nodes/analyze";
import type { ChunkAnalysis } from "@/lib/pipeline/schemas/analysis";

// 地点/物品/线索去重回归：匹配谓词 / 逐章合并 / 存量 heal（真实 SQLite，book 级清理）
const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id); // 级联清理全部下游
  }
});

async function makeBook(title = `ent-test-${randomUUID()}`) {
  const s = getSupabaseAdmin();
  const { data, error } = await s
    .from("books")
    .insert({ owner_id: "test", title, total_chars: 100 })
    .select("id")
    .single();
  if (error) throw error;
  createdBookIds.push(data.id);
  return data.id;
}

async function makeChapter(bookId: string, idx: number) {
  const s = getSupabaseAdmin();
  const { data, error } = await s
    .from("source_chapters")
    .insert({
      book_id: bookId,
      idx,
      title: `第${idx}章`,
      raw_text: "x",
      cleaned_text: "x",
      char_count: 1,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function analysisWith(partial: Partial<ChunkAnalysis>): ChunkAnalysis {
  return {
    characters: [],
    events: [],
    locations: [],
    items: [],
    clues: [],
    summary: "测试摘要",
    tone: "悬疑",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 纯函数：匹配谓词
// ---------------------------------------------------------------------------
describe("实体匹配（entityNamesMatch）", () => {
  const row = (name: string, aliases: string[] = []) => ({ name, aliases });

  it("canonical 精确相等", () => {
    expect(entityNamesMatch(row("好见地区"), { name: "好见地区" })).toBe(true);
  });

  it("旧别名 = 新名字 / 旧 canonical ∈ 新别名", () => {
    expect(entityNamesMatch(row("神红大学中央联合食堂", ["中央联合食堂"]), { name: "中央联合食堂" })).toBe(true);
    expect(entityNamesMatch(row("中央联合食堂"), { name: "中央联合食堂", aliases: ["神红大学中央联合食堂"] })).toBe(true);
  });

  it("去「的/の」变体相等（比留子同学的公寓 ↔ 比留子同学公寓）", () => {
    expect(entityNamesMatch(row("比留子同学公寓"), { name: "比留子同学的公寓" })).toBe(true);
    expect(entityCompareKey("比留子同学的公寓")).toBe(entityCompareKey("比留子同学公寓"));
  });

  it("共享通用词不误合并（食堂/公寓）", () => {
    expect(entityNamesMatch(row("神红大学中央联合食堂", ["食堂"]), { name: "中央第一食堂", aliases: ["食堂"] })).toBe(false);
  });

  it("线索保守包含（预言信件 ↔ 预言信件内容），超界不误并", () => {
    expect(entityNamesMatch(row("预言信件"), { name: "预言信件内容" }, { containment: true })).toBe(true);
    expect(entityNamesMatch(row("预言信件"), { name: "预言信件内容" })).toBe(false); // 默认不含
    // 长度差超界（4）：机构 vs 分署设施 不合并
    expect(entityNamesMatch(row("班目机构"), { name: "班目机构分署研究设施" }, { containment: true })).toBe(false);
    // 短名不足 4 字：不合并
    expect(entityNamesMatch(row("日记"), { name: "日记中的记述" }, { containment: true })).toBe(false);
  });

  it("不同实体不误合并", () => {
    expect(entityNamesMatch(row("好见地区"), { name: "底无川" })).toBe(false);
    expect(entityNamesMatch(row("魔眼之匣"), { name: "好见村" })).toBe(false);
  });

  it("betterEntityCanonical：全名升级", () => {
    expect(betterEntityCanonical("中央联合食堂", "神红大学中央联合食堂")).toBe("神红大学中央联合食堂");
    expect(betterEntityCanonical("神红大学中央联合食堂", "中央联合食堂")).toBeNull();
    expect(betterEntityCanonical("好见", "好见地区")).toBe("好见地区");
  });
});

// ---------------------------------------------------------------------------
// 逐章合并（persistChapterAnalysis）
// ---------------------------------------------------------------------------
describe("persistChapterAnalysis 实体合并", () => {
  it("地点：后续章节的简称/别称合并进已有行，不新建", async () => {
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const c2 = await makeChapter(bookId, 2);
    const s = getSupabaseAdmin();

    await persistChapterAnalysis(bookId, { id: c1, idx: 1, title: null, cleanedText: "a" }, analysisWith({
      locations: [{ name: "神红大学中央联合食堂", aliases: ["中央联合食堂"], description: "玻璃墙。", visual_note: "" }],
    }));
    await persistChapterAnalysis(bookId, { id: c2, idx: 2, title: null, cleanedText: "b" }, analysisWith({
      locations: [{ name: "中央联合食堂", aliases: [], description: "校园里最大的学生食堂，木纹天花板，客人很多。", visual_note: "" }],
    }));

    const { data: rows } = await s.from("locations").select("name, aliases, description").eq("book_id", bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("神红大学中央联合食堂"); // canonical 保留全名
    expect(rows[0].aliases).toEqual(expect.arrayContaining(["中央联合食堂"]));
    expect(rows[0].description).toContain("木纹天花板"); // 更长描述保留
  });

  it("地点：同章内变体也合并（动态工作数组）", async () => {
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const s = getSupabaseAdmin();

    await persistChapterAnalysis(bookId, { id: c1, idx: 1, title: null, cleanedText: "a" }, analysisWith({
      locations: [
        { name: "好见地区", aliases: ["好见"], description: "W县深山中的村庄。", visual_note: "" },
        { name: "好见", aliases: [], description: "村民集体离开。", visual_note: "" },
      ],
    }));

    const { data: rows } = await s.from("locations").select("name, aliases").eq("book_id", bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("好见地区");
    expect(rows[0].aliases).toContain("好见");
  });

  it("线索：同一条线索的不同表述合并（aliases），红鲱鱼取并集", async () => {
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const c2 = await makeChapter(bookId, 2);
    const s = getSupabaseAdmin();

    await persistChapterAnalysis(bookId, { id: c1, idx: 1, title: null, cleanedText: "a" }, analysisWith({
      clues: [{ name: "预言信件", aliases: [], clue_type: "foreshadowing", description: "编辑部收到的匿名信件，预言了六月大阪火灾。", is_red_herring: false, is_spoiler: false }],
    }));
    await persistChapterAnalysis(bookId, { id: c2, idx: 2, title: null, cleanedText: "b" }, analysisWith({
      clues: [{ name: "预言信件内容", aliases: ["预言信件"], clue_type: "letter", description: "信件预言了六月大阪火灾和八月娑可安湖事件，暗示超能力实验。", is_red_herring: true, is_spoiler: false }],
    }));

    const { data: rows } = await s.from("clues").select("name, aliases, description, is_red_herring").eq("book_id", bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("预言信件内容"); // 对比键更长 → 升级
    expect(rows[0].aliases).toEqual(expect.arrayContaining(["预言信件"]));
    expect(rows[0].description).toContain("娑可安湖");
    expect(rows[0].is_red_herring).toBe(1); // 任一标注红鲱鱼即红鲱鱼
  });

  it("物品：别名变体合并", async () => {
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const c2 = await makeChapter(bookId, 2);
    const s = getSupabaseAdmin();

    await persistChapterAnalysis(bookId, { id: c1, idx: 1, title: null, cleanedText: "a" }, analysisWith({
      items: [{ name: "素描本", aliases: [], kind: "object", description: "十色的素描本。", visual_note: "" }],
    }));
    await persistChapterAnalysis(bookId, { id: c2, idx: 2, title: null, cleanedText: "b" }, analysisWith({
      items: [{ name: "素描本", aliases: [], kind: "object", description: "素描本上画着燃烧的桥。", visual_note: "" }],
    }));

    const { data: rows } = await s.from("items").select("name, description").eq("book_id", bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toContain("燃烧的桥");
  });
});

// ---------------------------------------------------------------------------
// 存量去重（heal）
// ---------------------------------------------------------------------------
describe("healDuplicateEntities", () => {
  async function makeDupBook() {
    const s = getSupabaseAdmin();
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const c2 = await makeChapter(bookId, 2);

    const insert = async (table: string, row: Record<string, unknown>) => {
      const { data } = await s.from(table).insert({ book_id: bookId, ...row }).select("id").single();
      return data.id;
    };

    const loc1 = await insert("locations", { name: "神红大学中央联合食堂", aliases: ["中央联合食堂"], description: "校园里最大的学生食堂，玻璃墙。", first_chapter_id: c1, status: "draft" });
    const loc2 = await insert("locations", { name: "中央联合食堂", aliases: [], description: "木纹天花板。", first_chapter_id: c2, status: "draft" });
    const loc3 = await insert("locations", { name: "比留子同学的公寓", aliases: [], description: "装修高雅的外墙贴瓷砖十层公寓。", first_chapter_id: c1, status: "draft" });
    const loc4 = await insert("locations", { name: "比留子同学公寓", aliases: [], description: "专供单身女性居住。", first_chapter_id: c2, status: "draft" });
    const locSolo = await insert("locations", { name: "魔眼之匣", aliases: [], description: "岛上的建筑。", first_chapter_id: c1, status: "draft" });

    const item1 = await insert("items", { name: "素描本", kind: "object", description: "十色的素描本。", first_chapter_id: c1, status: "draft" });
    const item2 = await insert("items", { name: "素描本", kind: "object", description: "素描本上画着燃烧的桥。", first_chapter_id: c2, status: "draft" });

    const clue1 = await insert("clues", { name: "预言信件", aliases: [], clue_type: "foreshadowing", description: "编辑部收到的匿名信件，预言了六月大阪火灾。", introduced_chapter_id: c1, status: "introduced" });
    const clue2 = await insert("clues", { name: "预言信件内容", aliases: ["预言信件"], clue_type: "letter", description: "信件预言了六月大阪火灾和八月娑可安湖事件。", introduced_chapter_id: c2, status: "introduced", is_red_herring: 1 });

    // 引用：asset 挂地点/物品，timeline 挂地点，beat 挂线索 JSON，摘要挂线索名
    await s.from("assets").insert({ book_id: bookId, kind: "background", location_id: loc2, item_id: item2, status: "approved", source: "generated" });
    await s.from("timeline_events").insert({ book_id: bookId, source_chapter_id: c1, time_label: "第一天", order_key: "0001-000", description: "到达", location_id: loc4, character_ids: [], confidence: 1 });
    const { data: adapted } = await s.from("adapted_chapters").insert({ book_id: bookId, source_chapter_id: c1, idx: 1, title: null, basis: "source", status: "draft" }).select("id").single();
    await s.from("beats").insert({ book_id: bookId, adapted_chapter_id: adapted.id, idx: 0, type: "narration", text: "t", source_span: "[0,1]", clue_ids: [clue2], status: "draft" });
    await s.from("chapter_summaries").insert({ book_id: bookId, source_chapter_id: c1, summary: "s", characters: [], clues: ["预言信件", "预言信件内容"] });

    return { bookId, ids: { loc1, loc2, loc3, loc4, locSolo, item1, item2, clue1, clue2 } };
  }

  it("dry-run 不写入", async () => {
    const { bookId } = await makeDupBook();
    const s = getSupabaseAdmin();
    const loc = await healDuplicateEntities(bookId, "locations", { dryRun: true });
    const clue = await healDuplicateEntities(bookId, "clues", { dryRun: true });

    expect(loc.clusters).toHaveLength(2);
    expect(loc.checkpointId).toBeNull();
    expect(clue.clusters).toHaveLength(1);
    expect(clue.checkpointId).toBeNull();

    const { data: locs } = await s.from("locations").select("id").eq("book_id", bookId);
    const { data: clues } = await s.from("clues").select("id").eq("book_id", bookId);
    expect(locs).toHaveLength(5);
    expect(clues).toHaveLength(2);
  });

  it("合并重复行：keeper 吸收 + FK/JSON 重定向 + 删除", async () => {
    const { bookId, ids } = await makeDupBook();
    const s = getSupabaseAdmin();

    const locResult = await healDuplicateEntities(bookId, "locations");
    expect(locResult.afterCount).toBe(3);
    expect(locResult.checkpointId).toBeTruthy();
    expect(listCheckpoints(bookId).some((cp) => cp.id === locResult.checkpointId)).toBe(true);

    const { data: locs } = await s.from("locations").select("id, name, aliases").eq("book_id", bookId);
    const locArr = locs as Array<{ id: string; name: string; aliases: string[] }>;
    const locByName = new Map(locArr.map((r) => [r.name, r]));
    expect(locByName.size).toBe(3);
    const keeperCafeteria = locByName.get("神红大学中央联合食堂")!;
    expect([ids.loc1, ids.loc2]).toContain(keeperCafeteria.id); // 引用数打平 → 全名胜
    expect(keeperCafeteria.aliases).toEqual(expect.arrayContaining(["中央联合食堂"]));
    const aptRows = locArr.filter((r) => [ids.loc3, ids.loc4].includes(r.id));
    expect(aptRows).toHaveLength(1); // 公寓两行合一
    const keeperApt = aptRows[0];
    expect([keeperApt.name, ...keeperApt.aliases]).toEqual(
      expect.arrayContaining(["比留子同学的公寓", "比留子同学公寓"]),
    );
    expect(locByName.has("魔眼之匣")).toBe(true);

    // FK 重定向：asset.location_id 与 timeline_events.location_id 都指向 keeper
    const { data: assets } = await s.from("assets").select("location_id, item_id").eq("book_id", bookId);
    expect((assets as Array<{ location_id: string; item_id: string }>)[0].location_id).toBe(keeperCafeteria.id);
    const { data: events } = await s.from("timeline_events").select("location_id").eq("book_id", bookId);
    expect((events as Array<{ location_id: string }>)[0].location_id).toBe(keeperApt.id);

    const itemResult = await healDuplicateEntities(bookId, "items");
    expect(itemResult.afterCount).toBe(1);
    const { data: items } = await s.from("items").select("id, description").eq("book_id", bookId);
    expect(items).toHaveLength(1);
    expect((items as Array<{ description: string }>)[0].description).toContain("燃烧的桥");

    const clueResult = await healDuplicateEntities(bookId, "clues");
    expect(clueResult.afterCount).toBe(1);
    const { data: clues } = await s.from("clues").select("id, name, aliases, is_red_herring").eq("book_id", bookId);
    const clue = (clues as Array<{ id: string; name: string; aliases: string[]; is_red_herring: number }>)[0];
    expect(clue.name).toBe("预言信件内容");
    expect(clue.aliases).toEqual(expect.arrayContaining(["预言信件"]));
    expect(clue.is_red_herring).toBe(1); // 并集

    // JSON 引用：beat.clue_ids → keeper；chapter_summaries.clues 名称归一
    const { data: beats } = await s.from("beats").select("clue_ids").eq("book_id", bookId);
    expect((beats as Array<{ clue_ids: string[] }>)[0].clue_ids).toEqual([clue.id]);
    const { data: summaries } = await s.from("chapter_summaries").select("clues").eq("book_id", bookId);
    expect((summaries as Array<{ clues: string[] }>)[0].clues).toEqual(["预言信件内容"]);
  });

  it("幂等：再次运行无新变化", async () => {
    const { bookId } = await makeDupBook();
    await healDuplicateEntities(bookId, "locations");
    await healDuplicateEntities(bookId, "items");
    await healDuplicateEntities(bookId, "clues");
    const again = await healDuplicateEntities(bookId, "clues");
    expect(again.clusters).toHaveLength(0);
    expect(again.checkpointId).toBeNull();
  });
});
