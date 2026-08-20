import { NextResponse } from "next/server";
import { generateAssetPhase } from "@/lib/pipeline/nodes/assets";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/assets/generate">,
) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json()) as { phase?: string };
    const phase = body.phase === "phase2" ? "phase2" : "phase1";
    const result = await generateAssetPhase(bookId, phase);
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

