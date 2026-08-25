import { NextResponse } from "next/server";
import { restoreStyleProposal } from "@/lib/pipeline/nodes/analyze";

/** 恢复历史批次为当前候选（docs/14 §5）：零 AI 成本，内容取自 bible_proposals 归档 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/bible/restore">,
) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json()) as { proposalId: string };
    if (!body.proposalId) {
      return NextResponse.json({ error: "需要 proposalId" }, { status: 400 });
    }
    const result = await restoreStyleProposal(bookId, body.proposalId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
