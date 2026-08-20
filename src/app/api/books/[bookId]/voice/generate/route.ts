import { NextResponse } from "next/server";
import { generateVoiceTakes } from "@/lib/pipeline/nodes/voice";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/voice/generate">,
) {
  const { bookId } = await ctx.params;
  try {
    const result = await generateVoiceTakes(bookId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
