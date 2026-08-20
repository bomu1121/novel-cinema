import type { RenderVideoTrack } from "./types";

export interface BoundaryTransition {
  /** xfade transition 名；'none' = 硬切 */
  xfade: string;
  /** 重叠时长（秒）；0 = 无重叠 */
  overlap: number;
}

export interface ShotGroup {
  /** 组内镜头在 tracks 中的索引 */
  indices: number[];
  /** 组内边界过渡（长度 = indices.length - 1） */
  boundaries: BoundaryTransition[];
  /** 组输出时长 */
  durationSec: number;
}

export interface XfadeStep {
  xfade: string;
  duration: number;
  offset: number;
}

/** 边界过渡解析：后镜 transition_in 优先，否则用前镜 transition_out */
export function resolveBoundary(prev: RenderVideoTrack, next: RenderVideoTrack): BoundaryTransition {
  const value = next.transition_in !== "cut" ? next.transition_in : prev.transition_out;
  switch (value) {
    case "crossfade":
      return { xfade: "fade", overlap: 0.8 };
    case "dip_to_black":
      return { xfade: "fadeblack", overlap: 0.6 };
    case "slide":
      return { xfade: "slideleft", overlap: 0.5 };
    default:
      return { xfade: "none", overlap: 0 };
  }
}

/** 把 tracks 按硬切边界分组；组内相邻镜头全部用真实重叠过渡 */
export function planShotGroups(tracks: RenderVideoTrack[]): ShotGroup[] {
  const groups: ShotGroup[] = [];
  let indices: number[] = [];
  let boundaries: BoundaryTransition[] = [];
  let duration = 0;

  const flush = () => {
    if (indices.length > 0) {
      groups.push({ indices, boundaries, durationSec: Number(duration.toFixed(3)) });
    }
    indices = [];
    boundaries = [];
    duration = 0;
  };

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    duration += Number(track.duration_sec || 0);
    indices.push(i);
    if (i > 0) {
      const boundary = resolveBoundary(tracks[i - 1], tracks[i]);
      if (boundary.overlap > 0) {
        boundaries.push(boundary);
        duration -= boundary.overlap;
      } else {
        // 硬切：关掉当前组，从本镜重新开组
        indices.pop();
        duration -= Number(track.duration_sec || 0);
        flush();
        indices.push(i);
        duration += Number(track.duration_sec || 0);
      }
    }
  }
  flush();
  return groups;
}

/** 组内 xfade 链：offset_i = 当前链时长 − overlap_i */
export function buildXfadeChain(
  tracks: RenderVideoTrack[],
  group: ShotGroup,
): { filter: string; durationSec: number } {
  const durations = group.indices.map((i) => Number(tracks[i].duration_sec || 0));
  let chainDuration = durations[0];
  const parts: string[] = [];
  let prevLabel = `[0:v]`;

  for (let j = 1; j < group.indices.length; j++) {
    const boundary = group.boundaries[j - 1];
    const offset = Number((chainDuration - boundary.overlap).toFixed(3));
    const outLabel = `[x${j}]`;
    parts.push(
      `${prevLabel}[${j}:v]xfade=transition=${boundary.xfade}:duration=${boundary.overlap}:offset=${offset}${outLabel}`,
    );
    prevLabel = outLabel;
    chainDuration = chainDuration + durations[j] - boundary.overlap;
  }

  const filter =
    group.indices.length === 1
      ? `[0:v]copy[out]`
      : `${parts.join(";")};${prevLabel}copy[out]`;
  return { filter, durationSec: Number(chainDuration.toFixed(3)) };
}

/** 全片总时长 = Σ镜头时长 − Σ重叠 */
export function totalDurationSec(tracks: RenderVideoTrack[]): number {
  let total = tracks.reduce((sum, t) => sum + Number(t.duration_sec || 0), 0);
  for (let i = 1; i < tracks.length; i++) {
    total -= resolveBoundary(tracks[i - 1], tracks[i]).overlap;
  }
  return Number(total.toFixed(3));
}
