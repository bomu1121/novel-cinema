"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusPill } from "@/components/ui/status-badge";
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

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12">
      <header className="flex items-start justify-between">
        <div>
          <Link href={`/books/${bookId}`} className="text-sm text-zinc-500 hover:text-zinc-900">
            ← 返回章节
          </Link>
          <h1 className="mt-1 text-2xl font-bold">
            资产库 <span className="text-sm font-normal text-zinc-400">签核点 C</span>
          </h1>
        </div>
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
      </header>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {data.plan.error && (
        <div className="rounded-lg border border-regen/40 bg-regen/10 px-4 py-3 text-sm text-regen">
          生成清单暂不可用：{data.plan.error}（请先在“全书档案”页批准风格方案，并运行章节改编）
        </div>
      )}

      {(data.plan.blocked ?? []).length > 0 && (
        <p className="text-xs text-zinc-500">
          等待设定图批准的表情：{data.plan.blocked?.map((b) => `${b.characterName}·${b.expression}`).join("、")}
        </p>
      )}

      {groups.map((group) => {
        const assets = data.assets.filter((a) => a.kind === group.kind);
        return (
          <section key={group.key}>
            <h2 className="mb-3 font-semibold">{group.label}</h2>
            {assets.length === 0 ? (
              <p className="text-sm text-zinc-400">还没有候选。按上方按钮生成。</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {assets.map((asset) => (
                  <div key={asset.id} className="overflow-hidden rounded-xl border border-zinc-200">
                    <div className="aspect-square bg-zinc-100">
                      {asset.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.url} alt={asset.title ?? asset.scene_key ?? ""} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-zinc-400">无预览</div>
                      )}
                    </div>
                    <div className="space-y-2 p-3 text-xs">
                      <p className="truncate font-medium" title={asset.prompt ?? ""}>
                        {asset.title ?? asset.scene_key}
                      </p>
                      <p className="text-zinc-400">
                        {asset.expression ?? asset.kind} · <StatusPill table="assets" status={asset.status} />
                      </p>
                      {asset.status === "candidate" && (
                        <Button
                          size="sm"
                          variant="approve"
                          className="w-full"
                          onClick={() => approve(asset.id)}
                        >
                          选这张
                        </Button>
                      )}
                      {asset.status === "approved" && (
                        <p className="rounded-lg border border-approved/40 bg-approved/10 px-2 py-1.5 text-center text-approved">
                          ✓ 已批准
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}
