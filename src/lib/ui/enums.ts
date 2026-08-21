/**
 * 枚举常量唯一来源（docs/06 §1.5：三处重复实现归一）。
 * 取值对齐 supabase/migrations/0001_schema.sql 的权威枚举。
 */

/** beat 情绪 */
export const EMOTIONS = [
  "neutral", "calm", "happy", "sad", "angry", "fear",
  "surprise", "suspicious", "nervous", "pain", "determined", "whisper",
] as const;

/** 镜头机位（camera_type；界面常用子集） */
export const CAMERAS = [
  "static", "ken_burns_in", "ken_burns_out", "pan_l", "pan_r", "push_in", "pull_out",
] as const;

/** 镜头转场（transition_type） */
export const TRANSITIONS = ["cut", "crossfade", "fade_in", "fade_out", "slide", "dip_to_black"] as const;

/** 图层入/出场动画 */
export const ENTER_EXIT = [
  "none", "fade_in", "fade_out", "slide_left", "slide_right", "slide_up", "slide_down",
] as const;

/** 图层类型（layer_kind） */
export const LAYER_KINDS = ["background", "character", "prop", "text", "overlay"] as const;

/** 资产类型（asset_kind） */
export const ASSET_KINDS = [
  "character_ref", "expression", "pose", "background", "prop", "text_card",
  "bgm", "sfx", "voice_sample", "cover", "video",
] as const;
