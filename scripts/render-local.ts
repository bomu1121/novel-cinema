/**
 * 本地渲染：npm run render:local -- --spec <spec.json> [--out out.mp4]
 *           npm run render:local -- --book <bookId> [--out out.mp4]
 * 阶段：segments → concat → 混音 → 烧字幕 → 成品。
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildShotGraph, buildSrt } from "../src/lib/render/ffmpeg";
import type { RenderSpec, RenderVideoTrack } from "../src/lib/render/types";

interface CliArgs {
  specPath?: string;
  bookId?: string;
  out?: string;
  noBurn?: boolean;
  keepTmp?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--spec") args.specPath = argv[++i];
    else if (a === "--book") args.bookId = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--no-burn") args.noBurn = true;
    else if (a === "--keep-tmp") args.keepTmp = true;
  }
  return args;
}

function run(command: string, args: string[], label: string, cwd?: string): void {
  console.log(`\n[${label}] ${command} ${args.join(" ").slice(0, 400)}`);
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: false, cwd });
  if (result.status !== 0) {
    throw new Error(`${label} 失败，退出码 ${result.status ?? "null"}`);
  }
}

async function localize(url: string | null, dir: string, index: number, kind: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("file://")) {
    let local = decodeURIComponent(url.slice("file://".length));
    if (/^\/[A-Za-z]:/.test(local)) local = local.slice(1); // Windows: /D:/... → D:/...
    return local;
  }
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith("/")) return url;

  const ext = kind === "audio" ? ".mp3" : ".png";
  const target = join(dir, `${kind}_${index}${ext}`);
  if (url.startsWith("data:")) {
    const b64 = url.slice(url.indexOf("base64,") + "base64,".length);
    writeFileSync(target, Buffer.from(b64, "base64"));
    return target;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载媒体失败 HTTP ${res.status}: ${url.slice(0, 80)}`);
  writeFileSync(target, new Uint8Array(await res.arrayBuffer()));
  return target;
}

async function loadSpec(args: CliArgs): Promise<RenderSpec> {
  if (args.specPath) {
    return JSON.parse(readFileSync(resolve(args.specPath), "utf8")) as RenderSpec;
  }
  if (args.bookId) {
    const { buildRenderSpec } = await import("../src/lib/render/spec");
    return await buildRenderSpec(args.bookId);
  }
  throw new Error("需要 --spec <json> 或 --book <bookId>");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = await loadSpec(args);

  // --book 模式：记录 render_jobs（DB 未配置时仅告警，不阻断本地渲染）
  let renderJobId: string | null = null;
  if (args.bookId) {
    try {
      const { getSupabaseAdmin } = await import("../src/lib/db");
      const { data } = await getSupabaseAdmin()
        .from("render_jobs")
        .insert({
          book_id: args.bookId,
          scope: "preview",
          status: "running",
          preset: { crf: 20, preset: "veryfast", burnSubtitles: !args.noBurn },
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      renderJobId = data?.id ?? null;
    } catch (err) {
      console.warn("[render] 创建 render_jobs 失败（继续本地渲染）:", err);
    }
  }

  const [W, H] = spec.resolution;
  const fps = spec.fps;
  const tmpDir = await mkdtemp(join(tmpdir(), "novel-cinema-"));
  const segDir = join(tmpDir, "segments");
  mkdirSync(segDir, { recursive: true });

  const outPath = resolve(args.out ?? join(process.cwd(), "out", `${spec.bookId || "render"}.mp4`));
  mkdirSync(join(outPath, ".."), { recursive: true });

  try {
    // 1. 逐镜头渲染 segment
    const segments: string[] = [];
    for (let i = 0; i < spec.video_tracks.length; i++) {
      const track: RenderVideoTrack = {
        ...spec.video_tracks[i],
        background_url: await localize(spec.video_tracks[i].background_url, tmpDir, i, "bg"),
        layers: [],
      };
      for (let j = 0; j < spec.video_tracks[i].layers.length; j++) {
        const layer = spec.video_tracks[i].layers[j];
        track.layers.push({
          ...layer,
          asset_url: await localize(layer.asset_url, tmpDir, i * 10 + j, "layer"),
        });
      }

      const graph = buildShotGraph(track, { width: W, height: H, fps });
      const segPath = join(segDir, `seg_${String(i).padStart(4, "0")}.mp4`);
      const inputArgs: string[] = [];
      for (const input of graph.inputs) {
        if (input.type === "file") {
          inputArgs.push("-loop", "1", "-i", input.value);
        } else {
          inputArgs.push("-f", "lavfi", "-i", input.value);
        }
      }
      run(
        "ffmpeg",
        [
          "-y",
          ...inputArgs,
          "-filter_complex",
          graph.filterComplex,
          "-map",
          "[outv]",
          "-r",
          String(fps),
          "-t",
          graph.durationSec.toFixed(2),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-an",
          segPath,
        ],
        `shot ${i + 1}/${spec.video_tracks.length}`,
      );
      segments.push(segPath);
    }

    // 2. concat（同参数直拷）
    const listPath = join(tmpDir, "list.txt");
    writeFileSync(
      listPath,
      segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const concatPath = join(tmpDir, "concat.mp4");
    run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatPath], "concat");

    // 3. 音频：voice 轨 adelay + amix + LoudNorm
    const audioUrls: string[] = [];
    for (let i = 0; i < spec.audio_tracks.length; i++) {
      const local = await localize(spec.audio_tracks[i].url, tmpDir, i, "audio");
      if (local) audioUrls.push(local);
    }

    let videoPath = concatPath;
    let subtitlePath: string | null = null;
    if (spec.subtitle_track.length > 0) {
      subtitlePath = join(tmpDir, "subs.srt");
      writeFileSync(subtitlePath, buildSrt(spec.subtitle_track));
    }

    if (audioUrls.length > 0) {
      const mixPath = join(tmpDir, "mix.m4a");
      const filters: string[] = [];
      for (let i = 0; i < audioUrls.length; i++) {
        const delayMs = Math.round(spec.audio_tracks[i].start_sec * 1000);
        filters.push(`[${i}:a]adelay=${delayMs}|${delayMs},volume=${spec.audio_tracks[i].volume}[a${i}]`);
      }
      filters.push(
        `[${[...Array(audioUrls.length).keys()].map((i) => `a${i}`).join("")}]amix=inputs=${audioUrls.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`,
      );
      const audioArgs = ["-y"];
      for (const url of audioUrls) audioArgs.push("-i", url);
      audioArgs.push("-filter_complex", filters.join(";"), "-map", "[aout]", "-c:a", "aac", mixPath);
      run("ffmpeg", audioArgs, "混音");

      const muxPath = join(tmpDir, "mux.mp4");
      run(
        "ffmpeg",
        [
          "-y",
          "-i",
          concatPath,
          "-i",
          mixPath,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-shortest",
          muxPath,
        ],
        "音视频合并",
      );
      videoPath = muxPath;
    }

    // 4. 烧字幕
    if (subtitlePath && !args.noBurn) {
      const burnedPath = join(tmpDir, "burned.mp4");
      try {
        run(
          "ffmpeg",
          [
            "-y",
            "-i",
            videoPath,
            "-vf",
            "subtitles=subs.srt",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "copy",
            burnedPath,
          ],
          "烧字幕",
          tmpDir,
        );
        videoPath = burnedPath;
      } catch (err) {
        console.warn("烧字幕失败，保留 SRT 外挂：", err);
      }
    }

    // 5. 输出
    copyFileSync(videoPath, outPath);
    if (subtitlePath) {
      copyFileSync(subtitlePath, outPath.replace(/\.mp4$/i, ".srt"));
    }

    console.log(`\n渲染完成：${outPath}`);
    console.log(`镜头 ${segments.length} · 音频 ${audioUrls.length} 轨 · 时长 ${spec.duration_sec}s`);

    // 记录成功 + 成品入 R2（可选）
    if (renderJobId) {
      try {
        const [{ getSupabaseAdmin }, { r2Put }, { readFileSync: readFs }] = await Promise.all([
          import("../src/lib/db"),
          import("../src/lib/r2"),
          import("node:fs"),
        ]);
        let outputKey: string | null = null;
        try {
          outputKey = `book/${args.bookId}/render/${renderJobId}.mp4`;
          await r2Put(outputKey, readFs(outPath), "video/mp4");
        } catch (err) {
          console.warn("[render] R2 上传失败，仅保留本地文件:", err);
        }
        await getSupabaseAdmin()
          .from("render_jobs")
          .update({
            status: "succeeded",
            output_file_key: outputKey,
            duration_sec: spec.duration_sec,
            finished_at: new Date().toISOString(),
          })
          .eq("id", renderJobId);
      } catch (err) {
        console.warn("[render] 更新 render_jobs 失败:", err);
      }
    }
  } finally {
    if (args.keepTmp) {
      console.log(`临时目录保留：${tmpDir}`);
    } else {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\n渲染失败：", message);
  if (process.argv.includes("--book")) {
    // 简单兜底：--book 模式下把失败写进最新 running 的 render_jobs
    try {
      const { getSupabaseAdmin } = await import("../src/lib/db");
      const { data } = await getSupabaseAdmin()
        .from("render_jobs")
        .select("id")
        .eq("book_id", process.argv[process.argv.indexOf("--book") + 1])
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        await getSupabaseAdmin()
          .from("render_jobs")
          .update({ status: "failed", error: { message }, finished_at: new Date().toISOString() })
          .eq("id", data.id);
      }
    } catch {
      // DB 未配置时忽略
    }
  }
  process.exit(1);
});
