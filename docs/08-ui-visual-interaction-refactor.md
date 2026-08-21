# 08 · UI 视觉与交互重构方案（元素级 + 整体体验）

> 定位：对 `docs/06`（交互原语）和 `docs/07`（调研与收口）的**视觉重构升级**。
> 06/07 解决的是"交互原语是否齐全、令牌是否干净"；08 解决的是"**每个元素长什么样、每个细节怎么动、整体是否像一个专业创作工作台**"。
>
> 核心态度：**这是设计重构，不是 token 收尾。** 每个改动默认要“看得见”，并随改随更视觉基线。

---

## 0. 为什么上一轮不够（方法论修正）

上一轮 P4-A 只做了：裸色迁移、`accent` 语义解耦、字号令牌就位、`<EmptyState>` 组件、SectionCard 收敛、lint 扩展。这些是对的，但**视觉上基本等价**，原因是：

1. 把“已落地组件”当成了“已完成的视觉”，没有质疑它们是否真的被页面使用、是否真的好看；
2. 迁移时选择了同 hex 映射，避免动基线；
3. 没有做页面级、元素级、交互细节级的审计；
4. 把“执行吧”理解成了“执行收尾项”，而不是“执行 UI 优化”。

**本轮修正**：先给完整的元素清单与目标规格，再分里程碑执行；每个里程碑都产出可见差异，并更新视觉回归基线。

---

## 1. 现状问题（元素级审计摘要）

| 层面 | 现状问题 | 证据/位置 |
|---|---|---|
| 页面骨架 | 无统一页头/容器；每页自己写 `<section className="rounded-xl border ... p-5">`；标题、操作区、状态区位置不一 | 10 个页面均有手写 section |
| 表单控件 | input/select/textarea 无统一 `<Field>`；每页手写 `rounded border border-border px-3 py-2 text-sm` 数十次 | script/workbench/storyboard/voice/assets |
| 按钮 | 已有 `<Button>`，但首页/书页/画布仍有旧 `border-zinc-900` 按钮或 `<button>` 裸样式 | `books/[bookId]/page.tsx`、`canvas`、`render` |
| 卡片/列表 | `<SectionCard>` 未被任何页面使用；列表行/资产卡/分镜卡各自为政 | 全站 |
| 状态视觉 | 状态徽章已统一，但出现位置/密度/上下文（行内 vs 卡片 vs 表格）不统一；执行态与审阅态在部分页面仍容易混淆 | bible/assets/voice/render |
| 空态/加载/错误 | 空态刚抽组件但无视觉层级；错误横幅样式单薄；加载态只有按钮 spinner 和进度条 | 全站 |
| 画布 | 画布是最复杂页面，但工具栏/资产池/检查器/时间轴缺少统一视觉语言；拖拽反馈只有 ring/shake | `storyboard-canvas.tsx` |
| 编排台 | 高级 JSON 编辑器、节点卡片、stale 提示、成本区缺少层级与密度规划 | `workbench/page.tsx` |
| 暗色 | 无暗色模式；画布预览区用 `bg-text` 硬凑黑底 | `globals.css`、canvas |
| 响应式 | 仅有 desktop/mobile e2e，但管理页在小屏没有真正的导航/页头适配 | 全站 |

---

## 2. 目标视觉方向

### 推荐：Studio Console（创作控制台）

一句话：**管理页像专业的影视项目工作台，画布页像剪辑软件。**

- **管理页（bible/script/assets/storyboard/voice/render/workbench）**：
  - 浅色、克制的灰阶；大留白、清晰层级；内容卡片化但不堆叠阴影。
  - 主色 `accent`：**胶片青 #0D9488**（teal）。选它而不是靛蓝/紫蓝，是因为 indigo/purple 正是反 AI 味规则点名要避开的“默认 slop 色”（见 §2.1）。
  - 状态色保持语义：绿=已批准、蓝=待审、红=过期/错误、琥珀=待重生成。
  - 标题用「衬线中文 display + 无衬线正文」的双字体策略（见 §3.2），避免“全站 Inter/系统字体”的 AI 味。
- **画布页（canvas）**：
  - 进入画布自动切 `data-theme="dark"`：深灰画布 #111113、面板 #18181b、边框 #27272a。
  - 画布元素（镜头卡、资产池、检查器）统一为暗色“剪辑台”语言。
  - 预览区域用真正的黑场，而不是浅色主题里的 `bg-text` 硬凑。

### 备选方向（如不满意再换）

