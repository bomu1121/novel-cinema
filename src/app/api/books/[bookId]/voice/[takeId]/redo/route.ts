import { NextResponse } from "next/server";
import { regenerateTake } from "@/lib/pipeline/nodes/voice";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/voice/[takeId]/redo">,
) {
  const { bookId, takeId } = await ctx.params;
  try {
    await regenerateTake(bookId, takeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

