import { NextResponse } from "next/server";
import { costSummary } from "@/lib/cost";

/** 成本仪表盘数据（docs/06 §6.2 CostMeter）：今日 / 本书，与 cost-report.ts 同口径 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  return NextResponse.json({
    today: costSummary(bookId, true),
    all: costSummary(bookId, false),
  });
}