| 方向 | 气质 | 适用 |
|---|---|---|
| B · Editorial Light | 米白底、衬线标题、大量留白、像出版/写作工具 | 更偏“小说编辑台”，弱化工程感 |
| C · Terminal Dark | 全站深色、高密度、等宽细节、像 AI coding 工具 | 更偏开发者/极客，但可能离影视创作远 |

**默认按 A 执行；执行前先做一个 `/ui` 风格指南页，把 A/B/C 的关键差异做成可点击预览，再定稿。**

### 2.1 样式基调：针对“AI 味代码风格”的现成解决方案（调研补充）

上一轮只把“反 AI 味”做成了 8 条清单，没有把它上升为定调依据。本轮补齐调研，下面这些是**专门解决 AI 生成 UI 风格同质化**的方案，docs/08 的方向 A 直接建立在其结论上。

| 方案 | 核心方法 | 对本项目的用法 |
|---|---|---|
| [Impeccable](https://github.com/pbakaus/impeccable)（pbakaus） | 1 个 skill + 23 个命令 + **59 条确定性检测规则**；`init` 生成 `PRODUCT.md`/`DESIGN.md`；命令分 shape/critique/audit/polish/bolder/quieter/distill/animate/typeset 等 | 把 59 条规则中可静态化的并入 `lint:ui`；采用 "shape→build→critique→polish" 的 SOP；`DESIGN.md` 作为风格指南页的数据源 |
| [anti-ai-slop](https://github.com/Vinayak-Shukla-03/anti-ai-slop) | 9 条硬规则：禁用无品牌 indigo/purple 与反射式渐变、禁用 Inter/系统字体平铺、禁用均匀圆角/间距、禁用 emoji 图标、禁用 `transition:all`、禁用 benefit-speak 文案、禁用伪造数据、打破 Hero→3 列→CTA 模板骨架、警惕“第二阶 slop”（奶油底+衬线+陶土色的新套路） | **直接作为本项目样式基调门禁**；每项都有可 grep 的机械检查 |
| [community DesignSystem skill](https://github.com/Jaywalker-not-a-whitewalker/DesignSystem) | 6 步 onboarding、8pt 网格、token-first、section isolation、一屏一主操作、三层文字、audit 输出 passes/warnings/violations | 结构性规则层（V2/V4/V5 的蓝本） |
| [cursor-design-rules](https://github.com/studioalexwolf/cursor-design-rules) | 3 条免费规则：核心原则 / 27 条反模式 / 设计判断力 | 并入 `nc-ui-contract/references/anti-slop.md` |
| [superdesign-skill](https://github.com/superdesigndev/superdesign-skill) | 意图驱动：先提取设计方向与真实参考，再在现有设计系统内迭代；replica HTML = BEFORE，设计草稿可分支 | 执行 M0 前先产出“设计方向卡”与关键页面 replica，确认后再动代码 |
| [Caspian APP_DESIGN_PHILOSOPHY](https://github.com/TryCaspian/Caspian/blob/main/APP_DESIGN_PHILOSOPHY.md) | **"warm precision"**：深色但带暖意；表面用 oklch 按明度分层（recessed/flush/raised）；强调色用 tint 不 shout；边框用半透明白；文字用暖米白而非纯白；13px 高密度基准；Geist + 数字表格线 | 画布暗色与 Studio Console 的空间/表面/边框体系直接借鉴 |
| [Hallmark](https://github.com/nexu-io/open-design/tree/main/plugins/community/hallmark) | 专门“拒绝 AI 味”的设计技能，57 道闸门 | 作为风格验收的补充检查项 |

**据此修正后的定调结论**：

1. **accent 不用靛蓝/紫蓝**。indigo/purple 是 AI 默认 slop 色；改用**胶片青 #0D9488**，与“影像化”语义一致，且与状态色（review 蓝、regen 琥珀）不冲突。
2. **字体要有意识**。不用“全站 Inter/系统字体平铺”。方向 A 采用双字体：**中文标题用衬线（Noto Serif SC / 宋体系），正文与数据用无衬线（Noto Sans SC / Geist）**；具体在 `/ui` 风格指南页对比后定稿。
3. **均匀即平庸**。圆角/间距/阴影要有层级差异；卡片不是唯一容器；每屏一个主操作。
4. **文案禁用 benefit-speak**。本项目已要求“动词开头、写清对象与影响”，补充禁用词表与机械 grep。
5. **画布暗色不“冷”**。借鉴 Caspian 的 warm precision：深底不是纯黑，文字带暖意，边框半透明分层。
6. **自审计**。每个里程碑跑一次 anti-ai-slop 的 pre-ship checklist，任何“yes”都要能解释“为什么不是默认解”。

---

## 3. 设计令牌重构（完整版）

### 3.1 颜色

```css
:root {
  /* 表面（浅色管理页） */
  --surface-0: #fafafa;   /* 页面底 */
  --surface-1: #ffffff;   /* 卡片/面板 */
  --surface-2: #f4f4f5;   /* 内嵌区块/输入底 */
  --surface-3: #e4e4e7;   /* 按压/分隔 */

  /* 边框与文字 */
  --border: #e4e4e7;
  --border-strong: #d4d4d8;
  --text: #18181b;
  --text-muted: #71717a;
  --text-subtle: #a1a1aa;

  /* 交互强调（反 AI 味：不用靛蓝/紫蓝，选胶片青） */
  --accent: #0d9488;
  --accent-hover: #0f766e;
  --accent-active: #115e59;
  --accent-soft: #f0fdfa;   /* 选中/激活底色 */

  /* 状态（语义） */
  --st-approved: #059669;
  --st-review: #2563eb;
  --st-draft: #71717a;
  --st-stale: #dc2626;
  --st-regen: #d97706;
  --st-rejected: #a1a1aa;

  /* 领域 */
  --clue: #d97706;
  --spoiler: #dc2626;
  --character: #2563eb;
}

[data-theme="dark"] {
  --surface-0: #0c0c0e;
  --surface-1: #18181b;
  --surface-2: #1f1f23;
  --surface-3: #27272a;
  --border: #27272a;
  --border-strong: #3f3f46;
  --text: #f4f4f5;
  --text-muted: #a1a1aa;
  --text-subtle: #71717a;
  --accent: #2dd4bf;
  --accent-hover: #5eead4;
  --accent-active: #14b8a6;
  --accent-soft: rgba(45, 212, 191, 0.16);
  /* 状态色在暗色下可保留，但对比度需复测 */
}
```

### 3.2 字阶（完整）

| Token | 字号 | 行高 | 字重 | 用途 |
|---|---|---|---|---|
| `--text-overline` | 12px | 1.4 | 500 | 页眉标签、KPI 标签 |
| `--text-caption` | 13px | 1.5 | 400 | 辅助说明、元信息 |
| `--text-body` | 14px | 1.6 | 400 | 正文（管理页） |
| `--text-lead` | 16px | 1.6 | 450 | 列表标题、输入值 |
| `--text-title` | 20px | 1.4 | 600 | 区块标题 |
| `--text-page` | 28px | 1.3 | 650 | 页面标题 |
| `--text-display` | 36px | 1.2 | 700 | 首页/欢迎 |

双字体策略（反 AI 味 §2.1）：**标题/展示**用 `"Noto Serif SC", "Songti SC", serif`（衬线，呼应小说/片头）；**正文/数据/控件**用 `"Noto Sans SC", "Microsoft YaHei", system-ui`；数字统一 `tabular-nums`。最终以 `/ui` 风格指南页的实拍对比定稿。

### 3.3 间距 / 圆角 / 阴影 / 动效

- 间距：4/8/12/16/24/32/48/64（4px 网格）
- 圆角：`sm=6`（标签/输入）、`md=10`（按钮/小卡）、`lg=14`（卡片）、`xl=18`（大面板）、`pill=999`
- 阴影：`hairline`（1px 边框）、`card`（0 1px 2px + 0 1px 8px）、`pop`（0 8px 32px）
- 动效：沿用 `--dur-*`；新增 `--dur-pulse=2s`、`--dur-spin=1s`
- `nc-spin/nc-pulse` 保留，后续所有指示器都走它们

### 3.4 组件命名与目录

```
src/components/ui/
  button.tsx / icon-button.tsx / field.tsx / input.tsx / select.tsx / textarea.tsx
  card.tsx / section-card.tsx / list-row.tsx / table.tsx
  badge.tsx / status-badge.tsx / tag.tsx / dot.tsx
  empty-state.tsx / error-banner.tsx / skeleton.tsx / loading.tsx
  toast.tsx / inline-confirm.tsx / dialog.tsx / drawer.tsx
  breadcrumb.tsx / tabs.tsx / stepper.tsx / page-header.tsx / app-shell.tsx
  tooltip.tsx / popover.tsx / command-palette.tsx
  progress.tsx / job-step-list.tsx / job-trace.tsx / cost-meter.tsx / review-inbox.tsx
  plan-sheet.tsx / diff-review.tsx / time-machine.tsx / evidence-disclosure.tsx
```

---

## 4. 全局页面骨架

### 4.1 App Shell（全站统一）

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar: Logo · 书名/项目名 · Breadcrumb · CostMeter · Cmd+K  │
├──────────┬───────────────────────────────────────────────────┤
│ LeftRail  │  PageHeader（标题/说明/PhaseRail/主操作）           │
│ 流程铁路  │  Content（统一 max-width 1440，px-6/8，py-6）      │
│ A→F 签核点│                                                   │
│ 收件箱    │                                                   │
├──────────┴───────────────────────────────────────────────────┤
│ StatusBar: 当前 job · 待审数 · 今日成本 · 版本                 │
└──────────────────────────────────────────────────────────────┘
```

- TopBar 高度 48px，固定顶部；左侧流程铁路 220px（桌面）/抽屉（移动）。
- PageHeader：页面标题（28px）+ 一句话说明 + 右侧操作区；下面一条 PhaseRail 显示 A–F 当前阶段。
- Content：`max-w-[1440px] mx-auto px-6 lg:px-8 py-6 space-y-6`。

### 4.2 页面标题区（PageHeader）

每个页面的标题/状态/操作统一为一个组件：

```
页面标题            [状态徽章] [成本]        [主操作] [次操作]
一句话说明
──────────────────────────────────────────────
阶段 A  ●  B  ○  C  ○  D  ○  E  ○  F  ○
```

- 所有签核页都显示阶段铁路，当前阶段高亮 `accent`。
- 主操作永远只有一个（primary），次操作 ghost/secondary。

---

## 5. 元素级组件规格（核心）

> 每个组件都定义：视觉、尺寸、状态、交互、a11y。

### 5.1 Button / IconButton

| 项 | 规格 |
|---|---|
| 尺寸 | sm 32px / md 40px / lg 48px；命中区 ≥24px |
| 圆角 | `--radius-md`（10px） |
| Primary | `bg-accent text-white hover:bg-accent-hover active:bg-accent-active`，阴影 `0 1px 2px rgba(79,70,229,.35)` |
| Secondary | `bg-surface-1 border border-border text-text hover:bg-surface-2` |
| Ghost | `text-text-muted hover:bg-surface-2 hover:text-text` |
| Danger | `bg-stale text-white hover:bg-stale/90` |
| Approve | `border-approved/50 bg-approved/10 text-approved hover:bg-approved/15` |
| Loading | 保留原文案 + `nc-spin` 图标 + `aria-busy` |
| Progress | 按钮内底部进度条 `bg-accent/20` |
| 键盘 | Enter/Space 原生；快捷键以 `<kbd>` 展示在右侧 |
| 焦点 | `:focus-visible` 用 `outline: 2px solid var(--accent)` + 2px offset |

### 5.2 Input / Select / Textarea / Field

统一表单基础样式，消灭“每页手写 input class”：

```
Field
├─ Label（13px, 500, text-text）
├─ Control（h-10, rounded-md, border-border, bg-surface-1, px-3, text-body, focus:border-accent focus:ring-2 ring-accent/25）
├─ Hint（12px, text-text-subtle）
└─ Error（12px, text-stale, role=alert）
```

- 状态：default / hover(`border-strong`) / focus(`accent` ring) / disabled(`bg-surface-2 text-text-subtle cursor-not-allowed`) / error(`border-stale ring-stale/20`) / readOnly。
- Select：2–3 个静态选项用 chip/radio 组；长列表用原生 select + chevron。
- Textarea：`min-h-[80px]`，可拖拽 resize，代码/JSON 用 `font-mono`。
- 所有表单控件必须能纯键盘操作，label 用 `htmlFor`。

### 5.3 Card / Section / List / Table

| 组件 | 视觉 |
|---|---|
| SectionCard | `rounded-lg border border-border bg-surface-1`（不加 shadow）；header `px-5 py-3 border-b`，body `p-5` |
| InteractiveCard | 同上 + `hover:border-strong hover:shadow-card transition`；选中 `border-accent ring-2 ring-accent/20 bg-accent-soft/40` |
| ListRow | `flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-surface-2`；可含右侧操作 |
| Table | `w-full text-body`；thead `text-caption text-text-subtle uppercase`；行 `border-b hover:bg-surface-2`；数值右对齐 `tabular-nums` |
| Tag/Chip | `h-6 rounded-full px-2 text-caption`；中性用 `bg-surface-2 text-text-muted`；领域色用 `*-soft` |

### 5.4 Badge / StatusPill / Dot

- 保持三族语义（审阅/执行/领域）。
- 视觉升级：`h-6 min-w-6 rounded-full px-2.5 inline-flex items-center gap-1.5 text-caption font-medium`；状态点 6px。
- `stale` 显示「影响 N」时右侧出现可点按钮，hover 高亮。
- 执行态不再用徽章样式，统一 `<JobStepList>` / `<ProgressChip>`。

### 5.5 EmptyState / Error / Loading / Skeleton

| 组件 | 规格 |
|---|---|
| EmptyState | `py-12 px-6 text-center`；图标 40px；标题 `text-lead font-semibold`；说明 `text-body text-text-muted`；动作 `mt-4`；边框可选虚线 `border-dashed` |
| ErrorBanner | `rounded-lg border border-stale/40 bg-stale/10 px-4 py-3 text-body text-stale flex gap-2`；`role=alert`；右侧可带重试按钮 |
| Loading | `<Button loading>` 或 `<JobStepList>`；禁止“假就绪”骨架 |
| Skeleton | 只用于“已存在但加载中”的列表/卡片：`bg-surface-3 animate-pulse`（用 `nc-pulse`） |

### 5.6 Toast / InlineConfirm / Dialog / Drawer

- Toast：右上角 `w-80 rounded-lg border shadow-pop`；类型色用状态令牌；progress 用 `nc-pulse`；`aria-live`。
- InlineConfirm：原位展开卡片，`border-accent/40 bg-accent-soft/60`；三档风险（auto/notify/block）视觉区分：auto 不出现、notify 蓝色、block 红色。
- Dialog/Drawer：遮罩 `bg-black/40 backdrop-blur-sm`；面板 `rounded-xl shadow-pop`；打开时 focus trap，关闭归还焦点；禁止嵌套 modal。

### 5.7 导航 / Breadcrumb / Tabs / Stepper

- Breadcrumb：`text-caption text-text-muted`，当前页 `text-text font-medium`。
- Tabs：`h-10 border-b border-border`；active `text-accent border-b-2 border-accent`；可用方向键切换。
- Stepper（PhaseRail）：横向 6 点 + 标签；完成 `bg-approved`、当前 `bg-accent ring-4 ring-accent/20`、待做 `bg-border`。

### 5.8 Tooltip / Popover / CommandPalette

- Tooltip：`bg-text text-surface text-caption px-2 py-1 rounded-md shadow-pop`，延迟 150ms 出现。
- Popover：面板 `rounded-lg border border-border bg-surface-1 shadow-pop`。
- CommandPalette：`fixed inset-0 z-50` + 居中 `w-[560px]`；搜索框 48px；结果分组；`↑↓/Enter/Esc`；打开时 focus 搜索框。

### 5.9 Job / 成本 / 收件箱

- JobStepList：`rounded-lg border border-border bg-surface-2 px-3 py-2`；步骤行；进度条 `h-1 bg-accent`；取消按钮 `text-accent`；停滞时整卡变琥珀/红（P4-B）。
- JobTrace：默认折叠的 span 瀑布；阶段行 `flex`，耗时 `tabular-nums`；成本归因在右侧。
- CostMeter：`inline-flex items-center gap-1.5`；点用 `bg-accent`；金额/次数用 `tabular-nums`。
- ReviewInbox：徽章 `bg-accent text-white`；列表行可点击进入审阅。

### 5.10 审阅面（PlanSheet / DiffReview / TimeMachine / Evidence）

- PlanSheet：`rounded-lg border border-accent/40 bg-accent-soft/60 p-4`；四行网格（将生成/将覆盖/成本/可撤销）；主操作 `Button primary`，次操作 `ghost`。
- DiffReview：条目卡 `rounded-lg border`；选中 `border-accent bg-accent-soft/40`；新增/删除用 diff 色；吸底操作区 `sticky bottom-0 bg-surface-1/95 backdrop-blur border-t`。
- TimeMachine：列表行 `hover:bg-surface-2`；回滚按钮 danger/ghost；悬停预览受影响对象。
- EvidenceDisclosure：默认折叠 `<details>`；摘要行 + “为什么”链接。

### 5.11 画布（Canvas）专用

- 整体：`data-theme="dark"`；画布底色 `--surface-0`；面板 `--surface-1`。
- Toolbar：顶部 `h-12 flex items-center gap-2 px-3 border-b border-border bg-surface-1`；图标按钮 36px。
- AssetPool：左侧 `w-56 bg-surface-1 border-r border-border`；角色分组；卡片 `rounded-md border border-border bg-surface-2 p-1 hover:border-accent`；拖拽时 ghost `opacity-60`。
- ShotCard：`w-72 rounded-lg border border-border bg-surface-1`；选中 `border-accent ring-2 ring-accent/30`；时长手柄右侧 `w-2.5 cursor-ew-resize hover:bg-accent`。
- LayerInspector：右侧 `w-80 bg-surface-1 border-l border-border`；字段用统一 `<Field>`；chip 选择动画入场/退场。
- Timeline：轨道间距 8px；当前播放头 `w-px bg-accent`；拖拽时目标轨道高亮 `ring-2 ring-accent/50`。
- Preview：黑场 `bg-black`；播放控制条 `bg-black/60 text-white`。

### 5.12 编排台（Workbench）专用

- NodeCard：`rounded-lg border border-border bg-surface-1 p-4`；节点名左侧状态点；右侧 `PlanSheet` 入口。
- 高级 JSON：`<details>` 折叠；内部 `font-mono text-caption`；编辑用 `<Textarea>` 的 mono 变体。
- stale 影响：`<ImpactPill>` 统一 `border-stale/40 bg-stale/10 text-stale`；点击展开 DAG 明细。

---

## 6. 页面级重构清单

> 每个页面都套用全局骨架 + 元素级组件；这里只列页面特有差异。

| 页面 | 当前主要问题 | 目标变化 |
|---|---|---|
| `/` 首页 | 上传表单是裸 input/file；项目列表是裸 li | 用 `<Field>` + 拖放上传区 + 项目卡（封面/书名/字数/状态/进入） |
| `/books/[id]` 导航页 | 6 个入口是手写 button | 用流程铁路 + 卡片式入口，显示每步状态/待审数 |
| `bible` | 三风格候选纵向卡片；无对比预览 | 用 `<CandidateGallery>` 卡片化，支持左右对比；章节摘要排版成“报告卡” |
| `script` | beat 列表手写；红黄项提示弱 | beat 卡统一 `<InteractiveCard>`；红黄项左侧色条 + 点击定位；自检区用 `<ReviewInbox>` |
| `assets` | 资产网格裸卡；两阶段生成无清晰进度 | 统一资产卡 + 对比条；生成区用 `<JobStepList>`；候选/已批准分区 |
| `storyboard` | 横向轨道裸卡；无统一时间轴头 | 镜头卡统一暗色/浅色样式；轨道头（镜头号/时长/状态） |
| `voice` | 逐句列表手写；ASR 红项不突出 | 句子行 + 试听播放器 + ASR 置信度标记；红项左色条 |
| `render` | 复制命令的终端感弱；任务列表裸 | 渲染命令卡 + 复制按钮 + 任务行/进度 |
| `workbench` | 密集但无层级；高级 JSON 裸 textarea | NodeCard 分区；字段用 `<Field>`；PlanSheet/TimeMachine/CommandPalette 统一 |
| `canvas` | 最有潜力但工具栏/资产池/检查器风格不统一 | 整体暗色化；按 §5.11 重做 |

---

## 7. 交互系统完善（每个细节）

| 交互 | 规格 |
|---|---|
| 点击反馈 | 按钮按下 `active:scale-[0.98]`（仅按钮）；卡片按下不变 |
| Hover | 可点元素 `transition-colors duration-fast`；列表/卡片 hover 底色 |
| 焦点 | 全局 `:focus-visible` accent；模态 focus trap；返回焦点 |
| 拖拽 | 拖起 `opacity-60` ghost；目标高亮 `ring-accent`；落空 shake（`nc-shake`） |
| 乐观更新 | mutation 后 <100ms 本地生效，失败回滚 + toast |
| 进度 | 真实百分比；无分母只显示阶段；首事件 <1s |
| 中断 | 取消/暂停/重定向三分；输入保持可用 |
| 键盘 | 全站 Cmd+K；画布 B/S/R；审阅 j/k/a/r/u；`?` 打开快捷键面板 |
| 撤销 | 所有破坏性操作 checkpoint + toast 撤销入口 |
| 成本 | 预飞/实时/收据三时刻；预算触顶硬停 |
| 动效 | 所有过渡用 `--dur-*`；无限动画只允许功能指示器；reduced-motion 全局兜底 |
| 无障碍 | axe critical/serious=0；≥24px；aria-live；lang=zh-CN |

---

## 8. 视觉回归与验收

1. **新增 `/ui` 风格指南页**（dev 专用路由，不纳入正式导航）：集中展示所有组件/状态/尺寸，作为设计定稿和截图基线。
2. 视觉基线扩展到 **全部 10 页 + `/ui` + 暗色画布**，桌面/移动双视口。
3. 每个里程碑跑：`lint:ui` → `lint` → `tsc` → `vitest` → `vitest:ui` → `build` → `playwright --update-snapshots`。
4. 验收标准：
   - 无裸调色板类、无手写重复表单/按钮/卡片样式（grep 可查）
   - 每个页面都有统一 PageHeader + 主操作 + 状态上下文
   - 空态/加载/错误/成功四态齐全
   - 画布暗色、管理页浅色，令牌无硬编码
   - 键盘可完成核心流程
   - axe critical/serious = 0

---

## 9. 执行路线（可见里程碑）

| 里程碑 | 内容 | 可见结果 | 验收 |
|---|---|---|---|
| **M0 · 设计基座** | 完整令牌、AppShell、PageHeader、Field/Input/Select/Textarea、Button 全状态、Card/List/Table、Toast/Dialog 基础 | 全站页面骨架和表单立刻变整齐 | 10 页都出现统一页头；表单不再裸 class |
| **M1 · 页面重构** | 按 §6 逐页替换：首页/书页/bible/script/assets/storyboard/voice/render/workbench | 每个页面都有明确视觉层级 | 每页无手写 section/input/button 残留 |
| **M2 · 画布/编排台深水区** | 画布暗色化、工具栏/资产池/检查器/时间轴重做；workbench NodeCard/JSON/PlanSheet 整合 | 画布像剪辑软件，workbench 像专业编排台 | 画布截图与 M0 前有明显差异 |
| **M3 · 交互细节** | 拖拽 ghost/目标高亮/落空 shake、键盘帮助面板、停滞检测、暂停/恢复、JobTrace、预算硬停 | 操作反馈和任务可观测性完整 | 交互清单逐项验收 + e2e |

---

## 10. 风险与取舍

| 风险 | 缓解 |
|---|---|
| 改动面大、视觉基线频繁变 | 每个里程碑独立更新基线；先做 `/ui` 风格页定稿再铺开 |
| 与既有功能/测试冲突 | 只改视觉与交互壳，不动数据流；每个里程碑跑全量门禁 |
| 画布暗色化影响可读性 | 对比度复测；`data-theme` 只作用于画布容器 |
| 中文排版差异 | 用系统中文回退 + 行高 1.6；不做自定义 web font 以减少体积 |
| 是否引入组件库 | 仍不引入 shadcn；自研组件量可控，且已有令牌体系 |

---

## 12. M0 落地记录（已完成）

> 设计基座已全部落地并通过全量门禁；M1/M2 进入页面深水区与画布重构。

**已完成**
- 令牌系统：`surface-0/1/2/3`、`inverse/surface-invert`、胶片青 `accent` 三态 + `on-accent`、暗色画布 `[data-theme="dark"]`、完整字阶（overline→display）、阴影/圆角扩展、`nc-shake`。
- 反色修正：`text-surface`/`bg-text` 迁移到 `text-inverse`/`bg-surface-invert`，避免暗色主题下反色失效。
- 基础组件：`Field/Input/Select/Textarea`、`PageHeader`、`PhaseRail`、`Card`、`ListRow`、`/ui` 风格指南页。
- 按钮：primary 改为胶片青 + `on-accent` 对比色，新增 `active:scale-[0.98]` 按压反馈。
- 页面骨架：首页、书导航页、bible、script、assets、storyboard、voice、render、workbench 统一使用 `<PageHeader>`；书导航页签核入口卡片化、章节列表用 `<ListRow>`。
- 表单迁移：首页上传、script 编辑卡、storyboard 时长/背景、workbench 人物/配音/说话人/镜头/图层/风格/资产/JSON 全部迁移到 `Field/Input/Select/Textarea`（script 的 range slider 保留原生）。
- 卡片迁移：bible 摘要/人物/线索/风格方案、script 章节/自检/beat、storyboard 镜头卡、voice 句子行、render 命令/任务行、workbench 节点/人物/配音/说话人/镜头/风格/线索/资产卡、首页结果卡均换用 `<SectionCard>/<Card>`。
- UI 测试：Field/Input/Select/Textarea/Card/ListRow/PageHeader/PhaseRail 已补测试，kit 18 例通过。
- 视觉回归：新增 `/ui` 与书导航页双视口基线，e2e 24/24 通过。

**验证**：`lint:ui` ✅ · `lint` ✅ · `tsc` ✅ · `vitest` 77 ✅ · `vitest:ui` 18 ✅ · `build` ✅ · `e2e --update-snapshots` 24 ✅

**进入下一里程碑**
- M1：按 §6 逐页深水区重构（表单/列表/卡片进一步打磨、页面级视觉层级）。
- M2：画布暗色化与工具栏/资产池/检查器/时间轴重做。

---

## 13. M1 页面深水区重构（已完成）

> 逐页完成页面级视觉层级与细节；每批全量门禁 + 视觉基线更新。

**已完成**
- 首页：拖放上传区（dragOver 高亮 + 落盘提示）、项目列表改为卡片网格。
- script：红/黄自检项在 beat 卡左侧加色条（红 stale / 黄 regen）。
- voice：ASR 红项句子行加左侧色条。
- render：复制命令按钮改为统一 `<Button>`。
- assets：资产卡改为 `<Card flush>`（媒体卡无内边距），候选/已批准分区，保留候选对比吸底条。
- storyboard：镜头卡增加统一头部（镜头号 · 机位 / 时长）。
- book 导航：增加 `PhaseRail` 流程铁路（由 book.status 映射当前阶段）。
- bible/script/workbench：页头、卡片、表单、状态上下文已在前序批次统一（M0 + M1）。

**验证**：`lint:ui` ✅ · `lint` ✅ · `tsc` ✅ · `vitest` 77 ✅（单独运行） · `vitest:ui` 18 ✅ · `build` ✅ · `e2e --update-snapshots` 24/24 ✅

> 注：并行跑 `npm test` 与 `npm run test:ui` 时曾出现 SQLite `database is locked`（checkpoints 测试），单独串行运行全绿；后续 CI 建议串行测试脚本。

**进入 M2**
- 画布暗色化、工具栏/资产池/检查器/时间轴重做（§5.11）。

---

## 14. M2 画布/编排台深水区（已完成）

> 画布暗色化 + 顶部工具栏；workbench 层级在 M0/M1 已统一。

**已完成**
- 画布容器加 `data-theme="dark"`：资产池、检查器、镜头/beat 卡、预览全部走暗色令牌。
- 新增顶部工具栏：标题、快捷键提示、撤销、全片预览。
- 画布视觉基线已更新（desktop/mobile）。
- workbench：NodeCard/JSON/PlanSheet 已在 M0/M1 统一为 `SectionCard/Card/Textarea`。

**验证**：`lint:ui` ✅ · `lint` ✅ · `tsc` ✅ · `vitest` 77 ✅ · `vitest:ui` 18 ✅ · `build` ✅ · `e2e --update-snapshots` 24/24 ✅

**进入 M3**
- 拖拽 ghost/目标高亮/落空 shake、键盘帮助面板、停滞检测、暂停/恢复、JobTrace、预算硬停。

---

## 15. M3 交互细节（已完成）

> 键盘帮助、拖拽反馈、停滞检测、轻量 JobTrace 已落地；暂停/恢复与预算硬停按“可选/依赖 M1 价格表”延后。

**已完成**
- `ShortcutHelp` 组件：`?` 打开/关闭快捷键帮助（输入控件内不劫持），挂载到画布与编排台。
- 画布拖拽反馈：拖起资产半透明（ghost），落空改用 `nc-shake` 抖动。
- `JobStepList` 停滞检测：超过阈值（默认 30s）后步骤/进度条变琥珀色并提示“已 N 没有新事件”。
- `useJob` 增加 `lastEventAt`，为停滞检测提供数据。
- 轻量 `JobTrace`：JobStepList 内折叠展示最近执行日志。

**验证**：`lint:ui` ✅ · `lint` ✅ · `tsc` ✅ · `vitest:ui` 18 ✅ · `build` ✅ · `e2e --update-snapshots` 24/24 ✅

**延后（可选/依赖外部）**
- 暂停/恢复：需要 worker 协作式 pause 与 schema 扩展，归入 M1 夜跑队列一起做。
- 预算硬停：依赖 M1 价格表接入后实现“触顶即停”。

---

## 11. 参考

- `docs/06-ui-optimization-plan.md`（交互原语与验证闭环）
- `docs/07-ui-visual-interaction-research.md`（行业调研与 P4 规划）
- Claude Code / Cursor / Antigravity 视觉与交互模式（07 §2）
- Vercel product-design skill 的规则工程（07 §5）
- 反 AI 味 / AI slop 专项（§2.1）：
  - [Impeccable](https://github.com/pbakaus/impeccable)（59 条确定性检测 + 23 命令）
  - [anti-ai-slop skill](https://github.com/Vinayak-Shukla-03/anti-ai-slop)（9 条硬规则 + 机械 grep 自审）
  - [community DesignSystem skill](https://github.com/Jaywalker-not-a-whitewalker/DesignSystem)
  - [cursor-design-rules](https://github.com/studioalexwolf/cursor-design-rules)
  - [superdesign-skill](https://github.com/superdesigndev/superdesign-skill)
  - [Caspian APP_DESIGN_PHILOSOPHY](https://github.com/TryCaspian/Caspian/blob/main/APP_DESIGN_PHILOSOPHY.md)
  - [Hallmark（反 AI 味 57 道闸门）](https://github.com/nexu-io/open-design/tree/main/plugins/community/hallmark)
