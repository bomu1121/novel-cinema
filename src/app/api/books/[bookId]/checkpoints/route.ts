import { NextResponse } from "next/server";
import { listCheckpoints } from "@/lib/checkpoints";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  try {
    return NextResponse.json({ checkpoints: listCheckpoints(bookId) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
