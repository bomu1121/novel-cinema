/* eslint-disable @typescript-eslint/no-explicit-any */
import { encodeDbValue, rawDb, runInTransaction } from "@/lib/db";
import { randomUUID } from "node:crypto";

/**
 * 检查点（checkpoint）——本方案信任地基（docs/06 §4.4）。
 *
 * 任何破坏性写操作（节点重跑覆盖、批准、批量编辑）执行前必须：
 * 1. 先收集受影响行的完整 before 快照；
 * 2. createCheckpoint() 原子写入 checkpoint + 全部快照；
 * 3. 失败时 revertCheckpoint() 整体回滚；成功时该 checkpoint 成为撤销入口。
 *
 * 快照表（snapshots）新增两列：
 * - checkpoint_id：归属哪个检查点；
 * - op：update | insert | delete —— 记录恢复动作。
 */

export type CheckpointOrigin = "node-rerun" | "manual-edit" | "approve";
export type SnapshotOp = "update" | "insert" | "delete";

export interface SnapshotEntry {
  table: string;
  rowId: string;
  /** 完整行快照（恢复 update/delete 用） */
  before: Record<string, unknown>;
  op: SnapshotOp;
}

export interface CheckpointInfo {
  id: string;
  label: string;
  origin: string;
  node: string | null;
  createdAt: string;
  rowCount: number;
}

/** 允许被快照/恢复的表白名单（与 EDITABLE_TABLES + 破坏性节点产物对齐） */
const SNAPSHOT_TABLES = new Set([
  "source_chapters", "condensed_chapters", "characters", "character_relations", "clues", "locations",
  "style_bibles", "adapted_chapters", "beats", "shots", "shot_layers",
  "voice_profiles", "voice_takes", "assets", "timelines", "review_tasks",
]);

function assertTable(table: string): void {
  if (!SNAPSHOT_TABLES.has(table)) throw new Error(`不允许快照的表: ${table}`);
}

function isoNow(): string {
  return new Date().toISOString();
}

/** 建 checkpoint 并原子写入其全部快照。返回 checkpoint id。 */
export function createCheckpoint(
  bookId: string,
  label: string,
  origin: CheckpointOrigin,
  node?: string,
  entries: SnapshotEntry[] = [],
): string {
  // 先校验全部条目（白名单），再动库；否则非法表会先撞上 FK 约束
  for (const e of entries) assertTable(e.table);
  const id = randomUUID();
  runInTransaction(() => {
    rawDb
      .prepare(
        `INSERT INTO checkpoints (id, book_id, label, origin, node, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, bookId, label, origin, node ?? null, isoNow());
    const ins = rawDb.prepare(
      `INSERT INTO snapshots (id, book_id, table_name, row_id, before_json, checkpoint_id, op, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of entries) {
      ins.run(randomUUID(), bookId, e.table, e.rowId, JSON.stringify(e.before), id, e.op, isoNow());
    }
  });
  return id;
}

export function listCheckpoints(bookId: string, limit = 20): CheckpointInfo[] {
  const rows = rawDb
    .prepare(
      `SELECT cp.id, cp.label, cp.origin, cp.node, cp.created_at,
              (SELECT COUNT(*) FROM snapshots s WHERE s.checkpoint_id = cp.id) AS row_count
       FROM checkpoints cp
       WHERE cp.book_id = ?
       ORDER BY cp.created_at DESC
       LIMIT ?`,
    )
    .all(bookId, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    origin: r.origin,
    node: r.node,
    createdAt: r.created_at,
    rowCount: r.row_count,
  }));
}

/**
 * 回滚一个 checkpoint：按 op 恢复（delete→重插 / insert→删除 / update→还原字段），
 * 然后消费掉该 checkpoint 及其快照。整体原子。
 */
export function revertCheckpoint(bookId: string, checkpointId: string): { label: string; restored: number } {
  return runInTransaction(() => {
    const cp = rawDb
      .prepare(`SELECT * FROM checkpoints WHERE id = ? AND book_id = ?`)
      .get(checkpointId, bookId) as any;
    if (!cp) throw new Error("checkpoint 不存在");

    const snaps = rawDb
      .prepare(`SELECT * FROM snapshots WHERE checkpoint_id = ? ORDER BY created_at`)
      .all(checkpointId) as any[];
    let restored = 0;

    for (const snap of snaps) {
      const table = snap.table_name as string;
      assertTable(table);
      const rowId = snap.row_id as string;
      const before = JSON.parse(snap.before_json as string) as Record<string, any>;
      const cols = (rawDb.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
      const op = (snap.op as SnapshotOp) ?? "update";

      if (op === "insert") {
        rawDb.prepare(`DELETE FROM ${table} WHERE id = ?`).run(rowId);
        restored++;
      } else if (op === "delete") {
        const keys = Object.keys(before).filter((k) => cols.includes(k));
        const placeholders = keys.map(() => "?").join(", ");
        const values = keys.map((k) => encodeDbValue(k, before[k]));
        rawDb
          .prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`)
          .run(...values);
        restored++;
      } else {
        // update：还原除主键外的全部字段
        const keys = Object.keys(before).filter((k) => cols.includes(k) && k !== "id");
        if (keys.length > 0) {
          const sets = keys.map((k) => `${k} = ?`).join(", ");
          rawDb
            .prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`)
            .run(...keys.map((k) => encodeDbValue(k, before[k])), rowId);
          restored++;
        }
      }
    }

    rawDb.prepare(`DELETE FROM snapshots WHERE checkpoint_id = ?`).run(checkpointId);
    rawDb.prepare(`DELETE FROM checkpoints WHERE id = ?`).run(checkpointId);
    return { label: cp.label, restored };
  });
}

/** 最近一个 checkpoint（撤销入口用） */
export function latestCheckpointId(bookId: string): string | null {
  const row = rawDb
    .prepare(`SELECT id FROM checkpoints WHERE book_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(bookId) as { id: string } | undefined;
  return row?.id ?? null;
}
