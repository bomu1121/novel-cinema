"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CheckpointInfo } from "@/lib/checkpoints";

/**
 * 时间机器（docs/06 §6.3 TimeMachine）：多级回滚到任意签核点/检查点。
 * 撤销不再只是"上一步"——任何批准、重跑、审阅应用都留下 checkpoint。
 */

export interface TimeMachineProps {
  bookId: string;
  className?: string;
}

const ORIGIN_LABEL: Record<string, string> = {
  "approve": "签核",
  "node-rerun": "重跑",
  "manual-edit": "手动编辑",
};

export function TimeMachine({ bookId, className = "" }: TimeMachineProps) {
  const [items, setItems] = useState<CheckpointInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/checkpoints`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setItems(json.checkpoints ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载后拉取检查点；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const revert = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/books/${bookId}/checkpoints/${id}/revert`, { method: "POST" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "回滚失败");
        await load();
        window.dispatchEvent(new CustomEvent("novel-cinema:data-changed"));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [bookId, load],
  );

  if (items.length === 0) return null;

  return (
    <section className={`rounded-xl border border-border p-4 ${className}`} aria-label="时间机器">
      <h2 className="text-sm font-semibold">时间机器（{items.length} 个检查点）</h2>
      {error && (
        <p role="alert" className="mt-2 text-xs text-stale">
          {error}
        </p>
      )}
      <ul className="mt-2 space-y-1.5">
        {items.map((cp) => (
          <li key={cp.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-text">
                <span className="mr-1.5 rounded bg-border/60 px-1 py-0.5 text-[10px] text-text-muted">
                  {ORIGIN_LABEL[cp.origin] ?? cp.origin}
                </span>
                {cp.label}
              </p>
              <p className="text-text-subtle">
                {new Date(cp.createdAt).toLocaleString()} · {cp.rowCount} 处快照
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void revert(cp.id)} disabled={busyId !== null} loading={busyId === cp.id}>
              回滚到此
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-text-subtle">
        回滚会恢复该检查点覆盖的全部数据（含整章 beats / 分镜 / 配音状态），并可在撤销后继续向前。
      </p>
    </section>
  );
}
