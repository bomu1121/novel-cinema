import { NextResponse } from "next/server";
import { updateBeat } from "@/lib/pipeline/nodes/adapt";

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/beats/[beatId]">,
) {
  const { beatId } = await ctx.params;
  try {
    const body = (await request.json()) as {
      text?: string;
      emotion?: string;
      pace?: number;
      visual_note?: string;
    };

    const patch: Record<string, unknown> = {};
    if (typeof body.text === "string" && body.text.trim()) patch.text = body.text.trim();
    if (typeof body.emotion === "string") patch.emotion = body.emotion;
    if (typeof body.pace === "number" && body.pace >= 0.8 && body.pace <= 1.3) patch.pace = body.pace;
    if (typeof body.visual_note === "string" && body.visual_note.trim()) patch.visual_note = body.visual_note.trim();
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
    }

    await updateBeat(beatId, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
