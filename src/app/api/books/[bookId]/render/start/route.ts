import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

/**
 * 后台启动全片渲染（本地 FFmpeg）。
 * render-local 脚本会自己写 render_jobs（running/succeeded/failed），前端轮询渲染页 API。
 * 不用 `npx ...` + shell:true：Windows 上 detached + cmd.exe 会弹出命令行窗口；
 * 直接用 node --import tsx 启动，既避免 .cmd 解析问题，也不会弹窗。
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/books/[bookId]/render/start">,
) {
  const { bookId } = await ctx.params;
  try {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/render-local.ts", "--book", bookId],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      },
    );
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
