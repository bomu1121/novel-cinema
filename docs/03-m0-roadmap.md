# 03 · M0 路线图：单章垂直切片

> M0 目标：**3000 字、2 个角色、3 分钟成片**，一条最小链路全部跑通。
> 非目标：整本导入、夜跑、自动分集、图生视频、LoRA、多用户。

## 1. M0 验收标准（Definition of Done）

给定一章 3000 字的中文推理小说 txt（含 2 个有对白的角色）：

1. 上传后自动识别编码、清洗、切成 1 个 source_chapter。
2. 一键分析出：2+ 角色档案、1 套风格圣经候选、1 份章节摘要。
3. 一键改编出：≤180s 的 beats（约 30~45 个），每条带 source_span 和取舍报告；界面可编辑 beat，可局部重生成。
4. 资产生成：1 张背景 + 2 张角色参考图 + 每角色 2 个表情变体，UI 候选点选。
5. 分镜自动生成：beats → shots + shot_layers，浏览器里可预览图层、机位标注、换图、调时长。
6. 配音：旁白 + 2 角色 voice_id，逐 beat 合成，ASR 校验红项标出。
7. 渲染：本地一键出 3 分钟 mp4（1920×1080，25fps，烧字幕，BGM 铺底），并用播放器验证声画字幕同步。
8. 成本留痕：本次全链路每个 AI 调用记入 jobs（model/tokens/cost）。

## 2. 仓库结构（目标形态）

```
novel-cinema/
├─ app/
│  ├─ (workspace)/
│  │  ├─ page.tsx                       # 项目列表
│  │  └─ book/[bookId]/
│  │     ├─ chapters/page.tsx           # 章节浏览/编辑
│  │     ├─ bible/page.tsx              # 全书档案 + 风格 + 声线（签核A）
│  │     ├─ script/page.tsx             # 改编脚本审校台（签核B）
│  │     ├─ assets/page.tsx             # 资产库（签核C）
│  │     ├─ storyboard/page.tsx         # 分镜时间轴（签核D）
│  │     └─ render/page.tsx             # 渲染任务（签核E/F）
│  └─ api/pipeline/route.ts             # 触发流水线节点的入口
├─ src/
│  ├─ lib/
│  │  ├─ db.ts / r2.ts / queue.ts
│  │  ├─ providers/
│  │  │  ├─ llm.ts / image.ts / tts.ts / asr.ts / embed.ts
│  │  ├─ pipeline/
│  │  │  ├─ nodes/                      # 每个节点一个文件：clean / analyze / adapt / assets / storyboard / voice / render
│  │  │  ├─ schemas/                    # zod：bible / adapt / review / render-spec
│  │  │  └─ runner.ts                   # jobs 状态机 + 重试 + 成本记账
│  │  └─ render/                        # timeline snapshot → ffmpeg 参数
│  ├─ components/
│  │  ├─ beat-editor.tsx                # 剧本编辑（左原文 span / 右 beat）
│  │  ├─ asset-picker.tsx
│  │  ├─ storyboard-timeline.tsx        # 时间轴拖拽
│  │  └─ review-badge.tsx               # 红/黄/绿风险项
│  └─ types/                            # 与 DB/JSON 对齐的 TS 类型
├─ supabase/
│  └─ migrations/0001_schema.sql        # 来自 docs/01，先建 M0 用到的表
├─ scripts/
│  ├─ pipeline-local.ts                 # 本地一键跑单章全链路
│  └─ render-local.ts                   # 本地渲染 mp4
└─ docs/                                # 00/01/02/03
```

## 3. 任务拆分

### T0 · 脚手架（0.5 天）

- [x] Next.js 16 + TypeScript + Tailwind 初始化（App Router，src 目录）
- [x] `lib/env.ts` 环境变量白名单（zod）
- [x] `lib/db.ts` Supabase client 封装（admin + user 双路径）
- [x] `lib/r2.ts` R2 封装（put / 签名 URL / 公开 URL）
- [x] `.env.example` 模板
- [ ] 接入 shadcn/ui 基础组件
- [ ] Supabase 远端项目创建（拿到 URL/key 填进 .env.local）

**DoD**：空页面跑通；migration 可重复应用；R2 读写各一次成功。（当前：构建通过；migration 与 R2 待真实环境验证）

### T1 · Schema v0（0.5 天）

- [x] 按 `docs/01` 生成 `supabase/migrations/0001_schema.sql`（enum + 全部表 + 索引 + RLS 骨架）
- [ ] 用 Supabase CLI 应用到远端/本地并验证（`supabase db push`）
- [ ] 生成数据库 TS 类型（`supabase gen types`，替换 `db.ts` 中的默认泛型）
- [ ] 建 `src/lib/db.ts` 的 CRUD 助手（book/source_chapter/adapted_chapter/beat/asset/voice_take/jobs）

**DoD**：`supabase db reset` 后 schema 存在；类型编译通过。

### T2 · 上传 + 清洗切章（1 天）

