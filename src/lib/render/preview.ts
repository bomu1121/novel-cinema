/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/db";
import { resolveAssetUrl } from "@/lib/pipeline/nodes/assets";
import { buildShotGraph } from "@/lib/render/ffmpeg";
import type { RenderLayer, RenderVideoTrack } from "@/lib/render/types";

function localizeMedia(url: string, tmpDir: string, name: string): string {
  if (url.startsWith("/storage/")) {
    return path.join(process.cwd(), "public", "storage", url.slice("/storage/".length));
  }
  if (url.startsWith("data:")) {
    const target = path.join(tmpDir, name);
    const b64 = url.slice(url.indexOf("base64,") + "base64,".length);
    writeFileSync(target, Buffer.from(b64, "base64"));
    return target;
  }
  return url; // http(s) 由 ffmpeg 直接拉取
}

/** 渲染单个镜头的低清预览（无音频），返回可访问 URL */
export async function renderShotPreview(
  bookId: string,
  shotId: string,
): Promise<{ url: string; durationSec: number }> {
  const s = getSupabaseAdmin();
  const { data: shot } = await s
    .from("shots")
    .select("*")
    .eq("id", shotId)
    .eq("book_id", bookId)
    .single();
  if (!shot) throw new Error("镜头不存在");

  const { data: layerRows } = await s
    .from("shot_layers")
    .select("*")
    .eq("shot_id", shotId)
    .order("idx");

  const { data: beatRow } = await s.from("beats").select("text").eq("id", shot.beat_id).single();
  const beatText = beatRow?.text ?? "";

  const tmpDir = path.join(process.cwd(), "public", "storage", "book", bookId, "previews", "tmp");
  mkdirSync(tmpDir, { recursive: true });

  const bgAsset = shot.background_asset_id
    ? (await s.from("assets").select("id, file_key, params").eq("id", shot.background_asset_id).single()).data
    : null;
  const bgUrl = bgAsset ? await resolveAssetUrl(bgAsset) : null;

  const layers: RenderLayer[] = [];
  for (const layer of (layerRows ?? []) as any[]) {
    const asset = layer.asset_id
      ? (await s.from("assets").select("id, file_key, params").eq("id", layer.asset_id).single()).data
      : null;
    const assetUrl = asset ? await resolveAssetUrl(asset) : null;
    layers.push({
      kind: layer.kind,
      asset_url: assetUrl,
      text: layer.kind === "text" ? beatText : undefined,
      rect: layer.rect,
      enter: layer.enter_animation,
      exit: layer.exit_animation,
      motion: layer.motion,
    });
  }

  const track: RenderVideoTrack = {
    shotId,
    beatId: shot.beat_id,
    beatIdx: 0,
    text: beatText,
    description: shot.description ?? "",
    camera: shot.camera,
    duration_sec: Number(shot.duration_sec),
    transition_in: shot.transition_in,
    transition_out: shot.transition_out,
    background_url: bgUrl,
    layers,
  };

  const graph = buildShotGraph(track, { width: 1920, height: 1080, fps: 25 });
  const outDir = path.join(process.cwd(), "public", "storage", "book", bookId, "previews");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `shot_${shotId}.mp4`);

  const inputArgs: string[] = [];
  graph.inputs.forEach((input, i) => {
    if (input.type === "file") {
      const local = localizeMedia(input.value, tmpDir, `shot_${shotId}_${i}.png`);
      if (!input.value.startsWith("http") || local !== input.value) {
        inputArgs.push("-loop", "1", "-i", local);
      } else {
        inputArgs.push("-loop", "1", "-i", input.value);
      }
    } else {
      inputArgs.push("-f", "lavfi", "-i", input.value);
    }
  });

  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      ...inputArgs,
      "-filter_complex",
      graph.filterComplex,
      "-map",
      "[outv]",
      "-r",
      "25",
      "-t",
      graph.durationSec.toFixed(2),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outPath,
    ],
    { stdio: "ignore", windowsHide: false },
  );

  if (result.status !== 0) {
    throw new Error(`镜头预览渲染失败（ffmpeg 退出码 ${result.status ?? "null"}）`);
  }
  return { url: `/storage/book/${bookId}/previews/shot_${shotId}.mp4`, durationSec: graph.durationSec };
}

export function readLocalPreviewBytes(key: string): Uint8Array | null {
  try {
    const p = path.join(process.cwd(), "public", "storage", key);
    return readFileSync(p);
  } catch {
    return null;
  }
}
