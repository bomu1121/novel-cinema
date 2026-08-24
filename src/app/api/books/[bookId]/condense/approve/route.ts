import { NextResponse } from "next/server";
import { approveCondensed } from "@/lib/pipeline/nodes/condense";

type Ctx = { params: Promise<{ bookId: string }> };

/** 签核精简底稿：批准后 adapt 节点优先以它作为改编输入 */
export async function POST(request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    if (!body.id) {
      return NextResponse.json({ error: "缺少精简稿 id" }, { status: 400 });
    }
    await approveCondensed(bookId, body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
