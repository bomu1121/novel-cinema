"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { JobStepList } from "@/components/jobs/job-step-list";
import { useJob } from "@/lib/ui/use-job";
import { CAMERAS, EMOTIONS, ENTER_EXIT, TRANSITIONS } from "@/lib/ui/enums";
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

interface CanvasData {
  beats?: any[];
  shots?: any[];
  layers?: any[];
  assets?: any[];
  characters?: any[];
  voiceTakes?: any[];
  timeline?: any;
  estimates?: Record<string, string>;
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
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [confirmingNode, setConfirmingNode] = useState<string | null>(null);
  const [rerunJobId, setRerunJobId] = useState<string | null>(null);
  const rerunJob = useJob(bookId, rerunJobId);
  const [shotPreview, setShotPreview] = useState<{ shotId: string; url: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [flowRendering, setFlowRendering] = useState(false);
  const [flowVideoUrl, setFlowVideoUrl] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const toast = useToast();

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

  const undo = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/workbench/undo`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "撤销失败");
      toast.push("info", "已撤销上一次修改", undefined);
      await load();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : String(err));
    }
  }, [bookId, toast, load]);

  useEffect(() => {
    // 挂载后拉取画布数据；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const assetsById = useMemo(() => new Map((data.assets ?? []).map((a: any) => [a.id, a])), [data.assets]);
  const charactersById = useMemo(() => new Map((data.characters ?? []).map((c: any) => [c.id, c])), [data.characters]);
  const takeByBeat = useMemo(
    () => new Map((data.voiceTakes ?? []).map((t: any) => [t.beat_id, t])),
    [data.voiceTakes],
  );

  // ---- 乐观自动保存（docs/06 P3）：本地即改（edits 优先渲染），防抖 500ms 后 PATCH ----
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const edit = useCallback((key: string, field: string, value: unknown) => {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }, []);

  const cur = (key: string, row: any, field: string) => edits[key]?.[field] ?? row?.[field];

  const autoSave = useCallback(
    (table: string, id: string, patch: Record<string, unknown>) => {
      const key = `${table}:${id}`;
      if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
      saveTimers.current[key] = setTimeout(async () => {
        try {
          const res = await fetch(`/api/books/${bookId}/workbench/${table}/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patch }),
          });
          const json = await res.json();
          if (!res.ok) {
            toast.push("error", json.error ?? "保存失败");
            return;
          }
          // 合并进本地数据（避免整页重载），并清掉暂存
          setData((prev) => {
            const listKey = table === "shots" ? "shots" : table === "beat" ? "beats" : table;
            const rows = (prev as any)[listKey] ?? [];
            return {
              ...prev,
              [listKey]: rows.map((row: any) => (row.id === id ? { ...row, ...patch } : row)),
            };
          });
          setEdits((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          toast.push("success", `已保存${table === "beats" ? " beat（改人后记得重配音本句）" : ""}`, {
            label: "撤销",
            onAction: () => void undo(),
          });
        } catch (err) {
          toast.push("error", err instanceof Error ? err.message : String(err));
        }
      }, 500);
    },
    [bookId, toast, undo],
  );

  // 编辑即存（乐观）：本地立即可见 + 防抖落库
  function quickEdit(table: "beats" | "shots" | "shot_layers", rowId: string, field: string, value: unknown) {
    edit(`${table}:${rowId}`, field, value);
    autoSave(table, rowId, { [field]: value });
  }

  // 单句重录（画布内完成，4 步 1 屏）
  const [redoBusy, setRedoBusy] = useState(false);
  async function redoTake(takeId: string) {
    setRedoBusy(true);
    try {
      const res = await fetch(`/api/books/${bookId}/voice/${takeId}/redo`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) toast.push("error", json.error ?? "重录失败");
      else toast.push("success", "本句已重录（ASR 复核通过则自动生效）", { label: "撤销", onAction: () => void undo() });
      await load();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : String(err));
    } finally {
      setRedoBusy(false);
    }
  }

  // ---- 镜头时长拖拽（画布直接操纵）----
  const resizeState = useRef<{ shotId: string; startX: number; baseSec: number } | null>(null);
  const handleResizeStart = useCallback(
    (e: React.PointerEvent, shotId: string, baseSec: number) => {
      e.stopPropagation();
      resizeState.current = { shotId, startX: e.clientX, baseSec };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [],
  );
  const handleResizeMove = useCallback(
    (e: React.PointerEvent) => {
      const st = resizeState.current;
      if (!st) return;
      const deltaSec = (e.clientX - st.startX) / PX_PER_SEC;
      const next = Math.max(0.5, Math.round((st.baseSec + deltaSec) * 10) / 10);
      // 本地即时生效（节点宽度跟随），防抖落库
      edit(`shots:${st.shotId}`, "duration_sec", next);
      setData((prev) => ({
        ...prev,
        shots: (prev.shots ?? []).map((s: any) => (s.id === st.shotId ? { ...s, duration_sec: next } : s)),
      }));
      autoSave("shots", st.shotId, { duration_sec: next });
    },
    [edit, autoSave],
  );
  const handleResizeEnd = useCallback(() => {
    resizeState.current = null;
  }, []);

  // ---- 画布快捷键（B 选 beat / S 选镜头 / R 重跑分镜 / Esc 关闭）----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const beats = data.beats ?? [];
      const shots = data.shots ?? [];
      if (ev.key === "Escape") {
        setConfirmingNode(null);
      } else if (ev.key === "b" || ev.key === "B") {
        const idx = beats.findIndex((b: any) => b.id === selectedBeatId);
        const next = beats[(idx + 1) % beats.length];
        if (next) {
          setSelectedBeatId(next.id);
          setSelectedShotId(null);
        }
      } else if (ev.key === "s" || ev.key === "S") {
        const idx = shots.findIndex((s: any) => s.id === selectedShotId);
        const next = shots[(idx + 1) % shots.length];
        if (next) {
          setSelectedShotId(next.id);
          setSelectedBeatId(null);
        }
      } else if (ev.key === "r" || ev.key === "R") {
        setConfirmingNode("storyboard");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.beats, data.shots, selectedBeatId, selectedShotId]);

  // ---- AI 建议 chips：重复机位 / 缺配音 → PlanSheet → 审阅 ----
  const suggestions = useMemo(() => {
    const shots = (data.shots ?? []) as any[];
    const runs: Array<{ camera: string; count: number }> = [];
    let cur: { camera: string; count: number } | null = null;
    for (const s of shots) {
      if (cur && cur.camera === s.camera) cur.count += 1;
      else {
        if (cur && cur.count >= 3) runs.push({ ...cur });
        cur = { camera: s.camera, count: 1 };
      }
    }
    if (cur && cur.count >= 3) runs.push({ ...cur });
    const missingVoice = (data.beats ?? []).filter((b: any) => {
      if (b.speaker_type !== "narrator" && b.speaker_type !== "character") return false;
      return !takeByBeat.has(b.id);
    }).length;
    return { runs, missingVoice };
  }, [data.beats, data.shots, takeByBeat]);

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
    // React Compiler 对本组件既有手工 memo 的静态分析误报，维持现状（每次渲染开销可忽略）
    // eslint-disable-next-line react-hooks/refs
    beats.forEach((beat: any) => {
      const beatShots = shotsByBeat.get(beat.id) ?? [];

      // 布局不变式：beat 卡宽度 = max(150, 时长比例, 所有镜头卡总宽+间隔)，镜头永不出界、永不互叠
      const shotWidths = beatShots.map((shot: any) =>
        Math.max(168, Number(shot.duration_sec || 1) * PX_PER_SEC - 6),
      );
      const shotSpan = shotWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, beatShots.length - 1) * 8;
      const beatW = Math.max(150, Number(beat.estimated_duration_sec || 2) * PX_PER_SEC, shotSpan);

      const beatId = `beat-${beat.id}`;
      const char = beat.character_id ? charactersById.get(beat.character_id) : null;
      const take = takeByBeat.get(beat.id);
      nodes.push({
        id: beatId,
        type: "beatNode",
        position: { x: cursor, y: 40 },
        data: {
          beatId: beat.id,
          idx: beat.idx,
          type: beat.type,
          speaker: char?.canonical_name ?? "旁白",
          text: beat.text,
          status: beat.status,
          duration: beat.estimated_duration_sec,
          voice: take
            ? {
                status: take.status,
                asr: take.asr_confidence,
                error: Boolean(take.error),
                url: take.url,
              }
            : null,
        },
        style: { width: beatW, height: 86 },
      });

      let sx = 0;
      beatShots.forEach((shot: any, shotIndex: number) => {
        const shotW = shotWidths[shotIndex];
        const shotH = Math.round(shotW * (9 / 16)); // 与成片 16:9 同比例
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
            onResizeStart: handleResizeStart,
            onResizeMove: handleResizeMove,
            onResizeEnd: handleResizeEnd,
            layers: shotLayers.map((l: any) => ({
              layerId: l.id,
              asset: l.asset_id ? assetsById.get(l.asset_id) : null,
              characterId: l.character_id,
              characterName: l.character_id ? charactersById.get(l.character_id)?.canonical_name : null,
              enter: l.enter_animation,
              exit: l.exit_animation,
              motion: l.motion,
            })),
          },
          style: { width: shotW, height: shotH },
        });
        edges.push({ id: `${beatId}->${shotId}`, source: beatId, target: shotId, type: "smoothstep" });
        sx += shotW + 8;
      });
      cursor += beatW + 18;
    });
    return { nodes, edges };
  }, [data, assetsById, charactersById, takeByBeat, handleResizeStart, handleResizeMove, handleResizeEnd]);

  const selectedShot = data.shots?.find((s: any) => s.id === selectedShotId);
  const selectedLayers = (data.layers ?? []).filter((l: any) => l.shot_id === selectedShotId);
  const selectedBeat = data.beats?.find((b: any) => b.id === selectedBeatId);
  const selectedTake = takeByBeat.get(selectedBeatId ?? "");

  async function previewShot(shotId: string) {
    setPreviewBusy(shotId);
    toast.push("progress", "正在渲染单镜头预览（约 2~5 秒）…", undefined);
    try {
      const res = await fetch(`/api/books/${bookId}/preview/shot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "预览失败");
      setShotPreview({ shotId, url: json.url });
      toast.push("success", "镜头预览已生成", undefined);
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewBusy(null);
    }
  }

  async function startFlowPreview() {
    setFlowRendering(true);
    setFlowVideoUrl(null);
    toast.push("progress", "全片渲染已启动，正在后台生成…", undefined);
    try {
      const res = await fetch(`/api/books/${bookId}/render/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "启动失败");
      pollFlow();
    } catch (err) {
      setFlowRendering(false);
      toast.push("error", err instanceof Error ? err.message : String(err));
    }
  }

  function pollFlow() {
    window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/books/${bookId}/render`);
        const json = await res.json();
        const job = json.jobs?.[0];
        if (job?.status === "running" || job?.status === "queued") {
          pollFlow();
        } else if (job?.status === "succeeded") {
          setFlowRendering(false);
          setFlowVideoUrl(job.url);
          toast.push("success", "全片预览完成，可在下方播放", undefined);
        } else {
          setFlowRendering(false);
          toast.push("error", job?.error?.message ?? "渲染失败");
        }
      } catch (err) {
        setFlowRendering(false);
        toast.push("error", err instanceof Error ? err.message : String(err));
      }
    }, 3000);
  }

  async function executeRerun(node: string) {
    try {
      const res = await fetch(`/api/books/${bookId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node }),
      });
      const json = await res.json();
      if (!res.ok) toast.push("error", json.error ?? "入队失败");
      else setRerunJobId(json.jobId as string);
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : String(err));
    }
  }

  // 重跑任务收尾：成功刷新画布，失败提示，均收起确认卡
  useEffect(() => {
    if (!rerunJobId) return;
    if (rerunJob.status === "succeeded") {
      toast.push("success", "重跑完成，画布已刷新", undefined);
      // 以下 setState 由 useJob 外部状态变化驱动，属订阅回调语义
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirmingNode(null);
      setRerunJobId(null);
      void load();
    } else if (rerunJob.status === "failed" || rerunJob.status === "cancelled") {
      toast.push(rerunJob.status === "failed" ? "error" : "info", rerunJob.error ?? "任务已取消", undefined);
      setRerunJobId(null);
    }
    // load/toast 随 bookId 变化而变，不应重触发任务收尾逻辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerunJob.status, rerunJob.error, rerunJobId]);

  function rerun(node: string) {
    setConfirmingNode(node);
  }

  const [draggingAsset, setDraggingAsset] = useState(false);
  const [dropShake, setDropShake] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDraggingAsset(false);
    const assetId = e.dataTransfer.getData("application/x-asset-id");
    if (!assetId) return;
    const asset = assetsById.get(assetId);
    if (!asset || asset.kind === "background") {
      toast.push("error", "只能把角色图（设定图/表情）拖到镜头上；背景请在镜头属性里换。");
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
      // 错放反馈：资产池抖动提示
      setDropShake(true);
      window.setTimeout(() => setDropShake(false), 600);
      toast.push("error", "没有拖到镜头上。");
      return;
    }
    const shotId = String(hit.data?.shotId);
    const shotLayers = (data.layers ?? []).filter((l: any) => l.shot_id === shotId && l.kind === "character");
    const target =
      shotLayers.find((l: any) => l.character_id === asset.character_id) ??
      shotLayers[0];
    if (!target) {
      toast.push("error", "该镜头还没有人物图层：先在右侧检查器把某图层的人物绑定好，或到编排台修改。");
      return;
    }
    // 落地反馈：选中目标镜头（检查器联动）+ 乐观保存
    setSelectedShotId(shotId);
    setSelectedBeatId(null);
    autoSave("shot_layers", target.id, { asset_id: assetId });
    setData((prev) => ({
      ...prev,
      layers: (prev.layers ?? []).map((l: any) => (l.id === target.id ? { ...l, asset_id: assetId } : l)),
    }));
    toast.push("success", "已替换人物图 · 可撤销", { label: "撤销", onAction: () => void undo() });
  }

  return (
    <div
      className={`flex h-screen w-screen bg-zinc-100 ${draggingAsset ? "ring-2 ring-inset ring-review/60" : ""}`}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* 左侧资产池 */}
      <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-zinc-300 bg-white p-3">
        <h2 className="text-sm font-bold">角色资产池（拖图上镜头）</h2>
        <p className="text-xs text-zinc-500">按角色分组；点「换图」或直接拖到镜头。快捷键 B/S 选对象 · R 重跑分镜。</p>

        {/* AI 建议 chips（docs/06 P3） */}
        {(suggestions.runs.length > 0 || suggestions.missingVoice > 0) && (
          <div className="space-y-1">
            {suggestions.runs.map((run) => (
              <button
                key={run.camera}
                type="button"
                onClick={() => setConfirmingNode("storyboard")}
                className="w-full rounded-lg border border-regen/40 bg-regen/10 px-2 py-1.5 text-left text-[11px] text-regen hover:bg-regen/20"
              >
                💡 连续 {run.count} 个镜头机位重复（{run.camera}），自动重排？
              </button>
            ))}
            {suggestions.missingVoice > 0 && (
              <button
                type="button"
                onClick={() => setConfirmingNode("voice")}
                className="w-full rounded-lg border border-regen/40 bg-regen/10 px-2 py-1.5 text-left text-[11px] text-regen hover:bg-regen/20"
              >
                💡 有 {suggestions.missingVoice} 句未配音，补齐？
              </button>
            )}
          </div>
        )}
        {(data.characters ?? []).map((c: any) => {
          const charAssets = (data.assets ?? []).filter(
            (a: any) => a.character_id === c.id && (a.kind === "expression" || a.kind === "character_ref"),
          );
          return (
            <div key={c.id}>
              <p className="mt-1 text-[11px] font-semibold text-zinc-500">
                {c.canonical_name}
                <span className="ml-1 text-zinc-300">{charAssets.length}</span>
              </p>
              <div className="grid grid-cols-2 gap-1">
                {charAssets.map((a: any) => (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-asset-id", a.id);
                      setDraggingAsset(true);
                    }}
                    onDragEnd={() => setDraggingAsset(false)}
                    className={`cursor-grab rounded-lg border border-zinc-200 p-1 active:cursor-grabbing hover:border-indigo-400 ${dropShake ? "animate-pulse" : ""}`}
                    title={a.prompt ?? ""}
                  >
                    {a.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={a.title ?? ""} className="h-16 w-full rounded object-cover" />
                    )}
                    <p className="mt-0.5 truncate text-[10px]">{a.expression ?? "设定图"}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500">背景（检查器里换）</p>
          {(data.assets ?? []).filter((a: any) => a.kind === "background").map((a: any) => (
            <div key={a.id} className="mt-1 flex items-center gap-1 rounded border border-zinc-200 p-1">
              {a.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt="" className="aspect-video w-full rounded object-cover" />
              )}
              <span className="truncate text-[10px]">{a.title ?? a.scene_key}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto space-y-2">
          <button onClick={() => rerun("storyboard")} className="w-full rounded-lg border border-zinc-900 px-2 py-2 text-xs">
            重跑分镜
          </button>
          <button onClick={() => rerun("voice")} className="w-full rounded-lg border px-2 py-2 text-xs">
            重跑配音
          </button>
          <Button
            onClick={startFlowPreview}
            loading={flowRendering}
            className="w-full"
          >
            ▶ 全片预览（后台渲染）
          </Button>
          {flowVideoUrl && (
            <video controls src={flowVideoUrl} className="w-full rounded-lg border bg-black" />
          )}
          {confirmingNode && (
            <div className="rounded-lg border border-review/40 bg-review/10 p-2 text-[10px] text-review">
              <p className="font-semibold">确认重跑？</p>
              <p className="mt-1 text-text-muted">{data.estimates?.[confirmingNode] ?? "影响未知"}</p>
              <div className="mt-1 flex gap-1">
                <Button size="sm" onClick={() => executeRerun(confirmingNode)} disabled={rerunJob.status === "running" || rerunJob.status === "pending"}>
                  执行
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirmingNode(null)}>取消</Button>
              </div>
              {rerunJobId && (
                <JobStepList className="mt-1.5" state={rerunJob} onCancel={() => void rerunJob.cancel()} />
              )}
            </div>
          )}
        </div>
      </aside>

      {/* 画布 */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={{ beatNode: BeatNode, shotNode: ShotNode }}
          onNodeClick={(_, n) => {
            if (n.type === "shotNode") {
              setSelectedShotId(String(n.data?.shotId));
              setSelectedBeatId(null);
            } else if (n.type === "beatNode") {
              setSelectedBeatId(String(n.data?.beatId));
              setSelectedShotId(null);
            } else {
              setSelectedShotId(null);
              setSelectedBeatId(null);
            }
          }}
          fitView
          minZoom={0.2}
        >
          <Background gap={18} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        <ErrorBanner message={error} onDismiss={() => setError(null)} className="absolute left-2 top-2 z-10" />
      </div>

      {/* 右侧检查器 */}
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-300 bg-white p-4 text-xs">
        <h2 className="text-sm font-bold">检查器</h2>
        {!selectedShot && !selectedBeat && (
          <p className="text-zinc-400">点击上方 beat 卡片改说话人/台词；点击镜头卡片改画面。</p>
        )}

        {selectedBeat && (
          <div className="rounded-lg border p-2">
            <p className="font-semibold">beat #{selectedBeat.idx} · {selectedBeat.type}</p>
            <label className="mt-1 block">说话人
              <select
                value={String(cur(`beat:${selectedBeat.id}`, selectedBeat, "character_id") ?? "")}
                onChange={(e) =>
                  quickEdit("beats", selectedBeat.id, "character_id", e.target.value || null)
                }
                className="mt-0.5 w-full rounded border px-2 py-1"
              >
                <option value="">旁白</option>
                {(data.characters ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.canonical_name}</option>
                ))}
              </select>
            </label>
            <label className="mt-1 block">台词 / 旁白稿
              <textarea
                value={String(cur(`beat:${selectedBeat.id}`, selectedBeat, "text") ?? "")}
                onChange={(e) => quickEdit("beats", selectedBeat.id, "text", e.target.value)}
                rows={3}
                className="mt-0.5 w-full rounded border px-2 py-1.5"
              />
            </label>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <label>情绪
                <select
                  value={String(cur(`beat:${selectedBeat.id}`, selectedBeat, "emotion") ?? "neutral")}
                  onChange={(e) => quickEdit("beats", selectedBeat.id, "emotion", e.target.value)}
                  className="mt-0.5 w-full rounded border px-1 py-1"
                >
                  {EMOTIONS.map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </label>
              <label>语速
                <input
                  type="number" step={0.05} min={0.8} max={1.3}
                  value={Number(cur(`beat:${selectedBeat.id}`, selectedBeat, "pace") ?? 1)}
                  onChange={(e) => quickEdit("beats", selectedBeat.id, "pace", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border px-1 py-1"
                />
              </label>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-400">
              自动保存{selectedTake?.error ? " · 本句有红项" : ""}
            </p>
            {selectedTake ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-1 w-full"
                loading={redoBusy}
                onClick={() => redoTake(selectedTake.id)}
              >
                🔊 重配音本句
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="mt-1 w-full"
                onClick={() => setConfirmingNode("voice")}
              >
                🔊 补配音（走重跑流程）
              </Button>
            )}
            <p className="mt-2 text-[10px] text-zinc-500">
              配音：{selectedTake ? <StatusPill table="voice_takes" status={selectedTake?.status} /> : "未合成"}
              {selectedTake?.asr_confidence != null ? ` · ASR ${Math.round(selectedTake.asr_confidence * 100)}%` : ""}
              {selectedTake?.error ? " · 有红项" : ""}
            </p>
            {selectedTake?.url && (
              <audio controls src={selectedTake.url} className="mt-1 h-8 w-full" />
            )}
          </div>
        )}

        {selectedShot && (
          <>
            {(() => {
              const firstLayer = selectedLayers.find((l: any) => l.kind === "character");
              const charAssets = (data.assets ?? []).filter(
                (a: any) =>
                  (a.kind === "expression" || a.kind === "character_ref") &&
                  (firstLayer?.character_id ? a.character_id === firstLayer.character_id : true),
              );
              const currentIdx = charAssets.findIndex((a: any) => a.id === firstLayer?.asset_id);
              const showAsset = charAssets[currentIdx >= 0 ? currentIdx : 0];
              return (
                <div className="rounded-lg border border-zinc-300 bg-zinc-900 p-1">
                  <div className="relative aspect-video">
                    {showAsset?.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={showAsset.url} alt="" className="h-full w-full object-contain" />
                    )}
                    <div className="absolute inset-x-0 bottom-1 flex justify-center gap-2">
                      <button
                        onClick={() => {
                          const next = charAssets[(currentIdx - 1 + charAssets.length) % charAssets.length];
                          if (next && firstLayer) {
                            quickEdit("shot_layers", firstLayer.id, "asset_id", next.id);
                            setData((prev) => ({
                              ...prev,
                              layers: (prev.layers ?? []).map((l: any) =>
                                l.id === firstLayer.id ? { ...l, asset_id: next.id } : l,
                              ),
                            }));
                          }
                        }}
                        className="rounded-full bg-white/80 px-2 py-0.5 text-xs"
                      >
                        ◀ 换图
                      </button>
                      <button
                        onClick={() => {
                          const next = charAssets[(currentIdx + 1) % charAssets.length];
                          if (next && firstLayer) {
                            quickEdit("shot_layers", firstLayer.id, "asset_id", next.id);
                            setData((prev) => ({
                              ...prev,
                              layers: (prev.layers ?? []).map((l: any) =>
                                l.id === firstLayer.id ? { ...l, asset_id: next.id } : l,
                              ),
                            }));
                          }
                        }}
                        className="rounded-full bg-white/80 px-2 py-0.5 text-xs"
                      >
                        换图 ▶
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-white/80">
                    <span>{showAsset?.title ?? "无人物图"}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => previewShot(selectedShot.id)}
                      disabled={previewBusy === selectedShot.id}
                      loading={previewBusy === selectedShot.id}
                      className="rounded bg-white/20 hover:bg-white/40"
                    >
                      ▶ 预览本镜头
                    </Button>
                  </div>
                  {shotPreview?.shotId === selectedShot.id && shotPreview && (
                    <video controls autoPlay src={shotPreview.url} className="mt-1 w-full rounded bg-black" />
                  )}
                </div>
              );
            })()}
            <div className="rounded-lg border p-2">
              <p className="font-semibold">镜头 {selectedShot.idx} <span className="font-normal text-zinc-400">（自动保存）</span></p>
              <label className="mt-1 block">机位
                <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "camera") ?? "static")}
                  onChange={(e) => quickEdit("shots", selectedShot.id, "camera", e.target.value)}
                  className="mt-0.5 w-full rounded border px-2 py-1">
                  {CAMERAS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="mt-1 block">时长（画布上拖镜头右缘更快）
                <input type="number" step={0.5} min={0.5}
                  value={Number(cur(`shot:${selectedShot.id}`, selectedShot, "duration_sec") ?? 0)}
                  onChange={(e) => quickEdit("shots", selectedShot.id, "duration_sec", Number(e.target.value))}
                  className="mt-0.5 w-full rounded border px-2 py-1" />
              </label>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <label>进
                  <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "transition_in") ?? "cut")}
                    onChange={(e) => quickEdit("shots", selectedShot.id, "transition_in", e.target.value)}
                    className="mt-0.5 w-full rounded border px-1 py-1">
                    {TRANSITIONS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label>出
                  <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "transition_out") ?? "cut")}
                    onChange={(e) => quickEdit("shots", selectedShot.id, "transition_out", e.target.value)}
                    className="mt-0.5 w-full rounded border px-1 py-1">
                    {TRANSITIONS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <label className="mt-1 block">背景图
                <select value={String(cur(`shot:${selectedShot.id}`, selectedShot, "background_asset_id") ?? "")}
                  onChange={(e) => quickEdit("shots", selectedShot.id, "background_asset_id", e.target.value || null)}
                  className="mt-0.5 w-full rounded border px-2 py-1">
                  <option value="">（黑场）</option>
                  {(data.assets ?? []).filter((a: any) => a.kind === "background").map((a: any) => (
                    <option key={a.id} value={a.id}>{a.title ?? a.scene_key}</option>
                  ))}
                </select>
              </label>
            </div>

            {selectedLayers.map((layer: any) => {
              const charAssets = (data.assets ?? []).filter(
                (a: any) => (a.kind === "expression" || a.kind === "character_ref") && (layer.character_id ? a.character_id === layer.character_id : true),
              );
              return (
                <div key={layer.id} className="rounded-lg border p-2">
                  <p className="font-semibold">图层 {layer.idx} · {layer.kind} <span className="font-normal text-zinc-400">（自动保存）</span></p>
                  <label className="mt-1 block">人物
                    <select value={String(cur(`layer:${layer.id}`, layer, "character_id") ?? "")}
                      onChange={(e) => quickEdit("shot_layers", layer.id, "character_id", e.target.value || null)}
                      className="mt-0.5 w-full rounded border px-2 py-1">
                      <option value="">（无）</option>
                      {(data.characters ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.canonical_name}</option>)}
                    </select>
                  </label>
                  <label className="mt-1 block">人物图
                    <select value={String(cur(`layer:${layer.id}`, layer, "asset_id") ?? "")}
                      onChange={(e) => quickEdit("shot_layers", layer.id, "asset_id", e.target.value || null)}
                      className="mt-0.5 w-full rounded border px-2 py-1">
                      <option value="">（无图）</option>
                      {charAssets.map((a: any) => <option key={a.id} value={a.id}>{a.title ?? a.scene_key}</option>)}
                    </select>
                  </label>
                  <div className="mt-1 space-y-1.5">
                    <div>
                      <p className="text-[10px] text-zinc-400">入场动画（点击即选）</p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {ENTER_EXIT.map((x) => (
                          <button
                            key={x}
                            type="button"
                            onClick={() => quickEdit("shot_layers", layer.id, "enter_animation", x)}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              String(cur(`layer:${layer.id}`, layer, "enter_animation") ?? "none") === x
                                ? "bg-review text-white"
                                : "bg-surface-2 text-text-muted hover:bg-surface-3"
                            }`}
                          >
                            {x === "none" ? "无" : x}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-400">退场动画</p>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {ENTER_EXIT.map((x) => (
                          <button
                            key={x}
                            type="button"
                            onClick={() => quickEdit("shot_layers", layer.id, "exit_animation", x)}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              String(cur(`layer:${layer.id}`, layer, "exit_animation") ?? "none") === x
                                ? "bg-review text-white"
                                : "bg-surface-2 text-text-muted hover:bg-surface-3"
                            }`}
                          >
                            {x === "none" ? "无" : x}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
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
  function playVoice(e: React.MouseEvent) {
    e.stopPropagation();
    if (data.voice?.url) {
      const audio = new Audio(data.voice.url);
      void audio.play();
    }
  }
  return (
    <div className={`h-full w-full rounded-xl border-2 bg-white p-2 shadow-sm ${data.status === "stale" ? "stale-flash border-stale/50" : "border-zinc-200"}`}>
      <p className="text-[11px] font-bold">
        #{data.idx} {data.type} · {data.speaker} · {Number(data.duration).toFixed(1)}s
        {data.voice ? (
          <button
            onClick={playVoice}
            title="试听本句"
            className={`ml-1 rounded px-1 text-[9px] ${
              data.voice.error
                ? "bg-stale/10 text-stale"
                : data.voice.status === "accepted"
                  ? "bg-approved/10 text-approved"
                  : "bg-regen/10 text-regen"
            }`}
          >
            {data.voice.status === "accepted" ? "🔊 试听" : data.voice.error ? "🔊⚠ 重录" : "🔊…"}
          </button>
        ) : null}
      </p>
      <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600">{data.text}</p>
    </div>
  );
}

function ShotNode({ data }: any) {
  const bgClass =
    data.camera === "ken_burns_in" ? "kb-in" : data.camera === "ken_burns_out" ? "kb-out" : data.camera.startsWith("pan") ? "kb-pan" : "";
  return (
    <div className={`relative h-full w-full overflow-hidden rounded-xl border-2 bg-zinc-900 ${data.status === "stale" ? "stale-flash border-stale/50" : "border-zinc-300"}`}>
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.backgroundUrl} alt="" className={`absolute inset-0 h-full w-full object-cover opacity-80 ${bgClass}`} />
      )}
      <div className="absolute bottom-0 left-0 flex max-w-full flex-wrap gap-1 p-1">
        {(data.layers ?? []).map((l: any, i: number) => (
          <div key={i} className="relative">
            {l.asset?.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.asset.url} alt="" className={`h-10 w-8 rounded border border-white/40 object-cover ${l.motion?.type === "breath" ? "kb-breath" : ""}`} />
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
      {/* 右缘时长手柄（docs/06 P3：拖右缘调时长） */}
      <div
        onPointerDown={(e) => data.onResizeStart?.(e, data.shotId, Number(data.duration))}
        onPointerMove={(e) => data.onResizeMove?.(e)}
        onPointerUp={() => data.onResizeEnd?.()}
        onPointerCancel={() => data.onResizeEnd?.()}
        title="拖动调整时长"
        className="absolute right-0 top-0 z-10 h-full w-2.5 cursor-ew-resize border-r-2 border-transparent bg-review/0 transition-colors duration-fast hover:border-review hover:bg-review/30"
      />
    </div>
  );
}




