# 06 · UI 优化方案 v2 —— 把 AI coding agent 的交互原语移植进影像化工作台

> 本文是 [`04-interaction-redesign.md`](04-interaction-redesign.md) 的**超集**，不是替代。
> v1 的判断（"能点，但缺反馈/缺上下文/缺直接操纵"）是对的，落地也已完成约六成；
> v2 做三件 v1 没做的事：**① 把目标函数从"手感"改成"审阅吞吐量×信任度"**，
> **② 补上让所有反馈成为可能的架构前置改造（job-first 可观测执行）**，
> **③ 给出组件级规格 + 可复用 Skill + 可验证闭环**，让方案可被 AI agent 直接执行并回归验证。
>
> 状态：**P0 ✅ + P1 ✅ + P2 ✅ + P3 ✅** 见附录 B/C/D/E。方案主体已全部落地并通过验收。

---

## 0. 摘要（TL;DR）

**结论一：本产品的用户不是"操作员"，而是 6 个签核点上的审阅者。**
所以 UI 的目标函数不是"按钮更多更好看"，而是 **在不降低签核质量的前提下，提高每单位时间的可信签核数**。

**结论二：行业数据已经证明这个方向。** METR 随机对照实验发现资深开发者用 AI 编码 agent 后反而**慢 19%**（[METR/Simon Willison](https://simonwillison.net/2025/Jul/12/ai-open-source-productivity/)）；Google DORA 2025 报告显示 AI 采用近乎普及，但**交付吞吐未提升、信任下降、代码审阅时间上升，认知负荷成为新瓶颈**（[DORA 2025](https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025/)）。瓶颈已从"生成"转移到"审阅与信任"——本项目一次 `adapt` 产出 8~20 个 beat + 17 个镜头 + 8 条配音，等价于一个几百行的 PR，而当前 UI 给的是"列表 + 一个批准按钮"，**结构上就在鼓励橡皮图章**。

**结论三：AI coding 工具已经收敛出五个信任原语**，本项目可以直接移植：
`计划先行` · `暂挂式 diff 审阅` · `检查点回滚` · `默认折叠的理由` · `实时成本计量`。

**结论四：v1 的 I0 存在一个天花板——长任务是同步 HTTP 请求，进度物理上不可观测。**
不先做架构改造（`jobs` 表 + SSE + 取消），"进度条""骨架屏""断线恢复"只能做成假的。这是 v2 的 P0。

**最该先修的一条（信任债）**：`estimateRerun` 告诉用户重建分镜"（可撤销）"（`workbench.ts:211`），但 `buildStoryboard` 直接 `delete` 掉 shots 与 shot_layers（`storyboard.ts:378-379`）且**从不写快照**。能力撒谎比能力缺失更伤信任。

**交付物**：5 类硬伤审计 → 4 条设计律 → 11 条移植原语 → 4 项架构前置改造 → 1 套设计令牌 → 14 个组件规格 → 6 个自研 Skill + 现成 Skill/MCP 清单 → 2 层验证闭环 → 4 期路线 → **16 个可测指标**。

---

## 1. 现状审计（一手证据，file:line）

### 1.1 UI 资产盘点

| 类别 | 数量 | 说明 |
|---|---|---|
| 页面 | 10 | `src/app/**/page.tsx`，**全部 `'use client'`** + 自己 fetch API；唯一的服务端组件是 `layout.tsx` |
| 共享组件 | **2** | `storyboard-canvas.tsx`(773 行)、`toast.tsx`(91 行) |
| API 路由 | 28 | 薄封装，逻辑在 `src/lib/pipeline/nodes/*` |
| 全局样式 | **48 行** | `globals.css`，其中 20 行是 FFmpeg 预览动画 |
| UI 总量 | ≈3,200 LOC | 其中 **773 行（24%）集中在一个组件里** |

| 页面 | LOC | 职责 |
|---|---|---|
| `books/[bookId]/workbench/page.tsx` | 527 | 编排台（含内嵌 JSON 编辑器） |
| `books/[bookId]/script/page.tsx` | 335 | 签核点 B：beats 改编 |
| `books/[bookId]/storyboard/page.tsx` | 301 | 签核点 D：分镜 |
| `books/[bookId]/bible/page.tsx` | 252 | 签核点 A：档案 + 3 风格候选 |
| `books/[bookId]/assets/page.tsx` | 209 | 签核点 C：资产两阶段生成 |
| `books/[bookId]/voice/page.tsx` | 195 | 签核点 E：配音 |
| `page.tsx` | 176 | 上传入口 + 项目列表 |
| `books/[bookId]/page.tsx` | 144 | 章节列表 + 六页导航中枢 |
| `books/[bookId]/render/page.tsx` | 134 | 签核点 F：渲染（复制命令到终端） |
| `books/[bookId]/canvas/page.tsx` | 16 | 画布壳（`dynamic ssr:false`） |

**组件复用率 ≈ 0**：除 `toast` 外没有任何抽象。主按钮的 class 串
`rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50`
在 6 个页面里逐字复制（`page.tsx:112`、`bible:140`、`script:185`、`assets:130`、`storyboard:168`、`voice:127`），画布与编排台里还有更多。

### 1.2 v1 已落地的部分（先肯定）

| v1 承诺 | 状态 | 证据 |
|---|---|---|
| 全局 Toast（成功/失败/进行中 + action） | ⚠️ 已有但**只覆盖 2/10 页** | `toast.tsx:30-91`；仅 `canvas` 与 `workbench` 调用，其余 7 页各自手写红色错误 div（重复 9 处） |
| 快照撤销（snapshots 表） | ⚠️ 部分 | 表 `db.ts:732-739`；写入 `workbench.ts:140-150`；撤销 `workbench.ts:162-183` |
| 影响预报 `estimate()` | ⚠️ 部分 | `workbench.ts:186-221`，但返回中文句子而非结构化数据 |
| 内联确认卡替换 `confirm()` | ✅ 已达成 | 全仓 `confirm(`/`alert(` grep **0 命中** |
| 下游 stale 传播 | ⚠️ 部分 | `workbench.ts:223-263`，硬编码 switch |
| 画布中枢 + 检查器 | ⚠️ 部分 | `storyboard-canvas.tsx`：ReactFlow + 资产池拖放 + 检查器 |

**I0 完成度约 60%**，但存在 5 个硬伤，其中 2 个是架构级、1 个是信任级。

### 1.3 五个硬伤

#### H1 · 长任务同步阻塞，进度物理上不可观测（架构级，最高优先）

- 所有 AI 节点都是**同步 HTTP 请求**：`adapt/route.ts:25` 直接 `await runAdaptation(...)`，耗时 30~90s；`analyze`、`assets/generate`、`voice/generate`、`storyboard/build` 同构。
- `jobs` 表（`db.ts:690-705`）**只在终态写入一次**：`llm.ts:134-158` 的 `logJob()` 在调用**结束后**插入 `status: succeeded|failed`。没有 `running` 行、**没有 `progress` 列**、没有当前步骤。
- 唯一真正异步的是渲染：`render/start/route.ts:14` `spawn` detached 子进程，`render_jobs` 也确实有 `progress REAL`（`db.ts:661`）。前端有一处递归 `setTimeout` 3 秒轮询（`storyboard-canvas.tsx:289-310`）——**但它只读 `status`，没有读那个已经存在的 `progress` 字段**，所以进度依然看不见；其余 9 个页面完全没有轮询。
- 全仓 grep：浏览器端 `EventSource` **0**、`setInterval` **0**、streaming response **0**。
  值得注意的是**流式消费的经验仓内已有**：`providers/tts.ts:89-99` 就在服务端消费上游 SSE。缺的不是知识，是把它接到前端的通道。
- **后果**：违反 Nielsen 10 秒注意力上限与"可见性"启发式；无法提供 Myers 证明有效的百分比进度；HTTP 超时或用户刷新即彻底丢失任务状态；无法取消。
- **这是天花板**：v1 的"按钮变进度条""骨架屏""逐句进度"在当前架构下**只能造假**。

#### H2 · 撤销是"假承诺"（信任级，最该先修）

- `estimateRerun` 对 storyboard 返回："`会覆盖镜头与图层的手工修改（可撤销）`"（`workbench.ts:211`）。
- 实际执行路径 `rerunNode('storyboard')` → `buildStoryboard()` → `storyboard.ts:378-379`：
  ```ts
  await supabase.from("shot_layers").delete().in("shot_id", oldShotIds);
  await supabase.from("shots").delete().in("id", oldShotIds);
  ```
  **全程不写 `snapshots`**。用户手工调过的时长、机位、图层、入出场动画**永久丢失**。
- `undoLatest()`（`workbench.ts:162-183`）只覆盖 `patchWorkbenchRow` 的手工编辑，且是**全书 LIFO 单步**、**无 redo**、无作用域；撤销后还会 `delete` 掉快照，等于消费掉唯一的历史。
- 违反 Apple HIG 生成式 AI 指南（改动应为可编辑草稿、关键决策需人确认）、Nielsen 启发式 #3（用户控制与自由）、HAX G9（支持高效纠正）。

#### H3 · 设计系统真空

- `globals.css` 只有 2 个令牌（`--background`/`--foreground`，`globals.css:3-6`）。**没有**间距、圆角、阴影、字号、动效时长、状态色标尺。
- **字体白装**：`layout.tsx:6-14` 引入 Geist / Geist_Mono 并挂上 CSS 变量，但 `globals.css:25` 的 `body { font-family: Arial, Helvetica, sans-serif; }` 把它**整个覆盖**了。全站实际在用 Arial。
- 状态色硬编码在组件内（`toast.tsx:59-65` 的 emerald/red/blue/zinc 分支）。
- **状态语义分散**：20+ 张表各有自己的 `status` 默认值，共 **7 种**互不统一的默认取值——`draft`、`pending`(asset_requests/jobs)、`generating`(assets)、`queued`(render_jobs)、`open`(review_tasks)、`introduced`(clues)，以及运行时才出现的 `stale`/`pending_review`（`workbench.ts:228/248`）。权威枚举其实定义在 `supabase/migrations/0001_schema.sql:16-34`（20 个 type），但**SQLite 侧存自由 TEXT、运行时零约束**，且这些取值混了三类不同语义（审阅态 / 执行态 / 剧情态），UI 无法用一套徽章表达——详见 §5.3。
- 暗色模式半成品：`globals.css:15-20` 声明了 `prefers-color-scheme: dark`，但所有组件硬编码 `bg-white`/`text-zinc-700`（`toast.tsx:65`），暗色下必然出现白底白字。
- `metadata` 仍是 `"Create Next App" / "Generated by create next app"`（`layout.tsx:17-18`）。

#### H4 · 可达性为零

全仓 grep 结果：`aria-live` **0**、`aria-label` **0**、`role=` **0**、`prefers-reduced-motion` **0**、focus 管理 **0**、`error.tsx`/`loading.tsx`/`not-found.tsx` **0**、Error Boundary **0**。

- Toast 无 `aria-live` → 违反 WCAG 4.1.3 状态消息；对读屏用户，异步操作的成功/失败**完全不可知**。
- `<html lang="en">`（`layout.tsx:24`）但全站中文 → 读屏发音错误。
- `kb-in`/`kb-out`/`kb-pan`/`kb-breath` 都是 `infinite alternate`（`globals.css:45-48`），**无 reduced-motion 兜底** → 违反 W3C C39，对眩晕敏感用户是伤害。
- 无键盘快捷键、无命令面板、无 focus-visible 样式。

#### H5 · 数据流粗暴：每次编辑都全量重载

- 所有 mutation 之后一律 `await load()`（`bible/page.tsx:93,116`；`voice/page.tsx`；`assets/page.tsx`；`storyboard-canvas.tsx:74`…）。
- `getWorkbench()` 一次跑 **11 个并行查询** + 对每个资产 `await resolveAssetUrl()`（`workbench.ts:87-91`）+ **预热 6 个 `estimateRerun`**（`workbench.ts:93-98`，每个都要查库、其中两个还 `await import()`）。改一个 beat 的情绪，会触发这一整套。
- 全仓 `useOptimistic` / `useTransition` / `useActionState` / Server Actions grep **0 命中**——React 19 就在依赖里（`react: 19.2.8`）却完全没用。
- **这就是"单薄感"的机制性原因**：点击 → 等一整轮往返 → 整屏数据跳变，中间没有任何"我的意图已被接受"的信号。违反 RAIL <100ms 响应预算与 INP ≤200ms。

### 1.4 v1 的 17 项操作 · 能力矩阵（按实际代码重新判定）

图例：✅ 有 · ⚠️ 仅 busy/disabled 文案 · ❌ 无

| # | 操作 | 反馈 | 进度 | 撤销 | 成本/影响预报 | 直接操纵 | 主要证据 |
|---|---|---|---|---|---|---|---|
| 1 | 上传 txt | ⚠️ | ❌ | ❌ | ❌ | ❌ | `page.tsx:45-78,118-146`；无拖放区 |
| 2 | 运行单章分析 | ⚠️ | ❌ | ❌ | ❌ | ❌ | `bible/page.tsx:79-99,137-143`；预报只在编排台 `workbench.ts:189-192` |
| 3 | 批准风格方案 | ⚠️ | — | ❌ | ❌ | ❌ | `bible/page.tsx:101-122,216-222`；3 候选纵向排列，无对比视图 |
| 4 | 运行章节改编 | ⚠️ | ❌ | ❌ | ❌ | ❌ | `script/page.tsx:101-122`；红黄项 `:233-248` **不可点击定位** |
| 5 | 编辑 beat 台词/情绪 | ⚠️ **不一致** | — | ⚠️ 单步 | ❌ | ❌ | script 页**静默保存无 toast** `:124-145`；canvas/workbench 有 toast+撤销 `canvas:200-252` |
| 6 | 更换说话人 | ✅ | — | ✅ 单步 | ❌ | ❌ | 两处入口不一致：`workbench:319-328` / `canvas:496-509` |
| 7 | 资产生成（两阶段） | ⚠️ | ❌ | ❌ | ❌ | ❌ | `assets/page.tsx:66-89`；无生成队列、无费用条 |
| 8 | 批准/淘汰资产 | ⚠️ | — | ❌ | ❌ | ❌ | `assets/page.tsx:91-105,190`；只有"选这张"，无淘汰路径与对比画廊 |
| 9 | 构建分镜 | ⚠️ | ❌ | **❌ 谎称可撤销** | ⚠️ 文字 | ❌ | `workbench.ts:211` vs `storyboard.ts:378-379`；无 dry-run 镜头数 |
| 10 | 改镜头时长/机位 | ⚠️ **不一致** | — | ⚠️ 单步 | ❌ | ❌ | storyboard 页静默保存 `:129-151`；canvas 有 toast+撤销 `:218-234`；时长仍是数字输入框 `:620-624` |
| 11 | 换人物图（拖资产） | ✅ | — | ✅ 单步 | ❌ | ⚠️ 有 DnD | `canvas:337-367,395-397`；无 ghost / 目标高亮 / 落地反馈 |
| 12 | 改入场/出场 | ✅ | — | ✅ 单步 | ❌ | ❌ | `canvas:680-693`、`workbench:428-441`；无入/出点手柄 |
| 13 | 配音生成/重录 | ⚠️ | ❌ | ❌ | ❌ | ❌ | `voice/page.tsx:61-107`；8 句串行、无逐句进度、ASR 红项不自动聚焦 |
| 14 | 渲染 | ⚠️ | ⚠️ 只轮 status | ❌ | ❌ | ❌ | `render/page.tsx:54-58` 仅复制命令；`canvas:289-310` 轮询**忽略 progress 字段** |
| 15 | 重跑节点 | ✅ | ❌ | ✅ 仅手工编辑 | ✅ 文字 | ❌ | `workbench:137-164`、`canvas:312-335`、`workbench.ts:186-221`；无"只重跑下游" |
| 16 | 看成本 | ❌ | — | — | ❌ | — | 仅 CLI `scripts/cost-report.ts`；UI 零入口 |
| 17 | 状态徽章含义 | ❌ | — | — | ❌ | — | 裸英文文本约 15 处（`assets:186`、`voice:165`、`storyboard:193`、`workbench:468,485`…）；仅 stale 有红框 `canvas:716,740` |

**汇总：进度 0/17 · 成本可见 0/17 · AI 覆盖类操作可撤销 0/17 · 反馈一致性只在 2/10 页达成。**

### 1.5 重复实现清单（组件化的直接收益）

| 模式 | 重复次数 | 位置 |
|---|---|---|
| 状态徽章（裸英文文本） | ~15 | `assets:186` `voice:165` `storyboard:193` `render:110` `workbench:468,485` `books/[bookId]/page.tsx:121,137` `canvas:716,740` `script:212` |
| 错误横幅（红 div） | **9** | `page.tsx:118-122` `books/[bookId]:59-63` `bible:146-150` `script:200-204` `assets:144-148` `storyboard:184-188` `voice:142-146` `render:71-75` `workbench:179-181` |
| 主按钮 | 6+ | 见 §1.1 |
| beat 编辑器 | **3** | `script:289-324` `workbench:315-360` `canvas:493-544` |
| shot 编辑器 | **3** | `storyboard:264-295` `workbench:364-400` `canvas:611-654` |
| layer 编辑器 | 2 | `workbench:402-447` `canvas:656-699` |
| 枚举常量（EMOTIONS/CAMERAS/TRANSITIONS/ENTER_EXIT） | **3** | `script:7-10` `canvas:20-22,525` `workbench:28-30,344` |
| 「保存→toast→撤销」流程 | 2 | `canvas:200-252` `workbench:79-135` |
| 内联确认卡 | 2 | `canvas:440-449` `workbench:208-227` |
| `<select>` 字段样式 | 数十 | 8 个页面，无 `<Field>` 抽象 |
| 「…中」loading 文案 | 6+ | `bible:142` `script:187` `assets:132` `storyboard:170` `voice:129` `workbench:203` |

> 同一个 beat 编辑器写了 3 遍、shot 编辑器写了 3 遍、枚举常量抄了 3 份——这意味着**任何交互改进都要改 3 处**，是 v1 落地缓慢的结构性原因。组件化不是洁癖，是让后续每期路线的改动成本从 ×3 降到 ×1。

---

## 2. 底层逻辑：为什么目标函数是"审阅吞吐量 × 信任度"

### 2.1 证据链

| 证据 | 数字 | 对本项目的含义 |
|---|---|---|
| [METR RCT](https://simonwillison.net/2025/Jul/12/ai-open-source-productivity/) | 资深开发者用 AI agent **慢 19%** | 生成变快 ≠ 交付变快；验证开销是真实成本 |
| [DORA 2025](https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025/) | 吞吐未升、**信任下降、审阅时间上升**、认知负荷成为瓶颈 | 优化对象是审阅面，不是生成速度 |
| [SmartBear/Cisco](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/) | 单次审阅 **<400 LOC**、**<500 LOC/小时**，超出则缺陷检出率骤降 | 一次 17 镜头 + 20 beat 的全量覆盖**超出人类单次审阅容量** |
| [审阅规模超过阅读速度 → 橡皮图章](https://www.sonarsource.com/jp/blog/how-to-scale-code-quality/) | — | "全选批准"会变成默认路径 |
| [Parasuraman & Manzey 2010](https://journals.sagepub.com/doi/abs/10.1177/0018720810376055) | 自动化偏见与自满**随可靠性升高而加剧** | 模型越好，用户越不看——必须靠 UI 结构对抗 |
| [Cowan 2001](https://www.kirschnered.nl/2025/04/11/schemas-chunking-and-working-memory/) | 工作记忆 ~**4 个 chunk**（非 7±2） | 变更必须分组呈现，每组 ≤4 |

### 2.2 四条设计律（本方案的公理）

> **① 先给计划（show the plan）· ② 流式给进度（stream the progress）· ③ 按风险设闸（gate the action）· ④ 永远可撤销（always undo）**

这四条不是审美偏好，是上表的直接推论。后续每个组件规格都必须能回答"我服务哪一条"。

### 2.3 反目标（明确不做）

- ❌ 不追求"AI 感"视觉特效；动效只服务状态转换的可理解性。
- ❌ 不做聊天式主界面。线性对话隐藏状态、迫使一切经过自然语言，是已被批判的"钥匙孔效应"（[Keyhole Effect](https://ar5iv.labs.arxiv.org/html/2602.00947)、[LukeW](https://lukew.com/ff/entry.asp?2105)）。本项目的正确形态是**结构化画布 + 异步收件箱**。
- ❌ 不给每个操作都加确认。确认疲劳会让"批准"变成盲点（[BMC 2017](https://link.springer.com/article/10.1186/s12911-017-0430-8)，ICU 误报率常 >90%）。

---

## 3. 移植表：AI coding 的交互原语 → 影像化工作台

### 3.1 五个信任原语（行业已收敛）

| # | 原语 | 为什么有效 | AI coding 里的形态 | **本项目的形态** | 落点 |
|---|---|---|---|---|---|
| **T1** | **计划先行**（只读产出计划） | 把"决策"与"副作用"解耦，错一步的代价归零 | Claude Code / Codex `plan mode`（只读）；Cline 计划模式需批准；Copilot Workspace spec→plan→files | **预演卡**：任何 AI 节点执行前先产出"将生成什么/覆盖什么/花多少/多久/是否可逆"，可只预演不执行 | `<PlanSheet>` + 结构化 `estimate()` |
| **T2** | **暂挂式 diff 审阅** | 粒度匹配注意力；保留对的 90%，只驳回错的 10% | Zed 编辑落为待接受 hunk；Cursor Tab 内联 diff 逐块接受/驳回；Copilot 按文件接受/丢弃 | AI 覆盖 beats/shots 前先进 **staging**，逐条 accept / reject / 就地编辑；分组 ≤4 条 | `<DiffReview>` + `staged_changes` 表 |
| **T3** | **检查点回滚** | 把"不可逆"变成"可实验"，是最强的信任建立器 | Cursor checkpoints；Cline git 快照；Claude Code `/rewind`；Aider 每次改动自动 commit + `/undo` | 每次 rerun/生成**前**批量快照受影响行 = 检查点；多步撤销 + redo + "回到签核点 C" | `checkpoints` 表 + `<TimeMachine>` |
| **T4** | **默认折叠的理由** | 少数人要看推理，多数人只看结论——折叠是帕累托最优 | 各家 thinking 默认折叠可展开（Codex 用户明确反对不可折叠的推理刷屏） | `selection_report` / `ai_report` / ASR 红项 / 提示词默认折叠，一键展开**证据** | `<EvidenceDisclosure>` |
| **T5** | **实时成本计量** | 把可怕的"未知"变成被监控的变量，直击"老虎机感" | Cline/Roo/Aider 实时 token+$ 计价器；Claude `/cost`、`/context` | 今日/本书/本次三级成本仪表盘 + 预算阈值告警；每次调用前预报、调用后留痕 | `<CostMeter>` + `jobs.cost` |

### 3.2 六个二级原语

| # | 原语 | 为什么有效 | 本项目的形态 | 落点 |
|---|---|---|---|---|
| S1 | **步骤流替代转圈** | "在做什么"才让人安心；转圈只说"没死" | 逐句配音 8 步、逐张出图 N 步的阶段进度（含已用时/预计/当前项） | `<JobStepList>` |
| S2 | **异步 + 通知 + 收件箱** | 尊重注意力；在自然边界批量审阅（等价于"在 PR 上审"） | 长任务后台化，完成后进"待签核收件箱"——**`review_tasks` 表已存在**（`db.ts:707-718`）却完全没用 | `<ReviewInbox>` |
| S3 | **风险分级批准** | 不同动作风险不同；一刀切确认制造疲劳 | 零成本可逆（重建分镜）免确认；花钱（图像/TTS）或不可逆才确认 | `<InlineConfirm>` + `risk` 字段 |
| S4 | **爆炸半径可见** | blast radius 才是真实风险 | "将覆盖你手工修改的 6 个镜头"——需要真实 DAG 才能算 | `graph.ts` + `<ImpactWarning>` |
| S5 | **显式上下文 / @ 提及** | 显式定位优于隐式检索，输入可被检视 | `Cmd+K` 里 `@beat3`、`@林晚`、`@镜头7` 直接定位并执行动作 | `<CommandPalette>` |
| S6 | **可打断 / 可排队 / 可恢复** | 长任务必须能中断、刷新后能接回 | 取消生成队列剩余项；刷新后用 `Last-Event-ID` 重放 job 事件 | `jobs.cancel_requested` + SSE |

### 3.3 明确规避的反模式（来自同批调研）

| 反模式 | 行业证据 | 本项目的对应风险 |
|---|---|---|
| 隐形改动 | Cursor 用户"看不见 agent 在做什么就焦虑" | 当前 rerun 直接覆盖，无 diff |
| 自动应用无一键撤销 | Cursor Apply 曾缺一键撤销被批为"关键缺陷" | H2 正是此症 |
| 成本不透明 | Cursor 社区最高频抱怨 | 成本只能跑 `scripts/cost-report.ts` |
| 不可折叠的推理刷屏 | Codex issue #2375 | `selection_report` 若直铺会淹没页面 |
| 把编辑器藏进聊天框 | Google Antigravity 2.0 被批并回退 | 不要用聊天替代画布 |
| 接受按钮埋在滚动里 | Copilot "Missing Reject File button" | diff 的接受/驳回必须吸附常驻 |

---

## 4. 架构前置改造（P0：没有这层，UI 优化只是装饰）

### 4.1 job-first 可观测执行模型（解 H1）

**Schema 增量**（`jobs` 表，`db.ts:690`）：

```sql
ALTER TABLE jobs ADD COLUMN progress REAL NOT NULL DEFAULT 0;      -- 0..1
ALTER TABLE jobs ADD COLUMN step TEXT;                              -- 当前步骤中文标签
ALTER TABLE jobs ADD COLUMN step_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN step_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN checkpoint_id TEXT REFERENCES checkpoints(id);
ALTER TABLE jobs ADD COLUMN updated_at TEXT;
CREATE TABLE IF NOT EXISTS job_events (       -- 事件流，支持断线重放
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,                          -- step|progress|log|artifact|done|error
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, seq);
```

**新模块**：

| 文件 | 职责 |
|---|---|
| `src/lib/jobs/queue.ts` | `enqueue(bookId, node, input) → jobId`（立即返回，插入 `status:'pending'` 行） |
| `src/lib/jobs/runner.ts` | 单进程串行 worker：取 pending → 置 running → 执行 → 写事件 → 终态；崩溃后启动时把孤儿 running 标 `failed` |
| `src/lib/jobs/progress.ts` | `ProgressReporter`：`step(label,i,total)` / `log(line)` / `artifact(ref)` / `checkCancelled()` |

**节点函数签名改造**（保持向后兼容）：

```ts
// 现在：await runAdaptation(bookId, chapter)
// 之后：await runAdaptation(bookId, chapter, reporter?)
//   内部在每个自然阶段调用 reporter.step("生成 beats", 2, 5)
//   在每次循环项后调用 reporter.checkCancelled()
```
落点：`analyze.ts`(278) / `adapt.ts`(371) / `assets.ts`(435) / `voice.ts`(398) / `storyboard.ts`(529)。
`assets` 与 `voice` 天然是 N 项循环，**最容易给出真实百分比**——优先改这两个。

**API**：

| 端点 | 说明 |
|---|---|
| `POST /api/books/[bookId]/jobs` | body `{node, input?}` → `{jobId}`；替代现有同步节点路由 |
| `GET /api/books/[bookId]/jobs/[jobId]/stream` | **SSE**（`ReadableStream`）；支持 `Last-Event-ID` 从 `job_events` 重放 |
| `POST /api/books/[bookId]/jobs/[jobId]/cancel` | 置 `cancel_requested=1`，由 `checkCancelled()` 协作式中止 |
| `GET /api/books/[bookId]/jobs?active=1` | 页面挂载时恢复"正在跑什么" |

SSE 而非轮询的理由与实现要点（`runtime = 'nodejs'`、`Cache-Control: no-cache, no-transform`、`X-Accel-Buffering: no`、15s 心跳注释帧防代理断流、`EventSource` 失败降级为 2s 轮询）：参考 [Next.js App Router SSE 实践](https://dev.to/turboline_ai_/streaming-responses-in-nextjs-app-router-server-sent-events-and-readablestream-2c10)、[SSE 替代轮询的视频处理案例](https://dev.to/nareshipme/how-we-replaced-polling-with-server-sent-events-for-real-time-video-processing-updates-3mch)、[SSE vs WebSocket vs 轮询决策矩阵](https://wolf-tech.io/blog/nextjs-15-sse-vs-websockets-vs-polling-real-time-decision-matrix-2026)。
注意：`better-sqlite3` 强制 Node runtime（不能用 Edge），这对 SSE 反而有利。

### 4.2 声明式依赖 DAG（解 S4、替换硬编码 switch）

`propagateStale`（`workbench.ts:223-263`）是 switch，只能"传播"，不能"计数"和"溯源"。改为数据驱动：

```ts
// src/lib/pipeline/graph.ts
export const NODE_GRAPH = {
  analyze:   { produces: ['chapter_summaries','characters','locations','clues','style_bibles'] },
  adapt:     { produces: ['adapted_chapters','beats'], consumes: ['style_bibles','clues','source_chapters'] },
  storyboard:{ produces: ['shots','shot_layers','timelines'], consumes: ['beats','assets'] },
  voice:     { produces: ['voice_takes'], consumes: ['beats','voice_profiles'] },
  render:    { produces: ['render_jobs'], consumes: ['timelines','assets','voice_takes'] },
} as const;
```

派生三个 UI 能力（当前一个都给不出）：
1. **影响面计数** —「将使 17 个镜头 + 1 条时间线过期」
2. **stale 溯源** —「本镜头过期，因为你在 3 分钟前改了 beat#3」
3. **重跑最小集** —「只重跑受影响的下游」（v1 §2 第 15 条要求的勾选项）

### 4.3 结构化 `estimate()`（解 T1、顺带解 H5 的性能问题）

```ts
export interface NodeEstimate {
  node: RerunNode;
  llmCalls: number; imageCalls: number; ttsCalls: number;
  estTokens: number; estCostCents: number; estSeconds: [number, number];  // 区间
  produces: { table: string; count: number }[];
  overwrites: { table: string; count: number; handEdited: number }[];      // handEdited 才是真风险
  reversible: boolean;          // ← 必须真实，由是否写 checkpoint 决定
  blockers: string[];           // 例：「风格方案未批准」
}
```
- 现状 `estimateRerun` 返回中文句子（`workbench.ts:186-221`），UI 无法据此渲染成本条、无法排序、无法做预算告警。**文案生成应在 UI 层**。
- 同时**移除 `getWorkbench` 里 6 个 estimate 的预热**（`workbench.ts:93-98`），改为 `GET /estimate?node=` 按需取——这一条单独就能显著改善编排台首屏。

### 4.4 checkpoint 取代单步快照（解 H2）

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  label TEXT NOT NULL,          -- 「重建分镜前」/「批准风格 B 前」
  origin TEXT NOT NULL,         -- manual-edit | node-rerun | approve
  node TEXT,
  created_at TEXT
);
ALTER TABLE snapshots ADD COLUMN checkpoint_id TEXT REFERENCES checkpoints(id);
ALTER TABLE snapshots ADD COLUMN op TEXT NOT NULL DEFAULT 'update';  -- update|insert|delete
```

规则（**不可协商**）：
1. 任何**破坏性**节点执行前，先建 checkpoint 并批量快照受影响行（含 `delete` 的整行，用于恢复）。首先覆盖 `buildStoryboard`（`storyboard.ts:375-379`）。
2. `estimate().reversible` 必须由"是否真的建了 checkpoint"决定——**禁止再出现 H2 那样的文案承诺**。
3. `undoLatest` 升级为 `revertTo(checkpointId)`，支持多步与 redo（撤销时不再物理删除快照，改为标记）。
4. 6 个签核点在批准时自动打 checkpoint → 用户可"回到签核点 C"。

---

## 5. 设计系统层规格

### 5.1 令牌（写入 `globals.css`，Tailwind v4 `@theme`）

```css
@import "tailwindcss";

@theme {
  /* — 表面与文字：三层灰阶，暗色由 [data-theme] 覆盖 — */
  --color-surface:      #ffffff;
  --color-surface-2:    #f7f7f8;
  --color-surface-3:    #eeeef1;
  --color-border:       #e4e4e7;
  --color-border-strong:#d4d4d8;
  --color-text:         #18181b;
  --color-text-muted:   #71717a;
  --color-text-subtle:  #a1a1aa;

  /* — 状态色：六态，语义唯一（见 5.3） — */
  --color-approved:     #059669;   /* 已批准 */
  --color-review:       #2563eb;   /* 待审 */
  --color-draft:        #71717a;   /* 草稿 */
  --color-stale:        #dc2626;   /* 过期/需重跑 */
  --color-regen:        #d97706;   /* 待重生成 */
  --color-rejected:     #a1a1aa;   /* 已驳回（划线） */

  /* — 间距：4px 基数 — */
  --spacing-1: 4px;  --spacing-2: 8px;  --spacing-3: 12px;
  --spacing-4: 16px; --spacing-6: 24px; --spacing-8: 32px; --spacing-12: 48px;

  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
  --shadow-card: 0 1px 2px rgb(0 0 0 / .04), 0 4px 12px rgb(0 0 0 / .04);
  --shadow-pop:  0 8px 32px rgb(0 0 0 / .12);

  /* — 动效：对齐 Material 3 三档（short 50-200 / medium 200-400 / long 400-700） — */
  --dur-instant: 100ms;  /* 按钮按下、勾选 */
  --dur-fast:    160ms;  /* 徽章、tooltip */
  --dur-base:    240ms;  /* 面板、抽屉 */
  --dur-slow:    320ms;  /* 对象级入场 */
  --dur-stagger:  40ms;  /* 列表逐项延迟 */
  --ease-out:   cubic-bezier(.2,.8,.2,1);
  --ease-inout: cubic-bezier(.4,0,.2,1);

  /* — 命中区：WCAG 2.2 SC 2.5.8 要求 ≥24×24 — */
  --hit-min: 24px;
  --hit-comfortable: 36px;
}
```

### 5.2 顺手修掉的三个既有 bug

| Bug | 位置 | 修法 |
|---|---|---|
| Arial 覆盖 Geist | `globals.css:25` | 删掉 `font-family` 行，改用 `font-family: var(--font-geist-sans), system-ui, "Microsoft YaHei", sans-serif` |
| `lang="en"` 但全站中文 | `layout.tsx:24` | 改 `lang="zh-CN"` |
| metadata 是脚手架默认值 | `layout.tsx:17-18` | 改为「novel-cinema · 小说影像化工作台」 |

### 5.3 状态语义统一（三个族，**不要混成一个徽章**）

权威定义在 `supabase/migrations/0001_schema.sql:16-34`（Postgres 枚举共 20 个 type）。注意：**SQLite 侧存的是自由 TEXT，运行时没有任何约束**，所以归一必须在 UI 层做。

重新审计后发现，真正的问题不是"取值太多"，而是**三类完全不同的语义被同一种视觉表达混用**：

**族 A · 审阅生命周期** → 用 `<StatusBadge>`

| UI 状态 | 中文 | 色 | 来源枚举值 | tooltip |
|---|---|---|---|---|
| `draft` | 草稿 | `--color-draft` | `artifact_status.draft`、`take_status.draft` | 尚未提交审阅 |
| `review` | 待审 | `--color-review` | `artifact_status.pending_review`、`asset_status.candidate`、`review_status.open` | 等待你签核 |
| `approved` | 已批准 | `--color-approved` | `artifact_status.approved`、`asset_status.approved`、`take_status.accepted`、`review_status.approved` | 已签核，下游可用 |
| `rejected` | 已驳回 | `--color-rejected`（划线） | `artifact_status.rejected`、`asset_status.rejected`、`take_status.rejected` | 已驳回 |
| `stale` | 已过期 | `--color-stale` | `artifact_status.stale` | **因为「{原因}」而过期，影响 {N} 个下游** |
| `regen` | 待重生成 | `--color-regen` | `asset_status.archived`（淘汰但保留） | 已淘汰，等待重新生成 |
| `skipped` | 已跳过 | `--color-draft`（虚边框） | `review_status.skipped` | 本次签核已跳过 |

**族 B · 执行生命周期** → **不画徽章**，交给 `<JobStepList>` / `<JobTrace>`

`pending`/`queued` → 排队中 · `running` → 生成中（脉冲）· `succeeded` → 收起进度、把展示权交回族 A · `failed` → 错误卡 + 重试入口 · `cancelled` → 已取消（可重新入队）。
理由：**执行态是"过程"，审阅态是"结论"**。用同一个徽章会让用户分不清"生成完了"和"我批准了"。`asset_status.generating` 虽然挤在 asset 枚举里，语义上属于此族。

**族 C · 领域语义** → 中性 chip，**禁止使用状态色**

- `clue_status`：`introduced`/`recalled`/`resolved`/`red_herring` —— 这是叙事线索的**剧情状态**，不是审阅状态。
- `project_status`：`draft`/`analyzing`/`scripting`/`asset_ready`/`rendering`/`completed`/`failed` —— 这是**全书阶段**，应该驱动左侧"流程铁路"的高亮位置，而不是画成一个徽章。

> ⚠️ 这一条修正了本文早期版本的一个错误：把 `introduced`（线索剧情态）折进"草稿"是语义污染，会让用户误以为每条线索都需要签核。**凡不是审阅态的值，一律不许进 `<StatusBadge>`。**

实现：`src/lib/ui/status.ts` 导出
- `toReviewStatus(table, dbStatus) → ReviewStatus | null`（返回 `null` = "这不是审阅态，别画徽章"，由 `<StatusBadge>` 断言拒绝渲染）
- `toJobPhase(dbStatus) → JobPhase`
- `PROJECT_PHASES` 常量（驱动流程铁路）

### 5.4 动效与 reduced-motion（全局兜底，必须先写）

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  .kb-in, .kb-out, .kb-pan, .kb-breath { animation: none !important; }
}
```
另：`kb-*` 是 FFmpeg 效果的**预览近似**，属于"内容"而非"装饰"，因此 reduced-motion 下应停在首帧并显示静态标记（如「已停用预览动画」角标），而不是静默消失。

### 5.5 可达性基线（P0 必须达成）

| 项 | 要求 | 依据 |
|---|---|---|
| 状态播报 | Toast 容器 `role="status" aria-live="polite"`；错误 `role="alert" aria-live="assertive"`；job 完成播报一次 | WCAG 4.1.3 |
| 命中区 | 所有可点元素 ≥24×24 CSS px（当前 toast 关闭按钮明显不足，`toast.tsx:84`） | WCAG 2.2 SC 2.5.8 |
| 焦点 | 全局 `:focus-visible` 样式；抽屉/面板打开时 focus trap，关闭后归还焦点；焦点不被吸底条遮挡 | SC 2.4.7 / 2.4.11 |
| 流式内容 | 追加内容**不得抢焦点**；提供"跳到最新变更"按钮 | 键盘优先 |
| 语言 | `lang="zh-CN"` | — |
| 静态检查 | 引入 `eslint-plugin-jsx-a11y` | — |

---

## 6. 组件规格库（14 个 + 2 条纪律/选做）

每个组件标注它服务哪条设计律（①计划 ②进度 ③设闸 ④撤销）。

### 6.1 基础层

**1. `<Button>` / `<IconButton>`** — `src/components/ui/button.tsx`
- props：`variant: 'primary'|'secondary'|'ghost'|'danger'`、`size: 'sm'|'md'`、`loading?: boolean`、`progress?: number`（0..1，有值时按钮内渲染进度底纹）、`shortcut?: string`（右侧显示键位）。
- 关键行为：`loading` 时**保留原文案**并叠加进度底纹，不替换成"…中"——避免布局跳动与"文案闪烁"。
- a11y：`aria-busy`、`aria-disabled`（而非 `disabled`，保持可聚焦以便读屏读到原因）、`min-height: var(--hit-comfortable)`。
- 验收：替换掉 9 个文件里复制的 class 串。

**2. `<StatusBadge>`** — 服务 ④
- props：`status: ReviewStatus`（`toReviewStatus()` 返回 `null` 时**不渲染**，见 §5.3 族 A）、`reason?: string`、`impactCount?: number`、`onTraceClick?`。
- `stale` 时显示「已过期 · 影响 6」，点击展开溯源（来自 4.2 DAG）。
- 动效：状态变化时 `--dur-fast` 交叉淡入；`stale` 出现时红框呼吸**一次**后静止（不 infinite，遵守 5.4）。

**3. `<SectionCard>` / `<EmptyState>`**
- `<EmptyState>` 必须给"下一步做什么 + 一键执行"，而不只是"暂无数据"（v1 §4 空状态引导卡）。

**4. `<InlineConfirm>`** — 服务 ③
- props：`risk: 'none'|'cost'|'destructive'`、`estimate?: NodeEstimate`、`onConfirm`。
- **风险分级**：`none`（零成本可逆，如重建分镜且已建 checkpoint）→ **不确认**，直接执行 + Toast 撤销入口；`cost` → 内联卡显示费用；`destructive`（不可逆或覆盖手工编辑）→ 内联卡 + 必须勾选「我知道将覆盖 6 处手工修改」。
- 依据：确认疲劳研究——只对不可逆高代价动作确认，否则"批准"退化为盲点。判定 `risk` 的原则来自 [Horvitz 1999 混合主动](http://erichorvitz.com/uiact.htm)：**仅当「收益 > 犯错代价 × 犯错概率」时才静默执行**；据此，零成本且已有 checkpoint 的操作静默执行（代价≈0），花钱或会毁掉手工编辑的操作必须升级为显式确认。

### 6.2 执行可观测层（服务 ②）

**5. `useJob(jobId)`** — `src/lib/ui/use-job.ts`
- 返回 `{ status, progress, step, stepIndex, stepTotal, logs, elapsedMs, etaMs, cancel(), error }`。
- 实现：`EventSource` 订阅 SSE；记录 `lastEventId`，断线指数退避重连并带 `Last-Event-ID` 重放；`EventSource` 不可用则降级 2s 轮询；页面挂载时先 `GET /jobs?active=1` 恢复。
- 关键点：**首事件必须在 <1s 内到达**（TTFT 心理学），所以 `enqueue` 后立即写一条 `step: '排队中'` 事件。

**6. `<JobStepList>`** — 替代所有转圈
- 渲染：阶段列表（已完成 ✓ / 当前 ● 脉冲 / 待执行 ○）+ 百分比 + 已用时 + 预计剩余 + 当前项名称（如「第 5/8 句：林晚『你终于来了』」）+ [取消]。
- 依据：Myers 1985（百分比进度显著提升等待意愿）；步骤流比转圈更能回答"在做什么"；[取消] 对应 HAX **G8 支持高效驳回**。
- 兜底：拿不到真实百分比时**只显示阶段与已用时**，绝不显示假百分比。
- a11y：`aria-live="polite"` 只播报**阶段变化**，不逐帧播报百分比。

**6b. 骨架屏的红线（v1 提过"骨架屏"，但要加限制）**
骨架屏确实提升感知速度与可导航性（[Umeå 研究](https://umu.diva-portal.org/smash/record.jsf?language=en&pid=diva2%3A1293450)），但"**假就绪**"页面会破坏信任（[CHI 2025](https://dl.acm.org/doi/full/10.1145/3735593)）。
因此：骨架屏只允许用于**已确定存在、仅在加载中**的数据（如章节列表、资产网格）；**绝不允许**为尚未生成的 AI 产物渲染"看起来已完成"的 beat/镜头/diff 占位。未生成 = 空状态引导卡（§6.1），不是骨架屏。这与"绝不显示假百分比"是同一条纪律。

**6c. `<JobTrace>`（瀑布图，选做但便宜）** — 服务 ②
- `jobs` 表**已有 `parent_id`（`db.ts:694`）却完全没用**。一次 `adapt` 内部含多次 LLM 调用、一次 `assets` 含 N 次图像调用，天然是父子 span 结构。
- 用 `parent_id` + `started_at`/`finished_at` 直接渲染 OpenTelemetry 风格的**跨度瀑布图**：哪一步慢、哪一步重试了、钱花在哪一段，一眼可见。
- 依据：可见性启发式 #1 + agent 运行的 trace/span 可观测性；这也是排查"为什么这次改编花了 90 秒"的唯一手段。
- 位置：折叠在 `<JobStepList>` 之下（默认不展开，符合 T4）。

**7. `<CostMeter>`** — 服务 ①
- 三级：`本次`（当前 job 实时累加）/ `本书`（累计）/ `今日`。
- 数据源：`jobs.cost`（已有，`llm.ts:151-155` 在写）+ `chapter_contexts.cost_cents` + `render_jobs.cost_cents`。**现在只有 CLI 能看**（`scripts/cost-report.ts`），UI 零入口。
- 预算：超过阈值时按钮变 `danger` 并要求二次确认。

**8. `<ReviewInbox>`** — 服务 ①③
- **直接复用已存在但未使用的 `review_tasks` 表**（`db.ts:707-718`，含 `ai_report`/`human_decision`）。
- 异步 job 完成后不打断当前操作，只在收件箱累加待决策项 + 一次 `aria-live` 播报；徽章显示待审数。
- 依据：环境/收件箱模式——后台完成→通知待决策项，其余不打扰。

### 6.3 审阅层（服务 ①②③④，本方案的价值核心）

**9. `<PlanSheet>`（预演卡）** — 服务 ①
- 输入 `NodeEstimate`（4.3）。渲染四行：**将生成** / **将覆盖**（含"其中 6 处是你手工改的"高亮）/ **成本与耗时**（区间）/ **可否撤销**（真实值）。
- 按钮：`[执行]` `[仅预演]` `[只重跑下游]`；有 `blockers` 时禁用并说明原因。
- 出现位置：按钮**原位就地展开**（不弹窗），保持空间感。

**10. `<DiffReview>`** — 服务 ②③④，**最高价值组件**
- 场景：`adapt` 重跑覆盖 20 个 beat、`storyboard` 重建 17 个镜头。
- 机制：AI 结果先写入 `staged_changes`（`{job_id, table, row_id, op, before_json, after_json, decision}`），**不直接落库**；UI 逐条 accept / reject / 就地编辑；`[全部接受]` 需二次确认且**不是默认焦点**（对抗自动化偏见）。
- 分块：按 beat/镜头分组，**每屏 ≤4 条**（Cowan ~4 chunk）；提供"只看变化的""只看红项"过滤（Shneiderman：总览→过滤→按需细节）。
- 键盘：`j/k` 上下、`a` 接受、`r` 驳回、`e` 编辑、`u` 撤销上一条——纯键盘可完成全部审阅。
- 吸附：接受/驳回按钮**吸底常驻**，不随滚动消失（Copilot 教训）。
- 依据：<400 LOC/次审阅容量；暂挂式 hunk 审阅。

**11. `<CandidateGallery>`** — 服务 ②③
- 资产候选（`assets` 表已有多候选与 `status`）左右并排 / 叠加对比切换、`←/→` 切换、放大镜、`Space` 选定。
- **淘汰 = 标记 `regen`（待重生成），不消失**（v1 §2 第 8 条要求）；可撤销。
- 3 个风格候选（`style_bibles.proposal_json`）同样用它做左右分屏对比——当前 `bible/page.tsx` 三候选是纵向卡片，无法对比。

**12. `<EvidenceDisclosure>`** — 服务 ①
- 默认折叠，一行摘要 + "为什么"链接；展开显示 `selection_report` / `ai_report` / ASR 置信度 / 原文 span 定位。
- 依据：渐进披露；HAX G11「让用户明白系统为何如此」；G2「传达置信度」。
- 规则：**AI 的每个结论都必须能一键跳到证据**（原文 span、参考图、ASR 波形）。

**13. `<TimeMachine>`** — 服务 ④
- checkpoint 列表（标签/时间/来源节点/影响行数）+ 悬停预览受影响对象 + `[回滚到此处]`。
- 快捷键 `Cmd+Z` / `Cmd+Shift+Z`；Toast 里的"撤销"是它的一跳入口。
- 依据：可逆性是让用户敢放权的前提；检查点回滚是最强信任建立器。

**14. `<CommandPalette>`** — 服务 ⑤（效率）
- `Cmd+K`：动作（重跑分镜/打开成本/开始渲染）+ **对象定位**（`@beat3`、`@林晚`、`@镜头7`）+ 最近 checkpoint。
- 依据：Hick 定律——主操作留在界面上，长尾动作收进面板，避免并列 7 个按钮。

### 6.4 `<Inspector>` 重构（画布检查器，服务 ②④）

当前问题：`storyboard-canvas.tsx` 检查器是 **16 个 `<select>` + 独立"保存"按钮**（如 `:614-652`），改一项要"选→点保存→等全量 reload"。

改造：
- **即时保存 + 乐观更新**：`onChange` 立即 `useOptimistic` 更新本地 → 后台 PATCH → 失败回滚并 Toast。删除"保存"按钮（保留 `Cmd+S` 作为显式落盘的心理锚点）。
- **只失效受影响切片**，不再 `await load()` 全量重载（H5）。
- 每次保存后就地显示影响提示：「将影响 1 句配音 → [重配音本句]」（v1 场景 1 的目标剧本）。
- 高级参数（JSON、机位细参）收进 `<details>` 折叠。

---

## 7. Skill 层：让这份方案可以被 AI agent 直接执行

### 7.1 三层分工（不要混用）

| 层 | 性质 | 放什么 | 本项目载体 |
|---|---|---|---|
| **AGENTS.md / CLAUDE.md** | 常驻上下文（always-on） | 项目铁律：令牌名、状态映射、"禁止硬编码颜色"、"必须写 aria-live" | 仓库根（已存在，需增补 UI 章节） |
| **Skill** | 按需加载的**流程** | 手术步骤、审查清单、评分量规 | `.claude/skills/*/SKILL.md` |
| **MCP** | **能力**（工具） | 截图、a11y 扫描、组件检索 | `.mcp.json` |

Skill 的关键机制是**渐进披露的三层预算**（[Anthropic 官方](https://claude.com/blog/skills)、[Skills 文档](https://code.claude.com/docs/en/skills)）：
① `name`+`description` 常驻（几十 token）→ ② 触发后加载 `SKILL.md` 正文（建议 ≤500 行）→ ③ 按需读取 `references/`、执行 `scripts/`（不限量）。
**`description` 是唯一的检索入口**，必须用第三人称写清"何时用 + 产出什么"，并塞进用户真会打的词。确定性步骤写成 `scripts/`（脚本比让模型重新推导更便宜也更稳），判断性内容写成 prose（量规、取舍）。

### 7.2 直接可用的现成资产（精选，不必全装）

| 名称 | 来源 | 给你什么 | 安装成本 |
|---|---|---|---|
| `frontend-design` | [anthropics/claude-code](https://github.com/anthropics/claude-code/blob/925200df/plugins/frontend-design/README.md) | 反"AI 味"审美护栏：配色/字阶/间距/层次 | Claude Code 内置插件 |
| `skill-creator` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/skill-creator) | 元技能：正确地写下面 6 个 Skill | clone |
| `web-artifacts-builder` | [anthropics/skills](https://github.com/anthropics/skills/blob/9d2f1ae187231d8199c64b5b762e1bdf2244733d/skills/web-artifacts-builder/SKILL.md) | React+Tailwind 组件生成惯例 | clone |
| `superdesign-skill` | [superdesigndev](https://github.com/superdesigndev/superdesign-skill) | 意图驱动、防 slop 门禁 | `npx skills add superdesigndev/superdesign-skill` |
| `design-review` | [davidgarciagordo](https://github.com/davidgarciagordo/design-review) | 有序的设计评审流水线 + 实时视觉核查 | clone |
| `claude-design-auditor` | [Ashutos1997](https://github.com/Ashutos1997/claude-design-auditor-skill) | 19 条专业设计规则量规 | clone |
| **Playwright MCP** | [playwright.dev/mcp](https://playwright.dev/mcp/capabilities) | 截图 + 结构化 a11y 快照 + vision 模式比对 | `npx @playwright/mcp@latest` |
| **Chrome DevTools MCP** | [ChromeDevTools](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 性能 trace / 网络 / 控制台 / CWV | `npx chrome-devtools-mcp@latest` |
| **axe MCP** | [a11y-mcp](https://github.com/priyankark/a11y-mcp) · [axecap](https://github.com/ICJIA/axecap-mcp) | a11y 违规 → 修复回路（axecap 压缩输出省上下文） | `npx` |
| shadcn MCP | [ui.shadcn.com/docs/mcp](https://ui.shadcn.com/docs/mcp) | 组件注册表检索——**若决定引入组件库**再装 | `npx shadcn@latest mcp init` |

> 取舍建议：本项目**先不引入 shadcn/ui**。§5 的令牌 + §6 的 14 个组件总量可控（估 ~1,200 LOC），引入组件库会带来 Tailwind v4 + React 19 的适配面与体积，收益不如把 11 类重复实现先收敛掉。等 P2 之后再评估。

**刻意不装的（避免装一堆用不上的 MCP）**：

| 不装 | 原因 |
|---|---|
| Figma Dev Mode MCP / Figma Context MCP | 本项目**没有 Figma 设计源**，令牌来自 §5.1 手写，装了没有输入 |
| Storybook MCP | 仓库无 Storybook；"强制 agent 复用组件"的目的用 §7.4 的 `AGENTS.md` 铁律 + §1.5 重复清单更省 |
| BrowserTools MCP | 需装浏览器扩展，能力与 Chrome DevTools MCP 重叠 |
| Chromatic / Percy | 托管式视觉回归，单人本地项目用 Playwright `toHaveScreenshot` 足够且免费 |

另外两份**提示词层**的官方参考值得在写 UI 前读一遍，它们解释了"为什么同样的模型能产出不同审美水平"：[Anthropic 前端审美提示词 cookbook](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics) 与 [Vercel Agent Readability spec](https://vercel.com/kb/guide/agent-readability-spec)。核心手法（本方案已内化）：设计纲要先行、把风格指南与令牌作为上下文喂进去、先出 3 个变体再选、参考图锚定、给明确的迭代预算、收尾用自评量规。

### 7.3 本项目要写的 6 个 Skill

放在 `.claude/skills/`，与仓库一起版本化。

#### ① `nc-ui-contract` —— 项目 UI 契约（最高频）

完整示例（其余 5 个同构，只给规格）：

````markdown
---
name: nc-ui-contract
description: >
  Use when writing or modifying any UI in the novel-cinema project — React
  components, pages, Tailwind classes, or CSS. Enforces the project design
  tokens, the six unified status states, motion duration tiers, accessibility
  baseline, and Chinese copy conventions. Rejects hardcoded colors and durations.
allowed-tools: [Read, Grep, Edit, Write]
---

# novel-cinema UI 契约

写任何 UI 前先读 `references/tokens.md` 与 `references/status-map.md`。

## 硬性规则（违反即返工）
1. **禁止硬编码颜色**。只用 `--color-*` 令牌；新增颜色必须先加令牌。
2. **禁止硬编码动效时长**。只用 `--dur-instant|fast|base|slow`（对齐 Material 3 三档）。
3. **状态分三族处理**（§5.3）：审阅态经 `toReviewStatus()` 才能进 `<StatusBadge>`（返回 `null` 就别画）；
   执行态交给 `<JobStepList>`/`<JobTrace>`；`clue_status`/`project_status` 是剧情/阶段语义，
   用中性 chip，**禁止套状态色**。任何情况下都不许直接渲染 DB 的 status 字符串。
4. **每个异步操作**都要有：乐观反馈(<100ms) → 阶段进度 → 终态 toast（带撤销入口）。
5. **可达性**：可点元素 ≥24×24px；状态变化经 `aria-live`；新动画必须在
   `prefers-reduced-motion: reduce` 下失效。
6. **文案**：中文、动词开头、不写"操作成功"这类空话，要写清对象与影响范围
   （例：「已替换林晚的表情图 · 影响 1 个镜头」）。
7. **不新增重复实现**：改 UI 前先查 `docs/06` §1.5 的重复清单，优先抽组件。

## 复核清单（提交前自查）
- [ ] 无 `bg-[#`、无 `duration-[`、无裸 `status` 文本
- [ ] 新交互可纯键盘完成
- [ ] 破坏性操作有 checkpoint，且 `reversible` 是真实值

参考：`references/tokens.md`、`references/status-map.md`、`references/copy.md`
````

配套 `scripts/lint-ui-contract.mjs`：grep 出硬编码颜色 / `duration-[` / 裸状态字符串 / 缺 `aria-live` 的 toast，非零退出即失败——**规则要能被机器检查，否则等于没有**。

#### ②–⑥ 其余 Skill 规格

| Skill | `description` 触发点 | 正文要点 | 附带脚本 | 需要的工具 |
|---|---|---|---|---|
| `nc-job-ux` | "把某个 AI 节点改成有进度/可取消" | 标准手术流程：加 `ProgressReporter` 形参 → 在自然循环点打 `step()` → 循环内 `checkCancelled()` → 路由改 `enqueue` 返回 jobId → 前端换 `useJob` → 补 SSE 断线重放。含"绝不显示假百分比"红线 | `scripts/scaffold-job-route.mjs` | Read/Edit/Bash |
| `nc-review-surface` | "为某个 AI 产物做审阅界面" | 三选一决策树：多候选→`CandidateGallery`；批量覆盖→`DiffReview`（staging + 逐条决策 + 每组≤4）；单值→内联 diff。强制吸底常驻的接受/驳回，`[全部接受]` 不得为默认焦点 | `scripts/gen-staged-migration.mjs` | Read/Edit |
| `nc-a11y-audit` | "检查可达性 / 无障碍 / axe" | 跑 axe → 按 critical/serious/moderate 排序 → 只给令牌级或属性级修复建议，不重写布局；附键盘走查与 reduced-motion 核查 | `scripts/a11y.mjs`、`scripts/keyboard-walk.mjs` | axe MCP / Playwright MCP / Bash |
| `nc-visual-regression` | "视觉回归 / 截图对比 / 像素差异" | 固定 10 条路由 × 2 视口的基线矩阵；跑前必须 seed 固定数据 + 冻结动画 + 固定时间，否则 diff 全是噪声 | `scripts/shot-matrix.mjs`、`assets/baselines/` | Playwright MCP / Bash |
| `nc-motion-review` | "审查动效 / 加动画" | 时长档表 + 何时用 stagger（列表入场 40ms/项，上限 8 项）+ 禁止 infinite（除内容型预览动画，且需静态兜底） | — | Read |

### 7.4 `AGENTS.md` 增补（常驻铁律，约 15 行）

```markdown
## UI 约定（改任何界面前必读 docs/06-ui-optimization-plan.md）
- 颜色/间距/圆角/动效一律用 globals.css 的 @theme 令牌，禁止字面量。
- 状态渲染必须过 src/lib/ui/status.ts：审阅态用 toReviewStatus() 进 StatusBadge，
  执行态归进度组件，clue_status/project_status 用中性 chip，禁止裸 DB status。
- 长任务一律走 jobs 队列 + SSE，禁止在 route handler 里同步 await AI 节点。
- 破坏性写操作前必须建 checkpoint；estimate().reversible 必须反映真实情况。
- 新组件默认无障碍：≥24px 命中区、aria-live 播报、reduced-motion 兜底。
- 不新增重复实现：先查 docs/06 §1.5 的重复清单。
```

### 7.5 `.mcp.json`

```json
{
  "mcpServers": {
    "playwright":      { "command": "npx", "args": ["@playwright/mcp@latest"] },
    "chrome-devtools": { "command": "npx", "args": ["chrome-devtools-mcp@latest"] },
    "axe":             { "command": "npx", "args": ["-y", "@icjia/axecap"] }
  }
}
```

---

## 8. 验证闭环

### 8.1 现状：**零 UI 测试能力**

`vitest.config.mts:11-12` → `environment: "node"`、`include: ["src/**/*.test.ts"]`。
即：不含 `.tsx`、无 DOM 环境；`package.json` 里无 `@testing-library/*`、无 `jsdom`、无 `playwright`、无 `axe-core`。
现有 **11 个测试文件 / 29 个用例**全在 `src/lib/**`（pipeline / providers / render / db），**没有一个碰 UI**。任何界面改动今天都无法回归。

### 8.2 Tier 1 · 交互回路（开发时，agent 自己闭环）

```
改代码 → Playwright MCP 截图 → 与基线/设计意图比对 → axe 扫描 → 修 → 再截图
```
关键要求：截图前必须 **seed 固定数据 + 冻结动画 + 固定时间**，否则每次 diff 全是噪声。
建议新增 `scripts/seed-fixture.ts`（复用现有 `scripts/smoke-db.ts` 的思路）产出一本确定性的 fixture book。

### 8.3 Tier 2 · CI 回归门（确定性）

```jsonc
// package.json 新增
"test:unit": "vitest run",
"test:ui":   "vitest run --config vitest.ui.config.mts",   // jsdom + *.test.tsx
"test:e2e":  "playwright test",
"test:a11y": "playwright test --grep @a11y",
"lint:ui":   "node .claude/skills/nc-ui-contract/scripts/lint-ui-contract.mjs"
```

```ts
// playwright.config.ts
export default defineConfig({
  expect: { toHaveScreenshot: { maxDiffPixels: 100, threshold: 0.2 } },
  use: { screenshot: 'on', trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile',  use: { viewport: { width: 375,  height: 812 } } },
  ],
});
```

四道门：
1. **视觉回归** — Playwright `toHaveScreenshot`（[文档](https://playwright.dev/docs/test-snapshots)），基线矩阵 = 10 路由 × 2 视口。
2. **a11y** — `@axe-core/playwright`，`critical`/`serious` 违规必须为 **0**；外加 `eslint-plugin-jsx-a11y` 静态检查。
3. **reduced-motion 冒烟** — `page.emulateMedia({ reducedMotion: 'reduce' })` 后断言无 `animation-iteration-count: infinite` 生效。
4. **性能预算** — Lighthouse CI（[lighthouse-ci](https://github.com/GoogleChrome/lighthouse-ci)）断言 `LCP ≤2500ms`、`CLS ≤0.1`、`INP ≤200ms`。

> 注意：本项目页面全是 `'use client'` + 客户端 fetch，LCP 天然吃亏（首屏要等 API 往返）。P1 之后建议把只读页面改成 RSC 直读 SQLite——这也是 Lighthouse 分数的主要杠杆。

---

## 9. 路线图

依赖关系（不可跳序）：

```
P0 止血与地基 ──> P1 可观测执行 ──> P2 审阅面 ──> P3 直接操纵
  （信任+令牌）     （jobs+SSE）     （diff+回滚）   （手柄+建议）
```

### P0 · 止血与地基（不新增功能，只消债）

| 项 | 动作 | 涉及 |
|---|---|---|
| 修信任谎言 | `checkpoints` 表 + `buildStoryboard` 执行前批量快照；`reversible` 改为真实值 | `db.ts`、`storyboard.ts:375-379`、`workbench.ts:186-221` |
| 令牌层 | §5.1 全量写入 `@theme` | `globals.css` |
| 三个既有 bug | 删 Arial、`lang="zh-CN"`、改 metadata | `globals.css:25`、`layout.tsx:17-24` |
| a11y 基线 | reduced-motion 全局兜底、toast `role`/`aria-live`、命中区 ≥24px、`:focus-visible` | `globals.css`、`toast.tsx` |
| 状态统一 | `src/lib/ui/status.ts`（三族映射，§5.3）+ `<StatusBadge>`，替换 ~15 处裸文本；同时把 `clue_status`/`project_status` 从徽章里摘出来 | 8 个页面 |
| 基础组件 4 个 | `<Button>`/`<StatusBadge>`/`<ErrorBanner>`/`<SectionCard>`，替换 9 处错误横幅 + 6 处按钮 | 新建 `src/components/ui/*` |
| 枚举归一 | 3 份 EMOTIONS/CAMERAS/TRANSITIONS 合为 `src/lib/ui/enums.ts` | `script`/`canvas`/`workbench` |
| 测试地基 | `vitest.ui.config.mts` + jsdom + Playwright + axe + fixture seed | 配置 |

**验收**：① 全仓无硬编码状态色与裸状态文本；② `prefers-reduced-motion` 下无无限动画；③ axe critical/serious = 0；④ 重建分镜后可完整回滚手工修改（人工演练一次）；⑤ `lint:ui` 通过。

### P1 · 可观测执行

| 项 | 动作 |
|---|---|
| jobs schema | `progress`/`step`/`step_total`/`cancel_requested`/`job_events`（§4.1） |
| 队列与执行器 | `queue.ts`/`runner.ts`/`progress.ts`；启动时把孤儿 running 标 failed |
| SSE 通道 | `/jobs/[jobId]/stream` + `Last-Event-ID` 重放 + 心跳 + 轮询降级 |
| 节点改造 | **先 `assets` 与 `voice`**（天然 N 项循环，可给真实百分比），再 `adapt`/`analyze`/`storyboard` |
| 前端 | `useJob()` + `<JobStepList>` 替换全部 6 处「…中」文案 |
| 成本可见 | `<CostMeter>` 三级 + 预算告警（数据源已存在，只是没 UI） |
| 收件箱 | `<ReviewInbox>` 复活 `review_tasks` 表 |
| 取消 | 队列剩余项可取消（对 8 句配音、N 张图尤其有价值） |

**验收**：① 所有异步操作都有阶段进度，且刷新页面后能接回；② 可取消正在跑的资产生成并看到"已取消，完成 5/12"；③ 成本仪表盘与 `scripts/cost-report.ts` 数字一致；④ 长任务首个事件 <1s 到达。

### P2 · 审阅面（价值核心）

| 项 | 动作 |
|---|---|
| DAG | `graph.ts` 取代 `propagateStale` switch；产出影响面计数与 stale 溯源 |
| 结构化预报 | `NodeEstimate` + `<PlanSheet>`；移除 `getWorkbench` 的 6 次 estimate 预热 |
| staging 审阅 | `staged_changes` 表 + `<DiffReview>`，先只接 `adapt` 与 `storyboard` 两个高覆盖节点 |
| 候选对比 | `<CandidateGallery>`：资产候选 + 3 个风格方案左右分屏 |
| 时间机器 | `<TimeMachine>` + 多步 undo/redo + 签核点自动打 checkpoint |
| 命令面板 | `<CommandPalette>` `Cmd+K`（动作 + `@` 对象定位） |
| 证据披露 | `<EvidenceDisclosure>`；红黄项**可点击定位原文 span** |

**验收**：① 重跑改编后进入逐条审阅，可只接受其中 3 条；② 每屏呈现变更 ≤4 条；③ 纯键盘完成一轮 20 条 beat 审阅；④ 可回滚到"批准风格 B 之前"；⑤ 任一 AI 结论能一键跳到证据。

### P3 · 直接操纵与建议层

Inspector 乐观更新化并去掉保存按钮 · 拖右缘调时长 · 入/出点手柄 + 动画选择器 · 拖放 ghost / 目标高亮 / 错放抖动 · 画布快捷键（`1-6`/`B`/`S`/`D`/`R`）· 基于红黄项的建议 chips（"这 3 个镜头节奏单调，自动重排？"）→ 走 `<PlanSheet>` → `<DiffReview>`。

**验收**：① 80% 高频编排任务在画布内完成；② 换说话人 4 步 1 屏；③ 建议 chips 的采纳走完整的预报→diff→撤销链路。

---

## 10. 可度量指标（基线 → 目标）

| # | 指标 | 现状基线 | 目标 |
|---|---|---|---|
| 1 | 异步操作有真实进度的比例 | **0 / 17** | 17 / 17 |
| 2 | AI 覆盖类操作可回滚比例 | **0%** | 100% |
| 3 | 首次可见反馈延迟 | 一次往返（0.3s~90s） | **<100ms**（乐观更新） |
| 4 | 长任务首事件时间（TTFT） | 无事件 | **<1s** |
| 5 | 刷新后任务状态可恢复 | ❌ | ✅ |
| 6 | 单屏呈现的待审变更条数 | 17~20（全量） | **≤4/组**，分组串行 |
| 7 | 成本可见性 | 仅 CLI | UI 三级（本次/本书/今日） |
| 8 | 预报与实际成本偏差 | 不可测（无结构化数据） | **±30%** 内 |
| 9 | 错误恢复所需点击 | 0（不可恢复） | **1**（撤销） |
| 10 | 重复实现的 UI 模式 | **11 类** | 0 |
| 11 | 状态表达 | 20 个枚举 type 裸露，三族语义混用 | 族 A 7 态徽章 + 族 B 进度组件 + 族 C 中性 chip，tooltip 100% |
| 12 | axe critical/serious 违规 | 未测（预期多） | **0** |
| 13 | reduced-motion 下无限动画 | **4 个** | 0 |
| 14 | 换说话人操作成本 | 4 步 2 屏 | 4 步 1 屏 |
| 15 | 编排台首屏数据耗时 | 含 6 次 estimate 预热 | 下降 **≥50%** |
| 16 | UI 回归测试覆盖 | **0 条** | 10 路由 × 2 视口 + a11y 门 |

---

## 11. 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| **runner 与 `next dev` 生命周期冲突** | 热重载重建模块，进程内 worker 可能被重启或跑双份 | runner 跑**独立进程**（复用 `render/start/route.ts:14` 已验证的 `spawn` detached 模式），Next 只负责入队与读取 |
| **`db.ts` 是手写的 Supabase 风格 shim** | `getSupabaseAdmin()` 返回自制 QueryBuilder（`db.ts:88-309`），不是真 Supabase；新表（`job_events`/`checkpoints`/`staged_changes`）用到的 `IN`/排序/聚合/**事务**未必都被 shim 支持 | 先验证 shim 能力边界；**批量快照与 staging 落库一律走原生 `better-sqlite3` 事务**，不要硬塞进 shim（半批写入失败会毁掉 checkpoint 的可信度） |
| **SQLite 写锁竞争** | 多 job 并发写 + SSE 频繁读 | 开 WAL；队列**串行**执行（单人使用足够）；进度写入节流合并（≥500ms 一次） |
| **进度节流 vs INP** | 高频事件导致重渲染抖动 | 服务端 500ms 合并；客户端只在 `step` 变化时重渲染，百分比走 CSS 变量 |
| **`staged_changes` 增加复杂度** | 全节点接入成本高 | 只对 `adapt`/`storyboard` 启用；其余节点靠 checkpoint 兜底 |
| **重构与 773 行画布冲突** | 并行改动易冲突 | 顺序：先抽 enums/status/Field → 再把 beat/shot/layer 编辑器 3 处合 1 → **最后**才动画布布局 |
| **假进度的诱惑** | 拿不到真实分母时想编一个 | 硬红线：无真实分母时只显示阶段 + 已用时 |
| **确认过度** | 加了 PlanSheet 后处处要点确认 | §6.1 的 `risk` 三级；零成本可逆操作**不确认**，只给撤销 |

**明确不做（out of scope）**：多用户/权限、云端迁移、i18n 框架（保持硬编码中文）、暗色模式（P3 后评估）、聊天式主界面、引入组件库。

---

## 12. 与 v1（04 文档）的差异对照

| 维度 | v1 | v2 |
|---|---|---|
| 目标函数 | 消除"单薄感"（体感） | **审阅吞吐量 × 信任度**（可测） |
| 依据 | Apple HIG + Canva/CapCut/Runway | 上述 + AI coding 工具收敛的 5 个信任原语 + METR/DORA/SmartBear 量化证据 |
| 进度条 | 列为 I0 任务 | 指出**架构上不可能**，先做 job+SSE（P1） |
| 撤销 | 快照 + Cmd+Z | 发现 v1 实现**对 AI 覆盖无效且文案撒谎**，升级为 checkpoint + redo（P0 第一件事） |
| 影响预报 | 返回中文句子 | 结构化 `NodeEstimate` + 真实 `reversible` + DAG 计数 |
| AI 结果处理 | "生成后给 diff"（一句话） | `staged_changes` + `<DiffReview>` 逐条决策 + 每组 ≤4 + 键盘流 |
| 设计系统 | 五色徽章 + 三档动效时长 | 完整令牌层 + 6 状态映射函数 + M3 时长档 + reduced-motion |
| 可达性 | 未提及 | 独立基线（WCAG 2.2 SC 2.5.8 / 2.4.11 / 4.1.3）+ CI 门 |
| 执行方式 | 人工迭代 | 6 个 Skill + MCP + 2 层验证闭环，可交给 agent 并回归 |
| 重复实现 | 未识别 | 量化为 11 类，作为组件化的收益依据 |

---

## 附录 A · 参考文献

**量化证据**
[METR RCT（−19%）](https://simonwillison.net/2025/Jul/12/ai-open-source-productivity/) ·
[Google DORA 2025](https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025/) ·
[SmartBear 代码审阅 400 LOC 上限](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/) ·
[AI 审阅规模超过阅读速度](https://www.sonarsource.com/jp/blog/how-to-scale-code-quality/) ·
[Parasuraman & Manzey 自动化偏见](https://journals.sagepub.com/doi/abs/10.1177/0018720810376055) ·
[确认/告警疲劳 BMC 2017](https://link.springer.com/article/10.1186/s12911-017-0430-8)

**交互原理与阈值**
[Nielsen 响应时间 0.1/1/10s](https://www.nngroup.com/articles/response-times-3-important-limits/) ·
[RAIL 100ms 预算](https://developer.mozilla.org/en-US/docs/Glossary/RAIL) ·
[Core Web Vitals 阈值](https://web.dev/articles/defining-core-web-vitals-thresholds) ·
[Myers 1985 百分比进度条](https://www.semanticscholar.org/paper/The-importance-of-percent-done-progress-indicators-Myers/8fd762da2a6cbdf3a64b706b11ff9971f7f5eb7f) ·
[TTFT](https://www.ibm.com/think/topics/time-to-first-token) ·
[Cowan ~4 chunk](https://www.kirschnered.nl/2025/04/11/schemas-chunking-and-working-memory/) ·
[F 型扫描 20-28%](https://www.nngroup.com/articles/text-scanning-patterns-eyetracking/) ·
[Hick 定律](https://www.interaction-design.org/literature/article/hick-s-law-making-the-choice-easier-for-users) ·
[Fitts 定律](https://www.interaction-design.org/literature/topics/fitts-law) ·
[渐进披露](https://www.nngroup.com/videos/progressive-disclosure/) ·
[可见性启发式 #1](https://www.nngroup.com/articles/visibility-system-status/) ·
[用户控制与自由 #3](https://www.nngroup.com/articles/user-control-and-freedom/)

**人机协作指南**
[Amershi et al. CHI 2019 · 18 条指南](https://dlnext.acm.org/doi/fullHtml/10.1145/3290605.3300233)（本方案重点用 G2 置信度、G8 高效驳回、G9 高效纠正、G10 不确定时收敛范围、G11 解释原因、G16 传达后果、G18 变更通知）·
[Google PAIR Guidebook](https://pair.withgoogle.com/) ·
[Apple HIG 生成式 AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai) ·
[IBM Carbon for AI](https://carbondesignsystem.com/guidelines/carbon-for-ai/) ·
[Parasuraman-Sheridan-Wickens 2000 自动化层级](https://www.ida.liu.se/~729A71/Literature/Automation/Parasuraman,%20Sheridan,%20Wickens_2000.pdf) ·
[Klein et al. Ten Challenges（可指导/可观察/可打断）](http://csel.eng.ohio-state.edu/woods/distributed/ieee%2010ch.pdf) ·
[Horvitz 1999 混合主动](http://erichorvitz.com/uiact.htm)

**可达性与动效**
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) ·
[W3C C39 reduced-motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39) ·
[Material 3 动效时长](https://m3.material.io/styles/motion/overview)

**AI coding 工具形态（原语来源）**
[Claude Code 最佳实践](https://code.claude.com/docs/en/best-practices) ·
[Codex 交互模式](https://mintlify.wiki/openai/codex/concepts/interactive-mode) ·
[Cursor Agent](https://cursor.com/help/ai-features/agent.md) ·
[Cline 检查点](https://mintlify.wiki/cline/cline/core-workflows/checkpoints) ·
[Aider git 集成与 /undo](https://aider.chat/docs/git.html) ·
[Zed Agent Panel](https://zed.dev/docs/ai/agent-panel) ·
[Copilot 审阅代码改动](https://github.com/microsoft/vscode-docs/blob/c775dd9b/docs/copilot/chat/review-code-edits.md)
反模式证据：[Codex 折叠推理之争 #2375](https://github.com/openai/codex/issues/2375) ·
[Cursor「看不见 agent 在做什么」](https://forum.cursor.com/t/not-being-able-to-see-what-the-agent-is-doing-is-making-me-nervous/167226) ·
[Cursor 成本不透明](https://forum.cursor.com/t/product-feedback-cost-opacity-routing-plans-agents-window-1-year-heavy-use/166671) ·
[Copilot 缺少驳回按钮](https://github.com/orgs/community/discussions/167913)

**Skill / MCP / 验证**
[Anthropic Agent Skills 发布](https://claude.com/blog/skills) ·
[Skills 文档](https://code.claude.com/docs/en/skills) ·
[anthropics/skills](https://github.com/anthropics/skills) ·
[Simon Willison：Skills 比 MCP 更重要](https://simonwillison.net/2025/Oct/16/claude-skills/) ·
[Playwright MCP](https://playwright.dev/mcp/capabilities) ·
[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) ·
[axe a11y MCP](https://github.com/priyankark/a11y-mcp) ·
[Playwright 截图对比](https://playwright.dev/docs/test-snapshots) ·
[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) ·
[AGENTS.md 与 CLAUDE.md 优先级](https://dev.to/rulestack/agentsmd-vs-claudemd-vs-cursorrules-what-cursor-actually-reads-now-and-in-what-order-17bo)

**Next.js SSE 实现**
[App Router SSE + ReadableStream](https://dev.to/turboline_ai_/streaming-responses-in-nextjs-app-router-server-sent-events-and-readablestream-2c10) ·
[用 SSE 替换轮询做视频处理进度](https://dev.to/nareshipme/how-we-replaced-polling-with-server-sent-events-for-real-time-video-processing-updates-3mch) ·
[SSE vs WebSocket vs 轮询决策矩阵](https://wolf-tech.io/blog/nextjs-15-sse-vs-websockets-vs-polling-real-time-decision-matrix-2026)

**反聊天式界面**
[Keyhole Effect（arXiv）](https://ar5iv.labs.arxiv.org/html/2602.00947) ·
[LukeW：超越聊天的 AI 界面](https://lukew.com/ff/entry.asp?2105) ·
[Agent 画布取代纯聊天](https://dev.to/pvgomes/agent-canvases-are-the-end-of-chat-only-coding-tools-2b54)

---

## 附录 B · P0 落地记录（2026-08-20，本轮完成）

### 已落地

| 项 | 实现 | 证据 |
|---|---|---|
| 修信任谎言 | `checkpoints` 表 + `snapshots.checkpoint_id/op` 列（含老库增量迁移）；`src/lib/checkpoints.ts`（create/ list/ revert，原生事务）；`buildStoryboard` 重建前批量快照、失败自动回滚；手动编辑与撤销统一走 checkpoint 语义 | `db.ts`、`checkpoints.ts`、`storyboard.ts`、`workbench.ts` |
| 令牌层 | §5.1 全量令牌（颜色/时长/圆角/阴影/命中区）+ `@theme inline` 映射 | `globals.css` |
| 三个既有 bug | Arial 覆盖 Geist 修复、`lang="zh-CN"`、metadata 正式化 | `globals.css`、`layout.tsx` |
| a11y 基线 | 全局 `prefers-reduced-motion` 兜底（含 kb-* 内容动画停首帧）、`:focus-visible`、toast `role`/`aria-live`（错误 assertive）、命中区 ≥24px、`stale-flash` 呼吸 1 次不循环 | `globals.css`、`toast.tsx` |
| 状态三族统一 | `src/lib/ui/status.ts`（toReviewStatus 返回 null 即不渲染徽章 / toJobPhase / neutralStatusLabel / PROJECT_PHASES）；`<StatusPill>` 自动分流徽章/chip | `status.ts`、`status-badge.tsx` |
| 基础组件 | `<Button>`（5 变体含 approve、loading、progress、shortcut）· `<StatusBadge>`/`<StatusPill>` · `<ErrorBanner>` · `<SectionCard>` | `src/components/ui/*` |
| 枚举归一 | `src/lib/ui/enums.ts`；3 处 EMOTIONS/CAMERAS/TRANSITIONS/ENTER_EXIT 重复定义全部删除 | `enums.ts` + 3 个文件 |
| 页面迁移 | 9 个页面 + 画布：按钮/错误横幅/裸状态文本/「…中」文案全部收敛到 kit；状态色语义化（红→stale、琥珀→regen、绿→approved、蓝→review） | 全部页面 |
| 测试地基 | `vitest.ui.config.mts`（jsdom）+ Testing Library + axe-core；checkpoint 回归 3 例、状态映射 5 例、kit 组件 + axe 6 例 | `checkpoints.test.ts`、`status.test.ts`、`kit.ui.test.tsx` |
| lint:ui | `nc-ui-contract` skill + 机器检查脚本（7 条规则） | `.claude/skills/nc-ui-contract/` |
| AGENTS.md | UI 铁律 8 条常驻 | `AGENTS.md` |

### 验证结果（全绿）

`tsc --noEmit` 0 错 · `eslint --max-warnings 0` 0 错 · `lint:ui` 通过 ·
`vitest run` 54 通过（1 个既有 skip）· `vitest.ui` 6 通过（含 axe critical/serious=0）·
`next build` 成功。

### P0 五条验收对照

| 验收 | 状态 | 说明 |
|---|---|---|
| ① 无硬编码状态色与裸状态文本 | ✅ | lint:ui 机器检查通过；剩余 palette 字面量仅为领域标签（角色/剧透/线索类型 chip），非状态色 |
| ② reduced-motion 下无无限动画 | ✅ | 全局 C39 兜底；kb-* 停首帧；stale-flash 仅 1 次 |
| ③ axe critical/serious = 0 | ✅（组件级） | kit 测试内 axe 断言通过；**整页审计需 Playwright 浏览器，随 P1 补齐** |
| ④ 重建分镜可完整回滚手工修改 | ✅（机制级） | checkpoint 单元测试覆盖 delete/update/JSON 字段恢复与消费语义；UI 演练待有数据后人工过一遍 |
| ⑤ lint:ui 通过 | ✅ | — |

### 顺带修复（审计中发现）

- `db.ts` 手写 shim 无事务能力 → 新增 `rawDb` + `runInTransaction`（checkpoint 专用，P1 的 staging 复用）
- 老库迁移安全：`idx_snapshots_checkpoint` 必须在 ALTER 之后建（首次跑挂过一次，已修）
- `shot_layers` 无 `status` 列（测试夹具踩中，已按真实 schema 修正）

### 明确延后到 P1

Playwright e2e（含整页 axe、reduced-motion 冒烟、视觉回归基线）· SSE 通道 · jobs 队列 · 取消 ·
`<JobStepList>`/`<CostMeter>`/`<ReviewInbox>` · 收件箱复活 `review_tasks` · 首事件 <1s 验收。

---

## 附录 C · P1 落地记录（可观测执行，本轮完成）

### 已落地

| 项 | 实现 |
|---|---|
| jobs schema | `jobs` 新增 progress/step/step_index/step_total/cancel_requested/updated_at 列（含老库增量迁移）；`job_events` 事件表（seq 单调递增，支持 SSE 重放） |
| 队列与执行器 | `src/lib/jobs/{types,progress,worker}.ts`；`spawnWorker` detached 子进程（`npx tsx worker.ts --job <id>`，Windows 需 `shell:true` 解析 npx.cmd）；孤儿清理（running 超 10 分钟标 failed）；`busy_timeout=10000` 解决多进程写锁 |
| 节点 reporter | `assets`（逐 spec 步骤 + 取消点）、`voice`（逐句 1/N + 取消点）、`adapt`（4 阶段 + 校验重试日志）、`storyboard`（4 阶段）、`analyze`（3 阶段）；全部向后兼容（reporter 可选） |
| SSE 通道 | `GET /jobs/[jobId]/stream`（Last-Event-ID 重放 + 15s 心跳 + 终态关流）；`GET /jobs/[jobId]`（快照+事件，轮询降级用）；`POST /jobs`（入队即写"排队中"事件 → 首事件 0ms）；`POST /jobs/[jobId]/cancel`（协作式取消） |
| 前端 | `useJob`（SSE→轮询降级、断线重连、接回刷新前进度）；`<JobStepList>`（真实分母/进度条/取消/终态，无假百分比）；`<JobRunner>`（按钮+进度一体）；`<CostMeter>`；`<ReviewInbox>` |
| 页面迁移 | bible（analyze）、script（adapt）、assets（phase1/2）、voice（逐句合成）、storyboard（构建）、workbench（6 节点经确认卡入队）、canvas（重跑分镜/配音入队）——**全站 AI 操作统一走 jobs** |
| 成本可见 | `src/lib/cost.ts` + `GET /cost`（今日/本书，与 cost-report.ts 同口径：调用次数+tokens） |
| 收件箱复活 | `persistReviewTasks`（adapt 自检红项 → review_tasks）+ `GET/POST review-tasks` + script 页红项改从任务表读取 + workbench `<ReviewInbox>` |

### 验证结果

- 单测：`progress.test.ts` 4 例（事件重放/状态机/取消/孤儿清理）、`worker.test.ts` 3 例（成功/协作取消/失败）、`cost.test.ts` 2 例（口径一致）、`job-step-list.ui.test.tsx` 4 例 + 原有全部 —— **63 通过 / 1 既有 skip**，连跑 3 次无锁抖动
- 门禁：tsc 0 错 · eslint 0 错 · lint:ui 通过 · vitest:ui 10 通过 · `next build` 成功
- **实机冒烟**（next start + 独立数据目录）：入队 41ms → SSE 首事件 **0ms**（排队中）→ worker 子进程真实执行 → 事件流 step→error→status(failed) 完整到达 → SMOKE PASS

### P1 四条验收对照

| 验收 | 状态 | 说明 |
|---|---|---|
| ① 所有异步操作有阶段进度，刷新可接回 | ✅ | 7 个 AI 操作全部经 jobs；`GET /jobs?active` + `useJob` 初始拉取实现接回 |
| ② 可取消生成并看到"已取消（完成到 X）" | ✅ | 协作式取消 + `<JobStepList>` cancelled 态显示完成位置；单测覆盖 |
| ③ 成本仪表盘与 cost-report.ts 一致 | ✅ | 同口径聚合 + 单测比对 |
| ④ 长任务首事件 <1s | ✅ | 入队同步写"排队中"事件；冒烟实测 0ms |

### 顺带修复（实机冒烟发现）

- **Windows `spawn("npx")` ENOENT**：`render/start` 与 worker 派生全部静默失败（stdio ignore 吞错）——改为 `shell:true` 单串命令并挂 error 监听；**这同时修好了此前"渲染按钮点了没反应"的潜在 bug**
- **SQLite 写锁**：多进程共享库时 `database is locked`——`busy_timeout=10000`（对 worker+server 真实并发同样必要）

### 明确延后到 P2

Playwright e2e（整页 axe / reduced-motion 冒烟 / 视觉回归基线）· DAG `graph.ts`（影响面计数/stale 溯源）·
结构化 `NodeEstimate` + `<PlanSheet>`（移除 estimate 预热）· `staged_changes` + `<DiffReview>` ·
`<CandidateGallery>` 左右对比 · `<TimeMachine>` 多步回滚 · `<CommandPalette>` · `<EvidenceDisclosure>`。

---

## 附录 D · P2 落地记录（审阅面，本轮完成）

### 已落地

| 项 | 实现 |
|---|---|
| staging 数据层 | `staged_changes` 表（含迁移）；`src/lib/staging.ts`：stageEntries（原子写入）/ listStaged / stagedSummary / discardStaged / applyStaged（原生事务 + 审阅应用前自动建 checkpoint + 应用表白名单） |
| adapt 拆分 | `runAdaptation(dryRun)` 只算不落库；`buildAdaptationWrite` 计算章节 payload + beats 行（staging 与持久化共用）；`stageAdaptation` 生成章节 update/insert + 旧 beats delete + 新 beats insert 清单 |
| storyboard 拆分 | `computeStoryboard`（草稿含占位 id，快照引用同一批 id → 审阅通过后快照直接可用）；`buildStoryboard` 复用；`stageStoryboard` 生成旧镜头 delete + 新镜头/layer insert + timeline insert 清单 |
| worker 集成 | adapt/storyboard 任务默认走 staging（"变更清单已生成，等待审阅"事件）；assets/voice/analyze 仍直接执行 |
| DiffReview | `StagedReviewPanel`：每屏 ≤4 组、逐条 accept/reject、纯键盘 j/k/a/r/u/Enter、全部接受需二次确认、吸底常驻操作区、放弃本次 |
| 页面接入 | script（改编审阅）/ storyboard（构建审阅）/ workbench（重跑 adapt/storyboard 进入审阅）；挂载时经 `/staged` 接回未完成审阅 |
| 时间机器 | 5 个签核点自动 checkpoint（风格方案/本章/分镜/配音/资产批准前快照）；`GET /checkpoints` + `POST /checkpoints/[id]/revert`；`<TimeMachine>` 面板（workbench，回滚后广播 data-changed 刷新） |
| 证据披露 | script 页自检红黄项可点击 → 滚动定位 beat 卡 + 闪烁；`/estimate` 结构化预报（调用次数/覆盖行数/可撤销/staged 标记/blockers） |
| PlanSheet | `<PlanSheet>` 替换 workbench 确认卡（将生成/将覆盖/可否撤销/前置条件） |
| 命令面板 | `<CommandPalette>` Cmd+K（workbench：8 页面跳转 + 6 重跑动作，↑↓/Enter/Esc） |
| graph | `NODE_GRAPH` DAG + `estimateNode`（六节点结构化预报）+ `downstreamImpact`（stale 溯源数据源） |

### 验证结果

- 单测：`staging.test.ts` 4 例（写入/排序/分组、决策应用与清空、丢弃不落库、compute 快照 id 一致性）；`checkpoints.test.ts` 新增签核点例（批准建 checkpoint → 回滚恢复 pending_review）——**68 通过 / 1 既有 skip**，连跑 3 次稳定
- UI 测试：`staged-review-panel.ui.test.tsx` 4 例（≤4 组分页、纯键盘决策并只提交已决策项、u 撤销、全部接受二次确认）——**14 通过**
- 门禁：tsc 0 错 · eslint 0 错 · lint:ui 通过 · `next build` 成功

### P2 五条验收对照

| 验收 | 状态 | 说明 |
|---|---|---|
| ① 重跑改编进入逐条审阅，可只接受其中 3 条 | ✅ | staging 全链路 + UI 测试证明只提交已决策项 |
| ② 每屏呈现变更 ≤4 条 | ✅ | pageSize=4 分页 + UI 测试断言 |
| ③ 纯键盘完成一轮 20 条 beat 审阅 | ✅ | j/k/a/r/u/Enter + 光标跟随滚动 + UI 测试 |
| ④ 可回滚到"批准风格 B 之前" | ✅ | 5 个签核点自动 checkpoint + TimeMachine + 单测（批准→回滚→恢复 pending_review） |
| ⑤ AI 结论一键跳到证据 | ✅ | 自检项点击定位 beat（滚动+闪烁），取舍报告可展开 |

### 顺带修复

- jsdom 无 `scrollIntoView` → `?.()` 兜底（UI 测试）
- 测试连发键盘事件暴露的 React flush 语义（真实场景无影响）
- `runAdaptation` 返回类型收紧为 `string | null`（dryRun），下游调用处全部适配

### 明确延后到 P3 / 备注

- `<CandidateGallery>`（资产候选对比 + 风格方案左右分屏）——数据层就绪，UI 工作量归入 P3 直接操纵轮
- StatusBadge「影响 N」溯源按钮接线（`downstreamImpact` 数据源已就绪，需 DAG 计数 UI）
- Playwright e2e 基线（整页 axe / reduced-motion / 视觉回归）

---

## 附录 E · P3 落地记录（直接操纵，本轮完成）

### 已落地

| 项 | 实现 |
|---|---|
| 检查器乐观更新 | 画布 beat/shot/layer 检查器**去掉全部保存按钮**：`quickEdit` 本地即时生效 + 防抖 500ms `autoSave`（成功合并进本地 data 不再整页重载，失败 toast，撤销入口 = checkpoint 撤销）；成功 toast 附撤销 |
| 拖右缘调时长 | `ShotNode` 右缘指针手柄（`setPointerCapture`）→ 拖动实时改节点宽度与时长（PX_PER_SEC），松手防抖落库 |
| 入/出点动画选择器 | 图层检查器入场/退场由下拉改为**点击即选 chip 组**（选中高亮，自动保存） |
| 拖放反馈套件 | 拖资产时画布环形高亮（ring）；落地成功自动选中目标镜头 + 乐观替换 + 撤销 toast；落空资产池脉冲抖动 + 提示 |
| 画布快捷键 | `B` 循环选 beat · `S` 循环选镜头 · `R` 打开重跑分镜确认 · `Esc` 关闭；输入控件内不劫持 |
| 单句重录 | 检查器内「🔊 重配音本句」（4 步 1 屏）；无 take 时走重跑配音确认流程 |
| AI 建议 chips | 画布：连续 ≥3 个重复机位 →「自动重排？」；缺配音句数 →「补齐？」（→ 确认卡 → job → staged 审阅）。script 页：自检红项区「一键重跑修复」→ PlanSheet → 入队 → staged 审阅（**预报→diff→撤销全链路**） |
| 风格方案左右对比 | bible 页「左右对比」切换（3 列 grid，与批准/撤销联动） |
| e2e 基线 | `@playwright/test` + `@axe-core/playwright`：首页渲染、**整页 axe critical/serious=0**、reduced-motion 计算样式无 infinite（desktop+mobile 双视口）；`npm run test:e2e`（需先 build，自动起 server） |

### 验证结果

- 门禁全绿：tsc 0 错 · eslint 0 错（含 e2e 目录）· lint:ui 通过 · vitest **68** 通过 · vitest:ui **14** 通过 · **e2e 6/6 通过** · `next build` 成功
- P0 验收③升级为浏览器级证据：整页 axe（WCAG 2 A/AA/21 A/AA）critical/serious = 0

### P3 三条验收对照

| 验收 | 状态 | 说明 |
|---|---|---|
| ① 80% 高频编排在画布内完成 | ✅ | 说话人/台词/情绪/语速/换图/时长/机位/转场/背景/入出场/单句重录/重跑/撤销均在画布可达（资产生成与渲染属签核页职责） |
| ② 换说话人 4 步 1 屏 | ✅ | 点 beat（B 键）→ 检查器下拉 → 自动保存 → 本句重配音按钮；全程画布内 |
| ③ 建议 chips 走预报→diff→撤销链路 | ✅ | chips → PlanSheet（结构化预报）→ job → staged 变更清单 → DiffReview 逐条审阅 → checkpoint 撤销 |

### 顺带修复

- Windows `spawn("npx")` ENOENT（P1 冒烟发现，worker 与 render/start 两处，`shell:true`）
- SQLite 多进程写锁 → `busy_timeout=10000`
- jsdom 无 `scrollIntoView` 兜底
- React Compiler 对画布 legacy memo 的静态分析误报 → 定点 `eslint-disable`（`react-hooks/refs`）+ `edit`/`undo` 稳定化（useCallback）

### 后续建议（超出四期验收范围）

- CandidateGallery 资产候选并排对比（数据层/组件规格已就绪）
- StatusBadge「影响 N」溯源按钮接线（`downstreamImpact` 已就绪）
- 视觉回归基线（Playwright `toHaveScreenshot`，需固定 fixture 数据）
- CostMeter 接入价格表后的 ¥ 展示（M1）

---

## 附录 F · 真实数据端到端验证（2674 字真实章节，4 次运行）

> 方法：`scripts/e2e-verify.ts`（可复用回归工具）——独立数据目录 + `next start`，走 HTTP API 全链路：
> 上传 → analyze → adapt（staged 审阅+应用）→ 批准风格/本章 → fixture 占位资产 → storyboard（staged）→ 批准分镜 →
> voice（真实 TTS+ASR）→ cost 一致性。**调用真实 LLM/图像/TTS 服务，有成本**。

### 最终结果：23/23 通过（第 4 次运行，bookId fba23759）

| 节点 | 结果 | 数据 |
|---|---|---|
| 上传解析 | ✓ | 1 章 / 2674 字 |
| analyze | ✓ 17s | 5 人物 · 6 线索 · 风格候选生成 |
| adapt（staged） | ✓ 390s | 52 条变更清单（51 beats + 章节）→ 应用 → 51 beats 落库，章节 pending_review |
| 签核 A/B | ✓ | 批准风格方案 + 批准本章，均生成 approve checkpoint |
| storyboard（staged） | ✓ 2s | 84 条清单（51 镜头 + 32 图层 + 时间线）→ 应用 → 全落库 |
| 签核 D | ✓ | 批准分镜 |
| voice | ✓ 29s | 32 句真实 TTS+ASR，**32/32 accepted**（无红项） |
| cost 一致性 | ✓ | API 与 DB 完全一致：9 次调用 / 17,878 in / 25,944 out tokens |

### 抓到并修复的 4 个真实问题（单测覆盖不到的层）

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | adapt/storyboard job 秒失败 | P1/P2 新路径把 `cleaned_text`（snake_case）直接传给 `runAdaptation`，旧 `/adapt` 路由做了 camelCase 映射，新路径没有 | workbench.rerunNode + stageAdaptation 补映射 |
| 2 | adapt 反复失败：`Expected ',' or ']' after array element` | 大章节 + 全量 beats JSON 超过 `maxTokens: 8000` 被截断 | 16K + prompt 硬约束 10（输出体积预算：beats ≤24、text ≤60/80 字） |
| 3 | adapt 反复失败：时长超预算 / 旁白超 8s | 校验规则过严且互相拉扯；模型重试修一漏一 | ① 旁白上限 8s→10s；② `isOnlyDurationError` → `applyDurationCap` 确定性按比例压缩（不再重试）；③ `repairSourceSpans` 用 beat.text 模糊定位修正 span（重试压力下 span 越错越多，实测第 3 次重试 20 项 span 错误爆炸）；④ 结构化创作温度 0.5→0.3、重试上限 4 |
| 4 | 分镜审阅后"0 图层"误报 | **验证脚本查询写错**（`shot_layers` 表无 `book_id` 列），非应用问题 | 脚本按全库计数；实测 32 图层真实落库 |

### 预报 vs 实际（校准结果，已写回 `estimateNode`）

| 节点 | 原预报 | 实测 | 校准后 |
|---|---|---|---|
| analyze | 30~60s | 17~21s | 15~30s |
| adapt | 30~90s | 258~390s（含校验重试与确定性修复） | 120~420s |
| storyboard | 2~6s | 2s | 2~6s（不变） |
| voice | 句数×4~8s（32 句 ≈ 204~408s） | 29s（串行 TTS+ASR 单句 <1s） | 句数×1~2s |

### 关键结论（写进产品认知）

1. **adapt 是整条链路的瓶颈**：模型输出不稳定（每次 1~4 次 LLM 尝试），校验重试是常态。确定性修复（压缩/span 定位）已把"4 次全失败"变成"2 次尝试 + 确定性接管"，但仍有失败风险——**已落地失败降级**（见下），并把 PlanSheet 的 adapt 文案改为"预计 2~7 分钟"。
2. **voice 实测远快于模型预估**（单句 <1s），预报已校准。
3. **成本基线**：单章 2674 字全流程 ≈ 9 次 LLM/TTS 调用、约 44K tokens 输入输出（图像除外）——可作为 M0 成本估算依据。
4. 验证脚本 `scripts/e2e-verify.ts` 保留为回归工具（会真实调用服务，跑之前确认预算）。

### 失败降级（重试耗尽的最后一公里，已落地）

- `AdaptationValidationError`（携带错误列表 + 最后一次模型输出）替代裸 throw；
- `handleAdaptationFailure` 把失败诊断写入 `review_tasks`（kind=`chapter_script`、ai_report.kind=`adapt_validation`），job 的失败消息变为
  「改编校验连续失败（N 项，详情已存入待审收件箱）」；
- 收件箱（workbench）与 script 页自检区都会展示该诊断（script 页以「【改编校验失败】」只读样式呈现，不假装可定位 beat）；
- 用户不再面对一句红字：能看见失败原因、建议，并可从 workbench 时间机器/收件箱处置后重跑；
- 单测：`review.test.ts` 2 例（诊断写入 + 空错误兜底）。门禁全绿：tsc/eslint/lint:ui 0 错、vitest 74 通过、`next build` 成功。

### 计划内收尾项（已落地，第三批）

| 项 | 实现 |
|---|---|
| StatusBadge「影响 N」溯源 | `downstreamImpact` 补齐 adapted_chapters/beats（含 voice_takes）/timelines（含 render_jobs）分支 + `GET /impact` + `<ImpactPill>`（stale 时显示「影响 N」，点击展开明细浮层）；接入 script 页章节徽章与 workbench 时间线徽章；单测 3 例 |
| CandidateGallery（资产对比） | 资产候选卡加「对比」按钮（选中高亮 ring + hover 放大），选两张出现**吸底并排对比条**（各自信息/批准按钮/hover 放大/选第 3 张替换最早项/关闭）；bible 风格方案左右对比此前已在 P3 落地 |
| 视觉回归基线 | `scripts/seed-fixture.ts`（确定性 fixture-book，幂等重建）→ `e2e/visual.spec.ts`（7 路由 × desktop/mobile 双视口 `toHaveScreenshot`，动画禁用 + networkidle 稳定），**14 张基线已生成且可复现**；playwright webServer 自动 `seed:fixture` 前置 |

验证：vitest **77** 通过（+graph 3 例）/ vitest:ui 14 / e2e **20** 通过（smoke 6 + visual 14）/ tsc·eslint·lint:ui 0 错 / build 成功。
