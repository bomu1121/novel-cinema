import { NextResponse } from "next/server";
import { approveStoryboard } from "@/lib/pipeline/nodes/storyboard";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/storyboard/approve">,
) {
  const { bookId } = await ctx.params;
  try {
    await approveStoryboard(bookId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

