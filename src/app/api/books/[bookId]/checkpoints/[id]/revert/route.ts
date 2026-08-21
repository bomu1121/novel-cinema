import { NextResponse } from "next/server";
import { revertCheckpoint } from "@/lib/checkpoints";

type Ctx = { params: Promise<{ bookId: string; id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { bookId, id } = await ctx.params;
  try {
    const result = revertCheckpoint(bookId, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
