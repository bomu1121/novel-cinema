import { NextResponse } from "next/server";
import { undoLatest } from "@/lib/pipeline/nodes/workbench";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/workbench/undo">,
) {
  const { bookId } = await ctx.params;
  try {
    const result = await undoLatest(bookId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message =
      (err as { message?: string })?.message ??
      (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
