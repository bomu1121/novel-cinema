import { NextResponse } from "next/server";
import { listVoiceTakes } from "@/lib/pipeline/nodes/voice";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/voice">,
) {
  const { bookId } = await ctx.params;
  try {
    const data = await listVoiceTakes(bookId);
    return NextResponse.json(data);
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

