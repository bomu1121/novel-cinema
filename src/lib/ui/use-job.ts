"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobEvent, JobPhase } from "@/lib/jobs/types";

/**
 * 任务订阅（docs/06 §6.2）：SSE（Last-Event-ID 断线重放）→ 轮询降级。
 * 页面挂载时若传入 jobId，立即接回（恢复刷新前的进度）。
 */

export interface UseJobState {
  jobId: string | null;
  status: "idle" | JobPhase;
  progress: number;
  step: string | null;
  stepIndex: number;
  stepTotal: number;
  logs: string[];
  error: string | null;
  elapsedMs: number;
  /** 最近一次收到服务端事件的时间戳（用于停滞检测） */
  lastEventAt: number | null;
  /** 入队时预估耗时（毫秒），用于任务收据 */
  estimatedMs: number | null;
}

interface PolledJob {
  job: {
    status: JobPhase;
    progress: number;
    step: string | null;
    step_index: number;
    step_total: number;
    error: string | null;
  };
  events: JobEvent[];
}

const IDLE: UseJobState = {
  jobId: null,
  status: "idle",
  progress: 0,
  step: null,
  stepIndex: 0,
  stepTotal: 0,
  logs: [],
  error: null,
  elapsedMs: 0,
  lastEventAt: null,
  estimatedMs: null,
};

function applyEvent(state: UseJobState, e: JobEvent): UseJobState {
  const next = { ...state, lastEventAt: Date.now() };
  const p = e.payload as { label?: string; index?: number; total?: number; value?: number; line?: string; message?: string; cancelled?: boolean };
  switch (e.kind) {
    case "step":
      return { ...next, step: p.label ?? state.step, stepIndex: p.index ?? state.stepIndex, stepTotal: p.total ?? state.stepTotal };
    case "progress":
      return { ...next, progress: typeof p.value === "number" ? p.value : state.progress };
    case "log":
      return { ...next, logs: [...state.logs.slice(-49), p.line ?? ""] };
    case "error":
      return {
        ...next,
        status: p.cancelled ? "cancelled" : "failed",
        error: p.message ?? state.error,
      };
    case "done":
      return { ...next, status: "succeeded", progress: 1 };
    default:
      return next;
  }
}

export function useJob(bookId: string, jobId: string | null): UseJobState & { cancel: () => void } {
  const [state, setState] = useState<UseJobState>(IDLE);
  const startedAtRef = useRef<number | null>(null);
  const lastSeqRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  // 计时器：任务进入终态后停止，避免“已完成”旁边的时间继续跳动
  useEffect(() => {
    if (!jobId) {
      startedAtRef.current = null;
      // jobId 清空（任务收尾/切换）时同步复位，属外部订阅驱动的状态归零
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(IDLE);
      return;
    }
    startedAtRef.current ??= Date.now();
    if (state.status === "succeeded" || state.status === "failed" || state.status === "cancelled") {
      return;
    }
    const timer = setInterval(() => {
      if (startedAtRef.current != null) {
        setState((s) => (s.jobId === jobId ? { ...s, elapsedMs: Date.now() - startedAtRef.current! } : s));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [jobId, state.status]);

  const applyEvents = useCallback((events: JobEvent[], terminalStatus?: JobPhase) => {
    setState((prev) => {
      let next = { ...prev, jobId, status: (terminalStatus ?? prev.status) as UseJobState["status"] };
      for (const e of events) {
        if (e.seq <= lastSeqRef.current) continue;
        lastSeqRef.current = e.seq;
        next = applyEvent(next, e);
      }
      return next;
    });
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollFallback = false;
    let attempts = 0;

    // 初始恢复：先拉一次快照（接回刷新前进度）
    fetch(`/api/books/${bookId}/jobs/${jobId}`)
      .then((r) => r.json())
      .then((data: PolledJob) => {
        if (cancelled) return;
        lastSeqRef.current = 0;
        const snap = data.job;
        applyEvents(data.events, snap.status);
        const estimate = (data.job as unknown as { inputRef?: { _estimate?: { estSeconds?: [number, number] } } })
          .inputRef?._estimate?.estSeconds;
        setState((s) =>
          s.jobId === jobId
            ? { ...s, estimatedMs: Array.isArray(estimate) ? (estimate[1] ?? estimate[0]) * 1000 : null }
            : s,
        );
        startedAtRef.current = Date.now();
      })
      .catch(() => {
        pollFallback = true;
      })
      .finally(() => {
        if (cancelled) return;
        if (pollFallback || typeof EventSource === "undefined") {
          // 轮询降级
          pollTimer = setInterval(async () => {
            try {
              const res = await fetch(`/api/books/${bookId}/jobs/${jobId}?after=${lastSeqRef.current}`);
              const data = (await res.json()) as PolledJob;
              applyEvents(data.events, data.job.status);
            } catch {
              /* 网络抖动，下轮重试 */
            }
          }, 2000);
          return;
        }
        const es = new EventSource(`/api/books/${bookId}/jobs/${jobId}/stream`);
        esRef.current = es;
        es.onmessage = (ev) => {
          const e = JSON.parse(ev.data) as JobEvent;
          applyEvents([e]);
          if (typeof ev.lastEventId === "string" && ev.lastEventId) {
            lastSeqRef.current = Math.max(lastSeqRef.current, Number(ev.lastEventId));
          }
        };
        es.onerror = () => {
          attempts += 1;
          if (attempts >= 5) {
            // SSE 连续失败 → 切换轮询
            es.close();
            esRef.current = null;
            pollFallback = true;
            pollTimer = setInterval(async () => {
              try {
                const res = await fetch(`/api/books/${bookId}/jobs/${jobId}?after=${lastSeqRef.current}`);
                const data = (await res.json()) as PolledJob;
                applyEvents(data.events, data.job.status);
              } catch {
                /* 网络抖动 */
              }
            }, 2000);
          }
        };
      });

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [bookId, jobId, applyEvents]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await fetch(`/api/books/${bookId}/jobs/${jobId}/cancel`, { method: "POST" });
    } catch {
      /* 取消失败由服务端状态兜底 */
    }
  }, [bookId, jobId]);

  return { ...state, cancel };
}
