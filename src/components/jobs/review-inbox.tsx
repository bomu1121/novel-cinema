"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * 待审收件箱（docs/06 §6.2 ReviewInbox）：AI 自检红项持久化在 review_tasks，
 * 异步任务完成后在此累加待决策项，不打断当前操作。
 */

interface InboxTask {
  id: string;
  kind: string;
  targetType: string;
  targetId: string;
  aiReport: {
    beat_idx?: number;
    kind?: string;
    issue?: string;
    suggestion?: string | null;
    severity?: string;
  };
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = {
  chapter_script: "改编脚本自检",
  bible: "全书档案",
  assets: "资产",
  storyboard: "分镜",
  voice: "配音",
  final: "成片",
};

export interface ReviewInboxProps {
  bookId: string;
  className?: string;
}

export function ReviewInbox({ bookId, className = "" }: ReviewInboxProps) {
  const [tasks, setTasks] = useState<InboxTask[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/review-tasks`);
      const json = await res.json();
      setTasks(json.tasks ?? []);
    } catch {
      /* 静默 */
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载后拉取收件箱；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const decide = useCallback(
    async (taskId: string, decision: string) => {
      try {
        await fetch(`/api/books/${bookId}/review-tasks/${taskId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        await load();
      } catch {
        /* 静默 */
      }
    },
    [bookId, load],
  );

  if (tasks.length === 0) return null;

  return (
    <section
      className={`rounded-xl border border-regen/40 bg-regen/10 p-4 ${className}`}
      aria-label="待审收件箱"
    >
      <h2 className="text-sm font-semibold text-regen">待审收件箱（{tasks.length}）</h2>
      <ul className="mt-2 space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text">
                  {KIND_LABEL[t.kind] ?? t.kind} · beat#{t.aiReport.beat_idx ?? "?"}
                  {t.aiReport.kind ? ` · ${t.aiReport.kind}` : ""}
                </p>
                <p className="mt-0.5 text-text-muted">{t.aiReport.issue}</p>
                {t.aiReport.suggestion && (
                  <p className="mt-0.5 text-text-subtle">建议：{t.aiReport.suggestion}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void decide(t.id, "skipped")}
              >
                已处理
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
