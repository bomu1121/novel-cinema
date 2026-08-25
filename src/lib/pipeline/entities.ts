/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabaseAdmin } from "@/lib/db";
import { createCheckpoint, type SnapshotEntry } from "@/lib/checkpoints";
import { mergeNameSets, normalizeName } from "@/lib/pipeline/characters";

/**
 * 地点 / 物品 / 线索去重（与人物去重同构，见 docs/13-character-dedup.md）。
 *
 * 旧实现只按 name 精确相等合并：
 * - locations/items 有 aliases 列却从不参与匹配 → 「神红大学中央联合食堂」与
 *   「中央联合食堂」（互为别名）各占一行；
 * - clues 连 aliases 列都没有 → 「预言信件」与「预言信件内容」两条。
 *
 * 本模块：
 * - entityNamesMatch：canonical 相等（含去「的/の」变体）/ 新名 ∈ 旧别名 /
 *   旧 canonical ∈ 新别名 / 别名交集（排除通用词）；
 * - healDuplicateEntities：存量重复行一键合并（keeper 吸收 + FK/JSON 引用
 *   重定向 + 删除），checkpoint 保护、dry-run 预览、幂等。
 */

export type EntityKind = "locations" | "items" | "clues";

export interface EntityRow {
  id?: string;
  name: string;
  aliases: string[] | null;
  description?: string | null;
}

export interface IncomingEntity {
  name: string;
  aliases?: string[];
  description?: string;
}

/** 通用称谓/指代词：仅排除「别名交集」规则，避免「食堂」「公寓」等误合并 */
const ENTITY_ALIAS_STOP = new Set([
  "食堂", "公寓", "房间", "走廊", "门口", "学校", "车站", "咖啡店", "餐厅",
  "厕所", "浴室", "大厅", "教室", "办公室", "商店", "店铺", "家", "村", "镇",
  "信", "日记", "画", "书", "报纸", "杂志", "证件", "钥匙", "手机", "照片",
]);

/** 对比键：NFKC + 去空白 + 小写 + 去「的/の」（比留子同学的公寓 ↔ 比留子同学公寓） */
export function entityCompareKey(name: string | null | undefined): string {
  return normalizeName(name).replace(/[的の]/g, "");
}

/** 判断「已有档案行」与「本章新提取条目」是否为同一地点/物品/线索 */
export function entityNamesMatch(
  row: EntityRow,
  inc: IncomingEntity | EntityRow,
  opts?: { containment?: boolean },
): boolean {
  const incName = (inc as IncomingEntity).name ?? (inc as EntityRow).name;
  const rowKey = entityCompareKey(row.name);
  const incKey = entityCompareKey(incName);
  if (rowKey === incKey) return true;

  const rowAliases = (row.aliases ?? []).map(entityCompareKey);
  const incAliases = (inc.aliases ?? []).map(entityCompareKey);
  if (rowAliases.includes(incKey)) return true; // 新名字已是旧别名
  if (incAliases.includes(rowKey)) return true; // 旧 canonical 出现在新别名里

  // 线索专用：保守包含（预言信件 ↔ 预言信件内容）——
  // 短名 ≥4 字、长名包含短名、长度差 ≤4，避免「班目机构」误并「班目机构分署研究设施」
  if (opts?.containment) {
    const short = rowKey.length <= incKey.length ? rowKey : incKey;
    const long = rowKey.length <= incKey.length ? incKey : rowKey;
    if (short.length >= 4 && long.includes(short) && long.length - short.length <= 4) return true;
  }

  // 共享别名（排除通用词）
  return rowAliases.some(
    (a) => a.length >= 2 && incAliases.includes(a) && !ENTITY_ALIAS_STOP.has(a),
  );
}

/** canonical 升级：对比键更长（更完整）时采用（神红大学中央联合食堂 > 中央联合食堂） */
export function betterEntityCanonical(current: string, incoming: string): string | null {
  const cur = entityCompareKey(current);
  const inc = entityCompareKey(incoming);
  if (inc.length > cur.length && inc.length >= 2) return incoming;
  return null;
}

function longerText(a: string | null | undefined, b: string | null | undefined): string | null {
  const sa = (a ?? "").trim();
  const sb = (b ?? "").trim();
  if (!sa) return sb || null;
  if (!sb) return sa || null;
  return sb.length > sa.length ? sb : sa;
}

// ---------------------------------------------------------------------------
// 存量去重（heal）
// ---------------------------------------------------------------------------

interface EntityFull extends EntityRow {
  id: string;
  visual_note?: string | null;
  kind?: string | null;
  clue_type?: string | null;
  is_red_herring?: number | boolean;
  is_spoiler?: number | boolean;
  related_character_ids?: string[] | null;
  related_item_ids?: string[] | null;
  notes?: string | null;
  owner_character_id?: string | null;
  ref_asset_id?: string | null;
  first_chapter_id?: string | null;
  introduced_chapter_id?: string | null;
  created_at: string | null;
}

