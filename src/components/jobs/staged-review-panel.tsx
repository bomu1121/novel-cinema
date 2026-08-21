"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { StagedEntry } from "@/lib/staging";

/**
 * 审阅面（docs/06 §6.3 DiffReview）：AI 批量变更逐条 accept/reject。
 * - 每屏 ≤4 组（Cowan ~4 chunk；SmartBear <400 LOC/次）
 * - 纯键盘：j/k 移动 · a 接受 · r 驳回 · u 撤销上一条决策 · Enter 应用
 * - 「全部接受」不是默认焦点（对抗自动化偏见）
 * - 接受/驳回按钮吸底常驻（不随滚动消失）
 */

export interface StagedReviewPanelProps {
  bookId: string;
  jobId: string;
  nodeLabel?: string;
  onApplied?: (result: { applied: number; rejected: number }) => void;
  onDiscarded?: () => void;
  className?: string;
}

const OP_LABEL: Record<StagedEntry["op"], string> = {
  insert: "新增",
  update: "修改",
  delete: "删除",
};

const OP_STYLE: Record<StagedEntry["op"], string> = {
  insert: "border-approved/40 bg-approved/10 text-approved",
  update: "border-review/40 bg-review/10 text-review",
  delete: "border-stale/40 bg-stale/10 text-stale",
};

function entryTitle(e: StagedEntry): string {
  const after = e.after ?? {};
  const before = e.before ?? {};
  const t = (after.title as string) ?? (before.title as string);
  const text = (after.text as string) ?? (before.text as string);
  const desc = (after.description as string) ?? (before.description as string);
  const idx = (after.idx as number) ?? (before.idx as number);
  switch (e.tableName) {
    case "beats":
      return `beat#${idx ?? "?"}${text ? `：${String(text).slice(0, 40)}` : ""}`;
    case "shots":
      return `镜头#${idx ?? "?"}${desc ? `：${String(desc).slice(0, 40)}` : ""}`;
    case "shot_layers":
      return `图层：${String(after.kind ?? before.kind ?? "?")}${t ? ` · ${t}` : ""}`;
    case "adapted_chapters":
      return `章节：${String(after.title ?? before.title ?? "?")}`;
    case "timelines":
      return "预览时间线";
    default:
      return `${e.tableName}${e.rowId ? `:${e.rowId.slice(0, 6)}` : ""}`;
  }
}

/** 变更字段摘要（before→after） */
function diffPreview(e: StagedEntry): Array<{ label: string; before: string; after: string }> {
  if (e.op === "delete") return [{ label: "将被删除", before: "", after: "" }];
  if (e.op === "insert") return [{ label: "将新增", before: "", after: "" }];
  const before = e.before ?? {};
  const after = e.after ?? {};
  const fields: Array<[string, (r: Record<string, unknown>) => string]> = [
    ["台词", (r) => String(r.text ?? "")],
    ["情绪", (r) => String(r.emotion ?? "")],
    ["机位", (r) => String(r.camera ?? "")],
    ["时长", (r) => String(r.duration_sec ?? "")],
    ["入场", (r) => String(r.enter_animation ?? "")],
    ["标题", (r) => String(r.title ?? "")],
  ];
  const out: Array<{ label: string; before: string; after: string }> = [];
  for (const [label, pick] of fields) {
    const b = pick(before);
    const a = pick(after);
    if (b !== a) out.push({ label, before: b, after: a });
  }
  return out.length > 0 ? out : [{ label: "字段变更", before: "", after: "" }];
}

