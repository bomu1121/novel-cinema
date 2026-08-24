/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * 本地 SQLite 数据层（个人单机版）。
 * 对外保持 Supabase 风格的链式调用：from().select().eq().single() 等，
 * 上层 pipeline/API 代码无需改动。表结构见 ensureSchema()。
 */

const dataDir = process.env.NOVEL_CINEMA_DATA_DIR || path.join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const database = new Database(path.join(dataDir, "novel-cinema.db"));
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
// 多进程共享（Next 服务端 + jobs worker 子进程）写锁等待，而非立即报错
database.pragma("busy_timeout = 10000");
ensureSchema(database);

// ---------- 类型映射 ----------
const JSON_COLUMNS = new Set([
  "settings", "parse_meta", "key_events", "new_facts", "characters", "clues",
  "bio", "color_palette", "camera_grammar", "spoiler_rules", "negative_prompt",
  "proposal_json", "defaults", "emotion_range", "spec", "params", "ref_asset_ids",
  "selection_report", "raw_output", "flags", "source_span", "rect", "motion",
  "style", "snapshot", "publish_meta", "preset", "error", "input_ref",
  "output_ref", "cost", "ai_report", "human_decision", "input_snapshot",
  "aliases", "genre", "character_ids", "related_character_ids",
  "related_item_ids", "clue_ids", "before_json", "parse_report", "report",
]);

function encodeRow(table: string, row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...row };
  if (!out.id) out.id = randomUUID();
  if (!out.created_at && !row.created_at) out.created_at = new Date().toISOString();
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "boolean") {
      out[key] = value ? 1 : 0; // better-sqlite3 不接受 boolean，统一转 0/1
    } else if (value != null && JSON_COLUMNS.has(key) && typeof value !== "string") {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

function decodeRow(table: string, row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && JSON_COLUMNS.has(key)) {
      try {
        out[key] = JSON.parse(value);
      } catch {
        out[key] = value;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 把解码后的值重新编码为可绑定的 SQLite 值（JSON 列 stringify、boolean→0/1）。
 * checkpoints 恢复行时复用，保证与 encodeRow 一致。
 */
export function encodeDbValue(key: string, value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value != null && JSON_COLUMNS.has(key) && typeof value !== "string") return JSON.stringify(value);
  return value;
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`非法标识符: ${name}`);
  }
  return name;
}

function colList(columns?: string): string {
  if (!columns || columns.trim() === "*") return "*";
  return columns.split(",").map((c) => ident(c.trim())).join(", ");
}

interface WhereClause {
  col: string;
  op: "=" | "!=" | "IS NULL" | "IN";
  value?: unknown;
}

interface QueryError {
  message: string;
}

type QBResult<T> = { data: T | null; error: QueryError | null };

