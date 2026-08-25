/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseAdmin } from "@/lib/db";
import { createCheckpoint, type SnapshotEntry } from "@/lib/checkpoints";

/**
 * 人物去重核心（调研结论见 docs/13-character-dedup.md）。
 *
 * 重复根因：
 * 1. 旧合并谓词只查「新名字 ∈ 已有 canonical/aliases」两个方向，漏掉
 *    「已有 canonical ∈ 新别名」「新旧别名交集」「去称谓后同名」；
 * 2. 逐章合并用的是循环前快照，同章内后出现的变体匹配不到刚插入的行；
 * 3. 单章分析提示词不携带已有人物档案，模型每章命名漂移（叶村让/叶村君/叶村）。
 *
 * 本模块提供：
 * - namesMatch：四向匹配 + 基名（去称谓）相等，别名交集排除通用称谓词；
 * - betterCanonical / mergeNameSets / pickBestRole：合并字段规则（全名优先、长描述优先）；
 * - healDuplicateCharacters：存量重复行一键合并（keeper 吸收 + FK 重定向 + 删除），
 *   破坏性写操作前自动建 checkpoint，可 dry-run 预览。
 */

export interface CharacterRow {
  id?: string;
  canonical_name: string;
  aliases: string[] | null;
  role?: string | null;
  description?: string | null;
}

export interface IncomingCharacter {
  name: string;
  aliases?: string[];
  role?: string;
  description?: string;
}

/** 称谓后缀：去称谓后得到基名（用于「叶村君 ↔ 叶村」这类等价判断） */
const HONORIFIC_SUFFIXES = [
  "先生", "女士", "小姐", "同学", "前辈", "学长", "学姐", "学弟", "学妹",
  "大人", "老师", "さん", "様", "氏", "殿", "君", "酱",
];

/** 通用称谓/指代词：仅用于「别名交集」规则的排除，避免「前辈」等误合并 */
const GENERIC_ALIAS_STOP = new Set([
  "前辈", "学长", "学姐", "学弟", "学妹", "同学", "先生", "女士", "小姐", "大人", "老师",
  "老", "小", "哥", "姐", "弟", "妹", "少年", "少女", "男人", "女人", "男子", "女子",
  "小孩", "孩子", "那人", "某人", "对方", "侦探", "记者", "教授", "警官", "警察", "医生",
  "村民", "学生", "店员", "老板", "客人", "邻居",
]);

/** 归一化：NFKC（全角→半角）+ 去空白 + 小写；null 安全 */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** 基名：去掉称谓后缀（可叠套，如 先见大人先生 → 先见） */
export function baseName(name: string): string {
  let n = normalizeName(name);
  for (;;) {
    let next = n;
    for (const suf of HONORIFIC_SUFFIXES) {
      if (next.length > suf.length && next.endsWith(suf)) {
        next = next.slice(0, -suf.length);
        break;
      }
    }
    if (next === n) return n;
    n = next;
  }
}

/**
 * 判断「已有档案行」与「本章新提取人物」（或另一档案行，heal 用）是否为同一人。
 * 四向匹配 + 基名相等；别名交集排除通用称谓词。
 */
export function namesMatch(row: CharacterRow, inc: IncomingCharacter | CharacterRow): boolean {
  const rowKey = normalizeName(row.canonical_name);
  const incName = (inc as IncomingCharacter).name ?? (inc as CharacterRow).canonical_name;
  const incKey = normalizeName(incName);
  if (rowKey === incKey) return true;

  const rowAliases = (row.aliases ?? []).map(normalizeName);
  const incAliases = (inc.aliases ?? []).map(normalizeName);
  if (rowAliases.includes(incKey)) return true; // 新名字已是旧别名
  if (incAliases.includes(rowKey)) return true; // 旧 canonical 出现在新别名里

  // 去称谓后基名相等（叶村君 ↔ 叶村），要求 ≥2 字避免单字误判
  const rb = baseName(row.canonical_name);
  const ib = baseName(incName);
  if (rb.length >= 2 && ib.length >= 2 && rb === ib) return true;

  // 共享别名（排除通用称谓词，如「前辈」）
  return rowAliases.some(
    (a) => a.length >= 2 && incAliases.includes(a) && !GENERIC_ALIAS_STOP.has(a),
  );
}

/** canonical 升级：incoming 的基名更长（更完整，如 叶村 → 叶村让）时采用；否则保留现状 */
export function betterCanonical(current: string, incoming: string): string | null {
  const curBase = baseName(current);
  const incBase = baseName(incoming);
  if (incBase.length > curBase.length && incBase.length >= 2) return incoming;
  return null;
}

