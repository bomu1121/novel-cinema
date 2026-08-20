import { NextResponse } from "next/server";
import { updateShot } from "@/lib/pipeline/nodes/storyboard";

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/shots/[shotId]">,
) {
  const { shotId } = await ctx.params;
  try {
    const body = (await request.json()) as {
      durationSec?: number;
      backgroundAssetId?: string | null;
    };
    if (body.durationSec === undefined && body.backgroundAssetId === undefined) {
      return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
    }
    await updateShot(shotId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

