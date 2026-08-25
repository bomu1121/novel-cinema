/**
 * 去重修复工具：合并一本书内重复的人物/地点/物品/线索
 * （FK/JSON 引用重定向 + checkpoint 保护）。
 *
 * 用法：
 *   npm run heal:entities                  # 全部书 × 全部类型（默认）
 *   npm run heal:entities -- <bookId>      # 只处理指定书
 *   npm run heal:entities -- all --dry-run # 只预览不动库
 *   npm run heal:entities -- --type clues  # 只处理线索（locations/items/clues/characters）
 *   npm run heal:characters                # 等价于 --type characters
 */
import { getSupabaseAdmin } from "../src/lib/db";
import { healDuplicateCharacters } from "../src/lib/pipeline/characters";
import { healDuplicateEntities, type EntityKind } from "../src/lib/pipeline/entities";

const KIND_LABEL: Record<string, string> = {
  characters: "人物",
  locations: "地点",
  items: "物品",
  clues: "线索",
};

async function main() {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf("--type");
  const typeArg = typeIdx >= 0 ? args[typeIdx + 1] : null;
  const target =
    args.find((a, i) => !a.startsWith("--") && (typeIdx < 0 || i !== typeIdx + 1)) ?? "all";
  const dryRun = args.includes("--dry-run");
  const kinds: string[] = typeArg ? [typeArg] : ["characters", "locations", "items", "clues"];

  const s = getSupabaseAdmin();
  const { data: books } = await s.from("books").select("id, title");
  const bookList = (books ?? []) as Array<{ id: string; title: string }>;
  const targets = target === "all" ? bookList : bookList.filter((b) => b.id === target || b.title === target);
  if (targets.length === 0) {
    console.error(`找不到书: ${target}`);
    process.exit(1);
  }

  for (const book of targets) {
    console.log(`\n===== ${book.title} (${book.id}) =====`);
    for (const kind of kinds) {
      const label = KIND_LABEL[kind] ?? kind;
      if (!KIND_LABEL[kind]) {
        console.error(`未知类型: ${kind}（可用: characters / locations / items / clues）`);
        process.exit(1);
      }
      if (kind === "characters") {
        const result = await healDuplicateCharacters(book.id, { dryRun });
        if (result.clusters.length === 0) {
          console.log(`[${label}] 无重复，无需处理。`);
        } else {
          console.log(
            `[${label}] ${dryRun ? "[DRY-RUN] 将合并" : "已合并"} ${result.clusters.length} 组，${result.beforeCount} → ${result.afterCount} 条` +
            (result.checkpointId ? `（checkpoint: ${result.checkpointId}）` : ""),
          );
          for (const c of result.clusters) {
            console.log(`  保留 ${c.keeperName}（${c.role}）: 吸收 ${c.mergedNames.join("、") || "—"}；别名 ${c.newAliases.join("、") || "—"}`);
            if (Object.keys(c.refsMoved).length > 0) console.log(`    引用迁移: ${JSON.stringify(c.refsMoved)}`);
          }
          if (result.suspicious.length > 0) {
            console.log("  可疑条目（疑似一条含多人，未自动处理）:");
            for (const su of result.suspicious) console.log(`    - ${su.name}：${su.reason}`);
          }
        }
      } else {
        const result = await healDuplicateEntities(book.id, kind as EntityKind, { dryRun });
        if (result.clusters.length === 0) {
          console.log(`[${label}] 无重复，无需处理。`);
        } else {
          console.log(
            `[${label}] ${dryRun ? "[DRY-RUN] 将合并" : "已合并"} ${result.clusters.length} 组，${result.beforeCount} → ${result.afterCount} 条` +
            (result.checkpointId ? `（checkpoint: ${result.checkpointId}）` : ""),
          );
          for (const c of result.clusters) {
            console.log(`  保留 ${c.keeperName}: 吸收 ${c.mergedNames.join("、") || "—"}；别名 ${c.newAliases.join("、") || "—"}`);
            if (Object.keys(c.refsMoved).length > 0) console.log(`    引用迁移: ${JSON.stringify(c.refsMoved)}`);
          }
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
