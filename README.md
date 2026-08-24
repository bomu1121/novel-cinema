# novel-cinema

小说 → AI 影像化工作台。目标：上传一本无版权风险的 txt 小说，经“全书理解 → 章节改编 → 分层资产生成 → 多角色配音 → 确定性渲染”，产出 1 小时全书 master 视频，并在幕边界切分发布。

当前阶段：**M0 单章垂直切片**（3000 字、2 角色、3 分钟成片）。

## 文档

- [docs/00-decisions.md](docs/00-decisions.md) — 产品与技术决策基线（含 SQLite 本地化决策）
- [docs/01-data-model-v0.md](docs/01-data-model-v0.md) — 数据模型 v0
- [docs/02-pipeline-v0.md](docs/02-pipeline-v0.md) — 流水线定义 v0（节点/提示词/校验/重试）
- [docs/03-m0-roadmap.md](docs/03-m0-roadmap.md) — M0 任务拆分与验收标准
- [docs/04-interaction-redesign.md](docs/04-interaction-redesign.md) — 交互重设计方案 v1（画布 + 检查器 + 命令面板）
- [docs/05-overlap-transitions.md](docs/05-overlap-transitions.md) — 转场与叠化
- [docs/06-ui-optimization-plan.md](docs/06-ui-optimization-plan.md) — **UI 优化方案 v2**（04 的超集：agentic 交互原语移植 + 组件规格 + Skill 清单 + 验证闭环）
- [docs/07-ui-visual-interaction-research.md](docs/07-ui-visual-interaction-research.md) — **UI 视觉与交互调研**（主流 AI coding 工具的视觉语言与交互规则 + 本项目差距与 P4 建议）
- [docs/08-ui-visual-interaction-refactor.md](docs/08-ui-visual-interaction-refactor.md) — **UI 视觉与交互重构方案**（元素级 + 整体体验：页面骨架、组件规格、画布/编排台、里程碑）
- [docs/09-ui-primary-action-audit.md](docs/09-ui-primary-action-audit.md) — **每视图主操作审计**（一屏一主 CTA 的走查记录）

## 技术栈（本地单机版）

Next.js 16 (App Router) + TypeScript + **SQLite（better-sqlite3，自动建表）** + **本地媒体目录 public/storage/** + FFmpeg 本地渲染。

> 云端 Postgres 版 schema 保留在 `supabase/migrations/0001_schema.sql`，未来要上云/多用户时可直接迁移回去。

## 环境变量

```bash
cp .env.example .env.local
```

只需 3 个 AI key：`LLM_*`（已有 DeepSeek）、`IMAGE_API_KEY`（即梦/Seedream）、`TTS_API_KEY`（火山豆包）。数据库和文件**零配置**，首次启动自动创建 `data/novel-cinema.db`。

## 数据与媒体

- 数据库：`data/novel-cinema.db`（SQLite，WAL 模式，备份=复制文件）
- 媒体：`public/storage/`（图片/音频/成片，URL 为 `/storage/<key>`）
- 两者均已加入 .gitignore，不会误提交

## 开发

```bash
npm run dev            # http://localhost:3000
npm run lint
npm test               # 29 个单测
npm run build

# 一键载入《魔眼之匣》测试章（固定 bookId=fixture-book，幂等重建）
npm run seed:magyan

# 一键流水线（单章）
npm run pipeline:local -- --book <bookId> --approve-all

# 本地渲染
npm run render:local -- --book <bookId>

# 成本报告
npm run cost:report -- --book <bookId>
```

## M0 进度

- [x] T0–T10 代码全部完成
- [x] 数据库本地 SQLite + 本地媒体（Supabase 风格链式 API，上层零改动）
- [x] **真实端到端出片**：《雨夜疑案》样章 → 分析/改编（DeepSeek）→ 图像（Seedream 5.0 Pro，3+6 张）→ 分镜（17 镜头）→ 配音（8 句）→ 渲染 53.6s mp4（1920×1080，烧字幕）
- [x] **内置测试夹具已换为《魔眼之匣》测试章**：`npm run seed:magyan` 幂等重建固定 bookId=fixture-book，含 3796 字原文、15 beats、15 shots、占位媒体与完整下游数据；修复了旧 fixture 角色/资产插入顺序与媒体 404 问题。
- [x] **角色图自动抠底（透明 PNG）**：生成的角色设定图/表情变体会自动移除背景并保存为透明 PNG；资产库用棋盘格预览，分镜/画布/渲染直接叠加在背景层上。
- [x] **编排台** `/books/[bookId]/workbench`：中间态可视化编辑（人物/说话人/图层人物图/入场退场/机位/声线/JSON）+ stale 传播 + 单节点重跑
- [x] **分镜画布** `/books/[bookId]/canvas`：React Flow 时间轴画布——资产池拖图换人物、镜头/图层检查器、入场退场动画、分镜/配音重跑
- [x] 画布迭代②：beat 卡片直接换说话人/台词/情绪，配音状态与 ASR 标记上卡；渲染器支持 slide 入场/退场位移动画（改的画布字段真的会渲染）
- [x] 画布迭代③（以图为核心 + 三层预览）：角色资产池按角色分组、镜头卡实时动效（Ken Burns/呼吸）、检查器大图 + ◀▶ 一键换图、单镜头 mp4 预览（真 FFmpeg）、beat 卡 🔊 试听 + 音频播放器、全片后台渲染 + 画布内播放
- [x] **重叠镜头真叠化**：转场时间轴重构（docs/05）——cut 分组、组内 FFmpeg xfade 链真实重叠混合（fade/fadeblack/slideleft）、offset 公式正确、全局首尾淡入淡出；实测 3 镜 7s 样本 → 5.6s 且中点像素为混合值；单镜头预览与全片共享渲染逻辑
- [x] **16:9 全线对齐 + 静止默认机位**：画布镜头卡/预览 16:9；背景图直接 1280×720 生成（已换新背景重渲染）；分镜默认 camera=static，不再自动推拉横摇，动效只在用户显式选择时出现
- [x] **交互 I0 反馈与撤销层**：全局 Toast、修改前快照 + 一键撤销（已真机验证）、状态影响预报（6 个重跑按钮显示费用/覆盖范围/耗时）、内联确认卡替代系统 confirm()、保存成功 checkmark 与错误提示
- [ ] 交互 I1（画布中枢化：流程铁路 + Cmd+K + 成本仪表盘）/ I2（拖时长、入出点手柄）/ I3（AI 建议 chips）——方案见 docs/04
- [ ] 下一阶段 M1：整本 30 万字分层分析、夜跑队列、幕级分集、角色一致性加强

样片输出：`out/1a50b162-f436-49b6-a030-e9d3c2260564.mp4`
