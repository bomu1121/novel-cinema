import { NextResponse } from "next/server";
import { listOpenReviewTasks } from "@/lib/review";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  try {
    const tasks = await listOpenReviewTasks(bookId);
    return NextResponse.json({ tasks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