class QueryBuilder {
  private table: string;
  private wheres: WhereClause[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitVal: number | null = null;
  private selectCols: string | null = null;
  private insertRows: Record<string, any>[] | null = null;
  private updateObj: Record<string, any> | null = null;
  private deleteFlag = false;

  constructor(table: string) {
    this.table = table;
  }

  select(cols: string): this {
    this.selectCols = cols;
    return this;
  }

  eq(col: string, value: unknown): this {
    this.wheres.push({ col: ident(col), op: "=", value });
    return this;
  }

  neq(col: string, value: unknown): this {
    this.wheres.push({ col: ident(col), op: "!=", value });
    return this;
  }

  is(col: string, value: null): this {
    if (value === null) this.wheres.push({ col: ident(col), op: "IS NULL" });
    else this.eq(col, value);
    return this;
  }

  in(col: string, values: any[]): this {
    this.wheres.push({ col: ident(col), op: "IN", value: values });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = ident(col);
    this.orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  insert(rows: Record<string, any> | Record<string, any>[]): this {
    this.insertRows = (Array.isArray(rows) ? rows : [rows]).map((r) => encodeRow(this.table, r));
    return this;
  }

  update(obj: Record<string, any>): this {
    this.updateObj = obj;
    return this;
  }

  delete(): this {
    this.deleteFlag = true;
    return this;
  }

  single(): QBResult<any> {
    return this.executeSingle();
  }

  maybeSingle(): QBResult<any> {
    return this.executeSingle();
  }

  /** 兼容 Supabase 的 thenable：await update/delete/insert 时自动执行 */
  then<TResult1 = QBResult<any>, TResult2 = never>(
    onfulfilled?: ((value: QBResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const p = Promise.resolve(this.executeDefault());
    return p.then(onfulfilled, onrejected);
  }

  private whereSql(params: any[]): string {
    if (this.wheres.length === 0) return "";
    const parts = this.wheres.map((w) => {
      if (w.op === "IS NULL") return `${w.col} IS NULL`;
      if (w.op === "IN") {
        const arr = (w.value as any[]) ?? [];
        if (arr.length === 0) return "0"; // 空 IN 永不匹配
        params.push(...arr);
        return `${w.col} IN (${arr.map(() => "?").join(",")})`;
      }
      params.push(w.value);
      return `${w.col} ${w.op} ?`;
    });
    return `WHERE ${parts.join(" AND ")}`;
  }

  private buildSelectSql(params: any[]): string {
    const cols = colList(this.selectCols ?? undefined);
    let sql = `SELECT ${cols} FROM ${ident(this.table)}`;
    sql += ` ${this.whereSql(params)}`;
    if (this.orderCol) sql += ` ORDER BY ${this.orderCol} ${this.orderAsc ? "ASC" : "DESC"}`;
    if (this.limitVal != null) sql += ` LIMIT ${this.limitVal}`;
    return sql.trim();
  }

  private executeSingle(): QBResult<any> {
    try {
      if (this.insertRows) {
        const insertStmt = database.prepare(this.buildInsertSql());
        for (const row of this.insertRows) {
          insertStmt.run(...this.insertParams(row));
        }
        const inserted = this.insertRows[0] as Record<string, any>;
        const id = inserted.id as string;
        const row = database.prepare(`SELECT * FROM ${ident(this.table)} WHERE id = ?`).get(id) as
          | Record<string, any>
          | undefined;
        return { data: decodeRow(this.table, row ?? null) ?? inserted, error: null };
      }
      const params: any[] = [];
      const sql = this.buildSelectSql(params);
      const row = database.prepare(sql).get(...params) as Record<string, any> | undefined;
      return { data: decodeRow(this.table, row ?? null), error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  private executeDefault(): QBResult<any> {
    try {
      if (this.deleteFlag) {
        const params: any[] = [];
        const sql = `DELETE FROM ${ident(this.table)} ${this.whereSql(params)}`;
        database.prepare(sql).run(...params);
        return { data: null, error: null };
      }
      if (this.updateObj) {
        const params: any[] = [];
        const entries = Object.entries(this.updateObj);
        const sets = entries.map(([key, value]) => {
          const v =
            typeof value === "boolean"
              ? value ? 1 : 0
              : value != null && JSON_COLUMNS.has(key) && typeof value !== "string"
                ? JSON.stringify(value)
                : value;
          params.push(v);
          return `${ident(key)} = ?`;
        });
        const sql = `UPDATE ${ident(this.table)} SET ${sets.join(", ")} ${this.whereSql(params)}`;
        database.prepare(sql).run(...params);
        return { data: null, error: null };
      }
      if (this.insertRows) {
        const insertStmt = database.prepare(this.buildInsertSql());
        const insertMany = database.transaction((rows: Record<string, any>[]) => {
          for (const row of rows) {
            insertStmt.run(...this.insertParams(row));
          }
        });
        insertMany(this.insertRows);
        return { data: null, error: null };
      }
      const params: any[] = [];
      const sql = this.buildSelectSql(params);
      const rows = database.prepare(sql).all(...params) as Record<string, any>[];
      return { data: rows.map((r) => decodeRow(this.table, r) as Record<string, any>), error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  private buildInsertSql(): string {
    const first = this.insertRows?.[0] ?? {};
    const cols = Object.keys(first);
    return `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  }

  private insertParams(row: Record<string, any>): any[] {
    return Object.keys(row).map((key) => row[key]);
  }

  /** 我们只用 onConflict: "source_chapter_id" 一处 */
  async upsert(
    row: Record<string, any>,
    opts?: { onConflict?: string },
  ): Promise<QBResult<Record<string, any> | null>> {
    try {
      const encoded = encodeRow(this.table, row);
      const cols = Object.keys(encoded);
      const conflict = opts?.onConflict ?? "id";
      const updates = cols.filter((c) => c !== conflict).map((c) => `${ident(c)} = excluded.${ident(c)}`);
      const sql =
        `INSERT INTO ${ident(this.table)} (${cols.map(ident).join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ` +
        `ON CONFLICT(${ident(conflict)}) DO UPDATE SET ${updates.join(", ")}`;
      database.prepare(sql).run(...cols.map((c) => encoded[c]));
      return { data: null, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }
}

interface FakeClient {
  from(table: string): QueryBuilder;
}

const fakeClient: FakeClient = {
  from(table: string) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`非法表名: ${table}`);
    return new QueryBuilder(table);
  },
};

/** 服务端 client（SQLite 版）。上层代码兼容调用。 */
export function getSupabaseAdmin(): FakeClient {
  return fakeClient;
}

/** 单人本地版没有登录：保留占位接口。 */
export function getSupabaseUserClient(): FakeClient {
  return fakeClient;
}

// ---------- 原生访问（checkpoint / 批量事务用，QueryBuilder 能力边界之外） ----------

/** 原生 better-sqlite3 句柄：仅供 lib/ 内部需要事务或原生 SQL 的模块使用（如 checkpoints）。 */
export const rawDb: Database.Database = database;

/** 在单个事务中执行 fn；抛错则整体回滚。批量快照 / staging 落库必须走这里，避免半批写入。 */
export function runInTransaction<T>(fn: () => T): T {
  return database.transaction(fn)();
}

// ---------- SQLite schema（对应 supabase/migrations/0001_schema.sql 的本地等价） ----------
function ensureSchema(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  title TEXT NOT NULL,
  source_file_key TEXT,
  source_file_name TEXT,
  language TEXT NOT NULL DEFAULT 'zh',
  total_chars INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  settings TEXT NOT NULL DEFAULT '{}',
  source_encoding TEXT,
  parse_report TEXT NOT NULL DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS source_chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT,
  raw_text TEXT NOT NULL,
  cleaned_text TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  parse_meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(book_id, idx)
);

CREATE TABLE IF NOT EXISTS condensed_chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_chapter_id TEXT NOT NULL UNIQUE REFERENCES source_chapters(id) ON DELETE CASCADE,
  title TEXT,
  hook TEXT,
  condensed_text TEXT NOT NULL,
  source_chars INTEGER NOT NULL DEFAULT 0,
  target_chars INTEGER NOT NULL DEFAULT 0,
  ratio REAL NOT NULL DEFAULT 0.35,
  status TEXT NOT NULL DEFAULT 'draft',
  model TEXT,
  raw_output TEXT NOT NULL DEFAULT '{}',
  report TEXT NOT NULL DEFAULT '{}',
  hand_edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chapter_summaries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_chapter_id TEXT NOT NULL UNIQUE REFERENCES source_chapters(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  key_events TEXT NOT NULL DEFAULT '[]',
  new_facts TEXT NOT NULL DEFAULT '[]',
  characters TEXT NOT NULL DEFAULT '[]',
  clues TEXT NOT NULL DEFAULT '[]',
  tone TEXT,
  embedding TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'other',
  archetype TEXT,
  description TEXT,
  bio TEXT NOT NULL DEFAULT '{}',
  first_chapter_id TEXT REFERENCES source_chapters(id),
  last_chapter_id TEXT REFERENCES source_chapters(id),
  ref_asset_id TEXT,
  voice_profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  spoiler_note TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS character_relations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  target_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  description TEXT,
  is_spoiler INTEGER NOT NULL DEFAULT 0,
  source_chapter_id TEXT REFERENCES source_chapters(id),
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT,
  UNIQUE(book_id, source_character_id, target_character_id, relation_type)
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  visual_note TEXT,
  first_chapter_id TEXT REFERENCES source_chapters(id),
  ref_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'object',
  description TEXT,
  visual_note TEXT,
  owner_character_id TEXT REFERENCES characters(id),
  first_chapter_id TEXT REFERENCES source_chapters(id),
  ref_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_chapter_id TEXT REFERENCES source_chapters(id),
  time_label TEXT NOT NULL,
  order_key TEXT NOT NULL,
  description TEXT NOT NULL,
  character_ids TEXT NOT NULL DEFAULT '[]',
  location_id TEXT REFERENCES locations(id),
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS clues (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  clue_type TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  introduced_chapter_id TEXT REFERENCES source_chapters(id),
  resolved_chapter_id TEXT REFERENCES source_chapters(id),
  is_red_herring INTEGER NOT NULL DEFAULT 0,
  is_spoiler INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'introduced',
  related_character_ids TEXT NOT NULL DEFAULT '[]',
  related_item_ids TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS style_bibles (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL UNIQUE REFERENCES books(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  genre TEXT NOT NULL DEFAULT '[]',
  visual_style TEXT NOT NULL,
  art_direction TEXT,
  color_palette TEXT NOT NULL DEFAULT '[]',
  camera_grammar TEXT NOT NULL DEFAULT '{}',
  narration_person TEXT,
  narration_tone TEXT,
  spoiler_rules TEXT NOT NULL DEFAULT '{}',
  negative_prompt TEXT NOT NULL DEFAULT '{}',
  proposal_json TEXT NOT NULL DEFAULT '[]',
  approved_proposal_index INTEGER,
  approved_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS voice_profiles (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'character',
  character_id TEXT REFERENCES characters(id),
  provider TEXT NOT NULL,
  provider_voice_id TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'zh',
  gender TEXT,
  timbre TEXT,
  defaults TEXT NOT NULL DEFAULT '{}',
  emotion_range TEXT NOT NULL DEFAULT '[]',
  sample_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  note TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS asset_requests (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  spec TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 3,
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT,
  provider TEXT,
  model TEXT,
  prompt TEXT,
  negative_prompt TEXT,
  seed INTEGER,
  params TEXT NOT NULL DEFAULT '{}',
  ref_asset_ids TEXT NOT NULL DEFAULT '[]',
  generation_request_id TEXT REFERENCES asset_requests(id),
  character_id TEXT REFERENCES characters(id),
  location_id TEXT REFERENCES locations(id),
  item_id TEXT REFERENCES items(id),
  expression TEXT,
  pose TEXT,
  scene_key TEXT,
  file_key TEXT,
  thumb_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  file_size_bytes INTEGER,
  source TEXT NOT NULL DEFAULT 'generated',
  status TEXT NOT NULL DEFAULT 'generating',
  is_candidate INTEGER NOT NULL DEFAULT 1,
  consistency_score REAL,
  review_note TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS adapted_chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_chapter_id TEXT NOT NULL UNIQUE REFERENCES source_chapters(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT,
  hook TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  model TEXT,
  model_version TEXT,
  basis TEXT NOT NULL DEFAULT 'source',
  target_duration_sec REAL NOT NULL DEFAULT 0,
  estimated_duration_sec REAL NOT NULL DEFAULT 0,
  importance REAL NOT NULL DEFAULT 1.0,
  selection_report TEXT NOT NULL DEFAULT '{}',
  raw_output TEXT NOT NULL DEFAULT '{}',
  reviewed_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(book_id, idx)
);

CREATE TABLE IF NOT EXISTS beats (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  adapted_chapter_id TEXT NOT NULL REFERENCES adapted_chapters(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL,
  speaker_type TEXT NOT NULL DEFAULT 'narrator',
  character_id TEXT REFERENCES characters(id),
  text TEXT NOT NULL,
  emotion TEXT NOT NULL DEFAULT 'neutral',
  pace REAL NOT NULL DEFAULT 1.0,
  visual_note TEXT,
  source_span TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  clue_ids TEXT NOT NULL DEFAULT '[]',
  flags TEXT NOT NULL DEFAULT '{}',
  estimated_duration_sec REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(adapted_chapter_id, idx)
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  beat_id TEXT NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  description TEXT,
  camera TEXT NOT NULL DEFAULT 'static',
  duration_sec REAL NOT NULL,
  transition_in TEXT NOT NULL DEFAULT 'cut',
  transition_out TEXT NOT NULL DEFAULT 'cut',
  background_asset_id TEXT REFERENCES assets(id),
  style TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT,
  UNIQUE(beat_id, idx)
);

CREATE TABLE IF NOT EXISTS shot_layers (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  z INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'character',
  character_id TEXT REFERENCES characters(id),
  asset_id TEXT REFERENCES assets(id),
  expression TEXT,
  pose TEXT,
  rect TEXT NOT NULL DEFAULT '{"x":0.5,"y":0.5,"w":0.4,"h":0.6}',
  enter_animation TEXT,
  exit_animation TEXT,
  motion TEXT NOT NULL DEFAULT '{}',
  opacity REAL NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  UNIQUE(shot_id, idx)
);

CREATE TABLE IF NOT EXISTS voice_takes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  beat_id TEXT NOT NULL REFERENCES beats(id) ON DELETE CASCADE,
  voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id),
  provider TEXT NOT NULL,
  model TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  audio_asset_id TEXT REFERENCES assets(id),
  duration_ms INTEGER,
  asr_text TEXT,
  asr_confidence REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  error TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  duration_sec REAL,
  snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'preview',
  episode_id TEXT,
  timeline_id TEXT REFERENCES timelines(id),
  preset TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  output_file_key TEXT,
  thumb_key TEXT,
  duration_sec REAL,
  log TEXT,
  error TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT,
  description TEXT,
  start_time_sec REAL,
  end_time_sec REAL,
  cover_asset_id TEXT REFERENCES assets(id),
  timeline_id TEXT REFERENCES timelines(id),
  render_job_id TEXT REFERENCES render_jobs(id),
  status TEXT NOT NULL DEFAULT 'draft',
  publish_meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT,
  UNIQUE(book_id, idx)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  node TEXT NOT NULL,
  parent_id TEXT REFERENCES jobs(id),
  input_ref TEXT NOT NULL DEFAULT '{}',
  output_ref TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  cost TEXT NOT NULL DEFAULT '{}',
  progress REAL NOT NULL DEFAULT 0,
  step TEXT,
  step_index INTEGER NOT NULL DEFAULT 0,
  step_total INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, seq);

CREATE TABLE IF NOT EXISTS review_tasks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  ai_report TEXT NOT NULL DEFAULT '{}',
  human_decision TEXT,
  decided_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS chapter_contexts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  adapted_chapter_id TEXT NOT NULL UNIQUE REFERENCES adapted_chapters(id) ON DELETE CASCADE,
  input_snapshot TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  before_json TEXT NOT NULL,
  checkpoint_id TEXT REFERENCES checkpoints(id),
  op TEXT NOT NULL DEFAULT 'update',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'node-rerun',
  node TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS staged_changes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  node TEXT NOT NULL,
  group_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  op TEXT NOT NULL,
  row_id TEXT,
  before_json TEXT,
  after_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_staged_book ON staged_changes(book_id, job_id, status);

CREATE INDEX IF NOT EXISTS idx_source_chapters_book ON source_chapters(book_id);
CREATE INDEX IF NOT EXISTS idx_condensed_chapters_book ON condensed_chapters(book_id);
CREATE INDEX IF NOT EXISTS idx_characters_book ON characters(book_id);
CREATE INDEX IF NOT EXISTS idx_assets_book_scene ON assets(book_id, scene_key);
CREATE INDEX IF NOT EXISTS idx_beats_chapter ON beats(adapted_chapter_id, idx);
CREATE INDEX IF NOT EXISTS idx_voice_takes_beat ON voice_takes(beat_id);
CREATE INDEX IF NOT EXISTS idx_timelines_book ON timelines(book_id, kind, version);
CREATE INDEX IF NOT EXISTS idx_jobs_book ON jobs(book_id, node, status);
CREATE INDEX IF NOT EXISTS idx_snapshots_book ON snapshots(book_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checkpoints_book ON checkpoints(book_id, created_at);
  `);

  // 增量迁移：老库补新列（SQLite 的 ALTER TABLE ADD COLUMN）
  const columns = db.prepare(`PRAGMA table_info(snapshots)`).all().map((r) => (r as { name: string }).name);
  if (!columns.includes("checkpoint_id")) {
    db.exec(`ALTER TABLE snapshots ADD COLUMN checkpoint_id TEXT REFERENCES checkpoints(id)`);
  }
  if (!columns.includes("op")) {
    db.exec(`ALTER TABLE snapshots ADD COLUMN op TEXT NOT NULL DEFAULT 'update'`);
  }
  // 新列就位后再建索引（老库上必须在 ALTER 之后）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_checkpoint ON snapshots(checkpoint_id)`);

  // books 增量列（上传解析升级：编码 + 清洗报告持久化）
  const bookColumns = db.prepare(`PRAGMA table_info(books)`).all().map((r) => (r as { name: string }).name);
  if (!bookColumns.includes("source_encoding")) {
    db.exec(`ALTER TABLE books ADD COLUMN source_encoding TEXT`);
  }
  if (!bookColumns.includes("parse_report")) {
    db.exec(`ALTER TABLE books ADD COLUMN parse_report TEXT NOT NULL DEFAULT '{}'`);
  }

  // jobs 增量列（老库补列，P1 可观测执行）
  const jobColumns = db.prepare(`PRAGMA table_info(jobs)`).all().map((r) => (r as { name: string }).name);
  const jobAdds: Array<[string, string]> = [
    ["progress", "progress REAL NOT NULL DEFAULT 0"],
    ["step", "step TEXT"],
    ["step_index", "step_index INTEGER NOT NULL DEFAULT 0"],
    ["step_total", "step_total INTEGER NOT NULL DEFAULT 0"],
    ["cancel_requested", "cancel_requested INTEGER NOT NULL DEFAULT 0"],
    ["updated_at", "updated_at TEXT"],
  ];
  for (const [col, ddl] of jobAdds) {
    if (!jobColumns.includes(col)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${ddl}`);
    }
  }

  // adapted_chapters 增量列：改编输入来源（原文 / 精简底稿）
  const adaptedColumns = db.prepare(`PRAGMA table_info(adapted_chapters)`).all().map((r) => (r as { name: string }).name);
  if (!adaptedColumns.includes("basis")) {
    db.exec(`ALTER TABLE adapted_chapters ADD COLUMN basis TEXT NOT NULL DEFAULT 'source'`);
  }
}