export interface EntityHealCluster {
  keeperId: string;
  keeperName: string;
  mergedIds: string[];
  mergedNames: string[];
  newAliases: string[];
  refsMoved: Record<string, number>;
}

export interface EntityHealResult {
  bookId: string;
  kind: EntityKind;
  checkpointId: string | null;
  beforeCount: number;
  afterCount: number;
  dryRun: boolean;
  clusters: EntityHealCluster[];
}

interface EntitySpec {
  /** 章节归属列（clues 是 introduced_chapter_id，其余 first_chapter_id） */
  chapterCol: "first_chapter_id" | "introduced_chapter_id";
  refs: Array<{ table: string; col: string }>;
  /** JSON 数组列，存实体 id（如 beats.clue_ids） */
  idJsonRefs: Array<{ table: string; col: string }>;
  /** JSON 数组列，存实体名字（如 chapter_summaries.clues） */
  nameJsonRefs: Array<{ table: string; col: string }>;
}

const SPECS: Record<EntityKind, EntitySpec> = {
  locations: {
    chapterCol: "first_chapter_id",
    refs: [
      { table: "assets", col: "location_id" },
      { table: "timeline_events", col: "location_id" },
    ],
    idJsonRefs: [],
    nameJsonRefs: [],
  },
  items: {
    chapterCol: "first_chapter_id",
    refs: [{ table: "assets", col: "item_id" }],
    idJsonRefs: [{ table: "clues", col: "related_item_ids" }],
    nameJsonRefs: [],
  },
  clues: {
    chapterCol: "introduced_chapter_id",
    refs: [],
    idJsonRefs: [{ table: "beats", col: "clue_ids" }],
    nameJsonRefs: [{ table: "chapter_summaries", col: "clues" }],
  },
};

function clusterRows(rows: EntityFull[], matchOpts?: { containment?: boolean }): EntityFull[][] {
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
      if (entityNamesMatch(rows[i], rows[j], matchOpts)) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map<number, EntityFull[]>();
  rows.forEach((r, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(r);
    groups.set(root, list);
  });
  return [...groups.values()];
}