/** 按归一化去重合并多组名字（保留原文写法） */
export function mergeNameSets(...lists: Array<string[] | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const name of list ?? []) {
      const key = normalizeName(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

const ROLE_WEIGHT: Record<string, number> = {
  protagonist: 5,
  main: 4,
  supporting: 3,
  other: 1,
};

/** 角色规范化：兼容旧值（lead/support），其余原样保留 */
export function normalizeRole(role: string | null | undefined): string {
  const r = (role ?? "").trim();
  if (!r) return "other";
  if (r === "lead") return "protagonist";
  if (r === "support") return "supporting";
  return r;
}

/** 角色取更显著者（protagonist > main > supporting > other；未知角色权重 2） */
export function pickBestRole(roles: Array<string | null | undefined>): string {
  let best = "other";
  let bestW = 0;
  for (const role of roles) {
    const r = normalizeRole(role);
    const w = ROLE_WEIGHT[r] ?? 2;
    if (w > bestW) {
      best = r;
      bestW = w;
    }
  }
  return best;
}

function pickLonger(a: string | null | undefined, b: string | null | undefined): string | null {
  const sa = (a ?? "").trim();
  const sb = (b ?? "").trim();
  if (!sa) return sb || null;
  if (!sb) return sa || null;
  return sb.length > sa.length ? sb : sa;
}

// ---------------------------------------------------------------------------
// 存量去重（heal）
// ---------------------------------------------------------------------------

interface CharFull extends CharacterRow {
  id: string;
  bio: Record<string, unknown> | null;
  first_chapter_id: string | null;
  last_chapter_id: string | null;
  ref_asset_id: string | null;
  voice_profile_id: string | null;
  created_at: string | null;
}

export interface HealClusterReport {
  keeperId: string;
  keeperName: string;
  mergedIds: string[];
  mergedNames: string[];
  newAliases: string[];
  role: string;
  description: string | null;
  refsMoved: Record<string, number>;
}

export interface HealResult {
  bookId: string;
  checkpointId: string | null;
  beforeCount: number;
  afterCount: number;
  dryRun: boolean;
  clusters: HealClusterReport[];
  suspicious: Array<{ id: string; name: string; reason: string }>;
}

/** 疑似一个条目含多人的命名模式（如 狮狮田父子）——只报告不合并 */
const MULTI_PERSON_PATTERN = /(父子|父女|母子|母女|夫妇|夫妻|兄弟|姐妹|二人|两人|三人|一家)/;

function clusterRows(rows: CharFull[]): CharFull[][] {
  const n = rows.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (namesMatch(rows[i], rows[j])) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map<number, CharFull[]>();
  rows.forEach((r, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(r);
    groups.set(root, list);
  });
  return [...groups.values()];
}

/** keeper 选择：下游引用数 > canonical 基名长度（全名优先）> 描述长度 > 创建时间 */
function pickKeeper(
  cluster: CharFull[],
  refsByChar: Map<string, number>,
): CharFull {
  let best = cluster[0];
  let bestScore = -1;
  for (const row of cluster) {
    const refs = refsByChar.get(row.id) ?? 0;
    const score =
      refs * 10000 +
      baseName(row.canonical_name).length * 100 +
      normalizeName(row.canonical_name).length * 10 +
      (row.description ?? "").length;
    if (
      score > bestScore ||
      (score === bestScore && (row.created_at ?? "") < (best.created_at ?? ""))
    ) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}

const SUSPICIOUS_REASON = "条目疑似同时指代多人（父子/母女/夫妇等），建议人工拆分";

/**
 * 合并一本书内的重复人物（含 FK 重定向与 JSON 数组引用修复）。
 * 破坏性写操作前自动建 checkpoint；dryRun 时只计算不写入。
 * 幂等：重复运行无副作用。
 */
export async function healDuplicateCharacters(
  bookId: string,
  opts: { dryRun?: boolean } = {},
): Promise<HealResult> {
  const s = getSupabaseAdmin();
  const dryRun = opts.dryRun === true;

  const { data: rows } = await s
    .from("characters")
    .select(
      "id, canonical_name, aliases, role, description, bio, first_chapter_id, last_chapter_id, ref_asset_id, voice_profile_id, created_at",
    )
    .eq("book_id", bookId);
  const chars = (rows ?? []) as unknown as CharFull[];

  // 下游引用计数（beats/assets/voice_profiles/items/shot_layers/relations）
  const refsByChar = new Map<string, number>();
  const countRefs = (table: string, col: string) =>
    (s.from(table).select("id, " + col).eq("book_id", bookId) as any)
      .then(({ data }: any) => {
        for (const r of (data ?? []) as Array<{ [k: string]: string | null }>) {
          const id = r[col];
          if (id) refsByChar.set(id, (refsByChar.get(id) ?? 0) + 1);
        }
      });
  await Promise.all([
    countRefs("beats", "character_id"),
    countRefs("assets", "character_id"),
    countRefs("voice_profiles", "character_id"),
    countRefs("items", "owner_character_id"),
    countRefs("shot_layers", "character_id"),
  ]);

  // 章节 idx 映射（first/last chapter 归并）
  const { data: chapterRows } = await s.from("source_chapters").select("id, idx").eq("book_id", bookId);
  const chapterIdx = new Map<string, number>();
  for (const c of (chapterRows ?? []) as Array<{ id: string; idx: number }>) chapterIdx.set(c.id, c.idx);

  const clusters = clusterRows(chars).filter((c) => c.length > 1);
  const suspicious = chars
    .filter((r) => MULTI_PERSON_PATTERN.test(r.canonical_name))
    .map((r) => ({ id: r.id, name: r.canonical_name, reason: SUSPICIOUS_REASON }));

  if (clusters.length === 0) {
    return {
      bookId, checkpointId: null, beforeCount: chars.length, afterCount: chars.length,
      dryRun, clusters: [], suspicious,
    };
  }

  // ---------- 合并计划 ----------
  interface Plan {
    keeper: CharFull;
    dups: CharFull[];
    canonical: string;
    aliases: string[];
    role: string;
    description: string | null;
    bio: Record<string, unknown> | null;
    refAsset: string | null;
    voiceProfile: string | null;
    firstChapter: string | null;
    lastChapter: string | null;
    refsMoved: Record<string, number>;
  }
  const plans: Plan[] = clusters.map((cluster) => {
    const keeper = pickKeeper(cluster, refsByChar);
    const dups = cluster.filter((r) => r.id !== keeper.id);
    const canonical = mergeNameSets(
      [keeper.canonical_name],
      ...dups.map((r) => [r.canonical_name]),
    ).reduce(
      (best, name) => betterCanonical(best, name) ?? best,
      keeper.canonical_name,
    );
    const aliases = mergeNameSets(
      keeper.aliases,
      ...dups.map((r) => r.aliases),
      dups.map((r) => r.canonical_name),
      // keeper 自身 canonical 被升级为全名时，旧名也要并入别名（如 比留子 → 剑崎比留子）
      normalizeName(keeper.canonical_name) !== normalizeName(canonical) ? [keeper.canonical_name] : [],
    ).filter((a) => normalizeName(a) !== normalizeName(canonical));
    const role = pickBestRole(cluster.map((r) => r.role));
    const description = cluster.reduce<string | null>(
      (best, r) => pickLonger(best, r.description),
      null,
    );
    const bio = cluster.reduce<Record<string, unknown> | null>(
      (best, r) => {
        if (best && Object.keys(best).length > 0) return best;
        if (r.bio && Object.keys(r.bio).length > 0) return r.bio;
        return best;
      },
      null,
    );
    const refAsset = keeper.ref_asset_id ?? dups.find((r) => r.ref_asset_id)?.ref_asset_id ?? null;
    const voiceProfile = keeper.voice_profile_id ?? dups.find((r) => r.voice_profile_id)?.voice_profile_id ?? null;
    const chIdx = (id: string | null) => (id && chapterIdx.has(id) ? chapterIdx.get(id)! : null);
    const firstCandidates = cluster
      .map((r) => ({ id: r.first_chapter_id, idx: chIdx(r.first_chapter_id) }))
      .filter((c): c is { id: string; idx: number } => c.idx !== null)
      .sort((a, b) => a.idx - b.idx);
    const lastCandidates = cluster
      .map((r) => ({ id: r.last_chapter_id, idx: chIdx(r.last_chapter_id) }))
      .filter((c): c is { id: string; idx: number } => c.idx !== null)
      .sort((a, b) => b.idx - a.idx);
    const firstChapter = firstCandidates[0]?.id ?? keeper.first_chapter_id;
    const lastChapter = lastCandidates[0]?.id ?? keeper.last_chapter_id;

    const refsMoved: Record<string, number> = {};
    for (const r of dups) {
      const refs = refsByChar.get(r.id) ?? 0;
      if (refs > 0) refsMoved[r.canonical_name] = refs;
    }

    return {
      keeper, dups, canonical, aliases, role, description, bio,
      refAsset, voiceProfile, firstChapter, lastChapter, refsMoved,
    };
  });

  // 待删除的重复行 = 各簇 keeper 之外的所有行（必须以 plans 为准，不能用簇内顺序）
  const dupIds = new Set(plans.flatMap((p) => p.dups.map((r) => r.id)));

  const report: HealResult = {
    bookId,
    checkpointId: null,
    beforeCount: chars.length,
    afterCount: chars.length - dupIds.size,
    dryRun,
    clusters: plans.map((p) => ({
      keeperId: p.keeper.id,
      keeperName: p.canonical,
      mergedIds: p.dups.map((r) => r.id),
      mergedNames: p.dups.map((r) => r.canonical_name),
      newAliases: p.aliases,
      role: p.role,
      description: p.description,
      refsMoved: p.refsMoved,
    })),
    suspicious,
  };
  if (dryRun) return report;

  // ---------- checkpoint（破坏性写操作前置） ----------
  const dupIdList = plans.flatMap((p) => p.dups.map((r) => r.id));
  const entries: SnapshotEntry[] = [];
  for (const p of plans) {
    entries.push({ table: "characters", rowId: p.keeper.id, before: { ...p.keeper } as any, op: "update" });
    for (const r of p.dups) {
      entries.push({ table: "characters", rowId: r.id, before: { ...r } as any, op: "delete" });
    }
  }

  const refsByTable: Array<{ table: string; col: string }> = [
    { table: "beats", col: "character_id" },
    { table: "assets", col: "character_id" },
    { table: "voice_profiles", col: "character_id" },
    { table: "items", col: "owner_character_id" },
    { table: "shot_layers", col: "character_id" },
  ];
  for (const { table, col } of refsByTable) {
    const { data: refs } = await s.from(table).select("id").in(col, dupIdList);
    for (const r of (refs ?? []) as Array<{ id: string }>) {
      const before = await s.from(table).select("*").eq("id", r.id).single();
      if (before.data) entries.push({ table, rowId: r.id, before: before.data as any, op: "update" });
    }
  }
  // character_relations：source/target 都可能指向重复行
  for (const col of ["source_character_id", "target_character_id"] as const) {
    const { data: refs } = await s.from("character_relations").select("id").in(col, dupIdList);
    for (const r of (refs ?? []) as Array<{ id: string }>) {
      const before = await s.from("character_relations").select("*").eq("id", r.id).single();
      if (before.data) entries.push({ table: "character_relations", rowId: r.id, before: before.data as any, op: "update" });
    }
  }
  // JSON 数组引用（timeline_events.character_ids / clues.related_character_ids / chapter_summaries.characters）
  const jsonTables: Array<{ table: string; col: string }> = [
    { table: "timeline_events", col: "character_ids" },
    { table: "clues", col: "related_character_ids" },
    { table: "chapter_summaries", col: "characters" },
  ];
  for (const { table, col } of jsonTables) {
    const { data: rowsWithRef } = await s.from(table).select("id, " + col).eq("book_id", bookId);
    for (const r of (rowsWithRef ?? []) as Array<{ id: string; [k: string]: unknown }>) {
      entries.push({ table, rowId: r.id, before: r as any, op: "update" });
    }
  }

  report.checkpointId = createCheckpoint(
    bookId,
    `合并重复人物（${plans.length} 组，删除 ${dupIdList.length} 行）`,
    "manual-edit",
    "characters:heal",
    entries,
  );

  // ---------- 应用 ----------
  // 重复行 id → keeper id 映射
  const keeperById = new Map<string, string>();
  for (const p of plans) for (const r of p.dups) keeperById.set(r.id, p.keeper.id);

  // 全局 名字 → keeper canonical 映射（含别名），用于 chapter_summaries 名称归一
  const nameToKeeper = new Map<string, string>();
  for (const p of plans) {
    for (const r of [p.keeper, ...p.dups]) {
      nameToKeeper.set(normalizeName(r.canonical_name), p.canonical);
      for (const a of r.aliases ?? []) nameToKeeper.set(normalizeName(a), p.canonical);
    }
  }

  /** 写操作不静默吞错：任何失败立即抛出（避免“看似成功实则没改”的假象） */
  const exec = async (label: string, query: Promise<{ error: { message: string } | null }>) => {
    const res = await query;
    if (res.error) throw new Error(`人物合并失败（${label}）: ${res.error.message}`);
    return res;
  };

  for (const p of plans) {
    await exec(`更新 keeper ${p.canonical}`, s.from("characters").update({
      canonical_name: p.canonical,
      aliases: p.aliases,
      role: p.role,
      description: p.description ?? null,
      bio: p.bio ?? {},
      ref_asset_id: p.refAsset,
      voice_profile_id: p.voiceProfile,
      first_chapter_id: p.firstChapter,
      last_chapter_id: p.lastChapter,
    }).eq("id", p.keeper.id) as any);
  }

  for (const { table, col } of refsByTable) {
    const { data: refs } = await s.from(table).select("id, " + col).eq("book_id", bookId);
    for (const r of (refs ?? []) as Array<{ id: string; [k: string]: unknown }>) {
      const charId = r[col] as string | null;
      const keeperId = charId ? keeperById.get(charId) : undefined;
      if (keeperId) {
        await exec(`重定向 ${table}.${col}`, s.from(table).update({ [col]: keeperId } as any).eq("id", r.id) as any);
      }
    }
  }

  // character_relations：source/target 重定向；重复关系（UNIQUE 冲突）保留先者
  const { data: relations } = await s
    .from("character_relations")
    .select("id, source_character_id, target_character_id, relation_type, description")
    .eq("book_id", bookId);
  const seenRel = new Set<string>();
  for (const rel of (relations ?? []) as Array<{
    id: string; source_character_id: string | null; target_character_id: string | null;
    relation_type: string | null; description: string | null;
  }>) {
    const src = keeperById.get(rel.source_character_id ?? "") ?? rel.source_character_id;
    const tgt = keeperById.get(rel.target_character_id ?? "") ?? rel.target_character_id;
    if (src === rel.source_character_id && tgt === rel.target_character_id) continue;
    const key = `${src}|${tgt}|${rel.relation_type ?? ""}`;
    if (seenRel.has(key)) {
      await exec("删除重复关系", s.from("character_relations").delete().eq("id", rel.id) as any);
    } else {
      seenRel.add(key);
      await exec("重定向关系", s.from("character_relations").update({
        source_character_id: src,
        target_character_id: tgt,
      }).eq("id", rel.id) as any);
    }
  }

  // JSON 数组引用修复
  const replaceInArray = (arr: unknown, map: (id: string) => string | null): string[] => {
    const out: string[] = [];
    for (const item of (Array.isArray(arr) ? arr : []) as string[]) {
      const mapped = map(item);
      if (mapped && !out.includes(mapped)) out.push(mapped);
    }
    return out;
  };
  {
    const { data: events } = await s.from("timeline_events").select("id, character_ids").eq("book_id", bookId);
    for (const ev of (events ?? []) as Array<{ id: string; character_ids: string[] }>) {
      const fixed = replaceInArray(ev.character_ids, (id) => keeperById.get(id) ?? id);
      if (JSON.stringify(fixed) !== JSON.stringify(ev.character_ids)) {
        await exec("修复 timeline_events", s.from("timeline_events").update({ character_ids: fixed }).eq("id", ev.id) as any);
      }
    }
  }
  {
    const { data: clues } = await s.from("clues").select("id, related_character_ids").eq("book_id", bookId);
    for (const cl of (clues ?? []) as Array<{ id: string; related_character_ids: string[] }>) {
      const fixed = replaceInArray(cl.related_character_ids, (id) => keeperById.get(id) ?? id);
      if (JSON.stringify(fixed) !== JSON.stringify(cl.related_character_ids)) {
        await exec("修复 clues", s.from("clues").update({ related_character_ids: fixed }).eq("id", cl.id) as any);
      }
    }
  }
  {
    const { data: summaries } = await s.from("chapter_summaries").select("id, characters").eq("book_id", bookId);
    for (const sm of (summaries ?? []) as Array<{ id: string; characters: string[] }>) {
      const fixed = replaceInArray(sm.characters, (name) => nameToKeeper.get(normalizeName(name)) ?? null);
      if (JSON.stringify(fixed) !== JSON.stringify(sm.characters)) {
        await exec("修复 chapter_summaries", s.from("chapter_summaries").update({ characters: fixed }).eq("id", sm.id) as any);
      }
    }
  }

  // 删除重复行
  await exec("删除重复人物", s.from("characters").delete().in("id", dupIdList) as any);

  return report;
}
