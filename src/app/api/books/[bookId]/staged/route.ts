import { NextResponse } from "next/server";
import { listStaged, stagedSummary } from "@/lib/staging";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string }> };

/** 待审变更：摘要（按 job 分组）+ 条目列表（可按 jobId 过滤） */
export async function GET(request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  const jobId = new URL(request.url).searchParams.get("jobId");
  try {
    return NextResponse.json({
      groups: stagedSummary(bookId),
      entries: listStaged(bookId, jobId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
