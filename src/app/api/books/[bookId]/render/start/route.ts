import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

/**
 * 后台启动全片渲染（本地 FFmpeg）。
 * render-local 脚本会自己写 render_jobs（running/succeeded/failed），前端轮询渲染页 API。
 * shell:true 是 Windows 解析 npx.cmd 所必需（此前 spawn("npx") 在 Windows 上 ENOENT，渲染按钮静默失效）。
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/render/start">,
) {
  const { bookId } = await ctx.params;
  try {
    const child = spawn("npx tsx scripts/render-local.ts --book " + bookId, {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      shell: true,
    });
    child.on("error", (err) => {
      console.error("[render] 渲染进程启动失败:", err.message);
    });
    child.unref();
    return NextResponse.json({ ok: true, message: "渲染已在后台开始" });
  } catch (err) {
    const message =
      (err as { message?: string })?.message ??
      (err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
