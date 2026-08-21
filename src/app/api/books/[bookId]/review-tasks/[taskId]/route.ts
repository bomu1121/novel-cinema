import { NextResponse } from "next/server";
import { decideReviewTask } from "@/lib/review";

type Ctx = { params: Promise<{ bookId: string; taskId: string }> };

export async function POST(
  request: Request,
  ctx: Ctx,
) {
  const { bookId, taskId } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { decision?: string };
    await decideReviewTask(bookId, taskId, body.decision ?? "skipped");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
