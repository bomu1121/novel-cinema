"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { ImpactPill } from "@/components/ui/impact-pill";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { JobStepList } from "@/components/jobs/job-step-list";
import { StagedReviewPanel } from "@/components/jobs/staged-review-panel";
import { PlanSheet } from "@/components/jobs/plan-sheet";
import { ReviewInbox } from "@/components/jobs/review-inbox";
import { TimeMachine } from "@/components/jobs/time-machine";
import { CommandPalette } from "@/components/jobs/command-palette";
import { ShortcutHelp } from "@/components/ui/shortcut-help";
import { CostMeter } from "@/components/cost-meter";
import { MissionControl } from "@/components/jobs/mission-control";
import { useJob } from "@/lib/ui/use-job";
import type { GraphNode } from "@/lib/pipeline/graph";
import { CAMERAS, EMOTIONS, ENTER_EXIT, TRANSITIONS } from "@/lib/ui/enums";

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
  estimates?: Record<string, string>;
}

export default function WorkbenchPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [data, setData] = useState<WorkbenchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ node: string; label: string } | null>(null);
  const [rerunJobId, setRerunJobId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const toast = useToast();
  const rerunJob = useJob(bookId, rerunJobId);
  // 记录最近一次重跑的节点（staging 节点完成后进入审阅而非直接刷新）
  const [rerunNodeName, setRerunNodeName] = useState<string | null>(null);
  const isStagedNode = rerunNodeName === "adapt" || rerunNodeName === "storyboard";
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd+K 命令面板
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(() => {
    const pages: Array<[string, string, string]> = [
      ["bible", "全书档案 / 签核 A", `/books/${bookId}/bible`],
      ["script", "改编脚本 / 签核 B", `/books/${bookId}/script`],
      ["assets", "资产库 / 签核 C", `/books/${bookId}/assets`],
      ["storyboard", "分镜时间轴 / 签核 D", `/books/${bookId}/storyboard`],
      ["voice", "多角色配音 / 签核 E", `/books/${bookId}/voice`],
      ["render", "渲染 / 签核 F", `/books/${bookId}/render`],
      ["canvas", "分镜画布", `/books/${bookId}/canvas`],
    ];
    return [
      ...pages.map(([id, label, href]) => ({
        id: `page:${id}`,
        label: `打开 ${label}`,
        hint: "页面",
        run: () => {
          window.location.href = href;
        },
      })),
      ...(
        [
          ["analyze", "① 分析+风格候选"],
          ["adapt", "② 改编脚本"],
          ["assets-phase1", "③a 设定图+背景"],
          ["assets-phase2", "③b 表情变体"],
          ["storyboard", "④ 分镜"],
          ["voice", "⑤ 配音"],
        ] as const
      ).map(([node, label]) => ({
        id: `rerun:${node}`,
        label: `重跑 ${label}`,
        hint: "重跑",
        run: () => rerun(node, label),
      })),
    ];
  }, [bookId]);

  async function undo() {
    try {
      const res = await fetch(`/api/books/${bookId}/workbench/undo`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "撤销失败");
      toast.push("info", `已撤销对 ${json.table} 的修改`, undefined);
      await load();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : String(err));
    }
  }

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
    void load();
  }, [load]);

  // 时间机器回滚等跨组件数据变更后刷新
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener("novel-cinema:data-changed", handler);
    return () => window.removeEventListener("novel-cinema:data-changed", handler);
  }, [load]);

  // 重跑任务收尾：staging 节点完成后进入审阅（保留 jobId）；其余刷新编排台
  useEffect(() => {
    if (rerunJob.status === "succeeded") {
      if (isStagedNode) {
        toast.push("info", "变更清单已生成，进入逐条审阅（应用前不覆盖任何数据）", undefined);
        // 以下 setState 由 useJob 外部状态变化驱动，属订阅回调语义
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConfirming(null);
        return;
      }
      toast.push("success", "重跑完成，已刷新编排台", undefined);
      setConfirming(null);
      setRerunJobId(null);
      void load();
    } else if (rerunJob.status === "failed" || rerunJob.status === "cancelled") {
      toast.push(rerunJob.status === "failed" ? "error" : "info", rerunJob.error ?? "任务已取消", undefined);
      setRerunJobId(null);
      setRerunNodeName(null);
    }
    // load/toast 随 bookId 变化而变，不应重触发任务收尾逻辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerunJob.status, rerunJob.error]);

  function edit(key: string, field: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function save(table: string, id: string, row: any) {
    void row; // 保留行引用参数，实际以 edits 为准
    const patch = edits[`${table}:${id}`] ?? {};
    if (Object.keys(patch).length === 0) {
      toast.push("info", "没有修改", undefined);
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
        toast.push("error", json.error ?? "保存失败");
        return;
      }
      setEdits((prev) => {
        const next = { ...prev };
        delete next[`${table}:${id}`];
        return next;
      });
      toast.push("success", `已保存 ${table}:${id.slice(0, 6)}`, {
        label: "撤销",
        onAction: () => void undo(),
      });
      setError(null);
      await load();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : String(err));
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
        toast.push("error", json.error ?? "保存失败");
        return;
      }
      toast.push("success", `已保存 JSON（${table}）`, { label: "撤销", onAction: () => void undo() });
      setError(null);
      await load();
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : "JSON 解析失败：" + String(err));
    }
  }

  async function executeRerun(node: string) {
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.push("error", json.error ?? `入队失败（HTTP ${res.status}）`);
        return;
      }
      setRerunNodeName(node);
      setRerunJobId(json.jobId as string);
    } catch (err) {
      toast.push("error", err instanceof Error ? err.message : String(err));
    }
  }

  function rerun(node: string, label: string) {
    setConfirming({ node, label });
  }

  const cur = (key: string, row: any, field: string) => edits[key]?.[field] ?? row?.[field];

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-12">
      <PageHeader
        title="编排台"
        meta="中间态可视化 + 高级 JSON + 节点重跑"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
      />

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <CostMeter bookId={bookId} />
      <MissionControl bookId={bookId} />
      <ReviewInbox bookId={bookId} />
      <TimeMachine bookId={bookId} />

      <CommandPalette open={paletteOpen} items={paletteItems} onClose={() => setPaletteOpen(false)} />
      <ShortcutHelp
        items={[
          { keys: "⌘K", label: "打开命令面板" },
          { keys: "Enter", label: "执行当前节点重跑" },
          { keys: "Esc", label: "关闭弹层" },
          { keys: "?", label: "打开/关闭快捷键帮助" },
        ]}
      />

      {/* 重跑按钮 */}
      <SectionCard title="节点重跑（确认后覆盖该节点及下游）">
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
            <Button
              key={node}
              size="sm"
              variant="secondary"
              onClick={() => rerun(node, label)}
              disabled={busy !== null}
              loading={busy === `rerun:${node}`}
            >
              {label}
            </Button>
          ))}
        </div>

          {confirming && (
            <div className="mt-3">
              <PlanSheet
                bookId={bookId}
                node={confirming.node as GraphNode}
                busy={rerunJob.status === "running" || rerunJob.status === "pending"}
                onExecute={() => executeRerun(confirming.node)}
                onCancel={() => setConfirming(null)}
              />
              {rerunJobId && (
                <JobStepList
                  className="mt-2"
                  state={rerunJob}
                  onCancel={() => void rerunJob.cancel()}
                />
              )}
            </div>
          )}
          {isStagedNode && rerunJobId && rerunJob.status === "succeeded" && (
            <StagedReviewPanel
              bookId={bookId}
              jobId={rerunJobId}
              nodeLabel={`「${rerunNodeName}」变更审阅`}
              className="mt-3"
              onApplied={(result) => {
                toast.push("success", `已应用 ${result.applied} 处变更（驳回 ${result.rejected}）`, undefined);
                setRerunJobId(null);
                setRerunNodeName(null);
                void load();
              }}
              onDiscarded={() => {
                toast.push("info", "已放弃本次变更，数据未改动", undefined);
                setRerunJobId(null);
                setRerunNodeName(null);
                void load();
              }}
            />
          )}

        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-muted">
          章节 {data?.chapters?.length ?? 0} · 人物 {data?.characters?.length ?? 0} · beats{" "}
          {data?.beats?.length ?? 0} · 镜头 {data?.shots?.length ?? 0} · 图层 {data?.layers?.length ?? 0} · 资产{" "}
          {data?.assets?.length ?? 0}
          <span className="inline-flex items-center gap-1.5">
            timeline
            <StatusPill table="timelines" status={data?.timeline?.status} />
            {data?.timeline && (
              <ImpactPill bookId={bookId} table="timelines" rowId={data.timeline.id} status={data.timeline.status} />
            )}
          </span>
        </p>
      </SectionCard>

      {/* 人物与配音 */}
      <section className="space-y-3">
        <h2 className="font-semibold">人物 / 配音表</h2>
        {data?.characters?.map((c) => (
          <Card key={c.id} className="text-sm">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 text-xs">
                名字
                <Input
                  value={String(cur(`characters:${c.id}`, c, "canonical_name") ?? "")}
                  onChange={(e) => edit(`characters:${c.id}`, "canonical_name", e.target.value)}
                  className="mt-1"
                />
              </label>
              <label className="flex-1 text-xs">
                别名（逗号分隔）
                <Input
                  value={Array.isArray(cur(`characters:${c.id}`, c, "aliases")) ? (cur(`characters:${c.id}`, c, "aliases") as string[]).join(",") : (c.aliases ?? []).join(",")}
                  onChange={(e) =>
                    edit(`characters:${c.id}`, "aliases", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                  }
                  className="mt-1"
                />
              </label>
              <label className="flex-1 text-xs">
                声线
                <Select
                  aria-label="声线"
                  value={String(cur(`characters:${c.id}`, c, "voice_profile_id") ?? "")}
                  onChange={(e) => edit(`characters:${c.id}`, "voice_profile_id", e.target.value || null)}
                  className="mt-1"
                >
                  <option value="">（未绑定）</option>
                  {(data?.voiceProfiles ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.provider_voice_id}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex-1 text-xs">
                描述
                <Input
                  value={String(cur(`characters:${c.id}`, c, "description") ?? "")}
                  onChange={(e) => edit(`characters:${c.id}`, "description", e.target.value)}
                  className="mt-1"
                />
              </label>
              <button
                onClick={() => save("characters", c.id, c)}
                disabled={busy !== null}
                className="rounded border border-border-strong px-3 py-1.5 text-xs hover:border-text disabled:opacity-50"
              >
                保存
              </button>
            </div>
            <JsonDetails table="characters" id={c.id} row={c} onSave={saveJson} />
          </Card>
        ))}

        {data?.voiceProfiles?.map((v) => (
          <Card key={v.id} className="text-xs">
            <div className="flex flex-wrap items-end gap-2">
              <span className="font-medium">{v.name}（{v.role}）</span>
              <Input
                value={String(cur(`voice_profiles:${v.id}`, v, "provider_voice_id") ?? "")}
                onChange={(e) => edit(`voice_profiles:${v.id}`, "provider_voice_id", e.target.value)}
                className="max-w-72"
                aria-label="火山音色 ID"
                placeholder="火山音色 ID"
              />
              <button onClick={() => save("voice_profiles", v.id, v)} className="rounded border px-2 py-1">保存</button>
            </div>
            <p className="mt-1 text-text-muted">提示：改声线后，配音页“重录”才会用新声线。</p>
          </Card>
        ))}
      </section>

      {/* 说话人 */}
      <section className="space-y-3">
        <h2 className="font-semibold">说话人（beat → 谁来说）</h2>
        {data?.beats?.map((b) => (
          <Card key={b.id} className="text-xs">
            <div className="flex flex-wrap items-start gap-2">
              <span className="mt-2 w-8">#{b.idx}</span>
              <Select
                aria-label="说话人"
                value={String(cur(`beats:${b.id}`, b, "character_id") ?? "")}
                onChange={(e) => edit(`beats:${b.id}`, "character_id", e.target.value || null)}
                className="max-w-40"
              >
                <option value="">旁白</option>
                {(data?.characters ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.canonical_name}</option>
                ))}
              </Select>
              <Select
                aria-label="说话类型"
                value={String(cur(`beats:${b.id}`, b, "speaker_type") ?? "narrator")}
                onChange={(e) => edit(`beats:${b.id}`, "speaker_type", e.target.value)}
                className="max-w-32"
              >
                <option value="narrator">旁白</option>
                <option value="character">角色</option>
                <option value="onscreen_text">屏幕文字</option>
                <option value="none">无</option>
              </Select>
              <Select
                aria-label="情绪"
                value={String(cur(`beats:${b.id}`, b, "emotion") ?? "neutral")}
                onChange={(e) => edit(`beats:${b.id}`, "emotion", e.target.value)}
                className="max-w-36"
              >
                {EMOTIONS.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </Select>
              <Textarea
                aria-label="台词"
                value={String(cur(`beats:${b.id}`, b, "text") ?? "")}
                onChange={(e) => edit(`beats:${b.id}`, "text", e.target.value)}
                rows={2}
                className="min-w-64 flex-1"
              />
              <button onClick={() => save("beats", b.id, b)} className="rounded border px-2 py-1.5">保存</button>
            </div>
            <p className="mt-1 text-text-muted">
              画面：{b.visual_note} · {b.estimated_duration_sec}s · 出处 {b.source_span?.start_char}–{b.source_span?.end_char}
            </p>
          </Card>
        ))}
      </section>

      {/* 镜头与图层 */}
      <section className="space-y-3">
        <h2 className="font-semibold">镜头 / 人物图像 / 入场出场</h2>
        {data?.shots?.map((shot) => {
          const shotLayers = (data?.layers ?? []).filter((l) => l.shot_id === shot.id);
          return (
            <Card key={shot.id} className="text-xs">
              <div className="flex flex-wrap items-end gap-2">
                <span className="font-medium">beat#{shot.beat_id?.slice(0, 4)} · shot{shot.idx}</span>
                <Select
                  aria-label="机位"
                  value={String(cur(`shots:${shot.id}`, shot, "camera") ?? "static")}
                  onChange={(e) => edit(`shots:${shot.id}`, "camera", e.target.value)}
                  className="max-w-40"
                >
                  {CAMERAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Select
                  aria-label="入场转场"
                  value={String(cur(`shots:${shot.id}`, shot, "transition_in") ?? "cut")}
                  onChange={(e) => edit(`shots:${shot.id}`, "transition_in", e.target.value)}
                  className="max-w-40"
                >
                  {TRANSITIONS.map((t) => <option key={t} value={t}>进:{t}</option>)}
                </Select>
                <Select
                  aria-label="退场转场"
                  value={String(cur(`shots:${shot.id}`, shot, "transition_out") ?? "cut")}
                  onChange={(e) => edit(`shots:${shot.id}`, "transition_out", e.target.value)}
                  className="max-w-40"
                >
                  {TRANSITIONS.map((t) => <option key={t} value={t}>出:{t}</option>)}
                </Select>
                <Input
                  aria-label="镜头时长"
                  type="number" step={0.5} min={0.5}
                  value={Number(cur(`shots:${shot.id}`, shot, "duration_sec") ?? 0)}
                  onChange={(e) => edit(`shots:${shot.id}`, "duration_sec", Number(e.target.value))}
                  className="max-w-20"
                />
                <button onClick={() => save("shots", shot.id, shot)} className="rounded border px-2 py-1.5">保存镜头</button>
              </div>

              {shotLayers.map((layer) => {
                const charAssets = (data?.assets ?? []).filter(
                  (a) => (a.kind === "expression" || a.kind === "character_ref") && (layer.character_id ? a.character_id === layer.character_id : true),
                );
                return (
                  <div key={layer.id} className="mt-2 rounded-lg bg-surface-2 p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <span className="font-medium">{layer.kind}·layer{layer.idx}</span>
                      <Select
                        aria-label="图层人物"
                        value={String(cur(`shot_layers:${layer.id}`, layer, "character_id") ?? "")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "character_id", e.target.value || null)}
                        className="max-w-40"
                      >
                        <option value="">（无人物）</option>
                        {(data?.characters ?? []).map((c) => <option key={c.id} value={c.id}>{c.canonical_name}</option>)}
                      </Select>
                      <Select
                        aria-label="图层图像"
                        value={String(cur(`shot_layers:${layer.id}`, layer, "asset_id") ?? "")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "asset_id", e.target.value || null)}
                        className="max-w-64"
                      >
                        <option value="">（无图）</option>
                        {charAssets.map((a) => (
                          <option key={a.id} value={a.id}>{a.title ?? a.scene_key}</option>
                        ))}
                      </Select>
                      <Select
                        aria-label="入场动画"
                        value={String(cur(`shot_layers:${layer.id}`, layer, "enter_animation") ?? "none")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "enter_animation", e.target.value)}
                        className="max-w-36"
                      >
                        {ENTER_EXIT.map((x) => <option key={x} value={x}>入场:{x}</option>)}
                      </Select>
                      <Select
                        aria-label="退场动画"
                        value={String(cur(`shot_layers:${layer.id}`, layer, "exit_animation") ?? "none")}
                        onChange={(e) => edit(`shot_layers:${layer.id}`, "exit_animation", e.target.value)}
                        className="max-w-36"
                      >
                        {ENTER_EXIT.map((x) => <option key={x} value={x}>退场:{x}</option>)}
                      </Select>
                      <button onClick={() => save("shot_layers", layer.id, layer)} className="rounded border px-2 py-1.5">保存图层</button>
                    </div>
                    <JsonDetails table="shot_layers" id={layer.id} row={layer} onSave={saveJson} />
                  </div>
                );
              })}
              {shotLayers.length === 0 && <p className="mt-1 text-text-subtle">无图层（纯背景/黑场）</p>}
            </Card>
          );
        })}
      </section>

      {/* 风格圣经 / 线索 */}
      <section className="space-y-3">
        <h2 className="font-semibold">风格圣经 / 线索</h2>
        {data?.styleBible && (
          <Card className="text-xs">
            <div className="flex gap-2">
              <Textarea
                aria-label="视觉风格"
                value={String(cur(`style_bibles:${data.styleBible.id}`, data.styleBible, "visual_style") ?? "")}
                onChange={(e) => edit(`style_bibles:${data.styleBible.id}`, "visual_style", e.target.value)}
                rows={2}
                className="flex-1"
              />
              <button onClick={() => save("style_bibles", data.styleBible.id, data.styleBible)} className="rounded border px-3">保存</button>
            </div>
            <p className="mt-1 text-text-muted">narration_tone：{data.styleBible.narration_tone} · version {data.styleBible.version} · <StatusPill table="style_bibles" status={data.styleBible.status} /></p>
            <JsonDetails table="style_bibles" id={data.styleBible.id} row={data.styleBible} onSave={saveJson} />
          </Card>
        )}
        {data?.clues?.map((cl) => (
          <Card key={cl.id} className="text-xs">
            <p className="font-medium">{cl.name} <span className="text-text-subtle">{cl.clue_type}</span></p>
            <JsonDetails table="clues" id={cl.id} row={cl} onSave={saveJson} />
          </Card>
        ))}
      </section>

      {/* 资产 prompt */}
      <section className="space-y-3">
        <h2 className="font-semibold">资产 prompt（改后需重跑对应 phase 生成新候选）</h2>
        {data?.assets?.map((a) => (
          <Card key={a.id} className="text-xs">
            <p className="font-medium">{a.kind} · {a.title ?? a.scene_key} · <StatusPill table="assets" status={a.status} /></p>
            <Textarea
              aria-label="资产 prompt"
              value={String(cur(`assets:${a.id}`, a, "prompt") ?? "")}
              onChange={(e) => edit(`assets:${a.id}`, "prompt", e.target.value)}
              rows={2}
              className="mt-1"
            />
            <button onClick={() => save("assets", a.id, a)} className="mt-1 rounded border px-2 py-1">保存 prompt</button>
          </Card>
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
      <summary className="cursor-pointer text-text-subtle">高级 JSON 编辑</summary>
      <Textarea
        mono
        aria-label="高级 JSON"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(10, text.split("\n").length + 1)}
        className="mt-2"
      />
      <button onClick={() => onSave(table, id, text)} className="mt-1 rounded border px-2 py-1">
        保存 JSON
      </button>
    </details>
  );
}

