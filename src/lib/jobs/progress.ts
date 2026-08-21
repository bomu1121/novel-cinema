import { rawDb } from "@/lib/db";
import { randomUUID } from "node:crypto";
import type { JobEvent, JobEventKind, JobPhase, JobSnapshot } from "./types";

/**
 * jobs 数据访问（docs/06 §4.1）。
 * 全部走原生 rawDb：worker 是独立进程，与 Next 服务端共享同一 SQLite 文件（WAL）。
 */

function isoNow(): string {
  return new Date().toISOString();
}

interface JobRow {
  id: string;
  book_id: string;
  node: string;
  status: string;
  progress: number;
  step: string | null;
  step_index: number;
  step_total: number;
  error: string | null;
  input_ref: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function toSnapshot(row: JobRow): JobSnapshot {
  return {
    id: row.id,
    bookId: row.book_id,
    node: row.node,
    status: row.status as JobPhase,
    progress: row.progress,
    step: row.step,
    stepIndex: row.step_index,
    stepTotal: row.step_total,
    error: row.error,
    inputRef: row.input_ref ? (JSON.parse(row.input_ref) as Record<string, unknown>) : {},
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function createJobRow(bookId: string, node: string, inputRef: Record<string, unknown> = {}): string {
  const id = randomUUID();
  rawDb
    .prepare(
      `INSERT INTO jobs (id, book_id, node, input_ref, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(id, bookId, node, JSON.stringify(inputRef), isoNow(), isoNow());
  return id;
}

export function getJob(jobId: string): JobSnapshot | null {
  const row = rawDb.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
  return row ? toSnapshot(row) : null;
}

export function setJobStatus(jobId: string, status: JobPhase, extra: Partial<Pick<JobRow, "error">> = {}): void {
  const sets: string[] = ["status = ?", "updated_at = ?"];
  const params: unknown[] = [status, isoNow()];
  if (status === "running") {
    sets.push("started_at = COALESCE(started_at, ?)");
    params.push(isoNow());
  } else if (status === "succeeded" || status === "failed" || status === "cancelled") {
    sets.push("finished_at = ?");
    params.push(isoNow());
    if (status === "succeeded") {
      sets.push("progress = 1");
    }
  }
  if (extra.error != null) {
    sets.push("error = ?");
    params.push(extra.error);
  }
  params.push(jobId);
  rawDb.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function updateJobProgress(
  jobId: string,
  patch: { progress?: number; step?: string | null; stepIndex?: number; stepTotal?: number },
): void {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [isoNow()];
  if (patch.progress != null) {
    sets.push("progress = ?");
    params.push(Math.max(0, Math.min(1, patch.progress)));
  }
  if (patch.step !== undefined) {
    sets.push("step = ?");
    params.push(patch.step);
  }
  if (patch.stepIndex != null) {
    sets.push("step_index = ?");
    params.push(patch.stepIndex);
  }
  if (patch.stepTotal != null) {
    sets.push("step_total = ?");
    params.push(patch.stepTotal);
  }
  params.push(jobId);
  rawDb.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

let eventSeq = 0;

export function appendEvent(jobId: string, kind: JobEventKind, payload: Record<string, unknown> = {}): number {
  eventSeq += 1;
  rawDb
    .prepare(`INSERT INTO job_events (job_id, seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(jobId, eventSeq, kind, JSON.stringify(payload), isoNow());
  return eventSeq;
}

/** 从 seq 之后的事件开始重放（SSE Last-Event-ID） */
export function eventsAfter(jobId: string, afterSeq: number): JobEvent[] {
  const rows = rawDb
    .prepare(`SELECT id, seq, kind, payload, created_at FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq`)
    .all(jobId, afterSeq) as Array<{
    id: number;
    seq: number;
    kind: string;
    payload: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    kind: r.kind as JobEventKind,
    payload: JSON.parse(r.payload),
    createdAt: r.created_at,
  }));
}

export function setCancelRequested(jobId: string): void {
  rawDb.prepare(`UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?`).run(isoNow(), jobId);
}

export function isCancelRequested(jobId: string): boolean {
  const row = rawDb.prepare(`SELECT cancel_requested FROM jobs WHERE id = ?`).get(jobId) as
    | { cancel_requested: number }
    | undefined;
  return (row?.cancel_requested ?? 0) === 1;
}

/** 本书 active 任务（刷新后恢复 UI 用） */
export function activeJobs(bookId: string, limit = 10): JobSnapshot[] {
  const rows = rawDb
    .prepare(
      `SELECT * FROM jobs WHERE book_id = ? AND status IN ('pending','running') ORDER BY created_at DESC LIMIT ?`,
    )
    .all(bookId, limit) as JobRow[];
  return rows.map(toSnapshot);
}

/** 孤儿清理：running 超过 10 分钟视为 worker 已死（进程崩溃/服务器重启） */
export function sweepOrphanJobs(): number {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const row = rawDb
    .prepare(
      `UPDATE jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
       WHERE status = 'running' AND started_at < ?`,
    )
    .run(
      JSON.stringify({ message: "任务进程中断，已标记失败；可重新执行" }),
      isoNow(),
      isoNow(),
      cutoff,
    );
  return row.changes;
}
