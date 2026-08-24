import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/db";
import { JobCancelledError, NOOP_REPORTER, type ProgressReporter } from "@/lib/jobs/types";
import { r2Put, r2PublicUrl, r2SignedUrl } from "@/lib/r2";
import { getImageProvider, type ImageKind } from "@/lib/providers/image";
import {
  buildBackgroundPrompt,
  buildCharacterRefPrompt,
  buildExpressionPrompt,
  buildNegativePrompt,
} from "@/lib/pipeline/prompts/image";

export interface AssetPlanSpec {
  sceneKey: string;
  kind: ImageKind;
  prompt: string;
  negativePrompt: string;
  aspect?: "16:9" | "9:16" | "1:1";
  characterId: string | null;
  characterName: string | null;
  locationId: string | null;
  expression: string | null;
  refAssetIds: string[];
  count: number;
  skipReason: string | null;
}

export interface AssetPlan {
  phase1: AssetPlanSpec[];
  phase2: AssetPlanSpec[];
  blocked: Array<{ characterName: string; expression: string; reason: string }>;
}

interface StyleForImage {
  visual_style: string;
  negative_prompt: unknown;
}

interface AssetRow {
  id: string;
  kind: ImageKind;
  title: string | null;
  character_id: string | null;
  location_id: string | null;
  expression: string | null;
  scene_key: string | null;
  file_key: string | null;
  params: unknown;
  status: string;
  prompt: string | null;
}

function negativeText(style: StyleForImage | null): string {
  const raw = style?.negative_prompt;
  const text =
    typeof raw === "string" ? raw : (raw as { text?: string } | null)?.text ?? "";
  return buildNegativePrompt(text || null);
}

/** 生成资产可展示 URL：优先直链 → R2 公开域名 → R2 签名 URL */
export async function resolveAssetUrl(asset: {
  file_key?: string | null;
  params?: unknown;
}): Promise<string | null> {
  const params = asset.params as { url?: string; dataBase64?: string; imageDataBase64?: string } | null;
  if (params?.url) return params.url;
  if (params?.imageDataBase64) return `data:image/png;base64,${params.imageDataBase64}`;
  if (params?.dataBase64) return `data:audio/mpeg;base64,${params.dataBase64}`;
  if (!asset.file_key) return null;
  if (process.env.R2_PUBLIC_URL) return r2PublicUrl(asset.file_key);
  try {
    return await r2SignedUrl(asset.file_key, 3600);
  } catch {
    return null;
  }
}

