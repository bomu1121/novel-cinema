# 07 · UI 视觉与交互调研 —— 主流 AI coding 工具的视觉语言与交互规则

> 调研窗口：2026-08 · 定位：`docs/06-ui-optimization-plan.md` 的**证据外延**，不是替代。
> 06 是项目内部的执行方案（P0–P3 已落地）；07 回答"这套做法在行业里处于什么位置、下一轮 P4 抄什么"。
>
> 一句话结论：主流 AI coding 界面已经收敛为**三层结构**——
> **玻璃箱（执行可见）· 控制台（mission control，监督与编排）· 审阅面（diff 决策）**；
> 视觉上则是**工程工具审美**：中性灰底、单一强调色、高信息密度、动效即信息、状态色语义化。

---

## 0. 摘要

1. **视觉层**：赢家不是"更炫"，而是**克制的工程工具审美**。Cursor 的中性灰 + 单橙强调色、Claude Code 的"动画编码状态"、社区设计规则库一致强调：8pt 网格、三层文字、一屏一个主操作、强调色只给 CTA/激活态/链接、动效只表达状态转换。项目 tokens 已对了一半，差距在**强调色与状态色耦合**、**字号无刻度**、**部分 Tailwind 默认色/动画绕过令牌**。
2. **交互层**：五条信任原语（计划先行 / diff 审阅 / 检查点 / 折叠理由 / 成本计量，06 §3.1）已被行业从"个别工具的卖点"升级为"默认基座"。新增的三个 2025–2026 增量是本轮调研最有价值的发现：
   - **可观察自主性（Observable Autonomy）**：给 agent 自由，但把每一步放进玻璃箱；中断成本 < 撤销成本。
   - **可逆性分层闸门（Reversibility Tiering）**：auto-approve / notify-gate(必须带真撤销) / block-gate，按"对世界做了什么"分级，**不看模型置信度**。
   - **中断即一等公民**：不是只有一个 Stop，而是 stop / pause / redirect 三分；用户中途加需求、改需求、撤回子需求（addition / revision / retraction）都要有原生交互。
3. **形态层**：Antigravity 的教训最有代表性——**编辑器视图（同步协作）与管理面（异步编排）必须分家**，chat 被降级为控制台里的一个模式。本项目的 `workbench（管理） + canvas（编辑）` 分法正好踩在这条线上；M1 夜跑队列需要把它补成真正的 mission control。
4. **规则工程**：Vercel 的内部做法证明"设计规则要能被 agent 稳定执行"本身是一套工程——规则带稳定 ID、bad/good 例、coverage gaps，能静态检查的进 lint，不能的进 Skill，再用 holdout eval 验证。本项目 `nc-ui-contract` + `lint:ui` 已搭好骨架，升级方向明确。
5. **P4 优先级**：视觉收口（小）→ 执行态增强（停滞检测 / 暂停 / 收据）→ 闸门与预算硬停 → M1 多任务控制台。暗色模式与生成式 UI 维持 06 的判断：**暂不做**。

---

## 1. 调研方法与证据分级

### 1.1 样本

| 类别 | 工具 | 关注点 |
|---|---|---|
| IDE agent | Cursor（2.0）/ GitHub Copilot / Windsurf / Zed | 内联 diff、agent 活动流、审阅粒度、checkpoint |
| 终端 agent | Claude Code / Codex CLI / Aider / Cline / Gemini CLI | 玻璃箱执行、计划模式、权限弹窗、成本行、/rewind |
| Agentic IDE | Google Antigravity（1.0/2.0） | editor view × manager surface、artifact 信任面 |
| 浏览器构建器 | v0 / Lovable / Bolt | 即时预览、token 约束、AI slop 反模式 |
| 设计规则层 | Vercel product-design skill、community design-system skills、cursor-design-rules | 规则如何被 agent 稳定执行 |

### 1.2 证据分级（引用时不再重复标注）

- **A · 官方/一手**：工具官方文档与产品本身、厂商工程博客。
- **B · 半一手**：代码级工程分析（如 Claude Code 终端 UI 逐模块分析）、arXiv 论文、带日期的独立评测。
- **C · 社区模式目录**：可交叉印证、但存在同文转载的弱证据（文中已标注需要警惕之处）。

### 1.3 与 docs/06 的关系

06 已经吸收过 METR −19%、DORA 2025、SmartBear <400 LOC、Cowan ~4 chunk、Myers 百分比进度等量化证据，并落地 P0–P3。07 **不重复 06 已内化的内容**，只做三件事：
① 把主流工具的视觉语言与交互规则整理成可检索的规则目录；② 补 06 写完后行业新增的证据（可观察自主性、可逆性分层、可中断性研究、Vercel 规则工程）；③ 产出与本项目现状的差距表和 P4 建议。

---

## 2. 主流工具的视觉与交互盘点

### 2.1 横向盘点

