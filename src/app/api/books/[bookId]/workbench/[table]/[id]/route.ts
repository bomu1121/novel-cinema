import { NextResponse } from "next/server";
import { patchWorkbenchRow } from "@/lib/pipeline/nodes/workbench";

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/workbench/[table]/[id]">,
) {
  const { bookId, table, id } = await ctx.params;
  try {
    const body = (await request.json()) as { patch?: Record<string, unknown> };
    if (!body.patch || typeof body.patch !== "object") {
      return NextResponse.json({ error: "需要 patch 对象" }, { status: 400 });
    }
    await patchWorkbenchRow(bookId, table, id, body.patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      (err as { message?: string })?.message ??
      (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
