# 12 · 滚动条设计体系（调研 + 落地）

> 定位：全站滚动条的**设计原则调研** + **统一实现**。
> 解决三类问题：① 原生滚动条交互"复古"（无 hover/拖拽反馈、占位突兀）；② 颜色与设计令牌无关（灰/白/黑硬边，与主题脱节）；③ 部分页面存在**双滚动职能重复**（页面与内层容器各自滚动，用户不知道该用哪根条）。
>
> 状态：调研完成，落地完成并通过 lint:ui / test:ui 与视觉自检。

---

## 0. TL;DR

1. **现代滚动条 = overlay（浮层式）**：macOS（Lion 2011 起）、iOS、Android、Windows 11、GNOME 全部收敛到"细、圆、低对比、轨道透明、空闲时淡出/隐藏、滚动或悬停时浮现"的形态。**自定义滚动条不应再画成粗灰块**。
2. **CSS 标准属性已就绪**：`scrollbar-width` / `scrollbar-color` 在 **Firefox 64+ / Chrome 121+ / Safari 18.2+** 全线可用（[Chrome for Developers: Scrollbar styling](https://developer.chrome.com/docs/css-ui/scrollbar-styling)）。Chromium 中标准属性**优先于** `::-webkit-scrollbar` 伪元素（[Frontend Masters: Heads Up on Custom Scrollbars](https://frontendmasters.com/blog/heads-up-on-custom-scrollbars-chrome-is-supporting-the-standard-now-which-overrides-the-old-pseudo-elements/)），所以基线用标准属性，伪元素只作旧版 Safari 兜底，不再维护两套大而全的样式。
3. **同一条滚动轴只能有一个滚动所有者**：嵌套滚动（页面滚 + 内层滚）是公认的无障碍与可用性公害（[Nested Scroll Bars Are One of the Biggest Accessibility Evils, Ever](https://buttondown.com/access-ability/archive/nested-scroll-bars-are-the-one-of-the-biggest)）。页面滚动场景 → 内层不滚；app 场景（画布/面板）→ 视口不滚、内层滚。
4. **落地**：`globals.css` 新增滚动条令牌 + 全局规则 + 两个工具类（`.scroll-hover-reveal` / `.scroll-contain`）；修复 condense 页双滚动；侧边栏/画布面板滚动条悬停浮现。

---

## 1. 调研：现代滚动条的设计与使用原则

### 1.1 Overlay（浮层式）滚动条是平台标准

| 平台 | 形态 | 关键行为 |
|---|---|---|
| macOS（Lion 起） | 细圆条，轨道透明 | 空闲淡出，滚动/悬停浮现；不占布局空间 |
| iOS / Android | 细圆条 | 滚动时短暂浮现，随后消失；触摸滚动是直接操纵，无常驻条 |
| Windows 11 | 细圆条（WinUI 风格） | 滚轮滚动时浮现，空闲淡出；Chrome 121+ 起按系统风格渲染 overlay |
| GNOME / Elementary | 细圆条 | 滚动浮现，空闲淡出 |

对桌面 Web 的推论：**滚动条是"滚动功能的指示器"而不是"内容边框"**——所以轨道必须透明、thumb 必须低对比、空闲时应接近不可见。

### 1.2 CSS 标准属性已收敛，伪元素降级为兜底

- `scrollbar-width: thin|auto|none` + `scrollbar-color: thumb track`：Firefox 64+（[MDN scrollbar-color](https://developer.mozilla.org/en-US/docs/Web/CSS/scrollbar-color)）、**Chrome 121+（2024-01）**（[Chrome 121 Beta](https://developer.chrome.google.cn/blog/chrome-121-beta?hl=zh-tw)、[web.dev 平台新功能 2024-12](https://web.developers.google.cn/blog/web-platform-12-2024?hl=zh-cn)）、**Safari 18.2+（2024-12）**。
- Chromium 中一旦使用标准属性，`::-webkit-scrollbar` 伪元素样式会被覆盖（[Frontend Masters](https://frontendmasters.com/blog/heads-up-on-custom-scrollbars-chrome-is-supporting-the-standard-now-which-overrides-the-old-pseudo-elements/)）——因此**不要**同时维护两套大而全的样式，标准属性管颜色/粗细，伪元素只为旧 Safari 提供圆角与呼吸边。
- 现代 overlay 滚动条与 `scrollbar-gutter`：Chrome 的 overlay 行为下 gutter 不占空间；经典滚动条下 `scrollbar-gutter: stable` 可防布局跳动（[Always Show Scrollbars Without Layout Jumps](https://thelinuxcode.com/how-to-always-show-scrollbars-with-css-without-layout-jumps/)）。

### 1.3 外观原则（本项目据此定令牌）

1. **细**：`thin` + 10px 视觉宽度（含 2px 呼吸边）即可，不做 12px+ 粗条。
2. **圆**：全圆角（`999px`），绝不画直角块。
3. **低对比**：静息 ≈ ink 22% 透明度，仅"隐约可见"；悬停 ≈ 42%，拖拽 ≈ 60%。禁止纯黑/纯白/高饱和色。
4. **轨道透明**：不画轨道背景与边框，滚动条不制造视觉噪音。
5. **触屏隐藏**：`@media (hover: none) and (pointer: coarse)` 下隐藏——触摸滚动无需滚动条（iOS/Android 惯例）。
6. **hover-reveal 只用于 "chrome" 区域**：导航栏、工具面板这类"界面骨架"滚动条悬停/聚焦时才浮现；内容区（列表、日志、命令面板）保持静息可见，保证**可发现性**。

### 1.4 布局与滚动行为原则

- **`scrollbar-gutter: stable`（页面级）**：Next.js 路由切换或内容增长导致滚动条出现/消失时，页面不横移。Chrome overlay 下无副作用。
- **`overscroll-behavior: contain`（嵌套滚动容器）**：内层滚动到顶/底后，滚轮不再"链式"传给外层页面（scroll chaining），避免"滚一下页面突然跳走"。
- **滚动条不是布局的一部分**：不要让滚动条挤压内容（overlay 平台惯例）；也不要在内容里再画"假滚动条"。

### 1.5 职能原则：同一滚动轴只有一个滚动所有者

嵌套滚动是公认可用性/无障碍问题（[Access-ability: Nested Scroll Bars](https://buttondown.com/access-ability/archive/nested-scroll-bars-are-the-one-of-the-biggest)）：**两套滚动条同时出现 = 用户无法确定"该滚哪根"**。判定规则：

| 场景 | 正确形态 | 反例 |
|---|---|---|
| 文档/管理页（一屏多卡片） | **页面滚动**，卡片自然生长 | 卡片内再开 `overflow-y-auto` 固定高度（双条并列） |
| 对照/审阅视图（两栏并排） | 双栏**随页面同步滚动**，天然对齐 | 两栏各自独立内滚（不同步、双条） |
| App 工作区（画布/IDE） | 视口固定，**面板内滚**，页面不滚 | 页面也滚（双条垂直） |
| 弹层（命令面板） | 弹层内滚，背后页面锁定 | 弹层滚 + 背后页面也滚 |

（实现同步滚动需要 JS 双向绑定，属于 diff 工具级复杂度；在无同步机制时，**单页面滚动让双栏天然同步**，优于两个独立内滚。）

### 1.6 无障碍基线

- 可滚动区域必须能被键盘触达（WCAG 2.1.1；ACT 规则 [0ssw9k](https://act-rules.github.io/rules/0ssw9k)）：本方案不隐藏滚动能力，仅改变外观；可滚动容器保持可聚焦/可滚。
- hover-reveal 必须带 `:focus-within` 兜底，键盘用户聚焦时滚动条同样浮现。
- 滚动条是功能性 UI，不涉及动效；但滚动行为相关动画仍受全局 `prefers-reduced-motion` 兜底约束（`globals.css` 已有）。

---

## 2. 全站滚动面审计（改动前）

| 滚动区域 | 所有者 | 改动前问题 | 处置 |
|---|---|---|---|
| 页面 body（全部管理页） | 页面 | 原生粗条、颜色突兀 | 全局细圆低对比条 + `scrollbar-gutter: stable` |
| AppShell 左侧流程导航 | 侧边栏（sticky 独立滚） | 导航区滚动条常驻，噪音 | `.scroll-hover-reveal` + `.scroll-contain` |
| condense 页左右两栏 | **页面 + 内层双重** | **双滚动职能重复**：两栏 `h-[calc(100vh-11rem)]` 内滚，页面又为下方报告滚动；两栏无法同步 | **移除内层滚动**，改自然高度 → 单一页面滚动，双栏天然同步（§1.5 表第 2 行） |
| 画布左侧资产池 / 右侧检查器 | 面板内滚（h-screen app 场景，正确） | 常驻粗条 | `.scroll-hover-reveal` + `.scroll-contain` |
| 命令面板结果列表 | 弹层内滚（正确） | 原生条 | 全局样式 + `.scroll-contain` |
| JobStepList 执行日志 | 内滚（正确） | 原生条 | 全局样式 + `.scroll-contain` |
| storyboard 页横向时间轴条 | 横向内滚（正确，唯一横滚） | 原生条 | 全局样式（横向条同规则） |
| textarea / JSON 编辑器 | 控件自身（正确） | 原生条 | 全局样式 |
| ReactFlow 画布视口 | transform 平移（无经典滚动条） | — | 无需处理 |

---

## 3. 决策与实现

### 3.1 令牌（`globals.css` `:root` / `[data-theme="dark"]`）

```css
--scrollbar-size: 10px;                          /* WebKit 兜底视觉宽度（含 2px 呼吸边） */
--scrollbar-thumb: rgb(24 24 27 / 0.22);         /* 静息：隐约可见 */
--scrollbar-thumb-hover: rgb(24 24 27 / 0.42);   /* 悬停 */
--scrollbar-thumb-active: rgb(24 24 27 / 0.6);   /* 拖拽中 */
--scrollbar-track: transparent;                  /* 轨道永远透明 */
```

暗色画布（`data-theme="dark"`）同阶透明度、浅色 thumb：`rgb(244 244 245 / 0.22/0.4/0.55)`。

### 3.2 全局规则（浏览器矩阵）

| 引擎 | 生效机制 |
|---|---|
| Firefox 64+ | `scrollbar-width: thin` + `scrollbar-color`（标准属性） |
| Chrome 121+ / Edge | 标准属性（覆盖伪元素，渲染系统 thin 条） |
| Safari 18.2+ | 标准属性 |
| Safari <18.2 | `::-webkit-scrollbar` 兜底：10px 宽、2px 透明呼吸边 + 全圆角 + `background-clip: padding-box`（6px 可见圆条） |
| 触屏（hover: none） | 全部隐藏（平台惯例） |

### 3.3 工具类

- `.scroll-hover-reveal`：滚动条空闲透明，容器 `:hover` / `:focus-within` 时浮现（含 WebKit hover/active 三档）。
- `.scroll-contain`：`overscroll-behavior: contain`，截断滚动链。

---

## 4. 落地清单

| 文件 | 改动 |
|---|---|
| `src/app/globals.css` | 滚动条令牌（浅/暗）+ 全局标准属性基线 + WebKit 兜底 + `html { scrollbar-gutter: stable }` + 触屏隐藏 + `.scroll-hover-reveal` / `.scroll-contain` |
| `src/app/books/[bookId]/condense/page.tsx` | 左栏去掉 `overflow-auto` 与 `lg:h-[calc(100vh-11rem)]`；textarea 去掉固定高度 → 单一页面滚动 |
| `src/components/ui/app-shell.tsx` | 侧边栏挂 `scroll-hover-reveal scroll-contain` |
| `src/components/storyboard-canvas.tsx` | 资产池/检查器两面板挂 `scroll-hover-reveal scroll-contain` |
| `src/components/jobs/command-palette.tsx` | 结果列表挂 `scroll-contain` |
| `src/components/jobs/job-step-list.tsx` | 日志列表挂 `scroll-contain` |
| `AGENTS.md` | 新增滚动条铁律（同一轴一个滚动所有者；滚动条走全局体系） |

---

## 5. 验证

- [x] `npm run lint:ui` 通过（无新硬编码色/任意值/裸调色板类）。
- [x] `npm run test:ui` 通过（组件改动无回归）。
- [x] 视觉自检：浅色/暗色两套滚动条在长内容容器上截图核对（细、圆、低对比、轨道透明、hover 变深）。

---

## 6. 未来可选项（本次不做）

1. **JS 级 overlay 滚动条**（滚动时浮现、空闲淡出，macOS 精确复刻）：需要滚动监听 + 定时器，本次用 CSS 静息低对比 + hover 浮现近似；若后续要求"空闲完全消失"，再上 JS 方案。
2. **双栏同步滚动**（diff 工具级）：condense 若恢复"独立内滚 + 同步"，需 `scroll` 事件双向绑定，属独立组件，不进全局体系。
3. **`scroll-driven animations`**（Chrome 115+）：可做滚动进度指示，与滚动条体系正交，等有明确场景再评估。
