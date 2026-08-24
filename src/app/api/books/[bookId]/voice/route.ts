import { NextResponse } from "next/server";
import { listVoiceTakes } from "@/lib/pipeline/nodes/voice";
import { estimateNode } from "@/lib/pipeline/graph";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/voice">,
) {
  const { bookId } = await ctx.params;
  try {
    const [data, voiceEstimate] = await Promise.all([
      listVoiceTakes(bookId),
      estimateNode(bookId, "voice").catch(() => null),
    ]);
    return NextResponse.json({ ...data, voiceBlockers: voiceEstimate?.blockers ?? [] });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

