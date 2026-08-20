import { NextResponse } from "next/server";
import { getLatestScript } from "@/lib/pipeline/nodes/adapt";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/script">,
) {
  const { bookId } = await ctx.params;
  try {
    const script = await getLatestScript(bookId);
    return NextResponse.json(script);
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

