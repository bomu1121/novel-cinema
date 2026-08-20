import { NextResponse } from "next/server";
import { getWorkbench } from "@/lib/pipeline/nodes/workbench";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/workbench">,
) {
  const { bookId } = await ctx.params;
  try {
    const data = await getWorkbench(bookId);
    return NextResponse.json(data);
  } catch (err) {
    const message =
      (err as { message?: string })?.message ??
      (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
