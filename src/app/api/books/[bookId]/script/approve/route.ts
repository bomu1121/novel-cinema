import { NextResponse } from "next/server";
import { approveAdaptedChapter } from "@/lib/pipeline/nodes/adapt";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { adaptedChapterId: string };
    if (!body.adaptedChapterId) {
      return NextResponse.json({ error: "缺少 adaptedChapterId" }, { status: 400 });
    }
    await approveAdaptedChapter(body.adaptedChapterId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