/** 把本地 /storage/ 路径转成可被图像 API 引用的 data URL */
async function toProviderImageUrl(url: string): Promise<string> {
  if (!url.startsWith("/storage/")) return url;
  const local = path.join(process.cwd(), "public", "storage", url.slice("/storage/".length));
  const bytes = readFileSync(local);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** A10：从已批准（或最新）脚本推导资产生成清单，按 scene_key 跨章去重 */
export async function listAssetPlan(bookId: string): Promise<AssetPlan> {
  const supabase = getSupabaseAdmin();

  const [styleRes, charRes, locRes, chapterRes, assetRes] = await Promise.all([
    supabase
      .from("style_bibles")
      .select("visual_style, negative_prompt, status")
      .eq("book_id", bookId)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("characters")
      .select("id, canonical_name, bio")
      .eq("book_id", bookId),
    supabase
      .from("locations")
      .select("id, name, visual_note")
      .eq("book_id", bookId),
    supabase
      .from("adapted_chapters")
      .select("id, status")
      .eq("book_id", bookId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("assets")
      .select("id, kind, character_id, location_id, expression, scene_key, status")
      .eq("book_id", bookId),
  ]);

  const style = (styleRes.data ?? null) as StyleForImage | null;
  if (!style) {
    throw new Error("还没有已批准的风格圣经。请先在“全书档案”页运行分析并批准一套风格方案。");
  }
  const visualStyle = style.visual_style;
  const negative = negativeText(style);

  const characters = (charRes.data ?? []) as Array<{
    id: string;
    canonical_name: string;
    bio: Record<string, unknown> | null;
  }>;
  const locations = (locRes.data ?? []) as Array<{
    id: string;
    name: string;
    visual_note: string | null;
  }>;
  const existingAssets = (assetRes.data ?? []) as Array<{
    id: string;
    kind: ImageKind;
    character_id: string | null;
    location_id: string | null;
    expression: string | null;
    scene_key: string | null;
    status: string;
  }>;

  let beats: Array<{ character_id: string | null; emotion: string }> = [];
  if (chapterRes.data) {
    const { data: beatRows } = await supabase
      .from("beats")
      .select("character_id, emotion")
      .eq("adapted_chapter_id", chapterRes.data.id);
    beats = (beatRows ?? []) as Array<{ character_id: string | null; emotion: string }>;
  }

  const phase1: AssetPlanSpec[] = [];
  const phase2: AssetPlanSpec[] = [];
  const blocked: AssetPlan["blocked"] = [];

  const hasUsable = (sceneKey: string) =>
    existingAssets.some((a) => a.scene_key === sceneKey && a.status !== "rejected");

  // 角色设定图（无批准参考图时进 phase1）
  for (const c of characters) {
    const refSceneKey = `ref:${c.id}`;
    const approvedRef = existingAssets.find(
      (a) => a.kind === "character_ref" && a.character_id === c.id && a.status === "approved",
    );
    if (approvedRef) continue;
    if (hasUsable(refSceneKey)) continue;

    phase1.push({
      sceneKey: refSceneKey,
      kind: "character_ref",
      prompt: buildCharacterRefPrompt({
        visualStyle,
        negative,
        character: { name: c.canonical_name, bio: c.bio ?? {} },
      }),
      negativePrompt: negative,
      characterId: c.id,
      characterName: c.canonical_name,
      locationId: null,
      expression: null,
      refAssetIds: [],
      count: 1,
      skipReason: null,
    });
  }

  // 背景（按地点去重；无地点时给一张默认定场图）
  const bgLocations = locations.filter((l) => {
    const sceneKey = `bg:${l.id}`;
    return !existingAssets.some(
      (a) => a.kind === "background" && a.scene_key === sceneKey && a.status !== "rejected",
    );
  });
  for (const l of bgLocations) {
    phase1.push({
      sceneKey: `bg:${l.id}`,
      kind: "background",
      prompt: buildBackgroundPrompt({
        visualStyle,
        negative,
        location: { name: l.name, visualNote: l.visual_note },
        mood: "suspense",
      }),
      negativePrompt: negative,
      aspect: "16:9",
      characterId: null,
      characterName: null,
      locationId: l.id,
      expression: null,
      refAssetIds: [],
      count: 1,
      skipReason: null,
    });
  }
  if (locations.length === 0 && !hasUsable("bg:default")) {
    phase1.push({
      sceneKey: "bg:default",
      kind: "background",
      prompt: buildBackgroundPrompt({
        visualStyle,
        negative,
        location: { name: "故事主场景", visualNote: null },
        mood: "opening atmosphere",
      }),
      negativePrompt: negative,
      aspect: "16:9",
      characterId: null,
      characterName: null,
      locationId: null,
      expression: null,
      refAssetIds: [],
      count: 1,
      skipReason: null,
    });
  }

  // 表情变体（phase2）：必须有已批准的角色参考图
  for (const c of characters) {
    const approvedRef = existingAssets.find(
      (a) => a.kind === "character_ref" && a.character_id === c.id && a.status === "approved",
    );
    const emotions = [
      ...new Set(
        beats
          .filter((b) => b.character_id === c.id && b.emotion && b.emotion !== "neutral")
          .map((b) => b.emotion),
      ),
    ];
    if (emotions.length === 0) emotions.push("neutral");

    for (const emotion of emotions) {
      const sceneKey = `char:${c.id}:${emotion}`;
      if (hasUsable(sceneKey)) continue;
      const spec: AssetPlanSpec = {
        sceneKey,
        kind: "expression",
        prompt: buildExpressionPrompt({
          visualStyle,
          negative,
          character: { name: c.canonical_name, bio: c.bio ?? {} },
          expression: emotion,
        }),
        negativePrompt: negative,
        characterId: c.id,
        characterName: c.canonical_name,
        locationId: null,
        expression: emotion,
        refAssetIds: approvedRef ? [approvedRef.id] : [],
        count: 1,
        skipReason: null,
      };
      if (!approvedRef) {
        spec.skipReason = "等待角色设定图批准";
        blocked.push({ characterName: c.canonical_name, expression: emotion, reason: spec.skipReason });
      }
      phase2.push(spec);
    }
  }

  return { phase1, phase2, blocked };
}

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载生成图失败 HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * 角色图自动抠底：从图片四边做 flood fill，把与边缘主色相近的连续背景设为透明。
 * 生成模型通常返回不透明 JPG/PNG，而项目底层逻辑是角色层叠在背景层之上，
 * 所以角色设定图/表情变体必须是无背景的透明 PNG。
 */
async function removeBackground(bytes: Uint8Array): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(bytes), { failOn: "none" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  if (channels < 4) {
    throw new Error("sharp ensureAlpha 后通道数仍不足 4");
  }

  const src = data;
  const out = Buffer.from(src);
  const tolerance = Number(process.env.CHARACTER_BG_REMOVE_TOLERANCE ?? 40);

  // 计算四边平均色作为背景参考色（忽略已有透明像素，兼容输入本身带 alpha 的情况）
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let borderCount = 0;
  const at = (x: number, y: number) => (y * width + x) * 4;
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = at(x, y);
      if (src[i + 3] >= 128) {
        rSum += src[i];
        gSum += src[i + 1];
        bSum += src[i + 2];
        borderCount++;
      }
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      const i = at(x, y);
      if (src[i + 3] >= 128) {
        rSum += src[i];
        gSum += src[i + 1];
        bSum += src[i + 2];
        borderCount++;
      }
    }
  }
  const bgR = borderCount > 0 ? rSum / borderCount : 0;
  const bgG = borderCount > 0 ? gSum / borderCount : 0;
  const bgB = borderCount > 0 ? bSum / borderCount : 0;

  const maxDist = tolerance * tolerance * 3;
  const dist2 = (r: number, g: number, b: number) => {
    const dr = r - bgR;
    const dg = g - bgG;
    const db = b - bgB;
    return dr * dr + dg * dg + db * db;
  };

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const tryPush = (x: number, y: number) => {
    const p = y * width + x;
    if (visited[p]) return;
    const i = p * 4;
    // 已经是透明的像素视为背景，继续向邻域扩散
    if (src[i + 3] < 128 || dist2(src[i], src[i + 1], src[i + 2]) <= maxDist) {
      visited[p] = 1;
      out[i + 3] = 0;
      queue.push(p);
    }
  };

  for (let x = 0; x < width; x++) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const x = p % width;
    const y = Math.floor(p / width);
    if (x > 0) tryPush(x - 1, y);
    if (x < width - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < height - 1) tryPush(x, y + 1);
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** A20/A30：执行某个 phase 的资产生成，候选全部落 assets（candidate 状态） */export async function generateAssetPhase(
  bookId: string,
  phase: "phase1" | "phase2",
  reporter?: ProgressReporter,
): Promise<{ generated: number; errors: string[] }> {
  const r = reporter ?? NOOP_REPORTER;
  const plan = await listAssetPlan(bookId);
  const specs = (phase === "phase1" ? plan.phase1 : plan.phase2).filter((s) => !s.skipReason);
  if (specs.length === 0) {
    r.step("无需生成（计划为空）", 0, 0);
    return { generated: 0, errors: [] };
  }

  const supabase = getSupabaseAdmin();
  const provider = getImageProvider();
  const errors: string[] = [];
  let generated = 0;

  for (const [specIdx, spec] of specs.entries()) {
    r.step(
      `生成 ${spec.kind === "expression" ? "表情" : "设定图"}：${spec.characterName ?? spec.sceneKey}`,
      specIdx + 1,
      specs.length,
    );
    if (r.checkCancelled()) throw new JobCancelledError();
    const { data: request, error: reqError } = await supabase
      .from("asset_requests")
      .insert({
        book_id: bookId,
        kind: spec.kind,
        spec,
        provider: provider.name,
        model:
          spec.kind === "expression"
            ? process.env.IMAGE_MODEL_I2I ?? ""
            : process.env.IMAGE_MODEL_T2I ?? "",
        count: spec.count,
        aspect_ratio: spec.aspect ?? "1:1",
        status: "running",
      })
      .select("id")
      .single();

    if (reqError || !request) {
      errors.push(`${spec.sceneKey}: 创建请求失败 ${reqError?.message ?? ""}`);
      continue;
    }

    try {
      const refUrls: string[] = [];
      for (const refAssetId of spec.refAssetIds) {
        const { data: refRow } = await supabase
          .from("assets")
          .select("id, file_key, params")
          .eq("id", refAssetId)
          .single();
        if (refRow) {
          const url = await resolveAssetUrl(refRow);
          if (url) refUrls.push(await toProviderImageUrl(url));
        }
      }

      const images = await provider.generate({
        kind: spec.kind,
        prompt: spec.prompt,
        negativePrompt: spec.negativePrompt,
        count: spec.count,
        aspect: spec.aspect,
        refImageUrls: refUrls.length > 0 ? refUrls : undefined,
      });

      for (const image of images) {
        let fileKey: string | null = null;
        let params: Record<string, unknown> = {};
        if (image.url) {
          const isCharacter = spec.kind === "character_ref" || spec.kind === "expression";
          try {
            const bytes = await fetchImageBytes(image.url);
            const processed = isCharacter ? await removeBackground(bytes) : bytes;
            try {
              fileKey = `book/${bookId}/assets/${randomUUID()}.png`;
              await r2Put(fileKey, processed, "image/png");
              params = { transparent: isCharacter };
            } catch (r2Err) {
              // R2 未配置：角色图用 dataURL 保留透明 PNG；背景图保留 provider 直链
              console.warn("[assets] R2 上传失败，保留 dataURL/直链:", r2Err);
              params = isCharacter
                ? { imageDataBase64: processed.toString("base64"), transparent: true }
                : { url: image.url };
            }
          } catch (err) {
            // 下载/抠图失败：退化为 provider 直链，后续可重导
            console.warn("[assets] 下载/抠图失败，保留直链:", err);
            params = { url: image.url };
          }
        }

        const { error: assetInsertError } = await supabase.from("assets").insert({
          book_id: bookId,
          kind: spec.kind,
          title: spec.characterName
            ? `${spec.characterName} ${spec.expression ?? "设定图"}`
            : spec.sceneKey,
          provider: provider.name,
          model:
            spec.kind === "expression"
              ? process.env.IMAGE_MODEL_I2I ?? null
              : process.env.IMAGE_MODEL_T2I ?? null,
          prompt: spec.prompt,
          negative_prompt: spec.negativePrompt,
          params,
          ref_asset_ids: spec.refAssetIds,
          generation_request_id: request.id,
          character_id: spec.characterId,
          location_id: spec.locationId,
          expression: spec.expression,
          scene_key: spec.sceneKey,
          file_key: fileKey,
          mime_type: "image/png",
          source: "generated",
          status: "candidate",
          is_candidate: true,
        });
        if (assetInsertError) {
          errors.push(`${spec.sceneKey}: 资产落库失败 ${assetInsertError.message}`);
          continue;
        }
        generated += 1;
      }

      await supabase
        .from("asset_requests")
        .update({ status: "succeeded", finished_at: new Date().toISOString() })
        .eq("id", request.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${spec.sceneKey}: ${message}`);
      await supabase
        .from("asset_requests")
        .update({ status: "failed", error: { message }, finished_at: new Date().toISOString() })
        .eq("id", request.id);
    }

    r.progress((specIdx + 1) / specs.length);
  }

  return { generated, errors };
}

/** 签核 C：批准一个候选。角色参考图会回写 characters.ref_asset_id 并淘汰同角色其他候选 */
export async function approveAsset(bookId: string, assetId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: asset } = await supabase
    .from("assets")
    .select("id, kind, character_id, location_id")
    .eq("id", assetId)
    .eq("book_id", bookId)
    .single();
  if (!asset) throw new Error("资产不存在");

  await supabase
    .from("assets")
    .update({ status: "approved", is_candidate: false, updated_at: new Date().toISOString() })
    .eq("id", assetId);

  if (asset.kind === "character_ref" && asset.character_id) {
    await supabase
      .from("characters")
      .update({ ref_asset_id: assetId })
      .eq("id", asset.character_id);
    await supabase
      .from("assets")
      .update({ status: "rejected" })
      .eq("book_id", bookId)
      .eq("kind", "character_ref")
      .eq("character_id", asset.character_id)
      .neq("id", assetId);
  }
  if (asset.kind === "background" && asset.location_id) {
    await supabase.from("locations").update({ ref_asset_id: assetId }).eq("id", asset.location_id);
  }
}

/** 资产库列表（带展示 URL） */
export async function listAssetsWithUrls(bookId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("assets")
    .select(
      "id, kind, title, character_id, location_id, expression, scene_key, status, prompt, params, file_key, created_at",
    )
    .eq("book_id", bookId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as Array<AssetRow & { created_at: string }>;
  const withUrls = await Promise.all(
    rows.map(async (row) => ({ ...row, url: await resolveAssetUrl(row) })),
  );
  return withUrls;
}