- [x] `node: clean`（`src/lib/pipeline/nodes/clean.ts`）：编码探测（UTF-8/UTF-16/GB18030/Big5）、水印/广告行清除、相邻重复行折叠、段落规范化、章节正则切分（含中文数字/特殊标题/5000 字兜底）
- [x] 上传页：拖入/选择 txt → `POST /api/books`（R2 存原文 + Supabase 落 books/source_chapters）
- [x] 章节列表页：`GET /api/books/[bookId]/chapters` + `/books/[bookId]` 展示章节/字数/状态
- [x] 单元测试：BOM/GB18030/UTF-16、水印、重复行、前言、特殊标题、无标题兜底（10 例全过）
- [ ] 真实环境验证：配好 SUPABASE_* 与 R2_* 后上传一次脏 txt，核对章节列表与原文

**DoD**：上传一个脏 txt，章节列表与原文核对无误；乱码/水印样本通过测试。（当前：代码与测试完成，待真实环境验证）

### T3 · LLM 适配器（0.5 天）

- [x] `providers/llm.ts`：`completeJSON<T>`（OpenAI 兼容 + zod JSON Schema 注入 + 校验失败反馈重试 + `response_format` 降级 + 退避）+ `completeText`
- [x] 成本留痕：调用结果写入 `jobs`（book_id/node/tokens/model/attempts），DB 未配置时不打断主流程
- [x] 单元测试：代码块围栏解析、校验失败反馈重试、重试耗尽抛 LLMError（3 例）
- [ ] 真实 provider 联调：填入 LLM_* 后跑一次 analyze 验证

**DoD**：用“输出字段类型错误”的测试 prompt 验证自动修复重试；jobs 记录完整。（当前：代码与 mock 测试完成）

### T4 · 单章分析（1 天）

- [x] `schemas/analysis.ts`：chunkAnalysis + styleBibleProposals 的 zod schema
- [x] `prompts/analyze.ts`：块抽取与风格圣经候选的提示词模板
- [x] `nodes/analyze.ts`：analyzeChapter / persistChapterAnalysis（人物别名合并、地点/物品去重、线索覆盖、时间线幂等）/ proposeStyleBibles / approveStyleBible
- [x] API：`POST /api/books/[bookId]/analyze`、`GET .../bible`、`POST .../bible/approve`
- [x] 档案页（`/books/[bookId]/bible`）：摘要/人物/线索/时间线展示 + 风格圣经候选点选批准（签核 A 简版）
- [ ] 真实章节验证：LLM key 配好后，用 3000 字样本章跑通并人工核对人物无张冠李戴

**DoD**：3000 字样本章输出 2+ 人物且人工核对无张冠李戴；风格圣经可直接用于出图 prompt。（当前：代码完成，待真实模型验证）

### T5 · 章节改编 + 审校台（2 天，全 M0 最关键）

- [x] `schemas/adapt.ts`：完整 zod schema（beats/selection_report/review，与 docs/02 附录一致）
- [x] `node: adapt`：上下文包组装（原文 + 风格圣经 + 人物白名单 + 线索 + 时长预算）+ C10 prompt
- [x] 确定性校验器：source_span 回查原文、人物白名单、时长预算 ±10%、旁白长度（4 个单测）
- [x] `node: review.script`：AI 自检（忠实度/线索/剧透/节奏/声部），红黄项输出
- [x] 审校台页面（`/books/[bookId]/script`）：beat 卡片编辑（文本/画面/情绪/语速）+ 原文出处内联展示 + 红黄项高亮 + 批准整章（签核 B）
- [x] **真实 LLM 冒烟测试**：deepseek-chat 产出 8 beats / 26.8s，通过全部确定性校验（首次输出 schema 失败后被自动修复重试，attempts=2）
- [ ] 打磨：左侧原文高亮 span 与右侧 beat 的分栏联动（当前为出处内联展示）；单 beat 带修复指令重生成

**DoD**：3000 字 → 180s 内脚本；每 beat 可回原文定位；红黄项界面可见；编辑保存后不丢。（当前：核心链路完成并过真实模型冒烟；分栏联动与单 beat 重生成留作打磨）

### T6 · 图像适配器 + 资产库（1.5 天）

- [x] `providers/image.ts`：`ImageProvider` 接口 + Seedream/火山方舟适配器（T2I/I2I 模型切换、watermark 参数降级重试、url 候选解析）
- [x] `prompts/image.ts`：角色设定图 / 表情变体（同人同装约束）/ 背景的确定性 prompt 模板 + 通用负面词
- [x] `nodes/assets.ts`：A10 资产生成清单（scene_key 跨章去重、phase1=设定图+背景 / phase2=表情变体、无参考图时 blocked）；A20/A30 候选生成（下载→R2 优先，R2 未配置保留 provider 直链）；签核 C（角色参考图回写 characters.ref_asset_id 并淘汰同角色其他候选）
- [x] API：`GET/POST .../assets`、`POST .../assets/generate`、`POST .../assets/[assetId]/approve`
- [x] 资产库页面（`/books/[bookId]/assets`）：分组画廊、点选批准、两阶段生成按钮
- [x] 单元测试：T2I/I2I 模型选择、参考图传递、watermark 拒绝自动降级（3 例）
- [ ] 真实图像联调：填入 IMAGE_API_KEY 后跑 phase1/phase2，核对角色一致性