/** keeper 选择：下游引用数 > 对比键长度（全名优先）> 描述长度 > 创建时间 */
function pickKeeper(
  cluster: EntityFull[],
  refsByName: Map<string, number>,
): EntityFull {
  let best = cluster[0];
  let bestScore = -1;
  for (const row of cluster) {
    const refs = refsByName.get(row.id) ?? 0;
    const score =
      refs * 10000 +
      entityCompareKey(row.name).length * 100 +
      normalizeName(row.name).length * 10 +
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

/** 各实体类型的合并字段（keeper 上执行 update） */
function mergedFields(
  kind: EntityKind,
  keeper: EntityFull,
  dups: EntityFull[],
  canonical: string,
  aliases: string[],
  chapterIdx: Map<string, number>,
): Record<string, unknown> {
  const spec = SPECS[kind];
  const all = [keeper, ...dups];
  const chIdx = (id: string | null | undefined) =>
    id && chapterIdx.has(id) ? chapterIdx.get(id)! : null;
  const firstCandidates = all
    .map((r) => ({ id: r[spec.chapterCol], idx: chIdx(r[spec.chapterCol]) }))
    .filter((c): c is { id: string; idx: number } => c.idx !== null)
    .sort((a, b) => a.idx - b.idx);
  const first = firstCandidates[0]?.id ?? keeper[spec.chapterCol] ?? null;

  const base: Record<string, unknown> = {
    name: canonical,
    aliases,
    description: all.reduce<string | null>((best, r) => longerText(best, r.description), null),
    [spec.chapterCol]: first,
  };

  if (kind === "locations") {
    base.visual_note = all.reduce<string | null>((best, r) => longerText(best, r.visual_note), null);
    base.ref_asset_id = keeper.ref_asset_id ?? dups.find((r) => r.ref_asset_id)?.ref_asset_id ?? null;
  } else if (kind === "items") {
    base.visual_note = all.reduce<string | null>((best, r) => longerText(best, r.visual_note), null);
    base.kind = keeper.kind && keeper.kind !== "object" ? keeper.kind : (dups.find((r) => r.kind && r.kind !== "object")?.kind ?? keeper.kind ?? "object");
    base.owner_character_id = keeper.owner_character_id ?? dups.find((r) => r.owner_character_id)?.owner_character_id ?? null;
    base.ref_asset_id = keeper.ref_asset_id ?? dups.find((r) => r.ref_asset_id)?.ref_asset_id ?? null;
  } else {
    // clues（description NOT NULL，空时兜底 ""）
    base.description = all.reduce<string | null>((best, r) => longerText(best, r.description), null) ?? "";
    base.clue_type =
      keeper.clue_type && keeper.clue_type !== "other"
        ? keeper.clue_type
        : (dups.find((r) => r.clue_type && r.clue_type !== "other")?.clue_type ?? keeper.clue_type ?? "other");
    base.is_red_herring = all.some((r) => r.is_red_herring === 1 || r.is_red_herring === true);
    base.is_spoiler = all.some((r) => r.is_spoiler === 1 || r.is_spoiler === true);
    base.notes = all.reduce<string | null>((best, r) => longerText(best, r.notes), null);
    base.related_character_ids = mergeNameSets(
      keeper.related_character_ids ?? [],
      ...dups.map((r) => r.related_character_ids ?? []),
    );
    base.related_item_ids = mergeNameSets(
      keeper.related_item_ids ?? [],
      ...dups.map((r) => r.related_item_ids ?? []),
    );
  }
  return base;
}

/** 合并一本书内重复的地点/物品/线索。checkpoint 保护；dryRun 只预览；幂等。 */
export async function healDuplicateEntities(
  bookId: string,
  kind: EntityKind,
  opts: { dryRun?: boolean } = {},
): Promise<EntityHealResult> {
  const s = getSupabaseAdmin();
  const dryRun = opts.dryRun === true;
  const spec = SPECS[kind];

  const { data: rows } = await s
    .from(kind)
    .select("*")
    .eq("book_id", bookId);
  const entities = (rows ?? []) as unknown as EntityFull[];

  // 下游引用计数
  const refsByEntity = new Map<string, number>();
  for (const { table, col } of spec.refs) {
    const { data: refs } = await s.from(table).select("id, " + col).eq("book_id", bookId);
    for (const r of (refs ?? []) as Array<{ [k: string]: string | null }>) {
      const id = r[col];
      if (id) refsByEntity.set(id, (refsByEntity.get(id) ?? 0) + 1);
    }
  }
  for (const { table, col } of spec.idJsonRefs) {
    const { data: refs } = await s.from(table).select("id, " + col).eq("book_id", bookId);
    for (const r of (refs ?? []) as Array<{ [k: string]: unknown }>) {
      for (const id of (Array.isArray(r[col]) ? r[col] : []) as string[]) {
        refsByEntity.set(id, (refsByEntity.get(id) ?? 0) + 1);
      }
    }
  }

  // 章节 idx 映射（first_chapter_id 归并）
  const { data: chapterRows } = await s.from("source_chapters").select("id, idx").eq("book_id", bookId);
  const chapterIdx = new Map<string, number>();
  for (const c of (chapterRows ?? []) as Array<{ id: string; idx: number }>) chapterIdx.set(c.id, c.idx);

  const clusters = clusterRows(entities, kind === "clues" ? { containment: true } : undefined).filter((c) => c.length > 1);

  if (clusters.length === 0) {
    return {
      bookId, kind, checkpointId: null, beforeCount: entities.length, afterCount: entities.length,
      dryRun, clusters: [],
    };
  }

  interface Plan {
    keeper: EntityFull;
    dups: EntityFull[];
    canonical: string;
    aliases: string[];
    fields: Record<string, unknown>;
  }
  const plans: Plan[] = clusters.map((cluster) => {
    const keeper = pickKeeper(cluster, refsByEntity);
    const dups = cluster.filter((r) => r.id !== keeper.id);
    const canonical = mergeNameSets(
      [keeper.name],
      ...dups.map((r) => [r.name]),
    ).reduce((best, name) => betterEntityCanonical(best, name) ?? best, keeper.name);
    const aliases = mergeNameSets(
      keeper.aliases,
      ...dups.map((r) => r.aliases),
      dups.map((r) => r.name),
      entityCompareKey(keeper.name) !== entityCompareKey(canonical) ? [keeper.name] : [],
    ).filter((a) => normalizeName(a) !== normalizeName(canonical));
    return { keeper, dups, canonical, aliases, fields: mergedFields(kind, keeper, dups, canonical, aliases, chapterIdx) };
  });

  const dupIds = new Set(plans.flatMap((p) => p.dups.map((r) => r.id)));

  const report: EntityHealResult = {
    bookId,
    kind,
    checkpointId: null,
    beforeCount: entities.length,
    afterCount: entities.length - dupIds.size,
    dryRun,
    clusters: plans.map((p) => ({
      keeperId: p.keeper.id,
      keeperName: p.canonical,
      mergedIds: p.dups.map((r) => r.id),
      mergedNames: p.dups.map((r) => r.name),
      newAliases: p.aliases,
      refsMoved: {},
    })),
  };
  if (dryRun) return report;

  // ---------- checkpoint ----------
  const dupIdList = [...dupIds];
  const entries: SnapshotEntry[] = [];
  for (const p of plans) {
    entries.push({ table: kind, rowId: p.keeper.id, before: { ...p.keeper } as any, op: "update" });
    for (const r of p.dups) {
      entries.push({ table: kind, rowId: r.id, before: { ...r } as any, op: "delete" });
    }
  }
  for (const { table, col } of spec.refs) {
    const { data: refs } = await s.from(table).select("id").in(col, dupIdList);
    for (const r of (refs ?? []) as Array<{ id: string }>) {
      const before = await s.from(table).select("*").eq("id", r.id).single();
      if (before.data) entries.push({ table, rowId: r.id, before: before.data as any, op: "update" });
    }
  }
  for (const { table, col } of [...spec.idJsonRefs, ...spec.nameJsonRefs]) {
    const { data: rowsWithRef } = await s.from(table).select("id, " + col).eq("book_id", bookId);
    for (const r of (rowsWithRef ?? []) as Array<{ id: string; [k: string]: unknown }>) {
      entries.push({ table, rowId: r.id, before: r as any, op: "update" });
    }
  }

  report.checkpointId = createCheckpoint(
    bookId,
    `合并重复${kind === "locations" ? "地点" : kind === "items" ? "物品" : "线索"}（${plans.length} 组，删除 ${dupIdList.length} 行）`,
    "manual-edit",
    `entities:${kind}:heal`,
    entries,
  );

  // ---------- 应用 ----------
  const keeperById = new Map<string, string>();
  for (const p of plans) for (const r of p.dups) keeperById.set(r.id, p.keeper.id);

  const exec = async (label: string, query: Promise<{ error: { message: string } | null }>) => {
    const res = await query;
    if (res.error) throw new Error(`${label} 失败: ${res.error.message}`);
    return res;
  };

  for (const p of plans) {
    await exec(`更新 keeper ${p.canonical}`, s.from(kind).update(p.fields).eq("id", p.keeper.id) as any);
  }

  for (const { table, col } of spec.refs) {
    const { data: refs } = await s.from(table).select("id, " + col).eq("book_id", bookId);
    for (const r of (refs ?? []) as Array<{ id: string; [k: string]: unknown }>) {
      const entityId = r[col] as string | null;
      const keeperId = entityId ? keeperById.get(entityId) : undefined;
      if (keeperId) {
        await exec(`重定向 ${table}.${col}`, s.from(table).update({ [col]: keeperId } as any).eq("id", r.id) as any);
      }
    }
  }

  const replaceInArray = (arr: unknown, map: (id: string) => string | null): string[] => {
    const out: string[] = [];
    for (const item of (Array.isArray(arr) ? arr : []) as string[]) {
      const mapped = map(item);
      if (mapped && !out.includes(mapped)) out.push(mapped);
    }
    return out;
  };
  for (const { table, col } of spec.idJsonRefs) {
    const { data: refs } = await s.from(table).select("id, " + col).eq("book_id", bookId);
    for (const r of (refs ?? []) as Array<{ id: string; [k: string]: unknown }>) {
      const fixed = replaceInArray(r[col], (id) => keeperById.get(id) ?? id);
      if (JSON.stringify(fixed) !== JSON.stringify(r[col])) {
        await exec(`修复 ${table}.${col}`, s.from(table).update({ [col]: fixed } as any).eq("id", r.id) as any);
      }
    }
  }
  if (spec.nameJsonRefs.length > 0) {
    const nameToKeeper = new Map<string, string>();
    for (const p of plans) {
      for (const r of [p.keeper, ...p.dups]) {
        nameToKeeper.set(entityCompareKey(r.name), p.canonical);
        for (const a of r.aliases ?? []) nameToKeeper.set(entityCompareKey(a), p.canonical);
      }
    }
    for (const { table, col } of spec.nameJsonRefs) {
      const { data: refs } = await s.from(table).select("id, " + col).eq("book_id", bookId);
      for (const r of (refs ?? []) as Array<{ id: string; [k: string]: unknown }>) {
        const fixed = replaceInArray(r[col], (name) => nameToKeeper.get(entityCompareKey(name)) ?? null);
        if (JSON.stringify(fixed) !== JSON.stringify(r[col])) {
          await exec(`修复 ${table}.${col}`, s.from(table).update({ [col]: fixed } as any).eq("id", r.id) as any);
        }
      }
    }
  }

  await exec("删除重复行", s.from(kind).delete().in("id", dupIdList) as any);

  // 补报告：引用迁移统计
  for (const c of report.clusters) {
    const plan = plans.find((p) => p.keeper.id === c.keeperId)!;
    const moved: Record<string, number> = {};
    for (const r of plan.dups) {
      const refs = refsByEntity.get(r.id) ?? 0;
      if (refs > 0) moved[r.name] = refs;
    }
    c.refsMoved = moved;
  }

  return report;
}
