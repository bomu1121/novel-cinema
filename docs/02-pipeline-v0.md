# 02 · 流水线定义 v0

> 一份“可执行规格”：每个节点有输入、输出、模型档位、校验、重试、人工闸门。
> 实现时每个节点 = 一个函数 + 一个 zod schema + 一条 jobs 记录。

## 1. 编排原则

1. **AI 与确定性程序分离**：AI 只负责“理解、改编、生成素材、自检”；时间轴、转场、混音、切分、压制是确定性程序。改一个图/一句配音/一个时长，**绝不重跑 AI**。
2. **全部结构化输出**：所有 LLM 输出强制 JSON Schema（zod 校验），校验失败 = 带错误信息重试，不是“再生成一遍”。
3. **节点幂等**：同一输入重跑得到同一结果或更优结果，不产生重复数据（按 `scene_key` / `unique` 约束去重）。
4. **上游批准才传播**：未批准产物只用于预览；批准后写“stale”扩散。
5. **AI 每次调用留痕**：model、tokens、cost、input snapshot、raw output 全进 `jobs` / `chapter_contexts`。
6. **预算护栏**：每本书设 `budget_usd_cap`，每节点设 `max_attempts`，超限转人工。

## 2. 总 DAG

```
B00 book.upload            ── 上传 txt，建项目
B10 clean.split            ── 清洗 + 切章（确定性为主）
B20 book.analyze           ── 全书粗读（夜跑）
   ├─ B21 chunk.embed      ── 分块 + 向量化
   ├─ B22 chunk.extract    ── 逐块抽取（便宜模型，并行）
   ├─ B23 entity.merge     ── 实体合并（强模型）
   ├─ B24 bible.propose    ── 3 套风格圣经（强模型）
   └─ B25 ledger.build     ── 章节摘要 + 线索账本 + 时间线（程序化）
G1  signoff.bible          ── ✅ 签核 A：风格 + 声线
C10 adapt.chapter          ── 逐章改编（强模型，并行，每章一 job）
C20 review.script          ── AI 自检 + 确定性校验
G2  signoff.scripts        ── ✅ 签核 B：只处理红/黄项
A10 asset.plan             ── 资产生成清单 + 跨章去重（程序化）
A20 asset.generate.ref     ── 角色设定图 / 背景（图片 API）
A30 asset.generate.variant ── 表情/姿势变体（角色参考图一致性）
G3  signoff.assets         ── ✅ 签核 C：点选候选
S10 storyboard.build       ── beat→shot 确定性分镜（镜头语法）
S20 preview.render         ── 低清预览
G4  signoff.preview        ── ✅ 签核 D：时间轴微调
V10 voice.generate         ── 逐句 TTS（多角色，并行）
V20 voice.asr_check        ── ASR 回读校验
G5  signoff.audio          ── ✅ 签核 E：重录个别句子
M10 mix.audio              ── BGM/SFX/响度归一（确定性）
R10 render.master          ── 全书渲染（一次性 Job）
E10 split.episodes         ── 幕边界确定性切分
E20 episode.meta           ── 标题/封面/简介（便宜模型）
G6  signoff.final          ── ✅ 最终签核
P10 publish.package        ── 平台规格导出
```

## 3. 节点规格总表

