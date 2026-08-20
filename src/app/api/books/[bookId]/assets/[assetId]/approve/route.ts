import { NextResponse } from "next/server";
import { approveAsset } from "@/lib/pipeline/nodes/assets";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/assets/[assetId]/approve">,
) {
  const { bookId, assetId } = await ctx.params;
  try {
    await approveAsset(bookId, assetId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