**DoD**：2 角色各 1 参考图 + 2 表情、1 背景、候选点选全部落库；被 beat 引用的 asset 可解析。（当前：代码与 mock 测试完成，待真实图像 key）

### T7 · 分镜生成 + 预览（2 天）

- [x] `node: storyboard`：docs/02 镜头语法规则表 v0 实现（旁白 Ken Burns 交替 / 对白 push_in + 呼吸动效 / 动作双镜头快切 / 文字卡淡入淡出 / 蒙太奇多背景 crossfade / 黑场过渡）
- [x] 角色图层：按 beat 情绪匹配已批准表情资产，fallback 角色设定图；无角色层时纯背景镜头
- [x] 幂等重建：重跑先清旧 shots/layers，再生成 preview `timelines.snapshot`（含图层 rect/motion/转场/URL）
- [x] 时间轴预览页（`/books/[bookId]/storyboard`）：横向镜头卡片 + CSS 近似 Ken Burns/pan/breath 动效 + 文字卡预览；人工改时长/换背景写 locked；批准（签核 D）
- [x] API：`GET .../storyboard`、`POST .../storyboard/build|approve`、`PATCH .../shots/[shotId]`
- [ ] 真实资产联调：配好 Supabase/R2/图像 key 后跑通“脚本→资产→分镜”全链

**DoD**：不写一行 AI，从批准 beats+assets 确定性产出可渲染 snapshot；人工换图/改时长后重生成 snapshot 不重跑 AI。（当前：代码完成，待真实资产环境验证）

### T8 · 配音 + ASR（1.5 天）

- [ ] `providers/tts.ts`：`synthesize(text, voiceProfile, {emotion,pace})`
- [ ] `providers/asr.ts`：Whisper 兼容接口，返回文本
- [ ] `node: voice`：逐 beat 合成 → voice_takes；旁白/角色 voice_id 分别锁定
- [ ] `node: asr_check`：字符错误率阈值 8%，红项 + 自动重试 1 次
- [ ] 签核 E 页面：逐句播放/重录/换声线，批准后 takes 锁定

**DoD**：3 分钟脚本全部合成；两个角色音色可区分；红项句子重录后通过。

### T9 · 本地渲染（1.5 天）

- [ ] `render/`：snapshot → FFmpeg 命令行（背景/图层叠放 + zoompan 动效 + 转场 + 音频混音 + LoudNorm + ASS/SRT 烧字幕）
- [ ] `scripts/render-local.ts`：本地跑出 mp4；`render_jobs` 记录状态
- [ ] 渲染任务页：进度/日志/产物下载
- [ ] 质量断言：ffprobe 检查时长、分辨率、音轨存在、无黑帧（抽样）

**DoD**：命令行一条命令出片；3 分钟片声画字幕同步；换一张图/换一句配音后重渲染 < 2 分钟。

### T10 · 端到端联调 + 成本报告（1 天）

- [ ] `scripts/pipeline-local.ts`：单章一键全链路（clean → analyze → adapt → assets → storyboard → voice → render）
- [ ] 每个签核点在脚本中以 `--approve-all` 跳过人工（方便回归）
- [ ] 成本汇总页/命令：按节点统计 tokens/cost/时长
- [ ] 用 2 个不同文本跑 2 遍，修复明显 bug
- [ ] 写 `README.md`：启动、环境变量、一条命令出片

**DoD**：两个样本章各出片成功；单章全链路成本有明确数字；README 可复现。

## 4. 排期建议（个人开发者）

| 周 | 任务 | 产出 |
|---|---|---|
| W1 | T0–T4 | 能上传、能分析、有档案页 |
| W2 | T5–T6 | 能出脚本、能出图、能点选 |
| W3 | T7–T8 | 能出分镜、能配音 |
| W4 | T9–T10 | 能渲染出片、能一键重跑 |

关键路径是 **T5（改编质量）**，风险最大，不要跳步；T6 与 T7 可并行，因为分镜开发用占位图即可先行。

## 5. M0 的刻意简化（后面再补）

- 全书跨章实体合并、向量检索 → M1（M0 单章不检索）
- 角色 LoRA / 图生视频 / 表情动作包扩充 → M2
- 分集、发布、多平台 → M1 末
- 托管队列 → M0 用本地脚本 + API 路由同步触发；接入 Inngest/Trigger.dev 放在 M1 开头
- 云端渲染 → M0 本地 FFmpeg；M1 迁到 Railway Job / Cloud Run
- 多 provider → M0 每类只接一个，但接口按可插拔设计

## 6. 启动顺序（第一批提交）

1. `0001_schema.sql`（T1）
2. 上传 + clean（T2）
3. LLM 适配器（T3）
4. 单章 analyze + 档案页（T4）

这四步完成后，项目就有了“输入原文 → 结构化理解”的骨架，后面所有节点都挂在它上面。
