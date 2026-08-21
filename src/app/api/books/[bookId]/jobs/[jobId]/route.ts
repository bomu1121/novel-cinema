import { NextResponse } from "next/server";
import { eventsAfter, getJob } from "@/lib/jobs/progress";

/** 任务快照 + 自 seq 起的事件（轮询降级与初始恢复用） */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string; jobId: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { bookId, jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job || job.bookId !== bookId) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const afterSeq = Number(new URL(request.url).searchParams.get("after") ?? 0);
  return NextResponse.json({ job, events: eventsAfter(jobId, Number.isFinite(afterSeq) ? afterSeq : 0) });
}
