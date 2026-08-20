import { NextResponse } from "next/server";
import { buildStoryboard } from "@/lib/pipeline/nodes/storyboard";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/storyboard/build">,
) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { adaptedChapterId?: string };
    const result = await buildStoryboard(bookId, body.adaptedChapterId);
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

