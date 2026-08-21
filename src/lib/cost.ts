import { rawDb } from "@/lib/db";

/**
 * 成本汇总（docs/06 §4.3 / §6.2 CostMeter）。
 * 与 scripts/cost-report.ts 同口径：jobs.cost 的 tokens/调用次数（价格表 M1 接入）。
 */

export interface NodeCostAgg {
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface CostSummary {
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  byNode: Record<string, NodeCostAgg>;
}

interface CostRow {
  node: string;
  status: string;
  cost: string | null;
}

function aggregate(rows: CostRow[]): CostSummary {
  const byNode: Record<string, NodeCostAgg> = {};
  let calls = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of rows) {
    const cost = row.cost ? (JSON.parse(row.cost) as { input_tokens?: number; output_tokens?: number; model?: string | null }) : null;
    const agg = (byNode[row.node] ??= {
      calls: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      model: cost?.model ?? "-",
    });
    agg.calls += 1;
    if (row.status !== "succeeded") agg.failed += 1;
    agg.inputTokens += cost?.input_tokens ?? 0;
    agg.outputTokens += cost?.output_tokens ?? 0;
    calls += 1;
    if (row.status !== "succeeded") failed += 1;
    inputTokens += cost?.input_tokens ?? 0;
    outputTokens += cost?.output_tokens ?? 0;
  }
  return { calls, failed, inputTokens, outputTokens, byNode };
}

export function costSummary(bookId: string, todayOnly = false): CostSummary {
  const rows = rawDb
    .prepare(`SELECT node, status, cost, created_at FROM jobs WHERE book_id = ?`)
    .all(bookId) as CostRow[];
  const filtered = todayOnly
    ? rows.filter((r) => (r as CostRow & { created_at?: string }).created_at?.startsWith(new Date().toISOString().slice(0, 10)))
    : rows;
  return aggregate(filtered);
}