export function StagedReviewPanel({
  bookId,
  jobId,
  nodeLabel,
  onApplied,
  onDiscarded,
  className = "",
}: StagedReviewPanelProps) {
  const [entries, setEntries] = useState<StagedEntry[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "accepted" | "rejected">>({});
  const [cursor, setCursor] = useState(0);
  const [applying, setApplying] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/staged?jobId=${jobId}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setEntries(json.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId, jobId]);

  useEffect(() => {
    // 挂载/任务完成后拉取变更清单；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, StagedEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.groupKey) ?? [];
      arr.push(e);
      map.set(e.groupKey, arr);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [entries]);

  const pageSize = 4;
  const page = Math.floor(cursor / pageSize);
  const pageGroups = groups.slice(page * pageSize, page * pageSize + pageSize);
  const decided = Object.keys(decisions).length;
  const accepted = Object.values(decisions).filter((d) => d === "accepted").length;
  const rejected = decided - accepted;

  const decide = useCallback((id: string, decision: "accepted" | "rejected") => {
    setDecisions((prev) => ({ ...prev, [id]: decision }));
  }, []);

  const undoLast = useCallback(() => {
    setDecisions((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      const next = { ...prev };
      delete next[ids[ids.length - 1]];
      return next;
    });
  }, []);

  const apply = useCallback(
    async (all: boolean) => {
      setApplying(true);
      setError(null);
      try {
        const finalDecisions = all
          ? Object.fromEntries(entries.map((e) => [e.id, "accepted"]))
          : decisions;
        if (Object.keys(finalDecisions).length === 0) {
          setError("还没有任何决策：请逐条 a/r，或使用「全部接受」");
          return;
        }
        const res = await fetch(`/api/books/${bookId}/staged/${jobId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions: finalDecisions }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "应用失败");
        onApplied?.(json as { applied: number; rejected: number });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setApplying(false);
      }
    },
    [bookId, jobId, entries, decisions, onApplied],
  );

  const discard = useCallback(async () => {
    try {
      await fetch(`/api/books/${bookId}/staged/${jobId}`, { method: "DELETE" });
      onDiscarded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId, jobId, onDiscarded]);

  // 键盘审阅：j/k 移动 · a/r 决策 · u 撤销 · Enter 应用
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (ev.key === "j" || ev.key === "ArrowDown") {
        ev.preventDefault();
        setCursor((c) => Math.min(entries.length - 1, c + 1));
      } else if (ev.key === "k" || ev.key === "ArrowUp") {
        ev.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (ev.key === "a") {
        const e = entries[cursor];
        if (e) decide(e.id, "accepted");
      } else if (ev.key === "r") {
        const e = entries[cursor];
        if (e) decide(e.id, "rejected");
      } else if (ev.key === "u") {
        undoLast();
      } else if (ev.key === "Enter") {
        if (decided > 0) void apply(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries, cursor, decide, undoLast, apply, decided]);

  // 滚动跟随光标（jsdom 无 scrollIntoView，加兜底）
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${entries[cursor]?.id}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, entries]);

  if (entries.length === 0) {
    return error ? (
      <p role="alert" className="text-sm text-stale">{error}</p>
    ) : null;
  }

  return (
    <section
      className={`rounded-xl border border-review/40 bg-surface p-4 ${className}`}
      aria-label="变更审阅"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-review">
          {nodeLabel ?? "AI 变更审阅"} · {entries.length} 处变更 · 已决策 {decided}（接受 {accepted} / 驳回 {rejected}）
        </h2>
        <span className="text-xs text-text-subtle">键位：j/k 移动 · a 接受 · r 驳回 · u 撤销 · Enter 应用</span>
      </header>

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-stale/40 bg-stale/10 px-3 py-2 text-sm text-stale">
          {error}
        </p>
      )}

      {/* 变更列表（每屏 ≤4 组） */}
      <div ref={listRef} role="list" aria-live="polite" className="mt-3 space-y-3">
        {pageGroups.map((group) => (
          <div key={group.key} role="listitem" className="space-y-1.5">
            <p className="text-xs font-semibold text-text-muted">{group.key}</p>
            {group.items.map((e) => {
              const decision = decisions[e.id];
              const selected = e.id === entries[cursor]?.id;
              return (
                <div
                  key={e.id}
                  data-entry-id={e.id}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors duration-fast ${
                    selected ? "border-review/60 bg-review/5" : "border-border bg-surface-2"
                  } ${decision === "accepted" ? "opacity-70" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${OP_STYLE[e.op]}`}>
                      {OP_LABEL[e.op]}
                    </span>
                    <p className="min-w-0 flex-1 truncate font-medium text-text">{entryTitle(e)}</p>
                    <span className="shrink-0 tabular-nums text-text-subtle">
                      {decision === "accepted" ? "✓ 接受" : decision === "rejected" ? "✗ 驳回" : "待定"}
                    </span>
                  </div>
                  {diffPreview(e).map((d, i) =>
                    d.before || d.after ? (
                      <div key={i} className="mt-1 grid grid-cols-[3rem_1fr_1fr] gap-2 text-text-muted">
                        <span className="text-text-subtle">{d.label}</span>
                        {e.op === "update" ? (
                          <>
                            <span className="line-through decoration-stale/60">{d.before || "—"}</span>
                            <span className="text-approved">{d.after || "—"}</span>
                          </>
                        ) : (
                          <span className="col-span-2">{d.after || d.before || "—"}</span>
                        )}
                      </div>
                    ) : null,
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {groups.length > pageSize && (
          <p className="text-center text-xs text-text-subtle">
            第 {page + 1}/{Math.ceil(groups.length / pageSize)} 页 · 用 j/k 滚动
          </p>
        )}
      </div>

      {/* 吸底常驻操作区 */}
      <footer className="sticky bottom-0 -mx-1 mt-3 flex items-center gap-2 rounded-lg bg-surface px-1 py-2">
        <Button size="sm" onClick={() => void apply(false)} disabled={applying || decided === 0} loading={applying}>
          应用已选（{decided}）
        </Button>
        {confirmAll ? (
          <span className="flex items-center gap-2 text-xs text-regen">
            全部接受将覆盖 {entries.length} 处？
            <Button size="sm" variant="danger" onClick={() => void apply(true)} disabled={applying}>
              确认
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmAll(false)}>
              取消
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirmAll(true)} disabled={applying}>
            全部接受
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void discard()} disabled={applying}>
          放弃本次
        </Button>
      </footer>
    </section>
  );
}
