/**
 * 成本报告：npm run cost:report -- --book <bookId>
 * 汇总 jobs 表里的 tokens / 调用次数 / 成功率（按节点分组）。
 */
import { getSupabaseAdmin } from "../src/lib/db";

function parseArgs(argv: string[]): { bookId?: string } {
  const idx = argv.indexOf("--book");
  return { bookId: idx >= 0 ? argv[idx + 1] : undefined };
}

interface Cost {
  input_tokens?: number;
  output_tokens?: number;
  model?: string | null;
}

interface JobRow {
  node: string;
  status: string;
  cost: Cost | null;
  attempt: number;
}

async function main() {
  const { bookId } = parseArgs(process.argv.slice(2));
  const supabase = getSupabaseAdmin();
  let query = supabase.from("jobs").select("node, status, cost, attempt");
  if (bookId) query = query.eq("book_id", bookId);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as JobRow[];
  const byNode = new Map<string, { calls: number; failed: number; input: number; output: number; model: string }>();
  for (const row of rows) {
    const agg = byNode.get(row.node) ?? { calls: 0, failed: 0, input: 0, output: 0, model: row.cost?.model ?? "-" };
    agg.calls += 1;
    if (row.status !== "succeeded") agg.failed += 1;
    agg.input += row.cost?.input_tokens ?? 0;
    agg.output += row.cost?.output_tokens ?? 0;
    byNode.set(row.node, agg);
  }

  console.log(`\n成本报告${bookId ? `（book=${bookId}）` : "（全部）"}`);
  console.log("-".repeat(72));
  console.log("node".padEnd(22), "calls", "fail", "in_tok", "out_tok", "model");
  let totalInput = 0;
  let totalOutput = 0;
  for (const [node, agg] of [...byNode.entries()].sort()) {
    totalInput += agg.input;
    totalOutput += agg.output;
    console.log(
      node.padEnd(22),
      String(agg.calls).padEnd(5),
      String(agg.failed).padEnd(4),
      String(agg.input).padEnd(7),
      String(agg.output).padEnd(8),
      agg.model,
    );
  }
  console.log("-".repeat(72));
  console.log(`合计：${rows.length} 次调用 · 输入 ${totalInput} tok · 输出 ${totalOutput} tok`);
  console.log("费用请按所用模型单价自行折算（jobs.cost 未存价格，M1 接入 pricing 表后自动计算）。");
}

main().catch((err) => {
  console.error("成本报告失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
