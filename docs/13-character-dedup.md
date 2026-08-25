# 实体去重（人物/地点/物品/线索）调研与修复

## 问题

逐章分析后档案出现同一实体的多行记录（简称/全名/称谓各占一行）。
《魔眼之匣》两本书实测：人物 31 条（真实约 14 人）、地点 13 条中 3 组重复
（`神红大学中央联合食堂`/`中央联合食堂`、`比留子同学的公寓`/`比留子同学公寓`、
咖啡店三连）、线索 13 条中 `预言信件`/`预言信件内容` 重复。

## 根因（三个叠加）

1. **合并谓词漏方向**：旧实现只按 name 精确相等合并。
   - locations/items 有 aliases 列却从不参与匹配；
   - clues 连 aliases 列都没有；
   - 无「去 的/の 变体」等价（比留子同学的公寓 ↔ 比留子同学公寓）。
2. **同章快照失效**：合并循环使用「循环前」的行快照，本章刚插入的行不参与匹配。
3. **LLM 命名漂移**：单章粗读提示词不携带已有人物/地点/线索档案，模型每章自由选名。

## 修复

- **四向匹配 + 变体等价**（`entityNamesMatch`）：canonical 相等（含去 的/の）/
  新名 ∈ 旧别名 / 旧 canonical ∈ 新别名 / 别名交集（排除通用词）；
  线索另加**保守包含**规则（短名 ≥4 字、长名包含短名、长度差 ≤4），
  覆盖「预言信件 ↔ 预言信件内容」，避免「班目机构」误并「班目机构分署研究设施」。
- **canonical 升级**：对比键更长（更完整）的写法升级为 canonical，旧名并入 aliases。
- **线索/物品表补 aliases 列**（增量迁移 + CREATE TABLE），zod schema 同步。
- **描述/类型合并**：更长描述；线索红鲱鱼/剧透取并集；类型保留非 other。
- **提示词注入档案**：`analyzeChapter` 注入已有【人物/地点/线索档案】，要求复用
  canonical、新称谓进 aliases；线索/物品支持 aliases 输出。
- **存量一键修复**（`healDuplicateEntities`）：等价簇（传递闭包）→ keeper
  （下游引用数 > 全名 > 描述长度）吸收 + FK/JSON 引用重定向
  （assets.location_id / timeline_events.location_id / assets.item_id /
  beats.clue_ids / chapter_summaries.clues）+ checkpoint 保护 + 幂等 + dry-run。

## 用法

```bash
npm run heal:entities                      # 全部书 × 人物/地点/物品/线索
npm run heal:entities -- <bookId>          # 指定书
npm run heal:entities -- all --dry-run     # 预览不动库
npm run heal:entities -- --type clues      # 只处理线索
npm run heal:characters                    # 只处理人物（等价 --type characters）
```

## 验证

- `src/lib/pipeline/characters.test.ts`（19 例）+ `entities.test.ts`（14 例）：
  匹配谓词 / 逐章合并（含同章变体）/ heal 集成（keeper、FK+JSON 重定向、
  checkpoint、幂等、dry-run、包含规则边界）。
- 真实库执行：人物 37→25、地点 13→11、线索 13→12，FK 悬空引用 0，
  再次运行全量无重复（幂等）。
- 语义级重复（咖啡店 / 大型咖啡连锁店 / 常去的咖啡店）无法用字符串规则
  安全判定，保留原样；后续章节经档案注入后由 LLM 别名收敛，或人工合并。
