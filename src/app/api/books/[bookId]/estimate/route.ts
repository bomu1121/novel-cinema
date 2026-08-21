import { NextResponse } from "next/server";
import { estimateNode } from "@/lib/pipeline/graph";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bookId: string }> };

const VALID_NODES = new Set(["analyze", "adapt", "assets-phase1", "assets-phase2", "storyboard", "voice"]);

export async function GET(request: Request, ctx: Ctx) {
  const { bookId } = await ctx.params;
  const node = new URL(request.url).searchParams.get("node");
  if (!node || !VALID_NODES.has(node)) {
    return NextResponse.json({ error: `未知节点: ${node}` }, { status: 400 });
  }
  try {
    const estimate = await estimateNode(bookId, node as Parameters<typeof estimateNode>[1]);
    return NextResponse.json(estimate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
