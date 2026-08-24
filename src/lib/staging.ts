/* eslint-disable @typescript-eslint/no-explicit-any */
import { encodeDbValue, getSupabaseAdmin, rawDb, runInTransaction } from "@/lib/db";
import { createCheckpoint } from "@/lib/checkpoints";
import { JobCancelledError, type ProgressReporter } from "@/lib/jobs/types";
import { AdaptationValidationError, runAdaptation, buildAdaptationWrite } from "@/lib/pipeline/nodes/adapt";
import { handleAdaptationFailure } from "@/lib/review";
import { computeStoryboard } from "@/lib/pipeline/nodes/storyboard";
import { randomUUID } from "node:crypto";

/**
 * Staging 审阅（docs/06 §6.3 DiffReview 的数据层）。
 *
 * 高覆盖节点（adapt / storyboard）的 job 只"计算 + 生成变更清单"（staged_changes），
 * 不直接落库；用户逐条 accept / reject 后 applyStaged 统一应用（带 checkpoint）。
 */

export interface StagedEntry {
  id: string;
  bookId: string;
  jobId: string | null;
  node: string;
  groupKey: string;
  seq: number;
  tableName: string;
  op: "insert" | "update" | "delete";
  rowId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  status: "pending" | "accepted" | "rejected";
}

interface StageRow {
  id: string;
  book_id: string;
  job_id: string | null;
  node: string;
  group_key: string;
  seq: number;
  table_name: string;
  op: string;
  row_id: string | null;
  before_json: string | null;
  after_json: string | null;
  status: string;
}

function decode(row: StageRow): StagedEntry {
  return {
    id: row.id,
    bookId: row.book_id,
    jobId: row.job_id,
    node: row.node,
    groupKey: row.group_key,
    seq: row.seq,
    tableName: row.table_name,
    op: row.op as StagedEntry["op"],
    rowId: row.row_id,
    before: row.before_json ? (JSON.parse(row.before_json) as Record<string, unknown>) : null,
    after: row.after_json ? (JSON.parse(row.after_json) as Record<string, unknown>) : null,
    status: row.status as StagedEntry["status"],
  };
}

export interface StageEntryInput {
  tableName: string;
  op: "insert" | "update" | "delete";
  rowId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  groupKey: string;
}

