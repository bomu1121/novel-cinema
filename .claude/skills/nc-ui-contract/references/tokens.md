# 设计令牌速查（docs/06 §5.1 · 唯一来源 src/app/globals.css）

## 颜色（Tailwind 工具：bg-/text-/border-）

| 令牌 | 值 | 用途 |
|---|---|---|
| `surface` / `surface-2` / `surface-3` | #fff / #f7f7f8 / #eeeef1 | 页面 / 卡片 / 悬浮层 |
| `border` / `border-strong` | #e4e4e7 / #d4d4d8 | 边框 |
| `text` / `text-muted` / `text-subtle` | #18181b / #71717a / #a1a1aa | 文字三级 |
| `approved` | #059669 | 已批准（族 A） |
| `review` | #2563eb | 待审 / 进行中（族 A/B） |
| `draft` | #71717a | 草稿（族 A） |
| `stale` | #dc2626 | 已过期 / 错误 / 危险（族 A） |
| `regen` | #d97706 | 待重生成（族 A） |
| `rejected` | #a1a1aa | 已驳回（族 A，划线） |

常用组合：`bg-approved/10 text-approved border-approved/40`、`bg-stale/10 text-stale border-stale/40`。

## 动效

`duration-instant` 100ms · `duration-fast` 160ms · `duration-base` 240ms · `duration-slow` 320ms
缓动：`ease-out` / `ease-inout`。列表入场 stagger 40ms/项，上限 8 项。

## 其他

`rounded-sm|md|lg`（6/10/14px）· `shadow-card` / `shadow-pop` ·
命中区：`min-h-6 min-w-6`（24px 下限）/ `min-h-9`（36px 舒适区）
