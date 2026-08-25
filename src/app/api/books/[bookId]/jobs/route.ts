import { NextResponse } from "next/server";
import { appendEvent, createJobRow, sweepOrphanJobs, activeJobs } from "@/lib/jobs/progress";
import { spawnWorker } from "@/lib/jobs/worker";
import { estimateNode, type GraphNode } from "@/lib/pipeline/graph";

const VALID_NODES = new Set(["analyze", "bible.propose", "condense", "adapt", "assets-phase1", "assets-phase2", "storyboard", "voice"]);

type Ctx = { params: Promise<{ bookId: string }> };

/** 入队一个 AI 任务（立即返回 jobId，worker 子进程后台执行） */
export async function POST(request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { node?: string; input?: Record<string, unknown> };
  if (!body.node || !VALID_NODES.has(body.node)) {
    return NextResponse.json({ error: `未知节点: ${body.node}` }, { status: 400 });
  }
  sweepOrphanJobs();
  const estimate = await estimateNode(bookId, body.node as GraphNode).catch(() => null);
  if (estimate && estimate.blockers.length > 0) {
    return NextResponse.json(
      { error: `前置条件未满足：${estimate.blockers.join("；")}`, blockers: estimate.blockers },
      { status: 409 },
    );
  }
  const input = {
    ...(body.input ?? {}),
    ...(estimate ? { _estimate: { estSeconds: estimate.estSeconds, gate: estimate.gate } } : {}),
  };
  const jobId = createJobRow(bookId, body.node, input);
  appendEvent(jobId, "step", { label: "排队中", index: 0, total: 0 });
  spawnWorker(jobId);
  return NextResponse.json({ ok: true, jobId });
}

/** 本书 active 任务（刷新页面后恢复进度条用） */
export async function GET(_request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  sweepOrphanJobs();
  return NextResponse.json({ jobs: activeJobs(bookId) });
}
