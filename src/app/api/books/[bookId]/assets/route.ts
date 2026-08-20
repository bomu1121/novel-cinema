import { NextResponse } from "next/server";
import { listAssetPlan, listAssetsWithUrls } from "@/lib/pipeline/nodes/assets";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/assets">,
) {
  const { bookId } = await ctx.params;
  try {
    const [assets, plan] = await Promise.all([
      listAssetsWithUrls(bookId),
      listAssetPlan(bookId).catch((err) => ({
        error: (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err)),
      })),
    ]);
    return NextResponse.json({ assets, plan });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

