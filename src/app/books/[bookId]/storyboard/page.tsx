"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ShortcutHelp } from "@/components/ui/shortcut-help";
import { PageShell } from "@/components/ui/page-shell";
import { JobRunner } from "@/components/jobs/job-runner";
import { StagedReviewPanel } from "@/components/jobs/staged-review-panel";
import { useToast } from "@/components/toast";

interface TrackLayer {
  kind: string;
  asset_url: string | null;
  text?: string;
  rect: { x: number; y: number; w: number; h: number };
  motion?: Record<string, unknown>;
}

interface Track {
  shotId: string;
  beatIdx: number;
  text: string;
  description: string;
  camera: string;
  duration_sec: number;
  transition_in: string;
  transition_out: string;
  background_url: string | null;
  layers: TrackLayer[];
}

interface StoryboardData {
  timeline: {
    id: string;
    status: string;
    duration_sec: number | null;
    version: number;
  } | null;
  chapter: {
    id: string;
    source_chapter_id: string;
    title: string | null;
    status: string;
  } | null;
  tracks: Track[];
  backgrounds: Array<{ id: string; title: string | null; url: string | null }>;
}

function cameraClass(camera: string): string {
  if (camera === "ken_burns_in") return "kb-in";
  if (camera === "ken_burns_out") return "kb-out";
  if (camera.startsWith("pan")) return "kb-pan";
  return "";
}