| 节点 | 类型 | 模型档 | 输入 | 输出 | 重试 | 人工闸门 |
|---|---|---|---|---|---|---|
| B00 upload | 确定性 | — | txt 文件 | book + R2 原文件 | — | 无 |
| B10 clean.split | 确定性 + 便宜 LLM（仅脏数据） | cheap | 原 txt | source_chapters | 3 | 抽查（自动通过） |
| B21 chunk.embed | 确定性 | embedding | cleaned_text | 分块 + 向量 | 3 | 无 |
| B22 chunk.extract | AI 并行 | cheap | 文本块 | 实体/事件/线索/摘要草稿 | 3 | 无 |
| B23 entity.merge | AI | strong | 全部草稿实体 | 规范档案 + 冲突清单 | 2 | 冲突项人工确认 |
| B24 bible.propose | AI | strong | 风格/类型/角色概览 | 3 套风格圣经候选 | 2 | 签核 A |
| B25 ledger.build | 程序化 | — | B23 输出 | 摘要/线索账本/时间线 | — | 无 |
| G1 signoff.bible | 人工 | — | 候选 + 试听 + 试作图 | 批准的 bible + voice_profiles | — | ✅ |
| C10 adapt.chapter | AI 并行 | strong | 原文+上下文包 | adapted_chapters + beats | 3 | 签核 B |
| C20 review.script | AI + 规则 | strong/cheap | beats + 原文 span | 红/黄项报告 | 2 | 签核 B |
| A10 asset.plan | 程序化 | — | 批准 beats | 去重后的资产生成清单 | — | 无 |
| A20/A30 asset.generate | 图片 API | — | spec + refs | 候选 assets | 3 | 签核 C |
| S10 storyboard.build | 确定性 | — | beats + assets + 镜头语法 | shots / shot_layers | — | 签核 D |
| S20 preview.render | 确定性 | — | timeline 快照 | 低清 mp4 | 2 | 签核 D |
| V10 voice.generate | TTS API | — | beat 文本 + voice_profile | voice_takes | 3 | 签核 E |
| V20 voice.asr_check | ASR | — | take 音频 + 目标文本 | 相似度 + 红项 | 2 | 签核 E |
| M10 mix.audio | 确定性 | — | takes + BGM 选择 | 混音规格 | — | 无 |
| R10 render.master | 确定性 Job | — | timeline 快照 | master mp4 | 2 | 签核 F |
| E10 split.episodes | 确定性 | — | master + 幕边界 | episodes | — | 无 |
| E20 episode.meta | AI | cheap | 集内摘要 + 关键画面 | 标题/简介/封面候选 | 2 | 签核 F |
| P10 publish.package | 确定性 | — | 批准的分集 | 平台规格文件夹 | — | 无 |

## 4. 关键节点细节

### 4.1 B10 clean.split

- 编码探测：UTF-8 / GB18030 / UTF-16 自动识别；保留 `raw_text`。
- 章节识别优先级：
  1. 正则：`第[一二三四五六七八九十百千0-9]+[章回卷节]` 及变体（空格、繁体）；
  2. 无章节标记 → 按 5000 字左右切段，生成“第 N 段”；
  3. 卷/部/幕识别为结构标记，写入 `parse_meta`（供 act 使用）。
- 清洗规则：去广告水印行（URL、公众号名、重复 3 次以上的行）、统一标点与换行、合并被打断的短行、去除文末“完/全文完”。
- 只有规则解决不了的歧义（前言/作者注/章节标题变体）才调 cheap LLM 判断。
- 输出校验：每章 `char_count > 0`；总字符数与原文件误差 < 5%；章节数 1~500。

### 4.2 B20 全书粗读（两遍法的第一遍）

- 分块：5000–8000 字/块，重叠 300–500 字；块号写入 `chapter_summaries.embedding` 的源。
- B22 逐块抽取（cheap，并行 4~8，JSON Schema）：

```json
{
  "characters": [{"name":"", "aliases":[], "description":"", "first_seen_in_chunk":true}],
  "events": [{"time_label":"", "description":"", "characters":[], "location":""}],
  "locations": [{"name":"", "aliases":[], "description":""}],
  "items": [{"name":"", "kind":"", "description":""}],
  "clues": [{"name":"", "type":"", "description":"", "is_red_herring":false}],
  "summary": "",
  "tone": ""
}
```

- B23 实体合并（strong，一次最多 20 章的量）：
  - 输入：块级实体 JSON；
  - 输出：`canonical_name`、`aliases` 合并、`bio`、`first_chapter_id`、**冲突列表**（“林小姐”到底是林小雨还是林岚，置信度 < 0.9 必须进冲突列表）；
  - 冲突项生成 `review_tasks(kind=bible)` 给人工，不阻塞其他实体。
- B24 风格圣经候选：输入类型标签 + 主要角色 + 前 3 章摘要；输出 3 套候选，每套含 `visual_style / art_direction / color_palette / camera_grammar / narration_tone / spoiler_rules`。
- B25 程序化落库：章节摘要、线索账本（出现/回收章）、时间线 `order_key` 排序。

