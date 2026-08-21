import { NextResponse } from "next/server";
import { getJob, setCancelRequested } from "@/lib/jobs/progress";

/** 协作式取消：置 cancel_requested，worker 在安全点中止 */
type Ctx = { params: Promise<{ bookId: string; jobId: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { bookId, jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job || job.bookId !== bookId) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  setCancelRequested(jobId);
  return NextResponse.json({ ok: true });
}
