"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const PX_PER_SEC = 24;
const CAMERAS = ["static", "ken_burns_in", "ken_burns_out", "pan_l", "pan_r", "push_in", "pull_out"];
const TRANSITIONS = ["cut", "crossfade", "fade_in", "fade_out", "slide", "dip_to_black"];
const ENTER_EXIT = ["none", "fade_in", "fade_out", "slide_left", "slide_right", "slide_up", "slide_down"];

interface CanvasData {
  beats?: any[];
  shots?: any[];
  layers?: any[];
  assets?: any[];
  characters?: any[];
  timeline?: any;
}

export default function StoryboardCanvasShell() {
  return (
    <ReactFlowProvider>
      <StoryboardCanvas />
    </ReactFlowProvider>
  );
}

function StoryboardCanvas() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const { screenToFlowPosition, getNodes } = useReactFlow();

  const [data, setData] = useState<CanvasData>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
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
    // 挂载后拉取画布数据；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const assetsById = useMemo(() => new Map((data.assets ?? []).map((a: any) => [a.id, a])), [data.assets]);
  const charactersById = useMemo(() => new Map((data.characters ?? []).map((c: any) => [c.id, c])), [data.characters]);

  const { nodes, edges } = useMemo(() => {
    const beats = data.beats ?? [];
    const shots = data.shots ?? [];
    const layers = data.layers ?? [];
    const shotsByBeat = new Map<string, any[]>();
    for (const s of shots) {
      const arr = shotsByBeat.get(s.beat_id) ?? [];
      arr.push(s);
      shotsByBeat.set(s.beat_id, arr);
    }
    const layersByShot = new Map<string, any[]>();
    for (const l of layers) {
      const arr = layersByShot.get(l.shot_id) ?? [];
      arr.push(l);
      layersByShot.set(l.shot_id, arr);
    }

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let cursor = 0;
    beats.forEach((beat: any) => {
      const beatW = Math.max(150, Number(beat.estimated_duration_sec || 2) * PX_PER_SEC);
      const beatId = `beat-${beat.id}`;
      const char = beat.character_id ? charactersById.get(beat.character_id) : null;
      nodes.push({
        id: beatId,
        type: "beatNode",
        position: { x: cursor, y: 40 },
        data: {
          idx: beat.idx,
          type: beat.type,
          speaker: char?.canonical_name ?? "旁白",
          text: beat.text,
          status: beat.status,
          duration: beat.estimated_duration_sec,
        },
        style: { width: beatW, height: 86 },
      });

      let sx = 0;
      const beatShots = shotsByBeat.get(beat.id) ?? [];
      beatShots.forEach((shot: any) => {
        const shotW = Math.max(110, Number(shot.duration_sec || 1) * PX_PER_SEC - 6);
        const shotLayers = layersByShot.get(shot.id) ?? [];
        const bg = shot.background_asset_id ? assetsById.get(shot.background_asset_id) : null;
        const shotId = `shot-${shot.id}`;
        nodes.push({
          id: shotId,
          type: "shotNode",
          position: { x: cursor + sx, y: 150 },
          data: {
            shotId: shot.id,
            camera: shot.camera,
            duration: shot.duration_sec,
            transitionIn: shot.transition_in,
            transitionOut: shot.transition_out,
            status: shot.status,
            backgroundUrl: bg?.url ?? null,
            layers: shotLayers.map((l: any) => ({
              layerId: l.id,
              asset: l.asset_id ? assetsById.get(l.asset_id) : null,
              characterId: l.character_id,
              characterName: l.character_id ? charactersById.get(l.character_id)?.canonical_name : null,
              enter: l.enter_animation,
              exit: l.exit_animation,
            })),
          },
          style: { width: shotW, height: 152 },
        });
        edges.push({ id: `${beatId}->${shotId}`, source: beatId, target: shotId, type: "smoothstep" });
        sx += shotW + 8;
      });
      cursor += beatW + 18;
    });
    return { nodes, edges };
  }, [data, assetsById, charactersById]);

  const selectedShot = data.shots?.find((s: any) => s.id === selectedShotId);
  const selectedLayers = (data.layers ?? []).filter((l: any) => l.shot_id === selectedShotId);

  async function patchShot(shotId: string, patch: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/books/${bookId}/workbench/shots/${shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "保存失败");
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
    }
  }

  async function patchLayer(layerId: string, patch: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/books/${bookId}/workbench/shot_layers/${layerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "保存失败");
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
    }
  }

  async function rerun(node: string) {
    try {
      const res = await fetch(`/api/books/${bookId}/workbench/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "重跑失败");
      else await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const assetId = e.dataTransfer.getData("application/x-asset-id");
    if (!assetId) return;
    const asset = assetsById.get(assetId);
    if (!asset || asset.kind === "background") {
      setError("只能把角色图（设定图/表情）拖到镜头上；背景请在镜头属性里换。");
      return;
    }
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const hit = getNodes().find((n: any) => {
      if (n.type !== "shotNode") return false;
      const w = (n.style?.width as number) ?? 0;
      const h = (n.style?.height as number) ?? 0;
      return pos.x >= n.position.x && pos.x <= n.position.x + w && pos.y >= n.position.y && pos.y <= n.position.y + h;
    });
    if (!hit) {
      setError("没有拖到镜头上。");
      return;
    }
    const shotId = String(hit.data?.shotId);
    const shotLayers = (data.layers ?? []).filter((l: any) => l.shot_id === shotId && l.kind === "character");
    const target =
      shotLayers.find((l: any) => l.character_id === asset.character_id) ??
      shotLayers[0];
    if (!target) {
      setError("该镜头还没有人物图层：先在右侧检查器把某图层的人物绑定好，或到编排台修改。");
      return;
    }
    void patchLayer(target.id, { asset_id: assetId });
  }

  function edit(key: string, field: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  const cur = (key: string, row: any, field: string) => edits[key]?.[field] ?? row?.[field];

  return (
    <div className="flex h-screen w-screen bg-zinc-100" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      {/* 左侧资产池 */}
      <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-zinc-300 bg-white p-3">
        <h2 className="text-sm font-bold">资产池（拖到镜头换人物图）</h2>
        <p className="text-xs text-zinc-500">角色图可拖；背景请在右侧换。</p>
        {(data.assets ?? []).map((a: any) =>
          a.kind === "expression" || a.kind === "character_ref" ? (
            <div
              key={a.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-asset-id", a.id)}
              className="cursor-grab rounded-lg border border-zinc-200 p-2 active:cursor-grabbing"
            >
              {a.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.title ?? ""} className="h-24 w-full rounded object-cover" />
              )}
              <p className="mt-1 truncate text-xs font-medium">{a.title ?? a.scene_key}</p>
              <p className="text-[10px] text-zinc-400">{a.status}</p>
            </div>
          ) : null,
        )}
        <div className="mt-auto space-y-2">
          <button onClick={() => rerun("storyboard")} className="w-full rounded-lg border border-zinc-900 px-2 py-2 text-xs">
            重跑分镜
          </button>
          <button onClick={() => rerun("voice")} className="w-full rounded-lg border px-2 py-2 text-xs">
            重跑配音
          </button>
        </div>
      </aside>

      {/* 画布 */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ beatNode: BeatNode, shotNode: ShotNode }}
          onNodeClick={(_, n) => setSelectedShotId(n.type === "shotNode" ? String(n.data?.shotId) : null)}
          fitView
          minZoom={0.2}
        >
          <Background gap={18} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {error && (
          <div className="absolute left-2 top-2 z-10 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">×</button>
          </div>
        )}
      </div>

      {/* 右侧检查器 */}
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-300 bg-white p-4 text-xs">
        <h2 className="text-sm font-bold">镜头检查器</h2>
        {!selectedShot && <p className="text-zinc-400">点击画布上的镜头卡片开始编辑。</p>}
        {selectedShot && (
          <>
            <div className="rounded-lg border p-2">
              <p className="font-semibold">镜头 {selectedShot.idx}</p>
              <label className="mt-1 block">机位
                <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "camera") ?? "static")}
                  onChange={(e) => edit(`shot:${selectedShot.id}`, "camera", e.target.value)}
                  className="mt-0.5 w-full rounded border px-2 py-1">
                  {CAMERAS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="mt-1 block">时长
                <input type="number" step={0.5} min={0.5}
                  value={Number(cur(`shot:${selectedShot.id}`, selectedShot, "duration_sec") ?? 0)}
                  onChange={(e) => edit(`shot:${selectedShot.id}`, "duration_sec", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border px-2 py-1" />
              </label>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <label>进
                  <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "transition_in") ?? "cut")}
                    onChange={(e) => edit(`shot:${selectedShot.id}`, "transition_in", e.target.value)}
                    className="mt-0.5 w-full rounded border px-1 py-1">
                    {TRANSITIONS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>出
                  <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "transition_out") ?? "cut")}
                    onChange={(e) => edit(`shot:${selectedShot.id}`, "transition_out", e.target.value)}
                    className="mt-0.5 w-full rounded border px-1 py-1">
                    {TRANSITIONS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <label className="mt-1 block">背景图
                <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "background_asset_id") ?? "")}
                  onChange={(e) => edit(`shot:${selectedShot.id}`, "background_asset_id", e.target.value || null)}
                  className="mt-0.5 w-full rounded border px-2 py-1">
                  <option value="">（黑场）</option>
                  {(data.assets ?? []).filter((a: any) => a.kind === "background").map((a: any) => (
                    <option key={a.id} value={a.id}>{a.title ?? a.scene_key}</option>
                  ))}
                </select>
              </label>
              <button onClick={() => patchShot(selectedShot.id, edits[`shot:${selectedShot.id}`] ?? {})}
                className="mt-2 w-full rounded-lg bg-zinc-900 py-1.5 text-white">保存镜头</button>
            </div>

            {selectedLayers.map((layer: any) => {
              const charAssets = (data.assets ?? []).filter(
                (a: any) => (a.kind === "expression" || a.kind === "character_ref") && (layer.character_id ? a.character_id === layer.character_id : true),
              );
              return (
                <div key={layer.id} className="rounded-lg border p-2">
                  <p className="font-semibold">图层 {layer.idx} · {layer.kind}</p>
                  <label className="mt-1 block">人物
                    <select value={String(cur(`layer:${layer.id}`, layer, "character_id") ?? "")}
                      onChange={(e) => edit(`layer:${layer.id}`, "character_id", e.target.value || null)}
                      className="mt-0.5 w-full rounded border px-2 py-1">
                      <option value="">（无）</option>
                      {(data.characters ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.canonical_name}</option>)}
                    </select>
                  </label>
                  <label className="mt-1 block">人物图
                    <select value={String(cur(`layer:${layer.id}`, layer, "asset_id") ?? "")}
                      onChange={(e) => edit(`layer:${layer.id}`, "asset_id", e.target.value || null)}
                      className="mt-0.5 w-full rounded border px-2 py-1">
                      <option value="">（无图）</option>
                      {charAssets.map((a: any) => <option key={a.id} value={a.id}>{a.title ?? a.scene_key}</option>)}
                    </select>
                  </label>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <label>入场
                      <select value={String(cur(`layer:${layer.id}`, layer, "enter_animation") ?? "none")}
                        onChange={(e) => edit(`layer:${layer.id}`, "enter_animation", e.target.value)}
                        className="mt-0.5 w-full rounded border px-1 py-1">
                        {ENTER_EXIT.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    </label>
                    <label>退场
                      <select value={String(cur(`layer:${layer.id}`, layer, "exit_animation") ?? "none")}
                        onChange={(e) => edit(`layer:${layer.id}`, "exit_animation", e.target.value)}
                        className="mt-0.5 w-full rounded border px-1 py-1">
                        {ENTER_EXIT.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    </label>
                  </div>
                  <button onClick={() => patchLayer(layer.id, edits[`layer:${layer.id}`] ?? {})}
                    className="mt-2 w-full rounded-lg border py-1">保存图层</button>
                </div>
              );
            })}
          </>
        )}
      </aside>
    </div>
  );
}

function BeatNode({ data }: any) {
  return (
    <div className={`h-full w-full rounded-xl border-2 bg-white p-2 shadow-sm ${data.status === "stale" ? "border-red-400" : "border-zinc-200"}`}>
      <p className="text-[11px] font-bold">
        #{data.idx} {data.type} · {data.speaker} · {Number(data.duration).toFixed(1)}s
      </p>
      <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600">{data.text}</p>
    </div>
  );
}

function ShotNode({ data }: any) {
  return (
    <div className={`relative h-full w-full overflow-hidden rounded-xl border-2 bg-zinc-900 ${data.status === "stale" ? "border-red-400" : "border-zinc-300"}`}>
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.backgroundUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
      )}
      <div className="absolute bottom-0 left-0 flex max-w-full flex-wrap gap-1 p-1">
        {(data.layers ?? []).map((l: any, i: number) => (
          <div key={i} className="relative">
            {l.asset?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.asset.url} alt="" className="h-10 w-8 rounded border border-white/40 object-cover" />
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[8px] text-white">
              {l.characterName ?? "?"}
            </span>
          </div>
        ))}
      </div>
      <div className="absolute left-0 top-0 w-full bg-gradient-to-b from-black/70 to-transparent p-1 text-[10px] text-white">
        <p className="font-semibold">{data.camera} · {Number(data.duration).toFixed(1)}s</p>
        <p className="text-white/70">
          {data.transitionIn} → {data.transitionOut}
          {(data.layers ?? []).some((l: any) => l.enter !== "none" || l.exit !== "none")
            ? ` · ${(data.layers ?? []).map((l: any) => `${l.characterName ?? ""}${l.enter !== "none" ? "进" + l.enter : ""}${l.exit !== "none" ? "退" + l.exit : ""}`).filter(Boolean).join(" ")}`
            : ""}
        </p>
      </div>
    </div>
  );
}