/** 写入一批变更条目（同一 job 原子） */
export function stageEntries(bookId: string, jobId: string, node: string, entries: StageEntryInput[]): number {
  return runInTransaction(() => {
    const ins = rawDb.prepare(
      `INSERT INTO staged_changes (id, book_id, job_id, node, group_key, seq, table_name, op, row_id, before_json, after_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    );
    const now = new Date().toISOString();
    let seq = 0;
    for (const e of entries) {
      seq += 1;
      ins.run(
        randomUUID(), bookId, jobId, node, e.groupKey, seq, e.tableName, e.op,
        e.rowId ?? null,
        e.before ? JSON.stringify(e.before) : null,
        e.after ? JSON.stringify(e.after) : null,
        now,
      );
    }
    return seq;
  });
}

export function listStaged(bookId: string, jobId?: string | null): StagedEntry[] {
  const rows = jobId
    ? (rawDb.prepare(`SELECT * FROM staged_changes WHERE book_id = ? AND job_id = ? ORDER BY seq`).all(bookId, jobId) as StageRow[])
    : (rawDb.prepare(`SELECT * FROM staged_changes WHERE book_id = ? AND status = 'pending' ORDER BY seq`).all(bookId) as StageRow[]);
  return rows.map(decode);
}

export interface StagedGroup {
  jobId: string | null;
  node: string;
  count: number;
  groups: Array<{ key: string; count: number }>;
}

/** 待审变更摘要（按 job 分组，页面顶部提示用） */
export function stagedSummary(bookId: string): StagedGroup[] {
  const rows = rawDb
    .prepare(
      `SELECT job_id, node, COUNT(*) AS count FROM staged_changes
       WHERE book_id = ? AND status = 'pending' GROUP BY job_id, node ORDER BY MIN(seq)`,
    )
    .all(bookId) as Array<{ job_id: string | null; node: string; count: number }>;
  const groups = rawDb
    .prepare(
      `SELECT job_id, group_key, COUNT(*) AS count FROM staged_changes
       WHERE book_id = ? AND status = 'pending' GROUP BY job_id, group_key`,
    )
    .all(bookId) as Array<{ job_id: string | null; group_key: string; count: number }>;
  return rows.map((r) => ({
    jobId: r.job_id,
    node: r.node,
    count: r.count,
    groups: groups.filter((g) => g.job_id === r.job_id).map((g) => ({ key: g.group_key, count: g.count })),
  }));
}

export function discardStaged(bookId: string, jobId: string): number {
  const result = rawDb
    .prepare(`DELETE FROM staged_changes WHERE book_id = ? AND job_id = ?`)
    .run(bookId, jobId);
  return result.changes;
}

/** 应用的列白名单（防御：只允许这些表的 staged 条目被应用） */
const APPLY_TABLES = new Set(["beats", "shots", "shot_layers", "adapted_chapters", "timelines"]);

/**
 * 应用审阅决策：接受的条目按 op 落库（整体事务 + checkpoint），
 * 拒绝的条目丢弃；随后清空该 job 的 staged 行。返回 { applied, rejected }。
 */
export function applyStaged(
  bookId: string,
  jobId: string,
  decisions: Record<string, "accepted" | "rejected">,
): { applied: number; rejected: number } {
  const entries = listStaged(bookId, jobId);
  if (entries.length === 0) throw new Error("没有待应用的变更");

  return runInTransaction(() => {
    // 1. checkpoint：覆盖/删除类操作（update/delete）先快照
    const destructive = entries
      .filter((e) => (e.op === "update" || e.op === "delete") && decisions[e.id] === "accepted")
      .map((e) => ({
        table: e.tableName,
        rowId: e.rowId!,
        before: e.before ?? {},
        op: e.op as "update" | "delete",
      }));
    if (destructive.length > 0) {
      const node = entries[0].node;
      createCheckpoint(bookId, `审阅应用「${node}」（${destructive.length} 处覆盖）`, "node-rerun", node, destructive);
    }

    // 2. 应用
    let applied = 0;
    let rejected = 0;
    for (const e of entries) {
      const decision = decisions[e.id] ?? "rejected";
      if (decision !== "accepted") {
        rejected += 1;
        continue;
      }
      if (!APPLY_TABLES.has(e.tableName)) throw new Error(`不允许应用的变更表: ${e.tableName}`);
      const cols = (rawDb.prepare(`PRAGMA table_info(${e.tableName})`).all() as any[]).map((c) => c.name);
      if (e.op === "insert") {
        const after = e.after ?? {};
        const keys = Object.keys(after).filter((k) => cols.includes(k));
        if (keys.length === 0) throw new Error(`insert 无有效列: ${e.tableName}`);
        rawDb
          .prepare(`INSERT OR REPLACE INTO ${e.tableName} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
          .run(...keys.map((k) => encodeDbValue(k, after[k])));
        applied += 1;
      } else if (e.op === "update") {
        const after = e.after ?? {};
        const keys = Object.keys(after).filter((k) => cols.includes(k) && k !== "id");
        if (keys.length > 0) {
          rawDb
            .prepare(`UPDATE ${e.tableName} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
            .run(...keys.map((k) => encodeDbValue(k, after[k])), e.rowId);
          applied += 1;
        }
      } else if (e.op === "delete") {
        rawDb.prepare(`DELETE FROM ${e.tableName} WHERE id = ?`).run(e.rowId);
        applied += 1;
      }
    }

    rawDb.prepare(`DELETE FROM staged_changes WHERE book_id = ? AND job_id = ?`).run(bookId, jobId);
    return { applied, rejected };
  });
}

/** adapt 预览（不落库）：计算改编 + 生成 staged 变更清单 */
export async function stageAdaptation(
  bookId: string,
  reporter?: ProgressReporter,
  sourceChapterId?: string,
): Promise<{ entries: StageEntryInput[]; beats: number }> {
  const s = getSupabaseAdmin();
  let chapterQuery = s
    .from("source_chapters")
    .select("id, idx, title, cleaned_text")
    .eq("book_id", bookId);
  chapterQuery = sourceChapterId ? chapterQuery.eq("id", sourceChapterId) : chapterQuery.eq("idx", 1);
  const { data: chapter } = await chapterQuery.single();
  if (!chapter) throw new Error("没有 idx=1 的章节");

  let result: Awaited<ReturnType<typeof runAdaptation>>;
  try {
    result = await runAdaptation(
      bookId,
      { id: chapter.id, idx: chapter.idx, title: chapter.title, cleanedText: chapter.cleaned_text },
      reporter,
      true,
    );
  } catch (err) {
    // 重试耗尽降级：诊断写入待审收件箱，再把可读消息抛给任务层
    if (err instanceof AdaptationValidationError) {
      const message = await handleAdaptationFailure(bookId, err);
      throw new Error(message);
    }
    throw err;
  }
  const { adapt } = result;
  const { payload, beatRows, existingChapterId } = await buildAdaptationWrite(
    bookId,
    chapter.id,
    adapt,
    result.characterIdByName ?? new Map(),
    result.clueIdByName ?? new Map(),
    result.context.targetSec,
    result.context.basis ?? "source",
  );

  const entries: StageEntryInput[] = [];

  // 章节行：存在则 update，否则 insert（含占位 id）
  const newChapterId = existingChapterId ?? randomUUID();
  if (existingChapterId) {
    const { data: existingRow } = await s.from("adapted_chapters").select("*").eq("id", existingChapterId).single();
    entries.push({
      tableName: "adapted_chapters",
      op: "update",
      rowId: existingChapterId,
      before: existingRow ?? null,
      after: payload,
      groupKey: "章节",
    });
  } else {
    entries.push({
      tableName: "adapted_chapters",
      op: "insert",
      after: { id: newChapterId, ...payload },
      groupKey: "章节",
    });
  }

  // 旧 beats 全部删除
  if (existingChapterId) {
    const { data: oldBeats } = await s.from("beats").select("*").eq("adapted_chapter_id", existingChapterId);
    for (const beat of oldBeats ?? []) {
      entries.push({ tableName: "beats", op: "delete", rowId: beat.id, before: beat, groupKey: `beat#${beat.idx}` });
    }
  }

  // 新 beats 插入（完整行，含 id 与 resolved character_id）
  for (const row of beatRows) {
    const id = randomUUID();
    entries.push({
      tableName: "beats",
      op: "insert",
      after: { id, ...row, adapted_chapter_id: newChapterId },
      groupKey: `beat#${(row as { idx?: number }).idx ?? "?"}`,
    });
  }

  if (reporter?.checkCancelled()) throw new JobCancelledError();
  return { entries, beats: adapt.beats.length };
}

/** storyboard 预览（不落库）：计算分镜 + 生成 staged 变更清单 */
export async function stageStoryboard(
  bookId: string,
  reporter?: ProgressReporter,
): Promise<{ entries: StageEntryInput[]; shots: number }> {
  const s = getSupabaseAdmin();
  const computed = await computeStoryboard(bookId, undefined, reporter);
  const { beats, drafts, durationSec, snapshot } = computed;

  const entries: StageEntryInput[] = [];
  const beatIds = beats.map((b) => b.id);
  const { data: oldShots } = await s.from("shots").select("*").in("beat_id", beatIds);
  const oldShotIds = (oldShots ?? []).map((x: any) => x.id);
  const oldLayers: any[] = [];
  if (oldShotIds.length > 0) {
    const { data: layers } = await s.from("shot_layers").select("*").in("shot_id", oldShotIds);
    oldLayers.push(...(layers ?? []));
  }
  for (const shot of oldShots ?? []) {
    entries.push({ tableName: "shots", op: "delete", rowId: shot.id, before: shot, groupKey: `镜头#${shot.idx}` });
  }
  for (const layer of oldLayers) {
    entries.push({ tableName: "shot_layers", op: "delete", rowId: layer.id, before: layer, groupKey: "镜头图层" });
  }
  for (const draft of drafts) {
    const shotRow: Record<string, unknown> = {
      id: draft.shotId!,
      book_id: bookId,
      beat_id: draft.beatId,
      idx: draft.idx,
      description: draft.description,
      camera: draft.camera,
      duration_sec: draft.durationSec,
      transition_in: draft.transitionIn,
      transition_out: draft.transitionOut,
      background_asset_id: draft.backgroundAssetId,
      style: {},
      status: "draft",
    };
    entries.push({ tableName: "shots", op: "insert", after: shotRow, groupKey: `镜头#${draft.idx}` });
    draft.layers.forEach((layer, layerIdx) => {
      entries.push({
        tableName: "shot_layers",
        op: "insert",
        after: {
          id: layer.layerId!,
          shot_id: draft.shotId,
          idx: layerIdx,
          z: layerIdx,
          kind: layer.kind,
          character_id: layer.characterId,
          asset_id: layer.assetId,
          expression: layer.expression,
          rect: layer.rect,
          enter_animation: layer.enter,
          exit_animation: layer.exit,
          motion: layer.motion,
          locked: false,
        },
        groupKey: `镜头#${draft.idx}`,
      });
    });
  }
  // timeline（快照引用 draft 占位 id，apply 后即可用）
  entries.push({
    tableName: "timelines",
    op: "insert",
    after: {
      id: randomUUID(),
      book_id: bookId,
      kind: "preview",
      version: 1,
      duration_sec: durationSec,
      snapshot,
      status: "draft",
    },
    groupKey: "预览时间线",
  });

  if (reporter?.checkCancelled()) throw new JobCancelledError();
  return { entries, shots: drafts.length };
}
