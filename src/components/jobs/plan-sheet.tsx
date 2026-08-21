"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GraphNode, NodeEstimate } from "@/lib/pipeline/graph";

/**
 * 预演卡（docs/06 §6.3 PlanSheet）：执行前把"将发生什么"讲清楚（设计律①）。
 * 四行：将生成 / 将覆盖（含手工修改高亮）/ 成本与耗时 / 可否撤销。
 */
export interface PlanSheetProps {
  bookId: string;
  node: GraphNode;
  onExecute: () => void;
  onCancel?: () => void;
  busy?: boolean;
  className?: string;
}

const NODE_LABEL: Record<GraphNode, string> = {
  analyze: "分析 + 风格候选",
  adapt: "改编脚本",
  "assets-phase1": "设定图 + 背景",
  "assets-phase2": "表情变体",
  storyboard: "分镜",
  voice: "配音",
  render: "渲染",
};

export function PlanSheet({ bookId, node, onExecute, onCancel, busy, className = "" }: PlanSheetProps) {
  const [estimate, setEstimate] = useState<NodeEstimate | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/estimate?node=${node}`);
      const json = await res.json();
      if (!json.error) setEstimate(json);
    } catch {
      /* 预演失败不阻断确认卡 */
    }
  }, [bookId, node]);

  useEffect(() => {
    // 挂载后拉取预演数据；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const e = estimate;
  const calls = [
    e && e.llmCalls > 0 ? `${e.llmCalls} 次 LLM` : null,
    e && e.imageCalls > 0 ? `${e.imageCalls} 张图` : null,
    e && e.ttsCalls > 0 ? `${e.ttsCalls} 句 TTS` : null,
  ].filter(Boolean);
  const overwriteTotal = e?.overwrites.reduce((s, o) => s + o.count, 0) ?? 0;

  return (
    <div className={`rounded-xl border border-review/40 bg-review/10 p-4 text-xs ${className}`}>
      <p className="font-semibold text-review">确认执行「{NODE_LABEL[node]}」？</p>

      {e && (
        <dl className="mt-2 space-y-1 text-text-muted">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-text-subtle">将生成</dt>
            <dd>{calls.join(" · ") || "零 AI 成本"} · 约 {e.estSeconds[0]}~{e.estSeconds[1]}s</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-text-subtle">将覆盖</dt>
            <dd>
              {overwriteTotal > 0
                ? e.overwrites.map((o) => `${o.table} ${o.count} 行`).join("、")
                : "不覆盖现有数据"}
              {e.staged && <span className="ml-1 text-review">（先审阅后应用）</span>}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-text-subtle">可否撤销</dt>
            <dd>
              {e.reversible ? (
                <span className="text-approved">可（检查点/审阅）</span>
              ) : (
                <span className="text-regen">不可（只增不改）</span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {e && e.blockers.length > 0 && (
        <p className="mt-2 text-stale" role="alert">
          前置条件未满足：{e.blockers.join("；")}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onExecute} disabled={busy || (e?.blockers.length ?? 0) > 0} loading={busy}>
          执行
        </Button>
        {onCancel && (
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            取消
          </Button>
        )}
      </div>
    </div>
  );
}
