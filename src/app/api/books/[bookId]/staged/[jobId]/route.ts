import { NextResponse } from "next/server";
import { applyStaged, discardStaged } from "@/lib/staging";

type Ctx = { params: Promise<{ bookId: string; jobId: string }> };

/** 应用审阅决策：{ decisions: { [entryId]: "accepted" | "rejected" } } */
export async function POST(request: Request, ctx: Ctx) {
  const { bookId, jobId } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      decisions?: Record<string, "accepted" | "rejected">;
    };
    const result = applyStaged(bookId, jobId, body.decisions ?? {});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 放弃本次审阅（丢弃全部 staged 条目，不改任何数据） */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { bookId, jobId } = await ctx.params;
  try {
    const dropped = discardStaged(bookId, jobId);
    return NextResponse.json({ ok: true, dropped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