### 4.3 时长预算（C10 前置，确定性 + AI 权重）

1. `usable_sec = target_total_duration_sec × 0.95`（留 5% 给片头尾/文字卡）。
2. 便宜模型给每章打权重 `importance ∈ [0.5, 3]`（按事件密度、剧情转折、高潮）。
3. `chapter_target_i = usable_sec × weight_i / Σweight`。
4. C10 必须在 `±10%` 内完成；全量跑完后若总和偏差大，程序化等比例微调（不重跑 LLM，只改每章预算提示再对超限章重跑）。
5. beat 时长估算器（程序化，v0）：
   - 中文语速基线 **4.5 字/秒 × pace**；
   - `dialogue = 文本字数/语速 + 0.8s（反应预留）`，夹在 2.5~8s；
   - `narration ≤ 8s`（超长拆两句）；
   - `insert_card = 3~5s`；`action/montage = 3~6s`；`transition ≤ 1.5s`。

### 4.4 C10 adapt.chapter（流水线核心）

输入上下文包（强模型）：

```
1. 风格圣经（已批准，约 2000 字）
2. 本章原文 cleaned_text
3. 前 3 章摘要（chapter_summaries）
4. 检索 top 8 段落（向量） + 相关线索（clue_ids）
5. 本章在场人物（B22 提取 + 人工档案）
6. 未回收线索清单 + 剧透规则
7. 本章时长预算 target_sec
```

系统提示词骨架（见附录 P1）。输出 JSON Schema（zod 等价）：

```ts
{
  title: string, hook: string,
  beats: [{
    idx: number, type: "narration"|"dialogue"|"action"|"insert_card"|"montage"|"transition",
    speaker_type: "narrator"|"character"|"onscreen_text"|"none",
    character_name: string | null,     // 必须来自人物白名单
    text: string,                      // 旁白稿/台词（口语化）
    emotion: string,                   // 固定枚举，见下
    pace: number,                      // 0.8~1.3
    visual_note: string,
    source_span: {start_char:number, end_char:number, quote:string},
    importance: 1|2|3|4|5,
    clue_ids: string[],
    flags: {spoiler?:boolean, low_confidence?:boolean}
  }],
  selection_report: {
    kept: [{span:string, reason:string}],
    cut:  [{summary:string, reason:string}],      // 删了什么、为什么
    compressed: [{span:string, from:string, to:string}],
    clue_safety_notes: string[],
    risks: [{severity:"red"|"yellow", text:string}]
  },
  casting_notes: string[],
  bgm_suggestion: {mood:string, intensity:number}
}
```

固定情绪枚举：`neutral, calm, happy, sad, angry, fear, surprise, suspicious, nervous, pain, determined, whisper`。

硬校验（zod 后，程序化）：
- `Σ estimated_duration_sec ≤ target × 1.1`，否则要求模型删 beat 重试；
- 每个 `source_span` 必须能映射回本章原文区间（前 30 字符匹配）；
- `character_name ∈ 白名单`，不在场不得说话；
- 含 `spoiler:true` 的 beat 必须没有画面级线索（只允许旁白/文字卡）；
- 相邻 beat 不得出现“同一画面 + 同一旁白声音 > 15s”的单调段。

### 4.5 C20 review.script（AI 自检）

输入：beats + 对应 source_span 原文 + 线索账本 + 风格圣经。
输出：

```json
{
  "verdict": "ready" | "needs_work",
  "items": [{
    "severity": "red"|"yellow",
    "beat_idx": 0,
    "kind": "fidelity"|"clue"|"spoiler"|"pacing"|"voice",
    "issue": "", "suggestion": ""
  }]
}
```

- red = 必须处理（捏造事实、说话人错误、线索缺失、剧透画面）；
- yellow = 建议处理（节奏单调、旁白过长）；
- 签核 B 界面只展开 red/yellow，green 折叠。人工可：批准整章 / 编辑 beat / 局部重生成（只重跑该 beat 的 C10，带修复指令）。

### 4.6 A10/A20/A30 资产生成

