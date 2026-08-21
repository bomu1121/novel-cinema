# 反 AI 味清单（docs/07 V9）

> 这些是社区与 Vercel/Claude Code 实践中被反复点名、且本项目最容易复发的
> "AI 生成界面"特征。写 UI 前先过一遍；能机器化的已进 `lint-ui-contract.mjs`。

## 八条红线

| # | 反模式 | 正确做法 | 是否已机器化 |
|---|---|---|---|
| 1 | 无动机的紫渐变 / 蓝色发光 | 只用 `--surface/*` 灰阶 + `--accent` 强调；渐变仅当它是"内容"（如分镜预览） | ✅ lint：`bg-[#` / 裸调色板类 |
| 2 | 卡片套卡片、重复边框+阴影 | 相邻区块只用一个分隔手段（surface 色差 / 留白 / 分隔线 / 边框 / 色块），`<SectionCard>` 用边框为主 | ⚠️ 人工复核 |
| 3 | 三列相同 feature grid / 复制粘贴区块 | 先总览→过滤→细节；区块密度与内容重要性匹配 | ⚠️ 人工复核 |
| 4 | 正文居中、层级与重要性不匹配 | 正文左对齐；一屏一个主 CTA；标题层级用 `text-caption/body/lead/title/display` | ⚠️ 人工复核 |
| 5 | 纯黑 `#000` / 未调色灰 | 黑底用 `bg-text`（`--ink`），灰阶用 `text-text/text-text-muted/text-text-subtle` | ✅ lint：裸调色板类 |
| 6 | 灰色文字放在彩色底上 | 彩色底上文字用同色系 tint（`bg-approved/10 text-approved` 模式），校验 WCAG AA | ⚠️ axe |
| 7 | 弹性/回弹缓动用于工具类产品 | 默认 `--ease-out`；禁止 spring/bounce 装饰 | ⚠️ 人工复核 |
| 8 | 13px padding、12px 正文等魔法值 | 间距 4px 网格；正文 ≥14px；meta/caption 才 12px | ✅ lint：off-grid 任意间距 |

## 执行纪律

- 交互强调（焦点环、进度、激活、链接）一律用 `--accent`，**不借用 `--st-review`**（docs/07 V1）。
- 无限指示器用 `nc-spin` / `nc-pulse`（令牌时长），不用 `animate-spin/pulse/bounce`。
- 空态用 `<EmptyState>`，必须给"下一步"；不要为未生成的 AI 产物画假就绪骨架。
