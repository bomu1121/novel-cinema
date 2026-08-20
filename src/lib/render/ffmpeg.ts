import type { RenderSubtitle, RenderVideoTrack } from "./types";

export interface ShotGraphOptions {
  width: number;
  height: number;
  fps: number;
}

export interface ShotGraph {
  /** ffmpeg 输入参数组：file=本地媒体文件，lavfi=内置源 */
  inputs: Array<{ type: "file" | "lavfi"; value: string }>;
  filterComplex: string;
  durationSec: number;
}

/** 转义 drawtext 文本（ffmpeg filter 语法） */
export function ffEscapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\n/g, " ");
}

function rectPx(rect: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  return {
    w: Math.max(8, Math.round(rect.w * W)),
    h: Math.max(8, Math.round(rect.h * H)),
    cx: rect.x * W,
    cy: rect.y * H,
  };
}

/**
 * 把一个 shot 变成 ffmpeg 滤镜图。
 * 0 号输入永远是背景（文件或 lavfi color），1..n 是图层图片。
 */
export function buildShotGraph(
  track: RenderVideoTrack,
  opts: ShotGraphOptions,
): ShotGraph {
  const { width: W, height: H, fps } = opts;
  const dur = Math.max(0.5, track.duration_sec);
  const frames = Math.max(1, Math.round(dur * fps));

  const inputs: ShotGraph["inputs"] = track.background_url
    ? [{ type: "file" as const, value: track.background_url }]
    : [{ type: "lavfi" as const, value: `color=c=black:s=${W}x${H}:r=${fps}` }];

  const imageLayers = track.layers.filter((l) => l.asset_url);
  for (const layer of imageLayers) {
    inputs.push({ type: "file", value: layer.asset_url! });
  }

  const parts: string[] = [];

  // 背景：铺满 + 机位动效
  if (track.background_url) {
    const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    if (track.camera.startsWith("ken_burns")) {
      const zoomExpr =
        track.camera === "ken_burns_out"
          ? `max(1.12-0.12*on/${frames},1.0)`
          : `min(1+0.12*on/${frames},1.12)`;
      parts.push(
        `[0:v]${cover},zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}[bg]`,
      );
    } else if (track.camera.startsWith("pan")) {
      const dir = track.camera === "pan_r" ? 1 : -1;
      const start = dir === 1 ? 0 : 1;
      const end = dir === 1 ? 1 : 0;
      parts.push(
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},zoompan=z='1.12':x='(iw-iw/zoom)*(${start}+(${end}-${start})*on/${frames})':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${fps}[bg]`,
      );
    } else {
      parts.push(`[0:v]${cover}[bg]`);
    }
  } else {
    parts.push(`[0:v]format=yuv420p[bg]`);
  }

  let current = "bg";

  // 图层叠加
  let fileInputIndex = 1;
  for (const layer of track.layers) {
    if (layer.kind === "text" || layer.kind === "overlay") {
      if (layer.kind === "text" && layer.text) {
        const { cy } = rectPx(layer.rect, W, H);
        parts.push(
          `[${current}]drawtext=text='${ffEscapeText(layer.text)}':fontsize=44:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=${Math.max(0, Math.round(cy - 22))}[v${fileInputIndex}]`,
        );
        current = `v${fileInputIndex}`;
      } else if (layer.kind === "overlay") {
        parts.push(`[${current}]drawbox=c=black:t=fill[ov]`);
        current = "ov";
      }
      continue;
    }

    if (!layer.asset_url) continue;
    const { w, h, cx, cy } = rectPx(layer.rect, W, H);
    const fadeIn = layer.enter === "fade_in" ? `fade=t=in:st=0:d=0.4,` : "";
    const fadeOut = layer.exit === "fade_out" ? `fade=t=out:st=${Math.max(0, dur - 0.4).toFixed(2)}:d=0.4,` : "";
    const outLabel = `l${fileInputIndex}`;
    parts.push(
      `[${fileInputIndex}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${fadeIn}${fadeOut}format=rgba[${outLabel}]`,
    );

    // 入场/出场位移动画（slide_*）：前/后 0.4s 内从画布外滑入/滑出
    const targetX = cx - w / 2;
    const targetY = cy - h / 2;
    const enterDur = 0.4;
    const exitDur = 0.4;
    const exitStart = Math.max(enterDur, dur - exitDur);

    const enterFrom: Record<string, { x: number; y: number }> = {
      slide_left: { x: -w, y: targetY },
      slide_right: { x: W, y: targetY },
      slide_up: { x: targetX, y: H },
      slide_down: { x: targetX, y: -h },
    };
    const exitTo: Record<string, { x: number; y: number }> = {
      slide_left: { x: -w, y: targetY },
      slide_right: { x: W, y: targetY },
      slide_up: { x: targetX, y: -h },
      slide_down: { x: targetX, y: H },
    };

    const enter = layer.enter ?? "none";
    const exit = layer.exit ?? "none";
    const from = enterFrom[enter];
    const to = exitTo[exit];

    let xExpr = targetX.toFixed(1);
    let yExpr = targetY.toFixed(1);

    if (from) {
      xExpr = `if(lt(t,${enterDur}),${from.x.toFixed(1)}+(${targetX.toFixed(1)}-${from.x.toFixed(1)})*(t/${enterDur}),${xExpr})`;
      yExpr = `if(lt(t,${enterDur}),${from.y.toFixed(1)}+(${targetY.toFixed(1)}-${from.y.toFixed(1)})*(t/${enterDur}),${yExpr})`;
    }
    if (to) {
      xExpr = `if(gte(t,${exitStart.toFixed(2)}),${targetX.toFixed(1)}+(${to.x.toFixed(1)}-${targetX.toFixed(1)})*((t-${exitStart.toFixed(2)})/${exitDur}),${xExpr})`;
      yExpr = `if(gte(t,${exitStart.toFixed(2)}),${targetY.toFixed(1)}+(${to.y.toFixed(1)}-${targetY.toFixed(1)})*((t-${exitStart.toFixed(2)})/${exitDur}),${yExpr})`;
    }

    if (layer.motion?.type === "breath") {
      yExpr = `${yExpr}+${Math.round(H * 0.004)}*sin(2*PI*t/2.6)`;
    }

    const nextLabel = `v${fileInputIndex}`;
    parts.push(`[${current}][${outLabel}]overlay=x='${xExpr}':y='${yExpr}'[${nextLabel}]`);
    current = nextLabel;
    fileInputIndex += 1;
  }

  // 转场（v0：镜内淡入淡出近似，正式 crossfade 在 M1 做重叠拼接）
  const fadeIn =
    track.transition_in === "fade_in" || track.transition_in === "crossfade"
      ? `,fade=t=in:st=0:d=0.4`
      : "";
  const fadeOut =
    track.transition_out === "fade_out" || track.transition_out === "crossfade" || track.transition_out === "dip_to_black"
      ? `,fade=t=out:st=${Math.max(0, dur - 0.4).toFixed(2)}:d=0.4`
      : "";

  parts.push(`[${current}]format=yuv420p${fadeIn}${fadeOut}[outv]`);

  return { inputs, filterComplex: parts.join(";"), durationSec: dur };
}

/** SRT 时间格式 00:00:01,500 */
export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${millis}`;
}

export function buildSrt(subtitles: RenderSubtitle[]): string {
  return subtitles
    .map(
      (sub, i) =>
        `${i + 1}\n${srtTime(sub.start_sec)} --> ${srtTime(sub.end_sec)}\n${sub.text}\n`,
    )
    .join("\n");
}