export default function StoryboardPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const toast = useToast();

  const [data, setData] = useState<StoryboardData>({
    timeline: null,
    chapter: null,
    tracks: [],
    backgrounds: [],
  });
  const [storyboardBlockers, setStoryboardBlockers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [approving, setApproving] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [backgrounds, setBackgrounds] = useState<Record<string, string>>({});
  const [stagedJobId, setStagedJobId] = useState<string | null>(null);

  // 挂载时接回未完成的审阅（刷新页面后恢复）
  useEffect(() => {
    fetch(`/api/books/${bookId}/staged`)
      .then((r) => r.json())
      .then((json) => {
        const g = (json.groups ?? []).find((x: { node: string }) => x.node === "storyboard");
        if (g?.jobId) setStagedJobId(g.jobId);
      })
      .catch(() => undefined);
  }, [bookId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/storyboard`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setData(json);
      setStoryboardBlockers(json.storyboardBlockers ?? []);
      const nextDurations: Record<string, number> = {};
      const nextBackgrounds: Record<string, string> = {};
      for (const t of json.tracks ?? []) {
        nextDurations[t.shotId] = t.duration_sec;
        nextBackgrounds[t.shotId] = t.background_url ?? "";
      }
      setDurations(nextDurations);
      setBackgrounds(nextBackgrounds);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [bookId]);

  useEffect(() => {
    // 挂载后拉取分镜；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/storyboard/approve`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "批准失败");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }

  async function saveShot(track: Track) {
    try {
      const res = await fetch(`/api/books/${bookId}/shots/${track.shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSec: durations[track.shotId],
          backgroundAssetId:
            backgrounds[track.shotId] === track.background_url
              ? undefined
              : data.backgrounds.find((b) => b.url === backgrounds[track.shotId])?.id ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "保存失败");
        return;
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        title="分镜时间轴"
        meta="签核点 D"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
        actions={
          <div className="flex gap-2">
            <JobRunner
              bookId={bookId}
              node="storyboard"
              label="构建分镜"
              disabled={approving || storyboardBlockers.length > 0}
              onRunningChange={setBuilding}
              onDone={(jobId) => {
                toast.push("info", "分镜已生成，进入逐条审阅（应用前不覆盖任何数据）", undefined);
                setStagedJobId(jobId);
              }}
            />
            {data.timeline && data.timeline.status !== "approved" && (
              <Button
                variant="approve"
                onClick={approve}
                disabled={approving || building}
                loading={approving}
              >
                批准分镜
              </Button>
            )}
          </div>
        }
      />

      {stagedJobId && (
        <StagedReviewPanel
          bookId={bookId}
          jobId={stagedJobId}
          nodeLabel="分镜构建审阅"
          onApplied={(result) => {
            toast.push("success", `已应用 ${result.applied} 处变更（驳回 ${result.rejected}）`, undefined);
            setStagedJobId(null);
            void load();
          }}
          onDiscarded={() => {
            toast.push("info", "已放弃本次构建，数据未改动", undefined);
            setStagedJobId(null);
            void load();
          }}
        />
      )}

      <ErrorBanner message={error} />

      {storyboardBlockers.length > 0 && (
        <div className="rounded-lg border border-stale/40 bg-stale/10 px-4 py-3 text-sm text-stale" role="alert">
          构建分镜暂不可用：{storyboardBlockers.join("；")}
        </div>
      )}

      {data.chapter && (
        <p className="text-sm text-text-muted">
          当前分镜基于改编章节：<span className="font-medium text-text">{data.chapter.title ?? "未命名章节"}</span>
        </p>
      )}

      {data.timeline && (
        <p className="text-sm text-text-muted">
          总时长 {(data.timeline.duration_sec ?? 0).toFixed(1)}s · {data.tracks.length} 个镜头 · 状态{" "}
          <StatusPill table="timelines" status={data.timeline.status} />
        </p>
      )}

      {data.tracks.length === 0 && !building && (
        <EmptyState description="还没有分镜。前置条件：改编脚本 → 资产生成（背景）→ 点“构建分镜”。" />
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {data.tracks.map((track) => (
          <Card key={track.shotId} className="w-72 shrink-0 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate font-medium text-text">
                #{track.beatIdx} · {track.camera}
              </span>
              <span className="shrink-0 tabular-nums text-text-muted">{track.duration_sec}s</span>
            </div>
            <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-invert">
              {track.background_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.background_url}
                  alt=""
                  className={`absolute inset-0 h-full w-full object-cover ${cameraClass(track.camera)}`}
                />
              )}
              {(track.layers ?? []).map((layer, i) => {
                if (layer.kind === "text" || layer.kind === "overlay") {
                  return (
                    <div
                      key={i}
                      className="absolute flex items-center justify-center"
                      style={{
                        left: `${(layer.rect.x - layer.rect.w / 2) * 100}%`,
                        top: `${(layer.rect.y - layer.rect.h / 2) * 100}%`,
                        width: `${layer.rect.w * 100}%`,
                        height: `${layer.rect.h * 100}%`,
                      }}
                    >
                      {layer.kind === "text" ? (
                        <p className="text-center font-semibold text-inverse [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
                          {layer.text}
                        </p>
                      ) : (
                        <div className="h-full w-full bg-surface-invert/80" />
                      )}
                    </div>
                  );
                }
                if (!layer.asset_url) return null;
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={layer.asset_url}
                    alt=""
                    className={`absolute object-contain ${layer.motion?.type === "breath" ? "kb-breath" : ""}`}
                    style={{
                      left: `${(layer.rect.x - layer.rect.w / 2) * 100}%`,
                      top: `${(layer.rect.y - layer.rect.h / 2) * 100}%`,
                      width: `${layer.rect.w * 100}%`,
                      height: `${layer.rect.h * 100}%`,
                    }}
                  />
                );
              })}
            </div>

            <p className="mt-2 font-medium">
              #{track.beatIdx} · {track.camera} · {track.duration_sec}s
            </p>
            <p className="mt-1 line-clamp-2 text-text-muted" title={track.text ?? ""}>
              {track.description ?? ""}
            </p>

            <div className="mt-2 flex items-center gap-1">
              <Input
                type="number"
                step={0.5}
                min={0.5}
                aria-label="镜头时长"
                value={durations[track.shotId] ?? track.duration_sec}
                onChange={(e) =>
                  setDurations((prev) => ({ ...prev, [track.shotId]: Number(e.target.value) }))
                }
                className="w-16"
              />
              <Select
                aria-label="背景"
                value={backgrounds[track.shotId] ?? ""}
                onChange={(e) =>
                  setBackgrounds((prev) => ({ ...prev, [track.shotId]: e.target.value }))
                }
                className="flex-1"
              >
                <option value="">（无背景）</option>
                {data.backgrounds.map((b) => (
                  <option key={b.id} value={b.url ?? ""}>
                    {b.title ?? b.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
              <button
                onClick={() => saveShot(track)}
                className="rounded border border-border-strong px-2 py-1 hover:border-text"
              >
                存
              </button>
            </div>
          </Card>
        ))}
      </div>

      <ShortcutHelp
        items={[
          { keys: "j / k", label: "审阅列表上下移动" },
          { keys: "a", label: "接受当前变更" },
          { keys: "r", label: "驳回当前变更" },
          { keys: "u", label: "撤销上一条决策" },
          { keys: "Enter", label: "应用已选决策" },
          { keys: "?", label: "打开/关闭快捷键帮助" },
        ]}
      />
    </PageShell>
  );
}
