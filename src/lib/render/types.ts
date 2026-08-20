/** 渲染唯一事实来源。由 timeline.snapshot + voice_takes 组装，渲染器不查询业务库。 */

export interface RenderLayer {
  kind: "background" | "character" | "prop" | "text" | "overlay";
  asset_url: string | null;
  text?: string;
  rect: { x: number; y: number; w: number; h: number };
  enter: string | null;
  exit: string | null;
  motion: Record<string, unknown>;
}

export interface RenderVideoTrack {
  shotId: string;
  beatId: string;
  beatIdx: number;
  text: string;
  description: string;
  camera: string;
  duration_sec: number;
  transition_in: string;
  transition_out: string;
  background_url: string | null;
  layers: RenderLayer[];
}

export interface RenderAudioTrack {
  kind: "voice" | "bgm";
  start_sec: number;
  url: string;
  volume: number;
  speaker: string | null;
}

export interface RenderSubtitle {
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface RenderSpec {
  version: number;
  bookId: string;
  resolution: [number, number];
  fps: number;
  duration_sec: number;
  video_tracks: RenderVideoTrack[];
  audio_tracks: RenderAudioTrack[];
  subtitle_track: RenderSubtitle[];
}

export interface RenderPreset {
  crf: number;
  preset: "veryfast" | "fast" | "medium";
  audioLufs: number;
  burnSubtitles: boolean;
}
