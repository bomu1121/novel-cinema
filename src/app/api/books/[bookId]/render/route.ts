import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db";
import { r2SignedUrl } from "@/lib/r2";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/render">,
) {
  const { bookId } = await ctx.params;
  try {
    const supabase = getSupabaseAdmin();

    const [timelineRes, jobsRes] = await Promise.all([
      supabase
        .from("timelines")
        .select("id, kind, version, status, duration_sec, created_at")
        .eq("book_id", bookId)
        .eq("kind", "preview")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("render_jobs")
        .select("id, scope, status, duration_sec, output_file_key, error, preset, created_at, finished_at")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const jobs = await Promise.all(
      ((jobsRes.data ?? []) as Array<{
        id: string;
        scope: string;
        status: string;
        duration_sec: number | null;
        output_file_key: string | null;
        error: unknown;
        preset: unknown;
        created_at: string;
        finished_at: string | null;
      }>).map(async (job) => {
        let url: string | null = null;
        if (job.output_file_key) {
          try {
            url = await r2SignedUrl(job.output_file_key, 3600);
          } catch {
            url = null;
          }
        }
        return { ...job, url };
      }),
    );

    return NextResponse.json({
      timeline: timelineRes.data ?? null,
      jobs,
      command: `npm run render:local -- --book ${bookId}`,
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

