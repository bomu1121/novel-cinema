# 风格圣经 v2：候选可生成、锁定可追溯、编辑显式化

> 状态：已实施（2026-08 重构）。
> 范围：B24 `bible.propose` 节点、`style_bibles` 数据模型、档案页 UI、工作台编辑语义、jobs 队列与 DAG。
> 目标：修复 v1 的四个结构性缺陷——候选随单章分析联动刷新、生成只看单章摘要、重生成静默覆盖丢历史、工作台手改无标记。

## 1. v1 的缺陷（本重构的动因）

1. **候选与单章分析耦合**：`analyze` 节点每次运行都连带 `proposeStyleBibles + persistStyleProposals`。风格圣经是书级资产，但"重新分析任一章节"就会刷新候选，用户修人物档案会把风格候选冲掉。
2. **生成输入过窄**：`buildStyleProposalPrompt` 只吃当前单章的 summary/tone/人物/地点。用一章定全书风格，信息量不足且随章节切换漂移。
3. **重生成 = 覆盖**：`style_bibles` 每书一行、version 递增但旧 `proposal_json` 被覆盖，已批准的方案在重生成后无痕消失（只能靠 checkpoint 一次性撤销，无长期历史）。
4. **软锁定**：工作台手改 `visual_style` 等字段不改变 approved 状态、无任何标记，下游继续消费被手工改过的方案，UI 无法区分"AI 方案"与"人工修订"。

## 2. 模型变更

### 2.1 `style_bibles`（保持每书一行，下游查询零改动）

新增列：

- `manual_override INTEGER NOT NULL DEFAULT 0`：工作台手改行字段时置 1，UI 显示"手工修订"徽标；批准/重新生成时清 0（AI 方案接管）。
- `proposal_json` 语义明确为「**当前批次**候选」；`version` = 当前批次版本号。

### 2.2 `bible_proposals`（新表：批次归档，append-only）

```sql
create table bible_proposals (
  id text primary key,
  book_id text not null references books(id) on delete cascade,
  version integer not null,              -- 该批次的版本号（展示用）
  proposal_json text not null default '[]',
  approved_index integer,                -- 该批次当时被批准的第几套（null=从未批准）
  note text,                             -- 来源说明：ai 生成 / 恢复自批次 vN
  created_at text
);
create index idx_bible_proposals_book on bible_proposals (book_id, version);
```

**归档规则**：每当新批次落库（AI 重新生成 / 恢复历史批次），旧当前批次先归档进 `bible_proposals`（记录当时批准索引），再覆盖 `style_bibles`。历史永远不丢，可回看、可恢复。

## 3. 节点与调度变更

| 变更 | 说明 |
|---|---|
| 新节点 `bible.propose` | 书级、独立：聚合全书档案 → 强模型生成 1~3 套候选 → 落库（自动归档旧批次、回到 `pending_review`） |
| `analyze` 瘦身 | `produces` 移除 `style_bibles`；不再调用 propose/persist |
| DAG | `bible.propose: produces [style_bibles], consumes [chapter_summaries, characters, locations, clues]`；gate=notify |
| jobs 队列 | `VALID_NODES` 与 `RerunNode` 增加 `bible.propose`，走 worker + SSE 进度 |
| 就绪面板 | 签核 A 的入口节点变为 `analyze + bible.propose` |

## 4. 生成输入（全书聚合）

`proposeStyleBiblesForBook(bookId)` 组装上下文：

1. 类型倾向（暂由内容判断，保留 genreHint 参数位）
2. **全部已分析章节摘要**（≤5 章，含章节号/标题/基调）
3. 人物档案（≤12：canonical + role + 一句话描述）
4. 地点名册、线索名册（含红鲱鱼/剧透标记）

提示词 v2 要求：为**全书**设计（非本章）；每套输出 `rationale`（为什么推荐这套）；`camera_grammar` 三档必填；`negative_prompt` 必填。

## 5. 状态机（档案页 UI）

```
无候选 ──生成(bible.propose)──▶ 待审(pending_review)
  ▲                              │ 批准(approve)
  │                              ▼
  └────────────── 恢复历史批次 ◀─ 已锁定(approved)
                                   │ 重新生成（归档旧批次并解锁）
                                   ▼
                              待审（新批次 v+1）
```

- 待审态：候选卡全字段 + 推荐 ★ + 「批准这套」+「重新生成候选」
- 锁定态：锁定方案卡（展平字段 + 版本 + 批准时间 + 手工修订徽标）+「改选另一套」（从当前批次换选，带 checkpoint）+「重新生成候选（将解锁）」
- 历史区：批次列表（版本/时间/批准标记/来源 note），可展开回看、可「恢复为当前候选」

## 6. 编辑语义（工作台）

- `patchWorkbenchRow` 对 `style_bibles` 的手动 PATCH 自动附加 `manual_override=1`（显式传值则尊重）。
- 批准 / 重新生成 / 恢复时 `manual_override=0`。
- 手改仍触发 `propagateStale`（下游脚本/底稿过期）——与 v1 一致。

## 7. 兼容与迁移

- SQLite：`ensureSchema` 增量迁移——`ALTER TABLE style_bibles ADD COLUMN manual_override`；新表直接 `CREATE TABLE IF NOT EXISTS`。
- Supabase 迁移 `0001_schema.sql` 同步。
- 下游（assets/adapt/condense）只读 `style_bibles` 展平字段 + `status=approved`，**零改动**。
- 既有 fixture（seed-fixture）无需改字段（新列有默认值）。

## 8. 测试

- 批准后手动编辑 → `manual_override=1`；批准 → 清 0。
- 二次生成 → 旧批次进 `bible_proposals`、version+1、回到待审。
- 恢复历史批次 → 当前候选 = 历史内容、版本号递增、note 标记。
- 锁定态换选 → 状态仍 approved、索引更新、checkpoint 可回滚。
