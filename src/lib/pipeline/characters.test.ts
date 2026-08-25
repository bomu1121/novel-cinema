import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdmin } from "@/lib/db";
import { listCheckpoints } from "@/lib/checkpoints";
import {
  baseName,
  betterCanonical,
  healDuplicateCharacters,
  mergeNameSets,
  namesMatch,
  normalizeName,
  normalizeRole,
  pickBestRole,
} from "@/lib/pipeline/characters";
import { persistChapterAnalysis } from "@/lib/pipeline/nodes/analyze";
import type { ChunkAnalysis } from "@/lib/pipeline/schemas/analysis";

// 人物去重回归：匹配谓词 / 逐章合并 / 存量 heal（真实 SQLite，book 级清理）
const createdBookIds: string[] = [];

afterEach(async () => {
  const s = getSupabaseAdmin();
  for (const id of createdBookIds.splice(0)) {
    await s.from("books").delete().eq("id", id); // 级联清理全部下游
  }
});

async function makeBook(title = `char-test-${randomUUID()}`) {
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

function analysisWith(characters: ChunkAnalysis["characters"]): ChunkAnalysis {
  return {
    characters,
    events: [],
    locations: [],
    items: [],
    clues: [],
    summary: "测试摘要",
    tone: "悬疑",
  };
}

// ---------------------------------------------------------------------------
// 纯函数：匹配谓词
// ---------------------------------------------------------------------------
describe("人物匹配（namesMatch）", () => {
  const row = (canonical: string, aliases: string[] = []) => ({ canonical_name: canonical, aliases });

  it("canonical 精确相等", () => {
    expect(namesMatch(row("叶村让"), { name: "叶村让" })).toBe(true);
  });

  it("新名字 ∈ 旧别名", () => {
    expect(namesMatch(row("叶村让", ["叶村君"]), { name: "叶村君" })).toBe(true);
  });

  it("旧 canonical ∈ 新别名（十色真理绘 vs 十色[十色真理绘,…]）", () => {
    expect(namesMatch(row("十色真理绘"), { name: "十色", aliases: ["十色真理绘", "十色小妹"] })).toBe(true);
  });

  it("新旧别名交集（叶村让[叶村君] vs 叶村[叶村君]）", () => {
    expect(namesMatch(row("叶村让", ["叶村君"]), { name: "叶村", aliases: ["叶村君"] })).toBe(true);
  });

  it("基名相等（叶村君 ↔ 叶村）", () => {
    expect(namesMatch(row("叶村君"), { name: "叶村" })).toBe(true);
    expect(namesMatch(row("叶村"), { name: "叶村君" })).toBe(true);
  });

  it("共享通用称谓词不误合并（前辈）", () => {
    expect(namesMatch(row("十色真理绘", ["前辈"]), { name: "茎泽", aliases: ["前辈"] })).toBe(false);
  });

  it("单字基名不参与基名相等", () => {
    expect(namesMatch(row("纯"), { name: "纯君" })).toBe(false);
  });

  it("同姓不同人不误合并（狮狮田严雄 vs 狮狮田纯）", () => {
    expect(namesMatch(row("狮狮田严雄"), { name: "狮狮田纯" })).toBe(false);
    expect(namesMatch(row("狮狮田严雄"), { name: "狮狮田" })).toBe(false);
  });
});

describe("名字/角色工具", () => {
  it("normalizeName：全角/空白/大小写", () => {
    expect(normalizeName("ＡＢＣ  ")).toBe("abc");
    expect(normalizeName("叶村 让")).toBe("叶村让");
  });

  it("baseName：去称谓后缀", () => {
    expect(baseName("比留子同学")).toBe("比留子");
    expect(baseName("先见大人")).toBe("先见");
    expect(baseName("叶村君")).toBe("叶村");
    expect(baseName("剑崎比留子小姐")).toBe("剑崎比留子");
    expect(baseName("茎泽忍")).toBe("茎泽忍"); // 不是称谓
  });

  it("betterCanonical：全名升级、短名/同长不降级", () => {
    expect(betterCanonical("叶村", "叶村让")).toBe("叶村让");
    expect(betterCanonical("叶村让", "叶村")).toBeNull();
    expect(betterCanonical("先见", "先见大人")).toBeNull(); // 去称谓后同长
    expect(betterCanonical("剑崎比留子", "剑崎比留子小姐")).toBeNull();
  });

  it("mergeNameSets：按归一化去重", () => {
    expect(mergeNameSets(["叶村君"], ["叶村君", "叶村"], ["叶村" , "第二代"])).toEqual(["叶村君", "叶村", "第二代"]);
  });

  it("normalizeRole / pickBestRole", () => {
    expect(normalizeRole("lead")).toBe("protagonist");
    expect(normalizeRole("support")).toBe("supporting");
    expect(normalizeRole("")).toBe("other");
    expect(pickBestRole(["other", "supporting", "main"])).toBe("main");
    expect(pickBestRole(["main", "protagonist"])).toBe("protagonist");
  });
});

// ---------------------------------------------------------------------------
// 逐章合并（persistChapterAnalysis）
// ---------------------------------------------------------------------------
describe("persistChapterAnalysis 人物合并", () => {
  it("后续章节的简称/别名变体合并进已有 canonical，不新建行", async () => {
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const c2 = await makeChapter(bookId, 2);
    const s = getSupabaseAdmin();

    await persistChapterAnalysis(bookId, { id: c1, idx: 1, title: null, cleanedText: "a" }, analysisWith([
      { name: "叶村让", aliases: ["叶村君", "第二代"], description: "神红大学一年级学生，推理爱好会会长，东北出身，自称推理狂。", role: "protagonist", appearance: "", first_seen_in_chunk: true },
    ]));
    // 第二章：模型只给了简称 叶村（别名 叶村君）——应合并，而不是新开一行
    await persistChapterAnalysis(bookId, { id: c2, idx: 2, title: null, cleanedText: "b" }, analysisWith([
      { name: "叶村", aliases: ["叶村君"], description: "叙述者，大学生，推理爱好会成员，与比留子同学同行。", role: "protagonist", appearance: "", first_seen_in_chunk: false },
    ]));

    const { data: rows } = await s.from("characters").select("canonical_name, aliases, role, description").eq("book_id", bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].canonical_name).toBe("叶村让"); // canonical 保留全名
    expect(rows[0].aliases).toEqual(["叶村君", "第二代", "叶村"]);
    expect(rows[0].description).toContain("推理狂"); // 更长描述保留
  });

  it("同一章内的变体（旧 bug：快照数组匹配不到刚插入的行）也能合并", async () => {
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const s = getSupabaseAdmin();

    await persistChapterAnalysis(bookId, { id: c1, idx: 1, title: null, cleanedText: "a" }, analysisWith([
      { name: "叶村让", aliases: ["叶村"], description: "会长", role: "lead", appearance: "", first_seen_in_chunk: true },
      { name: "叶村君", aliases: ["叶村"], description: "叙述者", role: "protagonist", appearance: "", first_seen_in_chunk: false },
    ]));

    const { data: rows } = await s.from("characters").select("canonical_name, aliases, role").eq("book_id", bookId);
    expect(rows).toHaveLength(1);
    expect(rows[0].aliases).toContain("叶村");
    expect(rows[0].role).toBe("protagonist"); // lead 归一化 + 更高权重
  });

  it("不同人物不误合并", async () => {
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const s = getSupabaseAdmin();

    await persistChapterAnalysis(bookId, { id: c1, idx: 1, title: null, cleanedText: "a" }, analysisWith([
      { name: "狮狮田严雄", aliases: [], description: "教授", role: "supporting", appearance: "", first_seen_in_chunk: true },
      { name: "狮狮田纯", aliases: ["纯"], description: "小学生", role: "supporting", appearance: "", first_seen_in_chunk: true },
      { name: "明智恭介", aliases: ["明智学长"], description: "前辈", role: "supporting", appearance: "", first_seen_in_chunk: true },
    ]));

    const { data: rows } = await s.from("characters").select("canonical_name").eq("book_id", bookId).order("canonical_name");
    expect(rows.map((r: { canonical_name: string }) => r.canonical_name).sort()).toEqual(["明智恭介", "狮狮田严雄", "狮狮田纯"]);
  });
});

