import { NextResponse } from "next/server";
import { renderShotPreview } from "@/lib/render/preview";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/preview/shot">,
) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json()) as { shotId?: string };
    if (!body.shotId) {
      return NextResponse.json({ error: "缺少 shotId" }, { status: 400 });
    }
    const result = await renderShotPreview(bookId, body.shotId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message =
      (err as { message?: string })?.message ??
      (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
