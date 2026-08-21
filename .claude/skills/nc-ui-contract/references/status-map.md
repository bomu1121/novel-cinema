# 状态三族映射（docs/06 §5.3 · 唯一来源 src/lib/ui/status.ts）

## 族 A 审阅生命周期 → `<StatusPill table=... status=... />` 自动渲染徽章

| DB 值 | UI 状态 | 中文 |
|---|---|---|
| `draft`（非 books 表） | draft | 草稿 |
| `pending_review` / `candidate` / `open` | review | 待审 |
| `approved` / `accepted` | approved | 已批准 |
| `rejected` | rejected | 已驳回 |
| `stale` | stale | 已过期 |
| `archived` | regen | 待重生成 |
| `skipped` | skipped | 已跳过 |

## 族 B 执行生命周期 → `<StatusPill>` 渲染进度 chip

`pending` / `queued` → 排队中 · `running` / `generating` → 生成中（脉冲）·
`succeeded` → 已完成 · `failed` → 失败 · `cancelled` → 已取消

## 族 C 领域语义 → 中性 chip（禁止状态色）

books：`draft`→未开始 `analyzing`→分析中 `scripting`→改编中 `asset_ready`→资产就绪
`rendering`→渲染中 `completed`→已完成
clues：`introduced`→已出场 `recalled`→已回忆 `resolved`→已揭示 `red_herring`→红鲱鱼

## 禁忌

- 不认识的 status 值：`<StatusPill>` 渲染空，**不要**自己发明文案。
- 永远不要直接输出 `{row.status}` 原文。
- `toReviewStatus("books", "draft")` 是 null —— books 的 draft 是阶段不是审阅态。