// ---------------------------------------------------------------------------
// 存量去重（heal）
// ---------------------------------------------------------------------------
describe("healDuplicateCharacters", () => {
  async function makeDupBook() {
    const s = getSupabaseAdmin();
    const bookId = await makeBook();
    const c1 = await makeChapter(bookId, 1);
    const c2 = await makeChapter(bookId, 2);

    const insertChar = async (canonical: string, aliases: string[], role: string, desc: string, chapterId: string) => {
      const { data } = await s
        .from("characters")
        .insert({
          book_id: bookId,
          canonical_name: canonical,
          aliases,
          role,
          description: desc,
          bio: { appearance: "" },
          first_chapter_id: chapterId,
          status: "draft",
        })
        .select("id")
        .single();
      return data.id;
    };

    const a1 = await insertChar("叶村让", ["叶村君", "第二代"], "protagonist", "神红大学一年级学生，推理爱好会会长，东北出身，自称推理狂。", c1);
    const a2 = await insertChar("叶村", ["叶村君"], "protagonist", "叙述者，大学生，推理爱好会成员，与比留子同学同行。", c2);
    const b1 = await insertChar("剑崎比留子", ["比留子同学", "剑崎比留子小姐"], "main", "神红大学文学系二年级学生，推理爱好会唯一会员。", c1);
    const b2 = await insertChar("比留子", ["比留子同学", "剑崎姐"], "protagonist", "叶村的同伴，大学生，推理爱好会成员，观察力敏锐。", c2);
    const t1 = await insertChar("十色真理绘", [], "other", "高中二年级，描绘预知未来画作的预言者。", c1);
    const t2 = await insertChar("十色", ["十色真理绘", "十色小妹", "前辈"], "supporting", "高中生，美术部成员，与茎泽同行，会画预言画。", c2);
    const suspicious = await insertChar("狮狮田父子", [], "other", "没有换洗衣服不去洗澡。", c1);

    // 下游引用：a1(叶村让) 3 处 beats、a2(叶村) 1 beat + 1 asset + 1 vp → 引用数打平，
    // keeper 由「全名优先」决出（a1），a2 的引用需真实迁移到 a1
    const { data: adapted } = await s
      .from("adapted_chapters")
      .insert({ book_id: bookId, source_chapter_id: c1, idx: 1, title: null, basis: "source", status: "draft" })
      .select("id")
      .single();
    await s.from("beats").insert([
      { book_id: bookId, adapted_chapter_id: adapted.id, idx: 0, type: "dialogue", character_id: a2, text: "你好", source_span: "[0,2]", status: "draft" },
      { book_id: bookId, adapted_chapter_id: adapted.id, idx: 1, type: "dialogue", character_id: a1, text: "你好", source_span: "[2,4]", status: "draft" },
      { book_id: bookId, adapted_chapter_id: adapted.id, idx: 2, type: "dialogue", character_id: a1, text: "你好", source_span: "[4,6]", status: "draft" },
      { book_id: bookId, adapted_chapter_id: adapted.id, idx: 3, type: "dialogue", character_id: a1, text: "你好", source_span: "[6,8]", status: "draft" },
    ]);
    await s.from("assets").insert([
      { book_id: bookId, kind: "character_ref", character_id: a2, status: "approved", source: "generated" },
      { book_id: bookId, kind: "character_ref", character_id: b2, status: "approved", source: "generated" },
    ]);
    await s.from("voice_profiles").insert({
      book_id: bookId, name: "叶村", role: "character", character_id: a2,
      provider: "t", provider_voice_id: "v1", status: "draft",
    });
    await s.from("items").insert({ book_id: bookId, name: "画", kind: "object", owner_character_id: b2 });
    await s.from("character_relations").insert({
      book_id: bookId, source_character_id: a2, target_character_id: b2,
      relation_type: "同伴", description: "结伴调查", status: "draft",
    });
    await s.from("timeline_events").insert({
      book_id: bookId, source_chapter_id: c2, time_label: "第一天", order_key: "0001-000",
      description: "到达好见", character_ids: [a2, b2, "nobody"], confidence: 1,
    });
    await s.from("clues").insert({
      book_id: bookId, name: "预言", clue_type: "other", description: "两天死四人",
      related_character_ids: [a2], status: "introduced",
    });
    await s.from("chapter_summaries").insert({
      book_id: bookId, source_chapter_id: c1, summary: "测试", characters: ["叶村", "比留子同学", "十色"], clues: [],
    });

    return { bookId, ids: { a1, a2, b1, b2, t1, t2, suspicious } };
  }

  it("dry-run 不写入", async () => {
    const { bookId } = await makeDupBook();
    const s = getSupabaseAdmin();
    const result = await healDuplicateCharacters(bookId, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.checkpointId).toBeNull();
    expect(result.beforeCount).toBe(7);
    expect(result.afterCount).toBe(4);
    expect(result.clusters).toHaveLength(3);
    expect(result.suspicious.map((x) => x.name)).toContain("狮狮田父子");

    const { data: rows } = await s.from("characters").select("id").eq("book_id", bookId);
    expect(rows).toHaveLength(7); // 未动
  });

  it("合并重复行：keeper 吸收 + FK/JSON 重定向 + 删除", async () => {
    const { bookId, ids } = await makeDupBook();
    const s = getSupabaseAdmin();
    const result = await healDuplicateCharacters(bookId);

    expect(result.afterCount).toBe(4);
    expect(result.checkpointId).toBeTruthy();
    expect(listCheckpoints(bookId).some((cp) => cp.id === result.checkpointId)).toBe(true);

    // keeper 保留全名，别名并集；引用数打平时全名优先（a1 胜出）
    const { data: rows } = await s.from("characters").select("id, canonical_name, aliases, role").eq("book_id", bookId);
    const byName = new Map((rows as Array<{ id: string; canonical_name: string; aliases: string[]; role: string }>).map((r) => [r.canonical_name, r]));
    expect(byName.size).toBe(4);
    const survivorA = byName.get("叶村让")!;
    const survivorB = byName.get("剑崎比留子")!;
    const survivorT = byName.get("十色真理绘")!;
    expect(survivorA.id).toBe(ids.a1); // 全名 + 引用数打平 → 叶村让 胜出
    expect(survivorB.id).toBe(ids.b2); // 比留子 有引用 → 保留其行，canonical 升级为全名
    expect(survivorT.id).toBe(ids.t1); // 无引用 → 全名优先
    expect(survivorA.aliases).toEqual(expect.arrayContaining(["叶村君", "第二代", "叶村"]));
    expect(survivorB.aliases).toEqual(expect.arrayContaining(["比留子同学", "剑崎比留子小姐", "比留子", "剑崎姐"]));
    expect(survivorB.role).toBe("protagonist"); // main + protagonist → protagonist
    expect(survivorT.aliases).toEqual(expect.arrayContaining(["十色", "十色小妹", "前辈"]));
    expect(byName.has("狮狮田父子")).toBe(true); // 可疑条目保留

    // 重复行已删除（每组只留一行）
    const remainingIds = (rows as Array<{ id: string }>).map((r) => r.id);
    expect(remainingIds).not.toContain(ids.a2);
    expect(remainingIds).not.toContain(ids.b1);
    expect(remainingIds).not.toContain(ids.t2);

    // FK 重定向：a2 的引用真实迁移到 a1
    const { data: beats } = await s.from("beats").select("character_id").eq("book_id", bookId);
    expect((beats as Array<{ character_id: string }>).every((b) => b.character_id === ids.a1)).toBe(true);
    const { data: assets } = await s.from("assets").select("character_id").eq("book_id", bookId);
    expect((assets as Array<{ character_id: string }>).map((a) => a.character_id).sort()).toEqual([ids.a1, ids.b2].sort());
    const { data: vps } = await s.from("voice_profiles").select("character_id").eq("book_id", bookId);
    expect((vps as Array<{ character_id: string }>)[0].character_id).toBe(ids.a1);
    const { data: items } = await s.from("items").select("owner_character_id").eq("book_id", bookId);
    expect((items as Array<{ owner_character_id: string }>)[0].owner_character_id).toBe(ids.b2);
    const { data: rels } = await s.from("character_relations").select("source_character_id, target_character_id").eq("book_id", bookId);
    expect(rels).toHaveLength(1);
    expect((rels as Array<{ source_character_id: string; target_character_id: string }>)[0]).toEqual({ source_character_id: ids.a1, target_character_id: ids.b2 });

    // JSON 数组引用
    const { data: events } = await s.from("timeline_events").select("character_ids").eq("book_id", bookId);
    expect((events as Array<{ character_ids: string[] }>)[0].character_ids).toEqual([ids.a1, ids.b2, "nobody"]);
    const { data: clues } = await s.from("clues").select("related_character_ids").eq("book_id", bookId);
    expect((clues as Array<{ related_character_ids: string[] }>)[0].related_character_ids).toEqual([ids.a1]);
    const { data: summaries } = await s.from("chapter_summaries").select("characters").eq("book_id", bookId);
    expect((summaries as Array<{ characters: string[] }>)[0].characters).toEqual(["叶村让", "剑崎比留子", "十色真理绘"]);
  });

  it("幂等：再次运行无新变化", async () => {
    const { bookId } = await makeDupBook();
    await healDuplicateCharacters(bookId);
    const second = await healDuplicateCharacters(bookId);
    expect(second.clusters).toHaveLength(0);
    expect(second.checkpointId).toBeNull();
  });
});