| 工具 | 视觉基调 | 标志性交互 | 对本项目的启示 |
|---|---|---|---|
| **Cursor** | 深色优先、高密度；中性灰分层 + 单一橙色强调（社区 Design.md 拆解为 `#f54e00` + CursorGothic，[参考](https://www.shadcn.io/design/cursor)）；内联 diff 用绿/红、不喧宾夺主 | Tab 式接受/驳回、agent 活动流、checkpoint 时间线、`Cmd+K` | 强调色纪律；diff 吸附常驻（06 已吸收）；活动流 = 信任来源 |
| **Claude Code** | 终端 = 受限画布；主题色 + 状态色；spinner 有 4 种模式（requesting/thinking/responding/tool-use）；停滞时 spinner **渐变成红**；reduced-motion 下换成静态圆点 + 2s 呼吸 | 玻璃箱：工具调用/参数/进度实时流式；200ms 权限防误触；`Ctrl+C` 秒级中断；`/rewind` 检查点；会话可恢复 | **动画即信息**；**中断便宜于撤销**；权限弹窗本身要考虑误触成本 |
| **Codex** | 深色、低装饰；thinking 默认折叠；plan 只读 | plan mode、沙箱审批、逐文件 diff 接受/拒绝 | 计划与副作用解耦（06 T1 已落地） |
| **Copilot** | 复用 VS Code 原生视觉，零新设计系统 | agent mode 状态栏、PR 式按文件审阅、"Missing Reject File button"教训 | 审阅粒度=文件；驳回按钮必须始终可见（06 已吸收） |
| **Zed** | 极简 chrome、快是第一设计目标 | agent panel 产出 hunks，逐块接受/驳回 | 暂挂式审阅的最小实现 |
| **Windsurf** | 深色、蓝色系、卡片感略强 | Cascade 流 + 预览 + 搜索上下文显式化 | 显式上下文优于隐式检索（06 S5 已落地为 `@` 定位） |
| **Antigravity** | 1.0：编辑器视图 + Manager Surface 分家；2.0 曾把 IDE 藏进 chat 后被社区批评回退 | **任务级 artifact**：task list → 实施计划 → 走查 → 截图/录屏，作为信任面；Manager 面管多 agent 并行 | mission control 是本项目 workbench 的下一站；artifact 信任面 > 工具日志 |
| **v0 / Lovable / Bolt** | 预览优先：左 prompt、右 live canvas；生成物必须落 token/组件库 | 即时反馈 <1s；设计规则作为上下文喂给 agent | "agent 提 UI，设计系统 dispose"；AI slop 是公认故障模式 |
| **社区规则库** | 8pt 网格、token-first、三层文字、单主操作、section isolation、WCAG AA | 审计器自动报 violation 并给 fix | 项目 lint:ui 的对标物与升级蓝本 |

### 2.2 三个结构判断

1. **执行态必须是玻璃箱，不是黑箱进度条**。Claude Code 的用户价值公式是"信任但实时验证"：所有工具调用流式展示参数与进度，用户能在走错方向的第 3 秒中断，而不是等 20 秒执行完再撤销——**中断成本 < 撤销成本**，所以 UI 必须让"早期发现走偏"成为可能（[Claude Code UX 工程分析](https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/docs/12-user-experience.md)）。
2. **编排面与编辑面分离**。agent 能并行、能后台跑之后，"侧边栏 chat"就不再是正确抽象；需要的是任务状态板（哪个 agent 在跑、卡在等谁、待审批项、产出物）。Antigravity 把 editor view 与 manager surface 分开是这个判断的产品化（[mission control, not chat](https://timetobuildbob.com/blog/the-next-agent-ui-is-mission-control-not-chat/)；[Antigravity 2.0 的 chat-first 回退](https://www.howtogeek.com/google-antigravity-hid-the-ide-behind-a-chatbot-heres-how-to-get-it-back/)）。
3. **审阅面是信任闭环的终点**。所有工具最终都回到同一种界面：暂挂的变更、逐条接受/驳回、键盘可完成、批量接受不作默认。本项目的 `<StagedReviewPanel>` 与这条线一致，差异只在打磨。

---

## 3. 视觉规则（12 条）

> 每条给出：规则 → 行业证据 → 本项目现状（✅ 已收敛 / ⚠️ 部分 / ❌ 缺失）→ P4 动作。

### V1 · 中性底 + 单一强调色，强调色与状态色解耦

- **规则**：底色三层灰；强调色只用于 CTA、激活态、链接；红/绿/蓝等**语义状态色**与**交互强调色**是两套令牌，不互相借用。
- **证据**：Cursor 的中性灰 + 单橙；[community DesignSystem skill](https://github.com/Jaywalker-not-a-whitewalker/DesignSystem) 的 "accent only for CTAs, active states, links — never decoration"；[cursor-design-rules](https://github.com/studioalexwolf/cursor-design-rules) 把 "3 个蓝色按钮抢主 CTA" 列为头号反模式；Vercel 规则禁止 `className` 覆盖设计系统组件的 color/radius/shadow（[Teaching agents product design at Vercel](https://vercel.com/blog/teaching-agents-product-design-at-vercel-2UtdJlYIxoLAmiwWt5i4rV/f0095a8e84)）。
- **本项目**：⚠️ 灰阶令牌齐全，但 `--st-review`（待审蓝）同时兼任焦点环、进度条、脉冲点、链接色——语义色与强调色耦合。
- **P4**：新增 `--accent`（交互强调）与 `--st-review`（待审）分离的映射；焦点环 / 进度 / 链接改引 accent。视觉上可以同值，语义上必须两个名字。

### V2 · 字号与间距成刻度，不出现魔法值

- **规则**：间距 8pt 网格（密集工作台可用 4px 半档，但必须是网格内）；字号 3–5 档、正文 ≥14px、12px 只给 meta/caption；数字用 `tabular-nums`；三层文字 = primary / muted / faint。
- **证据**：DesignSystem skill 强制 "every margin/padding/gap on 8pt grid"；cursor-design-rules 的坏例子是 `padding: 13px`、`font-size: 12px` 正文；Vercel 的 lint 会 flag 掉出 4px 网格的任意间距。
- **本项目**：⚠️ 间距用 Tailwind 4px 基数是成刻度的；但**字号没有令牌**（散落 `text-xs/sm/base`）；更严重的是**中性灰大面积未迁移**——全仓 grep `text-zinc-* / bg-zinc-* / border-zinc-*` 共 **149 处**（10 个页面 + 画布，另有 `hover:border-indigo-400` 等零星越界色）。P0 迁移的是状态色与组件，中性调色板没被纳入迁移范围，`lint:ui` 也未拦裸调色板类。
- **P4**：`@theme` 增加 `--text-caption/body/lead/title`（或 text-* 刻度映射）；把 149 处 zinc 机械迁移为 `surface/surface-2/surface-3/border/edge/text-text-muted` 等令牌（脚本批量 + 视觉回归复核）；lint:ui 增加裸 Tailwind 调色板类规则。

### V3 · 每屏一个主操作，动作分主次

- **规则**：一个视图只有一个 primary CTA；次要与破坏性动作降级为 secondary/ghost/danger；loading 保留原文案不闪字。
- **证据**：cursor-design-rules（1 primary CTA 是三条免费规则之一）；DesignSystem skill "one primary action per view"。
- **本项目**：✅ `<Button>` 有 5 变体 + loading 保留文案 + progress 底纹；⚠️ 尚未做过"每视图主操作审计"（workbench 每节一个重跑是合理的，但整页需要一张主次图）。
- **P4**：把"一屏一主操作"写进 `nc-ui-contract` 复核清单；对 10 个页面做一次主操作标注评审。

### V4 · Section isolation：分区只用一个手段

- **规则**：两个相邻区块之间，从 `表面色差 / 留白 / 分隔线 / 边框 / 色块` 中**选一个**，不叠加；禁止卡片套卡片、重复边框 + 阴影。
- **证据**：DesignSystem skill 的 "section isolation" 硬规则；AI 生成界面的 "card-on-card nesting" 是 [impeccable.style](https://impeccable.style/) 收录的典型 AI slop。
- **本项目**：⚠️ `<SectionCard>` 同时用了边框 + `shadow-card`，页内嵌套卡片是否过量未审计。
- **P4**：SectionCard 收敛为"边框为主、阴影仅浮层用"（或反之）；视觉回归基线顺带兜底。

### V5 · 动效即信息：时长分档、状态可读、失焦暂停

- **规则**：动效只编码状态转换；时长用 M3 三档（100/160/240/320ms 级）；无限动画仅允许"内容型预览"，装饰型一律一次性；窗口失焦暂停动画；`prefers-reduced-motion` 下换成静态等价物而非消失。
- **证据**：Claude Code 把这一条做到极致——requesting 用 50ms/帧快速 shimmer、thinking 用 200ms/帧慢速 shimmer、spinner 停滞时**向红色渐变**、多个执行点 600ms 周期**同步闪烁**、终端失焦时全局暂停动画、reduced-motion 换成静态圆点 + 2s 呼吸。这是"动画即信息"最完整的工程样本（[Claude Code UX §14.2/14.4](https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/docs/12-user-experience.md)）。
- **本项目**：⚠️ 有 `--dur-*` 四档 + reduced-motion 全局兜底 + stale-flash 一次性呼吸；❌ 但 `animate-spin/animate-pulse` 仍是 Tailwind 默认时长（1s/2s）绕过令牌；job 长时间无事件时**没有停滞信号**；页面失焦不暂停。
- **P4**：抽一个共享时钟 `useBlink(600ms)` / 或最少把 spin/pulse 换成 token 时长版本；`JobStepList` 增加停滞检测（见 I6）；`document.hidden` 时暂停动画。

### V6 · 状态色语义分族，执行态不进徽章

- **规则**：审阅生命周期（结论）用徽章；执行生命周期（过程）用步骤/进度组件；领域语义（剧情/阶段）用中性 chip——三类不混。
- **证据**：Claude Code 的工具点颜色状态机（执行中闪烁→成功绿→失败红，完成即让位于内容）；06 §5.3 的三族判断与 [AI UX patterns 的 state taxonomy](https://raw.githubusercontent.com/vasilyu1983/AI-Agents-public/main/frameworks/shared-skills/skills/software-ui-ux-design/references/ai-automation-ux.md)（queued/streaming/tool-use/multi-step/complete 各有视觉与时长）一致。
- **本项目**：✅ `toReviewStatus()` 返回 null 拒绝渲染徽章、`toJobPhase()`、`neutralStatusLabel()` 三族已落地并有单测。
- **P4**：无（保持）。

### V7 · 暗色模式：主流是 dark-first，但本项目维持延后

- **规则**：开发者工具用户默认深色（Cursor/Claude Code/Codex/Antigravity 全部 dark-first）；消费创作类（CapCut/Canva）以浅色为主。二选一的正确做法是 `[data-theme]` 令牌双套，而不是组件里写死。
- **本项目**：⚠️ 06 §11 明确"暗色模式 P3 后评估"。结论：**P4 也不做**，但把 `:root` 令牌保持为唯一变量入口，未来加 `[data-theme="dark"]` 覆盖即可，成本已被 06 §5.1 预留。
- **P4**：无动作；仅在新增颜色时保证走 `:root` 变量。

### V8 · 空态必须给下一步；骨架屏不伪造 AI 产物

- **规则**：空状态 = 原因 + 下一步 + 一键执行，而不是"暂无数据"；骨架屏只用于**已存在、加载中**的数据，绝不用于尚未生成的 AI 产物（假就绪破坏信任）。
- **证据**：06 §6.1/6b 已引 [CHI 2025 假就绪研究](https://dl.acm.org/doi/full/10.1145/3735593)；社区目录把 "empty state with suggested prompts / next action" 列为对话式与生成式界面的必备项。
- **本项目**：⚠️ 空态文案基本都有下一步（script/storyboard/assets 都写了前置动作），但仍是 6 处手写段落（其中部分用裸 `text-zinc-400`，见 V2 的 149 处问题），`<EmptyState>` 组件未落地。
- **P4**：抽 `<EmptyState>`（title/description/action），迁移 6 处，颜色类随 V2 一并换成令牌。

### V9 · 反 AI 味清单：八条红线

| # | 反模式 | 行业出处 | 本项目动作 |
|---|---|---|---|
| 1 | 无动机的紫渐变 / 蓝发光 | cursor-design-rules、impeccable.style | 已有令牌无渐变；lint 已拦 `bg-[#` |
| 2 | 卡片套卡片、重复边框+阴影 | DesignSystem skill | 见 V4 |
| 3 | 三列相同 feature grid / 复制粘贴区块 | DesignSystem skill | 页面审计项 |
| 4 | 正文居中、层级与重要性不匹配 | impeccable.style | 复核清单项 |
| 5 | 纯黑 `#000` / 未调色的灰 | impeccable.style | 令牌已定义，但 149 处 zinc 待迁移（V2） |
| 6 | 灰色文字放在彩色底上 | impeccable.style | 状态徽章用色 token + 10% 底，已解决 |
| 7 | 弹性/回弹缓动用于工具类产品 | impeccable.style；06 反目标 | 默认 `--ease-out`，保持 |
| 8 | 13px padding、12px 正文等魔法值 | cursor-design-rules | 见 V2 lint |

- **P4**：把上表做成 `nc-ui-contract/references/anti-slop.md`，8 条中 4 条能机器化的（#1/#5/#8）进 lint。

### V10 · 焦点、命中区、可读性视觉兜底

- **规则**：focus-visible 走共享焦点令牌；命中区 ≥24px；图标按钮必须有可访问名；滚动长内容吸底操作区不被遮挡。
- **证据**：WCAG 2.2（06 已引）；Vercel 的 lint 规则 "require accessible names for icon buttons and form controls, reject custom focus rings that bypass shared focus tokens"。
- **本项目**：✅ 焦点环 + ≥24px 命中区 + axe critical/serious=0 已落地；⚠️ 尚未引入 `eslint-plugin-jsx-a11y` 的静态兜底。
- **P4**：devDeps 加 `eslint-plugin-jsx-a11y`，CI 与 `lint:ui` 双跑。

### V11 · 信息密度与布局节奏：先总览、再过滤、后细节

- **规则**：工作台密度可以高，但必须有层次节奏——列表页用行、审阅页用卡片、画布用节点；F 型扫描下关键信息（状态/成本/操作）固定在左或吸底，不埋进滚动尾部。
- **证据**：Shneiderman 总览→过滤→细节（06 已引）；Copilot "接受按钮埋在滚动里"的反模式（06 §3.3）；Antigravity Manager 的任务列表/待审批项分层。
- **本项目**：✅ 状态吸底操作区（StagedReviewPanel）、workbench 分层已做到；⚠️ 页面级无统一"页头摘要条"（bookId 各页状态与成本位置不一）。
- **P4**：可选——六签核页统一页头摘要（阶段 / 待审数 / 今日成本 / 快捷动作）。

### V12 · 图形语言统一：图标/加载符/快捷键提示成套

- **规则**：图标同一套 stroke 风格；loading 指示用组件而非 emoji；快捷键提示统一 `kbd` 样式；状态图标（✓/●/✗）只承载已定义语义。
- **证据**：Claude Code 的 spinner glyph 与同步闪烁系统；Cursor 的 `kbd` 快捷键提示。
- **本项目**：⚠️ `<Button shortcut>` 已统一；其余页面的 ✓/emoji 使用未审计。
- **P4**：纳入 `nc-motion-review` / 契约复核清单，不单独立项。

---

## 4. 交互规则（15 条，按交互四阶段组织）

> 阶段框架来自 [Zhu et al. 2026, Design Principles for Human-Agent Interaction](https://arxiv.org/abs/2606.20630)：**行动前 / 执行中 / 完成后 / 出错时**——只回答"执行中"的界面是 demo，不是产品。

### 4.1 行动前（intent & gate）

**I1 · 计划先行：决策与副作用解耦** ✅
读-only 计划（将生成什么/覆盖什么/花多少/多久/可否撤销）先于任何写操作；可只预演不执行。证据：Codex plan mode、Copilot spec→plan、Antigravity 把 "task list + implementation plan" 作为第一级 artifact。
本项目：`<PlanSheet>` + `estimateNode()` + adapt/storyboard staging 已落地。**保持。**

**I2 · 自主性五级，按节点选择而不是一刀切** ⚠️
标准分级：Suggest → Approve-then-act → Act-then-review → Autonomous with alerts → Fully autonomous（[AI UX patterns: User Control Hierarchy](https://raw.githubusercontent.com/vasilyu1983/AI-Agents-public/main/frameworks/shared-skills/skills/software-ui-ux-design/references/ai-automation-ux.md)）。每类 AI 动作允许用户调档，且**从低档起步、随信任上升**。
本项目：每个节点有固定路径（adapt/storyboard=审阅闸；assets/voice=直接执行+可取消），但用户不能调档。
P4：在 workbench 提供 per-node 三选一：`直接执行 / 完成后通知 / 每次预演+审阅`；默认值维持现状（渐进授权不倒退）。

**I3 · 可逆性分层闸门：auto / notify / block 三档** ⚠️（重点新增）
- **auto-approve**：安全且可逆（读、算、预演）→ 静默执行，进活动日志。
- **notify-gate**：有影响但可恢复（编辑、覆盖）→ 执行 + 醒目通知 + **内联撤销**。
- **block-gate**：不可逆或对外可见（删除、花钱、发布）→ 停下来等人批。
- 两条铁律：**notify 必须配真撤销，否则它就是 block 穿了伪装**；**分级看"对世界做了什么"，不看模型置信度**——高置信度的不可逆操作仍然不可逆。置信度只进展示层（I11）。
证据：三档形态在 2026 年社区目录中大量出现（弱证据，存在同文转载），但硬证据是 LangGraph 等框架已把 interrupt/resume 做成一等运行时原语，UI 分层应架在该原语上。
本项目：⚠️ 语义上接近（staging=block；直接 job=notify；预演=auto），但**没有显式的三档命名与"notify 必有 undo"测试**。
P4：`estimateNode().reversible` 之外增加 `gate: "auto"|"notify"|"block"`；对 7 个节点逐个打档并写单测；notify 档全部核对 Toast 撤销入口存在。

**I4 · 破坏性动作前 checkpoint，`reversible` 必须为真** ✅
证据：Cursor checkpoints / Claude Code `/rewind` / Aider 自动 commit + `/undo`（06 T3）。
本项目：checkpoint + `<TimeMachine>` + 5 签核点自动快照已落地并有单测。**保持。**

### 4.2 执行中（observe & steer）

**I5 · 可观察自主性：玻璃箱执行** ✅⚠️
规则：agent 自主行动，但每一步（工具/阶段/参数/产出）都实时可见；用户能在走偏的第 3 秒打断，而不是 20 秒后撤销。
本项目：✅ SSE + `JobStepList`（step/序号/已用时/取消）+ log 事件通道已落地；⚠️ 日志只在事件表里，UI 没有"折叠的完整执行日志"视图。
P4：`<JobStepList>` 下挂默认折叠的 log 抽屉（T4 原则）；重跑 adapt 类长任务时折叠展示"第 N 次校验重试"日志。

**I6 · 进度真实 + TTFT<1s + 停滞检测** ⚠️（重点新增）
- 真实分母才给百分比；无分母只显示阶段+已用时——本项目 ✅ 已做到（`job-step-list.tsx` 注释即红线）。
- 首事件 <1s——本项目 ✅ 入队即写"排队中"（实测 0ms）。
- **停滞检测**：长时间无新事件时，指示器从强调色**渐变成琥珀/红**并附文案（"已 4 分钟没有新事件，仍在生成中"）。阈值按节点预报校准（adapt 预报 2~7 分钟，静止阈值应比上限更宽）。
本项目：❌ 无停滞信号，running 永远蓝脉冲。
P4：`useJob` 暴露 `lastEventAt`；`JobStepList` 按 `now - lastEventAt > stallMs(节点)` 切停滞态；样式走令牌（V5 共享时钟）。

**I7 · 中断是一等公民：stop / pause / redirect 三分，支持中途改需求** ❌（重点新增）
- 三种中断意图：**Addition**（"顺便也…"）/ **Revision**（"改成 Y"）/ **Retraction**（"X 不要了"）——[Zou et al. 2026](https://arxiv.org/abs/2604.00892) 证明主流 LLM 在长程任务中处理这三类都很差，UI 必须显式支持：
  - 执行期间输入入口保持可用，不强制二选一（等完 or 全停）；
  - 区分 暂停（当前步骤后停）/ 取消 / 改道；
  - 改道后**明确告知哪些已完成步骤被保留**。
本项目：❌ 只有协作式取消；job 运行时无输入通道；无 pause。
P4：worker 增加 `pause_requested`（当前 step 完成后挂起，可 resume）；对 N 项循环节点（assets/voice）提供"暂停后追加/移除剩余项"的最小 addition/retraction 交互；UI 三按钮语义分色（暂停 ghost / 取消 danger）。

**I8 · mission control：编排面与编辑面分离，artifact 是信任面** ⚠️
- 同步编辑（canvas）与异步编排（workbench）分家——本项目 ✅ 结构已分。
- 管理面展示：任务列表 / 当前阶段 / 待审批 / 产出物 / 验证状态；**artifact（计划、清单、截图、走查）比工具日志更可信**。
- M1 夜跑队列会同时存在多个 pending/running 任务——当前 UI 是单任务视角，❌ 无任务仪表盘。
P4（随 M1）：workbench 增加任务状态板（active jobs + 待审 staged + 待处理 review_tasks 合一的"运行台"页签）；先做只读列表，控制留在各页。

**I9 · 成本三时刻 + 预算必须硬停** ⚠️（重点新增）
- 时刻：**预飞估算**（✅ PlanSheet 已有）→ **实时累计**（✅ tokens 已有，¥ 待 M1 价格表）→ **任务收据**（❌ 实际 vs 预估、按阶段归因）。
- 两条铁律：**重试是最大的账单惊喜**，收据必须把重试成本显式归因；**预算上限只在"触顶就停 agent"时才有效**，只警告不拦截会让用户学会无视（[AI UX patterns: Cost Visibility](https://raw.githubusercontent.com/vasilyu1983/AI-Agents-public/main/frameworks/shared-skills/skills/software-ui-ux-design/references/ai-automation-ux.md)；Datadog 生产遥测：单请求 token 用量同比中位翻倍、90 分位翻四倍）。
本项目：❌ 无收据、无预算拦截。
P4：`jobs.cost` 已存在——任务终态时渲染"预估 X · 实际 Y · 偏差 Z%，最贵阶段：adapt 校验重试"；M1 价格表接入后加 book 级预算与 `checkCancelled` 式硬停。

### 4.3 完成后（review & trust）

**I10 · 暂挂式 diff 审阅：逐条决策 + ≤4/组 + 吸底操作区 + 键盘全流程** ✅
证据：Zed hunks / Cursor Tab / Copilot 按文件 / 06 T2 + Cowan 4 chunk。
本项目：`<StagedReviewPanel>`（≤4 分页、j/k/a/r/u、全部接受二次确认且非默认焦点、吸底操作区）已落地并有 UI 测试。**保持。**

**I11 · 证据与置信度：结论可一键溯源，置信度进展示不进闸门** ⚠️
规则：每个 AI 结论都能一键跳到证据（原文 span/参考图/ASR 波形）；低置信度用视觉标记（虚线/弱底色/说明），**不**因此取消人工决策——人类是最终闸门；默认折叠推理（Codex issue #2375 教训）。
本项目：✅ 自检红黄项可点击定位、`<EvidenceDisclosure>`、failure 诊断入收件箱；⚠️ 置信度只在 ASR 红黄项表达，其他 AI 字段（人物/线索/机位）无低置信标记。
P4：给带 `confidence` 的 AI 字段统一 `<ConfidenceMark>`（高=无标记，中=点状下划线+tooltip，低=虚线+说明），先接 ASR 与 adapt 自检。

**I12 · 检查点 + 时间机器 + Toast 撤销入口** ✅
本项目：checkpoint 全链路 + 签核点自动快照 + 回滚 + 撤销 toast 已落地。**保持。**

**I13 · 任务收据与瀑布归因** ❌
规则：完成后给"做了什么 / 改了什么 / 花多少 / 哪里慢"四行收据；慢在哪个阶段要可展开（OpenTelemetry span 瀑布）。这就是 06 §6.2 的 `<JobTrace>`（选做项，`jobs.parent_id` 已存在）。
P4：`<JobTrace>` 接 parent_id 与 job_events 渲染阶段瀑布（默认折叠）；成本按阶段归因（配合 I9）。

### 4.4 出错时（diagnose & recover）

**I14 · 错误恢复：具体错误 + 恢复动作 + 不打扰的后台降级** ✅⚠️
- 前台任务（用户正在等）：自动重试 + 显示等待/重试状态；后台任务（建议、摘要）：**静默放弃**，不与前台争抢容量——这是 Claude Code 的负载感知重试，不是"出错就重试一切"。
- 用户可见错误必须带恢复动作（重试/改输入/升级处理），禁止裸 "Something went wrong"。
本项目：✅ adapt 校验失败 → review_tasks 诊断 + 建议；SSE→轮询降级；❌ 无模型级 fallback 策略（若未来加多 provider 需"已降级"披露）。
P4：错误文案审查一遍，确保每条都有"下一步"；多 provider 时披露降级。

**I15 · 键盘优先 + 快捷键可发现** ✅⚠️
规则：高频流程纯键盘可完成；快捷键有统一提示与帮助入口；输入控件内不劫持。
证据：Claude Code 的 keybindings.json（上下文 + 和弦键）、DiffReview j/k（06 §6.3）。
本项目：✅ Cmd+K、画布 B/S/R、审阅 j/k/a/r/u；❌ 无快捷键帮助浮层。
P4：`?` 或 Cmd+K 内显示当前页快捷键清单（<30 行）。

---

## 5. 规则工程：如何让这些规则被 AI 稳定执行

调研最重要的元发现：**光有规则文档不够，主流做法是把规则分层编码**——机器能判定的进 lint，需要语境的进 Skill，产品政策留给人类拍板。

### 5.1 Vercel 的五条治理原则（可直接抄进本项目）

来自 [Teaching agents product design at Vercel](https://vercel.com/blog/teaching-agents-product-design-at-vercel-2UtdJlYIxoLAmiwWt5i4rV/f0095a8e84)：

1. **短入口 + 按面加载**：AGENTS.md 只挂指针，细节按 "forms / modals / navigation / 文案 / 状态 / 跨面模式" 组织，agent 需要时再读。
2. **规则带稳定 ID + 证据**：模板 = `rule/{stable-id} · Scope · Rule · Why · Exceptions · Source · Bad/Good 例 · Coverage gaps`。没有例外与 bad/good 的规则会被 agent 机械套用。
3. **linter 与 agent guidance 的决策树**：能无渲染可靠判定 + 低误报 + 有具体修法 → lint；需要产品语境或误报高 → agent guidance；**新标准/政策 → 人类决策**；两者都要配一个能抓回归的示例/eval。
4. **holdout eval + 消融**：用 skill 里没出现过的界面做 holdout 测试；同时跑"不带 skill"的对照组证明规则真的改变了行为——"是否加载了 skill"与"是否遵守了规则"是两个问题。
5. **变更走证据链 + 人审**：collector（只收集）→ judge（只分类）→ human review（决定 rule/reference/exemplar/lint/eval/coverage-gap/no change）。

### 5.2 可直接借用的社区资产

| 资产 | 内容 | 对本项目 |
|---|---|---|
| [cursor-design-rules](https://github.com/studioalexwolf/cursor-design-rules)（免费 3 条） | 核心原则 / 27 反模式 / 判断力（何时打破规则） | 反 AI 味清单的蓝本，可直接并入 `nc-ui-contract` |
| [community DesignSystem skill](https://github.com/Jaywalker-not-a-whitewalker/DesignSystem) | 6 步 onboarding（形态→用途→框架→身份→参考→配色）+ 审计器 + `Design.md` | 项目已有 tokens，不需要 onboarding；抄它的 **audit 输出格式**（passes/warnings/violations + 行号） |
| [impeccable.style](https://impeccable.style/) | AI 生成 UI 反模式工具 | V9 清单维护 |
| [AI & Automation UX Patterns (2025–2026)](https://raw.githubusercontent.com/vasilyu1983/AI-Agents-public/main/frameworks/shared-skills/skills/software-ui-ux-design/references/ai-automation-ux.md) | 状态分类 / 闸门 / 中断 / 成本 / 反模式 全目录 | I3/I6/I7/I9 的对照底稿 |
| [@vercel/agent-readability](https://www.npmjs.com/package/@vercel/agent-readability) + [Agent Readability spec](https://agent-ready.dev/complete-guide-to-agent-readability) | 面向 agent 的可发现性/可解析性（机器侧可达性） | 本项目是本地工作台不面向爬虫；价值点在 **AGENTS.md 的写法**（本项目已达标） |

### 5.3 `nc-ui-contract` v2 升级建议

- **规则带 ID**：现有 7 条 lint 规则 + 本报告 V1–V12 / I1–I15 中"禁止类"的，统一编号（`V-n` / `I-n`），SKILL.md 里每条附 `Why / Exceptions / Bad / Good`。
- **lint:ui 扩展（机器可判定的先上）**：
  1. 裸调色板类 `text-zinc-*` / `bg-red-*` / `text-emerald-*` → 令牌（V2）；
  2. `Select` 只有 2–3 个静态 option → 建议 radio/chip（Vercel 已证明的 lint 规则，低误报高收益）；
  3. `animate-spin|animate-pulse|animate-bounce` → 提示改用 token 时长版本（V5，需先提供替代实现）；
  4. `p-[0-9]+px|m-[0-9]+px|gap-[0-9]+px` 非 4 的倍数 → 报 off-grid（V2）。
- **新增 2–3 个 eval fixture**：holdout = 一个 skill 里没出现过的页面；对照组跑"不带 SKILL.md"的修改任务，断言违规数下降。
- **coverage-gaps.md**：把"暗色模式不做""生成式 UI 不做""多 provider fallback 未定"显式列出，避免 agent 自作主张。

---

## 6. 对照本项目：差距与 P4 路线

### 6.1 已收敛（✅，不需要再投入）

| 行业规则 | 本项目实现 |
|---|---|
| 计划先行 | `<PlanSheet>` + 结构化 `estimateNode()` + 预演 |
| 暂挂式 diff 审阅 | `staged_changes` + `<StagedReviewPanel>`（≤4/组、键盘、吸底、二次确认） |
| 检查点回滚 | checkpoint 全链路 + `<TimeMachine>` + 5 签核点 |
| 玻璃箱执行 + 真实进度 | jobs 队列 + SSE（TTFT 0ms）+ `<JobStepList>`（无假百分比） |
| 状态语义分族 | `toReviewStatus / toJobPhase / neutralStatusLabel` + 组件断言 |
| 可达性基线 | 焦点环 / ≥24px / aria-live / reduced-motion / axe 0 违规 |
| 视觉回归 | fixture seed + 7 路由 × 2 视口 `toHaveScreenshot` |
| 键盘审阅 | j/k/a/r/u + Cmd+K + 画布 B/S/R |

### 6.2 差距 → P4 路线（建议顺序，不跳序）

| 期 | 内容 | 对应规则 | 验收 |
|---|---|---|---|
| **P4-A 视觉收口**（✅ 已完成，见 §9） | ① `--accent` 与 `--st-review` 解耦；② 中性灰收口：149 处 `zinc-*`/越界调色板类机械迁移到令牌（脚本批量 + 视觉回归复核）；③ 字号刻度令牌；④ `<EmptyState>` 抽组件并迁移 6 处；⑤ SectionCard 分区手段收敛；⑥ lint:ui 扩展（裸调色板 / off-grid / spin-pulse 提示；静态 select→chip 延后）；⑦ `anti-slop.md` 并入 skill | V1/V2/V4/V8/V9 | 裸调色板类 149→0；lint:ui 通过；视觉回归 14 张基线复核；axe 0 |
| **P4-B 执行态增强** | ① 停滞检测（lastEventAt → 琥珀/红 + 文案）；② 共享时钟 + 失焦暂停；③ stop/pause/resume 三分 + N 项任务追加/移除剩余项；④ 折叠执行日志；⑤ `<JobTrace>` + 任务收据（实际 vs 预估、阶段成本归因） | I5/I6/I7/I9/I13、V5 | 停滞态在阈值触发且样式可测；pause 后 resume 不丢已完成项；收据偏差可读 |
| **P4-C 闸门与成本** | ① 三档 gate 命名 + `estimateNode` 输出 gate + 单测；② notify 必带撤销的核对测试；③ M1 价格表接入后：预算上限触顶即停 worker（不是只警告）；④ 重试成本显式归因 | I3/I4/I9 | 7 节点 gate 全覆盖；无 notify-without-undo；预算触顶实测停任务 |
| **P4-D M1 任务控制台** | 随 M1 夜跑队列：任务状态板（active jobs / staged 待审 / review_tasks / 产出物）+ per-node 自主性预设（I2） | I2/I8 | 多任务并行时 5 秒内看清"谁在跑、等什么、产出在哪" |

### 6.3 建议新增指标（接 06 §10 的 16 项之后）

| # | 指标 | 基线 | 目标 |
|---|---|---|---|
| 17 | running 任务停滞告警触发时间 | 无告警 | 超过节点阈值 ≤10s 内变色 |
| 18 | 可中断粒度 | 仅取消 | 全部 N 项循环任务可 pause + 追加/移除 |
| 19 | notify 档操作带真撤销的比例 | 未定义档位 | 100% |
| 20 | 任务收据覆盖（实际 vs 预估 + 阶段归因） | 0 | 100% 终态任务 |
| 21 | 预算触顶即停（M1 价格表后） | 仅提示 | 硬停 + 可恢复 |
| 22 | 每视图主操作审计 | 未做 | 10 页面一次评审 + 复核清单常驻 |
| 23 | 裸 Tailwind 调色板类（zinc/red/blue…） | **149 处** | **0（P4-A 已达成）**，lint 常驻拦截 |

---

## 7. 明确不做（与 06 反目标一致，防调研漂移）

- ❌ 不追求 AI 感视觉（渐变/发光/弹性动效）；工程工具审美即目标。
- ❌ 不做聊天式主界面；chat 即使出现也只是控制台里的一个模式。
- ❌ 不为每个操作加确认；闸门只看可逆性与代价（I3），确认疲劳会让批准盲点化（06 §2.3）。
- ❌ 不在 P4 引入 shadcn/组件库与暗色模式；`<EmptyState>` 等继续自研，令牌体系已足够。
- ❌ 不显示假百分比、不渲染假就绪骨架屏、不给 notify 装"看起来可撤销"的假撤销。

---

## 8. 参考来源（按类别）

**工具与形态（A/B）**
- [Claude Code 终端 UI 工程分析（第 14 章）](https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/docs/12-user-experience.md)
- [The next agent UI is mission control, not chat（2026-05）](https://timetobuildbob.com/blog/the-next-agent-ui-is-mission-control-not-chat/)
- [Google Antigravity 2.0 把 IDE 藏进聊天框与回退（How-To Geek）](https://www.howtogeek.com/google-antigravity-hid-the-ide-behind-a-chatbot-heres-how-to-get-it-back/)
- [Cursor 2.0 多 agent 与 visual editor bridge（2026）](https://dev.to/jangwook_kim_e31e7291ad98/cursor-20-8-parallel-ai-agents-and-visual-editor-bridge-50nk)
- [Cursor Design System for React（社区拆解）](https://www.shadcn.io/design/cursor)
- [Vercel: Teaching agents product design at Vercel](https://vercel.com/blog/teaching-agents-product-design-at-vercel-2UtdJlYIxoLAmiwWt5i4rV/f0095a8e84)
- [Codex 折叠推理之争 #2375（06 已引）](https://github.com/openai/codex/issues/2375)

**规则目录与社区 skill（B/C）**
- [AI & Automation UX Patterns（2025–2026 目录）](https://raw.githubusercontent.com/vasilyu1983/AI-Agents-public/main/frameworks/shared-skills/skills/software-ui-ux-design/references/ai-automation-ux.md)
- [community DesignSystem skill（8pt/token/section isolation/单主操作）](https://github.com/Jaywalker-not-a-whitewalker/DesignSystem)
- [cursor-design-rules（免费 3 条反 AI 味规则）](https://github.com/studioalexwolf/cursor-design-rules)
- [impeccable.style（AI 生成 UI 反模式）](https://impeccable.style/)
- [Vercel Agent Readability / 完整指南（2026-08）](https://agent-ready.dev/complete-guide-to-agent-readability)

**论文与研究（B）**
- [Zou et al. 2026：When Users Change Their Mind（InterruptBench，arXiv:2604.00892）](https://arxiv.org/abs/2604.00892)
- [Zhu et al. 2026：Design Principles for Human-Agent Interaction（arXiv:2606.20630）](https://arxiv.org/abs/2606.20630)
- [Agent Readiness 方法论（llms.txt / AGENTS.md 检查）](https://agent-ready.dev/methodology)

**本项目内基线**
- `docs/06-ui-optimization-plan.md`（P0–P3 已落地，附录 B–F 为验证记录）
- `src/app/globals.css`（@theme 令牌）· `src/lib/ui/status.ts`（三族状态）· `.claude/skills/nc-ui-contract/`

---

## 9. P4-A 落地记录（2026-08，本轮）

> 对应 §6.2 的 P4-A 视觉收口，已执行并通过门禁。

| 项 | 实现 |
|---|---|
| `--accent` 解耦 | `globals.css` 新增 `--accent` + `--color-accent`；焦点环、按钮进度、JobStepList 脉冲/进度/取消、Toast progress、命令面板激活、画布拖拽/选中/手柄、审阅面板选中与标题、资产对比环/链接全部从 `review` 改为 `accent`；`status.ts` 的审阅态徽章仍保留 `review` |
| 中性灰收口 | 全仓 `zinc-*`/`white`/`black`/`indigo` 裸类迁移到 `surface/surface-2/border/text-text/text-text-muted/text-text-subtle/text` 等令牌；剩余领域标签（线索/角色/剧透）新增 `clue/spoiler/character` 领域令牌迁移 |
| 字号刻度 | `@theme` 新增 `--text-caption/body/lead/title/display` |
| `<EmptyState>` | 新组件 `src/components/ui/empty-state.tsx`，迁移首页/档案/资产/渲染/脚本/分镜 6 处空态 |
| SectionCard 分区收敛 | 圆角改 `rounded-lg`（令牌），去掉 `shadow-card`，以边框为单一分区手段 |
| 动效令牌化 | 新增 `--dur-spin/--dur-pulse` + `nc-spin/nc-pulse`，替换 5 处 `animate-spin/pulse` |
| lint:ui 扩展 | 新增「裸 Tailwind 调色板类 / 任意值间距 off-grid / Tailwind 默认无限动画」三条规则 |
| Skill 更新 | `nc-ui-contract` 新增 `references/anti-slop.md`，SKILL.md 补充 accent/动画/反 AI 味复核项 |

**验证**：`lint:ui` 通过 · `eslint` 0 错 · `tsc --noEmit` 0 错 · `vitest` 77 通过 · `vitest:ui` 15 通过 · `next build` 成功 · `playwright --update-snapshots` 20/20 通过（含桌面/移动视觉回归基线更新）。

**未做（按计划延后）**：静态 2–3 项 `<select>` → radio/chip lint（避免误报，先靠人工复核）；暗色模式；P4-B/C/D。

---

## 附：本调研的方法论备注（防止证据污染）

1. **社区目录的弱证据问题**：可逆性三档（I3）在多个 2026 目录中措辞雷同，疑似同源转载——本文把它的说服力锚定在"框架层 interrupt/resume 原语"与"notify 无撤销=假撤销"这一可证伪命题上，而非转载数量。
2. **工具界面更新快**：Cursor 2.0 与 Antigravity 2.0 的形态仍在迭代，视觉结论只取其**结构性判断**（分面、闸门、artifact 信任），不追具体布局。
3. **本项目是创作工作台而非代码编辑器**：所有移植都经过 06 §3 的"原语 → 本项目形态"转换，禁止照抄终端/IDE 控件本身。
