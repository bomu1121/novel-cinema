"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { JobRunner } from "@/components/jobs/job-runner";

interface AssetRow {
  id: string;
  kind: "character_ref" | "expression" | "background" | "prop" | "text_card" | string;
  title: string | null;
  expression: string | null;
  scene_key: string | null;
  status: string;
  prompt: string | null;
  url: string | null;
}

interface PlanSpec {
  sceneKey: string;
  kind: string;
  characterName: string | null;
  expression: string | null;
  count: number;
  skipReason: string | null;
}

interface AssetsData {
  assets: AssetRow[];
  plan: {
    phase1?: PlanSpec[];
    phase2?: PlanSpec[];
    blocked?: Array<{ characterName: string; expression: string; reason: string }>;
    error?: string;
  };
}

export default function AssetsPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [data, setData] = useState<AssetsData>({ assets: [], plan: {} });
  const [error, setError] = useState<string | null>(null);
  // busy 仅用于批准类操作；生成走 JobRunner（任务级进度 + 可取消）
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/assets`);
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
    // 挂载后拉取资产库；setState 均在异步回调内
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function approve(assetId: string) {
    try {
      const res = await fetch(`/api/books/${bookId}/assets/${assetId}/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "批准失败");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const phase1Ready = (data.plan.phase1 ?? []).filter((s) => !s.skipReason).length;
  const phase2Ready = (data.plan.phase2 ?? []).filter((s) => !s.skipReason).length;
  const groups: Array<{ key: string; label: string; kind: string }> = [
    { key: "character_ref", label: "角色设定图（一致性基准）", kind: "character_ref" },
    { key: "background", label: "背景", kind: "background" },
    { key: "expression", label: "表情变体", kind: "expression" },
  ];

  // CandidateGallery：选两张候选并排对比（docs/06 §6.3）
  const [compareIds, setCompareIds] = useState<string[]>([]);
  function toggleCompare(id: string) {
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 2
          ? [...prev.slice(1), id]
          : [...prev, id],
    );
  }
  const compareAssets = data.assets.filter((a) => compareIds.includes(a.id));

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <PageHeader
        title="资产库"
        meta="签核点 C"
        backHref={`/books/${bookId}`}
        backLabel="← 返回章节"
        actions={
          <div className="flex flex-wrap gap-2">
            <JobRunner
              bookId={bookId}
              node="assets-phase1"
              label={`生成设定图与背景（${phase1Ready}）`}
              disabled={phase1Ready === 0}
              onRunningChange={setBusy}
              onDone={() => void load()}
            />
            <JobRunner
              bookId={bookId}
              node="assets-phase2"
              label={`生成表情变体（${phase2Ready}）`}
              variant="secondary"
              disabled={busy || phase2Ready === 0}
              onRunningChange={setBusy}
              onDone={() => void load()}
            />
          </div>
        }
      />

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {data.plan.error && (
        <div className="rounded-lg border border-regen/40 bg-regen/10 px-4 py-3 text-sm text-regen">
          生成清单暂不可用：{data.plan.error}（请先在“全书档案”页批准风格方案，并运行章节改编）
        </div>
      )}

      {(data.plan.blocked ?? []).length > 0 && (
        <p className="text-xs text-text-muted">
          等待设定图批准的表情：{data.plan.blocked?.map((b) => `${b.characterName}·${b.expression}`).join("、")}
        </p>
      )}

      {groups.map((group) => {
        const candidates = data.assets.filter((a) => a.kind === group.kind && a.status !== "approved");
        const approved = data.assets.filter((a) => a.kind === group.kind && a.status === "approved");
        return (
          <section key={group.key}>
            <h2 className="mb-3 font-semibold">
              {group.label}
              {approved.length > 0 && (
                <span className="ml-2 text-caption font-normal text-text-subtle">已批准 {approved.length}</span>
              )}
            </h2>
            {candidates.length === 0 && approved.length === 0 ? (
              <EmptyState description="还没有候选。按上方按钮生成。" />
            ) : (
              <>
                {candidates.length > 0 && (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {candidates.map((asset) => {
                      const inCompare = compareIds.includes(asset.id);
                      return (
                        <Card
                          flush
                          key={asset.id}
                          className={`overflow-hidden ${inCompare ? "border-accent/60 ring-1 ring-accent/40" : ""}`}
                        >
                          <div className="aspect-square bg-checker">
                            {asset.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={asset.url}
                                alt={asset.title ?? asset.scene_key ?? ""}
                                className={`h-full w-full object-cover ${inCompare ? "" : "transition-transform duration-fast hover:scale-105"}`}
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-text-subtle">无预览</div>
                            )}
                          </div>
                          <div className="space-y-2 p-3 text-xs">
                            <p className="truncate font-medium" title={asset.prompt ?? ""}>
                              {asset.title ?? asset.scene_key}
                            </p>
                            <p className="text-text-subtle">
                              {asset.expression ?? asset.kind} · <StatusPill table="assets" status={asset.status} />
                            </p>
                            {asset.status === "candidate" && (
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="approve"
                                  className="flex-1"
                                  onClick={() => approve(asset.id)}
                                >
                                  选这张
                                </Button>
                                <Button
                                  size="sm"
                                  variant={inCompare ? "primary" : "secondary"}
                                  onClick={() => toggleCompare(asset.id)}
                                  aria-pressed={inCompare}
                                >
                                  {inCompare ? "移出对比" : "对比"}
                                </Button>
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
                {approved.length > 0 && (
                  <div className="mt-5">
                    <h3 className="mb-2 text-caption font-medium text-text-muted">已批准（固定引用）</h3>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                      {approved.map((asset) => (
                        <Card flush key={asset.id} className="overflow-hidden border-approved/40">
                          <div className="aspect-square bg-checker">
                            {asset.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={asset.url}
                                alt={asset.title ?? asset.scene_key ?? ""}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-text-subtle">无预览</div>
                            )}
                          </div>
                          <div className="space-y-1 p-3 text-xs">
                            <p className="truncate font-medium" title={asset.prompt ?? ""}>
                              {asset.title ?? asset.scene_key}
                            </p>
                            <p className="text-approved">✓ 已批准</p>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}

      {/* CandidateGallery 对比条（吸底）：两张候选并排，hover 放大查看细节 */}
      {compareAssets.length === 2 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface shadow-pop">
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 p-4">
            {compareAssets.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <div className="aspect-square w-32 shrink-0 overflow-hidden rounded-lg border border-border bg-checker">
                  {a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.url}
                      alt={a.title ?? ""}
                      className="h-full w-full object-cover transition-transform duration-base hover:scale-150"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-text-subtle">无预览</div>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  <p className="truncate font-medium">{a.title ?? a.scene_key}</p>
                  <p className="mt-0.5 text-text-subtle">{a.expression ?? a.kind}</p>
                  <p className="mt-1 line-clamp-2 text-text-muted" title={a.prompt ?? ""}>
                    {a.prompt ?? "无提示词"}
                  </p>
                  {a.status === "candidate" && (
                    <Button size="sm" variant="approve" className="mt-2" onClick={() => approve(a.id)}>
                      选这张
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-3 border-t border-border py-2 text-xs">
            <span className="text-text-subtle">选第 3 张会替换最早选中项 · hover 图片放大</span>
            <button type="button" className="text-accent underline underline-offset-2" onClick={() => setCompareIds([])}>
              关闭对比
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
