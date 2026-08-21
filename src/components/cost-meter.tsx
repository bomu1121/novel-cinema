"use client";

import { useCallback, useEffect, useState } from "react";
import type { CostSummary } from "@/lib/cost";

/**
 * 成本仪表盘（docs/06 §6.2 CostMeter）：今日 / 本书 调用次数与 tokens。
 * 与 scripts/cost-report.ts 同口径（价格表 M1 接入后补 ¥）。
 */
export interface CostMeterProps {
  bookId: string;
  className?: string;
}

export function CostMeter({ bookId, className = "" }: CostMeterProps) {
  const [today, setToday] = useState<CostSummary | null>(null);
  const [all, setAll] = useState<CostSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/cost`);
      const json = await res.json();
      setToday(json.today);
      setAll(json.all);
    } catch {
      /* 静默：仪表盘失败不阻断页面 */
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载后拉取成本；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const row = (label: string, c: CostSummary | null) =>
    c && c.calls > 0
      ? `${label} ${c.calls} 次 · 入 ${c.inputTokens.toLocaleString()} / 出 ${c.outputTokens.toLocaleString()} tok`
      : `${label} 暂无调用`;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted ${className}`}
      aria-label="成本概览"
    >
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        {row("今日", today)}
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-approved" />
        {row("本书", all)}
      </span>
    </div>
  );
}
