import { NextResponse } from "next/server";
import { rerunNode, type RerunNode } from "@/lib/pipeline/nodes/workbench";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/workbench/rerun">,
) {
  const { bookId } = await ctx.params;
  try {
    const body = (await request.json()) as { node?: string };
    const allowed: RerunNode[] = ["analyze", "adapt", "assets-phase1", "assets-phase2", "storyboard", "voice"];
    if (!body.node || !allowed.includes(body.node as RerunNode)) {
      return NextResponse.json({ error: `node 必须是 ${allowed.join("/")} 之一` }, { status: 400 });
    }
    const result = await rerunNode(bookId, body.node as RerunNode);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message =
      (err as { message?: string })?.message ??
      (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
