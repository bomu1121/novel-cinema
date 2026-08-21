import { NextResponse } from "next/server";
import { eventsAfter, getJob } from "@/lib/jobs/progress";

/**
 * SSE 任务事件流（docs/06 §4.1）。
 * - Last-Event-ID 从 job_events.seq 重放（断线恢复）
 * - 15s 心跳注释帧防代理断流
 * - 终态（succeeded/failed/cancelled）事件发完即关流
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string; jobId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { bookId, jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job || job.bookId !== bookId) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const rawLastId = Number(request.headers.get("last-event-id") ?? 0);
  const lastId = Number.isFinite(rawLastId) && rawLastId > 0 ? rawLastId : 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let cursor = lastId;

      const send = (seq: number, event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
          cursor = Math.max(cursor, seq);
        } catch {
          closed = true;
        }
      };

      const flush = (): boolean => {
        const events = eventsAfter(jobId, cursor);
        for (const e of events) {
          send(e.seq, e.kind, e.payload);
        }
        return events.length > 0;
      };

      const tick = () => {
        if (closed) return;
        flush();
        const snap = getJob(jobId);
        if (snap && (snap.status === "succeeded" || snap.status === "failed" || snap.status === "cancelled")) {
          flush(); // 兜底：终态事件可能晚于 status 落库
          if (!closed) {
            send(cursor + 1, "status", { status: snap.status, error: snap.error });
          }
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          clearInterval(pollTimer);
          clearInterval(heartbeatTimer);
        }
      };

      const pollTimer = setInterval(tick, 1000);
      const heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);
      tick();

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
