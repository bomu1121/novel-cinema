import { NextResponse } from "next/server";
import { approveStyleBible } from "@/lib/pipeline/nodes/analyze";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      styleBibleId: string;
      proposalIndex: number;
    };
    if (!body.styleBibleId || typeof body.proposalIndex !== "number") {
      return NextResponse.json(
        { error: "需要 styleBibleId 与 proposalIndex" },
        { status: 400 },
      );
    }

    const selected = await approveStyleBible(body.styleBibleId, body.proposalIndex);
    if (!selected) {
      return NextResponse.json({ error: "方案不存在" }, { status: 404 });
    }

    return NextResponse.json({ selected });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

