"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * stale 溯源（docs/06 §4.2 / StatusBadge「影响 N」接线）：
 * 状态为 stale 时查询下游影响数，点击展开明细。
 */

export interface ImpactPillProps {
  bookId: string;
  table: string;
  rowId: string;
  status?: string | null;
  className?: string;
}

const TABLE_LABEL: Record<string, string> = {
  adapted_chapters: "改编脚本",
  shots: "镜头",
  timelines: "时间线",
  voice_takes: "配音句",
  render_jobs: "渲染任务",
};

export function ImpactPill({ bookId, table, rowId, status, className = "" }: ImpactPillProps) {
  const [impacts, setImpacts] = useState<Array<{ table: string; count: number }> | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/impact?table=${table}&rowId=${rowId}`);
      const json = await res.json();
      setImpacts(json.impacts ?? []);
    } catch {
      setImpacts([]);
    }
  }, [bookId, table, rowId]);

  useEffect(() => {
    if (status !== "stale") return;
    // 挂载后拉取影响面；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [status, load]);

  if (status !== "stale" || impacts === null) return null;
  const total = impacts.reduce((s, i) => s + i.count, 0);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-stale/40 bg-stale/10 px-1.5 py-0.5 text-[10px] font-medium text-stale hover:bg-stale/20"
        aria-expanded={open}
        aria-label="查看过期影响范围"
      >
        影响 {total}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 min-w-40 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[10px] text-text-muted shadow-pop"
        >
          {total === 0 ? (
            "暂无已过期的下游"
          ) : (
            <>
              将使以下内容过期：
              {impacts.map((i) => (
                <span key={i.table} className="block">
                  {TABLE_LABEL[i.table] ?? i.table} × {i.count}
                </span>
              ))}
            </>
          )}
        </span>
      )}
    </span>
  );
}