**A10 去重清单**：扫描全部已批准 beat，生成唯一键：
- 背景：`bg:{location_id}:{time}:{mood}`（跨章复用）
- 角色参考图：`ref:{character_id}`（每角色只生成一次，4 候选点选 1）
- 表情/姿势变体：`char:{character_id}:{expression}:{pose}`（姿势可退化，先只做表情）
- 道具：`prop:{item_id}`
- 文字卡：`card:{type}`（线索卡/时间卡，程序化排版，不占图片预算）

**prompt 组装器（确定性模板）**：

```
背景:   {visual_style}, {location.visual_note}, {time}, {mood}, no people,
        no text, no watermark, {negative_prompt}

角色参考: {visual_style}, character design sheet, {name}: {bio.appearance},
        {bio.outfit}, neutral expression, standing, full body, plain background,
        front view, no text, no watermark

表情变体: {visual_style}, same character as the reference image, {name},
        {expression_cn} expression, {pose_cn}, same outfit, same face,
        {scene_context}, no text, no watermark
```

**生成与评审**：
- 候选一律先出低清（≤768px）3~4 张，批准后只对选中图上采样/高清重绘；
- 表情变体必须携带 `ref_asset_ids=[角色参考图]`，由 provider 的角色参考/IP-Adapter 能力实现；
- 自动预筛（有 API 就用，没有就跳过）：NSFW、纯色/黑图、人脸与参考图相似度、风格分；
- 签核 C 是“点选”不是“写 prompt”：每批显示 3~4 候选 + 预筛分数，一键选中，选中图作为后续一致性参考。

### 4.7 S10 storyboard.build（确定性镜头语法 v0）

规则表（v0 先实现这一张，以后升级为可配置的 `camera_grammar`）：

| beat | 镜头规则 |
|---|---|
| narration | 宽景/环境图，**默认静止**；动效（Ken Burns 等）由用户在画布/编排台显式选择 |
| dialogue | 说话人近景 2.5~6s，**默认静止**；同一人连续 >8s 插听者反应镜头；对白切换 = cut |
| action | 2~3 个短镜头，每个 2.5~4s，节奏快，**默认静止** |
| insert_card | 全屏文字卡，3~5s，fade in/out |
| montage | 多背景 2s 快切，crossfade，**默认静止** |
| transition | 黑场/文字卡，≤1.5s |
| 通用 | 新地点首个镜头 = 远景建立；场景切换 = crossfade；时间跳跃 = dip_to_black |
| 图层 | 角色在 beat 开始时 enter（首现 fade_in，离场 fade_out）；换表情 = 同层换 asset + 0.3s crossfade；角色图层呼吸动效保留（幅度小） |

输出：`shots + shot_layers` 全部可被渲染器直接消费；每层 `motion` 保证“画面一直在动”，解决“静态图不够生动”的第一层。

### 4.8 V10/V20 配音

- 一句一个 `voice_take`；`beat.speaker_type=narrator → narrator voice`，`character → character.voice_profile_id`，`onscreen_text → 无配音`。
- 情绪映射表（provider 适配层实现，v0 给默认值）：`suspicious → 压低/放慢`、`surprise → 加快+重音` 等；`pace` 直接传给 provider 语速参数。
- ASR 回读与 `beat.text` 对齐：字符错误率 > 8% 或漏句 → 红项，自动用“强调提示”重试 1 次，仍失败交人工重录。
- 响度统一在 M10 做（LoudNorm，目标 -16 LUFS，多平台安全值）。
- 旁白/角色/背景音乐分轨保存，混音前任何一句可单独换，**不重跑其他句**。

### 4.9 R10 / E10 / E20 渲染与分集

- 渲染器输入 = `timelines.snapshot`（**不是** live 查询），schema 见附录 P2。
- master：1080p（或 book.settings 分辨率）、H.264 + AAC、25fps、烧字幕（可选）。
- 切分：只允许在 act/幕边界、shot 边界切；`episode ≤ episode_max_sec`；每集由 master timeline 切片**独立渲染**（避免二压），并带 3s 前情提要卡（程序化生成，素材复用）。
- E20 为每集生成 3 个标题/简介/封面文案候选，人工点选或默认 AI 推荐。

