import { NextResponse } from "next/server";
import { downstreamImpact } from "@/lib/pipeline/graph";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string }> };

/** stale 溯源：某行变更会波及哪些下游（docs/06 §4.2） */
export async function GET(request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  const rowId = url.searchParams.get("rowId");
  if (!table || !rowId) {
    return NextResponse.json({ error: "需要 table 与 rowId 参数" }, { status: 400 });
  }
  try {
    const impacts = await downstreamImpact(bookId, table, rowId);
    return NextResponse.json({ impacts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
