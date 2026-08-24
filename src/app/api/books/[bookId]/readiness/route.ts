import { NextResponse } from "next/server";
import { getBookReadiness } from "@/lib/pipeline/readiness";

type Ctx = { params: Promise<{ bookId: string }> };

/** 书级就绪摘要：书首页签核入口的状态灯 / 阻塞原因 */
export async function GET(_request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  try {
    return NextResponse.json(await getBookReadiness(bookId));
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
