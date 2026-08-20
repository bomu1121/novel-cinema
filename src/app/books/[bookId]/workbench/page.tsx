"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface WorkbenchData {
  book?: { id: string; title: string; status: string };
  chapters?: any[];
  characters?: any[];
  clues?: any[];
  locations?: any[];
  styleBible?: any;
  adaptedChapter?: any;
  beats?: any[];
  shots?: any[];
  layers?: any[];
  assets?: any[];
  voiceProfiles?: any[];
  timeline?: any;
  renderJobs?: any[];
}

const ENTER_EXIT = ["none", "fade_in", "fade_out", "slide_left", "slide_right", "slide_up", "slide_down"];
const CAMERAS = ["static", "ken_burns_in", "ken_burns_out", "pan_l", "pan_r", "push_in", "pull_out"];
const TRANSITIONS = ["cut", "crossfade", "fade_in", "fade_out", "slide", "dip_to_black"];

export default function WorkbenchPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [data, setData] = useState<WorkbenchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/workbench`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载后拉取编排台；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function edit(key: string, field: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function save(table: string, id: string, row: any) {
    void row; // 保留行引用参数，实际以 edits 为准
    const patch = edits[`${table}:${id}`] ?? {};
    if (Object.keys(patch).length === 0) {
      setError("没有修改");
      return;
    }
    setBusy(`${table}:${id}`);
    try {
      const res = await fetch(`/api/books/${bookId}/workbench/${table}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "保存失败");
        return;
      }
      setEdits((prev) => {
        const next = { ...prev };
        delete next[`${table}:${id}`];
        return next;
      });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveJson(table: string, id: string, text: string) {
    try {
      const patch = JSON.parse(text);
      const res = await fetch(`/api/books/${bookId}/workbench/${table}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "保存失败");
        return;
      }
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "JSON 解析失败：" + String(err));
    }
  }

  async function rerun(node: string, label: string) {
    if (!confirm(`重跑「${label}」？将消耗 API 费用并覆盖该节点下游。`)) return;
    setBusy(`rerun:${node}`);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/workbench/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `重跑失败（HTTP ${res.status}）`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const cur = (key: string, row: any, field: string) => edits[key]?.[field] ?? row?.[field];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-12">
      <header>
        <Link href={`/books/${bookId}`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← 返回章节
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          编排台 <span className="text-sm font-normal text-zinc-400">中间态可视化 + 高级 JSON + 节点重跑</span>
        </h1>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* 重跑按钮 */}
      <section className="rounded-xl border border-zinc-200 p-4">
        <h2 className="mb-2 font-semibold">节点重跑（确认后覆盖该节点及下游）</h2>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["analyze", "① 分析+风格候选"],
              ["adapt", "② 改编脚本"],
              ["assets-phase1", "③a 设定图+背景"],
              ["assets-phase2", "③b 表情变体"],
              ["storyboard", "④ 分镜"],
              ["voice", "⑤ 配音"],
            ] as const
          ).map(([node, label]) => (
            <button
              key={node}
              onClick={() => rerun(node, label)}
              disabled={busy !== null}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:border-zinc-900 disabled:opacity-50"
            >
              {busy === `rerun:${node}` ? "运行中…" : label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          章节 {data?.chapters?.length ?? 0} · 人物 {data?.characters?.length ?? 0} · beats{" "}
          {data?.beats?.length ?? 0} · 镜头 {data?.shots?.length ?? 0} · 图层 {data?.layers?.length ?? 0} · 资产{" "}
          {data?.assets?.length ?? 0} · timeline {data?.timeline?.status ?? "-"}
        </p>
      </section>

      {/* 人物与配音 */}
      <section className="space-y-3">
        <h2 className="font-semibold">人物 / 配音表</h2>
        {data?.characters?.map((c) => (
          <div key={c.id} className="rounded-xl border border-zinc-200 p-4 text-sm">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 text-xs">
                名字
                <input
                  value={String(cur(`characters:${c.id}`, c, "canonical_name") ?? "")}
                  onChange={(e) => edit(`characters:${c.id}`, "canonical_name", e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
                />
              </label>
              <label className="flex-1 text-xs">
                别名（逗号分隔）
                <input
                  value={Array.isArray(cur(`characters:${c.id}`, c, "aliases")) ? (cur(`characters:${c.id}`, c, "aliases") as string[]).join(",") : (c.aliases ?? []).join(",")}
                  onChange={(e) =>
                    edit(`characters:${c.id}`, "aliases", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                  }
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
                />
              </label>
              <label className="flex-1 text-xs">
                声线
                <select
                  value={String(cur(`characters:${c.id}`, c, "voice_profile_id") ?? "")}
                  onChange={(e) => edit(`characters:${c.id}`, "voice_profile_id", e.target.value || null)}
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
                >
                  <option value="">（未绑定）</option>
                  {(data?.voiceProfiles ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.provider_voice_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 text-xs">
                描述
                <input
                  value={String(cur(`characters:${c.id}`, c, "description") ?? "")}
                  onChange={(e) => edit(`characters:${c.id}`, "description", e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
                />
              </label>
              <button
                onClick={() => save("characters", c.id, c)}
                disabled={busy !== null}
                className="rounded border border-zinc-300 px-3 py-1.5 text-xs hover:border-zinc-900 disabled:opacity-50"
              >
                保存
              </button>
            </div>
            <JsonDetails table="characters" id={c.id} row={c} onSave={saveJson} />
          </div>
        ))}

        {data?.voiceProfiles?.map((v) => (
          <div key={v.id} className="rounded-lg border border-zinc-200 p-3 text-xs">
            <div className="flex flex-wrap items-end gap-2">
              <span className="font-medium">{v.name}（{v.role}）</span>
              <input
                value={String(cur(`voice_profiles:${v.id}`, v, "provider_voice_id") ?? "")}
                onChange={(e) => edit(`voice_profiles:${v.id}`, "provider_voice_id", e.target.value)}
                className="w-72 rounded border border-zinc-300 px-2 py-1"
                placeholder="火山音色 ID"
              />
              <button onClick={() => save("voice_profiles", v.id, v)} className="rounded border px-2 py-1">保存</button>
            </div>
            <p className="mt-1 text-zinc-500">提示：改声线后，配音页“重录”才会用新声线。</p>
          </div>
        ))}
      </section>

      {/* 说话人 */}
      <section className="space-y-3">
        <h2 className="font-semibold">说话人（beat → 谁来说）</h2>
        {data?.beats?.map((b) => (
          <div key={b.id} className="rounded-lg border border-zinc-200 p-3 text-xs">
            <div className="flex flex-wrap items-start gap-2">
              <span className="mt-2 w-8">#{b.idx}</span>
              <select
                value={String(cur(`beats:${b.id}`, b, "character_id") ?? "")}
                onChange={(e) => edit(`beats:${b.id}`, "character_id", e.target.value || null)}
                className="rounded border border-zinc-300 px-2 py-1.5"
              >
                <option value="">旁白</option>
                {(data?.characters ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.canonical_name}</option>
                ))}
              </select>
              <select
                value={String(cur(`beats:${b.id}`, b, "speaker_type") ?? "narrator")}
                onChange={(e) => edit(`beats:${b.id}`, "speaker_type", e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1.5"
              >
                <option value="narrator">旁白</option>
                <option value="character">角色</option>
                <option value="onscreen_text">屏幕文字</option>
                <option value="none">无</option>
              </select>
              <select
                value={String(cur(`beats:${b.id}`, b, "emotion") ?? "neutral")}
                onChange={(e) => edit(`beats:${b.id}`, "emotion", e.target.value)}
                className="rounded border border-zinc-300 px-2 py-1.5"
              >
                {["neutral", "calm", "happy", "sad", "angry", "fear", "surprise", "suspicious", "nervous", "pain", "determined", "whisper"].map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <textarea
                value={String(cur(`beats:${b.id}`, b, "text") ?? "")}
                onChange={(e) => edit(`beats:${b.id}`, "text", e.target.value)}
                rows={2}
                className="min-w-64 flex-1 rounded border border-zinc-300 px-2 py-1.5"
              />
              <button onClick={() => save("beats", b.id, b)} className="rounded border px-2 py-1.5">保存</button>
            </div>
            <p className="mt-1 text-zinc-500">
              画面：{b.visual_note} · {b.estimated_duration_sec}s · 出处 {b.source_span?.start_char}–{b.source_span?.end_char}
            </p>
          </div>
        ))}
      </section>

      {/* 镜头与图层 */}
      <section className="space-y-3">
        <h2 className="font-semibold">镜头 / 人物图像 / 入场出场</h2>
        {data?.shots?.map((shot) => {
          const shotLayers = (data?.layers ?? []).filter((l) => l.shot_id === shot.id);
          return (
            <div key={shot.id} className="rounded-xl border border-zinc-200 p-4 text-xs">
              <div className="flex flex-wrap items-end gap-2">
                <span className="font-medium">beat#{shot.beat_id?.slice(0, 4)} · shot{shot.idx}</span>
                <select
                  value={String(cur(`shots:${shot.id}`, shot, "camera") ?? "static")}
                  onChange={(e) => edit(`shots:${shot.id}`, "camera", e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1.5"
                >
                  {CAMERAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={String(cur(`shots:${shot.id}`, shot, "transition_in") ?? "cut")}
                  onChange={(e) => edit(`shots:${shot.id}`, "transition_in", e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1.5"
                >
                  {TRANSITIONS.map((t) => <option key={t} value={t}>进:{t}</option>)}
                </select>
                <select
                  value={String(cur(`shots:${shot.id}`, shot, "transition_out") ?? "cut")}
                  onChange={(e) => edit(`shots:${shot.id}`, "transition_out", e.target.value)}
                  className="rounded border border-zinc-300 px-2 py-1.5"
                >
                  {TRANSITIONS.map((t) => <option key={t} value={t}>出:{t}</option>)}
                </select>
                <input
                  type="number" step={0.5} min={0.5}
                  value={Number(cur(`shots:${shot.id}`, shot, "duration_sec") ?? 0)}
                  onChange={(e) => edit(`shots:${shot.id}`, "duration_sec", Number(e.target.value))}
                  className="w-20 rounded border border-zinc-300 px-2 py-1.5"
                />
                <button onClick={() => save("shots", shot.id, shot)} className="rounded border px-2 py-1.5">保存镜头</button>
              </div>

              {shotLayers.map((layer) => {
                const charAssets = (data?.assets ?? []).filter(
                  (a) => (a.kind === "expression" || a.kind === "character_ref") && (layer.character_id ? a.character_id === layer.character_id : true),
                );
                return (
                  <div key={layer.id} className="mt-2 rounded-lg bg-zinc-50 p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <span className="font-medium">{layer.kind}·layer{layer.idx}</span>
                      <select
                        value={String(cur(`shot_layers:${layer.id}`, layer, "character_id") ?? "")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "character_id", e.target.value || null)}
                        className="rounded border border-zinc-300 px-2 py-1.5"
                      >
                        <option value="">（无人物）</option>
                        {(data?.characters ?? []).map((c) => <option key={c.id} value={c.id}>{c.canonical_name}</option>)}
                      </select>
                      <select
                        value={String(cur(`shot_layers:${layer.id}`, layer, "asset_id") ?? "")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "asset_id", e.target.value || null)}
                        className="max-w-64 rounded border border-zinc-300 px-2 py-1.5"
                      >
                        <option value="">（无图）</option>
                        {charAssets.map((a) => (
                          <option key={a.id} value={a.id}>{a.title ?? a.scene_key}</option>
                        ))}
                      </select>
                      <select
                        value={String(cur(`shot_layers:${layer.id}`, layer, "enter_animation") ?? "none")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "enter_animation", e.target.value)}
                        className="rounded border border-zinc-300 px-2 py-1.5"
                      >
                        {ENTER_EXIT.map((x) => <option key={x} value={x}>入场:{x}</option>)}
                      </select>
                      <select
                        value={String(cur(`shot_layers:${layer.id}`, layer, "exit_animation") ?? "none")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "exit_animation", e.target.value)}
                        className="rounded border border-zinc-300 px-2 py-1.5"
                      >
                        {ENTER_EXIT.map((x) => <option key={x} value={x}>退场:{x}</option>)}
                      </select>
                      <button onClick={() => save("shot_layers", layer.id, layer)} className="rounded border px-2 py-1.5">保存图层</button>
                    </div>
                    <JsonDetails table="shot_layers" id={layer.id} row={layer} onSave={saveJson} />
                  </div>
                );
              })}
              {shotLayers.length === 0 && <p className="mt-1 text-zinc-400">无图层（纯背景/黑场）</p>}
            </div>
          );
        })}
      </section>

      {/* 风格圣经 / 线索 */}
      <section className="space-y-3">
        <h2 className="font-semibold">风格圣经 / 线索</h2>
        {data?.styleBible && (
          <div className="rounded-xl border border-zinc-200 p-4 text-xs">
            <div className="flex gap-2">
              <textarea
                value={String(cur(`style_bibles:${data.styleBible.id}`, data.styleBible, "visual_style") ?? "")}
                onChange={(e) => edit(`style_bibles:${data.styleBible.id}`, "visual_style", e.target.value)}
                rows={2}
                className="flex-1 rounded border border-zinc-300 px-2 py-1.5"
              />
              <button onClick={() => save("style_bibles", data.styleBible.id, data.styleBible)} className="rounded border px-3">保存</button>
            </div>
            <p className="mt-1 text-zinc-500">narration_tone：{data.styleBible.narration_tone} · version {data.styleBible.version} · {data.styleBible.status}</p>
            <JsonDetails table="style_bibles" id={data.styleBible.id} row={data.styleBible} onSave={saveJson} />
          </div>
        )}
        {data?.clues?.map((cl) => (
          <div key={cl.id} className="rounded-lg border border-zinc-200 p-3 text-xs">
            <p className="font-medium">{cl.name} <span className="text-zinc-400">{cl.clue_type}</span></p>
            <JsonDetails table="clues" id={cl.id} row={cl} onSave={saveJson} />
          </div>
        ))}
      </section>

      {/* 资产 prompt */}
      <section className="space-y-3">
        <h2 className="font-semibold">资产 prompt（改后需重跑对应 phase 生成新候选）</h2>
        {data?.assets?.map((a) => (
          <div key={a.id} className="rounded-lg border border-zinc-200 p-3 text-xs">
            <p className="font-medium">{a.kind} · {a.title ?? a.scene_key} · {a.status}</p>
            <textarea
              value={String(cur(`assets:${a.id}`, a, "prompt") ?? "")}
              onChange={(e) => edit(`assets:${a.id}`, "prompt", e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5"
            />
            <button onClick={() => save("assets", a.id, a)} className="mt-1 rounded border px-2 py-1">保存 prompt</button>
          </div>
        ))}
      </section>
    </main>
  );
}

function JsonDetails({
  table,
  id,
  row,
  onSave,
}: {
  table: string;
  id: string;
  row: any;
  onSave: (table: string, id: string, text: string) => Promise<void>;
}) {
  const [text, setText] = useState(() => JSON.stringify(row, null, 2));
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-zinc-400">高级 JSON 编辑</summary>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(10, text.split("\n").length + 1)}
        className="mt-2 w-full rounded border border-zinc-300 p-2 font-mono text-[11px]"
      />
      <button onClick={() => onSave(table, id, text)} className="mt-1 rounded border px-2 py-1">
        保存 JSON
      </button>
    </details>
  );
}