## 5. 夜跑调度模型

- 一本书只有一个 `workflow run`（jobs 树）；前端只显示 6 个签核点和当前节点。
- 每个节点任务进入托管队列；并行度上限：LLM 4、图片 3、TTS 8。
- 任何节点失败：指数退避重试（30s/2min/8min），3 次后把该 job 标 failed，下游全部挂起，**不影响已完成的兄弟节点**。
- 成本护栏：每节点开始前检查累计成本；超 `budget_usd_cap` 后自动转“仅出清单不执行”。

## 6. 附录 P1：C10 改编系统提示词（骨架）

```text
你是一名影视导演兼推理小说改编编剧。任务：把一章小说压缩成视频脚本。

【硬约束】
1. 忠于原文：只删减、合并、旁白概述，绝不新增事实、对白或动作。
2. 每个 beat 必须带 source_span，精确到本章字符区间；无法定位的内容不得输出。
3. 时长预算：本章 {target_sec} 秒，所有 beat 估算时长之和不得超过预算的 110%。
4. 人物白名单：{allowed_characters}。不在名单中的名字不得作为说话人；必要时用“他/她”指代。
5. 剧透规则：{spoiler_rules}。凡尚未回收的线索，禁止在 visual_note 中暗示真凶或手法；只能旁白/文字卡承载。
6. 画面可达：visual_note 必须可拆成“背景 + 人物 + 动作 + 表情”；连续两个 beat 不得无画面变化。
7. 语言：旁白稿是口语化中文，单句朗读不超过 8 秒；对白优先保留原文关键句。

【输入】
- 风格圣经：{style_bible}
- 前情摘要：{previous_summaries}
- 本章人物：{characters}
- 相关线索：{clues}
- 未回收线索：{unresolved_clues}
- 原文：{chapter_text}

【输出】
严格输出一个 JSON 对象，schema：{schema}
```

## 7. 附录 P2：timelines.snapshot 渲染规格（v0）

```json
{
  "timeline": {
    "version": 1,
    "book_id": "...",
    "resolution": [1920, 1080], "fps": 25, "sample_rate": 48000,
    "duration_sec": 120.4,
    "video_tracks": [
      {
        "id": "t1", "start_sec": 0, "end_sec": 4.2,
        "background": {"asset_key": "bg/study_night.png", "camera": "push_in", "zoom": [1.0, 1.08]},
        "layers": [
          {"asset_key": "char/holmes_suspicious.png", "rect": [0.55, 0.30, 0.36, 0.62],
           "enter": "none", "exit": "none", "motion": {"type": "breath", "amplitude": 0.002},
           "opacity": 1.0}
        ],
        "transition_in": "cut", "transition_out": "crossfade"
      }
    ],
    "audio_tracks": [
      {"kind": "voice", "start_sec": 0.1, "end_sec": 4.0, "asset_key": "voice/beat_3.wav", "volume": 1.0, "speaker": "c_holmes"},
      {"kind": "bgm", "start_sec": 0, "end_sec": 120.4, "asset_key": "bgm/library_suspense_02.mp3", "volume": 0.18, "duck": true}
    ],
    "subtitle_track": [
      {"start_sec": 0.1, "end_sec": 4.0, "text": "这扇窗是从里面反锁的。", "style": "speaker"}
    ]
  }
}
```

渲染器（FFmpeg 或 Remotion）只认这份快照；`video_tracks` 内部顺序即合成顺序，转场在相邻轨道间由渲染器实现。

## 8. 附录 P3：其余关键提示词要点

- **B22 块抽取**：强调“只提取，不总结剧情之外的内容；所有名字保留原文写法；不确定给 confidence”。
- **B23 实体合并**：强调“同名不同人必须分开；合并依据是上下文；无法判断进 conflicts，不得猜测”。
- **B24 风格圣经**：要求每套候选“可被 AI 绘图直接引用”，输出 `visual_style` 一句话 + 5 色色板 + 禁项。
- **E20 分集元数据**：输入集内章节摘要 + 首末画面描述；输出标题/简介/标签，禁剧透（标题不得含凶手/手法）。
